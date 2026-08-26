// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEquipment, formatEquipmentRulesRefs } from './equipment.model';

describe('equipment model', () => {
    it('keeps and formats structured equipment rules references', () => {
        const rulesRefs = [
            { book: 'TO:AUE', page: 181 },
            { book: 'TM', page: null },
            { book: 'BMM' },
        ];
        const equipment = createEquipment({
            id: 'test',
            name: 'Test',
            type: 'misc',
            rulesRefs,
        });

        expect(equipment.rulesRefs).toBe(rulesRefs);
        expect(formatEquipmentRulesRefs(equipment.rulesRefs)).toBe('TO:AUE, 181; TM; BMM');
    });

    it('defaults missing equipment rules references to an empty array', () => {
        const equipment = createEquipment({ id: 'test', name: 'Test', type: 'misc' });

        expect(equipment.rulesRefs).toEqual([]);
        expect(formatEquipmentRulesRefs(equipment.rulesRefs)).toBe('');
    });
});
