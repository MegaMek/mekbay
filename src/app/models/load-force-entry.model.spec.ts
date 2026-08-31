// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';
import { createLoadForceEntry, LoadForceEntry, type RemoteLoadForceEntry } from './load-force-entry.model';

describe('createLoadForceEntry', () => {
    const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
    const resolvedFaction = { id: 1, name: 'Mercenary' } as any;
    const resolvedEra = { id: 3025, name: 'Succession Wars' } as any;
    const resolver = {
        getUnitByName: (name: string) => name === 'Atlas AS7-D' ? resolvedUnit : undefined,
        getUnitByUuid: () => resolvedUnit,
        getUnitByIdentity: () => resolvedUnit,
        getFactionById: (id: number) => id === 1 ? resolvedFaction : undefined,
        getEraById: (id: number) => id === 3025 ? resolvedEra : undefined,
    };

    it('wraps remote preview data in a saved entry and links groups back to the entry', () => {
        const raw: RemoteLoadForceEntry = {
            owned: true,
            instanceId: 'force-1',
            name: 'Alpha Lance',
            note: 'Fast cavalry reserve.',
            tags: ['Recon', 'Skirmish'],
            type: GameSystem.ALPHA_STRIKE,
            factionId: 1,
            eraId: 3025,
            pv: 123,
            timestamp: '2026-04-16T00:00:00.000Z',
            groups: [{
                name: 'Striker',
                formationId: 'battle-lance',
                units: [{
                    unit: 'Atlas AS7-D',
                    alias: 'Ace',
                    skill: 3,
                    commander: true,
                    state: {
                        destroyed: false,
                    },
                }],
            }],
        };

        const result = createLoadForceEntry(raw, resolver, { cloud: true });

        expect(result instanceof LoadForceEntry).toBe(true);
        expect(result.cloud).toBe(true);
        expect(result.local).toBe(false);
        expect(result.note).toBe('Fast cavalry reserve.');
        expect(result.tags).toEqual(['Recon', 'Skirmish']);
        expect(result.faction).toBe(resolvedFaction);
        expect(result.era).toBe(resolvedEra);
        expect(result.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Striker',
            formationId: 'battle-lance',
            force: result,
        }));
        expect(result.groups[0].units[0]).toEqual(jasmine.objectContaining({
            unit: resolvedUnit,
            alias: 'Ace',
            skill: 3,
            commander: true,
        }));
    });
});
