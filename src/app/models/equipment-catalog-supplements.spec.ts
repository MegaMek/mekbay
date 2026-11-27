// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { equipmentCatalogEntriesIncludingSupplements } from './equipment-catalog-supplements';
import { createEquipment } from './equipment.model';

describe('equipment catalog supplements', () => {
    it('supplies MegaMekLab-filtered equipment and lets future source data override it', () => {
        const entries = new Map(equipmentCatalogEntriesIncludingSupplements(undefined));
        const minesweeper = createEquipment(entries.get('Light Minesweeper')!);

        expect(minesweeper.tech.level).toBe('Unofficial');
        expect(minesweeper.hasFlag('S_MINESWEEPER')).toBeTrue();

        const sourceEntry = { ...entries.get('Light Minesweeper')!, name: 'Source Name' };
        const overridden = new Map(equipmentCatalogEntriesIncludingSupplements({
            'Light Minesweeper': sourceEntry,
        }));
        expect(overridden.get('Light Minesweeper')).toBe(sourceEntry);
    });
});
