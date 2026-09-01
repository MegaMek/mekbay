// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

import { TooltipDirective } from '../../../directives/tooltip.directive';
import {
    MEGAMEK_PRODUCTION_ICON_PATH,
    MEGAMEK_SALVAGE_ICON_PATH,
} from '../../../models/megamek/availability.model';
import type { FactionAvailability } from './unit-details-factions-tab.models';

@Component({
    selector: 'unit-details-factions-tab-list',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgTemplateOutlet, TooltipDirective],
    templateUrl: './unit-details-factions-tab-list.component.html',
    styleUrl: './unit-details-factions-tab-list.component.css',
})
export class UnitDetailsFactionsTabListComponent {
    readonly availability = input.required<readonly FactionAvailability[]>();

    readonly megaMekRequisitionIconPath = MEGAMEK_PRODUCTION_ICON_PATH;
    readonly megaMekSalvageIconPath = MEGAMEK_SALVAGE_ICON_PATH;

    private readonly expandedCatchAlls = signal(new Set<string>());

    toggleCatchAll(eraIndex: number, factionName: string): void {
        const key = `${eraIndex}:${factionName}`;
        this.expandedCatchAlls.update(set => {
            const next = new Set(set);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    isCatchAllExpanded(eraIndex: number, factionName: string): boolean {
        return this.expandedCatchAlls().has(`${eraIndex}:${factionName}`);
    }
}
