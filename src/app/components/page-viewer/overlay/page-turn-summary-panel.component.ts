// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, Injector, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay } from '@angular/cdk/overlay';

import { canChangeAirborneGround, getMotiveModeLabel, type MotiveModeOption, type MotiveModes } from '../../../models/motiveModes.model';
import {
    calculateModifierTotal,
    type UnitModifierBreakdownEntry,
    type UnitModifierTotal,
} from '../../../models/combat-modifier';
import {
    isCBTMekForceMember,
    type CBTForceMember,
} from '../../../models/force-member.model';
import type { MekEquipmentChoice } from '../../../models/cbt-force.model';
import {
    isUnitBuildingLevel,
    isUnitWaterDepth,
    type UnitCover,
} from '../../../models/unit-cover.model';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import type { TooltipLine } from '../../tooltip/tooltip.component';
import { HexSliderComponent } from '../../hex-slider/hex-slider.component';
import { CoverLevelPickerComponent } from '../../cover-level-picker/cover-level-picker.component';
import { orderedModifierTooltipLines } from '../../../utils/hit-target-tooltip.util';
import { togglePsrWarningOverlay } from './page-psr-warning-panel.component';
import { toggleStandingUpOverlay } from './page-standing-up-panel.component';
import { MekTurnSummaryRuntimeController } from './mek-turn-summary-runtime.controller';
import { isMekTurnPanelDirty } from '../../../models/runtime/mek-turn-panel';
import type { MekMovementModeV2 } from '../../../models/runtime/mek-movement-psr-v2';
import {
    hasPendingNonMekChanges,
    projectNonMekMovementCapabilities,
    supportsNonMekAirborneSelection,
    type NonMekMovementDeclaration,
} from '../../../models/runtime/non-mek-unit-instance';
import {
    getDefaultAttackerMovementModifier,
    getTargetMovementDistanceModifier,
    getTargetUnitTypeModifier,
} from '../../../models/target-number-calculator.model';
import {
    composeMekPsrDisplayModifiers,
    composeMekTurnSummaryHeatRows,
} from './page-turn-summary.util';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { projectAeroRuntimeRules } from '../../../models/rules/aero-runtime-rules';
import { hasNonMekRuntime } from '../../../models/cbt-unit-snapshot';

