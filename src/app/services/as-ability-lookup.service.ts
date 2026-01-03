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

import { inject, Injectable } from '@angular/core';
import { AS_SPECIAL_ABILITIES, ASSpecialAbility } from '../models/as-abilities.model';
import { LoggerService } from './logger.service';

/**
 * Represents a parsed ability with its definition and any sub-abilities
 */
export interface ParsedAbility {
    /** The original ability text as it appears on the card */
    originalText: string;
    /** The matched ability definition, or null if not found */
    ability: ASSpecialAbility | null;
    /** For turret abilities, the turret damage values */
    turretDamage?: string;
    /** Sub-abilities contained within parentheses */
    subAbilities?: ParsedAbility[];
}

/**
 * Service for looking up Alpha Strike special abilities.
 * Handles the complex matching logic between ability text on cards
 * and ability tags in the database.
 */
@Injectable({ providedIn: 'root' })
export class AsAbilityLookupService {
    private readonly logger = inject(LoggerService);

    /** Index for fast lookup by normalized tag patterns */
    private readonly abilityIndex: Map<string, ASSpecialAbility>;

    /** Cache for ability lookups */
    private readonly lookupCache = new Map<string, ASSpecialAbility | null>();

    constructor() {
        this.abilityIndex = this.buildAbilityIndex();
    }

    /**
     * Builds an index of abilities for fast lookup.
     * Keys are normalized patterns that can be matched against input.
     * Logs warnings for any tag collisions.
     */
    private buildAbilityIndex(): Map<string, ASSpecialAbility> {
        const index = new Map<string, ASSpecialAbility>();

        for (const ability of AS_SPECIAL_ABILITIES) {
            const tags = Array.isArray(ability.tag) ? ability.tag : [ability.tag];
            for (const tag of tags) {
                const normalizedTag = this.normalizeForIndex(tag);
                const existing = index.get(normalizedTag);
                if (existing) {
                    this.logger.warn(
                        `[AsAbilityLookupService] Tag collision detected: "${tag}" (normalized: "${normalizedTag}") ` +
                        `is used by both "${existing.name}" and "${ability.name}"`
                    );
                }
                index.set(normalizedTag, ability);
            }
        }

        return index;
    }

    /**
     * Normalizes a tag for indexing - removes spaces and converts to uppercase
     */
    private normalizeForIndex(tag: string): string {
        return tag.replace(/\s+/g, '').toUpperCase();
    }

