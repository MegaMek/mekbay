// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBattleArmorEntity, TestBipedMekEntity } from '../../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';

describe('Battle Armor record-sheet presentation', () => {
    it('matches the Mek 60-degree bottom-right corner and linked bottom notch', async () => {
        for (const entity of [new TestBattleArmorEntity(), new TestBipedMekEntity()]) {
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            const frame = svg.querySelector('.compact-battle-armor-frame, #unitDataPanel')!;
            for (const path of frame.querySelectorAll(':scope > path')) {
                const d = path.getAttribute('d')!;
                // The descending bottom-right cut runs left, then the notch's
                // last three absolute lines climb back to the raised floor.
                const corner = [...d.matchAll(/l -([\d.e+]+) ([\d.e+-]+)/g)].find(match => Number(match[2]) > 0)!;
                const cornerAngle = Math.atan2(Number(corner[2]), Number(corner[1])) * 180 / Math.PI;
                const lines = [...d.matchAll(/L ([\d.e+-]+) ([\d.e+-]+)/g)];
                const [lower, upper] = lines.slice(-3, -1).map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
                const notchAngle = Math.atan2(lower.y - upper.y, lower.x - upper.x) * 180 / Math.PI;
                expect(cornerAngle).withContext(entity.entityType).toBeCloseTo(60, 3);
                expect(notchAngle).withContext(entity.entityType).toBeCloseTo(cornerAngle, 3);
            }
        }
    });

    it('preserves the taller trooper badge and narrower armor track from the reference', async () => {
        const entity = new TestBattleArmorEntity();
        entity.trooperCount.set(5);
        entity.setArmorValue('Squad', 'front', 10);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        document.body.appendChild(svg);
        try {
            const outlines = [...svg.querySelectorAll<SVGPathElement>('.battle-armor-trooper > .unitLocation.armor')];
            expect(outlines.length).toBe(5);
            expect(outlines.map(outline => outline.getAttribute('data-loc'))).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
            for (const outline of outlines) {
                // The badge extends above and below the pip track, with clipped corners.
                expect(outline.isPointInFill(new DOMPoint(12, 1))).toBeTrue();
                expect(outline.isPointInFill(new DOMPoint(12, 15))).toBeTrue();
                expect(outline.isPointInFill(new DOMPoint(60, 1))).toBeFalse();
                expect(outline.isPointInFill(new DOMPoint(60, 15))).toBeFalse();
                expect(outline.isPointInFill(new DOMPoint(60, 8))).toBeTrue();
                expect(outline.isPointInFill(new DOMPoint(0, 0))).toBeFalse();
            }
            expect(svg.querySelectorAll('.trooperStatusPip').length).toBe(5);
            expect(svg.querySelectorAll('.pip.armor').length).toBe(55);
        } finally {
            svg.remove();
        }
    });

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
        const equipped = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        expect(equipped.querySelector('[data-capability="ap"] path')).not.toBeNull();

        entity.removeEquipment(mount);
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
