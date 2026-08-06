// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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