    /**
     * Converts an ability text to a pattern that can match database tags.
     * - Replaces numbers (including decimals) and "-" with "#"
     * - Removes "*" markers
     * - Handles special cases like ART% pattern
     */
    private convertToTagPattern(abilityText: string): string {
        // Remove spaces for matching
        let pattern = abilityText.replace(/\s+/g, '').toUpperCase();
        
        // Remove asterisks (used for marking optional values)
        pattern = pattern.replace(/\*/g, '');

        // Handle ART% pattern - artillery abilities like ARTLTC-2, ARTCM5-1
        if (pattern.startsWith('ART')) {
            // Extract the artillery type code between ART and the final dash-number
            // Handles: ARTLTC-2, ARTCM5-1, ARTLT-1, etc.
            const artMatch = pattern.match(/^ART([A-Z\d]+)-(\d+)$/);
            if (artMatch) {
                // Convert to ART%-# pattern where % is the type code
                return 'ART%-#';
            }
        }

        // Replace all numbers (including decimals like 0.02, 3.5) with #
        // This handles patterns like "CT0.02" -> "CT#", "IT3.5" -> "IT#"
        pattern = pattern.replace(/[\d]+\.?[\d]*/g, '#');
        
        // Replace standalone dash that represents a missing damage value with #
        // Matches: at start before /, between //, or after / at end
        // Examples: LRM-/2/2 -> LRM#/#/#, AC2/2/- -> AC#/#/#
        pattern = pattern.replace(/(?<=^[A-Z]*)-(?=\/)/g, '#');  // Dash after letters before /
        pattern = pattern.replace(/(?<=[/#])-(?=[/#]|$)/g, '#'); // Dash between / or at end

        return pattern;
    }

    /**
     * Attempts to find an ability by exact match or pattern matching.
     */
    private findAbilityByPattern(abilityText: string): ASSpecialAbility | null {
        const normalized = this.normalizeForIndex(abilityText);

        // First try exact match (for simple abilities like ECM, TAG, etc.)
        const exactMatch = this.abilityIndex.get(normalized);
        if (exactMatch) {
            return exactMatch;
        }

        // Convert to pattern and try matching
        const pattern = this.convertToTagPattern(abilityText);
        const patternMatch = this.abilityIndex.get(pattern);
        if (patternMatch) {
            return patternMatch;
        }

        // Handle special cases for abilities with varying # counts
        // e.g., FLK1/1/- should match FLK#/#/#/# but also handle shorter versions
        const baseMatch = this.findBaseAbility(pattern);
        if (baseMatch) {
            return baseMatch;
        }

        // Handle implicit 1 for abilities like SNARC (no number means 1)
        const withImplicitOne = pattern + '#';
        const implicitMatch = this.abilityIndex.get(withImplicitOne);
        if (implicitMatch) {
            return implicitMatch;
        }

        return null;
    }

    /**
     * Finds an ability by trying to match the base pattern with varying # counts.
     * For example, FLK1/1/- should match FLK#/#/#/#
     */
    private findBaseAbility(pattern: string): ASSpecialAbility | null {
        // Extract base name (letters before any special chars)
        const baseMatch = pattern.match(/^([A-Z]+)/);
        if (!baseMatch) return null;

        const baseName = baseMatch[1];

        // Try to find any ability that starts with this base name
        for (const [tag, ability] of this.abilityIndex) {
            if (tag.startsWith(baseName)) {
                // Check if the pattern structure is compatible
                // Count # in both patterns
                const patternHashes = (pattern.match(/#/g) || []).length;
                const tagHashes = (tag.match(/#/g) || []).length;

                // Allow match if pattern has fewer or equal # (partial specification)
                if (patternHashes <= tagHashes) {
                    // Verify the structure matches (same separators in same positions)
                    const patternStructure = pattern.replace(/#/g, '').replace(/[A-Z]/g, '');
                    const tagStructure = tag.replace(/#/g, '').replace(/[A-Z]/g, '');

                    if (tagStructure.startsWith(patternStructure) || patternStructure === tagStructure.substring(0, patternStructure.length)) {
                        return ability;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Looks up a single ability by its text representation.
     * Uses caching for performance.
     */
    lookupAbility(abilityText: string): ASSpecialAbility | null {
        // Check cache first
        if (this.lookupCache.has(abilityText)) {
            return this.lookupCache.get(abilityText) ?? null;
        }

        const result = this.findAbilityByPattern(abilityText);
        this.lookupCache.set(abilityText, result);
        return result;
    }

    /**
     * Checks if the content represents a damage pattern (#/#/# or similar)
     */
    private isDamagePattern(content: string): boolean {
        // Damage patterns are like 0*/1/1 or 2/2/- (numbers/dashes separated by /)
        return /^[\d*]+(?:\/[\d*-]+)+$/.test(content.replace(/\s+/g, ''));
    }

    /**
     * Parses a composite ability (one with parentheses like TUR or BIM).
     * Returns the main ability and any sub-abilities.
     */
    parseCompositeAbility(abilityText: string): ParsedAbility {
        const result: ParsedAbility = {
            originalText: abilityText,
            ability: null,
            subAbilities: []
        };

        // Check for parentheses
        const parenMatch = abilityText.match(/^([A-Z]+[\dA-Z]*)\s*\((.+)\)$/i);
        
        if (!parenMatch) {
            // Not a composite ability, just look it up directly
            result.ability = this.lookupAbility(abilityText);
            return result;
        }

        const mainAbilityName = parenMatch[1];
        const innerContent = parenMatch[2];

        // Look up the main ability (e.g., TUR -> TUR#)
        result.ability = this.lookupAbility(mainAbilityName);

        // Only TUR has true composite sub-abilities
        // Other abilities with parentheses (BIM, LAM, etc.) just have parameters
        if (mainAbilityName.toUpperCase() !== 'TUR') {
            return result;
        }

        // Parse inner content for TUR composite abilities
        // Split by comma, but handle nested abilities carefully
        const parts = this.splitPreservingParentheses(innerContent);

        for (const part of parts) {
            const trimmedPart = part.trim();
            
            // Check if this part is a damage pattern
            if (this.isDamagePattern(trimmedPart)) {
                result.turretDamage = trimmedPart;
                continue;
            }

            // Try to parse as an ability
            const subAbility = this.parseCompositeAbility(trimmedPart);
            if (subAbility.ability || subAbility.subAbilities?.length) {
                result.subAbilities!.push(subAbility);
            } else {
                // If we couldn't find an ability, check if it's an ability without a number
                // e.g., SNARC, TAG (implicitly SNARC1, but shown without the 1)
                const implicitAbility = this.lookupAbility(trimmedPart + '1') || 
                                        this.lookupAbility(trimmedPart);
                if (implicitAbility) {
                    result.subAbilities!.push({
                        originalText: trimmedPart,
                        ability: implicitAbility
                    });
                }
            }
        }

        return result;
    }

    /**
     * Splits a string by commas but preserves content within parentheses.
     */
    private splitPreservingParentheses(content: string): string[] {
        const result: string[] = [];
        let current = '';
        let depth = 0;

        for (const char of content) {
            if (char === '(') {
                depth++;
                current += char;
            } else if (char === ')') {
                depth--;
                current += char;
            } else if (char === ',' && depth === 0) {
                if (current.trim()) {
                    result.push(current.trim());
                }
                current = '';
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            result.push(current.trim());
        }

        return result;
    }

    /**
     * Parses an ability string and returns all abilities (including sub-abilities).
     * This is the main entry point for parsing abilities from a card.
     */
    parseAbility(abilityText: string): ParsedAbility {
        return this.parseCompositeAbility(abilityText);
    }

    /**
     * Gets all abilities (flattened) from a parsed ability, including sub-abilities.
     */
    getAllAbilities(parsed: ParsedAbility): ASSpecialAbility[] {
        const abilities: ASSpecialAbility[] = [];

        if (parsed.ability) {
            abilities.push(parsed.ability);
        }

        if (parsed.subAbilities) {
            for (const sub of parsed.subAbilities) {
                abilities.push(...this.getAllAbilities(sub));
            }
        }

        return abilities;
    }
}
