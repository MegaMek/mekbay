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
import { calculateModifierTotal, type PSRCheck, type UnitHeatSource, type UnitModifierBreakdownEntry, type UnitModifierTotal } from '../../../models/rules/unit-type-rules';
import { EquipmentInteractionRegistryService, type HandlerChoice, type HandlerContext } from '../../../services/equipment-interaction-registry.service';
import { ToastService } from '../../../services/toast.service';
import { DialogsService } from '../../../services/dialogs.service';
import { DataService } from '../../../services/data.service';
import type { MountedEquipment } from '../../../models/mounted-equipment.model';
import { MascHandler } from '../../../equipment-handlers/masc.handler';
import type { SelectedInventoryWeaponHeat } from '../../../utils/inventory-control-heat.util';

interface EquipmentTrackControlRow {
    entry: MountedEquipment;
    label: string;
    damaged: boolean;
    sequenceChoices: HandlerChoice[];
    statusChoice?: HandlerChoice;
}

export interface TurnSummaryHeatRow {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly selectedValue?: number;
    readonly selectedOnly?: boolean;
}

export function composeTurnSummaryHeatRows(
    sources: readonly UnitHeatSource[],
    selection: SelectedInventoryWeaponHeat
): TurnSummaryHeatRow[] {
    const rows = sources.map(source => ({ id: source.id, label: source.label, value: source.value }));
    if (!selection.hasSelection) return rows;

    const weaponsRow = rows.find(row => row.id === 'weapons');
    if (weaponsRow) {
        return rows.map(row => row === weaponsRow ? { ...row, selectedValue: selection.value } : row);
    }
    return [{
        id: 'selected-weapons',
        label: 'Selected Weapons',
        value: selection.value,
        selectedOnly: true,
    }, ...rows];
}

export function displayPsrModifiers(modifiers: readonly PSRCheck[]): Array<PSRCheck & { pilotCheck: number }> {
    return modifiers
        .filter((modifier): modifier is PSRCheck & { pilotCheck: number } =>
            modifier.pilotCheck !== undefined && modifier.pilotCheck !== 0
        )
        .sort((left, right) => left.reason.localeCompare(right.reason));
}

export function countActionablePsrChecks(
    checks: readonly Pick<PSRCheck, 'failureOutcome'>[],
    autoFall: boolean
): number {
    return autoFall ? checks.filter(check => check.failureOutcome !== 'Fall').length : checks.length;
}

