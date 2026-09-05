// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay } from '@angular/cdk/overlay';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { canChangeAirborneGround, getMotiveModesOptionsByUnit, type MotiveModeOption, type MotiveModes } from '../../../models/motiveModes.model';
import { HexSliderComponent } from '../../hex-slider/hex-slider.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import type { TooltipLine } from '../../tooltip/tooltip.component';
import { calculateModifierTotal, type UnitModifierBreakdownEntry, type UnitModifierTotal } from '../../../models/rules/unit-type-rules';
import { createHandlerCommandContext, createHandlerQueryContext, EquipmentInteractionRegistryService, type HandlerChoice, type HandlerCommandContext, type HandlerQueryContext } from '../../../services/equipment-interaction-registry.service';
import { ToastService } from '../../../services/toast.service';
import { DialogsService } from '../../../services/dialogs.service';
import { DataService } from '../../../services/data.service';
import type { MountedEquipment } from '../../../models/mounted-equipment.model';
import { EscalatingFailureHandler } from '../../../equipment-handlers/escalatingfailure.handler';
import { togglePsrWarningOverlay } from './page-psr-warning-panel.component';
import { composeTurnSummaryHeatRows, displayPsrModifiers, isEndTurnAvailable, isMoveModeDisabledWhileProne, runWithTurnSummaryCloseBlocked } from './page-turn-summary.util';
import { orderedModifierTooltipLines } from '../../../utils/hit-target-tooltip.util';
import { toggleStandingUpOverlay } from './page-standing-up-panel.component';
import { isUnitBuildingLevel, isUnitWaterDepth, type UnitCover } from '../../../models/unit-cover.model';
import { CoverLevelPickerComponent } from '../../cover-level-picker/cover-level-picker.component';
import { CBTEndTurnService } from '../../../services/cbt-end-turn.service';
import { CBTPhaseResolutionService } from '../../../services/cbt-phase-resolution.service';

interface EquipmentTrackControlRow {
    entry: MountedEquipment;
    label: string;
    damaged: boolean;
    active: boolean;
    sequenceChoices: HandlerChoice[];
    statusChoice?: HandlerChoice;
}

const MAX_VISIBLE_FAILURE_STEPS = 5;

function visibleFailureSteps(choices: HandlerChoice[]): HandlerChoice[] {
    if (choices.length <= MAX_VISIBLE_FAILURE_STEPS) return choices;
    const selectedIndex = choices.findIndex(choice => choice.active && choice.selectionTone !== 'muted');
    const nextIndex = choices.findIndex(choice => !choice.disabled && !choice.active);
    const lastActiveIndex = choices.reduce(
        (lastIndex, choice, index) => choice.active ? index : lastIndex,
        -1,
    );
    const focusIndex = selectedIndex >= 0
        ? selectedIndex
        : nextIndex >= 0
            ? nextIndex
            : Math.max(0, lastActiveIndex);
    const start = Math.max(0, Math.min(
        focusIndex - Math.floor(MAX_VISIBLE_FAILURE_STEPS / 2),
        choices.length - MAX_VISIBLE_FAILURE_STEPS,
    ));
    return choices.slice(start, start + MAX_VISIBLE_FAILURE_STEPS);
}

