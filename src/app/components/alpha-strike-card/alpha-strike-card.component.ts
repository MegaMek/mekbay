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

import { Component, ChangeDetectionStrategy, input, computed, inject, signal, effect, output } from '@angular/core';
import { Unit } from '../../models/units.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DialogsService } from '../../services/dialogs.service';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { CardConfig, CardLayoutDesign, CriticalHitsVariant, getLayoutForUnitType } from './card-layout.config';
import {
    AsLayoutStandardComponent,
    AsLayoutLargeVessel1Component,
        AsLayoutLargeVessel2Component,
} from './layouts';
import { REMOTE_HOST } from '../../models/common.model';

/*
 * Author: Drake
 */

@Component({
    selector: 'alpha-strike-card',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AsLayoutStandardComponent,
        AsLayoutLargeVessel1Component,
        AsLayoutLargeVessel2Component,
    ],
    templateUrl: './alpha-strike-card.component.html',
    styleUrl: './alpha-strike-card.component.scss',
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
        '[class.selected]': 'isSelected()',
        '(click)': 'onCardClick()'
    }
})
export class AlphaStrikeCardComponent {
    private static nextId = 0;
    
    private readonly abilityLookup = inject(AsAbilityLookupService);
    private readonly dialogs = inject(DialogsService);
    
    /** Unique instance ID for SVG filter deduplication */
    readonly instanceId = AlphaStrikeCardComponent.nextId++;
    
    /** Optional: provide the stateful AS unit wrapper (preferred when available). */
    forceUnit = input<ASForceUnit | undefined>(undefined);
    /** Optional: provide a plain Unit (used when no forceUnit is available). */
    unit = input<Unit | undefined>(undefined);
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    isSelected = input<boolean>(false);
    /** Which card index to render (0 for first/only card, 1 for second card) */
    cardIndex = input<number>(0);
    
    selected = output<ASForceUnit>();
    
    onCardClick(): void {
        const fu = this.forceUnit();
        if (fu) {
            this.selected.emit(fu);
        }
    }
    
    imageUrl = signal<string>('');
    
    /** Effective Unit for rendering: forceUnit.getUnit() wins, otherwise the plain unit input. */
    resolvedUnit = computed<Unit | undefined>(() => this.forceUnit()?.getUnit() ?? this.unit());
    
    /** Get the Alpha Strike unit type (BM, IM, CV, CI, WS, etc.) */
    unitType = computed<string>(() => this.resolvedUnit()?.as.TP ?? '');
    
    /** Get the layout configuration for this unit type */
    layoutConfig = computed(() => getLayoutForUnitType(this.unitType()));
    
    /** Get the card config for the current card index */
    currentCardConfig = computed<CardConfig>(() => {
        const config = this.layoutConfig();
        const index = this.cardIndex();
        return config.cards[index] ?? config.cards[0];
    });
    
    /** Get the layout design for the current card */
    currentDesign = computed<CardLayoutDesign>(() => this.currentCardConfig().design);
    
    constructor() {
        // Effect to load image
        effect(() => {
            const unit = this.resolvedUnit();
            const imagePath = unit?.fluff?.img;
            if (imagePath) {
                this.loadFluffImage(imagePath);
            } else {
                this.imageUrl.set('');
            }
        });
    }
    
    private async loadFluffImage(imagePath: string): Promise<void> {
        try {    
            if (imagePath.endsWith('hud.png')) {
                this.imageUrl.set('');
                return;
            }
            const fluffImageUrl = `${REMOTE_HOST}/images/fluff/${imagePath}`;
            this.imageUrl.set(fluffImageUrl);
        } catch {
            // Ignore errors, image will just not display
            this.imageUrl.set('');
        }
    }
    
    // Handle special ability click
    onSpecialClick(special: string): void {
        const parsedAbility = this.abilityLookup.parseAbility(special);
        
        this.dialogs.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }
}
