// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    buildCBTForceOwnedRosterSnapshot,
    prepareCBTForceRosterMutationPlan,
    type CBTForceRosterCommand,
} from './cbt-force-roster-owner';
import type { SerializedCBTForceRosterV1 } from './cbt-force-roster';
import {
    asStateRevision,
    asUnitInstanceId,
} from './runtime-state';

const REVISION = asStateRevision(7);
const A = asUnitInstanceId('unit:a');
const B = asUnitInstanceId('unit:b');
const C = asUnitInstanceId('unit:c');

describe('CBT force canonical roster owner boundary', () => {
    it('keeps detached current owner facts separate from frozen structural membership', () => {
        const roster = sourceRoster();
        const result = buildCBTForceOwnedRosterSnapshot({
            forceId: 'force:owner',
            forceRevision: REVISION,
            roster,
            readOnly: false,
            ownerFacts: [
                owner(A, 'deferred', 'Atlas AS7-D', 1897, 'current-skilled'),
                owner(B, 'ready', 'Marauder MAD-3R', 1363, 'pristine'),
                owner(C, 'ready', 'Locust LCT-1V', null, 'unavailable'),
            ],
        });

        expect(result.forceRevision).toBe(REVISION);
        expect(result.rosterRevision).toBe(REVISION);
        expect(result.structural.groups[0].name).toBe('Alpha');
        expect(result.structural.members.map(row => row.instanceId)).toEqual([A, B, C]);
        expect(result.owners.map(row => [row.unitLabel, row.battleValue])).toEqual([
            ['Atlas AS7-D', 1897],
            ['Marauder MAD-3R', 1363],
            ['Locust LCT-1V', null],
        ]);
        expect(JSON.stringify(result.structural)).not.toContain('Atlas AS7-D');
        expect(Object.isFrozen(result)).toBeTrue();
        expect(Object.isFrozen(result.structural.groups[0].members[0])).toBeTrue();
        expect(Object.isFrozen(result.owners[0])).toBeTrue();
    });

    it('rejects duplicate, missing, extra, and mismatched current owners', () => {
        const base = {
            forceId: 'force:owner', forceRevision: REVISION, roster: sourceRoster(), readOnly: false,
        };
        const a = owner(A, 'deferred', 'A', 1, 'current-skilled');
        const b = owner(B, 'ready', 'B', 2, 'pristine');
        const c = owner(C, 'ready', 'C', null, 'unavailable');
        expect(() => buildCBTForceOwnedRosterSnapshot({ ...base, ownerFacts: [a, a, b, c] }))
            .toThrowError(/Duplicate current roster owner/u);
        expect(() => buildCBTForceOwnedRosterSnapshot({ ...base, ownerFacts: [a, b] }))
            .toThrowError(/has no current owner fact/u);
        expect(() => buildCBTForceOwnedRosterSnapshot({
            ...base,
            ownerFacts: [a, b, c, owner(asUnitInstanceId('unit:extra'), 'ready', 'Extra', 1, 'pristine')],
        })).toThrowError(/absent from the canonical roster/u);
        expect(() => buildCBTForceOwnedRosterSnapshot({
            ...base,
            ownerFacts: [owner(A, 'ready', 'A', 1, 'pristine'), b, c],
        })).toThrowError(/disagrees with its current kind/u);
    });

    it('prepares exact create/update/delete group rosters without touching the source', () => {
        const original = sourceRoster();
        const created = ready(command('create-group', {
            groupId: 'group:new', atIndex: 1,
            metadata: { name: '  New Lance  ', color: '#abcdef', formationLock: true },
        }), original);
        expect(created.nextRoster.groups.map(group => [group.groupId, group.order])).toEqual([
            ['group:alpha', 0], ['group:new', 1], ['group:beta', 2], ['cbt:unassigned', 3],
        ]);
        expect(created.nextRoster.groups[1]).toEqual(jasmine.objectContaining({
            name: 'New Lance', color: '#abcdef', formationLock: true,
        }));
        expect(original.groups.map(group => group.groupId)).toEqual([
            'group:alpha', 'group:beta', 'cbt:unassigned',
        ]);

        const updated = ready(command('update-group', {
            groupId: 'group:alpha',
            patch: {
                name: null,
                color: '#123456',
                formationTargetGroupId: 'group:new',
                formationLock: false,
            },
        }), created.nextRoster);
        expect(updated.nextRoster.groups[0].name).toBeUndefined();
        expect(updated.nextRoster.groups[0].color).toBe('#123456');
        expect(updated.nextRoster.groups[0].formationTargetGroupId).toBe('group:new');
        expect(updated.nextRoster.groups[0].formationLock).toBeUndefined();

        const deleted = ready(command('delete-group', { groupId: 'group:new' }), updated.nextRoster);
        expect(deleted.nextRoster.groups.map(group => group.groupId)).toEqual([
            'group:alpha', 'group:beta', 'cbt:unassigned',
        ]);
        expect(deleted.nextRoster.groups[0].formationTargetGroupId).toBeUndefined();
        expect(Object.isFrozen(deleted.nextRoster.groups)).toBeTrue();
    });

    it('prepares member moves, group reorder, sparse commander, relocation, and explicit removal', () => {
        const moved = ready(command('move-member', {
            instanceId: C, targetGroupId: 'group:alpha', atIndex: 1,
        }), sourceRoster());
        expect(moved.nextRoster.groups.map(group => group.groupId)).toEqual(['group:alpha', 'group:beta']);
        expect(moved.nextRoster.groups[0].members.map(member => [member.instanceId, member.order])).toEqual([
            [A, 0], [C, 1],
        ]);

        const reordered = ready(command('reorder-group', {
            groupId: 'group:beta', atIndex: 0,
        }), moved.nextRoster);
        expect(reordered.nextRoster.groups.map(group => [group.groupId, group.order])).toEqual([
            ['group:beta', 0], ['group:alpha', 1],
        ]);

        const commanded = ready(command('set-commander', { instanceId: C, commander: true }), reordered.nextRoster);
        expect(commanded.nextRoster.groups[1].members[1].commander).toBeTrue();
        expect(commanded.nextRoster.groups[1].members[0].commander).toBeUndefined();
        expectSealRosterInvariants(commanded.nextRoster);
        const cleared = ready(command('set-commander', { instanceId: C, commander: false }), commanded.nextRoster);
        expect(cleared.nextRoster.groups[1].members[1].commander).toBeUndefined();
        expect(cleared.nextRoster.groups[1].members[0].commander).toBeUndefined();
        expect(Object.keys(cleared.nextRoster.groups[1].members[1])).not.toContain('commander');
        expectSealRosterInvariants(cleared.nextRoster);

        const hostileDuplicateCommander: SerializedCBTForceRosterV1 = Object.freeze({
            schemaVersion: 1,
            groups: Object.freeze(commanded.nextRoster.groups.map(group => group.groupId !== 'group:alpha'
                ? group
                : Object.freeze({
                    ...group,
                    members: Object.freeze(group.members.map(member => Object.freeze({
                        ...member,
                        ...(member.instanceId === A ? { commander: true as const } : {}),
                    }))),
                }))),
        });
        const repaired = ready(command('set-commander', {
            instanceId: C, commander: false,
        }), hostileDuplicateCommander);
        expect(repaired.nextRoster.groups[1].members[0].commander).toBeTrue();
        expect(repaired.nextRoster.groups[1].members[1].commander).toBeUndefined();
        expectSealRosterInvariants(repaired.nextRoster);

        const relocated = ready(command('delete-group', {
            groupId: 'group:beta', relocateMembersToGroupId: 'group:alpha', atMemberIndex: 1,
        }), cleared.nextRoster);
        expect(relocated.nextRoster.groups).toHaveSize(1);
        expect(relocated.nextRoster.groups[0].members.map(member => member.instanceId)).toEqual([A, B, C]);

        const removed = ready(command('remove-member', { instanceId: B }), relocated.nextRoster);
        expect(removed.removedInstanceIds).toEqual([B]);
        expect(removed.nextRoster.groups[0].members.map(member => [member.instanceId, member.order]))
            .toEqual([[A, 0], [C, 1]]);
        expectSealRosterInvariants(removed.nextRoster);
    });

    it('rejects plans that violate unassigned-kind or destination commander invariants', () => {
        const roster = sourceRoster();
        expect(reject(command('move-member', {
            instanceId: A, targetGroupId: 'cbt:unassigned', atIndex: 1,
        }), roster)).toBe('INVALID_UNASSIGNED_GROUP_OPERATION');
        expect(reject(command('delete-group', {
            groupId: 'group:alpha', relocateMembersToGroupId: 'cbt:unassigned', atMemberIndex: 0,
        }), roster)).toBe('INVALID_UNASSIGNED_GROUP_OPERATION');

        const targetCommander = ready(command('set-commander', {
            instanceId: B, commander: true,
        }), roster).nextRoster;
        expectSealRosterInvariants(targetCommander);
        expect(reject(command('move-member', {
            instanceId: A, targetGroupId: 'group:beta', atIndex: 1,
        }), targetCommander)).toBe('COMMANDER_CONFLICT');
        expect(reject(command('delete-group', {
            groupId: 'group:alpha', relocateMembersToGroupId: 'group:beta', atMemberIndex: 1,
        }), targetCommander)).toBe('COMMANDER_CONFLICT');

        const clearedSourceCommander = ready(command('set-commander', {
            instanceId: A, commander: false,
        }), targetCommander).nextRoster;
        const moved = ready(command('move-member', {
            instanceId: A, targetGroupId: 'group:beta', atIndex: 1,
        }), clearedSourceCommander).nextRoster;
        expectSealRosterInvariants(moved);

        const relocatedV2 = ready(command('delete-group', {
            groupId: 'group:beta', relocateMembersToGroupId: 'cbt:unassigned', atMemberIndex: 0,
        }), roster).nextRoster;
        expect(relocatedV2.groups.at(-1)?.members.map(member => member.instanceId)).toEqual([B, C]);
        expectSealRosterInvariants(relocatedV2);
    });

    it('rejects stale, collision, capacity, unknown, unsafe-delete, invalid-position, and no-op plans', () => {
        const roster = sourceRoster();
        expect(reject(command('create-group', {
            groupId: 'group:alpha', atIndex: 0,
        }), roster)).toBe('GROUP_ID_COLLISION');
        expect(prepareCBTForceRosterMutationPlan({
            roster,
            maxGroups: 2,
            command: command('create-group', { groupId: 'group:new', atIndex: 0 }),
        })).toEqual(jasmine.objectContaining({ kind: 'rejected', reason: 'GROUP_CAPACITY' }));
        expect(reject(command('move-member', {
            instanceId: asUnitInstanceId('unit:missing'), targetGroupId: 'group:alpha', atIndex: 0,
        }), roster)).toBe('UNKNOWN_MEMBER');
        expect(reject(command('move-member', {
            instanceId: A, targetGroupId: 'group:missing', atIndex: 0,
        }), roster)).toBe('UNKNOWN_GROUP');
        expect(reject(command('update-group', {
            groupId: 'group:alpha', patch: { formationTargetGroupId: 'group:alpha' },
        }), roster)).toBe('UNKNOWN_GROUP');
        expect(reject(command('update-group', {
            groupId: 'group:alpha', patch: { formationTargetGroupId: 'group:missing' },
        }), roster)).toBe('UNKNOWN_GROUP');
        expect(reject(command('delete-group', { groupId: 'group:alpha' }), roster)).toBe('GROUP_NOT_EMPTY');
        const deletedWithMembers = ready(command('delete-group', {
            groupId: 'group:alpha', removeMembers: true,
        }), roster);
        expect(deletedWithMembers.removedInstanceIds).toEqual([A]);
        expect(deletedWithMembers.nextRoster.groups.map(group => group.groupId))
            .toEqual(['group:beta', 'cbt:unassigned']);
        expect(reject(command('reorder-group', {
            groupId: 'cbt:unassigned', atIndex: 0,
        }), roster)).toBe('INVALID_UNASSIGNED_GROUP_OPERATION');
        expect(reject(command('move-member', {
            instanceId: A, targetGroupId: 'group:alpha', atIndex: 99,
        }), roster)).toBe('INVALID_POSITION');
        expect(reject(command('set-commander', { instanceId: A, commander: true }), roster)).toBe('NO_CHANGE');
    });

    it('rejects hostile unknown fields and malformed metadata without producing a plan', () => {
        const extra = {
            ...command('remove-member', { instanceId: A }),
            kind: 'ready',
        } as unknown as CBTForceRosterCommand;
        expect(reject(extra, sourceRoster())).toBe('INVALID_COMMAND');
        expect(reject(command('update-group', {
            groupId: 'group:alpha', patch: { name: '\0bad' },
        }), sourceRoster())).toBe('INVALID_COMMAND');
    });

    it('detaches caller-owned command data before producing a plan', () => {
        const callerGroupId = 'group:gamma';
        const callerName = '  Gamma Lance  ';
        const request = {
            kind: 'create-group' as const,
            groupId: callerGroupId,
            atIndex: 1,
            metadata: { name: callerName },
        };

        const planned = ready(request, sourceRoster());
        request.metadata.name = 'changed after planning';
        expect(planned.nextRoster.groups[1].groupId).toBe(callerGroupId);
        expect(planned.nextRoster.groups[1].name).toBe('Gamma Lance');
    });
});

