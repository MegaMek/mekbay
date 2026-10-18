// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBattleArmorEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
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
