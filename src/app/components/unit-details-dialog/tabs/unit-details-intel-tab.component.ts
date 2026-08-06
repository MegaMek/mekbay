// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, computed, effect, inject, Injector, signal, type OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Unit, UnitFluffCatalogEntry, UnitImageFluff } from '../../../models/units.model';
import { getUnitServerHost } from '../../../models/common.model';
import { DataService } from '../../../services/data.service';
import { LoadingSpinnerComponent } from '../../loading-spinner/loading-spinner.component';

interface ManufacturerFactoryDisplay {
    pairedText: string;
    manufacturersText: string;
    primaryFactoriesText: string;
}

@Component({
    selector: 'unit-details-intel-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LoadingSpinnerComponent],
    templateUrl: './unit-details-intel-tab.component.html',
    styleUrls: ['./unit-details-intel-tab.component.css']
})
export class UnitDetailsIntelTabComponent implements OnInit {
    unit = input.required<Unit>();
    isSwiping = input<boolean>(false);

    private readonly dataService = inject(DataService);
    private readonly injector = inject(Injector);
    private fluffRequestId = 0;

    fluff = signal<UnitFluffCatalogEntry | undefined>(undefined);
    isFluffLoading = signal(false);

    ngOnInit(): void {
        effect(() => {
            const unit = this.unit();
            const requestId = ++this.fluffRequestId;

            this.fluff.set(this.getUnitImageFallback(unit.fluff));
            this.isFluffLoading.set(true);

            void this.dataService.getUnitFluff(unit)
                .then((fluff) => {
                    if (requestId !== this.fluffRequestId) return;
                    this.fluff.set(fluff);
                })
                .catch(() => {
                    if (requestId !== this.fluffRequestId) return;
                    this.fluff.set(this.getUnitImageFallback(unit.fluff));
                })
                .finally(() => {
                    if (requestId !== this.fluffRequestId) return;
                    this.isFluffLoading.set(false);
                });
        }, { injector: this.injector });
    }

    private hasValue(text: string | undefined): boolean {
        return !!text?.trim();
    }

    fluffImageUrl = computed(() => {
        const fluff = this.fluff();

        if (fluff?.img) {
            if (fluff.img.endsWith('hud.png')) return; // Ignore HUD images
            return `${getUnitServerHost(this.unit())}/images/fluff/${fluff.img}`;
        }
        return null;
    });

    isImageOnlyIntel = computed(() => {
        if (this.isFluffLoading()) return false;

        const fluff = this.fluff();
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

    private getUnitImageFallback(fluff: UnitImageFluff | undefined): UnitFluffCatalogEntry | undefined {
        const image = fluff?.img?.trim();
        return image ? { img: image } : undefined;
    }

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
