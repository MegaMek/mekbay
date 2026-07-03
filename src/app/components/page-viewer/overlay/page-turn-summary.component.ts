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

import {
    Component,
    ChangeDetectionStrategy,
    inject,
    Injector,
    input,
    output,
    computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { canChangeAirborneGround, type MotiveModeOption, type MotiveModes } from '../../../models/motiveModes.model';
import { HexSliderComponent } from '../../hex-slider/hex-slider.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import type { TooltipLine } from '../../tooltip/tooltip.component';
import { calculateModifierTotal, type UnitModifierBreakdownEntry, type UnitModifierTotal } from '../../../models/rules/unit-type-rules';

/*
 * Author: Drake
 * 
 * PageTurnSummaryPanelComponent - Turn summary panel for page viewer.
 * 
 * This is a copy of TurnSummaryPanelComponent adapted to work with PageInteractionOverlayComponent.
 */

@Component({
    selector: 'page-turn-summary-panel',
    imports: [CommonModule, HexSliderComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-turn-summary.component.html',
    styleUrl: './page-turn-summary.component.scss'
})
export class PageTurnSummaryPanelComponent {
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private overlay = inject(Overlay);
    private parent = inject(PageInteractionOverlayComponent);
    unit = this.parent.unit;
    force = this.parent.force;
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

    controlRollShortLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'PSR';
        return unit.rules.controlRollShortLabel;
    });

    controlRollFullLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'Piloting Skill Rolls';
        return unit.rules.controlRollFullLabel;
    });

    currentMoveMode = computed(() => {
        const u = this.unit();
        if (!u) return null;
        return u.turnState().moveMode();
    });

    moveModeModifierLabel(mode: MotiveModes): string | null {
        const unit = this.unit();
        const modifier = unit?.rules.getAttackMovementModifier(mode, unit.turnState().airborne() ?? false) ?? 0;
        if (modifier === 0) return null;
        return modifier > 0 ? `+${modifier}` : `${modifier}`;
    }

    getTotalTargetModifierAsDefender = computed(() => {
        const u = this.unit();
        return this.formatModifierTotal(u
            ? u.turnState().getTotalTargetModifierAsDefender()
            : { modifier: 0 });
    });

    defenseTargetModifierTooltip = computed<TooltipLine[] | null>(() => {
        const u = this.unit();
        if (!u) return null;
        return this.buildModifierTooltip('Defense Target Modifier', u.turnState().getDefenseModifierBreakdown());
    });

    getTotalTargetModifierAsAttacker = computed<number>(() => {
        const u = this.unit();
        let value = 0;
        if (u) {
            value = u.turnState().getTotalTargetModifierAsAttacker();
        }
        return value;
    });

    attackModifierTooltip = computed<TooltipLine[] | null>(() => {
        const u = this.unit();
        if (!u) return null;
        return this.buildModifierTooltip('Attack Target Modifier', u.turnState().getAttackModifierBreakdown());
    });

    spotting = computed(() => {
        const u = this.unit();
        if (!u) return false;
        return u.turnState().spotting();
    });

    tracksHeat = computed(() => {
        const u = this.unit();
        if (!u) return false;
        return u.getUnit().heat >= 0;
    });

    heatSources = computed(() => {
        const u = this.unit();
        if (!u) return [];
        return u.turnState().heatSources();
    });

    psrModifiers = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.PSRModifiers().modifiers.filter(modifier => modifier.pilotCheck !== undefined && modifier.pilotCheck !== 0);
    });

    gunneryModifiers = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.rules.gunneryModifiers().filter(modifier => modifier.modifier !== 0);
    });

    close() {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`turnSummary-${unitId}`);
    }

    endTurn() {
        this.unit()?.endTurn();
    }

    openPsrWarning(event: MouseEvent) {
        event.stopPropagation();

        const unitId = this.unit()?.id;
        const overlayKey = `psrWarning-${unitId}`;

        // Toggle: close if already open
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }

        // Create a custom injector that provides this component as the parent
        const customInjector = Injector.create({
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: this.parent }
            ],
            parent: this.injector
        });

        const portal = new ComponentPortal(PagePsrWarningPanelComponent, null, customInjector);
        this.overlayManager.createManagedOverlay(overlayKey, null as any, portal, {
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
        turnState.applyMovePSR.set(true);
    }

    moveModes = computed<MotiveModeOption[]>(() => {
        const u = this.unit();
        if (!u) return [];
        return u.getAvailableMotiveModes(u.turnState().airborne() ?? false);
    });

    selectMove(mode: MotiveModes) {
        const u = this.unit();
        if (!u) return;
        const turnState = u.turnState();
        const current = turnState.moveMode();
        if (current === mode) {
            turnState.moveMode.set(null);
            turnState.moveDistance.set(null);
        } else {
            turnState.moveMode.set(mode);
            turnState.moveDistance.set(mode === 'stationary' ? null : turnState.minDistanceCurrentMoveMode());
        }
        turnState.applyMovePSR.set(true);
    }

    toggleSpotting() {
        const u = this.unit();
        if (!u) return;
        const turnState = u.turnState();
        turnState.spotting.set(!turnState.spotting());
    }

    overDistance = computed<boolean>(() => {
        const u = this.unit();
        if (!u) return false;
        const turnState = u.turnState();
        turnState.airborne();
        turnState.moveMode();
        const moveDistance = this.moveDistance();
        const minDistance = turnState.minDistanceCurrentMoveMode();
        const maxDistance = turnState.maxDistanceCurrentMoveMode();
        if (moveDistance === null) return false;
        return moveDistance < minDistance || moveDistance > maxDistance;
    });

    moveDistance = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        return u.turnState().moveDistance() || 0;
    });

    moveMax = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        const baseUnit = u.getUnit();
        if (!baseUnit) return 0;
        const mode = u.turnState().moveMode();
        if (!mode) return 0;
        return u.turnState().maxDistanceCurrentMoveMode();
    });

    moveMin = computed(() => {
        const u = this.unit();
        if (!u) return 0;
        const mode = u.turnState().moveMode();
        if (!mode) return 0;
        return Math.min(u.turnState().minDistanceCurrentMoveMode(), this.moveMax());
    });

    moveDistanceTicks = computed(() => {
        const max = this.moveMax();
        const length = Math.max(0, max + 1);
        return Array.from({ length }, (_value, index) => index);
    });

    hasMoveDistance = computed(() => {
        const u = this.unit();
        if (!u) return false;
        return u.turnState().moveDistance() !== null;
    });

    setMoveDistance(value: number, markModified = true) {
        const u = this.unit();
        if (!u) return;
        const min = this.moveMin();
        const max = this.moveMax();
        u.turnState().setMoveDistance(Math.max(min, Math.min(max, value)), { markModified });
    }

    commitMoveDistance(value: number) {
        const u = this.unit();
        if (!u) return;
        this.setMoveDistance(value, false);
        u.turnState().markModified();
    }

    private buildModifierTooltip(title: string, entries: UnitModifierBreakdownEntry[]): TooltipLine[] {
        const total = calculateModifierTotal(entries);
        return [
            { value: title, isHeader: true },
            ...(entries.length > 0
                ? entries.map(entry => ({ label: entry.label, value: this.formatModifierTotal(entry) }))
                : [{ label: 'No active modifiers', value: '+0' }]),
            { isBreak: true },
            { label: 'Total', value: this.formatModifierTotal(total) },
        ];
    }

    private formatModifierTotal(total: UnitModifierTotal): string {
        const value = this.formatModifier(total.modifier);
        const alternateModifierLabel = total.alternateModifierLabel ? ` ${total.alternateModifierLabel}` : '';
        return total.alternateModifier !== undefined && total.alternateModifier !== total.modifier
            ? `${value} (${this.formatModifier(total.alternateModifier)}${alternateModifierLabel})`
            : value;
    }

    private formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }
}

