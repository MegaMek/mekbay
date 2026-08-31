// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { jsonValuesEqual } from '../../utils/json-value.util';
import type {
    CBTForceRosterMemberKind,
    CBTForceRosterSnapshot,
    SerializedCBTForceRosterGroupV1,
    SerializedCBTForceRosterMemberV1,
    SerializedCBTForceRosterV1,
} from './cbt-force-roster';
import {
    CBT_FORCE_ROSTER_SCHEMA_VERSION,
    CBT_FORCE_UNASSIGNED_GROUP_ID,
    MAX_CBT_FORCE_ROSTER_METADATA_LENGTH,
    queryCBTForceRoster,
} from './cbt-force-roster';
import {
    asUnitInstanceId,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';
import type { UnitProviderId, UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { SerializedCBTForceV2 } from './persistence-v2';

/** The legacy force model currently enforces this same durable group limit. */
export const MAX_CBT_FORCE_ROSTER_GROUPS = 50;

/** Detached current owner facts. No crew alias is duplicated into structural roster state. */
export interface CBTForceRosterOwnerFact {
    readonly instanceId: UnitInstanceId;
    readonly kind: CBTForceRosterMemberKind;
    readonly unitLabel: string;
    readonly availability: 'ready' | 'deferred';
    readonly source: 'runtime' | 'envelope';
    readonly identity?: Readonly<{ provider: UnitProviderId; uuid: UnitUuid }>;
    readonly battleValue: number | null;
    readonly battleValueBasis: 'current-skilled' | 'pristine' | 'unavailable';
}

/**
 * One detached owner query. Structural membership remains visibly separate
 * from labels/BV, which can change without becoming integrity-bound roster data.
 * Roster schema V1 has no independent counter, so its CAS revision is the
 * enclosing integrity-bound force revision.
 */
export interface CBTForceOwnedRosterSnapshot {
    readonly forceRevision: StateRevision;
    readonly rosterRevision: StateRevision;
    readonly readOnly: boolean;
    readonly structural: CBTForceRosterSnapshot;
    readonly owners: readonly CBTForceRosterOwnerFact[];
}

export type CBTForceOwnedRosterQueryResult =
    | { readonly kind: 'available'; readonly snapshot: CBTForceOwnedRosterSnapshot }
    | {
        readonly kind: 'unavailable';
        readonly reason: 'NO_CANONICAL_ROSTER' | 'OWNER_TOPOLOGY_DRIFT';
        readonly message: string;
    };

export interface CBTForceRosterGroupMetadataPatch {
    /** null clears the sparse field. */
    readonly name?: string | null;
    /** null clears the sparse field. */
    readonly color?: string | null;
    /** null clears the sparse field. */
    readonly formationId?: string | null;
    /** null clears the sparse field. */
    readonly formationTargetGroupId?: string | null;
    /** false clears the sparse true value. */
    readonly formationLock?: boolean;
}

export type CBTForceRosterCommand =
    | {
        readonly kind: 'create-group';
        readonly groupId: string;
        readonly atIndex: number;
        readonly metadata?: CBTForceRosterGroupMetadataPatch;
    }
    | {
        readonly kind: 'update-group';
        readonly groupId: string;
        readonly patch: CBTForceRosterGroupMetadataPatch;
    }
    | {
        readonly kind: 'delete-group';
        readonly groupId: string;
        /** Non-empty groups must relocate explicitly; implicit member deletion is forbidden. */
        readonly relocateMembersToGroupId?: string;
        readonly atMemberIndex?: number;
        readonly removeMembers?: boolean;
    }
    | {
        readonly kind: 'move-member';
        readonly instanceId: UnitInstanceId;
        readonly targetGroupId: string;
        readonly atIndex: number;
    }
    | {
        readonly kind: 'reorder-group';
        readonly groupId: string;
        readonly atIndex: number;
    }
    | {
        readonly kind: 'set-commander';
        readonly instanceId: UnitInstanceId;
        readonly commander: boolean;
    }
    | {
        readonly kind: 'remove-member';
        readonly instanceId: UnitInstanceId;
    };

export type CBTForceRosterPlanRejectionReason =
    | 'INVALID_COMMAND'
    | 'GROUP_ID_COLLISION'
    | 'GROUP_CAPACITY'
    | 'UNKNOWN_GROUP'
    | 'UNKNOWN_MEMBER'
    | 'GROUP_NOT_EMPTY'
    | 'COMMANDER_CONFLICT'
    | 'INVALID_UNASSIGNED_GROUP_OPERATION'
    | 'INVALID_POSITION'
    | 'NO_CHANGE';

export interface CBTForceRosterMutationPlan {
    readonly nextRoster: SerializedCBTForceRosterV1;
    readonly changed: true;
    /** The whole-owner transaction removes these unit entries and their cross-unit evidence too. */
    readonly removedInstanceIds?: readonly UnitInstanceId[];
}

export type CBTForceRosterMutationPlanResult =
    | { readonly kind: 'ready'; readonly plan: CBTForceRosterMutationPlan }
    | {
        readonly kind: 'rejected';
        readonly reason: CBTForceRosterPlanRejectionReason;
    };

export type CBTForceRosterCommandRejectionReason =
    | CBTForceRosterPlanRejectionReason
    | 'READ_ONLY'
    | 'NO_CANONICAL_ROSTER'
    | 'FORCE_CHANGED'
    | 'PERSISTENCE_REJECTED';

export interface CBTForceRosterCommandRejection {
    readonly accepted: false;
    readonly changed: false;
    readonly reason: CBTForceRosterCommandRejectionReason;
}

export type CBTForceRosterCommandResult = CBTForceRosterCommandRejection | {
    readonly accepted: true;
    readonly changed: true;
    readonly forceRevision: StateRevision;
};

export function deferredEnvelopeRosterOwnerFact(
    entry: Extract<SerializedCBTForceV2['units'][number], { readonly kind: 'deferred' }>,
): CBTForceRosterOwnerFact {
    const payload = entry.source.payload;
    const unitLabel = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        && typeof payload['unit'] === 'string' && payload['unit'].trim()
        ? payload['unit'].trim()
        : entry.source.identity.kind === 'unresolved' && entry.source.identity.rawLegacyName.trim()
            ? entry.source.identity.rawLegacyName.trim()
            : String(entry.instanceId);
    return Object.freeze({
        instanceId: entry.instanceId,
        kind: 'deferred',
        unitLabel,
        availability: 'deferred',
        source: 'envelope',
        ...(entry.source.identity.kind === 'resolved'
            ? {
                identity: Object.freeze({
                    provider: entry.source.identity.savedIdentity.provider,
                    uuid: entry.source.identity.savedIdentity.uuid,
                }),
            }
            : {}),
        battleValue: null,
        battleValueBasis: 'unavailable',
    });
}

export function readyEnvelopeRosterOwnerFact(
    entry: Extract<SerializedCBTForceV2['units'][number], { readonly kind: 'ready' }>,
): CBTForceRosterOwnerFact {
    return Object.freeze({
        instanceId: entry.instanceId,
        kind: 'ready',
        unitLabel: `${entry.unit.entity.provider}:${entry.unit.entity.uuid}`,
        availability: 'deferred',
        source: 'envelope',
        identity: Object.freeze({
            provider: entry.unit.entity.provider,
            uuid: entry.unit.entity.uuid,
        }),
        battleValue: null,
        battleValueBasis: 'unavailable',
    });
}

export function buildCBTForceOwnedRosterSnapshot(input: {
    readonly forceId: string;
    readonly forceRevision: StateRevision;
    readonly roster: SerializedCBTForceRosterV1;
    readonly ownerFacts: readonly CBTForceRosterOwnerFact[];
    readonly readOnly: boolean;
}): CBTForceOwnedRosterSnapshot {
    const structural = queryCBTForceRoster(input);
    const factsById = new Map<string, CBTForceRosterOwnerFact>();
    for (const raw of input.ownerFacts) {
        const fact = canonicalOwnerFact(raw);
        if (factsById.has(fact.instanceId)) {
            throw new Error(`Duplicate current roster owner ${fact.instanceId}`);
        }
        factsById.set(fact.instanceId, fact);
    }
    const owners = structural.members.map(member => {
        const fact = factsById.get(member.instanceId);
        if (!fact) throw new Error(`Canonical roster member ${member.instanceId} has no current owner fact`);
        if (fact.kind !== member.kind) {
            throw new Error(`Canonical roster member ${member.instanceId} disagrees with its current kind`);
        }
        factsById.delete(member.instanceId);
        return fact;
    });
    if (factsById.size > 0) {
        throw new Error(`Current owner ${factsById.keys().next().value} is absent from the canonical roster`);
    }
    return Object.freeze({
        forceRevision: input.forceRevision,
        rosterRevision: input.forceRevision,
        readOnly: input.readOnly,
        structural,
        owners: Object.freeze(owners),
    });
}

export interface PrepareCBTForceRosterMutationPlanInput {
    readonly roster: SerializedCBTForceRosterV1;
    readonly command: CBTForceRosterCommand;
    readonly maxGroups?: number;
}

/**
 * @internal Owner-only prepare step. It never seals or installs an envelope,
 * changes a Force/UnitGroup, mutates a sidecar, or emits. CBTForce keeps the
 * returned exact roster behind the force-owner transaction boundary.
 */
export function prepareCBTForceRosterMutationPlan(
    input: PrepareCBTForceRosterMutationPlanInput,
): CBTForceRosterMutationPlanResult {
    let command: CBTForceRosterCommand;
    try {
        command = validateCommand(input.command);
    } catch {
        return rejectedPlan('INVALID_COMMAND');
    }

    const maxGroups = input.maxGroups ?? MAX_CBT_FORCE_ROSTER_GROUPS;
    if (!Number.isSafeInteger(maxGroups) || maxGroups < 0) {
        return rejectedPlan('INVALID_COMMAND');
    }
    let result: { readonly roster: SerializedCBTForceRosterV1; readonly removedInstanceIds?: readonly UnitInstanceId[] }
        | CBTForceRosterPlanRejectionReason;
    try {
        switch (command.kind) {
            case 'create-group':
                result = createGroup(input.roster, command, maxGroups);
                break;
            case 'update-group':
                result = updateGroup(input.roster, command);
                break;
            case 'delete-group':
                result = deleteGroup(input.roster, command);
                break;
            case 'move-member':
                result = moveMember(input.roster, command);
                break;
            case 'reorder-group':
                result = reorderGroup(input.roster, command);
                break;
            case 'set-commander':
                result = setCommander(input.roster, command);
                break;
            case 'remove-member':
                result = removeMember(input.roster, command);
                break;
            default:
                result = 'INVALID_COMMAND';
        }
    } catch {
        result = 'INVALID_COMMAND';
    }
    if (typeof result === 'string') return rejectedPlan(result);
    if (jsonValuesEqual(result.roster, input.roster)) {
        return rejectedPlan('NO_CHANGE');
    }
    return Object.freeze({
        kind: 'ready',
        plan: Object.freeze({
            nextRoster: result.roster,
            changed: true as const,
            ...(result.removedInstanceIds === undefined
                ? {}
                : { removedInstanceIds: result.removedInstanceIds }),
        }),
    });
}

function createGroup(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'create-group' }>,
    maxGroups: number,
): { readonly roster: SerializedCBTForceRosterV1 } | CBTForceRosterPlanRejectionReason {
    if (command.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) return 'INVALID_UNASSIGNED_GROUP_OPERATION';
    if (roster.groups.some(group => group.groupId === command.groupId)) return 'GROUP_ID_COLLISION';
    const regularGroups = roster.groups.filter(group => group.groupId !== CBT_FORCE_UNASSIGNED_GROUP_ID);
    if (regularGroups.length >= maxGroups) return 'GROUP_CAPACITY';
    if (!validInsertIndex(command.atIndex, regularGroups.length)) return 'INVALID_POSITION';
    const metadata = canonicalMetadataPatch(command.metadata ?? {});
    if (!validFormationTarget(roster, command.groupId, metadata.formationTargetGroupId)) {
        return 'UNKNOWN_GROUP';
    }
    const created: SerializedCBTForceRosterGroupV1 = Object.freeze({
        groupId: command.groupId,
        order: command.atIndex,
        ...metadata,
        members: Object.freeze([]),
    });
    const groups = [...roster.groups];
    groups.splice(command.atIndex, 0, created);
    return { roster: freezeRoster(groups) };
}

function updateGroup(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'update-group' }>,
): { readonly roster: SerializedCBTForceRosterV1 } | CBTForceRosterPlanRejectionReason {
    const index = roster.groups.findIndex(group => group.groupId === command.groupId);
    if (index < 0) return 'UNKNOWN_GROUP';
    if (command.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) return 'INVALID_UNASSIGNED_GROUP_OPERATION';
    const patch = canonicalMetadataPatch(command.patch);
    const source = roster.groups[index];
    if (!validFormationTarget(roster, source.groupId, patch.formationTargetGroupId)) {
        return 'UNKNOWN_GROUP';
    }
    const updated: SerializedCBTForceRosterGroupV1 = Object.freeze({
        groupId: source.groupId,
        order: source.order,
        ...metadataWithPatch(source, command.patch, patch),
        members: source.members,
    });
    const groups = [...roster.groups];
    groups[index] = updated;
    return { roster: freezeRoster(groups) };
}

