// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { SerializedClassicForce, SerializedForce } from '../force-serialization';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    emptyRuntimeHistory,
    type SerializedCBTForceV2,
    type SerializedCBTUnitV2,
    validateSerializedCBTForceV2,
} from './persistence-v2';
import { ReadyMekUnit, ReadyMekUnitFactory } from './ready-unit-factory';
import { ReadyNonMekUnit } from './ready-non-mek-unit';
import { isSerializedNonMekUnit, type SerializedNonMekUnit } from './non-mek-unit-persistence';
import { asCommandId, asStateRevision, asUnitInstanceId } from './runtime-state';
import {
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';
import { TestAeroSpaceFighterEntity, TestTankEntity } from '../entity/testing/test-entities';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import {
    decodeForceFromStorage,
    encodeForceForStorage,
} from './force-storage-codec';
import { RUNTIME_HISTORY_MESSAGE } from './runtime-history';
import {
    DEFAULT_FORCE_DEPLOYMENT_ID,
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    UNIT_STATE_INITIALIZER_REVISION,
} from './unit-state-initializer';

describe('compact force storage codec', () => {
    it('restores sparse state while rebuilding omitted Entity references at load', async () => {
        const force = damagedForce();
        const stored = encodeForceForStorage(force);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));

        const originalEntry = force.cbt!.units[0]!;
        const decodedEntry = decoded.cbt!.units[0]!;
        if (originalEntry.kind !== 'ready' || decodedEntry.kind !== 'ready') {
            throw new Error('Fixture must contain one ready unit');
        }
        const originalUnit = originalEntry.unit as SerializedCBTUnitV2;
        const decodedUnit = decodedEntry.unit as SerializedCBTUnitV2;
        expect(decodedUnit.locationState).toEqual(originalUnit.locationState);
        expect(decodedUnit.blueprintReferences.targets).toEqual({});
        await expectAsync(validateSerializedCBTForceV2(decoded.cbt)).toBeResolved();

        const fixture = createDirectMekRuntimeFixture();
        const restored = await new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: 1,
                profileId: 'pristine',
                deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        }).restoreFromEntity(decodedUnit, fixture.entity, fixture.identity);
        expect(restored.serialize().locationState).toEqual(originalUnit.locationState);
        expect(Object.keys(restored.serialize().blueprintReferences.targets).length).toBeGreaterThan(0);

        const compact = stored['cbt'] as Record<string, unknown>;
        expect(compact['schemaVersion']).toBeUndefined();
        expect(compact['minimumWriterVersion']).toBeUndefined();
        expect(compact['forceId']).toBeUndefined();
        expect(compact['history']).toBeUndefined();
        expect(compact['encounter']).toBeUndefined();

        const unit = (compact['u'] as Record<string, unknown>[])[0]!;
        expect(unit['q']).toBeUndefined();
        expect(unit['baselineRefAtSave']).toBeUndefined();
        expect(unit['blueprintReferences']).toBeUndefined();
        expect(unit['family']).toBeUndefined();
        expect(unit['movementPsr']).toBeUndefined();
        expect(unit['attackerTargeting']).toBeUndefined();
        expect(((unit['l'] as unknown[][])[0]![0] as string)).toMatch(/^[fr]:[a-z]+$/u);
        expect(((unit['s'] as unknown[][])[0]![0] as string)).toMatch(/^s:/u);
        expect(JSON.stringify(unit)).not.toMatch(/(?:location|armor|slot|critical|mek):/u);
        expect(byteLength(stored)).toBeLessThan(byteLength(force) * 0.55);
    });

    it('passes the sole supported production V1 input through untouched', () => {
        const legacy: SerializedForce = {
            version: 1,
            timestamp: '2026-08-23T00:00:00.000Z',
            instanceId: 'force:v1',
            type: GameSystem.CLASSIC,
            name: 'Legacy',
            groups: [],
        };
        expect(decodeForceFromStorage(encodeForceForStorage(legacy))).toEqual(legacy);
    });

    it('stores committed and pending Modular Armor damage in compact component rows', () => {
        const fixture = createDirectModularArmorRuntimeFixture();
        const panel = [...fixture.index.components.values()].find(component =>
            component.kind === 'equipment'
            && component.mount.equipment?.hasFlag('F_MODULAR_ARMOR') === true)!;
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(panel.id))!;
        const face = [...fixture.index.armorFaces.values()].find(candidate =>
            candidate.locationId === slot.locationId && candidate.face === 'front')!;
        expect(fixture.instance.dispatch({
            type: 'damage-armor', commandId: asCommandId('storage:modular:committed'),
            expectedRevision: fixture.instance.query().stateRevision,
            faceId: face.id, amount: 6, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'damage-armor', commandId: asCommandId('storage:modular:pending'),
            expectedRevision: fixture.instance.query().stateRevision,
            faceId: face.id, amount: 3, target: 'pending',
        }).accepted).toBeTrue();
        const ready = new ReadyMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );
        const unit = ready.serialize();
        const force = forceWithUnit(unit, 'force:compact-modular', 'Compact Modular Armor');
        const stored = encodeForceForStorage(force);
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect((compactUnit['c'] as unknown[][]).some(row =>
            (row[1] as Record<string, unknown>)['r'] === 6)).toBeTrue();
        expect((compactUnit['p'] as Record<string, unknown>)['m']).toEqual(jasmine.any(Array));

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (entry.kind !== 'ready' || isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Compact Modular Armor fixture did not decode as a Mek');
        }
        expect(entry.unit.componentState?.some(row => row.modularArmorDamage === 6)).toBeTrue();
        expect(entry.unit.pendingCombat?.modularArmorDamage?.[0]?.damage).toBe(3);
    });

    it('round-trips current compact history through the IndexedDB record', () => {
        const source = damagedForce();
        const instanceId = source.cbt!.units[0]!.instanceId;
        const history = {
            u: [instanceId],
            t: [{
                n: 7,
                p: [[[
                    RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
                    0,
                    'f:la',
                    2,
                    'pending',
                ]]],
            }],
        } as const;
        const force: SerializedClassicForce = {
            ...source,
            cbt: { ...source.cbt!, history },
        };

        const stored = encodeForceForStorage(force);
        expect((stored['cbt'] as Record<string, unknown>)['h']).toEqual(history);
        expect(decodeForceFromStorage(JSON.parse(JSON.stringify(stored))).cbt!.history).toEqual(history);
    });

    it('stores production defaults implicitly and roster membership by unit index', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        }).createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:implicit-defaults'),
        }, fixture.entity, fixture.identity);
        const force = forceWithUnit(ready.serialize(), 'force:implicit-defaults', 'Implicit defaults');
        const stored = encodeForceForStorage(force);
        const compact = stored['cbt'] as Record<string, unknown>;
        const unit = (compact['u'] as Record<string, unknown>[])[0]!;
        const identity = unit['e'] as Record<string, unknown>;

        expect(unit['b']).toBeUndefined();
        expect(unit['d']).toBeUndefined();
        expect(unit['r']).toBeUndefined();
        expect(identity['p']).toBeUndefined();
        expect(identity['o']).toBeUndefined();
        expect(identity['f']).toBeUndefined();
        expect(((compact['g'] as unknown[][])[0]![1] as unknown[][])[0]).toEqual([0]);
        expect(byteLength(stored)).toBeLessThan(400);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        await expectAsync(validateSerializedCBTForceV2(decoded.cbt)).toBeResolved();
        const entry = decoded.cbt!.units[0]!;
        if (entry.kind !== 'ready' || isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Implicit-default fixture did not decode as a ready Mek');
        }
        expect(entry.unit.deployment.values.crewAssignment.positions).toEqual([]);
        const restored = await new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment: entry.unit.deployment.values,
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        }).restoreFromEntity(entry.unit, fixture.entity, fixture.identity);
        expect(restored.getCrewAssignment()).toEqual(ready.getCrewAssignment());
    });

    it('stores Mek row order as a compact integer permutation', async () => {
        const fixture = createDirectMekRuntimeFixture();
        expect(fixture.instance.setEquipmentRowOrder(
            fixture.instance.revision(),
            'ranged',
            [1, 0],
            2,
            false,
        )).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const ready = new ReadyMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );
        const unit = ready.serialize();
        const stored = encodeForceForStorage(forceWithUnit(
            unit,
            'force:row-order',
            'Row order',
        ));
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;

        expect(compactUnit['y']).toEqual({ r: [1, 0] });
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (entry.kind !== 'ready' || isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Row-order fixture did not decode as a ready Mek');
        }
        expect(entry.unit.equipmentRowOrder).toEqual({ ranged: [1, 0] });
        const restored = await new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: 1,
                profileId: 'pristine',
                deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        }).restoreFromEntity(entry.unit, fixture.entity, fixture.identity);
        expect(restored.getInstance().snapshot().equipmentRowOrder).toEqual({ ranged: [1, 0] });
    });

    it('round-trips formation target groups under one compact metadata key', () => {
        const source = damagedForce();
        const sourceGroup = source.cbt.roster.groups[0];
        const force: SerializedClassicForce = {
            ...source,
            cbt: {
                ...source.cbt,
                roster: {
                    schemaVersion: 1,
                    groups: [
                        { ...sourceGroup, formationTargetGroupId: 'group:target' },
                        { groupId: 'group:target', order: 1, members: [] },
                    ],
                },
            },
        };

        const stored = encodeForceForStorage(force);
        const compactGroups = (stored['cbt'] as Record<string, unknown>)['g'] as unknown[][];
        expect((compactGroups[0][2] as Record<string, unknown>)['t']).toBe(1);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        expect(decoded.cbt!.roster.groups[0].formationTargetGroupId).toBe('group:target');
    });

    it('round-trips non-Mek damage and ordered damage-track timestamps', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
        entity.uuid.set(uuid);
        entity.setTonnage(20);
        entity.originalWalkMP.set(8);
        entity.setArmorValue(entity.locationOrder[0], 'front', 5);
        const identity = Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid,
            sourceFormat: 'blk' as const,
        });
        const ready = ReadyNonMekUnit.create(entity, {
            instanceId: asUnitInstanceId('unit:compact-tank'),
            identity,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const runtime = ready.getInstance();
        const faceId = [...ready.getIndex().armorFaces.keys()][0]!;
        const damageTrackId = [...ready.getIndex().damageTracks.keys()][0]!;
        const crewPositionId = [...ready.getIndex().crewPositions.keys()][0]!;
        expect(runtime.dispatch({
            kind: 'damage-armor', expectedRevision: runtime.revision(), faceId,
            amount: 2, target: 'committed',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'damage-track', expectedRevision: runtime.revision(), damageTrackId,
            amount: 1, target: 'pending', timestamp: 17,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-movement', expectedRevision: runtime.revision(),
            movement: { mode: 'run', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-crew-state', expectedRevision: runtime.revision(), positionId: crewPositionId,
            wounds: 0, unconscious: false, ejected: false, state: 'stunned',
        }).accepted).toBeTrue();
        expect(runtime.setEquipmentRowOrder(
            runtime.revision(), 'physical', [1, 0], 2, false,
        ).accepted).toBeTrue();

        const unit = ready.serialize();
        const force = forceWithUnit(unit, 'force:compact-tank', 'Compact tank');
        const stored = encodeForceForStorage(force);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (entry.kind !== 'ready' || !isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Compact non-Mek fixture did not decode as a ready non-Mek unit');
        }
        expect(entry.unit.family.kind).toBe('non-mek');
        expect(entry.unit).toEqual(unit);
        expect(ReadyNonMekUnit.restore(entry.unit, entity, identity).serialize()).toEqual(unit);
        expect(entry.unit.pendingCombat?.damageTrackHits?.[0]?.hitTimestamps).toEqual([17]);

        const compact = stored['cbt'] as Record<string, unknown>;
        const compactUnit = (compact['u'] as Record<string, unknown>[])[0]!;
        expect(compactUnit['baselineRefAtSave']).toBeUndefined();
        expect(compactUnit['attackerTargeting']).toBeUndefined();
        expect(compactUnit['q']).toBeUndefined();
        expect(compactUnit['p']).toBeDefined();
        expect(compactUnit['w']).toEqual([[crewPositionId, 0, 4]]);
        expect(compactUnit['v']).toEqual([0, 0, ['run', 5]]);
        expect(compactUnit['y']).toEqual({ p: [1, 0] });
    });

    it('omits pristine non-Mek heat and stores only changed aerospace heat fields', () => {
        const entity = new TestAeroSpaceFighterEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e3');
        entity.uuid.set(uuid);
        entity.heatSinkCount.set(10);
        const identity = Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid,
            sourceFormat: 'blk' as const,
        });
        const ready = ReadyNonMekUnit.create(entity, {
            instanceId: asUnitInstanceId('unit:compact-aero-heat'),
            identity,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const pristine = encodeForceForStorage(forceWithUnit(
            ready.serialize(),
            'force:compact-aero-pristine',
            'Compact pristine aero',
        ));
        expect(((pristine['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!['h'])
            .toBeUndefined();

        const runtime = ready.getInstance();
        runtime.dispatch({
            kind: 'set-heat',
            expectedRevision: runtime.revision(),
            heat: 19,
            target: 'pending',
        });
        runtime.dispatch({
            kind: 'set-heatsinks-off',
            expectedRevision: runtime.revision(),
            heatsinksOff: 2,
        });
        const unit = ready.serialize();
        const stored = encodeForceForStorage(forceWithUnit(
            unit,
            'force:compact-aero-heat',
            'Compact aero heat',
        ));
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect(compactUnit['h']).toEqual({ o: 19, s: 2 });

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (entry.kind !== 'ready' || !isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Compact Aero fixture did not decode as a ready Entity');
        }
        expect(entry.unit.heat).toEqual(unit.heat);
        expect(ReadyNonMekUnit.restore(entry.unit, entity, identity).serialize()).toEqual(unit);
    });

    it('rejects the superseded verbose development record', () => {
        const force = damagedForce();
        expect(() => decodeForceFromStorage(force)).toThrowError(/Unsupported intermediate/u);
    });
});

function damagedForce(): SerializedClassicForce {
    const fixture = createDirectMekRuntimeFixture();
    const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 2)!;
    expect(fixture.instance.dispatch({
        type: 'damage-armor',
        commandId: asCommandId('storage-size:armor'),
        expectedRevision: fixture.instance.query().stateRevision,
        faceId: face.id,
        amount: 2,
        target: 'committed',
    }).accepted).toBeTrue();
    const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.length > 0)!;
    expect(fixture.instance.dispatch({
        type: 'hit-critical',
        commandId: asCommandId('storage-size:slot'),
        expectedRevision: fixture.instance.query().stateRevision,
        slotId: slot.id,
        hits: 1,
        target: 'committed',
    }).accepted).toBeTrue();
    const ready = new ReadyMekUnit(
        fixture.entity,
        fixture.identity,
        fixture.instance,
        { schemaVersion: 2, values: fixture.initialized.deployment },
    );
    const unit = ready.serialize();
    return forceWithUnit(unit, 'force:compact-storage', 'Compact storage');
}

function forceWithUnit(
    unit: SerializedCBTUnitV2 | SerializedNonMekUnit,
    forceIdText: string,
    name: string,
): SerializedClassicForce {
    const forceId = asForceId(forceIdText);
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: unit.stateRevision,
        scenarioRules: { schemaVersion: 1, values: { id: 'megamek', ruleset: 'core-2026' } },
        history: emptyRuntimeHistory(),
        units: [{ kind: 'ready', instanceId: unit.instanceId, stateRevision: unit.stateRevision, unit }],
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: `group:${forceIdText}`,
                order: 0,
                members: [{ instanceId: unit.instanceId, kind: 'ready', order: 0 }],
            }],
        },
        encounter: {
            encounterRevision: asStateRevision(0),
            state: { schemaVersion: 2, encounterRevision: asStateRevision(0), facts: [] },
        },
    };
    return {
        version: 2,
        timestamp: '2026-08-23T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CLASSIC,
        name,
        cbt,
    };
}

function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}
