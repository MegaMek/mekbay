
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

/*
 * Author: Drake
 */
@Pipe({
    name: 'formatNumber',
    pure: true // Pure pipes are only called when the input changes
})
export class FormatNumberPipe implements PipeTransform {
    transform(val: number | undefined, formatThousands: boolean = false, compress: boolean = true): string {
        return FormatNumberPipe.formatValue(val, formatThousands, compress);
    }

    static formatValue(val: number | undefined, formatThousands: boolean = false, compress: boolean = true): string {
        if (val === undefined) return '';
        let postfix = '';
        if (compress) {
            if (val >= 10_000_000_000) {
                postfix = 'B';
                val = Math.round(val / 1_000_000_000);
            } else if (val >= 10_000_000) {
                postfix = 'M';
                val = Math.round(val / 1_000_000);
            } else if (val >= 10_000) {
                postfix = 'K';
                val = Math.round(val / 1_000);
            }
        }
        const rounded = Math.round(val);
        if (formatThousands) {
            return rounded.toLocaleString() + postfix;
        }
        return rounded.toString() + postfix;
    }
}