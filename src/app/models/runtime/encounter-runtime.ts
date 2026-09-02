// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { compareText } from '../../utils/string.util';
import { isPlainRecord } from '../../utils/json-value.util';
import type { ComponentId } from '../entity/entity-identifiers';
import { asComponentId } from '../entity/entity-identifiers';
import {
    isC3NetworkRole,
    isC3NetworkType,
    type C3NetworkRole,
    type C3NetworkType,
    type C3UnitPosition,
} from '../c3-network.model';
import type { TnTargetNumberCalculatorState, TnTargetUnitType } from '../target-number-calculator.model';
import { uuidv4 } from '../../utils/uuid.util';
import {
    type SerializedCBTEncounterStateV2,
    type SerializedEncounterNetworkV2,
} from './persistence-v2';

export const MAX_ENCOUNTER_TARGETS = 24;
export const DEFAULT_ENCOUNTER_TARGET_COLORS = [
    '#c0f7ff',
    '#ffebca',
    '#c6ffe1',
    '#ecc6ff',
    '#ddffc0',
    '#ffc6c6',
    '#6fb3bd',
    '#eacc80',
    '#8ed2ad',
    '#ab77c6',
    '#a9d087',
    '#d5a790',
] as const;

export type EncounterNetworkId = string & { readonly __encounterNetworkId: unique symbol };
export type EncounterTargetId = string & { readonly __encounterTargetId: unique symbol };

export type EncounterTargetCalculatorState = Pick<TnTargetNumberCalculatorState,
    | 'isAirborne'
    | 'targetMovementBracket'
    | 'targetMovementDistance'
    | 'skidding'
    | 'prone'
    | 'immobile'
    | 'targetHexCover'
    | 'waterDepth'
    | 'buildingCover'
    | 'targetHeight'
    | 'largeTarget'
    | 'narcAboveWater'
    | 'narcUnderwater'
    | 'tagged'
    | 'ecmShielded'
    | 'stealth'
    | 'stealthSystem'>;

export interface EncounterTarget {
    readonly id: EncounterTargetId;
    readonly letter: string;
    readonly name: string;
    readonly color: string;
    readonly source?: 'manual' | 'opfor';
    readonly readOnly?: boolean;
    readonly unitType?: TnTargetUnitType;
    readonly tnCalculator?: EncounterTargetCalculatorState;
}

export interface EncounterNetworkEndpoint {
    readonly instanceId: string;
    readonly componentId: ComponentId;
    readonly role: C3NetworkRole;
}

export interface EncounterNetwork {
    readonly id: EncounterNetworkId;
    readonly networkType: C3NetworkType;
    readonly color: string;
    readonly endpoints: readonly EncounterNetworkEndpoint[];
}

export interface CBTEncounterSnapshot {
    /** Session-only CAS revision for target-registry commands. */
    readonly revision: number;
    readonly targets: readonly EncounterTarget[];
    readonly networks: readonly EncounterNetwork[];
    readonly c3Positions: readonly C3UnitPosition[];
}

export type CBTEncounterC3Snapshot = Pick<CBTEncounterSnapshot, 'networks' | 'c3Positions'>;

/** Detached force-shared target query. It never contains attacker-local target state. */
export interface TargetRegistrySnapshot {
    readonly revision: number;
    readonly targets: readonly EncounterTarget[];
}

export interface TargetRegistryTargetPatch {
    readonly letter?: string;
    readonly name?: string;
    readonly color?: string;
    /** `null` explicitly clears an optional shared target fact. */
    readonly unitType?: TnTargetUnitType | null;
    /** `null` explicitly clears an optional shared target fact. */
    readonly tnCalculator?: EncounterTargetCalculatorState | null;
}

export type TargetRegistryCommand =
    | { readonly kind: 'create-target'; readonly target: EncounterTarget }
    | {
        readonly kind: 'update-target';
        readonly targetId: EncounterTargetId;
        readonly patch: TargetRegistryTargetPatch;
    }
    | { readonly kind: 'delete-target'; readonly targetId: EncounterTargetId }
    | { readonly kind: 'replace-targets'; readonly targets: readonly EncounterTarget[] }
    | { readonly kind: 'reset-targets' };

