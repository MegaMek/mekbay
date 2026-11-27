// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { TooltipDirective } from '../../../directives/tooltip.directive';
import {
    MEGAMEK_PRODUCTION_ICON_PATH,
    MEGAMEK_SALVAGE_ICON_PATH,
} from '../../../models/megamek/availability.model';
import { MULFACTION_EXTINCT } from '../../../models/mulfactions.model';
import {
    PREFIX_CATCH_ALL,
    type FactionAvailability,
    type FactionAvailabilityItem,
    type FactionMegaMekAvailability,
} from './unit-details-factions-tab.models';

interface FactionAvailabilityCell {
    img: string;
    megaMekAvailability: FactionMegaMekAvailability[];
    megaMekTooltip: FactionAvailabilityItem['megaMekTooltip'];
}

interface FactionAvailabilityRow {
    id: number;
    name: string;
    img: string;
    isCatchAll: boolean;
    cells: Array<FactionAvailabilityCell | null>;
    subrows: FactionAvailabilityRow[];
    subrowAvailabilityCounts: number[];
}

interface FactionAvailabilityMatrix {
    eras: FactionAvailability[];
    rows: FactionAvailabilityRow[];
}

@Component({
    selector: 'unit-details-factions-tab-grid',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgTemplateOutlet, TooltipDirective],
    templateUrl: './unit-details-factions-tab-grid.component.html',
    styleUrl: './unit-details-factions-tab-grid.component.css',
})
export class UnitDetailsFactionsTabGridComponent {
    readonly availability = input.required<readonly FactionAvailability[]>();
    readonly factionColumnCollapsed = signal(false);

    readonly megaMekRequisitionIconPath = MEGAMEK_PRODUCTION_ICON_PATH;
    readonly megaMekSalvageIconPath = MEGAMEK_SALVAGE_ICON_PATH;
    readonly availabilityMatrix = computed<FactionAvailabilityMatrix>(() => (
        this.buildAvailabilityMatrix(this.availability())
    ));

    private readonly expandedCatchAlls = signal(new Set<number>());

    toggleFactionColumn(): void {
        this.factionColumnCollapsed.update(collapsed => !collapsed);
    }

    toggleCatchAll(factionId: number): void {
        this.expandedCatchAlls.update(set => {
            const next = new Set(set);
            if (next.has(factionId)) {
                next.delete(factionId);
            } else {
                next.add(factionId);
            }
            return next;
        });
    }

    isCatchAllExpanded(factionId: number): boolean {
        return this.expandedCatchAlls().has(factionId);
    }

    private buildAvailabilityMatrix(
        availability: readonly FactionAvailability[],
    ): FactionAvailabilityMatrix {
        const rowsById = new Map<number, FactionAvailabilityRow>();
        const parentByChildId = new Map<number, number>();

        const getOrCreateRow = (item: FactionAvailabilityItem): FactionAvailabilityRow => {
            const existing = rowsById.get(item.id);
            if (existing) {
                if (!existing.img && item.img) {
                    existing.img = item.img;
                }
                existing.isCatchAll ||= item.isCatchAll === true;
                return existing;
            }

            const created: FactionAvailabilityRow = {
                id: item.id,
                name: item.name,
                img: item.img,
                isCatchAll: item.isCatchAll === true,
                cells: Array.from({ length: availability.length }, () => null),
                subrows: [],
                subrowAvailabilityCounts: Array.from({ length: availability.length }, () => 0),
            };
            rowsById.set(item.id, created);
            return created;
        };

        const setCell = (row: FactionAvailabilityRow, eraIndex: number, item: FactionAvailabilityItem): void => {
            row.cells[eraIndex] = {
                img: item.img,
                megaMekAvailability: item.megaMekAvailability,
                megaMekTooltip: item.megaMekTooltip,
            };
        };

        availability.forEach((era, eraIndex) => {
            for (const faction of era.factions) {
                if (faction.id === MULFACTION_EXTINCT) {
                    continue;
                }

                const row = getOrCreateRow(faction);
                setCell(row, eraIndex, faction);

                for (const collapsedFaction of faction.collapsedFactions ?? []) {
                    if (collapsedFaction.id === MULFACTION_EXTINCT) {
                        continue;
                    }

                    const childRow = getOrCreateRow(collapsedFaction);
                    setCell(childRow, eraIndex, collapsedFaction);

                    const currentParentId = parentByChildId.get(collapsedFaction.id);
                    const currentParent = currentParentId === undefined ? undefined : rowsById.get(currentParentId);
                    if (currentParentId === undefined
                        || (faction.name === PREFIX_CATCH_ALL && currentParent?.name !== PREFIX_CATCH_ALL)) {
                        parentByChildId.set(collapsedFaction.id, faction.id);
                    }
                }
            }
        });

        for (const [childId, parentId] of parentByChildId) {
            const child = rowsById.get(childId);
            const parent = rowsById.get(parentId);
            if (child && parent && child !== parent) {
                parent.subrows.push(child);
            }
        }

        for (const row of rowsById.values()) {
            row.subrows.sort((left, right) => left.name.localeCompare(right.name));
            row.subrowAvailabilityCounts = row.cells.map((_, eraIndex) => (
                row.subrows.reduce((count, subrow) => count + (subrow.cells[eraIndex] ? 1 : 0), 0)
            ));
        }

        const rows = Array.from(rowsById.values())
            .filter((row) => !parentByChildId.has(row.id))
            .sort((left, right) => left.name.localeCompare(right.name));

        return { eras: [...availability], rows };
    }
}
