// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Injector } from '@angular/core';
import { CBTUnitService } from '../../services/cbt-unit.service';
import type { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { OptionsService } from '../../services/options.service';
import { ToastService } from '../../services/toast.service';
import { asUnitUuid, MM_DATA_UNIT_PROVIDER_ID } from '../../services/unit-catalog/unit-catalog.types';
import { CBTForce } from '../cbt-force.model';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import { GameSystem } from '../common.model';
import { asComponentId } from '../entity/entity-identifiers';
import { TestBipedMekEntity, TestTankEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from '../entity/types';
import { AmmoEquipment } from '../equipment.model';
import type { SerializedCBTForce } from '../force-serialization';
import { CBTMekUnit } from './cbt-mek-unit';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import { isSerializedNonMekUnit, type SerializedNonMekUnit } from './non-mek-unit-persistence';
import { CBT_FORCE_PERSISTENCE_SCHEMA_VERSION, asForceId, emptyRuntimeHistory, type SerializedCBTUnitV2 } from './persistence-v2';
import { formatRuntimeHistoryMessage, RUNTIME_HISTORY_MESSAGE } from './runtime-history';

const standard = new AmmoEquipment({
    id: 'Ammo_AC_10', name: 'AC/10 Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 10 },
});
const precision = new AmmoEquipment({
    id: 'Ammo_AC_10_Precision', name: 'AC/10 Precision Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 5, munitionType: ['M_PRECISION'] },
});

for (const family of ['mek', 'vehicle'] as const) {
    describe(`${family} ammo loadout reset`, () => {
        it('resets all bins in one history action, restores original capacities, and undoes/redoes together', async () => {
            const { force, instanceId } = await createForce(family);
            const damage = { componentId: asComponentId('ammo:3'), status: 'destroyed' as const, target: 'committed' as const };
            expect((await (family === 'mek'
                ? force.dispatchMekUnitCommand(instanceId, { type: 'set-component-status', ...damage })
                : force.dispatchNonMekUnitCommand(instanceId, { kind: 'set-component-status', ...damage }))).changed).toBeTrue();
            const configure = (bin: number, munitionKey: string, remaining: number) => family === 'mek'
                ? force.dispatchMekUnitCommand(instanceId, {
                    type: 'configure-ammo-source', componentId: asComponentId(`ammo:${bin}`), munitionKey, remaining,
                })
                : force.dispatchNonMekUnitCommand(instanceId, {
                    kind: 'configure-ammo-source', componentId: asComponentId(`ammo:${bin}`), munitionKey, remaining,
                });
            expect((await configure(1, precision.id, 2)).changed).toBeTrue();
            expect((await configure(2, precision.id, 1)).changed).toBeTrue();
            expect((await configure(3, standard.id, 4)).changed).toBeTrue();
            const before = force.getUnitSnapshot(instanceId)!.state;
            const historyCount = force.getRuntimeHistory().length;

            const reset = await (family === 'mek'
                ? force.dispatchMekUnitCommand(instanceId, { type: 'reset-ammo-loadout' })
                : force.dispatchNonMekUnitCommand(instanceId, { kind: 'reset-ammo-loadout' }));

            expect(reset).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
            const after = force.getUnitSnapshot(instanceId)!;
            expect(after.state.ammo.size).toBe(0);
            expect(after.state.stateRevision).toBe(before.stateRevision + 1);
            expect(after.query.remainingAmmo(asComponentId('ammo:1'))).toBe(10);
            expect(after.query.remainingAmmo(asComponentId('ammo:2'))).toBe(20);
            expect(after.query.remainingAmmo(asComponentId('ammo:3'))).toBe(10);
            expect(after.state.components).toEqual(before.components);
            expect(force.getRuntimeHistory().length).toBe(historyCount + 1);
            const history = force.getRuntimeHistory().find(row =>
                row.event.message[0] === RUNTIME_HISTORY_MESSAGE.AMMO_LOADOUT_RESET)!.event.message;
            expect(history.slice(2) as unknown[]).toEqual([
                ['c:ammo:1', precision.id, 2, standard.id, 10],
                ['c:ammo:2', precision.id, 1, standard.id, 20],
                ['c:ammo:3', standard.id, 4, standard.id, 10],
            ]);
            const formatted = formatRuntimeHistoryMessage(history, {
                unitLabel: () => 'Test unit',
                ammoLabel: (_id, key) => key === precision.id ? precision.name : standard.name,
                targetLabel: (_id, _kind, id) => id,
                omitUnitLabel: true,
            });
            expect(formatted).toContain('AC/10 Precision Ammo (2) → AC/10 Ammo (10)');
            expect(formatted).toContain('AC/10 Precision Ammo (1) → AC/10 Ammo (20)');
            expect(formatted).toContain('AC/10 Ammo (4) → AC/10 Ammo (10)');

            expect((await force.undoRuntimeCommand()).accepted).toBeTrue();
            expect(force.getUnitSnapshot(instanceId)!.state.ammo).toEqual(before.ammo);
            expect(force.getUnitSnapshot(instanceId)!.state.components).toEqual(before.components);
            expect(force.getRuntimeHistory().filter(row => row.applied).length).toBe(historyCount);
            expect((await force.redoRuntimeCommand()).accepted).toBeTrue();
            expect(force.getUnitSnapshot(instanceId)!.state.ammo.size).toBe(0);
            expect(force.getRuntimeHistory().length).toBe(historyCount + 1);
            expect(force.getRuntimeHistory().every(row => row.applied)).toBeTrue();
        });

        it('does not add a history or undo action when the loadout is already default', async () => {
            const { force, instanceId } = await createForce(family);
            const before = force.getUnitSnapshot(instanceId)!.state;
            const reset = await (family === 'mek'
                ? force.dispatchMekUnitCommand(instanceId, { type: 'reset-ammo-loadout' })
                : force.dispatchNonMekUnitCommand(instanceId, { kind: 'reset-ammo-loadout' }));
            expect(reset).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
            expect(force.getUnitSnapshot(instanceId)!.state).toBe(before);
            expect(force.getRuntimeHistory()).toEqual([]);
            expect(force.getRuntimeUndoState()).toEqual({ canUndo: false, canRedo: false });
        });
    });
}

async function createForce(family: 'mek' | 'vehicle') {
    const registry = createTestEquipmentRegistry({ [standard.id]: standard, [precision.id]: precision });
    const entity = family === 'mek' ? new TestBipedMekEntity(registry) : new TestTankEntity(registry);
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
    entity.uuid.set(uuid);
    entity.setTonnage(55);
    entity.setEquipment([1, 2, 3].map(bin => new EntityMountedEquipment({
        mountId: `ammo:${bin}`, equipment: standard, equipmentId: standard.id,
        allocation: { kind: 'location', location: family === 'mek' ? 'LT' : 'Front' },
        shotsCount: bin === 2 ? 20 : 10,
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
    })));
    const instanceId = `unit:ammo-reset:${family}`;
    const options = {
        initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' },
        scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
    };
    const ready = entity instanceof TestBipedMekEntity
        ? await CBTMekUnit.createFromEntity({ uuid, instanceId }, entity, uuid, options)
        : CBTNonMekUnit.create(entity, {
            uuid, instanceId, deployment: options.deployment, scenario: options.scenario,
            initialStateProfileId: 'pristine-non-mek-v1',
        });
    const unit = ready.serialize();
    const forceId = asForceId('force:ammo-reset');
    const record: SerializedCBTForce = {
        version: 2, timestamp: '2026-09-06T00:00:00.000Z', instanceId: forceId,
        type: GameSystem.CBT, name: 'Ammo reset test',
        cbt: {
            schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION, forceId, forceRevision: 0, history: emptyRuntimeHistory(),
            units: [{ instanceId, stateRevision: unit.stateRevision, unit }],
            roster: { schemaVersion: 1, groups: [{
                groupId: 'group:ammo-reset', order: 0, name: 'Test', members: [{ instanceId, order: 0 }],
            }] }, encounter: { networks: [] },
        },
    };
    const data = {
        getFactionById: () => null, getEraById: () => null,
        getUnitByUuid: () => ({ uuid, provider: MM_DATA_UNIT_PROVIDER_ID, name: 'Test', entityType: entity.entityType }),
    } as unknown as DataService;
    const units = {
        restore: async (saved: SerializedCBTUnitV2 | SerializedNonMekUnit) => ({
            unit: isSerializedNonMekUnit(saved)
                ? CBTNonMekUnit.restore(saved, entity, uuid, options.scenario)
                : await CBTMekUnit.restoreFromEntity(saved, entity as TestBipedMekEntity, uuid, options),
            warnings: [],
        }),
    } as unknown as CBTUnitService;
    const injector = {
        get: (token: unknown) => token === CBTUnitService ? units
            : token === OptionsService ? { options: () => ({ CBTRules: CORE_2026_RULESET, CBTOptionalRules: {} }) }
            : token === ToastService ? jasmine.createSpyObj<ToastService>('ToastService', ['showToast'])
            : token === LoggerService ? jasmine.createSpyObj<LoggerService>('LoggerService', ['error', 'warn'])
            : null,
    } as unknown as Injector;
    return { force: await CBTForce.deserialize(record, data, injector), instanceId };
}