export type TargetRegistryCommandResult =
    | {
        readonly accepted: true;
        readonly changed: boolean;
        readonly snapshot: TargetRegistrySnapshot;
    }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly snapshot: TargetRegistrySnapshot;
    };

/** Returns a deeply frozen copy detached from the encounter runtime and its prior queries. */
export function queryTargetRegistry(
    current: Pick<CBTEncounterSnapshot, 'revision' | 'targets'>,
): TargetRegistrySnapshot {
    return freezeTargetRegistrySnapshot({
        revision: current.revision,
        targets: current.targets,
    });
}

/** Last canonical OPFOR row whose letter can become the conventional manual ID. */
export function reclaimableTargetRegistryOpfor(
    targets: readonly EncounterTarget[],
): EncounterTarget | null {
    const ids = new Set(targets.map(target => String(target.id)));
    for (let index = targets.length - 1; index >= 0; index -= 1) {
        const target = targets[index];
        if (target.source === 'opfor' && !ids.has(target.letter)) return target;
    }
    return null;
}

/**
 * Pure force-shared target-registry reducer. Invalid or inapplicable edits are
 * accepted no-ops; only a read-only target rejects a mutation.
 */
export function reduceTargetRegistry(
    current: TargetRegistrySnapshot,
    command: TargetRegistryCommand,
): TargetRegistryCommandResult {
    const snapshot = freezeTargetRegistrySnapshot(current);
    switch (command.kind) {
        case 'create-target': {
            const target = tryFreezeTarget(command.target, false);
            if (!target || !validTargetOrigin(target)) return unchangedTargetRegistry(snapshot);
            let retained = snapshot.targets;
            if (snapshot.targets.length >= MAX_ENCOUNTER_TARGETS) {
                const reclaimable = target.source === 'opfor'
                    ? null
                    : reclaimableTargetRegistryOpfor(snapshot.targets);
                if (!reclaimable || target.letter !== reclaimable.letter) {
                    return unchangedTargetRegistry(snapshot);
                }
                retained = snapshot.targets.filter(candidate => candidate.id !== reclaimable.id);
            }
            if (retained.some(candidate => candidate.id === target.id || candidate.letter === target.letter)) {
                return unchangedTargetRegistry(snapshot);
            }
            return changedTargetRegistry(snapshot, [...retained, target]);
        }
        case 'update-target': {
            if (!validEncounterTargetId(command.targetId)
                || !validTargetPatch(command.patch)) {
                return unchangedTargetRegistry(snapshot);
            }
            const targetIndex = snapshot.targets.findIndex(target => target.id === command.targetId);
            if (targetIndex < 0) return unchangedTargetRegistry(snapshot);
            const existing = snapshot.targets[targetIndex];
            if (existing.readOnly === true && targetPatchChangesReadOnlyIdentity(command.patch)) {
                return readOnlyTargetRegistry(snapshot);
            }
            const target = patchedTarget(existing, command.patch);
            if (!target || !validTargetOrigin(target)) return unchangedTargetRegistry(snapshot);
            if (snapshot.targets.some((candidate, index) => index !== targetIndex
                && (candidate.id === target.id || candidate.letter === target.letter))) {
                return unchangedTargetRegistry(snapshot);
            }
            if (targetsEqual(existing, target)) return unchangedTargetRegistry(snapshot);
            const targets = [...snapshot.targets];
            targets[targetIndex] = target;
            return changedTargetRegistry(snapshot, targets);
        }
        case 'delete-target': {
            if (!validEncounterTargetId(command.targetId)) return unchangedTargetRegistry(snapshot);
            const existing = snapshot.targets.find(target => target.id === command.targetId);
            if (!existing) return unchangedTargetRegistry(snapshot);
            if (existing.readOnly === true) return readOnlyTargetRegistry(snapshot);
            return changedTargetRegistry(snapshot, snapshot.targets.filter(target => target.id !== command.targetId));
        }
        case 'replace-targets': {
            if (!Array.isArray(command.targets)) return unchangedTargetRegistry(snapshot);
            const replacement = canonicalTargetList(command.targets);
            if (!replacement || replacement.length > MAX_ENCOUNTER_TARGETS) {
                return unchangedTargetRegistry(snapshot);
            }
            if (targetListsEqual(snapshot.targets, replacement)) return unchangedTargetRegistry(snapshot);
            return changedTargetRegistry(snapshot, replacement);
        }
        case 'reset-targets':
            return snapshot.targets.length === 0
                ? unchangedTargetRegistry(snapshot)
                : changedTargetRegistry(snapshot, []);
        default:
            return unchangedTargetRegistry(snapshot);
    }
}

