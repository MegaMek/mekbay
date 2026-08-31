// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import { GameSystem } from '../../models/common.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, type TagClickEvent } from '../unit-tags/unit-tags.component';
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
    imports: [UnitIconComponent, UnitTagsComponent, AdjustedBV, AdjustedPV, FormatNumberPipe, FormatTonsPipe],
    templateUrl: './unit-card-compact.component.html',
    styleUrl: './unit-card-compact.component.css'
})
export class UnitCardCompactComponent {
    gameService = inject(GameService);

    /** The unit to display. If null/undefined, shows "NO UNIT" placeholder. */
    unit = input<UnitSummary | null | undefined>(null);

    /** Optional game system override. When provided, determines which stats to display (PV/SZ/TMM vs BV/tons). Falls back to the global game service when null. */
    gameSystem = input<GameSystem | null>(null);

    isAlphaStrike = computed<boolean>(() => {
        const gs = this.gameSystem();
        return gs != null ? gs === GameSystem.ALPHA_STRIKE : this.gameService.isAlphaStrike();
    });

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
