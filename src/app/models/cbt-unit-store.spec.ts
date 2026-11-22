// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentInteractionRegistry } from '../services/equipment-interaction-registry.service';
import { CBTUnitStore } from './cbt-unit-store';
import { BoobyTrapHandler } from './runtime/component-booby-trap';
import type { SerializedCBTForceV2 } from './runtime/persistence-v2';
import { createDirectBoobyTrapRuntimeFixture, emptyCBTEncounterSnapshot } from './runtime/testing/direct-mek-runtime-fixture';
import type { CBTUnitService } from '../services/cbt-unit.service';
import { asUnitUuid, makeUnitFileName } from '../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET } from './cbt-ruleset.model';
import { asComponentId } from './entity/entity-identifiers';
import { TestInfantryEntity, TestTankEntity } from './entity/testing/test-entities';
import { createTestEquipmentRegistry } from './entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from './entity/types';
import { MiscEquipment } from './equipment.model';
import { createNonMekUnit, restoreNonMekUnit } from './runtime/cbt-non-mek-unit';
import { CBT_HISTORY_FIELD, CBT_HISTORY_TURN_FIELD } from './runtime/force-storage-vocabulary';
import type { SerializedNonMekUnit } from './runtime/non-mek-unit-persistence';
import { asForceId, emptyRuntimeHistory } from './runtime/persistence-v2';
import { RUNTIME_HISTORY_MESSAGE } from './runtime/runtime-history';
import { asSourceHashCanary } from './source-hash-canary';
import { prepareCBTForcePersistenceV2 } from './runtime/force-persistence-boundary';

describe('legacy passenger accommodation', () => {
    const carrierId = 'unit:carrier';
    const passengerId = 'unit:platoon';
    const scenario = { id: 'megamek', ruleset: 'total-warfare' } as const;
    const load = { bay: 'hold', unitId: passengerId, tons: 2 };
    const cargo = { bay: 'hold', cargo: 'supplies', tons: 1 };

    function fixture() {
        const carrier = new TestTankEntity();
        carrier.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e4'));
        carrier.setTonnage(20);
        carrier.transporters.set([{ id: 'hold', kind: 'bay', doors: 1, capacity: 3, bayNumber: 1,
            configuration: { type: 'cargo' }, omni: false }]);
        const infantry = new TestInfantryEntity();
        infantry.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e5'));
        infantry.chassis.set('Foot Platoon');
        infantry.model.set('(LRM)');
        infantry.squadSize.set(5);
        infantry.squadCount.set(4);
        const designs = new Map<string, TestTankEntity | TestInfantryEntity>([[carrierId, carrier], [passengerId, infantry]]);
        const create = (instanceId: string) => {
            const entity = designs.get(instanceId)!;
            return createNonMekUnit(entity, { instanceId, uuid: entity.uuid()!, deployment: { id: 'default' },
                scenario, initialStateProfileId: 'pristine' });
        };
        const envelope = (ids: readonly string[]): SerializedCBTForceV2 => ({
            forceId: asForceId('force:passengers'), forceRevision: 0, history: emptyRuntimeHistory(), encounter: { networks: [] },
            roster: { groups: [{ groupId: 'group:carriers', name: 'Cargo', order: 0,
                members: ids.map((instanceId, order) => ({ instanceId, order })) }] },
            units: ids.map(instanceId => {
                const saved = create(instanceId).serialize();
                return { instanceId, stateRevision: saved.stateRevision,
                    unit: instanceId === carrierId ? { ...saved, internalBayLoads: [load] } : saved };
            }),
        });
        const cbtUnits = { restore: async (saved: SerializedNonMekUnit) => ({
            unit: restoreNonMekUnit(saved, designs.get(saved.instanceId)!, saved.entity, scenario), warnings: [],
        }) } as unknown as CBTUnitService;
        return { create, envelope, cbtUnits };
    }

    for (const ids of [[carrierId, passengerId], [passengerId, carrierId]]) {
        it('restores saved design tons and occupied spaces when loading ' + ids[0] + ' first', async () => {
            const { envelope, cbtUnits } = fixture();
            const store = new CBTUnitStore();
            const restored = await store.restore(envelope(ids), cbtUnits, scenario);
            expect(restored.warnings).toEqual([]);
            store.install(restored);
            const carrier = store.nonMekUnit(carrierId)!;
            expect(carrier.snapshot().internalBayLoads).toEqual([{ ...load, spaces: 3 }]);
            expect((restored.envelope.units.find(entry => entry.instanceId === carrierId)!.unit as SerializedNonMekUnit)
                .internalBayLoads).toEqual([{ ...load, spaces: 3 }]);
            expect(carrier.revision()).toBe(0);
            expect(store.dispatchUnitCommand(carrierId, { type: 'set-internal-bay-loads', loads: [load, cargo] }, false).changed).toBeFalse();
        });
    }

    it('retains an orphan for unloading and restores its occupancy if the passenger joins later', async () => {
        const { create, envelope, cbtUnits } = fixture();
        const store = new CBTUnitStore();
        const restored = await store.restore(envelope([carrierId]), cbtUnits, scenario);
        store.install(restored);
        const carrier = store.nonMekUnit(carrierId)!;
        expect(carrier.snapshot().internalBayLoads).toEqual([load]);
        const removed = store.dispatchUnitCommand(carrierId, { type: 'set-internal-bay-loads', loads: [] }, false);
        expect(removed.changed).toBeTrue();

        store.install(await store.restore(envelope([carrierId]), cbtUnits, scenario));
        store.add(envelope([carrierId, passengerId]), create(passengerId), scenario);
        const linked = store.nonMekUnit(carrierId)!;
        expect(linked.snapshot().internalBayLoads).toEqual([{ ...load, spaces: 3 }]);
        expect(linked.revision()).toBeGreaterThan(0);
        const saved = await prepareCBTForcePersistenceV2({ previous: store.envelope()!, liveUnits: store.liveUnits() });
        if (saved.kind !== 'writable') throw new Error('Expected the hydrated manifest to be writable');
        const entry = saved.envelope.units.find(row => row.instanceId === carrierId)!;
        expect((entry.unit as SerializedNonMekUnit).internalBayLoads).toEqual([{ ...load, spaces: 3 }]);
        expect(store.dispatchUnitCommand(carrierId, { type: 'set-internal-bay-loads', loads: [load, cargo] }, false).changed).toBeFalse();
    });
});