/** Per-force owner of the durable C3 graph and editor layout. */
export class CBTEncounterC3State {
    #snapshot: CBTEncounterC3Snapshot;

    public constructor(initial: CBTEncounterC3Snapshot = emptyCBTEncounterC3Snapshot()) {
        this.#snapshot = freezeC3Snapshot(initial);
    }

    public snapshot(): CBTEncounterC3Snapshot {
        return this.#snapshot;
    }

    public serializedState(): SerializedCBTEncounterStateV2 {
        return encodeCBTEncounterStateV2(this.#snapshot);
    }

    /** Stores an already-canonical graph and its visual layout as one encounter edit. */
    public replaceC3Configuration(
        networks: readonly EncounterNetwork[],
        c3Positions: readonly C3UnitPosition[],
    ): void {
        this.#snapshot = freezeC3Snapshot({ networks, c3Positions });
    }

    public restoreSerialized(state: SerializedCBTEncounterStateV2): void {
        this.#snapshot = decodeCBTEncounterStateV2(state);
    }
}

export function emptyCBTEncounterC3Snapshot(): CBTEncounterC3Snapshot {
    return freezeC3Snapshot({ networks: [], c3Positions: [] });
}

export function asEncounterNetworkId(value: string): EncounterNetworkId {
    if (!value || value.trim() !== value || value.length > 128 || value.includes('\0')) {
        throw new Error('Invalid encounter network ID');
    }
    return value as EncounterNetworkId;
}

/** Manual target identity is opaque; its letter is presentation only. */
export function createEncounterTargetId(): EncounterTargetId {
    return asEncounterTargetId(`target:${uuidv4()}`);
}

export function encounterTargetLetter(index: number): string {
    let value = index + 1;
    let label = '';
    while (value > 0) {
        value--;
        label = String.fromCharCode('A'.charCodeAt(0) + value % 26) + label;
        value = Math.floor(value / 26);
    }
    return label;
}

export function asEncounterTargetId(value: string): EncounterTargetId {
    if (!value || value.trim() !== value || value.length > 128 || value.includes('\0')) {
        throw new Error('Invalid encounter target ID');
    }
    return value as EncounterTargetId;
}

export function decodeCBTEncounterStateV2(
    state: SerializedCBTEncounterStateV2,
): CBTEncounterC3Snapshot {
    return freezeC3Snapshot({
        networks: state.networks.map(encounterNetworkFromSerialized),
        c3Positions: state.c3Positions ?? [],
    });
}

export function encodeCBTEncounterStateV2(
    snapshot: CBTEncounterC3Snapshot,
): SerializedCBTEncounterStateV2 {
    const canonical = freezeC3Snapshot(snapshot);
    return Object.freeze({
        networks: Object.freeze(canonical.networks.map(serializedEncounterNetwork)),
        ...(canonical.c3Positions.length === 0 ? {} : { c3Positions: canonical.c3Positions }),
    });
}

function copyStealth<T extends {
    readonly short: number;
    readonly medium: number;
    readonly long: number;
    readonly conventionalInfantry?: {
        readonly short: number;
        readonly medium: number;
        readonly long: number;
    };
}>(stealth: T): T {
    return {
        ...stealth,
        ...(stealth.conventionalInfantry === undefined
            ? {}
            : { conventionalInfantry: { ...stealth.conventionalInfantry } }),
    };
}

function copyTargetCalculator(
    calculator: EncounterTargetCalculatorState,
): EncounterTargetCalculatorState {
    return {
        ...calculator,
        ...(calculator.stealth === undefined || typeof calculator.stealth === 'boolean'
            ? {}
            : { stealth: copyStealth(calculator.stealth) }),
    };
}

function freezeTargetCalculator(
    calculator: EncounterTargetCalculatorState,
): EncounterTargetCalculatorState {
    const copy = copyTargetCalculator(calculator);
    if (copy.stealth !== undefined && typeof copy.stealth !== 'boolean') {
        if (copy.stealth.conventionalInfantry !== undefined) {
            Object.freeze(copy.stealth.conventionalInfantry);
        }
        Object.freeze(copy.stealth);
    }
    return Object.freeze(copy);
}

function serializedEncounterNetwork(network: EncounterNetwork): SerializedEncounterNetworkV2 {
    return Object.freeze({
        id: network.id,
        networkType: network.networkType,
        color: network.color,
        endpoints: Object.freeze(network.endpoints.map(endpoint => Object.freeze({ ...endpoint }))
            .sort((left, right) => compareText(endpointKey(left), endpointKey(right)))),
    });
}

function endpointKey(endpoint: EncounterNetworkEndpoint): string {
    return `${endpoint.instanceId}\0${endpoint.componentId}`;
}

function encounterNetworkFromSerialized(network: SerializedEncounterNetworkV2): EncounterNetwork {
    const record = requirePlainRecord(network, 'encounter network');
    exactOperationKeys(record, ['id', 'networkType', 'color', 'endpoints']);
    const networkType = requireText(record['networkType']);
    if (!isC3NetworkType(networkType)) throw new Error('Unknown C3 network type');
    return freezeNetwork({
        id: asEncounterNetworkId(requireText(record['id'])),
        networkType,
        color: requireText(record['color']),
        endpoints: requireList(record['endpoints']).map(raw => {
            const endpoint = requirePlainRecord(raw, 'encounter network endpoint');
            exactOperationKeys(endpoint, ['instanceId', 'componentId', 'role']);
            const role = requireText(endpoint['role']);
            if (!isC3NetworkRole(role)) throw new Error('Unknown C3 network role');
            return Object.freeze({
                instanceId: requireText(endpoint['instanceId']),
                componentId: asComponentId(requireText(endpoint['componentId'])),
                role,
            });
        }),
    });
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}

function requireList(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('Encounter operation field must be an array');
    return value;
}

function requireText(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Encounter operation field must be a string');
    return value;
}

function exactOperationKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
    const keys = new Set(allowed);
    for (const key of Object.keys(record)) if (!keys.has(key)) throw new Error(`Unknown encounter field: ${key}`);
}

