// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../crew.model';
import {
    CORE_2026_RULESET,
    isCBTRuleset,
    type CBTRuleset,
} from '../cbt-ruleset.model';
import type { SerializedForce } from '../force-serialization';
import type { DeferredUnitSource, JsonValue, SavedEntityIdentity } from '../persisted-unit-state';
import type {
    SavedAttackerTargetingState,
    SerializedCBTEncounterStateV2,
    SerializedCBTForceV2,
    SerializedCBTUnitV2,
    SerializedForceEncounterEntryV2,
    SerializedForceUnitEntryV2,
    SerializedUnitRestorationMetadataV2,
} from './persistence-v2';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
} from './persistence-v2';
import {
    CBT_FORCE_ROSTER_SCHEMA_VERSION,
    type SerializedCBTForceRosterV1,
} from './cbt-force-roster';
import {
    NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
    NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION,
    isSerializedNonMekUnit,
    type SerializedNonMekUnit,
} from './non-mek-unit-persistence';
import {
    DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
    DEFAULT_FORCE_DEPLOYMENT_ID,
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
    UNIT_STATE_INITIALIZER_REVISION,
} from './unit-state-initializer';
import { asStateRevision, asUnitInstanceId } from './runtime-state';
import type { SerializedMekMovementPsrStateV2 } from './mek-movement-psr-v2';
import type { SerializedMekTurnStateV2 } from './mek-turn-state-v2';
import {
    ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
    type SerializedAttackerTargetingState,
} from './attacker-targeting-state';
import { MM_DATA_UNIT_PROVIDER_ID } from '../../services/unit-catalog/unit-catalog.types';
import type { EquipmentRowOrderState } from './equipment-row-order';

/**
 * The sole current Classic storage wire. The domain snapshot deliberately keeps
 * descriptive names; IndexedDB and cloud transport do not repeat them hundreds
 * of times. Production V1 records pass through unchanged for the one-way loader.
 */
export type StoredForceRecord = Readonly<Record<string, unknown>>;

export function isCompactStoredForce(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const root = value as Record<string, unknown>;
    if (root['version'] !== 2 || root['type'] !== GameSystem.CLASSIC) return false;
    const cbt = root['cbt'];
    return cbt !== null && typeof cbt === 'object' && !Array.isArray(cbt)
        && !('schemaVersion' in cbt)
        && 'r' in cbt && 'u' in cbt && 'g' in cbt;
}

type CompactIdentity = Readonly<{
    o?: 0 | 1;
    p?: string;
    u: string;
    h?: string;
}>;

type CompactCrewPosition = readonly unknown[];
type CompactDeployment = readonly unknown[];

type CompactForce = Readonly<{
    r: number;
    s: JsonValue;
    u: readonly unknown[];
    g: readonly unknown[];
    h?: SerializedCBTForceV2['history'];
    e?: unknown;
    x?: SerializedCBTForceV2['restoration'];
}>;

const DEFERRED = 1;
const MEK = 'm';
const ENTITY = 'e';

export function encodeForceForStorage(force: SerializedForce): StoredForceRecord {
    const detached = clone(force) as unknown as Record<string, unknown>;
    if (force.version === 1 || force.type !== GameSystem.CLASSIC) return detached;
    if (force.version !== 2 || force.cbt === undefined) {
        throw new Error('Current Classic persistence requires a current CBT snapshot');
    }
    detached['cbt'] = packForce(force.cbt);
    return Object.freeze(detached);
}

export function decodeForceFromStorage(value: unknown): SerializedForce {
    const detached = clone(value);
    const root = record(detached, 'force');
    if (root['version'] === 1 || root['type'] !== GameSystem.CLASSIC) {
        return detached as unknown as SerializedForce;
    }
    if (root['version'] !== 2) throw new Error('Unsupported force persistence version');
    const compact = record(root['cbt'], 'force.cbt');
    if ('schemaVersion' in compact || !('r' in compact) || !('u' in compact) || !('g' in compact)) {
        throw new Error('Unsupported intermediate Classic persistence shape');
    }
    const instanceId = text(root['instanceId'], 'force.instanceId');
    root['cbt'] = unpackForce(compact, instanceId);
    return root as unknown as SerializedForce;
}

function packForce(force: SerializedCBTForceV2): CompactForce {
    const historyEmpty = force.history.u.length === 0 && force.history.t.length === 0;
    const encounterEmpty = force.encounter.encounterRevision === 0
        && force.encounter.state.facts.length === 0
        && force.encounter.recovery === undefined;
    const ruleset = rulesetFromScenario(force.scenarioRules.values);
    return Object.freeze({
        r: force.forceRevision,
        s: clone(force.scenarioRules.values),
        u: Object.freeze(force.units.map(entry => packUnitEntry(entry, ruleset))),
        g: packRoster(force.roster, force.units),
        ...(historyEmpty ? {} : { h: clone(force.history) }),
        ...(encounterEmpty ? {} : { e: packEncounter(force.encounter) }),
        ...(force.restoration === undefined ? {} : { x: clone(force.restoration) }),
    });
}

function unpackForce(value: Record<string, unknown>, forceId: string): SerializedCBTForceV2 {
    exactKeys(value, ['r', 's', 'u', 'g', 'h', 'e', 'x'], 'force.cbt');
    const revision = asStateRevision(integer(value['r'], 'force.cbt.r'));
    const scenario = clone(value['s']) as JsonValue;
    const ruleset = rulesetFromScenario(scenario);
    const units = array(value['u'], 'force.cbt.u').map((entry, index) =>
        unpackUnitEntry(entry, ruleset, `force.cbt.u[${index}]`));
    return {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId: asForceId(forceId),
        forceRevision: revision,
        scenarioRules: { schemaVersion: 1, values: scenario },
        history: value['h'] === undefined
            ? { u: [], t: [] }
            : clone(value['h']) as SerializedCBTForceV2['history'],
        units,
        roster: unpackRoster(value['g'], units),
        encounter: value['e'] === undefined
            ? emptyEncounter()
            : unpackEncounter(value['e'], 'force.cbt.e'),
        ...(value['x'] === undefined
            ? {}
            : { restoration: clone(value['x']) as SerializedCBTForceV2['restoration'] }),
    };
}

function packUnitEntry(entry: SerializedForceUnitEntryV2, ruleset: CBTRuleset): unknown {
    return entry.kind === 'ready'
        ? packUnit(entry.unit, ruleset)
        : Object.freeze([DEFERRED, entry.instanceId, entry.stateRevision, clone(entry.source)]);
}

function unpackUnitEntry(value: unknown, ruleset: CBTRuleset, path: string): SerializedForceUnitEntryV2 {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const unit = unpackUnit(value, ruleset, path);
        return {
            kind: 'ready',
            instanceId: unit.instanceId,
            stateRevision: unit.stateRevision,
            unit,
        };
    }
    const row = array(value, path);
    if (row[0] === DEFERRED && row.length === 4) {
        return {
            kind: 'deferred',
            instanceId: asUnitInstanceId(text(row[1], `${path}[1]`)),
            stateRevision: asStateRevision(integer(row[2], `${path}[2]`)),
            source: clone(row[3]) as DeferredUnitSource,
        };
    }
    throw new Error(`${path} is not a compact force-unit row`);
}