function deleteGroup(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'delete-group' }>,
): { readonly roster: SerializedCBTForceRosterV1; readonly removedInstanceIds?: readonly UnitInstanceId[] }
    | CBTForceRosterPlanRejectionReason {
    const sourceIndex = roster.groups.findIndex(group => group.groupId === command.groupId);
    if (sourceIndex < 0) return 'UNKNOWN_GROUP';
    if (command.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) return 'INVALID_UNASSIGNED_GROUP_OPERATION';
    const source = roster.groups[sourceIndex];
    if (command.removeMembers === true && command.relocateMembersToGroupId !== undefined) {
        return 'INVALID_COMMAND';
    }
    if (source.members.length > 0
        && command.relocateMembersToGroupId === undefined
        && command.removeMembers !== true) {
        return 'GROUP_NOT_EMPTY';
    }
    const groups = [...roster.groups];
    if (command.relocateMembersToGroupId !== undefined) {
        if (command.relocateMembersToGroupId === command.groupId) return 'INVALID_POSITION';
        const targetIndex = groups.findIndex(group => group.groupId === command.relocateMembersToGroupId);
        if (targetIndex < 0) return 'UNKNOWN_GROUP';
        const target = groups[targetIndex];
        if (target.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID
            && source.members.some(member => member.kind === 'deferred')) {
            return 'INVALID_UNASSIGNED_GROUP_OPERATION';
        }
        if (source.members.length > 0
            && [...target.members, ...source.members].filter(member => member.commander === true).length > 1) {
            return 'COMMANDER_CONFLICT';
        }
        const at = command.atMemberIndex ?? target.members.length;
        if (!validInsertIndex(at, target.members.length)) return 'INVALID_POSITION';
        const members = [...target.members];
        members.splice(at, 0, ...source.members);
        groups[targetIndex] = Object.freeze({ ...target, members: freezeMembers(members) });
    } else if (command.atMemberIndex !== undefined) {
        return 'INVALID_COMMAND';
    }
    groups.splice(sourceIndex, 1);
    return {
        roster: freezeRoster(groups),
        ...(command.removeMembers === true && source.members.length > 0
            ? { removedInstanceIds: Object.freeze(source.members.map(member => member.instanceId)) }
            : {}),
    };
}