@Component({
    selector: 'page-turn-summary-panel',
    imports: [CommonModule, HexSliderComponent, TooltipDirective, CoverLevelPickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-turn-summary-panel.component.html',
    styleUrl: './page-turn-summary-panel.component.scss'
})
export class PageTurnSummaryPanelComponent {
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly overlay = inject(Overlay);
    private readonly parent = inject(PageInteractionOverlayComponent);
    private readonly equipmentRegistry = inject(EquipmentInteractionRegistryService).getRegistry();
    private readonly toastService = inject(ToastService);
    private readonly dialogsService = inject(DialogsService);
    private readonly dataService = inject(DataService);
    private readonly cbtEndTurnService = inject(CBTEndTurnService);
    private readonly phaseResolution = inject(CBTPhaseResolutionService);
    readonly unit = this.parent.unit;
    readonly force = this.parent.force;
    readonly renderReady = signal(false);

    constructor() {
        afterNextRender(() => this.renderReady.set(true));
    }

    private queryContext(): HandlerQueryContext {
        return createHandlerQueryContext(this.dataService.getEquipmentRegistry(), 'turn-summary');
    }

    private commandContext(): HandlerCommandContext {
        return createHandlerCommandContext(
            this.dataService.getEquipmentRegistry(),
            this.toastService,
            this.dialogsService
        );
    }

    readonly dirty = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirty();
    });

    readonly endTurnButtonVisible = computed(() => {
        const unit = this.unit();
        return unit ? isEndTurnAvailable(unit) : false;
    });

    readonly endTurnForAllButtonVisible = computed(() => {
        const units = this.force()?.units() ?? [];
        return units.length > 1 && units.some(isEndTurnAvailable);
    });

    readonly phaseDirty = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirtyPhase();
    });

    readonly endPhaseForAllButtonVisible = computed(() => {
        const force = this.force();
        if (!force) return false;
        const units = force.units();
        return units.length > 1 && units.some(unit => unit.turnState().dirtyPhase());
    });

    readonly damageReceived = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().dmgReceived();
    });

    readonly hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().PSRRollsCount() > 0;
    });

    readonly falling = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().autoFall();
    });

    readonly PSRChecksCount = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().PSRRollsCount();
    });

    readonly controlRollShortLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'PSR';
        return unit.rules.controlRollShortLabel;
    });

    readonly controlRollFullLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'Piloting Skill Rolls';
        return unit.rules.controlRollFullLabel;
    });

    readonly currentMoveMode = computed(() => {
        const unit = this.unit();
        if (!unit) return null;
        return unit.turnState().moveMode();
    });

    readonly prone = computed(() => this.unit()?.getCondition('prone') ?? false);

    readonly immobile = computed(() => this.unit()?.getCondition('immobile') ?? false);

    readonly showImmobileStatus = computed(() => {
        const unit = this.unit();
        return unit?.gameRules.id === 'core2026' && this.immobile();
    });

    readonly showMovementControls = computed(() => (
        !this.showImmobileStatus() || this.currentMoveMode() !== null
    ));

    readonly canStandUp = computed(() => this.unit()?.turnState().canStandUp() ?? false);

    readonly standAttempts = computed(() => this.unit()?.turnState().standAttempts() ?? 0);

    readonly standAttemptMovementPointsSpent = computed(() => {
        const unit = this.unit();
        return unit?.rules.getMovementPointsSpent(unit.turnState()) ?? 0;
    });

    readonly standUpRequiresPSR = computed(() => {
        const turnState = this.unit()?.turnState();
        return turnState?.canStandUp() === true && !turnState.canStandWithoutPSR();
    });

    isMoveModeDisabled(mode: MotiveModes): boolean {
        if (this.unit()?.turnState().carefulStand?.()) return true;
        return isMoveModeDisabledWhileProne(mode, this.prone());
    }

    standUp(event: MouseEvent): void {
        event.stopPropagation();
        const unit = this.unit();
        if (!unit) return;
        const turnState = unit.turnState();
        if (!turnState.prepareStandAttempt()) return;
        if (turnState.canStandWithoutPSR()) {
            turnState.resolveStandAttempt('success');
            return;
        }
        toggleStandingUpOverlay(this.parent, this.overlayManager, this.injector, this.overlay);
    }

    reviewStandAttempts(event: MouseEvent): void {
        event.stopPropagation();
        if (this.standAttempts() === 0) return;
        toggleStandingUpOverlay(this.parent, this.overlayManager, this.injector, this.overlay, { reviewOnly: true });
    }

    moveModeModifierLabel(mode: MotiveModes): string | null {
        const unit = this.unit();
        const modifier = unit?.rules.getAttackMovementModifier(mode, unit.turnState().airborne() ?? false) ?? 0;
        if (modifier === 0) return null;
        return modifier > 0 ? `+${modifier}` : `${modifier}`;
    }

    readonly getTotalTargetModifierAsDefender = computed(() => {
        const unit = this.unit();
        return this.formatModifierTotal(unit
            ? unit.turnState().getTotalTargetModifierAsDefender()
            : { modifier: 0 });
    });

    readonly defenseTargetModifierTooltip = computed<TooltipLine[] | null>(() => {
        const unit = this.unit();
        if (!unit) return null;
        return this.buildModifierTooltip('Defense Target Modifier', unit.turnState().getDefenseModifierBreakdown());
    });

    readonly spotting = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().spotting();
    });

    readonly canSpot = computed(() => {
        const unit = this.unit();
        return unit?.canTakeActiveActions() === true
            && unit.turnState().moveMode() !== 'sprint';
    });

    readonly cover = computed(() => this.unit()?.turnState().cover());
    readonly waterDepth = computed(() => {
        const cover = this.cover();
        return isUnitWaterDepth(cover) ? cover : '';
    });
    readonly buildingLevel = computed(() => {
        const cover = this.cover();
        return isUnitBuildingLevel(cover) ? cover : '';
    });

    readonly coverModifierLabel = computed(() => {
        if (this.cover() === 'light' || this.unit()?.turnState().partiallyUnderwater()) return '+1';
        if (this.cover() === 'heavy') return '+2';
        const buildingModifier = this.unit()?.turnState().buildingCoverState().modifier ?? 0;
        return buildingModifier === 0 ? null : `+${buildingModifier}`;
    });

    readonly spottingModifierLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return null;
        return this.formatModifier(unit.rules.getSpottingModifier());
    });

    readonly tracksHeat = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.getUnit().heat !== null;
    });

    readonly heatRows = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return composeTurnSummaryHeatRows(
            unit.turnState().heatSources(),
            unit.selectedInventoryWeaponHeat(),
            unit.rules.heatDissipation()?.underwaterBonus ?? 0,
        );
    });

    readonly psrModifiers = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return displayPsrModifiers(unit.PSRModifiers().modifiers);
    });

    readonly equipmentTrackControlRows = computed<EquipmentTrackControlRow[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.getInventory()
            .map(entry => {
                const damaged = entry.owner.isEquipmentResolvedDestroyed(entry);
                const choices = this.equipmentRegistry.getChoices(entry, this.queryContext());
                const escalatingChoices = choices.filter(choice => choice._handler instanceof EscalatingFailureHandler);
                const allSequenceChoices = escalatingChoices.filter(choice => choice.failureTarget !== undefined);
                const active = allSequenceChoices.some(choice => choice.active && choice.selectionTone !== 'muted');
                return {
                    entry,
                    label: entry.getDisplayName(),
                    damaged,
                    active,
                    sequenceChoices: visibleFailureSteps(allSequenceChoices),
                    statusChoice: escalatingChoices.find(choice => choice.failureTarget === undefined),
                };
            })
            .filter(row => !row.damaged || row.active)
            .filter(row => row.sequenceChoices.length > 0);
    });

    close(): void {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`turnSummary-${unitId}`);
    }

    async endTurn(): Promise<void> {
        const unit = this.unit();
        if (unit) await this.cbtEndTurnService.endTurn([unit]);
    }

    async endTurnForAll(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const force = this.force();
        const unitId = this.unit()?.id;
        if (!force || !unitId) return;

        const confirmed = await runWithTurnSummaryCloseBlocked(
            this.overlayManager,
            unitId,
            () => this.dialogsService.requestConfirmation(
                'Are you sure you want to end the turn for all units?',
                'End Turn',
                'info'
            )
        );
        if (!confirmed) return;

        await this.cbtEndTurnService.endTurn(force.units());
    }

    async endPhase(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const unit = this.unit();
        if (!unit) return;

        this.close();
        await this.phaseResolution.endPhase(unit);
    }

    async endPhaseForAll(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const force = this.force();
        const unitId = this.unit()?.id;
        if (!force || !unitId) return;

        const confirmed = await runWithTurnSummaryCloseBlocked(
            this.overlayManager,
            unitId,
            () => this.dialogsService.requestConfirmation(
                'Are you sure you want to end the phase for all units?',
                'End Phase',
                'info'
            )
        );
        if (!confirmed) return;

        this.close();
        await this.phaseResolution.endPhase(force.units());
    }

    openPsrWarning(event: MouseEvent): void {
        event.stopPropagation();
        togglePsrWarningOverlay(this.parent, this.overlayManager, this.injector, this.overlay);
    }

    readonly airborne = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().airborne();
    });

    readonly canSwitchAirborneMode = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return canChangeAirborneGround(unit.getUnit());
    });

    setAirborne(airborne: boolean): void {
        const unit = this.unit();
        if (!unit) return;
        const turnState = unit.turnState();
        const currentAirborne = turnState.airborne();
        turnState.airborne.set(currentAirborne === airborne ? null : airborne);
        turnState.moveMode.set(null);
        turnState.moveDistance.set(null);
        turnState.applyMovePSR.set(true);
        turnState.markPhaseStateChanged();
    }

    readonly moveModes = computed<MotiveModeOption[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        const turnState = unit.turnState();
        const airborne = turnState.airborne() ?? false;
        const availableModes = unit.getAvailableMotiveModes(airborne);
        const currentMode = turnState.moveMode();
        if (currentMode === null || availableModes.some(option => option.mode === currentMode)) {
            return availableModes;
        }

        const supportedModes = getMotiveModesOptionsByUnit(unit.getUnit(), airborne);
        const currentOption = supportedModes.find(option => option.mode === currentMode);
        if (!currentOption) return availableModes;

        const visibleModes = new Map(availableModes.map(option => [option.mode, option]));
        visibleModes.set(currentMode, {
            ...currentOption,
            psr: unit.rules.getCommittedDamageMovementModePSRCheck(
                currentMode,
                turnState.moveDistance(),
            ) !== null,
        });
        return supportedModes.flatMap(option => {
            const visibleOption = visibleModes.get(option.mode);
            return visibleOption ? [visibleOption] : [];
        });
    });

    readonly onlyStationaryMoveMode = computed(() => {
        const modes = this.moveModes();
        return modes.length === 1 && modes[0].mode === 'stationary';
    });

    selectMove(mode: MotiveModes): void {
        const unit = this.unit();
        if (!unit || this.isMoveModeDisabled(mode)) return;
        const turnState = unit.turnState();
        const current = turnState.moveMode();
        if (current === mode) {
            turnState.moveMode.set(null);
            turnState.moveDistance.set(null);
        } else {
            turnState.moveMode.set(mode);
            turnState.moveDistance.set(mode === 'stationary' ? null : turnState.minDistanceCurrentMoveMode());
            if (mode === 'sprint') {
                turnState.spotting.set(false);
                unit.clearInventoryControlSelection();
            }
        }
        turnState.applyMovePSR.set(true);
        turnState.markPhaseStateChanged();
    }

    toggleSpotting(): void {
        const unit = this.unit();
        if (!unit || !this.canSpot()) return;
        const turnState = unit.turnState();
        turnState.spotting.set(!turnState.spotting());
    }

    selectCover(cover: UnitCover): void {
        const turnState = this.unit()?.turnState();
        if (!turnState) return;
        turnState.setCover(turnState.cover() === cover ? undefined : cover);
    }

    selectWaterDepth(value: string): void {
        if (!isUnitWaterDepth(value)) return;
        this.selectCover(value);
    }

    selectBuildingLevel(value: string): void {
        if (!isUnitBuildingLevel(value)) return;
        this.selectCover(value);
    }

    async handleEquipmentTrackChoice(row: EquipmentTrackControlRow, choice: HandlerChoice): Promise<void> {
        if (choice.disabled) return;
        await this.equipmentRegistry.handleSelection(row.entry, choice, this.commandContext());
        this.unit()?.inventoryControl.markInventoryViewChanged();
    }

    readonly overDistance = computed<boolean>(() => {
        const unit = this.unit();
        if (!unit) return false;
        const turnState = unit.turnState();
        turnState.airborne();
        turnState.moveMode();
        const moveDistance = this.moveDistance();
        const minDistance = turnState.minDistanceCurrentMoveMode();
        const maxDistance = turnState.maxDistanceCurrentMoveMode();
        if (moveDistance === null) return false;
        return moveDistance < minDistance || moveDistance > maxDistance;
    });

    readonly moveDistance = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().moveDistance() || 0;
    });

    readonly moveMax = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        const baseUnit = unit.getUnit();
        if (!baseUnit) return 0;
        const mode = unit.turnState().moveMode();
        if (!mode) return 0;
        return unit.turnState().maxDistanceCurrentMoveMode();
    });

    readonly moveCapacity = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        const mode = unit.turnState().moveMode();
        if (!mode) return 0;
        return unit.turnState().movementCapacityCurrentMoveMode();
    });

    readonly moveMin = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        const mode = unit.turnState().moveMode();
        if (!mode) return 0;
        return Math.min(unit.turnState().minDistanceCurrentMoveMode(), this.moveMax());
    });

    readonly moveDistanceTicks = computed(() => {
        const max = this.moveCapacity();
        const length = Math.max(0, max + 1);
        return Array.from({ length }, (_value, index) => index);
    });

    readonly hasMoveDistance = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().moveDistance() !== null;
    });

    setMoveDistance(value: number, markModified = true): void {
        const unit = this.unit();
        if (!unit) return;
        const min = this.moveMin();
        const max = this.moveMax();
        unit.turnState().setMoveDistance(Math.max(min, Math.min(max, value)), { markModified });
    }

    commitMoveDistance(value: number): void {
        const unit = this.unit();
        if (!unit) return;
        this.setMoveDistance(value, false);
        unit.turnState().markModified();
        unit.turnState().markPhaseStateChanged();
    }

    private buildModifierTooltip(title: string, entries: UnitModifierBreakdownEntry[]): TooltipLine[] {
        const total = calculateModifierTotal(entries);
        const modifierLines = orderedModifierTooltipLines(entries, entry => this.formatModifierTotal(entry));
        return [
            { value: title, isHeader: true },
            ...(entries.length > 0
                ? modifierLines
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
