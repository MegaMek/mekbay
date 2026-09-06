// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../../models/common.model';
import { createForcePreviewEntryData } from '../../models/force-preview.model';
import { buildSidebarTags, countSidebarFilters, sortForces } from './force-org-sidebar';

describe('force organization sidebar', () => {
    it('counts case variants once per force and keeps tag labels available when search has no matches', () => {
        const tagged = createForcePreviewEntryData({ instanceId: 'a', tags: [' Scout ', 'scout', 'Assault'], type: GameSystem.AS });
        const plain = createForcePreviewEntryData({ instanceId: 'b', tags: [' '] });
        const available = countSidebarFilters([tagged, plain]);
        const searched = countSidebarFilters([plain]);

        expect(available.counts.get('all')).toBe(2);
        expect(available.counts.get('tag:scout')).toBe(1);
        expect(available.counts.get('untagged')).toBe(1);
        expect(available.counts.get(GameSystem.CBT)).toBe(1);
        expect(available.counts.get(GameSystem.AS)).toBe(1);
        expect(buildSidebarTags(available.labels, searched.counts)).toEqual([
            { id: 'tag:assault', label: 'Assault', count: 0 }, { id: 'tag:scout', label: 'Scout', count: 0 },
        ]);
    });

    it('sorts mixed systems by their saved system value, preserving tie order and the input array', () => {
        const cbt = createForcePreviewEntryData({ instanceId: 'a', name: 'Force 10', bv: 50, pv: 5000 });
        const as = createForcePreviewEntryData({ instanceId: 'b', name: 'Force 2', type: GameSystem.AS, bv: 5000, pv: 20 });
        const tied = createForcePreviewEntryData({ instanceId: 'c', name: 'Force 1', bv: 50 });
        const entries = [cbt, as, tied];

        expect(sortForces(entries, 'value', 'asc')).toEqual([as, cbt, tied]);
        expect(sortForces(entries, 'value', 'desc')).toEqual([cbt, tied, as]);
        expect(sortForces(entries, 'name', 'asc')).toEqual([tied, as, cbt]);
        expect(entries).toEqual([cbt, as, tied]);
    });
});