function moveMember(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'move-member' }>,
): { readonly roster: SerializedCBTForceRosterV1 } | CBTForceRosterPlanRejectionReason {
    const sourceLocation = findMember(roster, command.instanceId);
    if (!sourceLocation) return 'UNKNOWN_MEMBER';
    const targetIndex = roster.groups.findIndex(group => group.groupId === command.targetGroupId);
    if (targetIndex < 0) return 'UNKNOWN_GROUP';
    const groups = [...roster.groups];
    const source = groups[sourceLocation.groupIndex];
    const target = groups[targetIndex];
    const sameGroup = sourceLocation.groupIndex === targetIndex;
    const movingMember = source.members[sourceLocation.memberIndex];
    if (!sameGroup
        && target.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID
        && movingMember.kind === 'deferred') {
        return 'INVALID_UNASSIGNED_GROUP_OPERATION';
    }
    if (!sameGroup
        && movingMember.commander === true
        && target.members.some(member => member.commander === true)) {
        return 'COMMANDER_CONFLICT';
    }
    const targetLengthAfterRemoval = target.members.length - (sameGroup ? 1 : 0);
    if (!validInsertIndex(command.atIndex, targetLengthAfterRemoval)) return 'INVALID_POSITION';
    const sourceMembers = [...source.members];
    const [member] = sourceMembers.splice(sourceLocation.memberIndex, 1);
    if (sameGroup) {
        sourceMembers.splice(command.atIndex, 0, member);
        groups[sourceLocation.groupIndex] = Object.freeze({ ...source, members: freezeMembers(sourceMembers) });
    } else {
        const targetMembers = [...target.members];
        targetMembers.splice(command.atIndex, 0, member);
        groups[sourceLocation.groupIndex] = Object.freeze({ ...source, members: freezeMembers(sourceMembers) });
        groups[targetIndex] = Object.freeze({ ...target, members: freezeMembers(targetMembers) });
    }
    removeEmptyUnassigned(groups);
    return { roster: freezeRoster(groups) };
}

