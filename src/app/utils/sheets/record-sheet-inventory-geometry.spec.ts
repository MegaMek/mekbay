// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { TEST_EQUIPMENT_REGISTRY } from '../../models/entity/testing/test-equipment-registry';
import * as entities from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

const families = [
    entities.TestBipedMekEntity, entities.TestQuadMekEntity, entities.TestTripodMekEntity,
    entities.TestLamEntity, entities.TestQuadVeeEntity, entities.TestTankEntity,
    entities.TestVtolEntity, entities.TestSupportTankEntity, entities.TestLargeSupportTankEntity,
    entities.TestSupportVtolEntity, entities.TestSupportNavalEntity, entities.TestProtoMekEntity,
    entities.TestBattleArmorEntity, entities.TestInfantryEntity, entities.TestAeroSpaceFighterEntity,
    entities.TestConvFighterEntity, entities.TestFixedWingSupportEntity, entities.TestSmallCraftEntity,
    entities.TestDropShipEntity, entities.TestJumpShipEntity, entities.TestWarShipEntity,
    entities.TestSpaceStationEntity, entities.TestHandheldWeaponEntity, StaticEmplacementEntity,
];

describe('Record sheet inventory geometry', () => {
    for (const Family of [entities.TestBipedMekEntity, entities.TestTankEntity, entities.TestAeroSpaceFighterEntity]) {
        it(Family.name + ': wraps cells at the common font size and keeps dense-table badge width and font fixed', async () => {
            const badgeSizes: number[][] = [];
            for (const count of [2, 10]) {
                const entity = new Family();
                const name = 'Medium Re-engineered Laser With Extended Targeting';
                for (let index = 0; index < count; index++) addTestEquipment(entity, new WeaponEquipment({
                    id: 'Wrapping laser ' + index, name: name + ' ' + index, type: 'weapon',
                    weapon: { damage: 6, heat: 7, ranges: [3, 6, 9] },
                }), { location: entity.locationOrder[0] });
                const svg = await RecordSheetSvgGenerator.generate(entity);
                document.body.appendChild(svg);
                try {
                    const rows = Array.from(svg.querySelectorAll<SVGGElement>('.inventoryEntry'))
                        .filter(row => row.querySelector('.name')?.textContent?.startsWith(name));
                    expect(rows.length).toBe(count);
                    const cell = rows[0].querySelector<SVGTextElement>('.name')!;
                    if (count === 2) {
                        expect(Number(cell.getAttribute('font-size'))).toBeCloseTo(6.76, 2);
                        expect(cell.querySelectorAll('tspan').length).toBeGreaterThan(1);
                    }
                    for (const row of rows) {
                        expect(row.querySelector('.name')!.hasAttribute('textLength')).toBeFalse();
                        const rect = row.querySelector<SVGRectElement>('.hitMod-rect')!;
                        const text = row.querySelector<SVGTextElement>('.hitMod-text')!;
                        badgeSizes.push([Number(rect.getAttribute('width')), Number(rect.getAttribute('height')),
                            Number(text.getAttribute('font-size'))]);
                    }
                    const badges = Array.from(svg.querySelectorAll<SVGRectElement>('.hitMod-rect'));
                    const centers = badges.map(rect => {
                        rect.setAttribute('display', 'block');
                        const frame = rect.closest<SVGGElement>('[data-mekbay-frame-width]')!;
                        const matrix = frame.getScreenCTM()!.inverse().multiply(rect.getScreenCTM()!);
                        return { top: new DOMPoint(0, Number(rect.getAttribute('y'))).matrixTransform(matrix).y,
                            height: Number(rect.getAttribute('height')) * matrix.d };
                    }).sort((a, b) => a.top - b.top);
                    for (let index = 1; index < centers.length; index++)
                        expect(centers[index].top - centers[index - 1].top).withContext('badges do not overlap')
                            .toBeGreaterThanOrEqual(centers[index - 1].height - 0.01);
                } finally { svg.remove(); }
            }
            for (const [width, height, fontSize] of badgeSizes) {
                expect(width).toBe(10);
                expect(fontSize).toBe(6.76 * 1.1);
                expect(height).toBeGreaterThanOrEqual(6.5);
                expect(height).toBeLessThanOrEqual(9);
            }
        });
    }
    for (const format of ['letter', 'a4', 'compact'] as const) {
        for (const Family of families) {
            it(`keeps ${Family.name} inventory inside the frame padding (${format})`, async () => {
                const entity = new Family(TEST_EQUIPMENT_REGISTRY);
                addTestEquipment(entity, new WeaponEquipment({
                    id: 'Layout Test Laser', name: 'Medium Re-engineered Laser', type: 'weapon',
                    weapon: { damage: 6, heat: 7, ranges: [3, 6, 9] },
                }), { location: entity.locationOrder[0] ?? 'Building' });
                const svg = await RecordSheetSvgGenerator.generate(entity, { format });
                document.body.appendChild(svg);
                try {
                    const texts = Array.from(svg.querySelectorAll<SVGTextElement>('text'))
                        .filter(text => /^(Min|Sht|Med|Lng|Ext)$/.test(text.textContent ?? '')
                            || text.closest('.inventoryEntry') !== null);
                    for (const text of texts) {
                        if (!text.textContent || text.closest('[display="none"]')) continue;
                        const frame = text.closest<SVGGElement>('[data-mekbay-frame-width]');
                        if (!frame) continue; // Handheld strips have their own authored border.
                        const bounds = text.getBBox();
                        const matrix = frame.getScreenCTM()!.inverse().multiply(text.getScreenCTM()!);
                        const left = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix).x;
                        const right = new DOMPoint(bounds.x + bounds.width, bounds.y).matrixTransform(matrix).x;
                        expect(left).withContext(`${text.textContent}: left padding`).toBeGreaterThanOrEqual(2);
                        expect(right).withContext(`${text.textContent}: right padding`)
                            .toBeLessThanOrEqual(Number(frame.getAttribute('data-mekbay-frame-width')) - 4);
                    }
                    for (const badge of svg.querySelectorAll<SVGRectElement>('.hitMod-rect')) {
                        expect(Number(badge.getAttribute('x')) + Number(badge.getAttribute('width')) / 2)
                            .withContext('weapon modifier centered on the frame').toBeCloseTo(0, 2);
                        const text = badge.parentElement!.querySelector('.hitMod-text');
                        expect(Number(text?.getAttribute('x'))).toBeCloseTo(0, 2);
                    }
                    const movementBadge = svg.querySelector<SVGRectElement>('#mpWalk-turnState-move-rect');
                    // Infantry places movement in an interior column, beside its own labels.
                    if (movementBadge && !(entity instanceof entities.TestInfantryEntity)) {
                        const frame = movementBadge.closest<SVGGElement>('[data-mekbay-frame-width]')
                            ?? svg.querySelector<SVGGElement>('.compact-protomek-frame');
                        if (frame) {
                            const control = movementBadge.closest('.movementControl')!;
                            control.setAttribute('display', 'block');
                            movementBadge.parentElement!.setAttribute('display', 'block');
                            const matrix = frame.getScreenCTM()!.inverse().multiply(movementBadge.getScreenCTM()!);
                            const center = new DOMPoint(Number(movementBadge.getAttribute('x'))
                                + Number(movementBadge.getAttribute('width')) / 2, 0).matrixTransform(matrix);
                            expect(center.x).withContext('movement modifier centered on the frame').toBeCloseTo(0, 2);
                        }
                    }
                    for (const row of svg.querySelectorAll<SVGGElement>('[id^="generated-vehicle-inventory-row"]')) {
                        const name = row.querySelector<SVGTextElement>(':scope > .name')!.getBBox();
                        const location = row.querySelector<SVGTextElement>(':scope > .location')!.getBBox();
                        expect(name.x + name.width).withContext('weapon name clears location')
                            .toBeLessThan(location.x - 1);
                    }
                } finally {
                    svg.remove();
                }
            });
        }
    }
});