function freezeTargetRegistrySnapshot(
    snapshot: Pick<TargetRegistrySnapshot, 'revision' | 'targets'>,
): TargetRegistrySnapshot {
    return Object.freeze({
        revision: snapshot.revision,
        targets: Object.freeze(snapshot.targets.map(target => freezeTarget(target))
            .sort((left, right) => compareText(left.letter, right.letter) || compareText(left.id, right.id))),
    });
}

export function readOnlyTargetRegistry(snapshot: TargetRegistrySnapshot): TargetRegistryCommandResult {
    return Object.freeze({ accepted: false, changed: false, snapshot });
}

export function unchangedTargetRegistry(snapshot: TargetRegistrySnapshot): TargetRegistryCommandResult {
    return Object.freeze({ accepted: true, changed: false, snapshot });
}

function changedTargetRegistry(
    previous: TargetRegistrySnapshot,
    targets: readonly EncounterTarget[],
): TargetRegistryCommandResult {
    return Object.freeze({
        accepted: true,
        changed: true,
        snapshot: freezeTargetRegistrySnapshot({
            revision: Number(previous.revision) + 1,
            targets,
        }),
    });
}

function canonicalTargetList(targets: readonly EncounterTarget[]): readonly EncounterTarget[] | null {
    const canonical: EncounterTarget[] = [];
    for (const target of targets) {
        const frozen = tryFreezeTarget(target, false);
        if (!frozen) return null;
        canonical.push(frozen);
    }
    const ids = new Set<string>();
    const letters = new Set<string>();
    for (const target of canonical) {
        if (ids.has(target.id) || letters.has(target.letter)) {
            return null;
        }
        ids.add(target.id);
        letters.add(target.letter);
    }
    if (canonical.some(target => !validTargetOrigin(target))) {
        return null;
    }
    return freezeTargetRegistrySnapshot({ revision: 0, targets: canonical }).targets;
}