function sourceRoster(): SerializedCBTForceRosterV1 {
    return Object.freeze({
        schemaVersion: 1,
        groups: Object.freeze([
            Object.freeze({
                groupId: 'group:alpha', order: 0, name: 'Alpha', formationLock: true as const,
                members: Object.freeze([
                    Object.freeze({ instanceId: A, kind: 'deferred' as const, order: 0, commander: true as const }),
                ]),
            }),
            Object.freeze({
                groupId: 'group:beta', order: 1,
                members: Object.freeze([
                    Object.freeze({ instanceId: B, kind: 'ready' as const, order: 0 }),
                ]),
            }),
            Object.freeze({
                groupId: 'cbt:unassigned', order: 2,
                members: Object.freeze([
                    Object.freeze({ instanceId: C, kind: 'ready' as const, order: 0 }),
                ]),
            }),
        ]),
    });
}

function owner(
    instanceId: ReturnType<typeof asUnitInstanceId>,
    kind: 'deferred' | 'ready',
    unitLabel: string,
    battleValue: number | null,
    battleValueBasis: 'current-skilled' | 'pristine' | 'unavailable',
) {
    return {
        instanceId,
        kind,
        unitLabel,
        availability: battleValue === null ? 'deferred' as const : 'ready' as const,
        source: kind === 'deferred' ? 'envelope' as const : 'runtime' as const,
        battleValue,
        battleValueBasis,
    };
}

