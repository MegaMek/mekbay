// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { ArmorEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { MountedArmor } from '../../../models/entity/components/armor';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('Mek printed equipment and movement alternatives', () => {
    it('identifies primitive construction and the BAR of commercial armor', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(60);
        entity.cockpitType.set('Primitive');
        entity.setUniformArmor(new MountedArmor({ armor: new ArmorEquipment({
            id: 'Commercial', name: 'Commercial', type: 'armor', armor: { type: 'COMMERCIAL', bar: 5 },
        }) }));
        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.textContent).toContain('PRIMITIVE BATTLEMECH RECORD SHEET');
        expect(svg.querySelector('#armorType')?.textContent).toBe('Commercial, BAR: 5');
    });

    it('identifies special patchwork material at the affected location', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(80);
        entity.setArmorAt('LA', new MountedArmor({ armor: new ArmorEquipment({
            id: 'Reactive', name: 'Reactive', type: 'armor', armor: { type: 'REACTIVE' },
        }) }));
        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.querySelector('#armorType')?.textContent).toBe('Patchwork');
        expect(svg.querySelector('.diagram-material-name[data-loc="LA"]')?.textContent).toBe('Reactive');
        expect(svg.querySelector('.diagram-material-name[data-loc="RA"]')).toBeNull();
    });

    it('prints a linked capacitor profile while retaining the uncharged PPC row and its ranges', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(70);
        const weapon = addTestEquipment(entity, new WeaponEquipment({
            id: 'ERPPC', name: 'ER PPC', type: 'weapon', flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
            weapon: { heat: 15, damage: 10, ranges: [7, 14, 23] },
        }), { location: 'Left Arm' });
        const capacitor = addTestEquipmentWithFlags(entity, 'F_PPC_CAPACITOR', { location: 'Left Arm' });
        entity.linkEquipment(capacitor, weapon);
        const svg = await RecordSheetSvgGenerator.generate(entity);
        const mode = svg.querySelector('[data-mekbay-mode="w/Capacitor"]')!;
        const row = mode.parentElement!;
        expect(mode.classList.contains('equipmentProfile')).toBeTrue();
        expect(row.querySelector('.alternativeMode')).toBeNull();
        expect(row.querySelector(':scope > .damage')?.textContent).toContain('10');
        expect(row.querySelector(':scope > .range_long')?.textContent).toBe('23');
        expect(mode.querySelector('.heat')?.textContent).toBe('20');
        expect(mode.querySelector('.damage')?.textContent).toContain('15');
        expect(mode.querySelector('.damage')?.textContent).toContain('X');
    });

    it('prints TSM movement and physical damage alternatives from existing entity projections', async () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(70);
        entity.originalWalkMP.set(5);
        addTestEquipmentWithFlags(entity, 'F_TSM');
        const svg = await RecordSheetSvgGenerator.generate(entity);
        expect(svg.querySelector('#mpWalk')?.textContent).toBe('5 [6]');
        expect(svg.querySelector('#mpRun')?.textContent).toBe('8 [9]');
        const kick = [...svg.querySelectorAll('.inventoryEntry')].find(row => row.querySelector('.name')?.textContent === 'Kick');
        expect(kick?.querySelector('.damage')?.textContent).toBe('14 [28]');
    });
});