@Component({
    selector: 'page-psr-warning-panel',
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
        <div class="header">{{ controlRollFullLabel() }}</div>
        <div class="body">
            <div class="psr-list">
                @for (check of psrChecks(); let i = $index; track i) {
                    @if (check.fallCheck !== undefined) {
                        <div class="psr-item">
                            <div class="psr-marker">▸</div>
                            <div class="psr-reason">{{ check.reason }}</div>
                        </div>
                    }
                }
            </div>
            <div class="header">Modifiers</div>
            <div class="modifiers">
                @for (modifier of modifiersList(); let i = $index; track i) {
                    @if (modifier.pilotCheck) {
                        <div class="modifier-item">
                            {{ modifier.reason }}: {{ modifier.pilotCheck >= 0 ? '+' : '' }}{{ modifier.pilotCheck }}
                        </div>
                    }
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
            max-height: 80dvh;
            overflow-x: hidden;
            overflow-y: auto;
        }
        .header {
            font-weight: bold;
            text-align: center;
        }
        .body {
            color: var(--text-color-secondary);
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
            font-size: 2em;
            line-height: 0;
            flex-shrink: 0;
        }
        .psr-reason {
            flex: 1;
            color: var(--text-color-secondary);
            line-height: 1.4;
        }
        .psr-target {
            padding: 8px 12px;
            font-weight: bold;
            font-size: 1em;
            color: var(--text-color);
            text-align: center;
        }
        .modifiers {
            margin-top: 8px;
            padding: 8px 12px;
            font-size: 0.9em;
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
export class PagePsrWarningPanelComponent {
    private parent = inject(PageInteractionOverlayComponent);
    private overlayManager = inject(OverlayManagerService);
    unit = this.parent.unit;

    close() {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`psrWarning-${unitId}`);
    }

    modifiersList = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.PSRModifiers().modifiers;
    });

    controlRollFullLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'Piloting Skill Rolls';
        return unit.rules.controlRollFullLabel;
    });

    psrChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.turnState().getPSRChecks().filter(c => c.fallCheck !== undefined);
    });
}
