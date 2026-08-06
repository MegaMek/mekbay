// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit } from '../models/units.model';
import { naturalCompare } from './sort.util';

function sortTags(tags: Set<string>): string[] {
    return Array.from(tags).sort(naturalCompare);
}

export function collectAllTags(units: Unit[]): string[] {
    const tags = new Set<string>();

    for (const unit of units) {
        for (const entry of unit._nameTags ?? []) {
            tags.add(entry.tag);
        }
        for (const entry of unit._chassisTags ?? []) {
            tags.add(entry.tag);
        }
    }

    return sortTags(tags);
}

export function collectAllNameTags(units: Unit[]): string[] {
    const tags = new Set<string>();

    for (const unit of units) {
        for (const entry of unit._nameTags ?? []) {
            tags.add(entry.tag);
        }
    }

    return sortTags(tags);
}

export function collectAllChassisTags(units: Unit[]): string[] {
    const tags = new Set<string>();

    for (const unit of units) {
        for (const entry of unit._chassisTags ?? []) {
            tags.add(entry.tag);
        }
    }

    return sortTags(tags);
}