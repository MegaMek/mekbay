// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from './common.model';
import { decodeRemoteLoadForceEntry } from './remote-load-force-entry.model';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

describe('remote force-list wire decoder', () => {
    it('decodes compact V2 unit summaries without full force state', () => {
        const decoded = decodeRemoteLoadForceEntry({
            version: 2, instanceId: 'force-1', timestamp: Date.parse('2026-09-01T00:00:00.000Z'),
            type: GameSystem.AS, name: 'Alpha', note: 'Note', tags: ['Cloud'], factionId: 5, eraId: 3150, pv: 42, owned: false,
            groups: [{ name: 'Lance', formationId: 'battle-lance', units: [
                ['AZ9nZw3Le7iZL67wggL14g', { name: 'Lead', commander: true, destroyed: true }],
            ] }],
        });

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
            reserveCount: 0,
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

    it('decodes legacy and current rows independently in one mixed response', () => {
        const decoded = [
            { instanceId: 'legacy', timestamp: 'now', name: 'Legacy' },
            { version: 2, instanceId: 'current', timestamp: 0, type: GameSystem.CBT, name: 'Current', groups: [] },
        ].map(decodeRemoteLoadForceEntry);

        expect(decoded.map(entry => [entry.version, entry.instanceId])).toEqual([
            [1, 'legacy'],
            [2, 'current'],
        ]);
    });

    it('counts reserves separately from occupied and abandoned units without copying their personal details', () => {
        const decoded = decodeRemoteLoadForceEntry({
            version: 2, instanceId: 'force', timestamp: 0, type: GameSystem.CBT, name: 'Partial crew',
            personnel: [{ name: 'Reserve', g: 1 }],
            units: [{ uuid: 'AZ9nZw3Le7iZL67wggL14g', crew: [null, {}] },
                { uuid: 'AZ9nZw3Le7iZL67wggL14g' }], groups: [{ unitIndices: [1, 0] }],
        });
        expect(decoded.groups![0].units[0].g).toBeUndefined();
        expect(decoded.groups![0].units[1].g).toBe(4);
        expect(decoded.groups![0].units[1].alias).toBeUndefined();
        expect(decoded.reserveCount).toBe(1);
        expect(JSON.stringify(decoded)).not.toContain('Reserve');
    });

    it('uses the server projected reserve count without requiring personnel records', () => {
        for (const type of [GameSystem.AS, GameSystem.CBT]) {
            const decoded = decodeRemoteLoadForceEntry({
                version: 2, instanceId: 'force', timestamp: 0, type, name: 'Reserves',
                reserveCount: 7, groups: [],
            });
            expect(decoded.reserveCount).toBe(7);
            expect(decoded.groups).toEqual([]);
        }
        expect(decodeRemoteLoadForceEntry({ instanceId: 'legacy', timestamp: 0, name: 'Legacy' }).reserveCount).toBe(0);
    });

    it('reads V1 crew and damage previews without interpreting the remaining state', () => {
        const decoded = decodeRemoteLoadForceEntry({ version: 1, instanceId: 'old', timestamp: '2026-09-01', name: 'Old',
            groups: [{ units: [{ unit: 'Atlas', state: { destroyed: true, crew: [{ pilotingSkill: 4 }, { gunnerySkill: 2 }],
                inventory: 'unreadable' } }] }],
        });
        expect(decoded.groups![0].units[0]).toEqual({ unit: 'Atlas', p: 4, g: 2, state: { destroyed: true } });
    });

    it('matches local AS previews for default and zero skills, personal details, vacancy and group order', () => {
        const uuid = 'AZ9nZw3Le7iZL67wggL14g';
        const metadata = { version: 2, instanceId: 'as', timestamp: 0, type: GameSystem.AS, name: 'Alpha', reserveCount: 2 };
        const stored = decodeRemoteLoadForceEntry({ ...metadata,
            units: [
                { uuid, crew: [{}] },
                { uuid, crew: [{ name: 'Ace', g: 0, commander: true }], destroyed: true },
                { uuid },
            ],
            groups: [{ name: 'First', formationId: 'battle-lance', unitIndices: [1, 0] }, { name: 'Second', unitIndices: [2] }],
        });
        const cloud = decodeRemoteLoadForceEntry({ ...metadata,
            groups: [
                { name: 'First', formationId: 'battle-lance', units: [[uuid, { name: 'Ace', skill: 0, commander: true, destroyed: true }], [uuid]] },
                { name: 'Second', units: [[uuid, { vacant: true }]] },
            ],
        });

        expect(cloud).toEqual(stored);
        expect(cloud.groups![0].units.map(unit => unit.skill)).toEqual([0, 4]);
        expect(cloud.groups![1].units[0].skill).toBeUndefined();
    });

    it('matches local CBT previews for partial multi-crew, minimum zero skills and unnamed first occupants', () => {
        const uuid = 'AZ9nZw3Le7iZL67wggL14g';
        const metadata = { version: 2, instanceId: 'cbt', timestamp: 0, type: GameSystem.CBT, name: 'Classic' };
        const stored = decodeRemoteLoadForceEntry({ ...metadata,
            units: [
                { uuid, crew: [{}] },
                { uuid, crew: [null, { name: 'First', g: 0, p: 3 }, { name: 'Second', g: 2, p: 0, commander: true }] },
                { uuid, crew: [{}, { name: 'Do not borrow', g: 2, p: 3, commander: true }] },
                { uuid, crew: [null, null], destroyed: true },
            ],
            groups: [{ unitIndices: [3, 2, 1, 0] }],
        });
        const cloud = decodeRemoteLoadForceEntry({ ...metadata, groups: [{ units: [
            [uuid, { vacant: true, destroyed: true }],
            [uuid, { g: 2, p: 3, commander: true }],
            [uuid, { name: 'First', g: 0, p: 0, commander: true }],
            [uuid],
        ] }] });

        expect(cloud).toEqual(stored);
        expect(cloud.groups![0].units[0].g).toBeUndefined();
        expect(cloud.groups![0].units[0].p).toBeUndefined();
        expect(cloud.groups![0].units[1].alias).toBeUndefined();
        expect(cloud.groups![0].units[3]).toEqual(jasmine.objectContaining({ g: 4, p: 5 }));
    });

    it('rejects malformed current list tuples and preserves validation of local membership references', () => {
        const uuid = 'AZ9nZw3Le7iZL67wggL14g';
        const root = { version: 2, instanceId: 'force', timestamp: 0, type: GameSystem.CBT, name: 'Force' };
        for (const malformed of [
            [], [null], ['not-a-uuid'], [uuid, null], [uuid, []], [uuid, {}, 'extra'],
            [uuid, { name: 2 }], [uuid, { g: '2' }], [uuid, { p: Infinity }], [uuid, { vacant: 1 }],
        ]) {
            expect(() => decodeRemoteLoadForceEntry({ ...root, groups: [{ units: [malformed] }] })).toThrow();
        }
        expect(() => decodeRemoteLoadForceEntry({ ...root, groups: [{ units: {} }] })).toThrow();
        expect(() => decodeRemoteLoadForceEntry({ ...root, units: [], groups: [{ unitIndices: [0] }] })).toThrow();
    });
});
