// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component } from '@angular/core';

import { TooltipDirective } from '../../directives/tooltip.directive';
import { CoverLevelPickerComponent } from '../cover-level-picker/cover-level-picker.component';
import { HexSliderComponent } from '../hex-slider/hex-slider.component';
import { TurnTrackerControls } from '../page-viewer/overlay/turn-tracker-controls';

/** Tactical View presentation for the shared turn-control state and commands. */
@Component({
    selector: 'tactical-turn-tracker',
    imports: [CoverLevelPickerComponent, HexSliderComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './tactical-turn-tracker.component.html',
    styleUrl: './tactical-turn-tracker.component.scss',
})
export class TacticalTurnTrackerComponent extends TurnTrackerControls {
    protected override turnTrackerUsesManagedOverlay(): boolean {
        return false;
    }
}
