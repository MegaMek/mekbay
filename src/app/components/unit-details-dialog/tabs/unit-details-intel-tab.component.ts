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

import { Component, ChangeDetectionStrategy, input, type output, type signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Unit } from '../../../models/units.model';
import { REMOTE_HOST } from '../../../models/common.model';

interface ManufacturerFactoryDisplay {
    pairedText: string;
    manufacturersText: string;
    primaryFactoriesText: string;
}

@Component({
    selector: 'unit-details-intel-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-details-intel-tab.component.html',
    styleUrls: ['./unit-details-intel-tab.component.css']
})
export class UnitDetailsIntelTabComponent {
    unit = input.required<Unit>();
    isSwiping = input<boolean>(false);

    private hasValue(text: string | undefined): boolean {
        return !!text?.trim();
    }

    fluffImageUrl = computed(() => {
        const unit = this.unit();

        if (unit?.fluff?.img) {
            if (unit.fluff.img.endsWith('hud.png')) return; // Ignore HUD images
            return `${REMOTE_HOST}/images/fluff/${unit.fluff.img}`;
        }
        return null;
    });

    isImageOnlyIntel = computed(() => {
        const fluff = this.unit()?.fluff;
        if (!fluff || !this.fluffImageUrl()) return false;

        const hasSystems = !!(fluff.systems && fluff.systems.length > 0);
        const hasTextContent = [
            fluff.manufacturer,
            fluff.primaryFactory,
            fluff.capabilities,
            fluff.overview,
            fluff.deployment,
            fluff.history,
            fluff.notes,
        ].some((value) => this.hasValue(value));

        return !hasSystems && !hasTextContent;
    });

    sanitizeFluffHtml(text: string | undefined): string {
        if (!text) return '';

        // Replace <p> tags with double newlines for paragraph breaks
        let sanitized = text.replace(/<p>/gi, '\n\n');
        sanitized = sanitized.replace(/<\/p>/gi, '');

        // Strip all remaining HTML tags
        sanitized = sanitized.replace(/<[^>]*>/g, '');

        // Decode common HTML entities
        sanitized = sanitized
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Clean up excessive whitespace and newlines
        sanitized = sanitized
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+/g, ' ')
            .trim();

        return sanitized;
    }

    manufacturerFactoryDisplay(manufacturerText: string | undefined, primaryFactoryText: string | undefined): ManufacturerFactoryDisplay {
        const manufacturers = this.splitFluffEntries(manufacturerText);
        const primaryFactories = this.splitFluffEntries(primaryFactoryText);

        if (manufacturers.length > 0 && manufacturers.length === primaryFactories.length) {
            const factoryGroups = new Map<string, string[]>();

            for (let index = 0; index < manufacturers.length; index += 1) {
                const manufacturer = manufacturers[index];
                const factory = primaryFactories[index];
                const factories = factoryGroups.get(manufacturer) ?? [];

                if (!factories.includes(factory)) {
                    factories.push(factory);
                }

                factoryGroups.set(manufacturer, factories);
            }

            return {
                pairedText: Array.from(factoryGroups.entries())
                    .map(([manufacturer, factories]) => `${manufacturer} (${factories.join(', ')})`)
                    .join('\n'),
                manufacturersText: '',
                primaryFactoriesText: '',
            };
        }

        return {
            pairedText: '',
            manufacturersText: this.uniqueEntries(manufacturers).join('\n'),
            primaryFactoriesText: this.uniqueEntries(primaryFactories).join(', '),
        };
    }

    private splitFluffEntries(text: string | undefined): string[] {
        const sanitized = this.sanitizeFluffHtml(text);
        if (!sanitized) return [];

        return sanitized
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean);
    }

    private uniqueEntries(entries: readonly string[]): string[] {
        const seen = new Set<string>();
        const unique: string[] = [];

        for (const entry of entries) {
            if (seen.has(entry)) continue;
            seen.add(entry);
            unique.push(entry);
        }

        return unique;
    }
}
