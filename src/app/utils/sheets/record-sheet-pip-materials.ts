// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { STRUCTURE_TYPE, type ArmorType } from '../../models/entity/types';
import { PipRendererShared } from './pip-renderer.shared';
import type { PipShape } from './pip-renderer.types';

// MegaMekLab PipType.forAT: armor that reduces selected damage uses pentagons.
const PENTAGON_ARMORS: ReadonlySet<ArmorType> = new Set([
    'REACTIVE', 'REFLECTIVE', 'FERRO_LAMELLOR', 'ANTI_PENETRATIVE_ABLATION',
    'HEAT_DISSIPATING', 'IMPACT_RESISTANT', 'BALLISTIC_REINFORCED',
    'BA_FIRE_RESIST', 'BA_REFLECTIVE', 'BA_REACTIVE',
]);

/** Applies Fancy Pips to each location after its family has placed the pips. */
export function applyRecordSheetPipMaterials(svg: SVGSVGElement, entity: BaseEntity): void {
    const armor = new Map<string, PipShape>();
    const structure = new Map<string, PipShape>();
    const installedArmor = entity.armorByLocation();
    const installedStructure = entity.structureByLocation();
    for (const location of entity.damageLocations()) {
        const mountedArmor = installedArmor.get(location.code);
        if (mountedArmor) {
            const material = mountedArmor.armor;
            const type = material.armorType as ArmorType;
            const presentation: PipShape = mountedArmor.damagePerPoint === 2 ? 'diamond'
                : material.bar < 10 ? 'circle-dashed'
                : PENTAGON_ARMORS.has(type) ? 'pentagon' : 'circle';
            armor.set(location.code, presentation);
            armor.set(location.sheetCode ?? location.code, presentation);
        }
        const internal = installedStructure.get(location.code);
        if (internal) {
            const presentation: PipShape = internal.damagePerPoint === 2 ? 'diamond'
                : internal.structure.structureTypeId === STRUCTURE_TYPE.COMPOSITE ? 'circle-dashed' : 'circle';
            structure.set(location.code, presentation);
            structure.set(location.sheetCode ?? location.code, presentation);
        }
    }

    // Capital square tables deliberately bypass Fancy Pips in MegaMekLab too.
    // Modular armor and shields use their own equipment symbols, not hull material.
    for (const [type, materials] of [['armor', armor], ['structure', structure]] as const) {
        svg.querySelectorAll<SVGElement>(`.pip.${type}:not(.square):not(.trooperStatusPip)`).forEach(original => {
            const shape = materials.get(original.getAttribute('data-loc') ?? '');
            if (!shape) return;
            const pip = PipRendererShared.applyPipShape(original, shape);
            if (shape === 'diamond') splitDoubleDamagePip(pip);
        });
        for (const [location, shape] of materials) {
            if (shape !== 'diamond') continue;
            const prefix = type === 'armor' ? 'textArmor_' : 'textIS_';
            for (const suffix of type === 'armor' ? ['', 'R'] : ['']) {
                svg.querySelectorAll<SVGElement>(`#${CSS.escape(prefix + location + suffix)}`)
                    .forEach(counter => counter.setAttribute('data-mekbay-damage-per-point', '2'));
            }
        }
    }
}

/**
 * Two open halves replace the diamond and each consume one damage mark, the left one first. Each strokes only its two
 * outer edges and fills up to the diagonal between its ends, so the pair reads as a single pip; square caps complete
 * the diamond's corners.
 */
function splitDoubleDamagePip(pip: SVGElement): void {
    if (!(pip instanceof SVGPolygonElement) || pip.points.numberOfItems !== 4) return;
    const points = Array.from({ length: 4 }, (_, index) => {
        const point = pip.points.getItem(index);
        return `${point.x},${point.y}`;
    });
    const left = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    for (const attribute of pip.attributes) left.setAttribute(attribute.name, attribute.value);
    left.setAttribute('stroke-linecap', 'square');
    const right = left.cloneNode(true) as SVGPolylineElement;
    if (right.id) right.id += '-half';
    right.classList.add('half');
    left.setAttribute('points', [points[2], points[3], points[0]].join(' '));
    right.setAttribute('points', [points[0], points[1], points[2]].join(' '));
    pip.replaceWith(left, right);
}