function packUnit(unit: SerializedCBTUnitV2 | SerializedNonMekUnit, ruleset: CBTRuleset): unknown {
    return isSerializedNonMekUnit(unit) ? packNonMekUnit(unit, ruleset) : packMekUnit(unit, ruleset);
}

function unpackUnit(value: unknown, ruleset: CBTRuleset, path: string): SerializedCBTUnitV2 | SerializedNonMekUnit {
    const compact = record(value, path);
    return compact['k'] === MEK
        ? unpackMekUnit(compact, ruleset, path)
        : compact['k'] === ENTITY
            ? unpackNonMekUnit(compact, ruleset, path)
            : fail(`${path}.k is not a current unit family`);
}

function packMekUnit(unit: SerializedCBTUnitV2, ruleset: CBTRuleset): unknown {
    assertUnitRuleset(unit, ruleset);
    const pristineHeat = unit.deployment.values.initialHeat ?? 0;
    const heatIsPristine = unit.heat?.heat === pristineHeat
        && unit.heat.previous === undefined
        && unit.heat.pendingOverride === undefined
        && unit.heat.heatsinksOff === undefined;
    return compactObject({
        k: MEK,
        i: unit.instanceId,
        e: packIdentity(unit.entity, 'mtf'),
        d: packDeployment(unit.deployment.values),
        r: unit.stateRevision === 0 ? undefined : unit.stateRevision,
        x: unit.destroyed ? 1 : undefined,
        l: packRows(unit.locationState, row => [row.target, row.damage]),
        n: packRows(unit.locationConditions, row => [row.target, row.condition, row.value]),
        s: packRows(unit.slotState, row => tuple(row.target, row.hits, row.destroyedTurn)),
        c: packRows(unit.componentState, packComponentState),
        a: packRows(unit.ammoState, row => tuple(row.target, row.shotsSpent, row.munitionOverride)),
        w: packRows(unit.crew.positions, row => [row.target, row.wounds, row.unconscious ? 1 : 0, row.ejected ? 1 : 0]),
        h: heatIsPristine ? undefined : packHeat(unit.heat),
        rC: unit.ruleChecks.entries.length === 0 ? undefined : unit.ruleChecks.entries.map(row => [
            row.key, row.token, row.trigger, row.openedRevision, row.status,
        ]),
        m: packMovement(unit.movementPsr),
        tA: packTargeting(unit.attackerTargeting),
        y: packEquipmentRowOrder(unit.equipmentRowOrder),
        o: unit.conditions?.values.length ? unit.conditions.values : undefined,
        t: packTurn(unit.turn),
        p: packPending(unit.pendingCombat),
        z: packDiagnostics(unit.restoration),
    });
}

function unpackMekUnit(value: Record<string, unknown>, ruleset: CBTRuleset, path: string): SerializedCBTUnitV2 {
    exactKeys(value, [
        'k', 'i', 'e', 'd', 'r', 'x', 'l', 'n', 's', 'c', 'a', 'w',
        'h', 'rC', 'm', 'tA', 'y', 'o', 't', 'p', 'z',
    ], path);
    const entity = unpackIdentity(value['e'], 'mtf', `${path}.e`);
    const baseline = defaultBaseline(
        entity, ruleset, UNIT_STATE_INITIALIZER_REVISION, DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    );
    const deployment = unpackDeployment(value['d'], `${path}.d`);
    const pristineHeat = deployment.values.initialHeat ?? 0;
    return {
        schemaVersion: CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: asUnitInstanceId(text(value['i'], `${path}.i`)),
        entity,
        baselineRefAtSave: baseline,
        // BaseEntity topology is rebuilt after the exact native source is loaded.
        // The storage wire never carries a copied blueprint reference catalog.
        blueprintReferences: { schemaVersion: 1, targets: {} },
        deployment,
        stateRevision: asStateRevision(value['r'] === undefined ? 0 : integer(value['r'], `${path}.r`)),
        ...(value['x'] === undefined ? {} : { destroyed: truthyOne(value['x'], `${path}.x`) }),
        ...(value['l'] === undefined ? {} : {
            locationState: unpackRows(value['l'], `${path}.l`, (row, rowPath) => ({
                target: rowText(row, 0, rowPath) as SerializedCBTUnitV2['locationState'] extends readonly (infer T)[] ? T extends { target: infer R } ? R : never : never,
                damage: rowInteger(row, 1, rowPath),
            })),
        }),
        ...(value['n'] === undefined ? {} : {
            locationConditions: unpackRows(value['n'], `${path}.n`, (row, rowPath) => ({
                target: rowText(row, 0, rowPath) as any,
                condition: rowText(row, 1, rowPath) as any,
                value: rowInteger(row, 2, rowPath),
            })),
        }),
        ...(value['s'] === undefined ? {} : {
            slotState: unpackRows(value['s'], `${path}.s`, (row, rowPath) => ({
                target: rowText(row, 0, rowPath) as any,
                hits: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { destroyedTurn: rowInteger(row, 2, rowPath) }),
            })),
        }),
        ...(value['c'] === undefined ? {} : {
            componentState: unpackRows(value['c'], `${path}.c`, unpackComponentState),
        }),
        ...(value['a'] === undefined ? {} : {
            ammoState: unpackRows(value['a'], `${path}.a`, (row, rowPath) => ({
                target: rowText(row, 0, rowPath) as any,
                shotsSpent: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { munitionOverride: rowText(row, 2, rowPath) }),
            })),
        }),
        crew: {
            schemaVersion: 1,
            positions: value['w'] === undefined ? [] : unpackRows(value['w'], `${path}.w`, (row, rowPath) => ({
                target: rowText(row, 0, rowPath) as any,
                wounds: rowInteger(row, 1, rowPath),
                unconscious: rowBit(row, 2, rowPath),
                ...(rowBit(row, 3, rowPath) ? { ejected: true as const } : {}),
            })),
        },
        heat: value['h'] === undefined
            ? { heat: pristineHeat }
            : unpackHeat(value['h'], `${path}.h`),
        family: { kind: 'mek' },
        ruleChecks: {
            schemaVersion: 1,
            entries: value['rC'] === undefined ? [] : unpackRows(value['rC'], `${path}.rC`, (row, rowPath) => ({
                key: rowText(row, 0, rowPath) as any,
                token: rowText(row, 1, rowPath) as any,
                trigger: rowText(row, 2, rowPath) as any,
                openedRevision: asStateRevision(rowInteger(row, 3, rowPath)),
                status: rowText(row, 4, rowPath) as any,
            })),
        },
        movementPsr: unpackMovement(value['m'], `${path}.m`),
        attackerTargeting: unpackSavedTargeting(value['tA'], `${path}.tA`),
        ...(value['y'] === undefined ? {} : {
            equipmentRowOrder: unpackEquipmentRowOrder(value['y'], `${path}.y`),
        }),
        ...(value['o'] === undefined ? {} : { conditions: { values: clone(value['o']) as string[] } }),
        turn: unpackTurn(value['t'], `${path}.t`),
        ...(value['p'] === undefined ? {} : { pendingCombat: unpackPending(value['p'], `${path}.p`) }),
        ...(value['z'] === undefined ? {} : {
            restoration: unpackDiagnostics(value['z'], baseline, `${path}.z`),
        }),
    };
}

