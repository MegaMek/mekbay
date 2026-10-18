// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestBipedMekEntity,
    TestConvFighterEntity, TestDropShipEntity, TestFixedWingSupportEntity,
    TestInfantryEntity, TestJumpShipEntity, TestLamEntity,
    TestProtoMekEntity, TestQuadMekEntity, TestQuadVeeEntity, TestSmallCraftEntity,
    TestSpaceStationEntity, TestSupportNavalEntity, TestTankEntity, TestTripodMekEntity,
    TestVtolEntity, TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';
import { planRecordSheetPages } from './record-sheet-layout';
import { recordSheetLayoutProfile } from './layouts/record-sheet-layout-resolver';

describe('record-sheet physical paper formats', () => {
    for (const Factory of [TestBipedMekEntity, TestQuadMekEntity, TestTripodMekEntity, TestLamEntity, TestQuadVeeEntity,
        TestAeroSpaceFighterEntity, TestConvFighterEntity, TestFixedWingSupportEntity, TestSmallCraftEntity,
        TestDropShipEntity, TestJumpShipEntity, TestWarShipEntity, TestSpaceStationEntity, TestTankEntity,
        TestVtolEntity, TestSupportNavalEntity, TestProtoMekEntity]) {
        it(`uses Letter and A4 page dimensions for ${Factory.name}`, async () => {
            const entity = new Factory();
            const letter = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'letter' });
            const a4 = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'a4' });
            expect(letter.getAttribute('viewBox')).toBe('0 0 612 792');
            expect(a4.getAttribute('viewBox')).toBe('0 0 595.276 841.89');
        });
    }

    for (const format of ['letter', 'a4'] as const) {
        it(`packs infantry and ProtoMeks at their actual stride on ${format}`, () => {
            for (const [Factory, capacity] of [[TestInfantryEntity, 4], [TestProtoMekEntity, 5]] as const) {
                const units = Array.from({ length: capacity + 1 }, () => new Factory());
                expect(planRecordSheetPages(units, entity => recordSheetLayoutProfile(entity, format), format)
                    .map(page => page.items.length)).toEqual([capacity, 1]);
            }
        });

        it(`includes infantry cluster tables on lone-unit ${format} pages and omits them for two units`, async () => {
            for (const Factory of [TestBattleArmorEntity, TestInfantryEntity]) {
                const block = await RecordSheetSvgGenerator.generate(new Factory(), { ruleset: 'total-warfare', format: 'compact', pageFormat: format });
                const page = RecordSheetSvgGenerator.composeCompactPage([block], format);
                expect(page.querySelector('[data-mekbay-reference="cluster-hits"]')).not.toBeNull();
                const pair = RecordSheetSvgGenerator.composeCompactPage([block, block.cloneNode(true) as SVGSVGElement], format);
                expect(pair.querySelectorAll('.compact-sheet-block').length).toBe(2);
                expect(pair.querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
            }
        });

        it(`shares ${format} pages between multiple small-unit families and keeps their footer`, async () => {
            const entities = [new TestInfantryEntity(), new TestBattleArmorEntity(), new TestTankEntity(),
                new TestProtoMekEntity(), new TestInfantryEntity(), new TestBattleArmorEntity()];
            const plans = planRecordSheetPages(entities, entity => recordSheetLayoutProfile(entity, format), format);
            expect(plans.flatMap(page => page.items)).toEqual(entities);
            expect(plans.some(page => page.items.length > 1)).toBeTrue();
            for (const plan of plans) {
                const blocks = await Promise.all(plan.items.map(entity =>
                    RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact', pageFormat: format })));
                const page = RecordSheetSvgGenerator.composeCompactPage(blocks, format);
                expect(page.querySelector('#footer')).not.toBeNull();
            }
        });
    }
});
