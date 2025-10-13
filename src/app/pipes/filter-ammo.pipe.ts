
/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Pipe, PipeTransform } from "@angular/core";
import { UnitComponent } from "../models/units.model";

/*
 * Author: Drake
 */
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
            } else {
                aggregated.set(key, { ...comp, n: name });
            }
        }
        return Array.from(aggregated.values())
            .sort((a, b) => (a.n ?? '').localeCompare(b.n ?? ''));
    }
}
