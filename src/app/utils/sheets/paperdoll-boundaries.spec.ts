// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity, TestProtoMekEntity, TestSpaceStationEntity, TestTankEntity } from '../../models/entity/testing/test-entities';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('paperdoll location boundaries', () => {
    let mounted: SVGSVGElement | undefined;
    afterEach(() => { mounted?.remove(); mounted = undefined; });

    function mount(svg: SVGSVGElement): void {
        const box = svg.viewBox.baseVal;
        const scale = Math.min((window.innerWidth - 20) / box.width, (window.innerHeight - 20) / box.height);
        Object.assign(svg.style, {
            position: 'fixed', left: '10px', top: '10px', zIndex: '2147483647',
            width: `${box.width * scale}px`, height: `${box.height * scale}px`,
        });
        document.body.appendChild(svg);
        mounted = svg;
    }

    function center(element: SVGGraphicsElement): DOMPoint {
        const b = element.getBBox();
        return new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(element.getScreenCTM()!);
    }

    function expectNoUnderlay(svg: SVGSVGElement, underneath: string, overlying: string): void {
        const layer = svg.querySelector<SVGGElement>('[data-mekbay-paperdoll][data-type="armor"]')!;
        const front = layer.querySelector<SVGGraphicsElement>(overlying)!;
        const point = center(front);
        // Hide pointer surfaces only. The unselected anatomy still paints normally,
        // so a successful test cannot rely on it intercepting an overlarge target.
        const targets = activateTargets(layer, underneath);
        expect(targets.length).toBeGreaterThan(0);
        const hit = document.elementFromPoint(point.x, point.y)?.closest('.unitLocation');
        expect(targets).withContext(`${underneath} must not extend beneath ${overlying}`).not.toContain(hit as SVGElement);
    }

    function activateTargets(layer: SVGGElement, selector: string): SVGElement[] {
        layer.querySelectorAll<SVGElement>('.unitLocation, [data-mekbay-random-hit]').forEach(element => {
            element.style.pointerEvents = 'none';
        });
        const targets = [...layer.querySelectorAll<SVGElement>(selector)];
        targets.forEach(target => { target.style.pointerEvents = 'all'; });
        return targets;
    }

    it('keeps biped torso interaction out of the head even when the head cannot intercept it', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        mount(svg);
        expectNoUnderlay(svg, '.unitLocation.armor[data-loc="CT"]', '.unitLocation.armor[data-loc="HD"]');
    });

    it('keeps vehicle hull armor out of internal structure and turret armor out of turret structure', async () => {
        const entity = new TestTankEntity();
        entity.setTonnage(50);
        entity.hasTurret.set(true);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        mount(svg);
        expectNoUnderlay(svg, '.unitLocation.armor[data-loc="LS"]', '.unitLocation.structure[data-loc="LS"]');
        expectNoUnderlay(svg, '.unitLocation.armor[data-loc="TU"]', '.unitLocation.structure[data-loc="TU"]');
    });

    it('keeps space station aft support gaps inert while retaining the struts and enclosed nozzle armor', async () => {
        const entity = new TestSpaceStationEntity();
        entity.setTonnage(100_000);
        const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
        mount(svg);
        const layer = svg.querySelector<SVGGElement>('[data-mekbay-paperdoll][data-type="armor"]')!;
        const armor = activateTargets(layer, '.unitLocation.armor[data-loc="AFT"]');
        const contour = armor[0] as SVGGraphicsElement;
        const matrix = contour.getScreenCTM()!;
        const hitAt = (x: number, y: number): SVGElement | null => {
            const point = new DOMPoint(x, y).matrixTransform(matrix);
            return document.elementFromPoint(point.x, point.y)?.closest<SVGElement>('.unitLocation') ?? null;
        };
        // These points lie in the authored hull coordinate system: the connected
        // void around the middle strut and the two gaps above the wing braces.
        for (const [x, y] of [[408, 425], [421, 425], [415, 434.25], [403, 415], [427, 415]]) {
            expect(armor).withContext(`open support gap at ${x},${y}`).not.toContain(hitAt(x, y) as SVGElement);
        }
        for (const [x, y] of [[415, 425], [395, 425], [435, 425], [415, 406]]) {
            expect(armor).withContext(`solid strut or enclosed armor at ${x},${y}`).toContain(hitAt(x, y) as SVGElement);
        }
    });

    for (const chassis of ['biped', 'quad', 'glider'] as const) {
        it(`keeps ${chassis} ProtoMek torso out of head and optional gun, then restores the gun cutout when unequipped`, async () => {
            const entity = new TestProtoMekEntity();
            entity.setTonnage(9);
            entity.isQuad.set(chassis === 'quad');
            entity.isGlider.set(chassis === 'glider');
            entity.hasMainGun.set(true);
            const armed = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            mount(armed);
            expectNoUnderlay(armed, '.unitLocation.armor[data-loc="T"]', '.unitLocation.armor[data-loc="HD"]');
            expectNoUnderlay(armed, '.unitLocation.armor[data-loc="T"]', '.unitLocation.structure[data-loc="MG"]');
            expect(armed.querySelector('[data-protomek-main-gun-clip][clip-path]')).not.toBeNull();
            const armedLayer = armed.querySelector<SVGGElement>('[data-mekbay-paperdoll][data-type="armor"]')!;
            const gun = armedLayer.querySelector<SVGGeometryElement>('.unitLocation.armor[data-loc="MG"]')!;
            const gunBounds = gun.getBBox();
            const gunToScreen = gun.getScreenCTM()!;
            const gunToLayer = armedLayer.getScreenCTM()!.inverse().multiply(gunToScreen);
            const formerGunArea: DOMPoint[] = [];
            activateTargets(armedLayer, '.unitLocation[data-loc="MG"]');
            for (let row = 0; row < 12; row++) {
                for (let column = 0; column < 12; column++) {
                    const point = new DOMPoint(gunBounds.x + gunBounds.width * (column + 0.5) / 12,
                        gunBounds.y + gunBounds.height * (row + 0.5) / 12);
                    if (!gun.isPointInFill(point)) continue;
                    const screenPoint = point.matrixTransform(gunToScreen);
                    const hit = document.elementFromPoint(screenPoint.x, screenPoint.y)?.closest('.unitLocation');
                    if (hit?.getAttribute('data-loc') === 'MG') formerGunArea.push(point.matrixTransform(gunToLayer));
                }
            }
            expect(formerGunArea.length).withContext('samples actual gun targets in paperdoll coordinates').toBeGreaterThan(0);
            const armedTorso = activateTargets(armedLayer, '.unitLocation.armor[data-loc="T"]');
            const armedMatrix = armedLayer.getScreenCTM()!;
            expect(formerGunArea.some(point => {
                const screenPoint = point.matrixTransform(armedMatrix);
                return armedTorso.includes(document.elementFromPoint(screenPoint.x, screenPoint.y)?.closest('.unitLocation') as SVGElement);
            })).withContext('torso cannot intercept any sampled gun point while equipped').toBeFalse();
            armed.remove();

            entity.hasMainGun.set(false);
            const unarmed = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            mount(unarmed);
            expect(unarmed.querySelector('[data-protomek-main-gun]')).toBeNull();
            expect(unarmed.querySelector('[data-protomek-main-gun-clip][clip-path]')).toBeNull();
            expect(unarmed.querySelector('[data-protomek-main-gun-clip] .unitLocation.armor[data-loc="T"]')).not.toBeNull();
            expectNoUnderlay(unarmed, '.unitLocation.armor[data-loc="T"]', '.unitLocation.armor[data-loc="HD"]');
            const unarmedLayer = unarmed.querySelector<SVGGElement>('[data-mekbay-paperdoll][data-type="armor"]')!;
            const unarmedTorso = [...unarmedLayer.querySelectorAll<SVGElement>('.unitLocation.armor[data-loc="T"]')];
            const unarmedMatrix = unarmedLayer.getScreenCTM()!;
            expect(formerGunArea.some(point => {
                const screenPoint = point.matrixTransform(unarmedMatrix);
                return unarmedTorso.includes(document.elementFromPoint(screenPoint.x, screenPoint.y)?.closest('.unitLocation') as SVGElement);
            })).withContext('unequipping the gun exposes a clickable torso within its former footprint').toBeTrue();
        });
    }
});