function packNonMekUnit(unit: SerializedNonMekUnit, ruleset: CBTRuleset): unknown {
    assertUnitRuleset(unit, ruleset);
    return compactObject({
        k: ENTITY,
        t: unit.family.entityType,
        i: unit.instanceId,
        e: packIdentity(unit.entity, 'blk'),
        d: packDeployment(unit.deployment.values),
        r: unit.stateRevision === 0 ? undefined : unit.stateRevision,
        x: unit.destroyed ? 1 : undefined,
        l: packRows(unit.locationState, row => tuple(
            row.locationId,
            row.internalDamage ?? 0,
            row.armorDamage?.map(armor => [armor.faceId, armor.damage]),
        )),
        c: packRows(unit.componentState, row => [row.componentId, compactObject({
            s: row.status,
            m: row.mode,
            j: row.jammed ? 1 : undefined,
        })]),
        q: packRows(unit.damageTrackState, row => [row.damageTrackId, row.hits, row.hitTimestamps]),
        a: packRows(unit.ammoState, row => tuple(row.componentId, row.shotsSpent, row.munitionOverride)),
        w: packRows(unit.crewState, row => tuple(
            row.positionId,
            row.wounds,
            packedNonMekCrewState(row),
        )),
        o: unit.conditions?.length ? unit.conditions : undefined,
        h: packNonMekHeat(unit.heat),
        v: packNonMekTurn(unit.turn),
        tA: packDirectTargeting(unit.attackerTargeting),
        y: packEquipmentRowOrder(unit.equipmentRowOrder),
        p: packNonMekPending(unit.pendingCombat),
        z: unit.restoration === undefined ? undefined : compactObject({
            w: unit.restoration.warnings.length ? unit.restoration.warnings : undefined,
            u: unit.restoration.unresolved.length ? unit.restoration.unresolved : undefined,
        }),
    });
}

function unpackNonMekUnit(value: Record<string, unknown>, ruleset: CBTRuleset, path: string): SerializedNonMekUnit {
    exactKeys(value, ['k', 't', 'i', 'e', 'd', 'r', 'x', 'l', 'c', 'q', 'a', 'w', 'o', 'h', 'v', 'tA', 'y', 'p', 'z'], path);
    const entity = unpackIdentity(value['e'], 'blk', `${path}.e`);
    const baseline = defaultBaseline(entity, ruleset, 1, DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID);
    const deployment = unpackNonMekDeployment(value['d'], `${path}.d`);
    return {
        schemaVersion: NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: asUnitInstanceId(text(value['i'], `${path}.i`)),
        entity,
        baselineRefAtSave: baseline,
        deployment,
        family: { kind: 'non-mek', entityType: text(value['t'], `${path}.t`) as SerializedNonMekUnit['family']['entityType'] },
        stateRevision: asStateRevision(value['r'] === undefined ? 0 : integer(value['r'], `${path}.r`)),
        ...(value['x'] === undefined ? {} : { destroyed: truthyOne(value['x'], `${path}.x`) }),
        ...(value['l'] === undefined ? {} : {
            locationState: unpackRows(value['l'], `${path}.l`, (row, rowPath) => ({
                locationId: rowText(row, 0, rowPath) as any,
                ...(rowInteger(row, 1, rowPath) === 0 ? {} : { internalDamage: rowInteger(row, 1, rowPath) }),
                ...(row[2] === undefined ? {} : {
                    armorDamage: unpackRows(row[2], `${rowPath}[2]`, (armor, armorPath) => ({
                        faceId: rowText(armor, 0, armorPath) as any,
                        damage: rowInteger(armor, 1, armorPath),
                    })),
                }),
            })),
        }),
        ...(value['c'] === undefined ? {} : {
            componentState: unpackRows(value['c'], `${path}.c`, (row, rowPath) => {
                const state = record(row[1], `${rowPath}[1]`);
                exactKeys(state, ['s', 'm', 'j'], `${rowPath}[1]`);
                return {
                    componentId: rowText(row, 0, rowPath) as any,
                    ...(state['s'] === undefined ? {} : { status: text(state['s'], `${rowPath}[1].s`) as any }),
                    ...(state['m'] === undefined ? {} : { mode: text(state['m'], `${rowPath}[1].m`) }),
                    ...(state['j'] === undefined ? {} : { jammed: truthyOne(state['j'], `${rowPath}[1].j`) }),
                };
            }),
        }),
        ...(value['q'] === undefined ? {} : {
            damageTrackState: unpackRows(value['q'], `${path}.q`, (row, rowPath) => ({
                damageTrackId: rowText(row, 0, rowPath) as any,
                hits: rowInteger(row, 1, rowPath),
                hitTimestamps: clone(row[2]) as number[],
            })),
        }),
        ...(value['a'] === undefined ? {} : {
            ammoState: unpackRows(value['a'], `${path}.a`, (row, rowPath) => ({
                componentId: rowText(row, 0, rowPath) as any,
                shotsSpent: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { munitionOverride: rowText(row, 2, rowPath) }),
            })),
        }),
        ...(value['w'] === undefined ? {} : {
            crewState: unpackRows(value['w'], `${path}.w`, unpackNonMekCrewState),
        }),
        ...(value['o'] === undefined ? {} : { conditions: clone(value['o']) as string[] }),
        ...(value['h'] === undefined ? {} : { heat: unpackNonMekHeat(value['h'], `${path}.h`) }),
        ...(value['v'] === undefined ? {} : { turn: unpackNonMekTurn(value['v'], `${path}.v`) }),
        attackerTargeting: unpackDirectTargeting(value['tA'], `${path}.tA`),
        ...(value['y'] === undefined ? {} : {
            equipmentRowOrder: unpackEquipmentRowOrder(value['y'], `${path}.y`),
        }),
        ...(value['p'] === undefined ? {} : { pendingCombat: unpackNonMekPending(value['p'], `${path}.p`) }),
        ...(value['z'] === undefined ? {} : { restoration: unpackNonMekDiagnostics(value['z'], `${path}.z`) }),
    };
}

function packEquipmentRowOrder(value: EquipmentRowOrderState | undefined): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        r: value.ranged,
        p: value.physical,
    });
}

function unpackEquipmentRowOrder(value: unknown, path: string): EquipmentRowOrderState {
    const order = record(value, path);
    exactKeys(order, ['r', 'p'], path);
    const read = (key: 'r' | 'p'): readonly number[] | undefined => order[key] === undefined
        ? undefined
        : Object.freeze(array(order[key], `${path}.${key}`).map((entry, index) =>
            integer(entry, `${path}.${key}[${index}]`)));
    const ranged = read('r');
    const physical = read('p');
    return Object.freeze({
        ...(ranged === undefined ? {} : { ranged }),
        ...(physical === undefined ? {} : { physical }),
    });
}

