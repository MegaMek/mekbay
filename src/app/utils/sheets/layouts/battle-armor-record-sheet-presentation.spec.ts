// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBattleArmorEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('Battle Armor record-sheet presentation', () => {
    it('names formations by trooper count and preserves that name when numbering composed blocks', async () => {
        const level = new TestBattleArmorEntity();
        level.trooperCount.set(6);
        const point = new TestBattleArmorEntity();
        point.techBase.set('IS');
        point.trooperCount.set(5);
        const blocks = await Promise.all([level, point].map(entity =>
            RecordSheetSvgGenerator.generate(entity, { format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks);
        expect(page.textContent).toContain('BATTLE ARMOR: LEVEL I 1');
        expect(page.textContent).toContain('BATTLE ARMOR: POINT 2');
    });

    it('derives AP capability from installed anti-personnel mounts', async () => {
        const entity = new TestBattleArmorEntity();
        const mount = addTestEquipmentWithFlags(entity, 'F_AP_MOUNT', { location: 'Squad' });
        expect(entity.apMounts()).toBe(0);
        const equipped = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        expect(equipped.querySelector('[data-capability="ap"] path')).not.toBeNull();

        entity.removeEquipment(mount);
        entity.apMounts.set(2);
        const unequipped = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        expect(unequipped.querySelector('[data-capability="ap"] path')).toBeNull();
    });

    it('keeps the first trooper pip shaded while allowing the damaged state to replace its fill', async () => {
        const entity = new TestBattleArmorEntity();
        entity.trooperCount.set(4);
        entity.setArmorValue('Squad', 'front', 6);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
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
            RecordSheetSvgGenerator.generate(unit, { format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks);
        const symbol = page.querySelector('#mekbay-battle-armor-masthead-art')!;
        const image = symbol.querySelector('image')!;
        expect(page.querySelectorAll('#mekbay-battle-armor-masthead-art').length).toBe(1);
        expect(symbol.getAttribute('viewBox')).toBe('0 0 56.7 45.357');
        expect(image.getAttribute('y')).toBe('5.515');
        expect(image.getAttribute('height')).toBe('34.327');
        expect(image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')?.startsWith('data:image/png;base64,')).toBeTrue();
        expect(page.querySelector('.battle-armor-masthead-icon')?.getAttribute('href'))
            .toBe('#mekbay-battle-armor-masthead-art');
        expect(page.querySelectorAll('.battle-armor-suit-glyph').length).toBe(10);
    });
});
