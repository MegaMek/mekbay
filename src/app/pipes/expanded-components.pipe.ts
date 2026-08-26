// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from '@angular/core';
import type { UnitComponent } from '../models/unit-summary.model';
import type { Equipment } from '../models/equipment.model';
import { isJumpJetEquipment } from '../models/jump-equipment.model';
import { isHeatSinkEquipment } from '../models/heat-equipment.model';
import { isCaseEquipment } from '../models/case-equipment.model';

/**
 * Aggregates and filters unit components for expanded view display.
 * - Hides HIDDEN and Ammo (X) components
 * - Aggregates duplicate components by name
 * - Sorts alphabetically by name
 */
@Pipe({
    name: 'expandedComponents',
    standalone: true,
    pure: true
})
export class ExpandedComponentsPipe implements PipeTransform {
    transform(
        components: UnitComponent[],
        resolveEquipment?: (internalName: string) => Equipment | undefined,
    ): UnitComponent[] {
        if (!components) return [];
        if (components.length === 0) return [];
        const aggregated = new Map<string, UnitComponent>();
        for (const comp of components) {
            if (comp.t === 'HIDDEN') continue; // Hide hidden components
            if (comp.t === 'S') continue; // Hide Structural components
            if (comp.t === 'C') {
                const equipment = comp.eq ?? resolveEquipment?.(comp.id);
                // Hide components that are of no relevant information
                if (isHeatSinkEquipment(equipment)) continue; // Hide heat sinks
                if (isCaseEquipment(equipment)) continue; // Hide CASE components
                if (isJumpJetEquipment(equipment)) continue; // Hide Jump Jets
            }; 
            if (comp.t === 'X') continue; // Hide Ammo
            const key = `${comp.n || ''}::${comp.rear ? 'rear' : 'front'}`;
            if (aggregated.has(key)) {
                const existing = aggregated.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
            } else {
                aggregated.set(key, { ...comp });
            }
        }
        return Array.from(aggregated.values())
            .sort((a, b) => {
                const nameComparison = (a.n ?? '').localeCompare(b.n ?? '');
                if (nameComparison !== 0) {
                    return nameComparison;
                }

                return Number(!!a.rear) - Number(!!b.rear);
            });
    }
}
