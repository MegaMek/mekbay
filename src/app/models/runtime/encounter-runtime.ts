// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    InventoryControlRuntimeTarget,
    InventoryControlRuntimeTargetId,
} from '../inventory-control-runtime-state.model';
import {
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
} from '../inventory-control-runtime-state.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { asComponentId } from '../entity/entity-identifiers';
import type { JsonValue } from '../persisted-unit-state';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import { uuidv4 } from '../../utils/uuid.util';
import {
    asStateRevision,
    asUnitInstanceId,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';
import {
    encounterNetworkFactId,
    encounterTargetFactId,
    type SerializedCBTEncounterStateV2,
    type SerializedEncounterFactV2,
    type SerializedEncounterNetworkV2,
    type SerializedEncounterTargetCalculatorV2,
    type SerializedEncounterTargetV2,
} from './persistence-v2';

export type EncounterNetworkId = string & { readonly __encounterNetworkId: unique symbol };
export type EncounterTargetId = InventoryControlRuntimeTargetId & { readonly __encounterTargetId: unique symbol };
export type EncounterNetworkType = 'c3' | 'c3i' | 'naval' | 'nova';

export interface EncounterTarget {
    readonly id: EncounterTargetId;
    readonly letter: string;
    readonly name: string;
    readonly color: string;
    readonly source?: 'manual' | 'opfor';
    readonly readOnly?: boolean;
    readonly unitType?: TnTargetUnitType;
    readonly tnCalculator?: SerializedEncounterTargetCalculatorV2;
}

export interface EncounterNetworkEndpoint {
    readonly instanceId: UnitInstanceId;
    readonly componentId: ComponentId;
    readonly role: 'master' | 'member' | 'peer';
}

export interface EncounterNetwork {
    readonly id: EncounterNetworkId;
    readonly networkType: EncounterNetworkType;
    readonly color: string;
    readonly endpoints: readonly EncounterNetworkEndpoint[];
}

export interface CBTEncounterSnapshot {
    readonly revision: StateRevision;
    readonly targets: readonly EncounterTarget[];
    readonly networks: readonly EncounterNetwork[];
}

export type CBTEncounterCommand =
    | {
        readonly kind: 'put-target';
        readonly expectedRevision: StateRevision;
        readonly target: EncounterTarget;
    }
    | {
        readonly kind: 'remove-target';
        readonly expectedRevision: StateRevision;
        readonly targetId: EncounterTargetId;
    }
    | {
        readonly kind: 'replace-targets';
        readonly expectedRevision: StateRevision;
        readonly targets: readonly EncounterTarget[];
    }
    | {
        readonly kind: 'put-network';
        readonly expectedRevision: StateRevision;
        readonly network: EncounterNetwork;
    }
    | {
        readonly kind: 'remove-network';
        readonly expectedRevision: StateRevision;
        readonly networkId: EncounterNetworkId;
    }
    | {
        readonly kind: 'replace-networks';
        readonly expectedRevision: StateRevision;
        readonly networks: readonly EncounterNetwork[];
    };

export type CBTEncounterReduction =
    | { readonly kind: 'applied'; readonly snapshot: CBTEncounterSnapshot }
    | {
        readonly kind: 'rejected';
        readonly snapshot: CBTEncounterSnapshot;
        readonly reason: 'stale-revision' | 'invalid-target' | 'invalid-network';
    };

/** Detached force-shared target query. It never contains attacker-local target state. */
export interface TargetRegistrySnapshot {
    readonly revision: StateRevision;
    readonly targets: readonly EncounterTarget[];
}

export interface TargetRegistryTargetPatch {
    readonly letter?: string;
    readonly name?: string;
    readonly color?: string;
    /** `null` explicitly clears an optional shared target fact. */
    readonly unitType?: TnTargetUnitType | null;
    /** `null` explicitly clears an optional shared target fact. */
    readonly tnCalculator?: SerializedEncounterTargetCalculatorV2 | null;
}

interface TargetRegistryCommandEnvelope {
    readonly expectedRevision: StateRevision;
}

/** Every production mutation is an explicit compare-and-swap command. */
export type TargetRegistryCommand = TargetRegistryCommandEnvelope & (
    | { readonly kind: 'create-target'; readonly target: EncounterTarget }
    | {
        readonly kind: 'update-target';
        readonly targetId: EncounterTargetId;
        readonly patch: TargetRegistryTargetPatch;
    }
    | { readonly kind: 'delete-target'; readonly targetId: EncounterTargetId }
    | { readonly kind: 'replace-targets'; readonly targets: readonly EncounterTarget[] }
    | { readonly kind: 'reset-targets' }
);

export type TargetRegistryRejectionReason =
    | 'STALE_REVISION'
    | 'REVISION_EXHAUSTED'
    | 'READ_ONLY_TARGET'
    | 'TARGET_ORIGIN_POLICY'
    | 'INVALID_TARGET'
    | 'TARGET_NOT_FOUND'
    | 'EXCEEDS_CAPACITY';

export type TargetRegistryCommandResult =
    | {
        readonly accepted: true;
        readonly changed: true;
        readonly previousRevision: StateRevision;
        readonly snapshot: TargetRegistrySnapshot;
    }
    | {
        readonly accepted: true;
        readonly changed: false;
        readonly snapshot: TargetRegistrySnapshot;
    }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly reason: TargetRegistryRejectionReason;
        readonly snapshot: TargetRegistrySnapshot;
    };

