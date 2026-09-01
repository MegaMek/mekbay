// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from './common.model';
import { decodeRemoteLoadForceEntry } from './remote-load-force-entry.model';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

describe('remote force-list wire decoder', () => {
    it('decodes the compact V2 tuple without needing full force state', () => {
        const decoded = decodeRemoteLoadForceEntry([
            2,
            'force-1',
            Date.parse('2026-09-01T00:00:00.000Z'),
            1,
            'Alpha',
            [[
                [['AZ9nZw3Le7iZL67wggL14g', { a: 'Lead', x: 3 }]],
                { n: 'Lance', f: 'battle-lance' },
            ]],
            { n: 'Note', t: ['Cloud'], f: 5, e: 3150, p: 42, o: 0 },
        ]);

        expect(decoded).toEqual({
            version: 2,
            instanceId: 'force-1',
            timestamp: '2026-09-01T00:00:00.000Z',
            type: GameSystem.AS,
            name: 'Alpha',
            note: 'Note',
            tags: ['Cloud'],
            factionId: 5,
            eraId: 3150,
            pv: 42,
            owned: false,
            groups: [{
                name: 'Lance',
                formationId: 'battle-lance',
                units: [{
                    uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
                    alias: 'Lead',
                    skill: 4,
                    commander: true,
                    state: { destroyed: true },
                }],
            }],
        });
    });

    it('labels legacy object summaries as V1 when an old server omitted the field', () => {
        expect(decodeRemoteLoadForceEntry({
            instanceId: 'legacy',
            timestamp: 'now',
            name: 'Legacy',
        }).version).toBe(1);
    });
});
