// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../../models/common.model';
import type { Era } from '../../models/eras.model';
import type { Faction } from '../../models/factions.model';
import { createForcePreviewEntryData } from '../../models/force-preview.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { deriveCollectionEra, deriveOrganizationMetadata } from './force-org-metadata';

describe('force organization metadata', () => {
    const innerSphere: Faction = { id: 1, name: 'Federated Suns', group: 'Inner Sphere', img: '', eras: {} };
    const clan: Faction = { id: 2, name: 'Clan Wolf', group: 'IS Clan', img: '', eras: {} };
    const factions = [innerSphere, clan];
    const hierarchy = new Map([
        ['root', { parentGroupId: null }],
        ['child', { parentGroupId: 'root' }],
    ]);
    function force(id: string, faction: Faction, bv = 0) {
        return createForcePreviewEntryData({
            instanceId: id, name: id, faction,
            groups: [{ units: [{ unit: createEmptyUnit({ bv }), destroyed: false }] }],
        });
    }

    it('counts a child group as one zero-value faction vote, then the root as one organization vote', () => {
        const result = deriveOrganizationMetadata(hierarchy, [
            ...['a', 'b', 'c'].map(id => ({ force: force(id, clan), groupId: 'child' })),
            ...['d', 'e'].map(id => ({ force: force(id, innerSphere), groupId: 'root' })),
            ...['f', 'g'].map(id => ({ force: force(id, clan), groupId: null })),
        ], factions, []);

        expect(result.groups.get('child')!.factionId).toBe(clan.id);
        expect(result.groups.get('root')!.factionId).toBe(innerSphere.id);
        expect(result.factionId).toBe(clan.id);
    });

    it('uses unit BV across systems for faction dominance while totals honor saved values, including zero', () => {
        const cbt = force('cbt', innerSphere, 100);
        cbt.bv = 9000;
        const as = force('as', clan, 200);
        as.type = GameSystem.AS;
        as.pv = 0;
        const result = deriveOrganizationMetadata(hierarchy, [
            { force: cbt, groupId: 'root' }, { force: as, groupId: 'child' },
        ], factions, []).groups.get('root')!;

        expect(result.factionId).toBe(clan.id);
        expect(result.totals).toBe('BV: 9,000');
    });

    it('retains every shadow placement in totals while the child supplies its naming result', () => {
        const shared = force('shared', innerSphere, 1000);
        const result = deriveOrganizationMetadata(hierarchy, [
            { force: shared, groupId: 'root' }, { force: shared, groupId: 'child' },
        ], factions, []);

        expect(result.groups.get('root')!.descendants).toEqual([shared, shared]);
        expect(result.groups.get('root')!.totals).toBe('BV: 2,000');
        expect(result.groups.get('root')!.org.groups).toEqual(result.groups.get('child')!.org.groups);
    });

    it('appends preview extras after existing descendants at every ancestor without changing membership', () => {
        const a = force('a', innerSphere, 100);
        const b = force('b', innerSphere, 100);
        const c = force('c', innerSphere, 100);
        const extra = force('extra', clan, 500);
        const groups = new Map([...hierarchy, ['sibling', { parentGroupId: 'root' }]]);
        const placed = [{ force: a, groupId: 'root' }, { force: b, groupId: 'child' }, { force: c, groupId: 'sibling' }];
        const base = deriveOrganizationMetadata(groups, placed, factions, []);
        const preview = deriveOrganizationMetadata(groups, placed, factions, [], { targetGroupId: 'child', entries: [extra] });

        expect(preview.groups.get('child')!.descendants).toEqual([b, extra]);
        expect(preview.groups.get('root')!.descendants).toEqual([a, b, c, extra]);
        expect(preview.groups.get('root')!.factionId).toBe(clan.id);
        expect(preview.groups.get('sibling')).toEqual(base.groups.get('sibling'));
        expect(base.groups.get('root')!.descendants).toEqual([a, b, c]);
        expect(placed).toEqual([{ force: a, groupId: 'root' }, { force: b, groupId: 'child' }, { force: c, groupId: 'sibling' }]);
    });

    it('prefers each saved era start over that force’s unit years and uses the latest reference in a collection', () => {
        const early: Era = { id: 1, name: 'Early', years: { from: 2800, to: 3049 }, factions: [], units: [] };
        const later: Era = { id: 2, name: 'Later', years: { from: 3050 }, factions: [], units: [] };
        const entry = force('early', innerSphere);
        entry.era = early;
        entry.groups[0].units[0].unit!.year = 3100;
        const inferred = force('inferred', innerSphere);
        inferred.groups[0].units[0].unit!.year = 3055;

        expect(deriveCollectionEra([entry], [early, later])).toBe(early);
        expect(deriveCollectionEra([entry, inferred], [early, later])).toBe(later);
    });
});
