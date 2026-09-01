// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    CBT_FORCE_UNASSIGNED_GROUP_ID,
    appendCBTForceRosterMember,
    appendUnassignedCBTForceRosterMember,
    queryCBTForceRoster,
    type SerializedCBTForceRosterV1,
} from './cbt-force-roster';

const A = 'unit:a';
const B = 'unit:b';
const C = 'unit:c';

describe('CBT force roster', () => {
    it('appends a member to an existing group without mutating the source', () => {
        const source = roster();
        const updated = appendCBTForceRosterMember(source, {
            instanceId: C,
            commander: true,
        }, 'group:alpha');

        expect(updated.groups[0].members).toEqual([
            { instanceId: A, order: 0 },
            { instanceId: B, order: 1 },
            { instanceId: C, order: 2, commander: true },
        ]);
        expect(source.groups[0].members.length).toBe(2);
    });

    it('inserts a member at an exact group position and reindexes the group', () => {
        const updated = appendCBTForceRosterMember(roster(), {
            instanceId: C,
        }, 'group:alpha', 1);

        expect(updated.groups[0].members).toEqual([
            { instanceId: A, order: 0 },
            { instanceId: C, order: 1 },
            { instanceId: B, order: 2 },
        ]);
    });

    it('creates the one unassigned group when needed', () => {
        const updated = appendUnassignedCBTForceRosterMember(emptyRoster(), {
            instanceId: A,
        });

        expect(updated.groups).toEqual([{
            groupId: CBT_FORCE_UNASSIGNED_GROUP_ID,
            order: 0,
            members: [{ instanceId: A, order: 0 }],
        }]);
    });

    it('appends to an existing unassigned group in exact order', () => {
        const first = appendUnassignedCBTForceRosterMember(emptyRoster(), {
            instanceId: A,
        });
        const second = appendUnassignedCBTForceRosterMember(first, {
            instanceId: B,
        });

        expect(second.groups[0].members).toEqual([
            { instanceId: A, order: 0 },
            { instanceId: B, order: 1 },
        ]);
    });

    it('rejects duplicate members, invalid group IDs, and unknown groups', () => {
        const source = roster();
        expect(() => appendCBTForceRosterMember(source, {
            instanceId: A,
        }, 'group:alpha')).toThrowError(/already contains/u);
        expect(() => appendCBTForceRosterMember(source, {
            instanceId: C,
        }, ' ')).toThrowError(/invalid/u);
        expect(() => appendCBTForceRosterMember(source, {
            instanceId: C,
        }, 'group:missing')).toThrowError(/does not exist/u);
        expect(() => appendCBTForceRosterMember(source, {
            instanceId: C,
        }, 'group:alpha', 3)).toThrowError(/index 3 is invalid/u);
    });

    it('returns one detached structural snapshot', () => {
        const snapshot = queryCBTForceRoster({
            forceId: 'force:test',
            forceRevision: 7,
            roster: roster(),
        });

        expect(Number(snapshot.forceRevision)).toBe(7);
        expect(snapshot.members).toEqual([
            {
                instanceId: A,
                groupId: 'group:alpha',
                groupOrder: 0,
                memberOrder: 0,
            },
            {
                instanceId: B,
                groupId: 'group:alpha',
                groupOrder: 0,
                memberOrder: 1,
            },
        ]);
        expect(snapshot.groups[0]).toEqual({
            groupId: 'group:alpha',
            groupOrder: 0,
            name: 'Alpha Lance',
            color: '#123456',
            formationId: 'formation:line',
            formationTargetGroupId: 'group:target',
            formationLock: true,
            members: snapshot.groups[0].members,
        });
        expect(Object.isFrozen(snapshot)).toBeTrue();
        expect(Object.isFrozen(snapshot.groups)).toBeTrue();
        expect(Object.isFrozen(snapshot.groups[0].members[0])).toBeTrue();
    });
});

function emptyRoster(): SerializedCBTForceRosterV1 {
    return Object.freeze({ schemaVersion: 1, groups: Object.freeze([]) });
}

function roster(): SerializedCBTForceRosterV1 {
    return Object.freeze({
        schemaVersion: 1,
        groups: Object.freeze([Object.freeze({
            groupId: 'group:alpha',
            order: 0,
            name: 'Alpha Lance',
            color: '#123456',
            formationId: 'formation:line',
            formationTargetGroupId: 'group:target',
            formationLock: true,
            members: Object.freeze([
                Object.freeze({ instanceId: A, order: 0 }),
                Object.freeze({ instanceId: B, order: 1 }),
            ]),
        })]),
    });
}