function reorderGroup(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'reorder-group' }>,
): { readonly roster: SerializedCBTForceRosterV1 } | CBTForceRosterPlanRejectionReason {
    const sourceIndex = roster.groups.findIndex(group => group.groupId === command.groupId);
    if (sourceIndex < 0) return 'UNKNOWN_GROUP';
    if (command.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) return 'INVALID_UNASSIGNED_GROUP_OPERATION';
    const regularCount = roster.groups.filter(group => group.groupId !== CBT_FORCE_UNASSIGNED_GROUP_ID).length;
    if (!Number.isSafeInteger(command.atIndex) || command.atIndex < 0 || command.atIndex >= regularCount) {
        return 'INVALID_POSITION';
    }
    const groups = [...roster.groups];
    const [group] = groups.splice(sourceIndex, 1);
    groups.splice(command.atIndex, 0, group);
    return { roster: freezeRoster(groups) };
}

function setCommander(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'set-commander' }>,
): { readonly roster: SerializedCBTForceRosterV1 } | CBTForceRosterPlanRejectionReason {
    const location = findMember(roster, command.instanceId);
    if (!location) return 'UNKNOWN_MEMBER';
    const groups = [...roster.groups];
    const group = groups[location.groupIndex];
    const members = [...group.members];
    for (let index = 0; index < members.length; index += 1) {
        const current = members[index];
        const commander = command.commander
            ? index === location.memberIndex
            : index !== location.memberIndex && current.commander === true;
        members[index] = Object.freeze({
            instanceId: current.instanceId,
            kind: current.kind,
            order: current.order,
            ...(commander ? { commander: true as const } : {}),
        });
    }
    groups[location.groupIndex] = Object.freeze({ ...group, members: freezeMembers(members) });
    return { roster: freezeRoster(groups) };
}