function packNonMekTurn(value: SerializedNonMekUnit['turn']): unknown {
    if (value === undefined) return undefined;
    const movement = value.movement === undefined
        ? undefined
        : tuple(
            value.movement.mode,
            value.movement.distance,
            value.movement.boosterComponentIds.length
                ? value.movement.boosterComponentIds
                : undefined,
        );
    const airborne = value.airborne === undefined ? 0 : value.airborne ? 1 : -1;
    return tuple(
        value.turnCounter ?? 0,
        movement === undefined && airborne === 0 ? undefined : airborne,
        movement,
        value.weaponsHeat,
    );
}

function unpackNonMekTurn(value: unknown, path: string): NonNullable<SerializedNonMekUnit['turn']> {
    const turn = array(value, path);
    if (turn.length < 1 || turn.length > 4) throw new Error(`${path} is not a compact non-Mek turn`);
    const turnCounter = rowInteger(turn, 0, path);
    const airborneCode = turn[1] === undefined ? 0 : rowInteger(turn, 1, path);
    if (airborneCode !== -1 && airborneCode !== 0 && airborneCode !== 1) {
        throw new Error(`${path}[1] is not a non-Mek airborne state`);
    }
    const movement = turn[2] === undefined
        ? undefined
        : unpackNonMekMovement(turn[2], `${path}[2]`);
    return {
        ...(turnCounter === 0 ? {} : { turnCounter }),
        ...(airborneCode === 0 ? {} : { airborne: airborneCode === 1 }),
        ...(movement === undefined ? {} : { movement }),
        ...(turn[3] === undefined ? {} : { weaponsHeat: rowInteger(turn, 3, path) }),
    };
}

function unpackNonMekMovement(
    value: unknown,
    path: string,
): NonNullable<NonNullable<SerializedNonMekUnit['turn']>['movement']> {
    const movement = array(value, path);
    if (movement.length < 2 || movement.length > 3) {
        throw new Error(`${path} is not a compact non-Mek movement`);
    }
    const mode = rowText(movement, 0, path);
    if (mode !== 'stationary' && mode !== 'walk' && mode !== 'run'
        && mode !== 'jump' && mode !== 'UMU' && mode !== 'VTOL') {
        throw new Error(`${path}[0] is not a non-Mek movement mode`);
    }
    const boosterComponentIds = movement[2] === undefined
        ? []
        : array(movement[2], `${path}[2]`).map((id, index) =>
            text(id, `${path}[2][${index}]`) as any);
    return {
        mode,
        distance: rowInteger(movement, 1, path),
        boosterComponentIds,
    };
}

function packedNonMekCrewState(
    row: NonNullable<SerializedNonMekUnit['crewState']>[number],
): number | undefined {
    if (row.state === 'killed') return 3;
    if (row.state === 'stunned') return 4;
    if (row.ejected) return 2;
    return row.unconscious ? 1 : undefined;
}

function unpackNonMekCrewState(
    row: readonly unknown[],
    path: string,
): NonNullable<SerializedNonMekUnit['crewState']>[number] {
    if (row.length < 2 || row.length > 3) throw new Error(`${path} is not a compact non-Mek crew row`);
    const state = row[2] === undefined ? 0 : rowInteger(row, 2, path);
    if (state < 0 || state > 4) throw new Error(`${path}[2] is not a non-Mek crew state`);
    return {
        positionId: rowText(row, 0, path) as any,
        wounds: rowInteger(row, 1, path),
        unconscious: state === 1,
        ejected: state === 2,
        ...(state === 3 ? { state: 'killed' as const }
            : state === 4 ? { state: 'stunned' as const } : {}),
    };
}

function packIdentity(identity: SavedEntityIdentity, sourceFormat: 'mtf' | 'blk'): CompactIdentity {
    if (identity.sourceFormat !== undefined && identity.sourceFormat !== sourceFormat) {
        throw new Error(`A ${sourceFormat.toUpperCase()} unit cannot save a ${identity.sourceFormat.toUpperCase()} source`);
    }
    const provider = String(identity.provider);
    const inferredOrigin = provider === MM_DATA_UNIT_PROVIDER_ID ? 'megamek' : 'user';
    return compactObject({
        o: identity.origin === inferredOrigin ? undefined : identity.origin === 'megamek' ? 0 : 1,
        p: provider === MM_DATA_UNIT_PROVIDER_ID ? undefined : provider,
        u: identity.uuid,
        h: identity.sourceHashAtSave,
    }) as CompactIdentity;
}

function unpackIdentity(value: unknown, sourceFormat: 'mtf' | 'blk', path: string): SavedEntityIdentity {
    const identity = record(value, path);
    exactKeys(identity, ['o', 'p', 'u', 'h'], path);
    const provider = identity['p'] === undefined
        ? MM_DATA_UNIT_PROVIDER_ID
        : text(identity['p'], `${path}.p`) as SavedEntityIdentity['provider'];
    const inferredOrigin = provider === MM_DATA_UNIT_PROVIDER_ID ? 'megamek' : 'user';
    const origin = identity['o'] === undefined
        ? inferredOrigin
        : identity['o'] === 0 ? 'megamek' : identity['o'] === 1 ? 'user' : fail(`${path}.o is invalid`);
    return {
        origin,
        provider,
        uuid: text(identity['u'], `${path}.u`) as SavedEntityIdentity['uuid'],
        ...(identity['h'] === undefined ? {} : { sourceHashAtSave: text(identity['h'], `${path}.h`) as any }),
        sourceFormat,
    };
}

function assertUnitRuleset(
    unit: Pick<SerializedCBTUnitV2 | SerializedNonMekUnit, 'baselineRefAtSave'>,
    ruleset: CBTRuleset,
): void {
    if (unit.baselineRefAtSave.ruleset !== ruleset) {
        throw new Error('A unit baseline cannot use a different ruleset from its force');
    }
}

function defaultBaseline(
    entity: SavedEntityIdentity,
    ruleset: CBTRuleset,
    defaultRevision: number,
    defaultProfileId: string,
): SerializedCBTUnitV2['baselineRefAtSave'] {
    return {
        entity,
        ruleset,
        initialStateProfile: {
            schemaVersion: 1,
            initializerRevision: defaultRevision,
            profileId: defaultProfileId,
        },
    };
}

function packDeployment(values: { readonly id: string; readonly initialHeat?: number; readonly crewAssignment: { readonly positions: readonly { readonly positionId: string; readonly name: string; readonly role: string; readonly gunnery: number; readonly piloting: number }[] } }): CompactDeployment | undefined {
    const positions = values.crewAssignment.positions.map(packCrewPosition);
    const pristine = values.id === DEFAULT_FORCE_DEPLOYMENT_ID
        && values.initialHeat === undefined
        && positions.every(position => position.length === 1);
    if (pristine) return undefined;
    const metadata = compactObject({
        i: values.id === DEFAULT_FORCE_DEPLOYMENT_ID ? undefined : values.id,
        h: values.initialHeat,
    });
    return tuple(
        Object.freeze(positions),
        Object.keys(metadata).length === 0 ? undefined : metadata,
    );
}

