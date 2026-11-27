// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildEquipmentRegistry } from '../services/catalogs/equipment-catalog-builder';
import { BOMB_TYPES, bombAmmo, bombLoadoutIssue, carriedBombPoints, layoutBombStores } from './aerospace-bomb.model';

describe('aerospace bomb model', () => {
    it('names only bombs the real catalog carries as ammunition', async () => {
        const registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
        for (const bomb of BOMB_TYPES) {
            expect(bombAmmo(bomb.id, registry)).withContext(bomb.id).not.toBeNull();
        }
    });

    it('fits each section into its own hardpoints by bomb size', () => {
        const capacity = { external: 6, internal: 2 };
        expect(bombLoadoutIssue([
            { section: 'external', bombId: 'ArrowIVHomingMissile Ammo', count: 1 },
            { section: 'external', bombId: 'HEBomb', count: 1 },
            { section: 'internal', bombId: 'LAAMissile Ammo', count: 1 },
        ], capacity)).toBeNull();
        expect(bombLoadoutIssue([{ section: 'external', bombId: 'HEBomb', count: 7 }], capacity))
            .toContain('7 hardpoints');
        expect(bombLoadoutIssue([{ section: 'internal', bombId: 'ASMissile Ammo', count: 1 }], capacity))
            .toContain('6 hardpoints');
        expect(bombLoadoutIssue([
            { section: 'external', bombId: 'HEBomb', count: 1 },
            { section: 'external', bombId: 'HEBomb', count: 1 },
        ], capacity)).toContain('Duplicate');
        expect(bombLoadoutIssue([{ section: 'external', bombId: 'AlamoMissile Ammo', count: 1 }], capacity))
            .toContain('Unknown');
    });

    it('counts only bombs still carried toward a section', () => {
        expect(carriedBombPoints([
            { section: 'external', bombId: 'ArrowIVMissile Ammo', count: 2, spent: 1 },
            { section: 'external', bombId: 'HEBomb', count: 3, spent: 3 },
            { section: 'internal', bombId: 'HEBomb', count: 2, spent: 0 },
        ], 'external')).toBe(5);
    });

    const stores = (first: number, count: number) => Array.from({ length: count }, (_, index) => first + index);

    it('labels one store per bomb from the front and marks the further hardpoints of larger bombs from the back', () => {
        const { slots, taken } = layoutBombStores([
            { section: 'external', bombId: 'InfernoBomb', count: 1, spent: 0 },
            { section: 'external', bombId: 'ArrowIVHomingMissile Ammo', count: 1, spent: 0 },
            { section: 'external', bombId: 'HEBomb', count: 3, spent: 1 },
        ], { external: stores(0, 18), internal: [] });

        // Table order, spent bombs first; the five-point Arrow IV takes four stores beyond its own.
        expect(slots.map(slot => [slot.bomb.label, slot.spent, slot.store])).toEqual([
            ['HE', true, 0], ['HE', false, 1], ['HE', false, 2], ['AIVH', false, 3], ['INF', false, 4],
        ]);
        expect(taken).toEqual([14, 15, 16, 17]);
    });

    it('lays out each section on its own stores and leaves out what the drawn stores cannot hold', () => {
        const { slots, taken } = layoutBombStores([
            { section: 'external', bombId: 'ASMissile Ammo', count: 1, spent: 0 },
            { section: 'internal', bombId: 'LAAMissile Ammo', count: 1, spent: 0 },
            { section: 'internal', bombId: 'TorpedoBomb', count: 2, spent: 0 },
        ], { external: stores(0, 3), internal: stores(3, 2) });

        expect(slots.map(slot => [slot.bomb.label, slot.store])).toEqual([['AS', 0], ['LAA', 3], ['TOR', 4]]);
        expect(taken).toEqual([1, 2]);
    });
});
