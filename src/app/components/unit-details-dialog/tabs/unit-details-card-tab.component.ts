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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, viewChildren } from '@angular/core';
import type { Unit } from '../../../models/units.model';
import { AlphaStrikeCardComponent } from '../../alpha-strike-card/alpha-strike-card.component';
import { getCardCountForUnitType } from '../../alpha-strike-card/card-layout.config';
import { OptionsService } from '../../../services/options.service';
import { SvgExportUtil } from '../../../utils/svg-export.util';

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
    private readonly cards = viewChildren(AlphaStrikeCardComponent);

    readonly unitType = computed(() => this.unit().as?.TP ?? '');
    readonly cardIndices = computed<number[]>(() => {
        const count = getCardCountForUnitType(this.unitType());
        return Array.from({ length: count }, (_, i) => i);
    });

    readonly useHex = computed<boolean>(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed<'default' | 'night'>(() => this.optionsService.options().ASCardStyle);

    downloadPng(): Promise<void> {
        return SvgExportUtil.downloadPng(this.svgs(), this.exportFileName());
    }

    openPng(): Promise<void> {
        return SvgExportUtil.openPng(this.svgs());
    }

    copyPngToClipboard(): Promise<void> {
        return SvgExportUtil.copyPngToClipboard(this.svgs(), this.exportFileName());
    }

    private svgs(): SVGSVGElement[] {
        return this.cards()
            .map(card => card.getSvgElement())
            .filter((svg): svg is SVGSVGElement => svg !== null);
    }

    private exportFileName(): string {
        return this.unit().name || 'alpha-strike-card';
    }
}
