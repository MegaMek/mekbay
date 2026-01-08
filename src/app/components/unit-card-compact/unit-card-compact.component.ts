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

import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, TagClickEvent } from '../unit-tags/unit-tags.component';
import { GameService } from '../../services/game.service';
import { AdjustedBV } from '../../pipes/adjusted-bv.pipe';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';

/**
 * A compact unit card component for displaying units in lists.
 * 
 * Displays unit icon, model, chassis, role, and value (BV/PV) along with
 * optional indicators for original/default unit, modified state, and info button.
 */
@Component({
    selector: 'unit-card-compact',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitIconComponent, UnitTagsComponent, AdjustedBV, AdjustedPV, FormatNumberPipe, FormatTonsPipe],
    templateUrl: './unit-card-compact.component.html',
    styleUrl: './unit-card-compact.component.css'
})
export class UnitCardCompactComponent {
    gameService = inject(GameService);

    /** The unit to display. If null/undefined, shows "NO UNIT" placeholder. */
    unit = input<Unit | null | undefined>(null);

    /** Whether to show the info button */
    showInfoButton = input(false);

    /** Whether to show tags (compact mode) */
    showTags = input(false);

    /** Whether this unit is marked as the original/default (shows star indicator) */
    isOriginal = input(false);

    /** Whether this unit has been modified from its original (shows corner indicator) */
    isModified = input(false);

    /** Whether this unit is currently selected/active */
    isSelected = input(false);

    /** Gunnery skill for BV/PV adjustment */
    gunnery = input(4);

    /** Piloting skill for BV adjustment */
    piloting = input(5);

    /** Emitted when the info button is clicked */
    infoClick = output<void>();

    /** Emitted when the card is clicked */
    cardClick = output<void>();

    /** Emitted when the tag button is clicked. Passes both the unit and MouseEvent for overlay positioning. */
    tagClick = output<TagClickEvent>();

    onInfoClick(event: Event): void {
        event.stopPropagation();
        this.infoClick.emit();
    }

    onCardClick(): void {
        this.cardClick.emit();
    }

    onTagClick(event: TagClickEvent): void {
        this.tagClick.emit(event);
    }
}
