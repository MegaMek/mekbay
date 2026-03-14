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
import { ApplicationRef, ChangeDetectionStrategy, Component, Injector, computed, inject, input, signal } from '@angular/core';
import type { Unit } from '../../../models/units.model';
import { AlphaStrikeCardComponent } from '../../alpha-strike-card/alpha-strike-card.component';
import { getCardCountForUnitType } from '../../alpha-strike-card/card-layout.config';
import { OptionsService } from '../../../services/options.service';
import { ToastService } from '../../../services/toast.service';
import { ASCardExportUtil } from '../../../utils/as-card-export.util';

@Component({
    selector: 'unit-details-card-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, AlphaStrikeCardComponent],
    templateUrl: './unit-details-card-tab.component.html',
    styleUrls: ['./unit-details-card-tab.component.css']
})
export class UnitDetailsCardTabComponent {
    private readonly appRef = inject(ApplicationRef);
    private readonly injector = inject(Injector);
    optionsService = inject(OptionsService);
    private readonly toastService = inject(ToastService);
    unit = input.required<Unit>();
    readonly exportInProgress = signal(false);

    readonly unitType = computed(() => this.unit().as?.TP ?? '');
    readonly cardIndices = computed<number[]>(() => {
        const count = getCardCountForUnitType(this.unitType());
        return Array.from({ length: count }, (_, i) => i);
    });

    readonly useHex = computed<boolean>(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed<'colored' | 'monochrome'>(() => this.optionsService.options().ASCardStyle);

    async onDownloadCards(): Promise<void> {
        if (this.exportInProgress()) {
            return;
        }

        this.exportInProgress.set(true);

        try {
            const unit = this.unit();
            const cardIndices = this.cardIndices();

            for (const cardIndex of cardIndices) {
                const previewWindow = window.open('about:blank', '_blank');
                if (!previewWindow) {
                    throw new Error('Preview tab was blocked by the browser.');
                }

                await ASCardExportUtil.openCardJpegInNewTab(
                    this.appRef,
                    this.injector,
                    this.optionsService,
                    {
                        unit,
                        cardIndex,
                        useHex: this.useHex(),
                        cardStyle: this.cardStyle(),
                        width: 2240,
                        height: 1600,
                    },
                    this.buildFileName(unit, cardIndex, cardIndices.length),
                    previewWindow,
                );
            }

            this.toastService.showToast(
                cardIndices.length > 1
                    ? `Opened ${cardIndices.length} Alpha Strike card previews`
                    : 'Opened Alpha Strike card preview',
                'success'
            );
        } catch (error) {
            console.error('Failed to export Alpha Strike card JPEG:', error);
            this.toastService.showToast('Failed to export Alpha Strike card JPEG', 'error');
        } finally {
            this.exportInProgress.set(false);
        }
    }

    private buildFileName(unit: Unit, cardIndex: number, totalCards: number): string {
        const parts = [unit.chassis, unit.model, 'alpha-strike-card']
            .map((part) => this.sanitizeFilePart(part))
            .filter((part) => part.length > 0);

        if (totalCards > 1) {
            parts.push(`card-${cardIndex + 1}`);
        }

        return `${parts.join('-') || 'alpha-strike-card'}.jpg`;
    }

    private sanitizeFilePart(value: string | null | undefined): string {
        return (value ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}