function tryFreezeTarget(target: EncounterTarget, validateOrigin = true): EncounterTarget | null {
    try {
        return freezeTarget(target, validateOrigin);
    } catch {
        return null;
    }
}

function patchedTarget(
    existing: EncounterTarget,
    patch: TargetRegistryTargetPatch,
): EncounterTarget | null {
    const candidate: {
        id: EncounterTargetId;
        letter: string;
        name: string;
        color: string;
        source?: 'manual' | 'opfor';
        readOnly?: boolean;
        unitType?: TnTargetUnitType;
        tnCalculator?: EncounterTargetCalculatorState;
    } = { ...existing };
    if (Object.prototype.hasOwnProperty.call(patch, 'letter')) candidate.letter = patch.letter as string;
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) candidate.name = patch.name as string;
    if (Object.prototype.hasOwnProperty.call(patch, 'color')) candidate.color = patch.color as string;
    if (Object.prototype.hasOwnProperty.call(patch, 'unitType')) {
        if (patch.unitType === null || patch.unitType === undefined) delete candidate.unitType;
        else candidate.unitType = patch.unitType;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'tnCalculator')) {
        if (patch.tnCalculator === null || patch.tnCalculator === undefined) delete candidate.tnCalculator;
        else candidate.tnCalculator = patch.tnCalculator;
    }
    return tryFreezeTarget(candidate, false);
}

function validTargetPatch(patch: TargetRegistryTargetPatch): boolean {
    if (!isPlainRecord(patch)
        || !hasExactKeys(patch, ['letter', 'name', 'color', 'unitType', 'tnCalculator'])) return false;
    if (Object.prototype.hasOwnProperty.call(patch, 'letter') && typeof patch['letter'] !== 'string') return false;
    if (Object.prototype.hasOwnProperty.call(patch, 'name') && typeof patch['name'] !== 'string') return false;
    if (Object.prototype.hasOwnProperty.call(patch, 'color') && typeof patch['color'] !== 'string') return false;
    if (Object.prototype.hasOwnProperty.call(patch, 'unitType')
        && patch['unitType'] !== null && patch['unitType'] !== undefined
        && !validTargetUnitType(patch['unitType'])) return false;
    return !Object.prototype.hasOwnProperty.call(patch, 'tnCalculator')
        || patch['tnCalculator'] === null
        || patch['tnCalculator'] === undefined
        || validSharedTargetCalculator(patch['tnCalculator']);
}

function targetPatchChangesReadOnlyIdentity(patch: TargetRegistryTargetPatch): boolean {
    return Object.keys(patch).some(key => key !== 'color');
}

function validTargetOrigin(target: EncounterTarget): boolean {
    return target.source === 'opfor' ? target.readOnly === true : target.readOnly !== true;
}

function targetListsEqual(left: readonly EncounterTarget[], right: readonly EncounterTarget[]): boolean {
    return left.length === right.length && left.every((target, index) => targetsEqual(target, right[index]));
}

function targetsEqual(left: EncounterTarget, right: EncounterTarget): boolean {
    return left.id === right.id
        && left.letter === right.letter
        && left.name === right.name
        && left.color === right.color
        && left.source === right.source
        && left.readOnly === right.readOnly
        && left.unitType === right.unitType
        && sharedTargetCalculatorsEqual(left.tnCalculator, right.tnCalculator);
}

function sharedTargetCalculatorsEqual(
    left: EncounterTargetCalculatorState | undefined,
    right: EncounterTargetCalculatorState | undefined,
): boolean {
    if (left === undefined || right === undefined) return left === right;
    return left.isAirborne === right.isAirborne
        && left.targetMovementBracket === right.targetMovementBracket
        && left.skidding === right.skidding
        && left.prone === right.prone
        && left.immobile === right.immobile
        && left.targetHexCover === right.targetHexCover
        && left.waterDepth === right.waterDepth
        && left.buildingCover === right.buildingCover
        && left.largeTarget === right.largeTarget
        && left.narcAboveWater === right.narcAboveWater
        && left.narcUnderwater === right.narcUnderwater
        && left.tagged === right.tagged
        && left.ecmShielded === right.ecmShielded;
}

