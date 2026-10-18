// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../models/cbt-force.model';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import type { CBTUnit } from '../models/runtime/cbt-unit';
import { loadCBTForceFixture } from '../models/runtime/testing/cbt-force-fixture';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { DataService } from './data.service';
import { ForceBuilderService } from './force-builder.service';
import { ForceDialogsService } from './force-dialogs.service';
import { ForceOperationService } from './force-operation.service';
import { ForcePersistenceService } from './force-persistence.service';
import { ForceSlotLifecycleService } from './force-slot-lifecycle.service';
import { ForceUrlStateService } from './force-url-state.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';

/** `ForceBuilderService.switchCBTRules` over real forces and units. */
describe('ForceBuilderService live rules switch with real forces', () => {
    function createService(forces: readonly CBTForce[], ruleset: CBTRuleset) {
        const options = signal({
            CBTRules: ruleset,
            CBTOptionalRules: { forcedWithdrawal: true, sprinting: false, hotLoadedAmmo: false },
        });
        const optionsService = {
            initialized: signal(true),
            options,
            setOption: jasmine.createSpy('setOption').and.callFake(async (key: string, value: unknown) => {
                options.update(current => ({ ...current, [key]: value }));
            }),
        };
        const loadedForces = signal(forces.map(force => ({ force, alignment: 'friendly' })));
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['error', 'warn']) },
                { provide: DataService, useValue: {} },
                { provide: ForcePersistenceService, useValue: {} },
                { provide: ForceOperationService, useValue: { configure: () => undefined } },
                { provide: InventoryControlOpforService, useValue: { connect: () => undefined } },
                { provide: ForceUrlStateService, useValue: { configure: () => undefined, start: () => undefined } },
                { provide: ForceDialogsService, useValue: {} },
                { provide: ForceWorkspaceStateService, useValue: { loadedForces } },
                { provide: ForceSlotLifecycleService, useValue: {} },
                { provide: OptionsService, useValue: optionsService },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
            ],
        });
        return { service: TestBed.inject(ForceBuilderService), optionsService, loadedForces };
    }

    async function settled(): Promise<void> {
        TestBed.flushEffects();
        for (let index = 0; index < 20; index += 1) await new Promise(resolve => setTimeout(resolve));
    }

    /** A force that can play only Total Warfare. */
    function failingForce(name: string): CBTForce {
        return Object.assign(Object.create(CBTForce.prototype) as CBTForce, {
            displayName: () => name,
            prepareScenarioRebind: jasmine.createSpy('prepareScenarioRebind').and.callFake(
                async (scenario: { readonly ruleset?: CBTRuleset }) => scenario.ruleset === 'total-warfare'
                    ? { bound: true, dropped: [], install: async () => true }
                    : { bound: false }),
        });
    }

    async function damagedTwForce(instanceId: string) {
        const mek = createDirectMekRuntimeFixture('total-warfare', instanceId);
        const { force } = await loadCBTForceFixture([mek.instance as CBTUnit], 'total-warfare');
        const face = [...mek.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 3)!;
        const ac = mek.equipmentComponent('Test AC').id;
        for (const command of [
            { type: 'damage-armor', faceId: face.id, amount: 2, target: 'committed' },
            { type: 'set-component-jammed', componentId: ac, jammed: true },
        ] as const) {
            expect((await force.dispatchUnitCommand(instanceId, command)).changed).withContext(command.type).toBeTrue();
        }
        return { force, instanceId, face: face.id, ac };
    }

    it('switches every loaded force, keeping the damage both rulesets share', async () => {
        const alpha = await damagedTwForce('unit:alpha');
        const { service, optionsService } = createService([alpha.force], 'total-warfare');
        await settled();
        const armor = alpha.force.getUnitSnapshot(alpha.instanceId)!.query.remainingArmor(alpha.face);

        expect(await service.switchCBTRules('core-2026')).toBeTrue();

        expect(optionsService.setOption).toHaveBeenCalledOnceWith('CBTRules', 'core-2026');
        const snapshot = alpha.force.getUnitSnapshot(alpha.instanceId)!;
        expect(snapshot.ruleset).toBe('core-2026');
        expect(snapshot.query.remainingArmor(alpha.face)).toBe(armor);
        expect(snapshot.query.componentJammed(alpha.ac)).toBeFalse();
    });

    it('a failed switch leaves the forces that did switch exactly as they were (all or nothing)', async () => {
        const alpha = await damagedTwForce('unit:alpha');
        const bravo = failingForce('Bravo');
        const { service, optionsService } = createService([alpha.force, bravo], 'total-warfare');
        await settled();
        const before = (await alpha.force.serializeForPersistence()).cbt!.units;
        const undo = alpha.force.getRuntimeUndoState();
        expect(undo.canUndo).toBeTrue();

        expect(await service.switchCBTRules('core-2026')).toBeFalse();

        expect(optionsService.setOption).not.toHaveBeenCalled();
        expect(alpha.force.getUnitSnapshot(alpha.instanceId)!.ruleset).toBe('total-warfare');
        // The jam Core cannot hold must survive a switch that never happened.
        expect(alpha.force.getUnitSnapshot(alpha.instanceId)!.query.componentJammed(alpha.ac)).toBeTrue();
        expect((await alpha.force.serializeForPersistence()).cbt!.units).toEqual(before);
        expect(alpha.force.getRuntimeUndoState()).toEqual(undo);
    });

    it('binds a force loaded after the switch to the new rules', async () => {
        const alpha = await damagedTwForce('unit:alpha');
        const { service, loadedForces } = createService([alpha.force], 'total-warfare');
        await settled();
        expect(await service.switchCBTRules('core-2026')).toBeTrue();

        const late = await damagedTwForce('unit:late');
        loadedForces.update(slots => [...slots, { force: late.force, alignment: 'friendly' }]);
        await settled();

        expect(late.force.getUnitSnapshot(late.instanceId)!.ruleset).toBe('core-2026');
        expect(alpha.force.getUnitSnapshot(alpha.instanceId)!.ruleset).toBe('core-2026');
    });
});