function command<K extends CBTForceRosterCommand['kind']>(
    kind: K,
    fields: Omit<Extract<CBTForceRosterCommand, { readonly kind: K }>,
        'kind'>,
): Extract<CBTForceRosterCommand, { readonly kind: K }> {
    return {
        kind,
        ...fields,
    } as Extract<CBTForceRosterCommand, { readonly kind: K }>;
}

function ready(commandValue: CBTForceRosterCommand, roster: SerializedCBTForceRosterV1) {
    const result = prepareCBTForceRosterMutationPlan({ roster, command: commandValue });
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(`Expected ready plan, received ${result.reason}`);
    expect(result.plan.changed).toBeTrue();
    return result.plan;
}

function reject(commandValue: CBTForceRosterCommand, roster: SerializedCBTForceRosterV1) {
    const result = prepareCBTForceRosterMutationPlan({ roster, command: commandValue });
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') throw new Error('Expected rejected plan');
    return result.reason;
}

function expectSealRosterInvariants(roster: SerializedCBTForceRosterV1): void {
    const unassigned = roster.groups.find(group => group.groupId === 'cbt:unassigned');
    expect(unassigned?.members.every(member => member.kind === 'ready') ?? true)
        .withContext('the reserved unassigned group may contain only ready members')
        .toBeTrue();
    for (const group of roster.groups) {
        expect(group.members.filter(member => member.commander === true).length)
            .withContext(`group ${group.groupId} may have at most one commander`)
            .toBeLessThanOrEqual(1);
    }
}