function hasExactKeys(value: object, allowed: readonly string[]): boolean {
    const allowedKeys = new Set(allowed);
    return Object.keys(value).every(key => allowedKeys.has(key));
}

function freezeC3Snapshot(snapshot: CBTEncounterC3Snapshot): CBTEncounterC3Snapshot {
    return Object.freeze({
        networks: Object.freeze(snapshot.networks.map(freezeNetwork)
            .sort((left, right) => compareText(left.id, right.id))),
        c3Positions: freezeC3Positions(snapshot.c3Positions),
    });
}

function freezeC3Positions(positions: readonly C3UnitPosition[]): readonly C3UnitPosition[] {
    const unitIds = new Set<string>();
    const frozen = positions.map(position => {
        if (typeof position.unitId !== 'string'
            || position.unitId.trim() !== position.unitId
            || !position.unitId
            || position.unitId.length > 512
            || position.unitId.includes('\0')
            || typeof position.x !== 'number'
            || !Number.isFinite(position.x)
            || typeof position.y !== 'number'
            || !Number.isFinite(position.y)
            || unitIds.has(position.unitId)) {
            throw new EncounterInputError('invalid-c3-position');
        }
        unitIds.add(position.unitId);
        return Object.freeze({
            unitId: position.unitId,
            x: Object.is(position.x, -0) ? 0 : position.x,
            y: Object.is(position.y, -0) ? 0 : position.y,
        });
    });
    return Object.freeze(frozen.sort((left, right) => compareText(left.unitId, right.unitId)));
}

function freezeTarget(target: EncounterTarget, validateOrigin = true): EncounterTarget {
    validateTarget(target, validateOrigin);
    return Object.freeze({
        id: target.id,
        letter: target.letter,
        name: target.name,
        color: target.color,
        ...(target.source !== undefined && { source: target.source }),
        ...(target.readOnly !== undefined && { readOnly: target.readOnly }),
        ...(target.unitType !== undefined && { unitType: target.unitType }),
        ...(target.tnCalculator && { tnCalculator: freezeTargetCalculator(target.tnCalculator) }),
    });
}

function validateTarget(target: EncounterTarget, validateOrigin = true): void {
    if (!isPlainRecord(target)
        || !hasExactKeys(target, [
            'id', 'letter', 'name', 'color', 'source', 'readOnly', 'unitType', 'tnCalculator',
        ])) throw new EncounterInputError('invalid-target');
    try { asEncounterTargetId(target.id); } catch { throw new EncounterInputError('invalid-target'); }
    if (typeof target.letter !== 'string' || typeof target.name !== 'string' || typeof target.color !== 'string'
        || !/^[A-Z]{1,4}$/.test(target.letter)
        || target.name.trim() !== target.name || !target.name || target.name.length > 160
        || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(target.color)) {
        throw new EncounterInputError('invalid-target');
    }
    if (target.source !== undefined && target.source !== 'manual' && target.source !== 'opfor') {
        throw new EncounterInputError('invalid-target');
    }
    if (target.readOnly !== undefined && typeof target.readOnly !== 'boolean') {
        throw new EncounterInputError('invalid-target');
    }
    if (validateOrigin && !validTargetOrigin(target)) {
        throw new EncounterInputError('invalid-target');
    }
    if (target.unitType !== undefined && !validTargetUnitType(target.unitType)) {
        throw new EncounterInputError('invalid-target');
    }
    if (target.tnCalculator !== undefined && !validSharedTargetCalculator(target.tnCalculator)) {
        throw new EncounterInputError('invalid-target');
    }
}

function validEncounterTargetId(value: unknown): value is EncounterTargetId {
    if (typeof value !== 'string') return false;
    try {
        asEncounterTargetId(value);
        return true;
    } catch {
        return false;
    }
}

