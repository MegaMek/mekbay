// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import type { ArmorType } from '../../models/entity/types';
import { PipRendererShared } from './pip-renderer.shared';
import type { PipShape } from './pip-renderer.types';

// MegaMekLab PipType.forAT: armor that reduces selected damage uses pentagons.
const PENTAGON_ARMORS: ReadonlySet<ArmorType> = new Set([
    'REACTIVE', 'REFLECTIVE', 'FERRO_LAMELLOR', 'ANTI_PENETRATIVE_ABLATION',
    'HEAT_DISSIPATING', 'IMPACT_RESISTANT', 'BALLISTIC_REINFORCED',
    'BA_FIRE_RESIST', 'BA_REFLECTIVE', 'BA_REACTIVE',
]);
const REINFORCED_STRUCTURE_TYPE_ID = 4;
const COMPOSITE_STRUCTURE_TYPE_ID = 5;

/** Applies Fancy Pips to each location after its family has placed the pips. */
export function applyRecordSheetPipMaterials(svg: SVGSVGElement, entity: BaseEntity): void {
    const armor = new Map<string, PipShape>();
    const structure = new Map<string, PipShape>();
    const installedArmor = entity.armorByLocation();
    const installedStructure = entity.structureByLocation();
    for (const location of entity.damageLocations()) {
        const material = installedArmor.get(location.code)?.armor;
        if (material) {
            const type = material.armorType as ArmorType;
            const presentation: PipShape = type === 'HARDENED' ? 'diamond'
                : material.bar < 10 ? 'circle-dashed'
                : PENTAGON_ARMORS.has(type) ? 'pentagon' : 'circle';
            armor.set(location.code, presentation);
            armor.set(location.sheetCode ?? location.code, presentation);
        }
        const internal = installedStructure.get(location.code)?.structure;
        if (internal) {
            const presentation: PipShape = internal.structureTypeId === REINFORCED_STRUCTURE_TYPE_ID ? 'diamond'
                : internal.structureTypeId === COMPOSITE_STRUCTURE_TYPE_ID ? 'circle-dashed' : 'circle';
            structure.set(location.code, presentation);
            structure.set(location.sheetCode ?? location.code, presentation);
        }
    }

    // Capital square tables deliberately bypass Fancy Pips in MegaMekLab too.
    // Modular armor and shields use their own equipment symbols, not hull material.
    for (const [type, materials] of [['armor', armor], ['structure', structure]] as const) {
        svg.querySelectorAll<SVGElement>(`.pip.${type}:not(.square):not(.trooperStatusPip)`).forEach(original => {
            const shape = materials.get(original.getAttribute('data-loc') ?? '');
            if (shape) PipRendererShared.applyPipShape(original, shape);
        });
    }
}
