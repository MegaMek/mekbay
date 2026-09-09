// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEquipment, formatEquipmentName, formatEquipmentRulesRefs } from './equipment.model';

describe('equipment model', () => {
    it('formats ammo labels with optional counts without duplicating Ammo', () => {
        for (const shortName of ['MML 7/LRM', 'MML 7/LRM Ammo']) {
            const ammo = createEquipment({ id: 'mml-ammo', name: 'MML 7 LRM Ammo', shortName, type: 'ammo' });
            expect(formatEquipmentName(ammo)).toBe('MML 7/LRM Ammo');
            expect(formatEquipmentName(ammo, 17)).toBe('MML 7/LRM Ammo (17)');
            expect(formatEquipmentName(ammo, 0)).toBe('MML 7/LRM Ammo (0)');
        }
        const weapon = createEquipment({ id: 'ppc', name: 'Particle Projector Cannon', shortName: 'PPC', type: 'weapon' });
        expect(formatEquipmentName(weapon)).toBe('PPC');
    });

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
