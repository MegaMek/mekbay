// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBattleArmorEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('Battle Armor record-sheet presentation', () => {
    it('draws one armor location and status pip per trooper', async () => {
        const entity = new TestBattleArmorEntity();
        entity.trooperCount.set(5);
        entity.setArmorValue('Squad', 'front', 10);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const outlines = [...svg.querySelectorAll('.battle-armor-trooper > .unitLocation.armor')];
        expect(outlines.map(outline => outline.getAttribute('data-loc'))).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
        expect(svg.querySelectorAll('.trooperStatusPip').length).toBe(5);
        expect(svg.querySelectorAll('.pip.armor').length).toBe(55);
    });

    it('names formations by trooper count and preserves that name when numbering composed blocks', async () => {
        const level = new TestBattleArmorEntity();
        level.trooperCount.set(6);
        const point = new TestBattleArmorEntity();
        point.techBase.set('IS');
        point.trooperCount.set(5);
        const blocks = await Promise.all([level, point].map(entity =>
            RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks);
        expect(page.textContent).toContain('BATTLE ARMOR: LEVEL I 1');
        expect(page.textContent).toContain('BATTLE ARMOR: POINT 2');
    });

    it('always counts identical rows, numbering equipment only when it stands for several', async () => {
        const entity = new TestBattleArmorEntity();
        const left = addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR', { location: 'Squad' });
        addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR', { location: 'Squad' });
        const grouped = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const quantities = [...grouped.querySelectorAll('.inventoryEntry .quantity')].map(cell => cell.textContent);
        expect(quantities).toEqual(['2']);
        expect([...grouped.querySelectorAll('text')].some(text => text.textContent === '#')).toBeTrue();

        entity.removeEquipment(left);
        const single = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        expect(single.querySelector('.inventoryEntry .quantity')).toBeNull();
        expect([...single.querySelectorAll('text')].some(text => text.textContent === '#')).toBeTrue();
    });

    it('prints the suit\'s items, dispenser mines, DWP note and unburdened Ground MP as MegaMekLab does', async () => {
        const entity = new TestBattleArmorEntity();
        entity.trooperCount.set(4);
        entity.declaredWeightClass.set('Medium');
        entity.originalWalkMP.set(3);
        addTestEquipment(entity, new WeaponEquipment({
            id: 'DWP Gauss', name: 'Magshot', shortName: 'Magshot', type: 'weapon',
            weapon: { damage: 2, heat: 0, ranges: [3, 6, 9] },
        }), { location: 'Squad', isDWP: true });
        addTestEquipmentWithFlags(entity, 'F_DETACHABLE_WEAPON_PACK', { location: 'Squad' });
        for (let trooper = 0; trooper < 4; trooper++) {
            addTestEquipment(entity, new MiscEquipment({
                id: 'ISBAMineDispenser', name: 'Mine Dispenser', type: 'misc',
                flags: ['F_BA_EQUIPMENT', 'F_VEHICLE_MINE_DISPENSER'],
            }), { location: 'Squad', baMountLocation: 'Body' });
        }

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const rows = [...svg.querySelectorAll('.inventoryEntry')].map(row => [
            row.querySelector('.name')?.textContent, row.querySelector('.damage')?.textContent]);
        // The weapon pack itself is part of the suit; only weapons say they are body-mounted
        expect(rows).toEqual([['Magshot (DWP)', '2'], ['Mine Dispenser', '[PE]']]);
        // 2 mines per dispenser (TO:AUE p. 137)
        expect(svg.textContent).toContain('Ammo: (Mine Dispenser) 8');
        // A DWP costs a medium suit 3 Ground MP until it is dropped (TO:AUE p. 99)
        expect(svg.getElementById('mpWalk')?.textContent).toBe('1 [3]');
        expect(svg.textContent).toContain('Must detach DWP before moving full ground speed.');
    });

    it('keeps a multi-line ammo profile a row below the last weapon', async () => {
        const entity = new TestBattleArmorEntity();
        for (const name of ['Small Laser', 'Medium Laser', 'Flamer', 'Machine Gun']) {
            addTestEquipment(entity, new WeaponEquipment({
                id: `Fit ${name}`, name, shortName: name, type: 'weapon', weapon: { damage: 2, heat: 0, ranges: [1, 2, 3] },
            }), { location: 'Squad' });
        }
        for (const name of ['Arrow IV ADA', 'Arrow IV FA', 'Arrow IV T-FASCAM', 'Arrow IV Homing', 'Ultra AC/5', 'MG']) {
            addTestEquipment(entity, new AmmoEquipment({
                id: `Fit ${name} Ammo`, name: `${name} Ammo`, type: 'ammo', ammo: { type: 'AC', rackSize: 5, shots: 24 },
            }), { location: 'Body', shotsCount: 24 });
        }

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        const rows = [...svg.querySelectorAll('.inventoryEntry > .name')].map(name => Number(name.getAttribute('y')));
        const ammo = [...svg.querySelectorAll('#ammoProfile text')].map(line => Number(line.getAttribute('y')));

        expect(rows.length).toBe(4);
        expect(ammo.length).toBeGreaterThan(1);
        // The profile grows upward from the panel bottom; the fit leaves its extra lines room under the rows
        expect(Math.min(...ammo) - Math.max(...rows)).toBeGreaterThan((rows[1] - rows[0]) * 0.9);
    });

    it('derives AP capability from installed anti-personnel mounts', async () => {
        const entity = new TestBattleArmorEntity();
        const mount = addTestEquipmentWithFlags(entity, 'F_AP_MOUNT', { location: 'Squad' });
        const equipped = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        expect(equipped.querySelector('[data-capability="ap"] path')).not.toBeNull();

        entity.removeEquipment(mount);
        const unequipped = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        expect(unequipped.querySelector('[data-capability="ap"] path')).toBeNull();
    });

    it('keeps the first trooper pip shaded while allowing the damaged state to replace its fill', async () => {
        const entity = new TestBattleArmorEntity();
        entity.trooperCount.set(4);
        entity.setArmorValue('Squad', 'front', 6);
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });
        expect(svg.querySelectorAll('.pip.armor').length).toBe(28);
        expect(svg.querySelectorAll('.trooperStatusPip').length).toBe(4);
        const pip = svg.querySelector<SVGCircleElement>('.trooperStatusPip')!;
        expect(pip.getAttribute('data-loc')).toBe('T1');
        document.body.appendChild(svg);
        try {
            expect(getComputedStyle(pip).fill).toBe('rgb(63, 63, 63)');
            pip.classList.add('damaged');
            expect(getComputedStyle(pip).fill).toBe('rgb(255, 0, 0)');
            pip.classList.remove('damaged');
            expect(getComputedStyle(pip).fill).toBe('rgb(63, 63, 63)');
        } finally {
            svg.remove();
        }
    });

    it('embeds the distinct reference masthead once on a composed page', async () => {
        const entity = new TestBattleArmorEntity();
        const blocks = await Promise.all([entity, entity].map(unit =>
            RecordSheetSvgGenerator.generate(unit, { ruleset: 'total-warfare', format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks);
        const image = page.querySelector('#mekbay-battle-armor-masthead-art image')!;
        expect(page.querySelectorAll('#mekbay-battle-armor-masthead-art').length).toBe(1);
        expect(image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')?.startsWith('data:image/png;base64,')).toBeTrue();
        expect(page.querySelector('.battle-armor-masthead-icon')?.getAttribute('href'))
            .toBe('#mekbay-battle-armor-masthead-art');
        expect(page.querySelectorAll('.battle-armor-suit-glyph').length).toBe(10);
    });
});