function removeMember(
    roster: SerializedCBTForceRosterV1,
    command: Extract<CBTForceRosterCommand, { readonly kind: 'remove-member' }>,
): { readonly roster: SerializedCBTForceRosterV1; readonly removedInstanceIds: readonly UnitInstanceId[] }
    | CBTForceRosterPlanRejectionReason {
    const location = findMember(roster, command.instanceId);
    if (!location) return 'UNKNOWN_MEMBER';
    const groups = [...roster.groups];
    const group = groups[location.groupIndex];
    const members = [...group.members];
    members.splice(location.memberIndex, 1);
    groups[location.groupIndex] = Object.freeze({ ...group, members: freezeMembers(members) });
    removeEmptyUnassigned(groups);
    return { roster: freezeRoster(groups), removedInstanceIds: Object.freeze([command.instanceId]) };
}

function validateCommand(value: unknown): CBTForceRosterCommand {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid command');
    const detached = deepFreezeCommand(structuredClone(value));
    return validateDetachedCommand(detached);
}

function validateDetachedCommand(detached: unknown): CBTForceRosterCommand {
    if (detached === null || typeof detached !== 'object' || Array.isArray(detached)) {
        throw new Error('Invalid command');
    }
    const record = detached as Record<string, unknown>;
    const kind = record['kind'];
    switch (kind) {
        case 'create-group':
            exactKeys(record, ['kind', 'groupId', 'atIndex', 'metadata']);
            validateGroupId(record['groupId']);
            requireInteger(record['atIndex']);
            if (record['metadata'] !== undefined) validateMetadataPatch(record['metadata']);
            break;
        case 'update-group':
            exactKeys(record, ['kind', 'groupId', 'patch']);
            validateGroupId(record['groupId']);
            validateMetadataPatch(record['patch']);
            break;
        case 'delete-group':
            exactKeys(record, [
                'kind', 'groupId', 'relocateMembersToGroupId', 'atMemberIndex', 'removeMembers',
            ]);
            validateGroupId(record['groupId']);
            if (record['relocateMembersToGroupId'] !== undefined) validateGroupId(record['relocateMembersToGroupId']);
            if (record['atMemberIndex'] !== undefined) requireInteger(record['atMemberIndex']);
            if (record['removeMembers'] !== undefined && typeof record['removeMembers'] !== 'boolean') {
                throw new Error('Invalid removeMembers');
            }
            break;
        case 'move-member':
            exactKeys(record, ['kind', 'instanceId', 'targetGroupId', 'atIndex']);
            asUnitInstanceId(requireString(record['instanceId']));
            validateGroupId(record['targetGroupId']);
            requireInteger(record['atIndex']);
            break;
        case 'reorder-group':
            exactKeys(record, ['kind', 'groupId', 'atIndex']);
            validateGroupId(record['groupId']);
            requireInteger(record['atIndex']);
            break;
        case 'set-commander':
            exactKeys(record, ['kind', 'instanceId', 'commander']);
            asUnitInstanceId(requireString(record['instanceId']));
            if (typeof record['commander'] !== 'boolean') throw new Error('Invalid commander');
            break;
        case 'remove-member':
            exactKeys(record, ['kind', 'instanceId']);
            asUnitInstanceId(requireString(record['instanceId']));
            break;
        default:
            throw new Error('Unknown command');
    }
    return detached as CBTForceRosterCommand;
}