function unpackDeployment(value: unknown, path: string): SerializedCBTUnitV2['deployment'] {
    const unpacked = unpackDeploymentValues(value, path);
    return {
        schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
        values: unpacked,
    };
}

function unpackNonMekDeployment(value: unknown, path: string): SerializedNonMekUnit['deployment'] {
    const unpacked = unpackDeploymentValues(value, path);
    if (unpacked.initialHeat !== undefined) throw new Error(`${path} cannot give a non-Mek initial heat`);
    return {
        schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
        values: {
            id: unpacked.id,
            crewAssignment: unpacked.crewAssignment,
        },
    };
}

function unpackDeploymentValues(value: unknown, path: string) {
    if (value === undefined) {
        return {
            id: DEFAULT_FORCE_DEPLOYMENT_ID,
            crewAssignment: { schemaVersion: 1 as const, positions: [] },
        };
    }
    const row = array(value, path);
    if (row.length < 1 || row.length > 2) throw new Error(`${path} is not a compact deployment`);
    const metadata = row[1] === undefined ? {} : record(row[1], `${path}[1]`);
    exactKeys(metadata, ['i', 'h'], `${path}[1]`);
    return {
        id: metadata['i'] === undefined ? DEFAULT_FORCE_DEPLOYMENT_ID : text(metadata['i'], `${path}[1].i`),
        ...(metadata['h'] === undefined ? {} : { initialHeat: integer(metadata['h'], `${path}[1].h`) }),
        crewAssignment: unpackCrewAssignment(row[0], `${path}[0]`),
    };
}

function packCrewPosition(position: {
    readonly positionId: string;
    readonly name: string;
    readonly role: string;
    readonly gunnery: number;
    readonly piloting: number;
}): CompactCrewPosition {
    if (position.name === '' && position.role === '') {
        return position.gunnery === DEFAULT_GUNNERY_SKILL
            && position.piloting === DEFAULT_PILOTING_SKILL
            ? Object.freeze([position.positionId])
            : Object.freeze([position.positionId, position.gunnery, position.piloting]);
    }
    return Object.freeze([
        position.positionId,
        position.gunnery,
        position.piloting,
        position.name,
        position.role,
    ]);
}

function unpackCrewAssignment(value: unknown, path: string) {
    return {
        schemaVersion: 1 as const,
        positions: unpackRows(value, path, (row, rowPath) => {
            if (row.length !== 1 && row.length !== 3 && row.length !== 5) {
                throw new Error(`${rowPath} is not a compact crew position`);
            }
            return {
                positionId: rowText(row, 0, rowPath) as any,
                name: row.length === 5 ? rowText(row, 3, rowPath) : '',
                role: row.length === 5 ? rowText(row, 4, rowPath) : '',
                gunnery: row.length === 1 ? DEFAULT_GUNNERY_SKILL : rowInteger(row, 1, rowPath),
                piloting: row.length === 1 ? DEFAULT_PILOTING_SKILL : rowInteger(row, 2, rowPath),
            };
        }),
    };
}

function packComponentState(row: NonNullable<SerializedCBTUnitV2['componentState']>[number]): unknown {
    return [row.target, compactObject({
        s: row.statusOverride,
        m: row.mode,
        j: row.jammed ? 1 : undefined,
        e: row.escalatingFailure && [row.escalatingFailure.sequence, row.escalatingFailure.active ? 1 : 0],
        p: row.ppcCapacitor && compactObject({
            w: row.ppcCapacitor.weaponId,
            c: row.ppcCapacitor.chargeState,
            f: row.ppcCapacitor.firedThisTurn ? 1 : undefined,
        }),
        b: row.bombastLaser && compactObject({
            c: row.bombastLaser.chargeState,
            f: row.bombastLaser.firedThisTurn ? 1 : undefined,
        }),
        c: row.c3EmergencyMaster && compactObject({
            m: row.c3EmergencyMaster.mode,
            t: row.c3EmergencyMaster.operatingTurns,
        }),
        g: row.gaussPower,
        h: row.shieldDamage && [row.shieldDamage.absorptionDamage, row.shieldDamage.capacityDamage],
        r: row.modularArmorDamage,
    })];
}

function unpackComponentState(row: readonly unknown[], path: string): NonNullable<SerializedCBTUnitV2['componentState']>[number] {
    const state = record(row[1], `${path}[1]`);
    exactKeys(state, ['s', 'm', 'j', 'e', 'p', 'b', 'c', 'g', 'h', 'r'], `${path}[1]`);
    const escalating = state['e'] === undefined ? undefined : array(state['e'], `${path}[1].e`);
    const ppc = state['p'] === undefined ? undefined : record(state['p'], `${path}[1].p`);
    const bombast = state['b'] === undefined ? undefined : record(state['b'], `${path}[1].b`);
    const emergency = state['c'] === undefined ? undefined : record(state['c'], `${path}[1].c`);
    const shield = state['h'] === undefined ? undefined : array(state['h'], `${path}[1].h`);
    return compactObject({
        target: rowText(row, 0, path) as any,
        statusOverride: optionalText(state['s'], `${path}[1].s`) as any,
        mode: optionalText(state['m'], `${path}[1].m`),
        jammed: state['j'] === undefined ? undefined : truthyOne(state['j'], `${path}[1].j`),
        escalatingFailure: escalating === undefined ? undefined : compactObject({
            sequence: rowInteger(escalating, 0, `${path}[1].e`),
            active: rowBit(escalating, 1, `${path}[1].e`) ? true : undefined,
        }),
        ppcCapacitor: ppc === undefined ? undefined : compactObject({
            weaponId: text(ppc['w'], `${path}[1].p.w`) as any,
            chargeState: optionalText(ppc['c'], `${path}[1].p.c`) as any,
            firedThisTurn: ppc['f'] === undefined ? undefined : truthyOne(ppc['f'], `${path}[1].p.f`),
        }),
        bombastLaser: bombast === undefined ? undefined : compactObject({
            chargeState: optionalText(bombast['c'], `${path}[1].b.c`) as any,
            firedThisTurn: bombast['f'] === undefined ? undefined : truthyOne(bombast['f'], `${path}[1].b.f`),
        }),
        c3EmergencyMaster: emergency === undefined ? undefined : compactObject({
            mode: optionalText(emergency['m'], `${path}[1].c.m`) as any,
            operatingTurns: optionalInteger(emergency['t'], `${path}[1].c.t`) as any,
        }),
        gaussPower: optionalText(state['g'], `${path}[1].g`) as any,
        shieldDamage: shield === undefined ? undefined : {
            absorptionDamage: rowInteger(shield, 0, `${path}[1].h`),
            capacityDamage: rowInteger(shield, 1, `${path}[1].h`),
        },
        modularArmorDamage: optionalInteger(state['r'], `${path}[1].r`),
    }) as unknown as NonNullable<SerializedCBTUnitV2['componentState']>[number];
}

function packHeat(value: SerializedCBTUnitV2['heat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({ c: value.heat, p: value.previous, o: value.pendingOverride, s: value.heatsinksOff });
}

function packNonMekHeat(value: SerializedNonMekUnit['heat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        c: value.current || undefined,
        p: value.previous || undefined,
        o: value.pendingOverride,
        s: value.heatsinksOff || undefined,
    });
}

