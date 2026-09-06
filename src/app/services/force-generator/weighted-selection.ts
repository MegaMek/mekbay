// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export function pickWeightedRandomEntry<T>(entries: readonly T[], getWeight: (entry: T) => number): T {
    if (entries.length === 1) {
        return entries[0];
    }

    const weights = entries.map((entry) => Math.max(0, getWeight(entry)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight <= 0) {
        return entries[Math.floor(Math.random() * entries.length)];
    }

    let cursor = Math.random() * totalWeight;
    for (let index = 0; index < entries.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0) {
            return entries[index];
        }
    }

    return entries[entries.length - 1];
}
