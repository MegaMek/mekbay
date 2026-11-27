// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBattleArmorEntity, TestProtoMekEntity, TestTankEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { MiscEquipment } from '../../models/equipment.model';
import { recordSheetEquipmentDamage } from './record-sheet-inventory-equipment';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';
import { recordSheetDispenserPayload } from './record-sheet-svg-rendering';

describe('record sheet equipment codes', () => {
    it('prints a minesweeper as performance enhancement, PE (TO:AUE p. 220)', () => {
        expect(recordSheetEquipmentDamage(addTestEquipmentWithFlags(new TestTankEntity(), 'F_MINESWEEPER', { location: 'Front' })))
            .toBe('[PE]');
    });

    it('loads a space mine dispenser with its 2 mines (TO:AUE p. 220)', () => {
        expect(recordSheetDispenserPayload(new MiscEquipment({
            id: 'SpaceMineDispenser', name: 'Space Mine Dispenser', type: 'misc', flags: ['F_SPACE_MINE_DISPENSER'],
        }))).toBe(2);
    });

    it('gives ProtoMek equipment the codes every other sheet prints', async () => {
        const entity = new TestProtoMekEntity();
        const misc = (id: string, flags: readonly ('F_ECM' | 'F_MAGNETIC_CLAMP' | 'F_PROTOMEK_EQUIPMENT')[]) =>
            addTestEquipment(entity, new MiscEquipment({
                id, name: id, type: 'misc', flags: [...flags], stats: { hittable: true },
            }), { location: 'Torso' });
        misc('Angel ECM Suite', ['F_ECM']);
        misc('Magnetic Clamps System', ['F_PROTOMEK_EQUIPMENT', 'F_MAGNETIC_CLAMP']);

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const damage = (name: string) => [...svg.querySelectorAll('.inventoryEntry')]
            .find(row => row.querySelector('.name')?.textContent?.includes(name))?.querySelector('.damage')?.textContent;
        expect(damage('Angel ECM Suite')).toBe('[E]');
        // The IO:AE equipment table lists the Magnetic Clamp System as PE
        expect(damage('Magnetic Clamps System')).toBe('[PE]');
    });

    it('prints no type for battle armor magnetic clamps, as no book gives them one', () => {
        const clamps = addTestEquipment(new TestBattleArmorEntity(), new MiscEquipment({
            id: 'BA-Magnetic Clamp', name: 'Magnetic Clamps [BA]', type: 'misc', flags: ['F_BA_EQUIPMENT', 'F_MAGNETIC_CLAMP'],
        }), { location: 'Squad' });
        expect(recordSheetEquipmentDamage(clamps)).toBe('');
    });
});
