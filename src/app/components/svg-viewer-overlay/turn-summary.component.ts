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
    private readonly MOVE_MIN = 0;
    private readonly MOVE_MAX = 25;

    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private overlay = inject(Overlay);
    unit = inject(SvgInteractionOverlayComponent).unit;
    sliderContainer = viewChild.required<ElementRef<HTMLDivElement>>('sliderContainer');
    private activePointerId: number | null = null;
    private dragging = false;

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
        return unit.turnState().getPSRChecks().length;
    });

    currentMoveMode = computed(() => {
        const u = this.unit();
        if (!u) return null;
        return u.turnState().moveMode();
    });

    getTargetModifierAsDefender = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().getTargetModifierAsDefender();
    });

    getTargetModifierAsAttacker = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().getTargetModifierAsAttacker();
    });

    heatGenerated = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().heatGenerated();
    });

    heatDissipated = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().heatDissipated();
    });

    totalHeatDelta = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().totalHeatDelta();
    });

    close() {
        this.overlayManager.closeManagedOverlay('turnSummary');
    }

    endTurn() {
        this.unit()?.resetTurnState();
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

    selectMove(mode: 'stationary' | 'walk' | 'run' | 'jump') {
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

    moveDistance = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().moveDistance() || 0;
    });

    moveDistancePercent = computed(() => {
        const max = this.MOVE_MAX;
        const val = this.moveDistance() || 0;
        return Math.max(0, Math.min(100, (val / max) * 100));
    });

    hasMoveDistance = computed(() => {
        const u = this.unit();
        if (!u) return false;
        return u.turnState().moveDistance() !== null;
    });

    moveDistanceLabel = computed(() => {
        const v = this.moveDistance();
        if (v >= this.MOVE_MAX) {
            return `${this.MOVE_MAX}+`;
        }
        return `${v}`;
    });

    private percentToValue(percent: number): number {
        const v = this.MOVE_MIN + percent * (this.MOVE_MAX - this.MOVE_MIN);
        return this.alignToStep(v);
    }

    private alignToStep(value: number): number {
        const stepped = Math.round(value / 1);
        return Math.max(this.MOVE_MIN, Math.min(this.MOVE_MAX, stepped));
    }
    onMoveDistanceInput(event: Event) {
        const el = event.target as HTMLInputElement;
        const value = Number(el.value || 0);
        const u = this.unit();
        if (!u) return;
        u.turnState().moveDistance.set(this.alignToStep(value));
    }

    // Pointer down on the visual hex: start capturing and listen for moves
    startDrag(event: PointerEvent) {
        event.preventDefault();
        const container = this.sliderContainer()?.nativeElement;
        if (!container) return;
        this.activePointerId = event.pointerId;
        this.dragging = true;
        try {
            (event.target as Element).setPointerCapture(this.activePointerId);
        } catch { /* ignore */ }
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp, { once: true });
        this.onPointerMove(event);
    }

    private onPointerMove = (ev: PointerEvent) => {
        if (this.activePointerId != null && ev.pointerId !== this.activePointerId) return;
        const container = this.sliderContainer()?.nativeElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, rect.width > 0 ? x / rect.width : 0));
        const value = this.percentToValue(percent);
        const u = this.unit();
        if (!u) return;
        u.turnState().moveDistance.set(value);
    };

    private onPointerUp = (ev: PointerEvent) => {
        if (this.activePointerId != null) {
            try {
                (ev.target as Element).releasePointerCapture(this.activePointerId);
            } catch { /* ignore */ }
        }
        this.activePointerId = null;
        this.dragging = false;
        window.removeEventListener('pointermove', this.onPointerMove);
    };

    // keyboard support when the slider container is focused
    onKeyDown(event: KeyboardEvent) {
        const u = this.unit();
        if (!u) return;
        let delta = 0;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = 1;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -1;
        if (delta === 0) return;
        event.preventDefault();
        const next = this.alignToStep((u.turnState().moveDistance() || 0) + delta);
        u.turnState().moveDistance.set(next);
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