/** Returns a deeply frozen copy detached from the encounter runtime and its prior queries. */
export function queryTargetRegistry(
    current: Pick<CBTEncounterSnapshot, 'revision' | 'targets'>,
): TargetRegistrySnapshot {
    return freezeTargetRegistrySnapshot(current);
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
 * Pure force-shared target-registry reducer. Validation precedence is stable:
 * stale revision, malformed input, origin policy, identity/capacity, then access policy.
 */
export function reduceTargetRegistry(
    current: TargetRegistrySnapshot,
    command: TargetRegistryCommand,
): TargetRegistryCommandResult {
    const snapshot = freezeTargetRegistrySnapshot(current);
    if (command.expectedRevision !== snapshot.revision) {
        return rejectedTargetRegistry(snapshot, 'STALE_REVISION');
    }

    switch (command.kind) {
        case 'create-target': {
            if (!hasExactKeys(command, ['kind', 'expectedRevision', 'target'])) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            const target = tryFreezeTarget(command.target, false);
            if (!target) return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            if (!validTargetOrigin(target)) return rejectedTargetRegistry(snapshot, 'TARGET_ORIGIN_POLICY');
            let retained = snapshot.targets;
            if (snapshot.targets.length >= INVENTORY_CONTROL_TARGET_MAX_COUNT) {
                const reclaimable = target.source === 'opfor'
                    ? null
                    : reclaimableTargetRegistryOpfor(snapshot.targets);
                if (!reclaimable || target.letter !== reclaimable.letter) {
                    return rejectedTargetRegistry(snapshot, 'EXCEEDS_CAPACITY');
                }
                retained = snapshot.targets.filter(candidate => candidate.id !== reclaimable.id);
            }
            if (retained.some(candidate => candidate.id === target.id || candidate.letter === target.letter)) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            return changedTargetRegistry(snapshot, [...retained, target]);
        }
        case 'update-target': {
            if (!hasExactKeys(command, ['kind', 'expectedRevision', 'targetId', 'patch'])
                || !validEncounterTargetId(command.targetId)
                || !validTargetPatch(command.patch)) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            const targetIndex = snapshot.targets.findIndex(target => target.id === command.targetId);
            if (targetIndex < 0) return rejectedTargetRegistry(snapshot, 'TARGET_NOT_FOUND');
            const existing = snapshot.targets[targetIndex];
            if (existing.readOnly === true && targetPatchChangesReadOnlyIdentity(command.patch)) {
                return rejectedTargetRegistry(snapshot, 'READ_ONLY_TARGET');
            }
            const target = patchedTarget(existing, command.patch);
            if (!target) return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            if (!validTargetOrigin(target)) return rejectedTargetRegistry(snapshot, 'TARGET_ORIGIN_POLICY');
            if (snapshot.targets.some((candidate, index) => index !== targetIndex
                && (candidate.id === target.id || candidate.letter === target.letter))) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            if (targetsEqual(existing, target)) return unchangedTargetRegistry(snapshot);
            const targets = [...snapshot.targets];
            targets[targetIndex] = target;
            return changedTargetRegistry(snapshot, targets);
        }
        case 'delete-target': {
            if (!hasExactKeys(command, ['kind', 'expectedRevision', 'targetId'])
                || !validEncounterTargetId(command.targetId)) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            const existing = snapshot.targets.find(target => target.id === command.targetId);
            if (!existing) return rejectedTargetRegistry(snapshot, 'TARGET_NOT_FOUND');
            if (existing.readOnly === true) return rejectedTargetRegistry(snapshot, 'READ_ONLY_TARGET');
            return changedTargetRegistry(snapshot, snapshot.targets.filter(target => target.id !== command.targetId));
        }
        case 'replace-targets': {
            if (!hasExactKeys(command, ['kind', 'expectedRevision', 'targets']) || !Array.isArray(command.targets)) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            const replacement = canonicalTargetList(command.targets);
            if (replacement.reason) return rejectedTargetRegistry(snapshot, replacement.reason);
            if (replacement.targets.length > INVENTORY_CONTROL_TARGET_MAX_COUNT) {
                return rejectedTargetRegistry(snapshot, 'EXCEEDS_CAPACITY');
            }
            if (targetListsEqual(snapshot.targets, replacement.targets)) return unchangedTargetRegistry(snapshot);
            return changedTargetRegistry(snapshot, replacement.targets);
        }
        case 'reset-targets':
            if (!hasExactKeys(command, ['kind', 'expectedRevision'])) {
                return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
            }
            return snapshot.targets.length === 0
                ? unchangedTargetRegistry(snapshot)
                : changedTargetRegistry(snapshot, []);
        default:
            return rejectedTargetRegistry(snapshot, 'INVALID_TARGET');
    }
}

/** Pure encounter reducer. It owns only cross-unit facts, never attacker-local selections. */
export function reduceCBTEncounter(
    current: CBTEncounterSnapshot,
    command: CBTEncounterCommand,
): CBTEncounterReduction {
    if (command.expectedRevision !== current.revision) {
        return Object.freeze({ kind: 'rejected', snapshot: current, reason: 'stale-revision' });
    }

    const targets = new Map(current.targets.map(target => [target.id, target]));
    const networks = new Map(current.networks.map(network => [network.id, network]));
    try {
        switch (command.kind) {
            case 'put-target':
                targets.set(command.target.id, freezeTarget(command.target));
                validateTargets(targets.values());
                break;
            case 'remove-target':
                targets.delete(command.targetId);
                break;
            case 'replace-targets':
                targets.clear();
                for (const target of command.targets) {
                    if (targets.has(target.id)) throw new EncounterInputError('invalid-target');
                    targets.set(target.id, freezeTarget(target));
                }
                validateTargets(targets.values());
                break;
            case 'put-network':
                networks.set(command.network.id, freezeNetwork(command.network));
                validateNetworks(networks.values());
                break;
            case 'remove-network':
                networks.delete(command.networkId);
                break;
            case 'replace-networks':
                networks.clear();
                for (const network of command.networks) {
                    if (networks.has(network.id)) throw new EncounterInputError('invalid-network');
                    networks.set(network.id, freezeNetwork(network));
                }
                validateNetworks(networks.values());
                break;
        }
    } catch (error) {
        const reason = error instanceof EncounterInputError ? error.reason : 'invalid-network';
        return Object.freeze({ kind: 'rejected', snapshot: current, reason });
    }

    return Object.freeze({
        kind: 'applied',
        snapshot: freezeSnapshot({
            revision: asStateRevision(Number(current.revision) + 1),
            targets: [...targets.values()],
            networks: [...networks.values()],
        }),
    });
}

/** Stateful owner around the explicit query/dispatch encounter contract. */
export class CBTEncounterRuntime {
    #snapshot: CBTEncounterSnapshot;
    #preservedFacts: readonly SerializedEncounterFactV2[] = Object.freeze([]);

    public constructor(initial: CBTEncounterSnapshot = emptyCBTEncounterSnapshot()) {
        this.#snapshot = freezeSnapshot(initial);
    }

    public snapshot(): CBTEncounterSnapshot {
        return this.#snapshot;
    }

    public targetRegistry(): TargetRegistrySnapshot {
        return queryTargetRegistry(this.#snapshot);
    }

    /** Explicit-revision production command surface. No revision is inferred for the caller. */
    public dispatchTargetRegistry(command: TargetRegistryCommand): TargetRegistryCommandResult {
        const result = reduceTargetRegistry(this.targetRegistry(), command);
        if (result.accepted && result.changed) {
            this.#snapshot = freezeSnapshot({
                revision: result.snapshot.revision,
                targets: result.snapshot.targets,
                networks: this.#snapshot.networks,
            });
        }
        return result;
    }

    public serializedState(): SerializedCBTEncounterStateV2 {
        return encodeCBTEncounterStateV2(this.#snapshot, this.#preservedFacts);
    }

    public targetsMap(): ReadonlyMap<InventoryControlRuntimeTargetId, Readonly<InventoryControlRuntimeTarget>> {
        return new Map(this.#snapshot.targets.map(target => [target.id, projectInventoryControlTarget(target)]));
    }

    public getTargets(): InventoryControlRuntimeTarget[] {
        return this.#snapshot.targets.map(projectInventoryControlTarget);
    }

    public getTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        const target = this.#snapshot.targets.find(candidate => candidate.id === targetId);
        return target ? projectInventoryControlTarget(target) : undefined;
    }

    public putNetwork(network: EncounterNetwork): boolean {
        return this.apply({ kind: 'put-network', expectedRevision: this.#snapshot.revision, network });
    }

    public removeNetwork(networkId: EncounterNetworkId): boolean {
        return this.apply({ kind: 'remove-network', expectedRevision: this.#snapshot.revision, networkId });
    }

    public replaceNetworks(networks: readonly EncounterNetwork[]): boolean {
        return this.apply({ kind: 'replace-networks', expectedRevision: this.#snapshot.revision, networks });
    }

    /** Replaces the complete verified snapshot, e.g. after a sealed force envelope load/save. */
    public restore(snapshot: CBTEncounterSnapshot): void {
        this.#snapshot = freezeSnapshot(snapshot);
        this.#preservedFacts = Object.freeze([]);
    }

    public restoreSerialized(state: SerializedCBTEncounterStateV2): void {
        const decoded = decodeCBTEncounterStateV2(state);
        this.#snapshot = decoded.snapshot;
        this.#preservedFacts = decoded.preservedFacts;
    }

    private apply(command: CBTEncounterCommand): boolean {
        const result = reduceCBTEncounter(this.#snapshot, command);
        if (result.kind === 'rejected') return false;
        this.#snapshot = result.snapshot;
        return true;
    }
}

export function emptyCBTEncounterSnapshot(): CBTEncounterSnapshot {
    return freezeSnapshot({ revision: asStateRevision(0), targets: [], networks: [] });
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

export function asEncounterTargetId(value: string): EncounterTargetId {
    if (!value || value.trim() !== value || value.length > 128 || value.includes('\0')) {
        throw new Error('Invalid encounter target ID');
    }
    return value as EncounterTargetId;
}

export interface DecodedCBTEncounterStateV2 {
    readonly snapshot: CBTEncounterSnapshot;
    /** Typed facts not owned by this target/network reducer remain byte-equivalent facts. */
    readonly preservedFacts: readonly SerializedEncounterFactV2[];
}

export function decodeCBTEncounterStateV2(
    state: SerializedCBTEncounterStateV2,
): DecodedCBTEncounterStateV2 {
    if (state.schemaVersion !== 2) throw new Error('Unsupported encounter state schema');
    const targets: EncounterTarget[] = [];
    const networks: EncounterNetwork[] = [];
    const preservedFacts: SerializedEncounterFactV2[] = [];
    for (const fact of state.facts) {
        if (fact.kind === 'target') {
            if (fact.factId !== encounterTargetFactId(fact.target.id)) throw new Error('Invalid target fact identity');
            targets.push(encounterTargetFromSerialized(fact.target));
        } else if (fact.kind === 'network') {
            if (fact.factId !== encounterNetworkFactId(fact.network.id)) throw new Error('Invalid network fact identity');
            networks.push(encounterNetworkFromSerialized(fact.network));
        } else {
            preservedFacts.push(fact);
        }
    }
    return Object.freeze({
        snapshot: freezeSnapshot({
            revision: asStateRevision(state.encounterRevision),
            targets,
            networks,
        }),
        preservedFacts: Object.freeze([...preservedFacts]),
    });
}

export function encodeCBTEncounterStateV2(
    snapshot: CBTEncounterSnapshot,
    preservedFacts: readonly SerializedEncounterFactV2[] = [],
): SerializedCBTEncounterStateV2 {
    const canonical = freezeSnapshot(snapshot);
    if (preservedFacts.some(fact => fact.kind === 'target' || fact.kind === 'network')) {
        throw new Error('Owned target/network facts cannot be supplied as preserved facts');
    }
    const facts: SerializedEncounterFactV2[] = [
        ...preservedFacts,
        ...canonical.targets.map(target => Object.freeze({
            kind: 'target' as const,
            factId: encounterTargetFactId(target.id),
            target: serializedEncounterTarget(target),
        })),
        ...canonical.networks.map(network => Object.freeze({
            kind: 'network' as const,
            factId: encounterNetworkFactId(network.id),
            network: serializedEncounterNetwork(network),
        })),
    ];
    facts.sort((left, right) => compareStrings(left.factId, right.factId));
    for (let index = 1; index < facts.length; index += 1) {
        if (facts[index - 1].factId === facts[index].factId) throw new Error('Duplicate encounter fact ID');
    }
    return Object.freeze({
        schemaVersion: 2,
        encounterRevision: canonical.revision,
        facts: Object.freeze(facts),
    });
}

function serializedEncounterTarget(target: EncounterTarget): SerializedEncounterTargetV2 {
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

function encounterTargetFromSerialized(target: SerializedEncounterTargetV2): EncounterTarget {
    const record = requirePlainRecord(target as unknown as JsonValue, 'encounter target');
    exactOperationKeys(record, ['id', 'letter', 'name', 'color', 'source', 'readOnly', 'unitType', 'tnCalculator']);
    return freezeTarget({
        id: asEncounterTargetId(requireText(record['id'])),
        letter: requireText(record['letter']),
        name: requireText(record['name']),
        color: requireText(record['color']),
        ...(record['source'] !== undefined && { source: record['source'] as 'manual' | 'opfor' }),
        ...(record['readOnly'] !== undefined && { readOnly: record['readOnly'] as boolean }),
        ...(record['unitType'] !== undefined && { unitType: record['unitType'] as TnTargetUnitType }),
        ...(record['tnCalculator'] !== undefined && {
            tnCalculator: freezeTargetCalculator(record['tnCalculator'] as SerializedEncounterTargetCalculatorV2),
        }),
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
    calculator: SerializedEncounterTargetCalculatorV2,
): SerializedEncounterTargetCalculatorV2 {
    return {
        ...calculator,
        ...(calculator.stealth === undefined || typeof calculator.stealth === 'boolean'
            ? {}
            : { stealth: copyStealth(calculator.stealth) }),
    };
}

function freezeTargetCalculator(
    calculator: SerializedEncounterTargetCalculatorV2,
): SerializedEncounterTargetCalculatorV2 {
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
            .sort((left, right) => compareStrings(endpointKey(left), endpointKey(right)))),
    });
}

function endpointKey(endpoint: EncounterNetworkEndpoint): string {
    return `${endpoint.instanceId}\0${endpoint.componentId}`;
}

function encounterNetworkFromSerialized(network: SerializedEncounterNetworkV2): EncounterNetwork {
    const record = requirePlainRecord(network as unknown as JsonValue, 'encounter network');
    exactOperationKeys(record, ['id', 'networkType', 'color', 'endpoints']);
    return freezeNetwork({
        id: asEncounterNetworkId(requireText(record['id'])),
        networkType: requireText(record['networkType']) as EncounterNetworkType,
        color: requireText(record['color']),
        endpoints: requireList(record['endpoints']).map(raw => {
            const endpoint = requirePlainRecord(raw, 'encounter network endpoint');
            exactOperationKeys(endpoint, ['instanceId', 'componentId', 'role']);
            return Object.freeze({
                instanceId: asUnitInstanceId(requireText(endpoint['instanceId'])),
                componentId: asComponentId(requireText(endpoint['componentId'])),
                role: requireText(endpoint['role']) as EncounterNetworkEndpoint['role'],
            });
        }),
    });
}

function requirePlainRecord(value: JsonValue, label: string): Record<string, JsonValue> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, JsonValue>;
}

function requireList(value: JsonValue | undefined): JsonValue[] {
    if (!Array.isArray(value)) throw new Error('Encounter operation field must be an array');
    return value;
}

function requireText(value: JsonValue | undefined): string {
    if (typeof value !== 'string') throw new Error('Encounter operation field must be a string');
    return value;
}

function exactOperationKeys(record: Readonly<Record<string, JsonValue>>, allowed: readonly string[]): void {
    const keys = new Set(allowed);
    for (const key of Object.keys(record)) if (!keys.has(key)) throw new Error(`Unknown encounter field: ${key}`);
}

function freezeTargetRegistrySnapshot(
    snapshot: Pick<TargetRegistrySnapshot, 'revision' | 'targets'>,
): TargetRegistrySnapshot {
    return Object.freeze({
        revision: snapshot.revision,
        targets: Object.freeze(snapshot.targets.map(target => freezeTarget(target))
            .sort((left, right) => compareStrings(left.letter, right.letter) || compareStrings(left.id, right.id))),
    });
}

function rejectedTargetRegistry(
    snapshot: TargetRegistrySnapshot,
    reason: TargetRegistryRejectionReason,
): TargetRegistryCommandResult {
    return Object.freeze({ accepted: false, changed: false, reason, snapshot });
}

function unchangedTargetRegistry(snapshot: TargetRegistrySnapshot): TargetRegistryCommandResult {
    return Object.freeze({ accepted: true, changed: false, snapshot });
}

function changedTargetRegistry(
    previous: TargetRegistrySnapshot,
    targets: readonly EncounterTarget[],
): TargetRegistryCommandResult {
    if (Number(previous.revision) >= Number.MAX_SAFE_INTEGER) {
        return rejectedTargetRegistry(previous, 'REVISION_EXHAUSTED');
    }
    return Object.freeze({
        accepted: true,
        changed: true,
        previousRevision: previous.revision,
        snapshot: freezeTargetRegistrySnapshot({
            revision: asStateRevision(Number(previous.revision) + 1),
            targets,
        }),
    });
}

function canonicalTargetList(targets: readonly EncounterTarget[]): {
    readonly targets: readonly EncounterTarget[];
    readonly reason?: 'INVALID_TARGET' | 'TARGET_ORIGIN_POLICY';
} {
    const canonical: EncounterTarget[] = [];
    for (const target of targets) {
        const frozen = tryFreezeTarget(target, false);
        if (!frozen) return { targets: Object.freeze([]), reason: 'INVALID_TARGET' };
        canonical.push(frozen);
    }
    const ids = new Set<string>();
    const letters = new Set<string>();
    for (const target of canonical) {
        if (ids.has(target.id) || letters.has(target.letter)) {
            return { targets: Object.freeze([]), reason: 'INVALID_TARGET' };
        }
        ids.add(target.id);
        letters.add(target.letter);
    }
    if (canonical.some(target => !validTargetOrigin(target))) {
        return { targets: Object.freeze([]), reason: 'TARGET_ORIGIN_POLICY' };
    }
    return { targets: freezeTargetRegistrySnapshot({ revision: asStateRevision(0), targets: canonical }).targets };
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
        tnCalculator?: SerializedEncounterTargetCalculatorV2;
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
    left: SerializedEncounterTargetCalculatorV2 | undefined,
    right: SerializedEncounterTargetCalculatorV2 | undefined,
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function freezeSnapshot(snapshot: CBTEncounterSnapshot): CBTEncounterSnapshot {
    return Object.freeze({
        revision: snapshot.revision,
        targets: Object.freeze(snapshot.targets.map(target => freezeTarget(target))
            .sort((left, right) => compareStrings(left.letter, right.letter) || compareStrings(left.id, right.id))),
        networks: Object.freeze(snapshot.networks.map(freezeNetwork)
            .sort((left, right) => compareStrings(left.id, right.id))),
    });
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

export function projectInventoryControlTarget(target: EncounterTarget): InventoryControlRuntimeTarget {
    return {
        ...target,
        distance: 1,
        tnModifier: 0,
        ...(target.tnCalculator && { tnCalculator: copyTargetCalculator(target.tnCalculator) }),
    };
}

function toEncounterTarget(target: Readonly<InventoryControlRuntimeTarget>): EncounterTarget {
    return freezeTarget({
        id: asEncounterTargetId(target.id),
        letter: target.letter,
        name: target.name,
        color: target.color,
        ...(target.source !== undefined && { source: target.source }),
        ...(target.readOnly !== undefined && { readOnly: target.readOnly }),
        ...(target.unitType !== undefined && { unitType: target.unitType }),
        ...(target.tnCalculator && { tnCalculator: sharedCalculator(target.tnCalculator) }),
    });
}

function sharedCalculator(
    calculator: Readonly<InventoryControlRuntimeTarget>['tnCalculator'],
): SerializedEncounterTargetCalculatorV2 {
    return {
        ...(calculator?.isAirborne !== undefined && { isAirborne: calculator.isAirborne }),
        ...(calculator?.targetMovementBracket !== undefined && { targetMovementBracket: calculator.targetMovementBracket }),
        ...(calculator?.targetMovementDistance !== undefined && { targetMovementDistance: calculator.targetMovementDistance }),
        ...(calculator?.skidding !== undefined && { skidding: calculator.skidding }),
        ...(calculator?.prone !== undefined && { prone: calculator.prone }),
        ...(calculator?.immobile !== undefined && { immobile: calculator.immobile }),
        ...(calculator?.targetHexCover !== undefined && { targetHexCover: calculator.targetHexCover }),
        ...(calculator?.waterDepth !== undefined && { waterDepth: calculator.waterDepth }),
        ...(calculator?.buildingCover !== undefined && { buildingCover: calculator.buildingCover }),
        ...(calculator?.targetHeight !== undefined && { targetHeight: calculator.targetHeight }),
        ...(calculator?.largeTarget !== undefined && { largeTarget: calculator.largeTarget }),
        ...(calculator?.narcAboveWater !== undefined && { narcAboveWater: calculator.narcAboveWater }),
        ...(calculator?.narcUnderwater !== undefined && { narcUnderwater: calculator.narcUnderwater }),
        ...(calculator?.tagged !== undefined && { tagged: calculator.tagged }),
        ...(calculator?.ecmShielded !== undefined && { ecmShielded: calculator.ecmShielded }),
        ...(calculator?.stealth !== undefined && {
            stealth: typeof calculator.stealth === 'boolean'
                ? calculator.stealth
                : copyStealth(calculator.stealth),
        }),
        ...(calculator?.stealthSystem !== undefined && { stealthSystem: calculator.stealthSystem }),
    };
}

function validateTargets(targets: Iterable<EncounterTarget>): void {
    const seen = new Set<string>();
    const letters = new Set<string>();
    let count = 0;
    for (const target of targets) {
        count += 1;
        if (seen.has(target.id)) throw new EncounterInputError('invalid-target');
        if (letters.has(target.letter)) throw new EncounterInputError('invalid-target');
        seen.add(target.id);
        letters.add(target.letter);
        validateTarget(target);
    }
    if (count > INVENTORY_CONTROL_TARGET_MAX_COUNT) throw new EncounterInputError('invalid-target');
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

function validSharedTargetCalculator(value: unknown): value is SerializedEncounterTargetCalculatorV2 {
    if (!isPlainRecord(value) || !hasExactKeys(value, [
        'isAirborne', 'targetMovementBracket', 'targetMovementDistance', 'skidding', 'prone', 'immobile',
        'targetHexCover', 'waterDepth', 'buildingCover', 'targetHeight', 'largeTarget',
        'narcAboveWater', 'narcUnderwater', 'tagged', 'ecmShielded', 'stealth', 'stealthSystem',
    ])) return false;
    const calculator = value as SerializedEncounterTargetCalculatorV2;
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
    validateNetwork(network);
    return Object.freeze({
        ...network,
        endpoints: Object.freeze(network.endpoints.map(endpoint => Object.freeze({ ...endpoint }))),
    });
}

function validateNetworks(networks: Iterable<EncounterNetwork>): void {
    const seen = new Set<string>();
    for (const network of networks) {
        if (seen.has(network.id)) throw new EncounterInputError('invalid-network');
        seen.add(network.id);
        validateNetwork(network);
    }
}

function validateNetwork(network: EncounterNetwork): void {
    try { asEncounterNetworkId(network.id); } catch { throw new EncounterInputError('invalid-network'); }
    if (!['c3', 'c3i', 'naval', 'nova'].includes(network.networkType)
        || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(network.color)) {
        throw new EncounterInputError('invalid-network');
    }
    const limit = network.networkType === 'c3' ? 12 : network.networkType === 'nova' ? 3 : 6;
    if (network.endpoints.length < 2 || network.endpoints.length > limit) throw new EncounterInputError('invalid-network');
    const endpoints = new Set<string>();
    const units = new Set<UnitInstanceId>();
    let masters = 0;
    for (const endpoint of network.endpoints) {
        try {
            asUnitInstanceId(endpoint.instanceId);
            asComponentId(endpoint.componentId);
        } catch {
            throw new EncounterInputError('invalid-network');
        }
        if (network.networkType === 'c3') {
            if (endpoint.role === 'peer') throw new EncounterInputError('invalid-network');
            if (endpoint.role === 'master') masters += 1;
        } else if (endpoint.role !== 'peer') {
            throw new EncounterInputError('invalid-network');
        }
        const key = `${endpoint.instanceId}\0${endpoint.componentId}`;
        if (endpoints.has(key) || units.has(endpoint.instanceId)) {
            throw new EncounterInputError('invalid-network');
        }
        endpoints.add(key);
        units.add(endpoint.instanceId);
    }
    if (network.networkType === 'c3' && masters !== 1) throw new EncounterInputError('invalid-network');
}

class EncounterInputError extends Error {
    public constructor(public readonly reason: 'invalid-target' | 'invalid-network') {
        super(reason);
    }
}

function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