function unpackNonMekHeat(
    value: unknown,
    path: string,
): NonNullable<SerializedNonMekUnit['heat']> {
    const heat = record(value, path);
    exactKeys(heat, ['c', 'p', 'o', 's'], path);
    return {
        current: optionalInteger(heat['c'], `${path}.c`) ?? 0,
        previous: optionalInteger(heat['p'], `${path}.p`) ?? 0,
        ...(heat['o'] === undefined
            ? {}
            : { pendingOverride: integer(heat['o'], `${path}.o`) }),
        heatsinksOff: optionalInteger(heat['s'], `${path}.s`) ?? 0,
    };
}

function unpackHeat(value: unknown, path: string): NonNullable<SerializedCBTUnitV2['heat']> {
    const heat = record(value, path);
    exactKeys(heat, ['c', 'p', 'o', 's'], path);
    return compactObject({
        heat: integer(heat['c'], `${path}.c`),
        previous: optionalInteger(heat['p'], `${path}.p`),
        pendingOverride: optionalInteger(heat['o'], `${path}.o`),
        heatsinksOff: optionalInteger(heat['s'], `${path}.s`),
    }) as NonNullable<SerializedCBTUnitV2['heat']>;
}

function packMovement(value: SerializedMekMovementPsrStateV2): unknown {
    const compact = compactObject({
        m: value.movement,
        a: value.action,
        s: value.standAttempts,
        c: value.carefulStand ? 1 : undefined,
        d: value.damageThisPhase,
        k: value.checks?.map(check => tuple(
            check.checkId,
            compactObject({
                s: check.source.sourceKind,
                t: check.source.triggerKind,
                w: check.source.witness,
                c: check.source.criticalSlotIds.length ? check.source.criticalSlotIds : undefined,
                l: check.source.locationIds.length ? check.source.locationIds : undefined,
                b: check.source.baseTarget,
                m: check.source.triggerModifier,
            }),
            check.producingRevision,
            check.ordinal,
            check.targetNumber,
            check.reason,
            check.status,
            check.resolution && [check.resolution.dice, check.resolution.total],
        )),
        f: value.automaticFalls,
    });
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function unpackMovement(value: unknown, path: string): SerializedMekMovementPsrStateV2 {
    if (value === undefined) return { schemaVersion: 2 };
    const movement = record(value, path);
    exactKeys(movement, ['m', 'a', 's', 'c', 'd', 'k', 'f'], path);
    return compactObject({
        schemaVersion: 2,
        movement: movement['m'] === undefined ? undefined : clone(movement['m']),
        action: movement['a'] === undefined ? undefined : clone(movement['a']),
        standAttempts: optionalInteger(movement['s'], `${path}.s`),
        carefulStand: movement['c'] === undefined ? undefined : truthyOne(movement['c'], `${path}.c`),
        damageThisPhase: optionalInteger(movement['d'], `${path}.d`),
        checks: movement['k'] === undefined ? undefined : unpackRows(movement['k'], `${path}.k`, (row, rowPath) => {
            const source = record(row[1], `${rowPath}[1]`);
            const resolution = row[7] === undefined ? undefined : array(row[7], `${rowPath}[7]`);
            return compactObject({
                checkId: rowText(row, 0, rowPath),
                source: {
                    sourceKind: text(source['s'], `${rowPath}[1].s`),
                    triggerKind: text(source['t'], `${rowPath}[1].t`),
                    witness: text(source['w'], `${rowPath}[1].w`),
                    criticalSlotIds: clone(source['c'] ?? []) as string[],
                    locationIds: clone(source['l'] ?? []) as string[],
                    baseTarget: integer(source['b'], `${rowPath}[1].b`),
                    triggerModifier: integer(source['m'], `${rowPath}[1].m`),
                },
                producingRevision: rowInteger(row, 2, rowPath),
                ordinal: rowInteger(row, 3, rowPath),
                targetNumber: rowInteger(row, 4, rowPath),
                reason: rowText(row, 5, rowPath),
                status: rowText(row, 6, rowPath),
                resolution: resolution === undefined ? undefined : {
                    dice: clone(resolution[0]), total: rowInteger(resolution, 1, `${rowPath}[7]`),
                },
            });
        }),
        automaticFalls: movement['f'] === undefined ? undefined : clone(movement['f']),
    }) as unknown as SerializedMekMovementPsrStateV2;
}

function packTurn(value: SerializedMekTurnStateV2): unknown {
    const compact = compactObject({
        n: value.turnCounter,
        a: value.airborne,
        c: value.cover,
        w: value.weaponsHeat,
        h: value.acknowledgedHeatSources?.map(row => [row.sourceId, row.signature]),
        d: value.heatDissipationConsumed,
        s: value.spotting ? 1 : undefined,
        e: value.equipmentStateChanged ? 1 : undefined,
    });
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function unpackTurn(value: unknown, path: string): SerializedMekTurnStateV2 {
    if (value === undefined) return { schemaVersion: 1 };
    const turn = record(value, path);
    exactKeys(turn, ['n', 'a', 'c', 'w', 'h', 'd', 's', 'e'], path);
    return compactObject({
        schemaVersion: 1,
        turnCounter: optionalInteger(turn['n'], `${path}.n`),
        airborne: turn['a'] as boolean | undefined,
        cover: turn['c'] === undefined ? undefined : clone(turn['c']),
        weaponsHeat: optionalInteger(turn['w'], `${path}.w`),
        acknowledgedHeatSources: turn['h'] === undefined ? undefined : unpackRows(turn['h'], `${path}.h`, (row, rowPath) => ({
            sourceId: rowText(row, 0, rowPath), signature: rowText(row, 1, rowPath),
        })),
        heatDissipationConsumed: optionalInteger(turn['d'], `${path}.d`),
        spotting: turn['s'] === undefined ? undefined : truthyOne(turn['s'], `${path}.s`),
        equipmentStateChanged: turn['e'] === undefined ? undefined : truthyOne(turn['e'], `${path}.e`),
    }) as SerializedMekTurnStateV2;
}

function packTargeting(value: SavedAttackerTargetingState): unknown {
    if (value.components.length === 0 && value.actions.length === 0 && value.targets.length === 0) return undefined;
    return compactObject({
        c: value.components.length ? value.components.map(row => [row.target, compactObject({
            s: row.selection,
            a: row.ammo,
        })]) : undefined,
        a: value.actions.length ? value.actions : undefined,
        t: value.targets.length ? value.targets : undefined,
    });
}

function unpackSavedTargeting(value: unknown, path: string): SavedAttackerTargetingState {
    if (value === undefined) return { schemaVersion: 1, components: [], actions: [], targets: [] };
    const targeting = record(value, path);
    exactKeys(targeting, ['c', 'a', 't'], path);
    return {
        schemaVersion: 1,
        components: targeting['c'] === undefined ? [] : unpackRows(targeting['c'], `${path}.c`, (row, rowPath) => {
            const state = record(row[1], `${rowPath}[1]`);
            exactKeys(state, ['s', 'a'], `${rowPath}[1]`);
            return compactObject({
                target: rowText(row, 0, rowPath) as any,
                selection: state['s'] === undefined ? undefined : clone(state['s']),
                ammo: state['a'] === undefined ? undefined : clone(state['a']),
            }) as any;
        }),
        actions: clone(targeting['a'] ?? []) as SavedAttackerTargetingState['actions'],
        targets: clone(targeting['t'] ?? []) as SavedAttackerTargetingState['targets'],
    };
}

function packDirectTargeting(value: SerializedAttackerTargetingState): unknown {
    if (value.components.length === 0 && value.actions.length === 0 && value.targets.length === 0) return undefined;
    return compactObject({
        c: value.components.length ? value.components.map(row => [row.componentId, compactObject({
            s: row.selection,
            a: row.ammo,
        })]) : undefined,
        a: value.actions.length ? value.actions : undefined,
        t: value.targets.length ? value.targets : undefined,
    });
}

function unpackDirectTargeting(value: unknown, path: string): SerializedAttackerTargetingState {
    if (value === undefined) return {
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: [], actions: [], targets: [],
    };
    const targeting = record(value, path);
    exactKeys(targeting, ['c', 'a', 't'], path);
    return {
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: targeting['c'] === undefined ? [] : unpackRows(targeting['c'], `${path}.c`, (row, rowPath) => {
            const state = record(row[1], `${rowPath}[1]`);
            exactKeys(state, ['s', 'a'], `${rowPath}[1]`);
            return compactObject({
                componentId: rowText(row, 0, rowPath) as any,
                selection: state['s'] === undefined ? undefined : clone(state['s']),
                ammo: state['a'] === undefined ? undefined : clone(state['a']),
            }) as any;
        }),
        actions: clone(targeting['a'] ?? []) as SerializedAttackerTargetingState['actions'],
        targets: clone(targeting['t'] ?? []) as SerializedAttackerTargetingState['targets'],
    };
}

function packPending(value: SerializedCBTUnitV2['pendingCombat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        l: packRows(value.locationDamage, row => [row.target, row.damage]),
        n: packRows(value.locationConditions, row => [row.target, row.condition, row.value]),
        s: packRows(value.slotHits, row => [row.target, row.hits]),
        c: packRows(value.componentStatus, row => [row.target, row.status]),
        h: packRows(value.shieldDamage, row => [row.target, row.absorptionDamage, row.capacityDamage]),
        m: packRows(value.modularArmorDamage, row => [row.target, row.damage]),
    });
}

function unpackPending(value: unknown, path: string): NonNullable<SerializedCBTUnitV2['pendingCombat']> {
    const pending = record(value, path);
    exactKeys(pending, ['l', 'n', 's', 'c', 'h', 'm'], path);
    return compactObject({
        locationDamage: pending['l'] === undefined ? undefined : unpackRows(pending['l'], `${path}.l`, (row, rowPath) => ({ target: rowText(row, 0, rowPath) as any, damage: rowInteger(row, 1, rowPath) })),
        locationConditions: pending['n'] === undefined ? undefined : unpackRows(pending['n'], `${path}.n`, (row, rowPath) => ({ target: rowText(row, 0, rowPath) as any, condition: rowText(row, 1, rowPath) as any, value: rowInteger(row, 2, rowPath) })),
        slotHits: pending['s'] === undefined ? undefined : unpackRows(pending['s'], `${path}.s`, (row, rowPath) => ({ target: rowText(row, 0, rowPath) as any, hits: rowInteger(row, 1, rowPath) })),
        componentStatus: pending['c'] === undefined ? undefined : unpackRows(pending['c'], `${path}.c`, (row, rowPath) => ({ target: rowText(row, 0, rowPath) as any, status: rowText(row, 1, rowPath) as any })),
        shieldDamage: pending['h'] === undefined ? undefined : unpackRows(pending['h'], `${path}.h`, (row, rowPath) => ({ target: rowText(row, 0, rowPath) as any, absorptionDamage: rowInteger(row, 1, rowPath), capacityDamage: rowInteger(row, 2, rowPath) })),
        modularArmorDamage: pending['m'] === undefined ? undefined : unpackRows(pending['m'], `${path}.m`, (row, rowPath) => ({ target: rowText(row, 0, rowPath) as any, damage: rowInteger(row, 1, rowPath) })),
    }) as NonNullable<SerializedCBTUnitV2['pendingCombat']>;
}

function packNonMekPending(value: SerializedNonMekUnit['pendingCombat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        l: packRows(value.internalDamage, row => [row.locationId, row.damage]),
        a: packRows(value.armorDamage, row => [row.faceId, row.damage]),
        c: packRows(value.componentStatus, row => [row.componentId, row.status]),
        q: packRows(value.damageTrackHits, row => [row.damageTrackId, row.hitDelta, row.hitTimestamps]),
    });
}

