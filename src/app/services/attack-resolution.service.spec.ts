// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { EMPTY, of, Subject } from 'rxjs';
import type { AttackResolutionDialogData } from '../components/attack-resolution-dialog/attack-resolution-dialog.component';
import { CBTForceMember } from '../models/force-member.model';
import { CBTForce } from '../models/cbt-force.model';
import { TestAeroSpaceFighterEntity } from '../models/entity/testing/test-entities';
import { asEncounterTargetId } from '../models/runtime/encounter-runtime';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { AttackResolutionService } from './attack-resolution.service';
import { DialogsService } from './dialogs.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService, type ReceivedGameEvent } from './game-events.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { weaponHitLocation } from '../models/runtime/attack-hit-location';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { UnitNameService } from './unit-name.service';

describe('AttackResolutionService hit locations', () => {
    const dialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
    beforeEach(() => {
        dialog.calls.reset();
        TestBed.configureTestingModule({ providers: [
            { provide: OptionsService, useValue: { options: () => ({ attackResolution: true, CBTOptionalRules: {} }) } },
            { provide: DialogsService, useValue: { createDialog: dialog } },
            { provide: GameEventsService, useValue: { received: EMPTY } },
            { provide: InventoryControlOpforService, useValue: { resolveOpforTarget: () => null } },
            { provide: ForceWorkspaceStateService, useValue: {} },
            { provide: UnitNameService, useValue: { name: () => 'Attacker' } },
            { provide: ToastService, useValue: {} },
        ] });
    });

    it('gives a fighter a lucky-hit check for a rolled 12 but not for automatic swarm damage (TW pp.223, 239)', async () => {
        const applied = jasmine.createSpy('applyWeaponHits').and.resolveTo(true);
        const fighter = {
            kind: 'cbt', id: 'fighter', entity: new TestAeroSpaceFighterEntity(),
            force: { getUnitSnapshot: () => null, applyWeaponHits: applied },
            nonMekRecordSheetSnapshot: () => ({ locations: [{ code: 'Nose', sheetCode: 'Nose', locationId: 'nose' }] }),
        } as unknown as CBTForceMember;
        const roll = { types: [], targetNumber: 5, toHit: [6, 6], groups: [{ location: [3, 4], aux: 1, damage: 1 }] } as const;
        await TestBed.inject(AttackResolutionService)['applyAttack'](fighter, {
            kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'attacker', attacker: 'Infantry',
            toUnit: fighter.id, turn: 1, arc: 'front', weapons: [
                { ...roll, name: 'Swarm damage', physical: 'swarm-damage', critical: true },
                { ...roll, name: 'Laser' },
            ],
        }, 'committed');
        expect(applied).toHaveBeenCalledOnceWith(fighter.id, jasmine.objectContaining({ groups: [
            jasmine.objectContaining({ locationId: 'nose', luckyHit: false, source: { kind: 'physical', infantryCritical: 'swarm-damage' } }),
            jasmine.objectContaining({ locationId: 'nose', luckyHit: true }),
        ] }), 'committed');
    });

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`resolves semi-guided indirect fire and aimed shots against water cover under ${ruleset}`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            const targetId = asEncounterTargetId('target:water');
            const registry = { revision: 0, targets: [{ id: targetId, letter: 'A', name: 'Target', color: '#abc',
                unitType: 'mek-biped', tnCalculator: { waterDepth: 'underwater-depth-1', tagged: true, immobile: true },
            }] } as const;
            const member = { id: fixture.instance.instanceId, entity: fixture.entity,
                force: { getUnitSnapshot: () => null } } as unknown as CBTForceMember;
            for (const indirectFire of [true, false]) {
                const weapon = fixture.equipmentComponent(indirectFire ? 'Test Artemis Launcher' : 'ISMediumLaser');
                expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                    edit: { kind: 'set-target-facts', targetId,
                        facts: { distance: 3, ...(indirectFire ? { calculator: { indirectFire: true } } : {}) } },
                }, registry, false).changed).toBeTrue();
                expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                    edit: { kind: 'set-component-selection', componentId: weapon.id,
                        selection: { kind: 'target', targetId, ...(indirectFire ? {} : { aim: 'CT' }) } },
                }, registry, false).changed).toBeTrue();
                const panel = projectMekEquipmentPanel(fixture.entity, fixture.index, ruleset, fixture.instance.query(), registry, {});
                await TestBed.inject(AttackResolutionService).rollAttacks(member, panel, {
                    gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false,
                    missingMovementModifier: false, attackModifierBreakdown: [], c3Available: true, c3DegradationSource: 'none',
                });
                const data: AttackResolutionDialogData = dialog.calls.mostRecent().args[1].data;
                const profile = data.targets[0].profiles.find(entry => entry.componentId === weapon.id)!;
                expect(profile.partialCover).toBe(indirectFire && ruleset === 'core-2026');
                if (!indirectFire) expect(profile.aim?.rerollLegs).toBeTrue();
            }
        });
    }
});

describe('incoming floating criticals', () => {
    for (const floatingCriticals of [true, false]) {
        it(`previews and applies the sender's reroll only when the defender plays floating criticals (${floatingCriticals})`, async () => {
            const received = new Subject<ReceivedGameEvent>();
            const shown = jasmine.createSpy('createDialog').and.returnValue({ closed: of(true) });
            const applied = jasmine.createSpy('applyWeaponHits').and.resolveTo(true);
            const force = Object.assign(Object.create(CBTForce.prototype), {
                instanceId: () => 'force', readOnly: () => false, getCBTMembers: () => [member],
                getUnitSnapshot: () => null, applyWeaponHits: applied,
                runAsOneUndoStep: (apply: () => Promise<boolean>) => apply(),
            });
            const member = new CBTForceMember('target', force, createDirectMekRuntimeFixture().entity);
            TestBed.configureTestingModule({ providers: [
                { provide: OptionsService, useValue: { options: () => ({ CBTOptionalRules: { floatingCriticals } }) } },
                { provide: GameEventsService, useValue: { received } },
                { provide: DialogsService, useValue: { createDialog: shown } },
                { provide: InventoryControlOpforService, useValue: {} },
                { provide: ForceWorkspaceCommandsService, useValue: { selectUnit: () => {} } },
                { provide: ForceWorkspaceStateService, useValue: { loadedForces: () => [{ force }] } },
                { provide: UnitNameService, useValue: { name: () => 'Target' } },
                { provide: ToastService, useValue: { showToast: () => {} } },
            ] });
            const service = TestBed.inject(AttackResolutionService);
            received.next({ toForce: 'force', fromDisplayName: null, event: {
                kind: 'attack', id: 'attack', fromForce: 'sender', fromUnit: 'attacker', attacker: 'Atlas',
                toUnit: 'target', turn: 1, arc: 'rear', weapons: [{ name: 'Laser', types: [], targetNumber: 5,
                    toHit: [4, 4], groups: [{ location: [1, 1], floating: [3, 3], aux: 1, damage: 5 }] }],
            } });
            await (service as unknown as { incoming: Promise<void> }).incoming;
            const { weapons, arc } = shown.calls.mostRecent().args[1].data.event;
            const expected = { location: floatingCriticals ? 'RT' : 'CT', rear: true, throughArmorCritical: true };
            expect(weaponHitLocation(member, arc, weapons[0], weapons[0].groups[0])).toEqual(jasmine.objectContaining(expected));
            expect(applied).toHaveBeenCalledOnceWith('target', { family: 'mek',
                groups: [jasmine.objectContaining({ ...expected, damage: 5, ...(floatingCriticals ? { floatingCritical: true } : {}) })],
            }, 'committed');
        });
    }
});
