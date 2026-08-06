// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { Unit } from '../../../models/units.model';
import { AlphaStrikeCardComponent } from '../../alpha-strike-card/alpha-strike-card.component';
import { getCardCountForUnitType } from '../../alpha-strike-card/card-layout.config';
import { OptionsService } from '../../../services/options.service';

@Component({
    selector: 'unit-details-card-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, AlphaStrikeCardComponent],
    templateUrl: './unit-details-card-tab.component.html',
    styleUrls: ['./unit-details-card-tab.component.css']
})
export class UnitDetailsCardTabComponent {
    optionsService = inject(OptionsService);
    unit = input.required<Unit>();

    readonly unitType = computed(() => this.unit().as?.TP ?? '');
    readonly cardIndices = computed<number[]>(() => {
        const count = getCardCountForUnitType(this.unitType());
        return Array.from({ length: count }, (_, i) => i);
    });

    readonly useHex = computed<boolean>(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().colorScheme);
}
