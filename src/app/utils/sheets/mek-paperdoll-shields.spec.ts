// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity, TestTripodMekEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('generated Mek shield paperdolls', () => {
    let mounted: SVGSVGElement | undefined;
    let bipedBodyGeometry: number[] | undefined;

    afterEach(() => {
        mounted?.remove();
        mounted = undefined;
    });

    for (const chassis of ['biped', 'tripod'] as const) {
        for (const equipped of [[], ['LA'], ['RA'], ['LA', 'RA']] as const) {
            const variant = `${chassis}-${equipped.join('-') || 'none'}`;
            it(`renders only equipped shield sides and their tracks on a full ${variant} sheet`, async () => {
                const entity = chassis === 'biped' ? new TestBipedMekEntity() : new TestTripodMekEntity();
                entity.setTonnage(50);
                for (const location of entity.armorLocations) {
                    entity.setArmorValue(location, 'front', Math.min(18, entity.maxArmorValues().get(location) ?? 18));
                }
                for (const arm of equipped) {
                    addTestEquipmentWithFlags(entity,
                        ['F_SHIELD', arm === 'LA' ? 'S_SHIELD_SMALL' : 'S_SHIELD_LARGE'], { location: arm });
                }
                const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'letter' });
                mounted = svg;
                document.body.appendChild(svg);
                await document.fonts.ready;
                const front = svg.querySelector<SVGGElement>('.mek-paperdoll-front')!;
                expect(front).withContext(variant).not.toBeNull();
                for (const arm of ['LA', 'RA'] as const) {
                    const present = (equipped as readonly string[]).includes(arm);
                    const art = [...front.querySelectorAll<SVGElement>(`[data-mekbay-shield="${arm}"]`)];
                    expect(art.length > 0).withContext(`${variant} ${arm} art`).toBe(present);
                    expect(art.every(element => getComputedStyle(element).visibility === 'visible'))
                        .withContext(`${variant} ${arm} visible art`).toBeTrue();
                    expect(front.querySelectorAll(`.pip.shield[data-loc="DC${arm}"]`).length)
                        .withContext(`${variant} ${arm} capacity`).toBe(present ? arm === 'LA' ? 11 : 25 : 0);
                    expect(front.querySelectorAll(`.pip.shield[data-loc="DA${arm}"]`).length)
                        .withContext(`${variant} ${arm} absorption`).toBe(present ? arm === 'LA' ? 3 : 7 : 0);
                    for (const pip of front.querySelectorAll<SVGGraphicsElement>(`.pip.shield[data-loc$="${arm}"]`)) {
                        const bounds = pip.getBBox();
                        const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                            .matrixTransform(pip.getScreenCTM()!);
                        const target = document.elementFromPoint(point.x, point.y)?.closest('.unitLocation.shield');
                        expect(target?.getAttribute('data-loc'))
                            .withContext(`${variant} ${pip.getAttribute('data-loc')} pip center hits authored shield contour`)
                            .toBe(pip.getAttribute('data-loc'));
                    }
                    if (present) {
                        const samples = chassis === 'biped'
                            ? arm === 'LA' ? { DC: [16, 5], DA: [6, 100] } : { DC: [172, 5], DA: [183, 100] }
                            : arm === 'LA' ? { DC: [411, 31], DA: [401, 120] } : { DC: [571, 31], DA: [581, 120] };
                        for (const track of ['DC', 'DA'] as const) {
                            const target = front.querySelector<SVGGraphicsElement>(`.unitLocation.shield[data-loc="${track}${arm}"]`)!;
                            const [x, y] = samples[track];
                            const point = new DOMPoint(x, y).matrixTransform(target.getScreenCTM()!);
                            expect(document.elementFromPoint(point.x, point.y))
                                .withContext(`${variant} ${track}${arm} empty panel area hits its contour`).toBe(target);
                        }
                    }
                    if (!present) {
                        expect(front.querySelector(`.unitLocation.shield[data-loc="DC${arm}"], .unitLocation.shield[data-loc="DA${arm}"]`))
                            .withContext(`${variant} ${arm} has no empty shield targets`).toBeNull();
                    }
                }
                expect(svg.querySelector('.mek-paperdoll-rear [data-mekbay-random-hit]')).toBeNull();
                expect(front.querySelectorAll('[data-mekbay-random-hit]')).toHaveSize(1);
                if (chassis === 'biped') {
                    const boundsInFront = (element: SVGGraphicsElement) => {
                        const bounds = element.getBBox();
                        const matrix = front.getCTM()!.inverse().multiply(element.getCTM()!);
                        const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
                        const end = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix);
                        return { left: start.x, top: start.y, right: end.x, bottom: end.y };
                    };
                    const die = front.querySelector<SVGGraphicsElement>('[data-mekbay-random-hit]')!;
                    expect(die.getAttribute('transform')).toBe('translate(80 206)');
                    const dieBounds = boundsInFront(die);
                    const centerX = (dieBounds.left + dieBounds.right) / 2;
                    const centerY = (dieBounds.top + dieBounds.bottom) / 2;
                    const legs = ['LL', 'RL'].map(location => boundsInFront(
                        front.querySelector<SVGGraphicsElement>(`.armor.unitLocation[data-loc="${location}"]`)!,
                    )).sort((a, b) => a.left - b.left);
                    expect(centerX).withContext(`${variant} die clears left leg`).toBeGreaterThan(legs[0].right);
                    expect(centerX).withContext(`${variant} die clears right leg`).toBeLessThan(legs[1].left);
                    expect(centerY).toBeGreaterThan(boundsInFront(front.querySelector<SVGGraphicsElement>('#textArmor_CT')!).bottom);
                    expect(centerY).toBeLessThan(Math.min(legs[0].bottom, legs[1].bottom));

                    const geometry = [...front.querySelectorAll<SVGGraphicsElement>('.armor.unitLocation:not([data-mekbay-shield]), .mek-paperdoll-labels')]
                        .flatMap(element => Object.values(boundsInFront(element)));
                    bipedBodyGeometry ??= geometry;
                    expect(geometry.length).toBe(bipedBodyGeometry.length);
                    geometry.forEach((value, index) => expect(value)
                        .withContext(`${variant} fixed body and label alignment ${index}`)
                        .toBeCloseTo(bipedBodyGeometry![index], 5));
                } else {
                    const icon = front.querySelector<SVGImageElement>('[data-mekbay-random-hit] image')!;
                    const bounds = icon.getBBox();
                    const locations = [...front.querySelectorAll<SVGGeometryElement>('path.armor.unitLocation')];
                    const hitArea = front.querySelector<SVGCircleElement>('[data-mekbay-random-hit] circle')!;
                    for (const radius of [0, 0.5, 1]) {
                        for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 16) {
                            const point = new DOMPoint(
                                hitArea.cx.baseVal.value + Math.cos(angle) * radius * hitArea.r.baseVal.value,
                                hitArea.cy.baseVal.value + Math.sin(angle) * radius * hitArea.r.baseVal.value,
                            ).matrixTransform(hitArea.getCTM()!);
                            for (const location of locations) {
                                expect(location.isPointInFill(point.matrixTransform(location.getCTM()!.inverse())))
                                    .withContext(`${variant} die hit area clears ${location.getAttribute('data-loc')}`)
                                    .toBeFalse();
                            }
                        }
                    }
                    for (let column = 0; column <= 4; column++) {
                        for (let row = 0; row <= 4; row++) {
                            const point = new DOMPoint(bounds.x + bounds.width * column / 4,
                                bounds.y + bounds.height * row / 4).matrixTransform(icon.getCTM()!);
                            for (const location of locations) {
                                expect(location.isPointInFill(point.matrixTransform(location.getCTM()!.inverse())))
                                    .withContext(`${variant} die clears ${location.getAttribute('data-loc')}`)
                                    .toBeFalse();
                            }
                        }
                    }
                    const iconBounds = icon.getBoundingClientRect();
                    for (const label of front.querySelectorAll('text')) {
                        const labelBounds = label.getBoundingClientRect();
                        const overlaps = iconBounds.left < labelBounds.right && iconBounds.right > labelBounds.left
                            && iconBounds.top < labelBounds.bottom && iconBounds.bottom > labelBounds.top;
                        expect(overlaps).withContext(`${variant} die clears label ${label.textContent}`).toBeFalse();
                    }
                }
                expect(svg.querySelectorAll('[data-fill^="shield-"]')).toHaveSize(0);
            });
        }
    }
});
