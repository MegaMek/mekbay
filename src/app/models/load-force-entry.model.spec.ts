// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';
import { createLoadForceEntry, createLoadForceEntryFromSerializedForce, LoadForceEntry, type RemoteLoadForceEntry } from './load-force-entry.model';
import type { SerializedForce } from './force-serialization';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

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
            type: GameSystem.AS,
            factionId: 1,
            eraId: 3025,
            pv: 123,
            reserveCount: 3,
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
        Object.freeze(raw.groups![0].units[0]);
        Object.freeze(raw.groups![0].units);
        Object.freeze(raw.groups![0]);

        const result = createLoadForceEntry(raw, resolver, { cloud: true });

        expect(result instanceof LoadForceEntry).toBe(true);
        expect(result.cloud).toBe(true);
        expect(result.local).toBe(false);
        expect(result.note).toBe('Fast cavalry reserve.');
        expect(result.tags).toEqual(['Recon', 'Skirmish']);
        expect(result.reserveCount).toBe(3);
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
        const another = createLoadForceEntry(raw, resolver);
        result.groups[0].units[0].alias = 'Edited preview';
        expect(another.groups[0].units[0].alias).toBe('Ace');
        expect(raw.groups![0].units[0].alias).toBe('Ace');
        expect(another.groups[0].force).toBe(another);
    });

    it('owns normalized save preview groups independently of the save and other previews', () => {
        const raw: SerializedForce = {
            version: 2, instanceId: 'force', timestamp: '', type: GameSystem.AS, name: 'Force',
            personnel: {
                people: [{ id: 'person', name: 'Ace', gunnery: 3 }],
                assignments: [{ unitId: 'unit', positionId: 'pilot', personId: 'person' }],
            },
            groups: [{ id: 'group', name: 'Lance', units: [{ id: 'unit', uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2') }] }],
        };
        Object.freeze(raw.groups![0].units[0]);
        Object.freeze(raw.groups![0].units);
        Object.freeze(raw.groups![0]);

        const first = createLoadForceEntryFromSerializedForce(raw, resolver);
        const second = createLoadForceEntryFromSerializedForce(raw, resolver);
        first.groups[0].name = 'Edited lance';
        first.groups[0].units[0].alias = 'Edited pilot';

        expect(first.groups[0].force).toBe(first);
        expect(second.groups[0].force).toBe(second);
        expect(second.groups[0].name).toBe('Lance');
        expect(second.groups[0].units[0].alias).toBe('Ace');
        expect(raw.groups![0].name).toBe('Lance');
        expect(raw.personnel!.people[0].name).toBe('Ace');
    });
});
