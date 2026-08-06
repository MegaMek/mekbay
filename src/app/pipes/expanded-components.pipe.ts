// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from '@angular/core';
import type { UnitComponent } from '../models/units.model';

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
    transform(components: UnitComponent[]): UnitComponent[] {
        if (!components) return [];
        if (components.length === 0) return [];
        const aggregated = new Map<string, UnitComponent>();
        for (const comp of components) {
            if (comp.t === 'HIDDEN') continue; // Hide hidden components
            if (comp.t === 'S') continue; // Hide Structural components
            if (comp.t === 'C') {
                // Hide components that are of no relevant information
                if (comp.eq?.hasAnyFlag(['F_HEAT_SINK','F_DOUBLE_HEAT_SINK'])) continue; // Hide heatsinks
                if (comp.eq?.hasAnyFlag(['F_CASE','F_CASE_II'])) continue; // Hide CASE components
                if (comp.eq?.hasAnyFlag(['F_JUMP_JET'])) continue; // Hide Jump Jets
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