function validateMetadataPatch(value: unknown): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata patch');
    const record = value as Record<string, unknown>;
    noExtraKeys(record, ['name', 'color', 'formationId', 'formationTargetGroupId', 'formationLock']);
    for (const key of ['name', 'color', 'formationId', 'formationTargetGroupId'] as const) {
        const candidate = record[key];
        if (candidate !== undefined && candidate !== null && typeof candidate !== 'string') {
            throw new Error(`Invalid ${key}`);
        }
    }
    if (record['formationLock'] !== undefined && typeof record['formationLock'] !== 'boolean') {
        throw new Error('Invalid formationLock');
    }
}

function canonicalMetadataPatch(patch: CBTForceRosterGroupMetadataPatch): Partial<SerializedCBTForceRosterGroupV1> {
    const output: {
        name?: string;
        color?: string;
        formationId?: string;
        formationTargetGroupId?: string;
        formationLock?: true;
    } = {};
    for (const key of ['name', 'color', 'formationId', 'formationTargetGroupId'] as const) {
        if (patch[key] === undefined || patch[key] === null) continue;
        const value = patch[key]!.trim();
        if (!value || value.includes('\0') || value.length > MAX_CBT_FORCE_ROSTER_METADATA_LENGTH) {
            throw new Error(`Invalid ${key}`);
        }
        output[key] = value;
    }
    if (patch.formationLock === true) output.formationLock = true;
    return output;
}