describe('a unit whose source changed at the unit store', () => {
    it('loses only its own C3 endpoints and the history naming its equipment', async () => {
        const c3 = new MiscEquipment({ id: 'TestC3i', name: 'C3i Computer', type: 'misc', flags: ['F_C3I'] });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [c3.id]: c3 }));
        const componentId = asComponentId('c3i');
        entity.setEquipment([new EntityMountedEquipment({
            mountId: componentId, equipmentId: c3.id, equipment: c3, allocation: { kind: 'location', location: 'Front' },
            rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
        })]);
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e4');
        entity.uuid.set(uuid);
        entity.setTonnage(20);
        const scenario = { id: 'megamek', ruleset: CORE_2026_RULESET } as const;
        const current = asSourceHashCanary('BBBB');
        const nativeSource = { file: makeUnitFileName(uuid, 'blk'), format: 'blk' as const, sourceHashCanary: current,
            bytes: new ArrayBuffer(0) };
        const ids = ['unit:a', 'unit:b', 'unit:c', 'unit:d'];
        // Unit A was saved against an older source.
        const units = ids.map(instanceId => {
            const unit = createNonMekUnit(entity, { instanceId, uuid, deployment: { id: 'default' }, scenario,
                initialStateProfileId: 'pristine-non-mek' }, nativeSource).serialize();
            const saved = { ...unit, sourceHashCanary: instanceId === 'unit:a' ? asSourceHashCanary('AAAA') : current };
            return { instanceId, stateRevision: unit.stateRevision, unit: saved };
        });
        const network = (id: string, first: string, second: string) => ({ id, networkType: 'c3i' as const, color: '#1565C0',
            endpoints: [first, second].map(instanceId => ({ instanceId, componentId, role: 'peer' as const })) });
        const destroyed = (unit: number) =>
            [RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS, unit, `c:${componentId}`, 'destroyed', 'committed'] as const;
        const damaged = [RUNTIME_HISTORY_MESSAGE.DAMAGE_INTERNAL, 0, 'i:front', 1, 'committed'] as const;
        const envelope: SerializedCBTForceV2 = {
            forceId: asForceId('force:source-change'), forceRevision: 0,
            history: { [CBT_HISTORY_FIELD.unitIds]: ids, [CBT_HISTORY_FIELD.turns]: [{
                [CBT_HISTORY_TURN_FIELD.turnNumber]: 1,
                [CBT_HISTORY_TURN_FIELD.phases]: [[destroyed(0), damaged, destroyed(2)]],
            }] },
            units,
            roster: { groups: [{ groupId: 'group:source-change', order: 0, name: 'Vehicles',
                members: ids.map((instanceId, order) => ({ instanceId, order })) }] },
            encounter: { networks: [network('network:ab', 'unit:a', 'unit:b'), network('network:cd', 'unit:c', 'unit:d')] },
        };
        const cbtUnits = {
            restore: (saved: SerializedNonMekUnit, rules: typeof scenario) => Promise.resolve({
                unit: restoreNonMekUnit(saved, entity, uuid, rules, nativeSource), warnings: [],
            }),
        } as unknown as CBTUnitService;

        const restored = await new CBTUnitStore().restore(envelope, cbtUnits, scenario);

        // Unit A's computer may now be other equipment: its network goes, the other one stays and nothing is reported.
        expect(restored.envelope.encounter.networks.map(candidate => candidate.id)).toEqual(['network:cd']);
        expect(restored.warnings).toEqual([]);
        const phases: unknown = restored.envelope.history[CBT_HISTORY_FIELD.turns][0]![CBT_HISTORY_TURN_FIELD.phases];
        expect(phases).toEqual([[
            [RUNTIME_HISTORY_MESSAGE.EQUIPMENT_CHANGED, 0], damaged, destroyed(2),
        ]]);
    });
});