/** Original turn-tracker presentation backed only by the canonical Mek runtime. */
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
    private readonly toastService = inject(ToastService);
    private readonly options = inject(OptionsService);
    private readonly destroyRef = inject(DestroyRef);

    readonly member = input<CBTForceMember | null>(null);
    readonly endTurnForAllButtonVisible = input(false);
    readonly endTurnForAllClicked = output<void>();
    readonly renderReady = signal(false);

    private controller: MekTurnSummaryRuntimeController | null = null;
    private readonly entityRuntimeVersion = signal(0);
    private readonly entityMovementDistancePreview = signal<Readonly<{
        mode: MotiveModes;
        value: number;
    }> | null>(null);

    constructor() {
        afterNextRender(() => this.renderReady.set(true));
        effect(onCleanup => {
            const member = this.member();
            if (!member || isCBTMekForceMember(member)) return;
            const subscription = member.force.changed.subscribe(() => {
                this.entityMovementDistancePreview.set(null);
                this.entityRuntimeVersion.update(value => value + 1);
            });
            onCleanup(() => subscription.unsubscribe());
        });
    }

    runtime(): MekTurnSummaryRuntimeController | null {
        const member = this.member();
        if (!isCBTMekForceMember(member)) return null;
        if (!this.controller || this.controller.member !== member) {
            this.controller = new MekTurnSummaryRuntimeController(
                member,
                this.options,
                this.toastService,
                this.destroyRef,
            );
        }
        return this.controller;
    }

    readonly entitySnapshot = computed(() => {
        this.entityRuntimeVersion();
        const member = this.member();
        if (!member || isCBTMekForceMember(member)) return null;
        const snapshot = member.force.getUnitSnapshot(member.id);
        return snapshot && hasNonMekRuntime(snapshot) ? snapshot : null;
    });
    private readonly entityMovementCapabilities = computed(() => {
        const snapshot = this.entitySnapshot();
        return snapshot
            ? projectNonMekMovementCapabilities(
                snapshot.entity,
                snapshot.index,
                snapshot.state,
                snapshot.ruleset,
            )
            : null;
    });

    readonly dirty = computed(() => {
        const runtime = this.runtime();
        if (runtime) return isMekTurnPanelDirty(runtime.snapshot());
        const snapshot = this.entitySnapshot();
        const state = snapshot?.state;
        const member = this.member();
        return state !== undefined && (
            hasPendingNonMekChanges(state)
            || state.turn.airborne !== null
            || state.turn.movement !== null
            || member?.force.hasRuntimeHistoryForUnitTurn(
                member.id,
                state.turn.turnCounter + 1,
            ) === true
        );
    });

    readonly damageReceived = computed(() => {
        const runtime = this.runtime();
        if (runtime) return runtime.snapshot().movementState.damageThisPhase;
        const pending = this.entitySnapshot()?.state.pendingCombat;
        return pending
            ? [...pending.locationInternalDamage.values(), ...pending.armorDamage.values()]
                .reduce((total, amount) => total + Math.max(0, amount), 0)
            : 0;
    });
    readonly hasPSRChecks = computed(() => (this.runtime()?.pendingChecks().length ?? 0) > 0);
    readonly falling = computed(() =>
        (this.runtime()?.snapshot().movementState.automaticFalls.length ?? 0) > 0);
    readonly PSRChecksCount = computed(() => this.runtime()?.pendingChecks().length ?? 0);
    readonly controlRollShortLabel = computed(() => 'PSR');
    readonly controlRollFullLabel = computed(() => 'Piloting Skill Rolls');
    readonly currentMoveMode = computed(() => this.runtime()?.currentMovement()?.mode
        ?? this.entitySnapshot()?.state.turn.movement?.mode
        ?? null);
    readonly prone = computed(() => this.runtime()?.snapshot().conditions.includes('prone') ?? false);
    readonly immobile = computed(() => {
        const movement = this.runtime()?.snapshot().movement;
        if (movement?.kind === 'supported') return movement.immobile;
        return this.entityMovementCapabilities()?.immobile ?? false;
    });
    readonly showImmobileStatus = computed(() => {
        const movement = this.runtime()?.snapshot().movement;
        if (movement?.kind === 'supported') {
            return movement.rulesFlavor === 'core-2026' && movement.immobile;
        }
        const snapshot = this.entitySnapshot();
        return snapshot?.ruleset === 'core-2026' && this.immobile();
    });
    readonly showMovementControls = computed(() =>
        !this.showImmobileStatus() || this.currentMoveMode() !== null);
    readonly canStandUp = computed(() => this.runtime()?.unitActions()
        .some(action => action.kind === 'get-up' && action.legal) ?? false);
    readonly standing = computed(() => {
        const movement = this.runtime()?.snapshot().movement;
        return movement?.kind === 'supported' ? movement.standing : null;
    });
    readonly standUpRequiresPSR = computed(() => this.standing()?.requiresPilotCheck ?? false);
    readonly standAttempts = computed(() => this.standing()?.attempts ?? 0);
    readonly standAttemptMovementPointsSpent = computed(() =>
        this.standing()?.movementPointsSpent ?? 0);

    private readonly entityDefenseModifierBreakdown = computed<readonly UnitModifierBreakdownEntry[]>(() => {
        const snapshot = this.entitySnapshot();
        if (!snapshot) return [];
        const entries: UnitModifierBreakdownEntry[] = [];
        const movement = snapshot.state.turn.movement;
        if (movement && movement.mode !== 'stationary') {
            entries.push({
                label: `Moved ${movement.distance} hexes`,
                modifier: getTargetMovementDistanceModifier(movement.distance),
            });
        }
        if (snapshot.entity.entityType === 'BattleArmor') {
            entries.push({
                label: 'Battle Armor',
                modifier: getTargetUnitTypeModifier('battle-armor'),
            });
        }
        return Object.freeze(entries);
    });

    readonly getTotalTargetModifierAsDefender = computed(() => {
        const runtime = this.runtime();
        if (runtime) return this.formatModifierTotal(runtime.snapshot().defenseModifierTotal);
        return this.formatModifierTotal(calculateModifierTotal(this.entityDefenseModifierBreakdown()));
    });

    readonly defenseTargetModifierTooltip = computed<TooltipLine[] | null>(() => {
        const snapshot = this.runtime()?.snapshot();
        if (snapshot) {
            return this.buildModifierTooltip(
                'Defense Target Modifier',
                snapshot.defenseModifierBreakdown,
                snapshot.defenseModifierTotal,
            );
        }
        return this.entitySnapshot()
            ? this.buildModifierTooltip(
                'Defense Target Modifier',
                this.entityDefenseModifierBreakdown(),
                calculateModifierTotal(this.entityDefenseModifierBreakdown()),
            )
            : null;
    });

    readonly spotting = computed(() => this.runtime()?.snapshot().turn.spotting ?? false);
    readonly cover = computed(() => this.runtime()?.snapshot().turn.cover ?? null);
    readonly waterDepth = computed(() => {
        const cover = this.cover();
        return isUnitWaterDepth(cover) ? cover : '';
    });
    readonly buildingLevel = computed(() => {
        const cover = this.cover();
        return isUnitBuildingLevel(cover) ? cover : '';
    });
    readonly coverModifierLabel = computed(() => {
        const runtime = this.runtime();
        const cover = this.cover();
        if (!runtime) return null;
        if (cover === 'light' || runtime.snapshot().cover.partiallyUnderwater) return '+1';
        if (cover === 'heavy') return '+2';
        const modifier = runtime.snapshot().cover.building.modifier;
        return modifier === 0 ? null : `+${modifier}`;
    });
    readonly spottingModifierLabel = computed(() => {
        const modifier = this.runtime()?.snapshot().spottingModifier ?? 0;
        return modifier === 0 ? null : this.formatModifier(modifier);
    });

    readonly entityHeatSummary = computed(() => {
        const snapshot = this.entitySnapshot();
        if (!snapshot || !isAeroEntity(snapshot.entity) || !snapshot.entity.tracksHeat()) return null;
        const heat = projectAeroRuntimeRules(
            snapshot.entity,
            snapshot.index,
            snapshot.state,
            snapshot.ruleset,
        ).heat;
        return heat.tracked ? heat : null;
    });
    readonly tracksHeat = computed(() =>
        this.runtime()?.snapshot().heatProjection.kind === 'supported'
        || this.entityHeatSummary() !== null);
    readonly heatRows = computed(() => {
        const runtime = this.runtime();
        const projection = runtime?.snapshot().heatProjection;
        return projection?.kind === 'supported'
            ? composeMekTurnSummaryHeatRows(
                projection.projection.sources,
                runtime?.selectedWeaponsHeat() ?? null,
                projection.projection.underwaterBonus,
            )
            : [];
    });

    readonly psrModifiers = computed(() => {
        const snapshot = this.runtime()?.snapshot();
        const permanent = snapshot?.movement.kind === 'supported'
            ? snapshot.movement.permanentPsrModifiers
            : [];
        return composeMekPsrDisplayModifiers(permanent, snapshot?.movementState.checks ?? []);
    });

    readonly airborne = computed(() => this.runtime()?.snapshot().turn.airborne
        ?? this.entitySnapshot()?.state.turn.airborne
        ?? null);
    readonly canSwitchAirborneMode = computed(() => {
        const entity = this.entitySnapshot()?.entity;
        if (entity) return supportsNonMekAirborneSelection(entity);
        const member = this.member();
        return this.runtime() !== null && member !== null
            ? canChangeAirborneGround(member.summary)
            : false;
    });

    readonly moveModes = computed<MotiveModeOption[]>(() => {
        const runtime = this.runtime();
        if (runtime) return runtime.movementActions().map(action => ({
            mode: action.kind as MotiveModes,
            label: action.kind === 'UMU'
                ? 'UMU'
                : action.kind.charAt(0).toUpperCase() + action.kind.slice(1),
            psr: action.requiresPilotCheck === true,
        }));
        const snapshot = this.entitySnapshot();
        const member = this.member();
        if (!snapshot || !member) return [];
        const modes: MotiveModes[] = ['stationary', 'walk', 'run', 'jump', 'UMU'];
        return modes.flatMap(mode => mode === 'stationary'
            || this.entityMovementMaximum(mode) > 0
            ? [{
                mode,
                label: getMotiveModeLabel(mode, member.summary, snapshot.state.turn.airborne === true),
            }]
            : []);
    });

    readonly overDistance = computed(() => {
        const runtime = this.runtime();
        const movement = runtime?.currentMovement();
        if (runtime && movement) {
            return movement.distance < runtime.movementMinimum(movement.mode)
                || movement.distance > runtime.movementMaximum(movement.mode);
        }
        const entityMovement = this.entitySnapshot()?.state.turn.movement;
        return entityMovement !== null && entityMovement !== undefined
            && (entityMovement.distance < this.entityMovementMinimum(entityMovement.mode)
                || entityMovement.distance > this.entityMovementMaximum(entityMovement.mode));
    });

    readonly moveDistance = computed(() => {
        const runtime = this.runtime();
        if (runtime) return runtime.movementDistance();
        const movement = this.entitySnapshot()?.state.turn.movement;
        const preview = this.entityMovementDistancePreview();
        return movement && preview?.mode === movement.mode ? preview.value : movement?.distance ?? 0;
    });
    readonly moveCapacity = computed(() => {
        const runtime = this.runtime();
        const runtimeMode = runtime?.currentMovement()?.mode;
        if (runtime && runtimeMode) return runtime.movementCapacity(runtimeMode);
        const entityMode = this.entitySnapshot()?.state.turn.movement?.mode;
        return entityMode ? this.entityMovementMaximum(entityMode) : 0;
    });
    readonly moveMax = computed(() => {
        const runtime = this.runtime();
        const runtimeMode = runtime?.currentMovement()?.mode;
        if (runtime && runtimeMode) return runtime.movementMaximum(runtimeMode);
        const entityMode = this.entitySnapshot()?.state.turn.movement?.mode;
        return entityMode ? this.entityMovementMaximum(entityMode) : 0;
    });
    readonly moveMin = computed(() => {
        const runtime = this.runtime();
        const runtimeMode = runtime?.currentMovement()?.mode;
        if (runtime && runtimeMode) return runtime.movementMinimum(runtimeMode);
        const entityMode = this.entitySnapshot()?.state.turn.movement?.mode;
        return entityMode ? this.entityMovementMinimum(entityMode) : 0;
    });
    readonly moveDistanceTicks = computed(() =>
        Array.from({ length: Math.max(0, this.moveCapacity() + 1) }, (_value, index) => index));
    readonly hasMoveDistance = computed(() => {
        const runtime = this.runtime();
        return runtime
            ? runtime.currentMovement() !== null
            : this.entitySnapshot()?.state.turn.movement !== null
                && this.entitySnapshot()?.state.turn.movement !== undefined;
    });
    readonly onlyStationaryMoveMode = computed(() => {
        const modes = this.moveModes();
        return modes.length === 1 && modes[0]?.mode === 'stationary';
    });
    readonly equipmentTrackControlRows = computed(() =>
        this.runtime()?.equipmentTrackControlRows() ?? []);

    moveModeModifierLabel(mode: MotiveModes): string | null {
        const runtime = this.runtime();
        const modifier = runtime
            ? runtime.snapshot().attackMovementModifiers[mode as MekMovementModeV2] ?? 0
            : getDefaultAttackerMovementModifier(mode);
        return modifier === 0 ? null : this.formatModifier(modifier);
    }

    setAirborne(airborne: boolean): void {
        const runtime = this.runtime();
        if (runtime) {
            void runtime.setAirborne(runtime.snapshot().turn.airborne === airborne ? null : airborne);
            return;
        }
        const snapshot = this.entitySnapshot();
        if (snapshot) void this.dispatchEntity({
            kind: 'set-airborne',
            airborne: snapshot.state.turn.airborne === airborne ? null : airborne,
        });
    }

    selectMove(mode: MotiveModes): void {
        const runtime = this.runtime();
        const action = runtime?.movementActions().find(candidate => candidate.kind === mode);
        if (runtime && action) {
            void runtime.selectMovement(action);
            return;
        }
        const snapshot = this.entitySnapshot();
        if (!snapshot || !this.moveModes().some(candidate => candidate.mode === mode)) return;
        this.entityMovementDistancePreview.set(null);
        void this.dispatchEntity({
            kind: 'set-movement',
            movement: snapshot.state.turn.movement?.mode === mode
                ? null
                : {
                    mode,
                    distance: this.entityMovementMinimum(mode),
                    boosterComponentIds: [],
                },
        });
    }

    isMoveModeDisabled(mode: MotiveModes): boolean {
        if (mode === 'VTOL') return true;
        if (this.currentMoveMode() === mode) return false;
        const runtime = this.runtime();
        return runtime
            ? runtime.movementAction(mode)?.legal !== true
            : !this.moveModes().some(candidate => candidate.mode === mode);
    }

    async standUp(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const runtime = this.runtime();
        const action = runtime?.unitActions().find(candidate => candidate.kind === 'get-up');
        if (!runtime || !action?.legal) return;
        if (!await runtime.prepareStand()) return;
        const movement = runtime.snapshot().movement;
        if (movement.kind === 'supported' && !movement.standing.requiresPilotCheck) {
            await runtime.resolveStandOutcome(false, 'success');
            return;
        }
        const member = this.member();
        if (isCBTMekForceMember(member)) {
            toggleStandingUpOverlay(member, this.overlayManager, this.injector, this.overlay);
        }
    }

    reviewStandAttempts(event: MouseEvent): void {
        event.stopPropagation();
        if (this.standAttempts() === 0) return;
        const member = this.member();
        if (isCBTMekForceMember(member)) {
            toggleStandingUpOverlay(member, this.overlayManager, this.injector, this.overlay, true);
        }
    }

    toggleSpotting(): void {
        const runtime = this.runtime();
        if (runtime) void runtime.toggleSpotting();
    }

    selectCover(cover: UnitCover): void {
        const runtime = this.runtime();
        if (runtime) void runtime.selectCover(cover);
    }

    selectWaterDepth(value: string): void {
        if (isUnitWaterDepth(value)) this.selectCover(value);
    }

    selectBuildingLevel(value: string): void {
        if (isUnitBuildingLevel(value)) this.selectCover(value);
    }

    handleEquipmentTrackChoice(choice: MekEquipmentChoice): void {
        const runtime = this.runtime();
        if (runtime) void runtime.selectEquipmentTrackChoice(choice);
    }

    setMoveDistance(value: number, _markModified = true): void {
        const runtime = this.runtime();
        if (runtime) {
            runtime.previewMovementDistance(value);
            return;
        }
        const movement = this.entitySnapshot()?.state.turn.movement;
        if (!movement || !Number.isFinite(value)) return;
        const minimum = this.entityMovementMinimum(movement.mode);
        this.entityMovementDistancePreview.set(Object.freeze({
            mode: movement.mode,
            value: Math.max(
                minimum,
                Math.min(this.entityMovementMaximum(movement.mode), Math.round(value)),
            ),
        }));
    }

    commitMoveDistance(value: number): void {
        const runtime = this.runtime();
        if (runtime) {
            void runtime.setMovementDistance(value);
            return;
        }
        const snapshot = this.entitySnapshot();
        const movement = snapshot?.state.turn.movement;
        if (!snapshot || !movement || !Number.isSafeInteger(value)) return;
        const minimum = this.entityMovementMinimum(movement.mode);
        const maximum = this.entityMovementMaximum(movement.mode);
        const distance = Math.max(minimum, Math.min(maximum, value));
        const capabilities = this.entityMovementCapabilities();
        const boosters = movement.mode === 'run'
            && capabilities !== null
            && distance > capabilities.ordinaryRun
            ? capabilities.boosterComponentIds
            : [];
        this.entityMovementDistancePreview.set(null);
        void this.dispatchEntity({
            kind: 'set-movement',
            movement: { ...movement, distance, boosterComponentIds: boosters },
        });
    }

    endTurnForAll(event: MouseEvent): void {
        event.stopPropagation();
        this.endTurnForAllClicked.emit();
    }

    endTurn(): void {
        const runtime = this.runtime();
        if (runtime) {
            void runtime.boundary('end-turn');
            return;
        }
        if (this.entitySnapshot()) void this.dispatchEntity({ kind: 'end-turn' });
    }

    openPsrWarning(event: MouseEvent): void {
        event.stopPropagation();
        const member = this.member();
        togglePsrWarningOverlay(
            isCBTMekForceMember(member) ? member : null,
            this.overlayManager,
            this.injector,
            this.overlay,
        );
    }

    close(): void {
        this.overlayManager.closeManagedOverlay(`turnSummary-${this.member()?.id}`);
    }

    private entityMovementMaximum(mode: MotiveModes): number {
        return this.entityMovementCapabilities()?.maximum[mode] ?? 0;
    }

    private entityMovementMinimum(mode: MotiveModes): number {
        return this.entityMovementCapabilities()?.minimum[mode] ?? 0;
    }

    private async dispatchEntity(
        command: Readonly<{
            readonly kind: 'set-airborne';
            readonly airborne: boolean | null;
        }> | Readonly<{
            readonly kind: 'set-movement';
            readonly movement: NonMekMovementDeclaration | null;
        }> | Readonly<{
            readonly kind: 'end-turn';
        }>,
    ): Promise<void> {
        const member = this.member();
        const snapshot = this.entitySnapshot();
        if (!member || !snapshot) return;
        try {
            const result = await member.force.dispatchNonMekUnitCommand(member.id, {
                ...command,
                expectedRevision: snapshot.state.stateRevision,
            });
            if (!result.accepted) {
                this.toastService.showToast(`Turn action rejected: ${result.reason}`, 'error');
            }
        } catch (error) {
            this.toastService.showToast(
                `Turn action failed: ${error instanceof Error ? error.message : 'unexpected error'}`,
                'error',
            );
        }
    }

    private buildModifierTooltip(
        title: string,
        entries: readonly UnitModifierBreakdownEntry[],
        total: UnitModifierTotal,
    ): TooltipLine[] {
        return [
            { value: title, isHeader: true },
            ...(entries.length > 0
                ? orderedModifierTooltipLines(entries, entry => this.formatModifierTotal(entry))
                : [{ label: 'No active modifiers', value: '+0' }]),
            { isBreak: true },
            { label: 'Total', value: this.formatModifierTotal(total) },
        ];
    }

    private formatModifierTotal(total: UnitModifierTotal): string {
        const value = this.formatModifier(total.modifier);
        const label = total.alternateModifierLabel ? ` ${total.alternateModifierLabel}` : '';
        return total.alternateModifier !== undefined && total.alternateModifier !== total.modifier
            ? `${value} (${this.formatModifier(total.alternateModifier)}${label})`
            : value;
    }

    private formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }
}
