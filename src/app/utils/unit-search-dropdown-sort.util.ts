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

import { naturalCompare } from './sort.util';

export function sortAvailableDropdownOptions(options: string[], predefinedOrder?: string[]): string[] {
    if (predefinedOrder && predefinedOrder.length > 0) {
        const optionsSet = new Set(options);
        const sortedOptions: string[] = [];
        for (const predefinedOpt of predefinedOrder) {
            if (predefinedOpt.endsWith('*')) {
                const prefix = predefinedOpt.slice(0, -1);
                const matchingOptions = Array.from(optionsSet)
                    .filter(option => typeof option === 'string' && option.startsWith(prefix))
                    .sort(naturalCompare);
                for (const match of matchingOptions) {
                    sortedOptions.push(match);
                    optionsSet.delete(match);
                }
            } else if (optionsSet.has(predefinedOpt)) {
                sortedOptions.push(predefinedOpt);
                optionsSet.delete(predefinedOpt);
            }
        }
        const remainingSorted = Array.from(optionsSet).sort(naturalCompare);
        return [...sortedOptions, ...remainingSorted];
    }

    return [...options].sort(naturalCompare);
}

export function sortDropdownOptionObjects<T extends { name: string }>(options: T[], predefinedOrder?: string[]): T[] {
    if (!predefinedOrder || predefinedOrder.length === 0) {
        return options;
    }

    const optionMap = new Map(options.map(option => [option.name, option]));
    const sortedNames = sortAvailableDropdownOptions(Array.from(optionMap.keys()), predefinedOrder);
    return sortedNames
        .map(name => optionMap.get(name))
        .filter((option): option is T => option !== undefined);
}