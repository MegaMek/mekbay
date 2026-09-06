// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MountedArmor } from '../../models/entity/components/armor';
import { MountedStructure } from '../../models/entity/components/structure';
import { ArmorEquipment, StructureEquipment } from '../../models/equipment.model';
import type { ArmorType } from '../../models/entity/types';
import { TestBipedMekEntity, TestTankEntity, TestWarShipEntity } from '../../models/entity/testing/test-entities';
import { CapitalShipPipRenderer } from './capital-ship-pip-renderer';
import { CanonPipRenderer } from './canon-pip-renderer';
import { decoratePaperdollPips } from './record-sheet-svg-rendering';
import { applyRecordSheetPipMaterials } from './record-sheet-pip-materials';

function armor(type: ArmorType, bar = 10): MountedArmor {
    return new MountedArmor({ armor: new ArmorEquipment({
        id: type, name: type, type: 'armor', armor: { type, bar },
    }) });
}

function structure(typeId: number): MountedStructure {
    return new MountedStructure({ tonnage: 50, structure: new StructureEquipment({
        id: `structure-${typeId}`, name: `structure-${typeId}`, type: 'structure', structure: { typeId },
    }) });
}

function sheet(content = ''): SVGSVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
    return host.querySelector('svg')!;
}

describe('record-sheet Fancy Pips', () => {
    for (const type of [
        'REACTIVE', 'REFLECTIVE', 'FERRO_LAMELLOR', 'ANTI_PENETRATIVE_ABLATION',
        'HEAT_DISSIPATING', 'IMPACT_RESISTANT', 'BALLISTIC_REINFORCED',
        'BA_FIRE_RESIST', 'BA_REFLECTIVE', 'BA_REACTIVE',
    ] as const) {
        it(`uses a pentagon for ${type} armor`, () => {
            const entity = new TestTankEntity();
            entity.setUniformArmor(armor(type));
            const svg = sheet('<circle class="pip armor" data-loc="FR" cx="10" cy="20" r="3" fill="white" stroke="black" stroke-width=".5"/>');
            applyRecordSheetPipMaterials(svg, entity);
            const pip = svg.querySelector<SVGPolygonElement>('.pip')!;
            expect(pip.tagName).toBe('polygon');
            expect(pip.points.numberOfItems).toBe(5);
            expect(pip.points.getItem(0).x).toBeCloseTo(10, 5);
            expect(pip.points.getItem(0).y).toBeCloseTo(17, 5);
            expect(pip.getAttribute('fill')).toBe('white');
            expect(pip.getAttribute('stroke-width')).toBe('.5');
            expect(svg.querySelector('.half')).toBeNull();
        });
    }

    it('resolves patchwork armor from both canonical location names and sheet abbreviations', () => {
        const entity = new TestTankEntity();
        entity.setArmorAt('Front', armor('HARDENED'));
        entity.setArmorAt('Left', armor('REACTIVE'));
        entity.setArmorAt('Right', armor('COMMERCIAL', 5));
        const svg = sheet(['Front', 'FR', 'LS', 'RS', 'RR'].map((loc, i) =>
            `<circle class="pip armor" data-loc="${loc}" cx="${i * 10}" cy="20" r="3"/>`).join(''));

        applyRecordSheetPipMaterials(svg, entity);
        applyRecordSheetPipMaterials(svg, entity);

        for (const loc of ['Front', 'FR']) {
            const pips = svg.querySelectorAll<SVGPolygonElement>(`.pip[data-loc="${loc}"]`);
            expect(pips.length).toBe(1);
            expect(pips[0].points.numberOfItems).toBe(4);
        }
        expect(svg.querySelector<SVGPolygonElement>('[data-loc="LS"]')?.points.numberOfItems).toBe(5);
        expect(svg.querySelector('[data-loc="RS"]')?.getAttribute('stroke-dasharray')).toBe('1.8 .85');
        expect(svg.querySelector('[data-loc="RR"]')?.tagName).toBe('circle');
        expect(svg.querySelector('[data-loc="RR"]')?.hasAttribute('stroke-dasharray')).toBeFalse();
    });

    it('uses per-location reinforced and composite structure without relying on display names', () => {
        const entity = new TestBipedMekEntity();
        entity.setStructureAt('CT', structure(4));
        entity.setStructureAt('LT', structure(5));
        const svg = sheet(['CT', 'LT', 'RT'].map((loc, i) =>
            `<circle class="pip structure" data-loc="${loc}" cx="${i * 10}" cy="20" r="3"/>`).join(''));
        applyRecordSheetPipMaterials(svg, entity);

        expect(svg.querySelector<SVGPolygonElement>('[data-loc="CT"]')?.points.numberOfItems).toBe(4);
        expect(svg.querySelectorAll('[data-loc="CT"]').length).toBe(1);
        expect(svg.querySelectorAll('.half').length).toBe(0);
        expect(svg.querySelector('[data-loc="LT"]')?.getAttribute('stroke-dasharray')).toBe('1.8 .85');
        expect(svg.querySelectorAll('[data-loc="LT"].half').length).toBe(0);
        expect(svg.querySelector('[data-loc="RT"]')?.tagName).toBe('circle');
    });

    it('keeps canonical front/rear centers, transforms and runtime attributes while changing only symbols', () => {
        const entity = new TestBipedMekEntity();
        entity.setArmorAt('CT', armor('REACTIVE'));
        const svg = sheet();
        const pips = CanonPipRenderer.createArmorPips('CT', 3, 29.063, 85.873, {})!;
        svg.appendChild(pips);
        decoratePaperdollPips(svg);
        const before = [...pips.querySelectorAll<SVGCircleElement>('.pip')].map((pip, index) => {
            pip.id = `original-${index}`;
            pip.setAttribute('data-rear', '1');
            pip.setAttribute('data-pip-index', String(index));
            return { x: pip.cx.baseVal.value, y: pip.cy.baseVal.value, r: pip.r.baseVal.value };
        });
        const transform = pips.getAttribute('transform');
        expect(before.length).toBe(3);
        applyRecordSheetPipMaterials(svg, entity);

        expect(pips.getAttribute('transform')).toBe(transform);
        expect(pips.querySelectorAll('.pip').length).toBe(before.length);
        [...pips.querySelectorAll<SVGPolygonElement>('.pip')].forEach((pip, index) => {
            const vertices = Array.from({ length: pip.points.numberOfItems }, (_, i) => pip.points.getItem(i));
            expect(vertices.reduce((sum, point) => sum + point.x, 0) / 5).toBeCloseTo(before[index].x, 4);
            expect(vertices.reduce((sum, point) => sum + point.y, 0) / 5).toBeCloseTo(before[index].y, 4);
            expect(vertices.every(point => Math.abs(Math.hypot(point.x - before[index].x, point.y - before[index].y)
                - before[index].r) < 0.0001)).toBeTrue();
            expect(pip.getAttribute('points')!.split(/[ ,]/u).every(coordinate =>
                /^-?\d+(?:\.\d{1,4})?$/u.test(coordinate))).toBeTrue();
            expect(pip.id).toBe(`original-${index}`);
            expect(pip.getAttribute('data-rear')).toBe('1');
            expect(pip.getAttribute('data-pip-index')).toBe(String(index));
        });
    });

    it('preserves MegaMekLab capital square tables and equipment-specific shield symbols', () => {
        const entity = new TestWarShipEntity();
        entity.setUniformArmor(armor('REACTIVE'));
        const svg = sheet('<circle class="pip shield" data-loc="DCLA" cx="10" cy="20" r="3"/>');
        const grid = CapitalShipPipRenderer.createPips(20, 80, 80, 'armor', 'NOS')!;
        svg.appendChild(grid);
        const before = grid.outerHTML;
        applyRecordSheetPipMaterials(svg, entity);
        expect(grid.outerHTML).toBe(before);
        expect(svg.querySelector('.pip.shield')?.tagName).toBe('circle');
    });
});