export function togglePsrWarningOverlay(
    parent: PageInteractionOverlayComponent,
    overlayManager: OverlayManagerService,
    injector: Injector,
    overlay: Overlay,
    beforeOpen?: () => void
): void {
    const unitId = parent.unit()?.id;
    if (!unitId) return;

    const overlayKey = `psrWarning-${unitId}`;
    if (overlayManager.has(overlayKey)) {
        overlayManager.closeManagedOverlay(overlayKey);
        return;
    }

    beforeOpen?.();
    const customInjector = Injector.create({
        providers: [
            { provide: PageInteractionOverlayComponent, useValue: parent }
        ],
        parent: injector
    });
    const portal = new ComponentPortal(PagePsrWarningPanelComponent, null, customInjector);
    overlayManager.createManagedOverlay(overlayKey, null, portal, {
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: 'psr-warning-overlay-panel',
        closeOnOutsideClick: true,
        scrollStrategy: overlay.scrollStrategies.block(),
        positions: []
    });
}

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
    private equipmentRegistry = inject(EquipmentInteractionRegistryService).getRegistry();
    private toastService = inject(ToastService);
    private dialogsService = inject(DialogsService);
    private dataService = inject(DataService);
    unit = this.parent.unit;
    force = this.parent.force;
    endTurnForAllButtonVisible = input<boolean>(false);
    endTurnForAllClicked = output<void>();

    private handlerContext(): HandlerContext {
        return {
            toastService: this.toastService,
            dialogsService: this.dialogsService,
            dataService: this.dataService,
            choiceSurface: 'turn-summary',
        };
    }

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

    spottingModifierLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return null;
        return this.formatModifier(unit.rules.getSpottingModifier());
    });

    tracksHeat = computed(() => {
        const u = this.unit();
        if (!u) return false;
        return u.getUnit().heat >= 0;
    });

    heatRows = computed(() => {
        const u = this.unit();
        if (!u) return [];
        return composeTurnSummaryHeatRows(u.turnState().heatSources(), u.selectedInventoryWeaponHeat());
    });

    psrModifiers = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return displayPsrModifiers(unit.PSRModifiers().modifiers);
    });

    equipmentTrackControlRows = computed<EquipmentTrackControlRow[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.getInventory()
            .filter(entry => entry.equipment?.flags?.has('F_MASC'))
            .map(entry => {
                const active = entry.equipment?.flags?.has('F_MASC') ? MascHandler.isActive(entry) : true;
                const damaged = entry.resolvedDestroyed();
                const choices = this.equipmentRegistry.getChoices(entry, this.handlerContext());
                return {
                    entry,
                    label: entry.equipment?.name || entry.name,
                    damaged,
                    active,
                    sequenceChoices: choices.filter(choice => typeof choice.value === 'number'),
                    statusChoice: choices.find(choice => typeof choice.value !== 'number'),
                };
            })
            .filter(row => !row.damaged || row.active)
            .filter(row => row.sequenceChoices.length > 0);
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
        togglePsrWarningOverlay(this.parent, this.overlayManager, this.injector, this.overlay);
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

    async handleEquipmentTrackChoice(row: EquipmentTrackControlRow, choice: HandlerChoice): Promise<void> {
        if (choice.disabled) return;
        await this.equipmentRegistry.handleSelection(row.entry, choice, this.handlerContext());
        this.unit()?.inventoryControl.markInventoryViewChanged();
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
                        <div class="psr-item" [class.resolved]="!isAutomaticFailure(check) && outcome(check)"
                            [class.automatic-failure]="isAutomaticFailure(check)">
                            <div class="psr-check-header">
                                <div class="psr-number">{{ i + 1 }}</div>
                                <div class="psr-item-content">
                                    <div class="psr-reason">{{ check.reason }}</div>
                                    <div class="psr-failure">
                                        <span>Failure</span>
                                        <strong>{{ check.failureOutcome }}</strong>
                                    </div>
                                </div>
                                @if (!isAutomaticFailure(check) && outcome(check); as result) {
                                    <div class="psr-result" [class.failed]="result === 'failed'">{{ result }}</div>
                                }
                            </div>
                            @if (isAutomaticFailure(check)) {
                                <div class="psr-automatic-failure">AUTOMATIC FAILURE</div>
                            } @else if (!outcome(check)) {
                                <div class="psr-resolution-actions">
                                    <button class="bt-button success" type="button" (click)="resolve(check, 'success')">SUCCESS</button>
                                    <button class="bt-button danger" type="button" (click)="resolve(check, 'failed')">FAILED</button>
                                </div>
                            }
                        </div>
                    }
                }
            </div>
            @if (!allChecksAutomaticFailure()) {
                <div class="roll-details">
                    @if (modifiersList().length > 0) {
                        <div class="roll-details-label">Modifiers</div>
                        <div class="modifiers">
                            @for (modifier of modifiersList(); let i = $index; track i) {
                                <div class="modifier-item">
                                    <span class="modifier-reason">{{ modifier.reason }}</span>
                                    <strong class="modifier-value" [class.bonus]="modifier.pilotCheck < 0">
                                        {{ modifier.pilotCheck >= 0 ? '+' : '' }}{{ modifier.pilotCheck }}
                                    </strong>
                                </div>
                            }
                        </div>
                    }
                    <div class="psr-target">
                        <span>Target roll</span>
                        <strong>{{ unit()?.PSRTargetRoll() }}</strong>
                    </div>
                </div>
            }
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
            width: min(420px, calc(100vw - 24px));
            box-sizing: border-box;
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
            gap: 6px;
            padding: 8px;
        }
        .psr-item {
            padding: 8px;
            border: 1px solid var(--border-color);
            border-left: 3px solid var(--bt-yellow);
            background: var(--background-input);
            transition: opacity 0.2s, border-color 0.2s;
        }
        .psr-item.resolved {
            border-left-color: #4caf50;
            opacity: 0.8;
        }
        .psr-item.automatic-failure {
            border-left-color: var(--danger);
        }
        .psr-check-header {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .psr-number {
            display: grid;
            place-items: center;
            width: 24px;
            height: 24px;
            border: 1px solid var(--border-color);
            color: var(--text-color);
            font-weight: bold;
            font-size: 0.8em;
            flex-shrink: 0;
        }
        .psr-reason {
            color: var(--text-color);
            line-height: 1.25;
            font-weight: 600;
        }
        .psr-item-content {
            flex: 1;
            min-width: 0;
        }
        .psr-failure {
            display: flex;
            gap: 5px;
            margin-top: 2px;
            color: var(--text-color-tertiary);
            font-size: 0.78em;
            text-transform: uppercase;
        }
        .psr-failure strong {
            color: var(--danger);
        }
        .psr-result {
            color: #7dcc80;
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .psr-result.failed {
            color: var(--danger);
        }
        .psr-resolution-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 8px;
            padding-left: 32px;
        }
        .psr-automatic-failure {
            margin-top: 8px;
            padding-left: 32px;
            color: var(--danger);
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .roll-details {
            --roll-value-width: 52px;
            margin: 8px;
            border-bottom: 1px solid var(--border-color);
        }
        .roll-details-label {
            padding: 5px 8px;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-color-tertiary);
            font-size: 0.72em;
            font-weight: 700;
            text-transform: uppercase;
        }
        .modifiers {
            font-size: 0.9em;
        }
        .modifier-item {
            display: grid;
            background: var(--background-input);
            grid-template-columns: minmax(0, 1fr) var(--roll-value-width);
            min-height: 30px;
            border-bottom: 1px solid var(--border-color);
        }
        .modifier-reason {
            align-self: center;
            min-width: 0;
            padding: 5px 8px;
            color: var(--text-color-secondary);
        }
        .modifier-value {
            display: grid;
            place-items: center;
            font-variant-numeric: tabular-nums;
            border: 1px solid var(--danger);
            background-color: var(--danger);
            color: #fff;
        }
        .modifier-value.bonus {
            color: #7dcc80;
        }
        .psr-target {
            display: grid;
            grid-template-columns: minmax(0, 1fr) var(--roll-value-width);
            background: var(--background-input);
            min-height: 42px;
            color: var(--text-color);
            font-weight: 700;
            text-transform: uppercase;
        }
        .psr-target span {
            align-self: center;
            padding: 8px;
            font-size: 0.82em;
        }
        .psr-target strong {
            display: grid;
            place-items: center;
            border: 1px solid var(--bt-yellow);
            background: var(--bt-yellow-background);
            color: var(--bt-yellow);
            font-size: 1.35em;
            font-variant-numeric: tabular-nums;
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

    resolve(check: PSRCheck, result: 'success' | 'failed') {
        const unit = this.unit();
        if (!unit) return;
        if (check.resolution) {
            unit.resolveRuleCheck(check.resolution.key, check.resolution.token, result);
        } else if (check.id) {
            unit.turnState().resolvePSRCheck(check.id, result);
        }
        if (this.psrChecks().length === 0) this.close();
    }

    outcome(check: PSRCheck) {
        if (!check.id || check.resolution) return undefined;
        return this.unit()?.turnState().getPSROutcome(check.id);
    }

    isAutomaticFailure(check: PSRCheck): boolean {
        return this.unit()?.turnState().autoFall() === true && check.failureOutcome === 'Fall';
    }

    modifiersList = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return displayPsrModifiers(unit.PSRModifiers().modifiers);
    });

    controlRollFullLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'Piloting Skill Rolls';
        return unit.rules.controlRollFullLabel;
    });

    psrChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.turnState().getPSRChecks()
            .filter(check => check.fallCheck !== undefined)
            .sort((left, right) => this.checkDisplayOrder(left) - this.checkDisplayOrder(right));
    });

    allChecksAutomaticFailure = computed(() => {
        const checks = this.psrChecks();
        return checks.length > 0 && checks.every(check => this.isAutomaticFailure(check));
    });

    private checkDisplayOrder(check: PSRCheck): number {
        if (this.isAutomaticFailure(check)) return 2;
        if (this.outcome(check)) return 1;
        return 0;
    }
}
