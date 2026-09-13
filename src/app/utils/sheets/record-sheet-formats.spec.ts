// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestBipedMekEntity,
    TestConvFighterEntity, TestDropShipEntity, TestFixedWingSupportEntity,
    TestHandheldWeaponEntity, TestInfantryEntity, TestJumpShipEntity, TestLamEntity,
    TestProtoMekEntity, TestQuadMekEntity, TestQuadVeeEntity, TestSmallCraftEntity,
    TestSpaceStationEntity, TestSupportNavalEntity, TestTankEntity, TestTripodMekEntity,
    TestVtolEntity, TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';
import { planRecordSheetPages, recordSheetPageProfile } from './record-sheet-layout';
import { recordSheetLayoutProfile } from './layouts/record-sheet-layout-resolver';

describe('record-sheet physical paper formats', () => {
    const stage = document.createElement('div');
    beforeEach(() => document.body.appendChild(stage));
    afterEach(() => stage.remove());

    function bounds(svg: SVGSVGElement, selector: string): DOMRect {
        stage.replaceChildren(svg);
        const element = svg.querySelector<SVGGraphicsElement>(selector);
        expect(element).withContext(selector).not.toBeNull();
        const box = element!.getBoundingClientRect();
        const matrix = svg.getScreenCTM()!;
        // CSS layout rounds fractional page dimensions; assert geometry in SVG points.
        return new DOMRect((box.x - matrix.e) / matrix.a, (box.y - matrix.f) / matrix.d,
            box.width / matrix.a, box.height / matrix.d);
    }

    for (const Factory of [TestBipedMekEntity, TestQuadMekEntity, TestTripodMekEntity, TestLamEntity, TestQuadVeeEntity,
        TestAeroSpaceFighterEntity, TestConvFighterEntity, TestFixedWingSupportEntity, TestSmallCraftEntity,
        TestDropShipEntity, TestJumpShipEntity, TestWarShipEntity, TestSpaceStationEntity, TestTankEntity,
        TestVtolEntity, TestSupportNavalEntity, TestProtoMekEntity]) {
        it(`keeps ${Factory.name} paperdoll proportions and physical size across formats`, async () => {
            const entity = new Factory();
            const letter = await RecordSheetSvgGenerator.generate(entity, { format: 'letter' });
            const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4' });
            const selector = '.mek-paperdolls, .aero-paperdoll-layer, .vehicle-paperdoll-layer, .protomek-paperdoll-layer';
            const before = bounds(letter, selector);
            const after = bounds(a4, selector);
            expect(after.width).toBeCloseTo(before.width, 2);
            expect(after.height).toBeCloseTo(before.height, 2);
            expect(letter.getAttribute('viewBox')).toBe('0 0 612 792');
            expect(a4.getAttribute('viewBox')).toBe('0 0 595.276 841.89');
        });
    }

    it('uses Letter width for the critical/data panels and anchors the art and heat panels to the right', async () => {
        const entity = new TestQuadMekEntity();
        const letter = await RecordSheetSvgGenerator.generate(entity, { format: 'letter' });
        const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4' });
        const widthDifference = recordSheetPageProfile('letter').width - recordSheetPageProfile('a4').width;
        const heightDifference = recordSheetPageProfile('letter').height - recordSheetPageProfile('a4').height;
        for (const selector of ['#unitDataPanel', '#criticalHitTable']) {
            const before = bounds(a4, selector);
            const after = bounds(letter, selector);
            expect(after.x).toBeCloseTo(before.x, 2);
            expect(after.width - before.width).toBeCloseTo(widthDifference, 2);
            if (selector === '#criticalHitTable') expect(after.height - before.height).toBeCloseTo(heightDifference, 2);
        }
        for (const selector of ['.mek-paperdolls', '#warriorDataSingle', '#heatScale', '#heatDataPanel']) {
            const before = bounds(a4, selector);
            const after = bounds(letter, selector);
            expect(after.x - before.x).toBeCloseTo(widthDifference, 2);
            expect(after.width).toBeCloseTo(before.width, 2);
            if (selector.startsWith('#heat')) expect(after.y - before.y).toBeCloseTo(heightDifference, 2);
        }
    });

    it('moves center artwork and reference tables with the warrior panel without resizing them', async () => {
        const entity = new TestBipedMekEntity();
        const fluffImageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0h100v100H0z"/></svg>');
        const letter = await RecordSheetSvgGenerator.generate(entity, { format: 'letter', fluffImageUrl });
        const a4 = await RecordSheetSvgGenerator.generate(entity, { format: 'a4', fluffImageUrl });
        for (const svg of [letter, a4]) {
            svg.querySelector<SVGElement>('#fluff-image-injected')!.style.display = 'block';
        }
        const widthDifference = recordSheetPageProfile('letter').width - recordSheetPageProfile('a4').width;
        for (const selector of ['#fluff-image-injected', '.referenceTable']) {
            const before = bounds(a4, selector);
            const after = bounds(letter, selector);
            expect(after.x - before.x).toBeCloseTo(widthDifference, 2);
            expect(after.y).toBeCloseTo(before.y, 2);
            expect(after.width).toBeCloseTo(before.width, 2);
            expect(after.height).toBeCloseTo(before.height, 2);
        }
    });

    it('keeps tripod reference notes above the critical table', async () => {
        for (const format of ['letter', 'a4'] as const) {
            const svg = await RecordSheetSvgGenerator.generate(new TestTripodMekEntity(), { format });
            stage.replaceChildren(svg);
            const criticalTop = svg.querySelector<SVGGraphicsElement>('#criticalHitTable')!.getBoundingClientRect().top;
            const notes = [...svg.querySelectorAll<SVGGraphicsElement>('.reference-table-note')];
            expect(notes.length).toBeGreaterThan(0);
            for (const note of notes) expect(note.getBoundingClientRect().bottom).toBeLessThan(criticalTop);
        }
    });

    for (const format of ['letter', 'a4'] as const) {
        it(`keeps battle-armor pips round on ${format}`, async () => {
            const svg = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), { format });
            stage.replaceChildren(svg);
            const pips = [...svg.querySelectorAll<SVGGraphicsElement>('.battle-armor-trooper circle.pip')];
            expect(pips.length).toBeGreaterThan(0);
            for (const pip of pips) {
                const box = pip.getBoundingClientRect();
                expect(box.width).toBeCloseTo(box.height, 3);
            }
        });

        it(`packs infantry and ProtoMeks at their actual stride on ${format}`, () => {
            for (const [Factory, capacity] of [[TestInfantryEntity, 4], [TestProtoMekEntity, 5]] as const) {
                const units = Array.from({ length: capacity + 1 }, () => new Factory());
                expect(planRecordSheetPages(units, entity => recordSheetLayoutProfile(entity, format), format)
                    .map(page => page.items.length)).toEqual([capacity, 1]);
            }
        });

        it(`fits taller infantry cluster tables on lone-unit ${format} pages and omits them for two units`, async () => {
            for (const Factory of [TestBattleArmorEntity, TestInfantryEntity]) {
                const block = await RecordSheetSvgGenerator.generate(new Factory(), { format: 'compact', pageFormat: format });
                const page = RecordSheetSvgGenerator.composeCompactPage([block], format);
                stage.replaceChildren(page);
                const cluster = page.querySelector<SVGGElement>('[data-mekbay-reference="cluster-hits"]')!;
                expect(Number(cluster.getAttribute('data-mekbay-frame-height')))
                    .toBeCloseTo(180 * recordSheetPageProfile(format).verticalScale, 3);
                expect(cluster.getBoundingClientRect().top)
                    .toBeGreaterThan(page.querySelector<SVGGElement>('.compact-sheet-block')!.getBoundingClientRect().bottom);
                expect(cluster.getBoundingClientRect().bottom)
                    .toBeLessThan(page.querySelector<SVGGraphicsElement>('#footer')!.getBoundingClientRect().top);
                const pair = RecordSheetSvgGenerator.composeCompactPage([block, block.cloneNode(true) as SVGSVGElement], format);
                expect(pair.querySelectorAll('.compact-sheet-block').length).toBe(2);
                expect(pair.querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
            }
        });

        it(`retains a clear footer when multiple small-unit families share ${format} pages`, async () => {
            const entities = [new TestInfantryEntity(), new TestBattleArmorEntity(), new TestTankEntity(),
                new TestProtoMekEntity(), new TestInfantryEntity(), new TestBattleArmorEntity()];
            const plans = planRecordSheetPages(entities, entity => recordSheetLayoutProfile(entity, format), format);
            expect(plans.flatMap(page => page.items)).toEqual(entities);
            expect(plans.some(page => page.items.length > 1)).toBeTrue();
            for (const plan of plans) {
                const blocks = await Promise.all(plan.items.map(entity =>
                    RecordSheetSvgGenerator.generate(entity, { format: 'compact', pageFormat: format })));
                const page = RecordSheetSvgGenerator.composeCompactPage(blocks, format);
                stage.replaceChildren(page);
                const footer = page.querySelector<SVGGraphicsElement>('#footer');
                expect(footer).not.toBeNull();
                const footerTop = footer!.getBoundingClientRect().top;
                const unitBlocks = [...page.querySelectorAll<SVGGraphicsElement>('.compact-sheet-block')];
                for (const block of unitBlocks) expect(block.getBoundingClientRect().bottom).toBeLessThan(footerTop);
            }
        });

        it(`keeps packed handheld strips clear of their logo and footer on ${format}`, async () => {
            const entity = new TestHandheldWeaponEntity();
            const profile = recordSheetLayoutProfile(entity, format);
            const blocks = Array.from({ length: 11 }, () => profile);
            const plan = planRecordSheetPages(blocks, value => value, format)[0];
            const block = await RecordSheetSvgGenerator.generate(entity, { format: 'compact', pageFormat: format });
            const page = RecordSheetSvgGenerator.composeCompactPage(plan.items.map(() => block), format);
            stage.replaceChildren(page);
            const strips = [...page.querySelectorAll<SVGGraphicsElement>('.handheld-weapon-strip')];
            const bottom = strips[strips.length - 1].getBoundingClientRect().bottom;
            const logo = page.querySelector<SVGGraphicsElement>('#cglLogoBW')!.getBoundingClientRect();
            const footer = page.querySelector<SVGGraphicsElement>('#footer')!.getBoundingClientRect();
            expect(bottom).toBeLessThan(logo.top);
            expect(bottom).toBeLessThan(footer.top);
            expect(logo.right).toBeLessThan(footer.left);
        });
    }
});
