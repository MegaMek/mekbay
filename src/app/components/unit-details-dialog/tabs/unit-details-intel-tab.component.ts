// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, DestroyRef, input, computed, effect, inject, signal } from '@angular/core';
import type { UnitSummary } from '../../../models/unit-summary.model';
import type { UnitFluff } from '../../../models/unit-fluff.model';
import { UnitFluffImageService } from '../../../services/catalogs/unit-fluff-image.service';
import { NativeUnitFluffService } from '../../../services/catalogs/native-unit-fluff.service';

interface ManufacturerFactoryDisplay {
    pairedText: string;
    manufacturersText: string;
    primaryFactoriesText: string;
}

@Component({
    selector: 'unit-details-intel-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-details-intel-tab.component.html',
    styleUrl: './unit-details-intel-tab.component.css'
})
export class UnitDetailsIntelTabComponent {
    unit = input.required<UnitSummary>();
    isSwiping = input<boolean>(false);

    private readonly fluffImages = inject(UnitFluffImageService);
    private readonly nativeFluff = inject(NativeUnitFluffService);

    fluffImageUrl = computed(() => this.fluffImages.resolveUrl(this.unit()));
    fluff = signal<UnitFluff | undefined>(undefined);
    loading = signal(true);
    loadError = signal(false);

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            // Do not retain native prose after the structurally-created Intel
            // tab leaves the view. The root service itself is stateless.
            this.fluff.set(undefined);
        });
        effect((onCleanup) => {
            const unit = this.unit();
            let current = true;
            this.fluff.set(undefined);
            this.loading.set(true);
            this.loadError.set(false);

            void this.nativeFluff.load(unit).then(fluff => {
                if (!current) return;
                this.fluff.set(fluff);
                this.loading.set(false);
            }).catch(() => {
                if (!current) return;
                this.fluff.set(undefined);
                this.loading.set(false);
                this.loadError.set(true);
            });
            onCleanup(() => { current = false; });
        });
    }

    private hasValue(text: string | undefined): boolean {
        return !!text?.trim();
    }

    isImageOnlyIntel = computed(() => {
        const fluff = this.fluff();
        if (this.loading() || this.loadError() || !this.fluffImageUrl()) return false;
        if (!fluff) return true;

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
