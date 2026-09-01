// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later


export const CBT_FORCE_ROSTER_SCHEMA_VERSION = 1 as const;
export const CBT_FORCE_UNASSIGNED_GROUP_ID = 'cbt:unassigned' as const;
export const MAX_CBT_FORCE_ROSTER_METADATA_LENGTH = 512;

export type CBTForceRosterValidationCode = 'ROSTER_COMMANDER_CONFLICT';

/** A roster cannot contain multiple commanders in the same group. */
export class CBTForceRosterValidationError extends Error {
    public constructor(
        public readonly code: CBTForceRosterValidationCode,
        public readonly path: string,
        message: string,
    ) {
        super(`${path}: ${message}`);
        this.name = 'CBTForceRosterValidationError';
    }
}

export interface CBTForceRosterUnitBinding {
    readonly instanceId: string;
    readonly commander?: true;
}

export interface SerializedCBTForceRosterMemberV1 {
    readonly instanceId: string;
    readonly order: number;
    /** Sparse mutable organizational fact; false is represented by absence. */
    readonly commander?: true;
}

export interface SerializedCBTForceRosterGroupV1 {
    readonly groupId: string;
    readonly order: number;
    readonly name?: string;
    readonly color?: string;
    readonly formationId?: string;
    readonly formationTargetGroupId?: string;
    /** Sparse mutable organizational fact; false is represented by absence. */
    readonly formationLock?: true;
    readonly members: readonly SerializedCBTForceRosterMemberV1[];
}

/** Integrity-bound structural membership. Array order and explicit ordinals must agree. */
export interface SerializedCBTForceRosterV1 {
    readonly schemaVersion: 1;
    readonly groups: readonly SerializedCBTForceRosterGroupV1[];
}

export interface CBTForceRosterMemberRow {
    readonly instanceId: string;
    readonly groupId: string;
    readonly groupOrder: number;
    readonly memberOrder: number;
    readonly commander?: true;
}

export interface CBTForceRosterGroupRow {
    readonly groupId: string;
    readonly groupOrder: number;
    readonly name?: string;
    readonly color?: string;
    readonly formationId?: string;
    readonly formationTargetGroupId?: string;
    readonly formationLock?: true;
    readonly members: readonly CBTForceRosterMemberRow[];
}

/** Detached query result: no ForceUnit, Ready unit, runtime, profile, or bridge escapes. */
export interface CBTForceRosterSnapshot {
    readonly schemaVersion: 1;
    readonly forceId: string;
    readonly forceRevision: number;
    readonly groups: readonly CBTForceRosterGroupRow[];
    readonly members: readonly CBTForceRosterMemberRow[];
}

export interface CBTForceRosterEnvelopeView {
    readonly forceId: string;
    readonly forceRevision: number;
    readonly roster: SerializedCBTForceRosterV1;
}

/** Adds an internally admitted V2 entry without selecting or exposing an owner in UI. */
export function appendUnassignedCBTForceRosterMember(
    roster: SerializedCBTForceRosterV1,
    member: CBTForceRosterUnitBinding,
): SerializedCBTForceRosterV1 {
    return appendCBTForceRosterMember(roster, member, CBT_FORCE_UNASSIGNED_GROUP_ID);
}

/** Adds one V2 member to an exact canonical roster group without exposing a ForceUnit shell. */
export function appendCBTForceRosterMember(
    roster: SerializedCBTForceRosterV1,
    member: CBTForceRosterUnitBinding,
    groupId: string,
    atIndex?: number,
): SerializedCBTForceRosterV1 {
    if (roster.groups.some(group => group.members.some(row => row.instanceId === member.instanceId))) {
        throw new Error(`Force roster already contains ${member.instanceId}`);
    }
    const normalizedGroupId = groupId.trim();
    if (!normalizedGroupId || normalizedGroupId.includes('\0')) {
        throw new Error('Force roster target group ID is invalid');
    }
    const existingIndex = roster.groups.findIndex(group => group.groupId === normalizedGroupId);
    if (existingIndex < 0) {
        if (normalizedGroupId !== CBT_FORCE_UNASSIGNED_GROUP_ID) {
            throw new Error(`Force roster group ${normalizedGroupId} does not exist`);
        }
        return Object.freeze({
            schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
            groups: Object.freeze([
                ...roster.groups,
                Object.freeze({
                    groupId: CBT_FORCE_UNASSIGNED_GROUP_ID,
                    order: roster.groups.length,
                    members: Object.freeze([freezeMember(member, 0)]),
                }),
            ]),
        });
    }
    const existing = roster.groups[existingIndex];
    const insertAt = atIndex ?? existing.members.length;
    if (!Number.isSafeInteger(insertAt) || insertAt < 0 || insertAt > existing.members.length) {
        throw new Error(`Force roster member index ${insertAt} is invalid`);
    }
    const groups = roster.groups.map((group, index) => index !== existingIndex
        ? group
        : Object.freeze({
            ...existing,
            members: Object.freeze([
                ...existing.members.slice(0, insertAt),
                freezeMember(member, insertAt),
                ...existing.members.slice(insertAt),
            ].map((entry, order) => freezeMember(entry, order))),
        }));
    return Object.freeze({
        schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
        groups: Object.freeze(groups),
    });
}

export function queryCBTForceRoster(view: CBTForceRosterEnvelopeView): CBTForceRosterSnapshot {
    const groups = view.roster.groups.map(group => {
        const members = group.members.map(member => Object.freeze({
            instanceId: member.instanceId,
            groupId: group.groupId,
            groupOrder: group.order,
            memberOrder: member.order,
            ...(member.commander === undefined ? {} : { commander: member.commander }),
        }));
        return Object.freeze({
            groupId: group.groupId,
            groupOrder: group.order,
            ...(group.name === undefined ? {} : { name: group.name }),
            ...(group.color === undefined ? {} : { color: group.color }),
            ...(group.formationId === undefined ? {} : { formationId: group.formationId }),
            ...(group.formationTargetGroupId === undefined
                ? {}
                : { formationTargetGroupId: group.formationTargetGroupId }),
            ...(group.formationLock === undefined ? {} : { formationLock: group.formationLock }),
            members: Object.freeze(members),
        });
    });
    return Object.freeze({
        schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
        forceId: view.forceId,
        forceRevision: view.forceRevision,
        groups: Object.freeze(groups),
        members: Object.freeze(groups.flatMap(group => group.members)),
    });
}

function freezeMember(
    binding: CBTForceRosterUnitBinding,
    order: number,
): SerializedCBTForceRosterMemberV1 {
    return Object.freeze({
        instanceId: binding.instanceId,
        order,
        ...(binding.commander === undefined ? {} : { commander: binding.commander }),
    });
}