function metadataWithPatch(
    source: SerializedCBTForceRosterGroupV1,
    requested: CBTForceRosterGroupMetadataPatch,
    patch: Partial<SerializedCBTForceRosterGroupV1>,
): Partial<SerializedCBTForceRosterGroupV1> {
    const output: {
        name?: string;
        color?: string;
        formationId?: string;
        formationTargetGroupId?: string;
        formationLock?: true;
    } = {
        ...(source.name === undefined ? {} : { name: source.name }),
        ...(source.color === undefined ? {} : { color: source.color }),
        ...(source.formationId === undefined ? {} : { formationId: source.formationId }),
        ...(source.formationTargetGroupId === undefined
            ? {}
            : { formationTargetGroupId: source.formationTargetGroupId }),
        ...(source.formationLock === undefined ? {} : { formationLock: source.formationLock }),
    };
    for (const key of ['name', 'color', 'formationId', 'formationTargetGroupId', 'formationLock'] as const) {
        if (!Object.prototype.hasOwnProperty.call(requested, key)) continue;
        delete output[key];
        const next = patch[key];
        if (next !== undefined) Object.assign(output, { [key]: next });
    }
    return output;
}

function freezeRoster(groups: readonly SerializedCBTForceRosterGroupV1[]): SerializedCBTForceRosterV1 {
    const regular = groups.filter(group => group.groupId !== CBT_FORCE_UNASSIGNED_GROUP_ID);
    const unassigned = groups.find(group => group.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID);
    const ordered = unassigned ? [...regular, unassigned] : regular;
    const groupIds = new Set(regular.map(group => group.groupId));
    return Object.freeze({
        schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
        groups: Object.freeze(ordered.map((group, order) => Object.freeze({
            groupId: group.groupId,
            order,
            ...(group.name === undefined ? {} : { name: group.name }),
            ...(group.color === undefined ? {} : { color: group.color }),
            ...(group.formationId === undefined ? {} : { formationId: group.formationId }),
            ...(group.formationTargetGroupId === undefined
                || group.formationTargetGroupId === group.groupId
                || !groupIds.has(group.formationTargetGroupId)
                ? {}
                : { formationTargetGroupId: group.formationTargetGroupId }),
            ...(group.formationLock === undefined ? {} : { formationLock: group.formationLock }),
            members: freezeMembers(group.members),
        }))),
    });
}

function validFormationTarget(
    roster: SerializedCBTForceRosterV1,
    ownerGroupId: string,
    targetGroupId: string | undefined,
): boolean {
    return targetGroupId === undefined
        || (targetGroupId !== ownerGroupId
            && targetGroupId !== CBT_FORCE_UNASSIGNED_GROUP_ID
            && roster.groups.some(group => group.groupId === targetGroupId));
}

function freezeMembers(members: readonly SerializedCBTForceRosterMemberV1[]): readonly SerializedCBTForceRosterMemberV1[] {
    return Object.freeze(members.map((member, order) => Object.freeze({
        instanceId: member.instanceId,
        kind: member.kind,
        order,
        ...(member.commander === undefined ? {} : { commander: member.commander }),
    })));
}

