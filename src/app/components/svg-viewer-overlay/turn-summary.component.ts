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
import { Component, ChangeDetectionStrategy, inject, Injector, input, signal, viewChild, Signal, effect, computed, afterNextRender, ElementRef, output } from '@angular/core';
import { SvgZoomPanService } from '../svg-viewer/svg-zoom-pan.service';
import { OptionsService } from '../../services/options.service';
import { DbService } from '../../services/db.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceUnit } from '../../models/force-unit.model';
import { LoggerService } from '../../services/logger.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { SvgInteractionOverlayComponent } from './svg-viewer-overlay.component';
import { canChangeAirborneGround, MotiveModeOption, MotiveModes } from '../../models/motiveModes.model';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

/*
 * Author: Drake
 */

@Component({
    selector: 'turn-summary-panel',
    standalone: true,
    imports: [CommonModule, DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './turn-summary.component.html',
    styleUrls: [`./turn-summary.component.scss`]
})
export class TurnSummaryPanelComponent {
    readonly MOVE_MIN = 0;
    readonly MOVE_MAX = 25;

    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private overlay = inject(Overlay);
    unit = inject(SvgInteractionOverlayComponent).unit;
    force = inject(SvgInteractionOverlayComponent).force;
    sliderContainer = viewChild<ElementRef<HTMLDivElement>>('sliderContainer');
    private activePointerId: number | null = null;
    endTurnForAllButtonVisible = input<boolean>(false);
    endTurnForAllClicked = output<void>();

    endTurnForAll(event: MouseEvent) {
        event.stopPropagation();
        this.endTurnForAllClicked.emit();
    }

    dirty = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirty();
    });

    damageReceived = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().dmgReceived();
    });

    hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().PSRRollsCount() > 0;
    });

    falling = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().autoFall();
    });

    PSRChecksCount = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().PSRRollsCount();
    });

    currentMoveMode = computed(() => {
        const u = this.unit();
        if (!u) return null;
        return u.turnState().moveMode();
    });

    getTargetModifierAsDefender = computed(() => {
        const u = this.unit();
        let value = 0;
        if (u) {
            value = u.turnState().getTargetModifierAsDefender();
        }
        return value >= 0 ? `+${value}` : `${value}`;
    });

    getTargetModifierAsAttacker = computed<number>(() => {
        const u = this.unit();
        let value = 0;
        if (u) {
            value = u.turnState().getTargetModifierAsAttacker();
        }
        return value;
    });

    tracksHeat = computed(() => {
        const u = this.unit();
        if (!u) return false;
        return u.getUnit().heat >= 0;
    });

    heatFromMovement = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().heatGeneratedFromMovement();
    });

    heatGeneratedFromDamagedEngine = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().heatGeneratedFromDamagedEngine();
    });

    close() {
        this.overlayManager.closeManagedOverlay('turnSummary');
    }

    endTurn() {
        this.unit()?.endTurn();
    }

    openPsrWarning(event: MouseEvent) {
        event.stopPropagation();

        // toggle: close if already open
        if (this.overlayManager.has('psrWarning')) {
            this.overlayManager.closeManagedOverlay('psrWarning');
            return;
        }

        const portal = new ComponentPortal(PsrWarningPanelComponent, null, this.injector);
        const compRef = this.overlayManager.createManagedOverlay('psrWarning', null as any, portal, {
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'psr-warning-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.block(),
            positions: [] // empty positions array signals to use global positioning
        });
    }

    airborne = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().airborne();
    });

    canSwitchAirborneMode = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return canChangeAirborneGround(unit.getUnit());
    });

    setAirborne(airborne: boolean) {
        const u = this.unit();
        if (!u) return;
        const turnState = u.turnState();
        const currentAirborne = turnState.airborne();
        if (currentAirborne === airborne) {
            turnState.airborne.set(null);
        } else {
            turnState.airborne.set(airborne);
        }
        turnState.moveMode.set(null);
        turnState.moveDistance.set(null);
    }

    moveModes = computed<MotiveModeOption[]>(() => {
        const u = this.unit();
        if (!u) return [];
        return u.getAvailableMotiveModes();
    });

    selectMove(mode: MotiveModes) {
        const u = this.unit();
        if (!u) return;
        const turnState = u.turnState();
        const current = turnState.moveMode();
        if (current === mode) {
            turnState.moveMode.set(null);
        } else {
            turnState.moveMode.set(mode);
            if (mode === 'stationary') {
                turnState.moveDistance.set(null);
            }
        }
        turnState.moveDistance.set(null);
    }

    overDistance = computed<boolean>(() => {
        const u = this.unit();
        if (!u) return false;
        const turnState = u.turnState();
        turnState.airborne();
        turnState.moveMode();
        const moveDistance = this.moveDistance();
        const maxDistance = turnState.maxDistanceCurrentMoveMode();
        if (moveDistance === null) return false;
        return moveDistance > maxDistance;
    });

    moveDistance = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().moveDistance() || 0;
    });

    moveMax = computed(() => {
        const u = this.unit();
        if (!u) return this.MOVE_MAX;
        const baseUnit = u.getUnit();
        if (!baseUnit) return this.MOVE_MAX;
        const mode = u.turnState().moveMode();
        if (!mode) return this.MOVE_MAX;
        return Math.min(this.MOVE_MAX, u.turnState().maxDistanceCurrentMoveMode());
    });

    moveDistancePercent = computed(() => {
        const max = this.moveMax();
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
        const max = this.moveMax();
        const v = this.MOVE_MIN + percent * (max - this.MOVE_MIN);
        return this.alignToStep(v);
    }

    private alignToStep(value: number): number {
        const max = this.moveMax();
        const stepped = Math.round(value / 1);
        return Math.max(this.MOVE_MIN, Math.min(max, stepped));
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
        <div class="header">Piloting Skill Rolls</div>
        <div class="body">
            <div class="psr-list">
                @for (check of psrChecks(); let i = $index; track i) {
                    <div class="psr-item">
                        <div class="psr-marker">▸</div>
                        <div class="psr-reason">{{ check.reason }}</div>
                    </div>
                }
            </div>
            <div class="psr-target">
                Target roll: {{ unit()?.PSRTargetRoll() }}
            </div>
        </div>
        <div class="actions">
            <button class="bt-button" type="button" (click)="close()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        @media print {
            :host {
                display: none !important;
            }
        }
        .panel {
            pointer-events: auto;
            min-width: 200px;
            display: flex;
            flex-direction: column;
            padding: 8px;
            gap: 8px;
            transition: opacity 0.2s;
        }
        .header {
            font-weight: bold;
            text-align: center;
        }
        .body {
            color: var(--text-color-secondary, #bbb);
        }
        .psr-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 8px;
        }
        .psr-item {
            display: flex;
            align-items: center;
            gap: 12px;
            transition: background 0.2s;
        }
        .psr-marker {
            color: var(--danger);
            font-weight: bold;
            font-size: 1.1em;
            line-height: 1.4;
            flex-shrink: 0;
        }
        .psr-reason {
            flex: 1;
            font-size: 0.9em;
            color: var(--text-color-secondary, #ddd);
            line-height: 1.4;
        }
        .psr-target {
            padding: 8px 12px;
            font-weight: bold;
            font-size: 1em;
            color: var(--text-color);
            text-align: center;
        }
        .actions {
            display: flex;
            justify-content: center;
        }

        .bt-button {
            width: 100%;
        }
    `]
})
class PsrWarningPanelComponent {
    private parent = inject(SvgInteractionOverlayComponent);
    private overlayManager = inject(OverlayManagerService);
    unit = this.parent.unit;
    close() {
        this.overlayManager.closeManagedOverlay('psrWarning');
    }
    psrChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.turnState().getPSRChecks().filter(c => !c.fallCheck !== undefined);
    });
}