function unpackNonMekPending(value: unknown, path: string): NonNullable<SerializedNonMekUnit['pendingCombat']> {
    const pending = record(value, path);
    exactKeys(pending, ['l', 'a', 'c', 'q'], path);
    return compactObject({
        internalDamage: pending['l'] === undefined ? undefined : unpackRows(pending['l'], `${path}.l`, (row, rowPath) => ({ locationId: rowText(row, 0, rowPath) as any, damage: rowInteger(row, 1, rowPath) })),
        armorDamage: pending['a'] === undefined ? undefined : unpackRows(pending['a'], `${path}.a`, (row, rowPath) => ({ faceId: rowText(row, 0, rowPath) as any, damage: rowInteger(row, 1, rowPath) })),
        componentStatus: pending['c'] === undefined ? undefined : unpackRows(pending['c'], `${path}.c`, (row, rowPath) => ({ componentId: rowText(row, 0, rowPath) as any, status: rowText(row, 1, rowPath) as any })),
        damageTrackHits: pending['q'] === undefined ? undefined : unpackRows(pending['q'], `${path}.q`, (row, rowPath) => ({ damageTrackId: rowText(row, 0, rowPath) as any, hitDelta: rowInteger(row, 1, rowPath), hitTimestamps: clone(row[2]) as number[] })),
    }) as NonNullable<SerializedNonMekUnit['pendingCombat']>;
}

/** Current persistence keeps diagnostic text only; recovery graphs never cross the wire. */
function packDiagnostics(value: SerializedUnitRestorationMetadataV2 | undefined): unknown {
    if (value === undefined || value.warnings.length === 0) return undefined;
    return value.warnings.map(warning => [warning.code, warning.message]);
}

function unpackDiagnostics(value: unknown, baseline: SerializedCBTUnitV2['baselineRefAtSave'], path: string): SerializedUnitRestorationMetadataV2 {
    const warnings = unpackRows(value, path, (row, rowPath) => ({
        code: rowText(row, 0, rowPath), message: rowText(row, 1, rowPath),
    }));
    return {
        schemaVersion: 1,
        algorithmVersion: 2,
        fromBaseline: baseline,
        sourceChanged: true,
        warnings,
        unresolved: [],
        acceptedAliases: [],
    };
}