function findMember(roster: SerializedCBTForceRosterV1, instanceId: UnitInstanceId): {
    readonly groupIndex: number;
    readonly memberIndex: number;
} | null {
    for (let groupIndex = 0; groupIndex < roster.groups.length; groupIndex += 1) {
        const memberIndex = roster.groups[groupIndex].members.findIndex(member => member.instanceId === instanceId);
        if (memberIndex >= 0) return { groupIndex, memberIndex };
    }
    return null;
}

function removeEmptyUnassigned(groups: SerializedCBTForceRosterGroupV1[]): void {
    const index = groups.findIndex(group => group.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID);
    if (index >= 0 && groups[index].members.length === 0) groups.splice(index, 1);
}

function canonicalOwnerFact(raw: CBTForceRosterOwnerFact): CBTForceRosterOwnerFact {
    const instanceId = asUnitInstanceId(String(raw.instanceId));
    if (raw.kind !== 'ready' && raw.kind !== 'deferred') throw new Error('Invalid owner kind');
    const unitLabel = raw.unitLabel.trim();
    if (!unitLabel || unitLabel.includes('\0') || unitLabel.length > MAX_CBT_FORCE_ROSTER_METADATA_LENGTH) {
        throw new Error(`Invalid current owner label for ${instanceId}`);
    }
    if (raw.availability !== 'ready' && raw.availability !== 'deferred') throw new Error('Invalid owner availability');
    if (!['runtime', 'envelope'].includes(raw.source)) {
        throw new Error('Invalid owner source');
    }
    if (raw.battleValue !== null
        && (!Number.isSafeInteger(raw.battleValue) || raw.battleValue < 0)) {
        throw new Error(`Invalid current owner battle value for ${instanceId}`);
    }
    if (!['current-skilled', 'pristine', 'unavailable'].includes(raw.battleValueBasis)) {
        throw new Error('Invalid battle-value basis');
    }
    if ((raw.battleValue === null) !== (raw.battleValueBasis === 'unavailable')) {
        throw new Error(`Current owner ${instanceId} has inconsistent battle-value facts`);
    }
    return Object.freeze({
        instanceId,
        kind: raw.kind,
        unitLabel,
        availability: raw.availability,
        source: raw.source,
        battleValue: raw.battleValue,
        battleValueBasis: raw.battleValueBasis,
    });
}

function validateGroupId(value: unknown): string {
    const id = requireString(value);
    if (!id.trim() || id.includes('\0') || id.length > MAX_CBT_FORCE_ROSTER_METADATA_LENGTH) {
        throw new Error('Invalid group ID');
    }
    return id;
}

function validInsertIndex(value: number, length: number): boolean {
    return Number.isSafeInteger(value) && value >= 0 && value <= length;
}

function requireString(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Expected string');
    return value;
}

function requireInteger(value: unknown): number {
    if (typeof value !== 'number') throw new Error('Expected number');
    const number = value;
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Expected non-negative integer');
    return number;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
    const expected = new Set(allowed);
    if (Object.keys(record).some(key => !expected.has(key))) throw new Error('Unexpected command field');
}

function noExtraKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
    const expected = new Set(allowed);
    if (Object.keys(record).some(key => !expected.has(key))) throw new Error('Unexpected command field');
}

function rejectedPlan(
    reason: CBTForceRosterPlanRejectionReason,
): Extract<CBTForceRosterMutationPlanResult, { readonly kind: 'rejected' }> {
    return Object.freeze({
        kind: 'rejected',
        reason,
    });
}

function deepFreezeCommand<T>(value: T): T {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    if (Array.isArray(value)) {
        value.forEach(entry => deepFreezeCommand(entry));
    } else {
        Object.values(value as Record<string, unknown>).forEach(entry => deepFreezeCommand(entry));
    }
    return Object.freeze(value);
}