describe('equipment confirmation authority at the unit store', () => {
    for (const change of ['read-only', 'replacement', 'state', 'retirement'] as const) {
        it(`rejects detonation after ${change} changes during confirmation without mutating either owner`, async () => {
            const setup = confirmationFixture();
            const before = setup.runtime.snapshot();
            const pending = setup.select();
            const replacement = createDirectBoobyTrapRuntimeFixture().instance;
            if (change === 'read-only') setup.readOnly = true;
            if (change === 'replacement') setup.units.set(setup.runtime.instanceId, replacement);
            if (change === 'state') setup.runtime.dispatch({ type: 'set-heat', heat: 3 });
            if (change === 'retirement') setup.ownerCurrent = false;
            const expectedState = setup.runtime.snapshot();
            setup.confirm(true);

            expect(await pending).toEqual({ accepted: false, changed: false,
                reason: change === 'read-only' ? 'READ_ONLY' : 'OWNER_CHANGED' });
            expect(setup.runtime.snapshot()).toBe(expectedState);
            if (change !== 'state') expect(expectedState).toBe(before);
            expect(setup.runtime.query().destroyed()).toBeFalse();
            expect(replacement.query().destroyed()).toBeFalse();
            expect(setup.publish).not.toHaveBeenCalled();
            expect(setup.dialogs.showNoticeHtml).not.toHaveBeenCalled();
        });
    }

    for (const failNotice of [false, true]) {
        it(`publishes a valid detonation before its notice ${failNotice ? 'fails' : 'finishes'}`, async () => {
            const setup = confirmationFixture();
            let closeNotice!: () => void;
            let fail!: (reason: Error) => void;
            setup.dialogs.showNoticeHtml.and.returnValue(new Promise<void>((resolve, reject) => {
                closeNotice = resolve;
                fail = reject;
            }));
            const pending = setup.select();
            setup.confirm(true);
            await Promise.resolve();

            expect(setup.runtime.query().destroyed()).toBeTrue();
            expect(setup.publish).toHaveBeenCalledTimes(1);
            const committed = setup.runtime.snapshot();
            setup.runtime.dispatch({ type: 'set-heat', heat: 3 });
            setup.readOnly = true;
            if (failNotice) fail(new Error('notice failed'));
            else closeNotice();

            expect(await pending).toEqual({ accepted: true, changed: true,
                context: { owner: setup.runtime, state: committed } });
            expect(setup.publish).toHaveBeenCalledTimes(1);
        });
    }

    it('leaves cancellation unchanged and unpublished', async () => {
        const setup = confirmationFixture();
        const before = setup.runtime.snapshot();
        const pending = setup.select();
        setup.confirm(false);
        expect(await pending).toEqual({ accepted: true, changed: false,
            context: { owner: setup.runtime, state: before } });
        expect(setup.runtime.snapshot()).toBe(before);
        expect(setup.publish).not.toHaveBeenCalled();
    });

    it('does not publish an unrelated edit when a stale confirmation is cancelled', async () => {
        const setup = confirmationFixture();
        const pending = setup.select();
        setup.runtime.dispatch({ type: 'set-heat', heat: 3 });
        const edited = setup.runtime.snapshot();
        setup.confirm(false);
        expect(await pending).toEqual({ accepted: false, changed: false, reason: 'OWNER_CHANGED' });
        expect(setup.runtime.snapshot()).toBe(edited);
        expect(setup.publish).not.toHaveBeenCalled();
    });
});

function confirmationFixture() {
    const fixture = createDirectBoobyTrapRuntimeFixture();
    const runtime = fixture.instance;
    const units = new Map([[runtime.instanceId, runtime]]);
    const store = new CBTUnitStore();
    const envelope = {} as SerializedCBTForceV2;
    store.install({ envelope, binding: { envelope, units, scenarioRules: { id: 'test' } }, warnings: [] });
    const registry = new EquipmentInteractionRegistry();
    registry.register(new BoobyTrapHandler());
    let confirm!: (accepted: boolean) => void;
    const dialogs = {
        requestConfirmation: jasmine.createSpy('requestConfirmation').and.callFake(() =>
            new Promise<boolean>(resolve => confirm = resolve)),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
    };
    const choice = store.equipmentInteractions(runtime.instanceId, registry, {}, emptyCBTEncounterSnapshot, false)[0]!.choices[0]!.command;
    const setup = {
        runtime, units, dialogs,
        readOnly: false,
        ownerCurrent: true,
        publish: jasmine.createSpy('publishChanged'),
        confirm: (accepted: boolean) => confirm(accepted),
        select: () => store.dispatchEquipmentChoice(choice, registry, {}, {
            dialogsService: dialogs, toastService: { showToast: jasmine.createSpy('showToast') },
        }, emptyCBTEncounterSnapshot, () => setup.readOnly, () => setup.ownerCurrent, setup.publish),
    };
    return setup;
}