function validTargetUnitType(value: unknown): value is TnTargetUnitType {
    return typeof value === 'string' && [
        'mek-biped', 'mek-quad', 'mek-tripod', 'battle-armor', 'vehicle', 'vtol-wige',
        'infantry', 'protoMek', 'aero', 'terrain', 'building',
    ].includes(value);
}

function validSharedTargetCalculator(value: unknown): value is EncounterTargetCalculatorState {
    if (!isPlainRecord(value) || !hasExactKeys(value, [
        'isAirborne', 'targetMovementBracket', 'targetMovementDistance', 'skidding', 'prone', 'immobile',
        'targetHexCover', 'waterDepth', 'buildingCover', 'targetHeight', 'largeTarget',
        'narcAboveWater', 'narcUnderwater', 'tagged', 'ecmShielded', 'stealth', 'stealthSystem',
    ])) return false;
    const calculator = value as EncounterTargetCalculatorState;
    for (const property of [
        'isAirborne', 'skidding', 'prone', 'immobile', 'largeTarget',
        'narcAboveWater', 'narcUnderwater', 'tagged', 'ecmShielded',
    ] as const) {
        if (calculator[property] !== undefined && typeof calculator[property] !== 'boolean') return false;
    }
    if (calculator.targetMovementBracket !== undefined && calculator.targetMovementBracket !== null
        && !['0-2', '3-4', '5-6', '7-9', '10-17', '18-24', '25+']
            .includes(calculator.targetMovementBracket)) return false;
    if (calculator.targetMovementDistance !== undefined
        && calculator.targetMovementDistance !== null
        && (!Number.isSafeInteger(calculator.targetMovementDistance)
            || calculator.targetMovementDistance < 0)) return false;
    if (calculator.targetHexCover !== undefined
        && !['none', 'light', 'heavy'].includes(calculator.targetHexCover)) return false;
    if (calculator.waterDepth !== undefined
        && !['underwater-depth-1', 'underwater-depth-2', 'underwater-depth-3']
            .includes(calculator.waterDepth)) return false;
    if (calculator.buildingCover !== undefined
        && !['building-1', 'building-2', 'building-3'].includes(calculator.buildingCover)) return false;
    if (calculator.targetHeight !== undefined && ![1, 2, 3].includes(calculator.targetHeight)) return false;
    return validStealth(calculator.stealth)
        && (calculator.stealthSystem === undefined || [
            'stealth-armor', 'null-signature', 'chameleon', 'chameleon-null',
            'ba-basic', 'ba-standard', 'ba-improved', 'mimetic', 'simple-camo',
        ].includes(calculator.stealthSystem));
}

function validRangeModifiers(value: unknown): boolean {
    if (!isPlainRecord(value) || !hasExactKeys(value, ['short', 'medium', 'long'])) return false;
    return ['short', 'medium', 'long'].every(key => Number.isSafeInteger(value[key]));
}

function validStealth(value: unknown): boolean {
    if (value === undefined || typeof value === 'boolean') return true;
    if (!isPlainRecord(value) || !hasExactKeys(value, [
        'short', 'medium', 'long', 'conventionalInfantry', 'secondaryTargetRestricted',
    ])) return false;
    if (!validRangeModifiers({
        short: value['short'], medium: value['medium'], long: value['long'],
    })) return false;
    if (value['conventionalInfantry'] !== undefined
        && !validRangeModifiers(value['conventionalInfantry'])) return false;
    return value['secondaryTargetRestricted'] === undefined
        || typeof value['secondaryTargetRestricted'] === 'boolean';
}

function freezeNetwork(network: EncounterNetwork): EncounterNetwork {
    // C3NetworkEditor and the stable endpoint projection own network rules.
    // The encounter runtime only detaches, freezes, revisions, and stores the
    // already-canonical cross-unit fact; it must not become a second validator.
    return Object.freeze({
        ...network,
        endpoints: Object.freeze(network.endpoints.map(endpoint => Object.freeze({ ...endpoint }))),
    });
}

class EncounterInputError extends Error {
    public constructor(public readonly reason: 'invalid-target' | 'invalid-c3-position') {
        super(reason);
    }
}
