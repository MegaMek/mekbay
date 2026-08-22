// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from "@angular/core";
import type { UnitComponent } from "../models/unit-summary.model";


@Pipe({
    name: 'filterAmmo',
    pure: true // Pure pipes are only called when the input changes
})
export class FilterAmmoPipe implements PipeTransform {
    transform(components: UnitComponent[]): UnitComponent[] {
        if (!components) return [];
        if (components.length === 0) return [];
        const aggregated = new Map<string, UnitComponent>();
        for (const comp of components) {
            if (comp.t !== 'X') continue;
            const name = comp.n?.endsWith(' Ammo') ? comp.n.slice(0, -5).trimEnd() : comp.n;
            const key = name || '';
            if (aggregated.has(key)) {
                const existing = aggregated.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
                existing.q2 = (existing.q2 || 0) + (comp.q2 || 0);
            } else {
                aggregated.set(key, { ...comp, n: name });
            }
        }
        return Array.from(aggregated.values())
            .sort((a, b) => (a.n ?? '').localeCompare(b.n ?? ''));
    }
}
