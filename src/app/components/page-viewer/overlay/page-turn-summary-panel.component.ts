// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { TooltipDirective } from '../../../directives/tooltip.directive';
import { CoverLevelPickerComponent } from '../../cover-level-picker/cover-level-picker.component';
import { HexSliderComponent } from '../../hex-slider/hex-slider.component';
import { TurnTrackerControls } from './turn-tracker-controls';

/** Compact turn-summary overlay presentation. */
@Component({
    selector: 'page-turn-summary-panel',
    imports: [HexSliderComponent, TooltipDirective, CoverLevelPickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-turn-summary-panel.component.html',
    styleUrl: './page-turn-summary-panel.component.scss',
})
export class PageTurnSummaryPanelComponent extends TurnTrackerControls {
    readonly renderReady = signal(false);

    constructor() {
        super();
        afterNextRender(() => this.renderReady.set(true));
    }

    protected override turnTrackerUsesManagedOverlay(): boolean {
        return true;
    }
}