function unpackNonMekDiagnostics(value: unknown, path: string): NonNullable<SerializedNonMekUnit['restoration']> {
    const diagnostics = record(value, path);
    exactKeys(diagnostics, ['w', 'u'], path);
    return {
        warnings: clone(diagnostics['w'] ?? []) as string[],
        unresolved: clone(diagnostics['u'] ?? []) as string[],
    };
}

function packRoster(
    roster: SerializedCBTForceRosterV1,
    units: readonly SerializedForceUnitEntryV2[],
): readonly unknown[] {
    const unitIndex = new Map(units.map((unit, index) => [unit.instanceId, index] as const));
    const groupIndex = new Map(roster.groups.map((group, index) => [group.groupId, index] as const));
    return Object.freeze(roster.groups.map(group => {
        const targetGroupIndex = group.formationTargetGroupId === undefined
            ? undefined
            : groupIndex.get(group.formationTargetGroupId);
        if (group.formationTargetGroupId !== undefined && targetGroupIndex === undefined) {
            throw new Error(`Roster formation target ${group.formationTargetGroupId} has no force group`);
        }
        const metadata = compactObject({
            n: group.name,
            c: group.color,
            f: group.formationId,
            t: targetGroupIndex,
            l: group.formationLock ? 1 : undefined,
        });
        return tuple(
            group.groupId,
            group.members.map(member => {
                const index = unitIndex.get(member.instanceId);
                if (index === undefined) throw new Error(`Roster member ${member.instanceId} has no force unit`);
                return tuple(index, member.commander ? 1 : undefined);
            }),
            Object.keys(metadata).length === 0 ? undefined : metadata,
        );
    }));
}

function unpackRoster(value: unknown, units: readonly SerializedForceUnitEntryV2[]): SerializedCBTForceRosterV1 {
    const packedGroups = array(value, 'force.cbt.g');
    const groupIds = packedGroups.map((raw, index) =>
        rowText(array(raw, `force.cbt.g[${index}]`), 0, `force.cbt.g[${index}]`));
    return {
        schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
        groups: unpackRows(packedGroups, 'force.cbt.g', (row, path, groupOrder) => {
            const metadata = row[2] === undefined ? {} : record(row[2], `${path}[2]`);
            exactKeys(metadata, ['n', 'c', 'f', 't', 'l'], `${path}[2]`);
            const targetGroupIndex = optionalInteger(metadata['t'], `${path}[2].t`);
            const formationTargetGroupId = targetGroupIndex === undefined
                ? undefined
                : groupIds[targetGroupIndex];
            if (targetGroupIndex !== undefined && formationTargetGroupId === undefined) {
                throw new Error(`${path}[2].t has no force group`);
            }
            return {
            groupId: rowText(row, 0, path),
            order: groupOrder,
            ...(metadata['n'] === undefined ? {} : { name: text(metadata['n'], `${path}[2].n`) }),
            ...(metadata['c'] === undefined ? {} : { color: text(metadata['c'], `${path}[2].c`) }),
            ...(metadata['f'] === undefined ? {} : { formationId: text(metadata['f'], `${path}[2].f`) }),
            ...(formationTargetGroupId === undefined
                ? {}
                : { formationTargetGroupId }),
            ...(metadata['l'] === undefined ? {} : { formationLock: truthyOne(metadata['l'], `${path}[2].l`) }),
            members: unpackRows(row[1], `${path}[1]`, (member, memberPath, order) => {
                const unitIndex = rowInteger(member, 0, memberPath);
                const unit = units[unitIndex];
                if (unit === undefined) throw new Error(`${memberPath}[0] has no force unit`);
                const instanceId = unit.instanceId;
                return {
                    instanceId,
                    kind: unit.kind,
                    order,
                    ...(member[1] === undefined || member[1] === 0
                        ? {}
                        : { commander: truthyOne(member[1], `${memberPath}[1]`) }),
                };
            }),
        };
        }),
    };
}

function packEncounter(encounter: SerializedForceEncounterEntryV2): unknown {
    return tuple(encounter.encounterRevision, encounter.state.facts, encounter.recovery);
}

function unpackEncounter(value: unknown, path: string): SerializedForceEncounterEntryV2 {
    const row = array(value, path);
    if (row.length < 2 || row.length > 3) throw new Error(`${path} is not a compact encounter`);
    const revision = asStateRevision(rowInteger(row, 0, path));
    const state: SerializedCBTEncounterStateV2 = {
        schemaVersion: 2,
        encounterRevision: revision,
        facts: clone(row[1]) as SerializedCBTEncounterStateV2['facts'],
    };
    return {
        encounterRevision: revision,
        state,
        ...(row[2] === undefined ? {} : { recovery: clone(row[2]) as NonNullable<SerializedForceEncounterEntryV2['recovery']> }),
    };
}

function emptyEncounter(): SerializedForceEncounterEntryV2 {
    const revision = asStateRevision(0);
    return { encounterRevision: revision, state: { schemaVersion: 2, encounterRevision: revision, facts: [] } };
}

function rulesetFromScenario(value: JsonValue): CBTRuleset {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Classic scenario rules must be an object');
    }
    const ruleset = value['ruleset'];
    if (ruleset === undefined) return CORE_2026_RULESET;
    if (!isCBTRuleset(ruleset)) throw new Error(`Unsupported Classic ruleset ${String(ruleset)}`);
    return ruleset;
}

function packRows<T>(value: readonly T[] | undefined, map: (row: T) => unknown): readonly unknown[] | undefined {
    return value === undefined || value.length === 0 ? undefined : value.map(map);
}

function unpackRows<T>(
    value: unknown,
    path: string,
    map: (row: readonly unknown[], path: string, index: number) => T,
): T[] {
    return array(value, path).map((raw, index) => map(array(raw, `${path}[${index}]`), `${path}[${index}]`, index));
}

function compactObject(value: Record<string, unknown>): Readonly<Record<string, any>> {
    return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)));
}

function tuple(...values: unknown[]): readonly unknown[] {
    while (values.length > 0 && values.at(-1) === undefined) values.pop();
    return Object.freeze(values);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const accepted = new Set(allowed);
    const unexpected = Object.keys(value).find(key => !accepted.has(key));
    if (unexpected !== undefined) throw new Error(`${path}.${unexpected} is not a current compact field`);
}

function text(value: unknown, path: string): string {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`);
    return value;
}

function optionalText(value: unknown, path: string): string | undefined {
    return value === undefined || value === null ? undefined : text(value, path);
}

function integer(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
    return value as number;
}

function optionalInteger(value: unknown, path: string): number | undefined {
    return value === undefined || value === null ? undefined : integer(value, path);
}

function truthyOne(value: unknown, path: string): true {
    if (value !== 1) throw new Error(`${path} must be one`);
    return true;
}

function rowText(row: readonly unknown[], index: number, path: string): string {
    return text(row[index], `${path}[${index}]`);
}

function rowInteger(row: readonly unknown[], index: number, path: string): number {
    return integer(row[index], `${path}[${index}]`);
}

function rowBit(row: readonly unknown[], index: number, path: string): boolean {
    const value = row[index];
    if (value !== 0 && value !== 1) throw new Error(`${path}[${index}] must be zero or one`);
    return value === 1;
}

function fail(message: string): never {
    throw new Error(message);
}
