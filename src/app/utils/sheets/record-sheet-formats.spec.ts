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
import type { BaseEntity } from '../../models/entity/base-entity';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
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

        it(`fits one cluster table between the infantry blocks and the other references on ${format}`, async () => {
            const blocks = await Promise.all([5, 8].map(size => {
                const platoon = new TestInfantryEntity();
                platoon.squadSize.set(size);
                return RecordSheetSvgGenerator.generate(platoon, { ruleset: 'total-warfare', format: 'compact', pageFormat: format });
            }));
            const pair = RecordSheetSvgGenerator.composeCompactPage(blocks, format);
            expect(clusterColumns(pair)).toEqual([2, 3, 4, 5, 6, 7, 8]);
            const table = pair.querySelector<SVGGElement>('[data-mekbay-reference="cluster-hits"]')!;
            const lastBlock = pair.querySelectorAll<SVGGElement>('.compact-sheet-block')[1];
            const burstFire = [...pair.querySelectorAll<SVGGElement>('g[data-mekbay-frame-height]')]
                .find(frame => frame.querySelector('.svg-frame-title')?.textContent?.startsWith('BURST-FIRE'))!;
            const top = table.transform.baseVal.getItem(0).matrix.f;
            expect(top).toBeGreaterThan(lastBlock.transform.baseVal.getItem(0).matrix.f + blocks[1].viewBox.baseVal.height);
            expect(top + Number(table.dataset['mekbayFrameHeight'])).toBeLessThan(burstFire.transform.baseVal.getItem(0).matrix.f);
            const triple = RecordSheetSvgGenerator.composeCompactPage([...blocks, blocks[0]], format);
            expect(triple.querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
        });

        it(`fits a cluster table beside the battle armor references with four units on ${format}`, async () => {
            const armor = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), {
                ruleset: 'total-warfare', format: 'compact', pageFormat: format,
            });
            const page = RecordSheetSvgGenerator.composeCompactPage(Array(4).fill(armor), format);
            expect(clusterColumns(page)).toEqual([2, 3, 4, 5]);
            expect(page.textContent).toContain('LEG ATTACKS TABLE');
        });

        it(`merges overlapping weapon columns once for same-family and mixed ${format} pages`, async () => {
            const first = new TestProtoMekEntity();
            const second = new TestProtoMekEntity();
            const handheld = new TestHandheldWeaponEntity();
            addClusterWeapons(first, [2, 3, 4, 10, 15], 'Main Gun');
            addClusterWeapons(second, [2, 4, 12, 13], 'Main Gun');
            addClusterWeapons(handheld, [2, 4, 12, 13], 'Gun');
            const [one, two, gun] = await Promise.all([first, second, handheld].map(entity =>
                RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact', pageFormat: format })));
            for (const other of [two, gun]) {
                const page = RecordSheetSvgGenerator.composeCompactPage([one, other], format);
                expect(clusterColumns(page)).toEqual([2, 3, 4, 10, 12, 13, 15]);
            }
            const plain = await RecordSheetSvgGenerator.generate(new TestHandheldWeaponEntity(), {
                ruleset: 'total-warfare', format: 'compact', pageFormat: format,
            });
            expect(clusterColumns(RecordSheetSvgGenerator.composeCompactPage([plain, gun], format))).toEqual([2, 4, 12, 13]);
            expect(RecordSheetSvgGenerator.composeCompactPage([plain, plain], format)
                .querySelector('[data-mekbay-reference="cluster-hits"]')).toBeNull();
        });

        it(`keeps the vehicle and VTOL cluster tables inside their blocks on mixed ${format} pages`, async () => {
            const armor = await RecordSheetSvgGenerator.generate(new TestBattleArmorEntity(), {
                ruleset: 'total-warfare', format: 'compact', pageFormat: format,
            });
            for (const vehicle of [new TestTankEntity(), new TestVtolEntity()]) {
                addClusterWeapons(vehicle, [20], 'Front');
                const block = await RecordSheetSvgGenerator.generate(vehicle, {
                    ruleset: 'total-warfare', format: 'compact', pageFormat: format,
                });
                const page = RecordSheetSvgGenerator.composeCompactPage([block, armor], format);
                const embedded = page.querySelector('.compact-sheet-block [data-mekbay-reference="cluster-hits"]')!;
                expect(embedded.isEqualNode(block.querySelector('[data-mekbay-reference="cluster-hits"]'))).toBeTrue();
                const shared = page.querySelector(':scope > [data-mekbay-reference="cluster-hits"]')!;
                expect(rackColumns(shared)).toEqual([2, 3, 4, 5]);
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

function clusterColumns(page: SVGSVGElement): number[] {
    expect(page.querySelectorAll('[data-mekbay-reference="cluster-hits"]').length).toBe(1);
    return rackColumns(page);
}

function rackColumns(table: Element): number[] {
    return [...table.querySelectorAll('[data-cluster-roll="2"]')].map(cell => Number(cell.getAttribute('data-cluster-rack')));
}

function addClusterWeapons(entity: BaseEntity, sizes: number[], location: string): void {
    for (const size of sizes) {
        addTestEquipment(entity, new WeaponEquipment({ id: `LRM ${size}`, name: `LRM ${size}`, type: 'weapon',
            weapon: { damage: 'cluster', ammoType: 'LRM', rackSize: size } }), { location });
    }
}
