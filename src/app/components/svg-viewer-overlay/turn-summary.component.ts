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
import { Component, ChangeDetectionStrategy, inject, Injector, input, signal, viewChild, Signal, effect, computed, DestroyRef, afterNextRender, ElementRef } from '@angular/core';
import { SvgZoomPanService } from '../svg-viewer/svg-zoom-pan.service';
import { OptionsService } from '../../services/options.service';
import { DbService } from '../../services/db.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceUnit } from '../../models/force-unit.model';
import { LoggerService } from '../../services/logger.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { SvgInteractionOverlayComponent } from './svg-viewer-overlay.component';

/*
 * Author: Drake
 */

@Component({
    selector: 'turn-summary-panel',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './turn-summary.component.html',
    styleUrls: [`./turn-summary.component.scss`]
})
export class TurnSummaryPanelComponent {
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private overlay = inject(Overlay);
    unit = inject(SvgInteractionOverlayComponent).unit;

    damageReceived = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().dmgReceived();
    });

    hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().hasPSRCheck();
    });

    PSRChecksCount = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().PSRChecksCount();
    });

    currentMoveMode = computed(() => {
        const u = this.unit();
        if (!u) return null;
        return u.turnState().moveMode();
    });

    close() {
        this.overlayManager.closeManagedOverlay('turnSummary');
    }

    openPsrWarning(event: MouseEvent) {
        event.stopPropagation();

        // toggle: close if already open
        if (this.overlayManager.has('psrWarning')) {
            this.overlayManager.closeManagedOverlay('psrWarning');
            return;
        }

        const target = event.currentTarget as HTMLElement || (event.target as HTMLElement);
        const portal = new ComponentPortal(PsrWarningPanelComponent, null, this.injector);
        const compRef = this.overlayManager.createManagedOverlay('psrWarning', target, portal, {
            hasBackdrop: false,
            panelClass: 'psr-warning-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.close()
        });
    }

    selectMove(mode: 'walk' | 'run' | 'jump') {
        const u = this.unit();
        if (!u) return;
        const turnState = u.turnState();
        const current = turnState.moveMode();
        if (current === mode) {
            turnState.moveMode.set(null);
        } else {
            turnState.moveMode.set(mode);
        }
    }

    endTurn() {
        this.unit()?.resetTurnState();
        this.close();
    }
}



@Component({
    selector: 'psr-warning-panel',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
        <div class="header">PSR Check</div>
        <div class="body">
            This unit has a PSR (Pilot Skill Roll) warning.
        </div>
        <div class="actions">
            <button class="bt-button" type="button" (click)="close()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .panel {
            pointer-events: auto;
            min-width: 200px;
            display: flex;
            flex-direction: column;
            padding: 4px;
            gap: 4px;
            transition: opacity 0.2s;
        }
        .header {
            font-weight: bold;
            margin-bottom: 4px;
            text-align: center;
        }
        .body {
            margin-bottom: 12px;
            font-size: 0.9em;
            color: var(--text-color-secondary, #bbb);
        }
        .actions {
            display: flex;
            justify-content: center;
        }
    `]
})
class PsrWarningPanelComponent {
    private overlayManager = inject(OverlayManagerService);
    close() {
        this.overlayManager.closeManagedOverlay('psrWarning');
    }
}