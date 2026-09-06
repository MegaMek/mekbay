// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
    TestAeroSpaceFighterEntity,
    TestConvFighterEntity,
    TestJumpShipEntity,
    TestProtoMekEntity,
    TestSpaceStationEntity,
    TestSupportNavalEntity,
    TestTankEntity,
    TestVtolEntity,
    TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('generated paperdoll pointer targets', () => {
    const mounted: SVGSVGElement[] = [];
    afterEach(() => mounted.splice(0).forEach(svg => svg.remove()));

    function tank(turrets: number, superheavy = false): TestTankEntity {
        const entity = new TestTankEntity();
        entity.setTonnage(superheavy ? 190 : 50);
        entity.hasTurret.set(turrets > 0);
        entity.hasDualTurret.set(turrets > 1);
        return entity;
    }

    function proto(chassis: 'biped' | 'quad' | 'glider'): TestProtoMekEntity {
        const entity = new TestProtoMekEntity();
        entity.setTonnage(9);
        entity.isQuad.set(chassis === 'quad');
        entity.isGlider.set(chassis === 'glider');
        entity.hasMainGun.set(true);
        return entity;
    }

    function mount(svg: SVGSVGElement): void {
        const viewBox = svg.viewBox.baseVal;
        const scale = Math.min((window.innerWidth - 20) / viewBox.width,
            (window.innerHeight - 20) / viewBox.height);
        svg.classList.add('mekbay-sheet');
        Object.assign(svg.style, {
            position: 'fixed', left: '10px', top: '10px', zIndex: '2147483647',
            width: `${viewBox.width * scale}px`, height: `${viewBox.height * scale}px`,
        });
        document.body.appendChild(svg);
        mounted.push(svg);
    }

    function expectPipsHitContours(svg: SVGSVGElement, name: string): void {
        const buttons = [...svg.querySelectorAll<SVGGElement>('[data-mekbay-paperdoll] [data-mekbay-random-hit]')];
        expect(buttons.length).withContext(`${name}: random-hit controls`).toBeGreaterThan(0);
        for (const button of buttons) {
            const matrix = button.getScreenCTM()!;
            const center = new DOMPoint(14, 14).matrixTransform(matrix);
            expect(document.elementFromPoint(center.x, center.y)?.closest('[data-mekbay-random-hit]'))
                .withContext(`${name}: random-hit control remains clickable`).toBe(button);
            const layer = button.closest<SVGGElement>('[data-mekbay-paperdoll]')!;
            const localMatrix = layer.getScreenCTM()!.inverse().multiply(matrix);
            const topLeft = new DOMPoint(-1, -1).matrixTransform(localMatrix);
            const bottomRight = new DOMPoint(29, 29).matrixTransform(localMatrix);
            expect(topLeft.x).withContext(`${name}: button stays inside panel left`).toBeGreaterThanOrEqual(0);
            expect(topLeft.y).withContext(`${name}: button stays inside panel top`).toBeGreaterThanOrEqual(0);
            expect(bottomRight.x).withContext(`${name}: button stays inside panel right`)
                .toBeLessThanOrEqual(Number(layer.dataset['width']));
            expect(bottomRight.y).withContext(`${name}: button stays inside panel bottom`)
                .toBeLessThanOrEqual(Number(layer.dataset['height']));
            button.style.display = 'none';
            const coveredLocations = new Set<string>();
            for (let x = -1; x <= 29; x += 2) {
                for (let y = -1; y <= 29; y += 2) {
                    if ((x - 14) ** 2 + (y - 14) ** 2 > 15 ** 2) continue;
                    const point = new DOMPoint(x, y).matrixTransform(matrix);
                    const covered = document.elementFromPoint(point.x, point.y)?.closest('.unitLocation, .bombButton');
                    if (covered) coveredLocations.add(covered.getAttribute('data-loc') ?? covered.getAttribute('class')!);
                }
            }
            button.style.removeProperty('display');
            expect([...coveredLocations]).withContext(`${name}: button does not cover damage locations or stores`).toEqual([]);
        }
        const pips = [...svg.querySelectorAll<SVGGraphicsElement>(
            '[data-mekbay-paperdoll] .pip.armor, [data-mekbay-paperdoll] .pip.structure',
        )];
        expect(pips.length).withContext(name).toBeGreaterThan(0);
        expect(svg.querySelector('[data-mekbay-paperdoll] .pip-hit-area')).toBeNull();
        const failures: string[] = [];
        const checked = new Set<string>();
        for (const pip of pips) {
            const type = pip.classList.contains('armor') ? 'armor' : 'structure';
            const location = pip.getAttribute('data-loc');
            const expected = `${type}:${location}`;
            checked.add(expected);
            const bounds = pip.getBBox();
            const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                .matrixTransform(pip.getScreenCTM()!);
            const hit = document.elementFromPoint(center.x, center.y);
            const target = hit?.closest('.unitLocation');
            if (getComputedStyle(pip).pointerEvents !== 'none') {
                failures.push(`${expected}: pip intercepts pointers`);
            }
            if (!target?.classList.contains(type) || target.getAttribute('data-loc') !== location
                || target.closest('[data-mekbay-paperdoll]') !== pip.closest('[data-mekbay-paperdoll]')) {
                failures.push(`${expected} at (${center.x.toFixed(2)}, ${center.y.toFixed(2)}) hit `
                    + `${hit?.tagName}#${hit?.id}.${hit?.getAttribute('class')}[${target?.getAttribute('data-loc')}]`);
            }
        }
        expect([...checked].some(key => key.startsWith('armor:'))).toBeTrue();
        expect([...checked].some(key => key.startsWith('structure:'))).toBeTrue();
        expect(failures).withContext(name).toEqual([]);
    }

    const cases: readonly { name: string; create: () => BaseEntity }[] = [
        { name: 'vehicle without turret', create: () => tank(0) },
        { name: 'vehicle with turret', create: () => tank(1) },
        { name: 'vehicle with dual turrets', create: () => tank(2) },
        { name: 'superheavy vehicle with dual turrets', create: () => tank(2, true) },
        { name: 'naval vessel', create: () => {
            const entity = new TestSupportNavalEntity();
            entity.setTonnage(100);
            entity.hasTurret.set(true);
            return entity;
        } },
        { name: 'VTOL', create: () => {
            const entity = new TestVtolEntity();
            entity.setTonnage(30);
            entity.hasTurret.set(true);
            return entity;
        } },
        { name: 'WiGE with dual turrets', create: () => {
            const entity = tank(2);
            entity.motiveType.set('WiGE');
            return entity;
        } },
        ...(['biped', 'quad', 'glider'] as const).map(chassis => ({
            name: `${chassis} ProtoMek`, create: () => proto(chassis),
        })),
        { name: 'aerospace fighter', create: () => {
            const entity = new TestAeroSpaceFighterEntity();
            entity.setTonnage(50);
            entity.structuralIntegrity.set(8);
            return entity;
        } },
        { name: 'conventional fighter', create: () => {
            const entity = new TestConvFighterEntity();
            entity.setTonnage(40);
            entity.structuralIntegrity.set(6);
            return entity;
        } },
        ...[
            { name: 'JumpShip', create: () => new TestJumpShipEntity() },
            { name: 'WarShip', create: () => new TestWarShipEntity() },
            { name: 'space station', create: () => new TestSpaceStationEntity() },
        ].map(({ name, create }) => ({ name, create: () => {
            const entity = create();
            entity.setTonnage(100_000);
            entity.structuralIntegrity.set(8);
            return entity;
        } })),
    ];

    for (const { name, create } of cases) {
        it(`hits the correct visible armor or structure contour through every ${name} pip`, async () => {
            const entity = create();
            for (const location of entity.armorLocations) {
                entity.setArmorValue(location, 'front', Math.min(24, entity.maxArmorValues().get(location) ?? 24));
            }
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            mount(svg);
            expectPipsHitContours(svg, name);
        });
    }

    it('preserves independent clipped targets for repeated units on a composed compact page', async () => {
        const entity = tank(2, true);
        for (const location of entity.armorLocations) entity.setArmorValue(location, 'front', 24);
        const blocks = await Promise.all([1, 2].map(() =>
            RecordSheetSvgGenerator.generate(entity, { format: 'compact' })));
        const page = RecordSheetSvgGenerator.composeCompactPage(blocks);
        mount(page);

        const clips = [...page.querySelectorAll('clipPath[id]')];
        expect(clips.length).toBeGreaterThan(0);
        expect(new Set(clips.map(clip => clip.id)).size).toBe(clips.length);
        for (const element of page.querySelectorAll('[clip-path]')) {
            const id = element.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/u)?.[1];
            expect(id ? page.querySelectorAll(`[id="${id}"]`).length : 0).toBe(1);
        }
        expectPipsHitContours(page, 'composed compact page');
    });
});
