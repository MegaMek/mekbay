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

import type { GameSystem } from '../models/common.model';
import type { FilterState } from '../services/unit-search-filters.model';
import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { parseSemanticQueryAST } from './semantic-filter-ast.util';

export interface PublicTagReference {
    publicId: string;
    tagName: string;
}

interface GeneratePublicTagsParamArgs {
    searchText: string;
    filterState: FilterState;
    gameSystem: GameSystem;
    myPublicId: string | null | undefined;
    nameTags: Record<string, unknown>;
    chassisTags: Record<string, unknown>;
    publicTags: readonly PublicTagReference[];
    pendingForeignTags: readonly PublicTagReference[];
}

interface ParsePublicTagsParamArgs {
    ptParam: string | null | undefined;
    searchText: string | null | undefined;
    filterState: FilterState;
    gameSystem: GameSystem;
    myPublicId: string | null | undefined;
    subscribedTags: readonly PublicTagReference[];
}

function collectReferencedTagNames(
    searchText: string | null | undefined,
    filterState: FilterState,
    gameSystem: GameSystem,
): Set<string> {
    const tagNames = new Set<string>();

    if (searchText?.trim()) {
        const parsed = parseSemanticQueryAST(searchText, gameSystem);
        const tagTokens = parsed.tokens.filter(token => token.field === 'tags');
        for (const token of tagTokens) {
            for (const value of token.values) {
                tagNames.add(value.toLowerCase());
            }
        }
    }

    const tagsFilter = filterState['_tags'];
    if (tagsFilter?.value && typeof tagsFilter.value === 'object' && !Array.isArray(tagsFilter.value)) {
        const selection = tagsFilter.value as MultiStateSelection;
        for (const [name, selectionValue] of Object.entries(selection)) {
            if (selectionValue.state !== false) {
                tagNames.add(name.toLowerCase());
            }
        }
    }

    return tagNames;
}

function findLocalTagName(
    tagNameLower: string,
    nameTags: Record<string, unknown>,
    chassisTags: Record<string, unknown>,
): string | null {
    for (const tagName of Object.keys(nameTags)) {
        if (tagName.toLowerCase() === tagNameLower) {
            return tagName;
        }
    }

    for (const tagName of Object.keys(chassisTags)) {
        if (tagName.toLowerCase() === tagNameLower) {
            return tagName;
        }
    }

    return null;
}

export function generatePublicTagsParam({
    searchText,
    filterState,
    gameSystem,
    myPublicId,
    nameTags,
    chassisTags,
    publicTags,
    pendingForeignTags,
}: GeneratePublicTagsParamArgs): string | null {
    const tagNames = collectReferencedTagNames(searchText, filterState, gameSystem);
    if (tagNames.size === 0) {
        return null;
    }

    const parts: string[] = [];
    const includedKeys = new Set<string>();

    for (const tagNameLower of tagNames) {
        const localTagName = findLocalTagName(tagNameLower, nameTags, chassisTags);
        if (localTagName && myPublicId) {
            const key = `${myPublicId}:${localTagName}`.toLowerCase();
            if (!includedKeys.has(key)) {
                includedKeys.add(key);
                parts.push(`${myPublicId}:${localTagName}`);
            }
        }

        for (const publicTag of publicTags) {
            if (publicTag.tagName.toLowerCase() !== tagNameLower) {
                continue;
            }

            const key = `${publicTag.publicId}:${publicTag.tagName}`.toLowerCase();
            if (!includedKeys.has(key)) {
                includedKeys.add(key);
                parts.push(`${publicTag.publicId}:${publicTag.tagName}`);
            }
        }

        for (const pendingTag of pendingForeignTags) {
            if (pendingTag.tagName.toLowerCase() !== tagNameLower) {
                continue;
            }

            const key = `${pendingTag.publicId}:${pendingTag.tagName}`.toLowerCase();
            if (!includedKeys.has(key)) {
                includedKeys.add(key);
                parts.push(`${pendingTag.publicId}:${pendingTag.tagName}`);
            }
        }
    }

    return parts.length > 0 ? parts.join(',') : null;
}

export function parsePublicTagsParam({
    ptParam,
    searchText,
    filterState,
    gameSystem,
    myPublicId,
    subscribedTags,
}: ParsePublicTagsParamArgs): PublicTagReference[] {
    if (!ptParam) {
        return [];
    }

    const referencedTagNames = collectReferencedTagNames(searchText, filterState, gameSystem);
    if (referencedTagNames.size === 0) {
        return [];
    }

    const foreignTags: PublicTagReference[] = [];

    for (const mapping of ptParam.split(',')) {
        const separatorIndex = mapping.indexOf(':');
        if (separatorIndex === -1) {
            continue;
        }

        const publicId = mapping.substring(0, separatorIndex);
        const tagName = mapping.substring(separatorIndex + 1);

        if (myPublicId && publicId === myPublicId) {
            continue;
        }

        if (!referencedTagNames.has(tagName.toLowerCase())) {
            continue;
        }

        const isSubscribed = subscribedTags.some(
            subscribedTag => subscribedTag.publicId === publicId
                && subscribedTag.tagName.toLowerCase() === tagName.toLowerCase(),
        );

        if (!isSubscribed) {
            foreignTags.push({ publicId, tagName });
        }
    }

    return foreignTags;
}

export function mergePublicTagReferences(
    existing: readonly PublicTagReference[],
    incoming: readonly PublicTagReference[],
): PublicTagReference[] {
    if (incoming.length === 0) {
        return [...existing];
    }

    const merged = [...existing];
    const existingKeys = new Set(existing.map(tag => `${tag.publicId}:${tag.tagName}`.toLowerCase()));

    for (const tag of incoming) {
        const key = `${tag.publicId}:${tag.tagName}`.toLowerCase();
        if (existingKeys.has(key)) {
            continue;
        }
        existingKeys.add(key);
        merged.push(tag);
    }

    return merged;
}