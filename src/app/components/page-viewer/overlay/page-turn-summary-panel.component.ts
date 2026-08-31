// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, Injector, input, output, signal } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';

import {
    canChangeAirborneGround,
    getMotiveModeLabel,
    getMotiveModesOptionsByUnit,
    motiveModeFactsForEntity,
    type MotiveModeOption,
    type MotiveModes,
} from '../../../models/motiveModes.model';
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
    resolveUnitBuildingCoverState,
    resolveUnitWaterState,
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
import {
    MekTurnSummaryRuntimeController,
    visibleEscalatingFailureSteps,
    type MekEscalatingFailureControlRow,
} from './mek-turn-summary-runtime.controller';
import { isMekTurnPanelDirty } from '../../../models/runtime/mek-turn-panel';
import type { MekMovementModeV2 } from '../../../models/runtime/mek-movement-psr-v2';
import {
    hasPendingNonMekChanges,
    nonMekAttackMovementModifier,
    projectNonMekControlRoll,
    projectNonMekDefenseModifierBreakdown,
    projectNonMekEndTurnHeat,
    projectNonMekEscalatingFailureInteractions,
    projectNonMekMovementCapabilities,
    supportsNonMekAirborneSelection,
    type NonMekMovementDeclaration,
    type NonMekUnitCommand,
} from '../../../models/runtime/non-mek-unit-instance';
import {
    composeMekPsrDisplayModifiers,
    composeTurnSummaryHeatRows,
} from './page-turn-summary.util';
import { hasNonMekRuntime } from '../../../models/cbt-unit-snapshot';
import { selectedWeaponHeat } from '../../../models/runtime/equipment-panel';
import type { EquipmentInteractionChoice } from '../../../models/runtime/equipment-interaction';
import { ESCALATING_FAILURE_DISABLED_CHOICE_VALUE } from '../../../models/runtime/component-escalating-failure';
import type { ComponentId } from '../../../models/entity/entity-identifiers';

interface NonMekEquipmentTrackChoice extends Omit<EquipmentInteractionChoice, 'active' | 'disabled'> {
    readonly token: string;
    readonly active: boolean;
    readonly disabled: boolean;
}

interface NonMekEquipmentTrackControlRow {
    readonly componentId: ComponentId;
    readonly label: string;
    readonly damaged: boolean;
    readonly active: boolean;
    readonly sequenceChoices: readonly NonMekEquipmentTrackChoice[];
    readonly statusChoice?: NonMekEquipmentTrackChoice;
}

type EquipmentTrackControlRow = MekEscalatingFailureControlRow | NonMekEquipmentTrackControlRow;
type EquipmentTrackChoice = MekEquipmentChoice | NonMekEquipmentTrackChoice;
type NonMekEscalatingFailureEdit = Extract<
    NonMekUnitCommand,
    { readonly kind: 'edit-escalating-failure' }
>['edit'];

/** Original turn-tracker presentation backed only by the canonical Mek runtime. */
@Component({
    selector: 'page-turn-summary-panel',
    imports: [HexSliderComponent, TooltipDirective, CoverLevelPickerComponent],
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
    readonly embedded = input(false);
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
            || state.turn.cover !== null
            || state.turn.spotting
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
    private readonly entityControlRoll = computed(() => {
        const snapshot = this.entitySnapshot();
        return snapshot
            ? projectNonMekControlRoll(
                snapshot.entity,
                snapshot.index,
                snapshot.state,
                snapshot.ruleset,
            )
            : null;
    });
    readonly controlRollShortLabel = computed(() =>
        this.entityControlRoll()?.shortLabel ?? 'PSR');
    readonly controlRollFullLabel = computed(() =>
        this.entityControlRoll()?.fullLabel ?? 'Piloting Skill Rolls');
    readonly currentMoveMode = computed(() => this.runtime()?.currentMovement()?.mode
        ?? this.entitySnapshot()?.state.turn.movement?.mode
        ?? null);
    readonly prone = computed(() => this.runtime()?.snapshot().conditions.includes('prone')
        ?? this.entitySnapshot()?.state.conditions.has('prone')
        ?? false);
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
        return snapshot
            ? projectNonMekDefenseModifierBreakdown(
                snapshot.entity,
                snapshot.index,
                snapshot.state,
                snapshot.ruleset,
            )
            : [];
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

    readonly spotting = computed(() => this.runtime()?.snapshot().turn.spotting
        ?? this.entitySnapshot()?.state.turn.spotting
        ?? false);
    readonly cover = computed(() => this.runtime()?.snapshot().turn.cover
        ?? this.entitySnapshot()?.state.turn.cover
        ?? null);
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
        const partiallyUnderwater = runtime?.snapshot().cover.partiallyUnderwater
            ?? resolveUnitWaterState(
                isUnitWaterDepth(cover) ? cover : undefined,
                1,
            ).partiallyUnderwater;
        if (cover === 'light' || partiallyUnderwater) return '+1';
        if (cover === 'heavy') return '+2';
        const modifier = runtime?.snapshot().cover.building.modifier
            ?? resolveUnitBuildingCoverState(
                isUnitBuildingLevel(cover) ? cover : undefined,
                1,
            ).modifier;
        return modifier === 0 ? null : `+${modifier}`;
    });
    readonly spottingModifierLabel = computed(() => {
        const modifier = this.runtime()?.snapshot().spottingModifier
            ?? (this.entitySnapshot() ? 1 : 0);
        return modifier === 0 ? null : this.formatModifier(modifier);
    });

    private readonly entityHeatProjection = computed(() => {
        const snapshot = this.entitySnapshot();
        return snapshot
            ? projectNonMekEndTurnHeat(
                snapshot.entity,
                snapshot.index,
                snapshot.state,
                snapshot.ruleset,
            )
            : null;
    });
    readonly tracksHeat = computed(() =>
        this.runtime()?.snapshot().heatProjection.kind === 'supported'
        || this.entityHeatProjection() !== null);
    readonly heatRows = computed(() => {
        const runtime = this.runtime();
        const projection = runtime?.snapshot().heatProjection;
        if (projection?.kind === 'supported') {
            return composeTurnSummaryHeatRows(
                projection.projection.sources,
                runtime?.selectedWeaponsHeat() ?? null,
                projection.projection.underwaterBonus,
            );
        }
        const entityProjection = this.entityHeatProjection();
        if (!entityProjection) return [];
        const member = this.member();
        const panel = member?.force.getEquipmentPanelSnapshot(member.id) ?? null;
        const selected = panel ? selectedWeaponHeat(panel) : null;
        return composeTurnSummaryHeatRows(
            entityProjection.sources.filter(source => source.id !== 'dissipation'),
            selected?.hasSelection ? selected.value : null,
            0,
        );
    });

    readonly psrModifiers = computed(() => {
        const snapshot = this.runtime()?.snapshot();
        if (!snapshot) return this.entityControlRoll()?.modifiers ?? [];
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
        const mekEntity = member?.force.getUnitSnapshot?.(member.id)?.entity;
        return this.runtime() !== null && mekEntity !== undefined
            ? canChangeAirborneGround(motiveModeFactsForEntity(mekEntity))
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
        if (!snapshot) return [];
        const facts = motiveModeFactsForEntity(snapshot.entity);
        const airborne = snapshot.state.turn.airborne === true;
        const supported = getMotiveModesOptionsByUnit(facts, airborne);
        for (const mode of ['jump', 'UMU'] satisfies MotiveModes[]) {
            if ((mode !== 'jump' || !airborne)
                && !supported.some(option => option.mode === mode)
                && this.entityMovementMaximum(mode) > 0) {
                supported.push({ mode, label: getMotiveModeLabel(mode, facts, airborne) });
            }
        }
        const available = supported.filter(option => option.mode === 'stationary'
            || this.entityMovementMaximum(option.mode) > 0);
        const current = snapshot.state.turn.movement?.mode;
        if (!current || available.some(option => option.mode === current)) return available;
        const currentOption = supported.find(option => option.mode === current);
        if (!currentOption) return available;
        const visible = new Map(available.map(option => [option.mode, option]));
        visible.set(current, currentOption);
        return supported.flatMap(option => {
            const candidate = visible.get(option.mode);
            return candidate ? [candidate] : [];
        });
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
    readonly canSpot = computed(() => {
        const runtime = this.runtime();
        if (runtime) {
            return runtime.snapshot().canTakeActiveActions
                && runtime.currentMovement()?.mode !== 'sprint';
        }
        return this.entityMovementCapabilities()?.canTakeActiveActions === true
            && this.entitySnapshot()?.state.turn.movement?.mode !== 'sprint';
    });
    readonly equipmentTrackControlRows = computed<readonly EquipmentTrackControlRow[]>(() => {
        const runtime = this.runtime();
        if (runtime) return runtime.equipmentTrackControlRows();
        const snapshot = this.entitySnapshot();
        if (!snapshot) return Object.freeze([]);
        return Object.freeze(projectNonMekEscalatingFailureInteractions(
            snapshot.entity,
            snapshot.index,
            snapshot.state,
            snapshot.ruleset,
            'turn-summary',
        ).map(interaction => {
            const choices = interaction.choices.map((choice, choiceIndex) => Object.freeze({
                ...choice,
                token: `${interaction.componentId}\u0000${choiceIndex}`,
                active: choice.active ?? false,
                disabled: choice.disabled ?? false,
            } satisfies NonMekEquipmentTrackChoice));
            const sequenceChoices = choices.filter(choice => choice.failureTarget !== undefined);
            const statusChoice = choices.find(choice => choice.failureTarget === undefined);
            const active = sequenceChoices.some(choice =>
                choice.active && choice.selectionTone !== 'muted');
            return Object.freeze({
                componentId: interaction.componentId,
                label: interaction.componentLabel,
                damaged: interaction.status === 'destroyed',
                active,
                sequenceChoices: Object.freeze(visibleEscalatingFailureSteps(sequenceChoices)),
                ...(statusChoice === undefined ? {} : { statusChoice }),
            } satisfies NonMekEquipmentTrackControlRow);
        }).filter(row => (!row.damaged || row.active) && row.sequenceChoices.length > 0));
    });

    moveModeModifierLabel(mode: MotiveModes): string | null {
        const runtime = this.runtime();
        const modifier = runtime
            ? runtime.snapshot().attackMovementModifiers[mode as MekMovementModeV2] ?? 0
            : this.entitySnapshot()?.entity
                ? nonMekAttackMovementModifier(this.entitySnapshot()!.entity, mode)
                : 0;
        return modifier === 0 ? null : this.formatModifier(modifier);
    }

    moveModeAllowance(mode: MotiveModes): number {
        const runtime = this.runtime();
        return runtime
            ? runtime.movementMaximum(mode as MekMovementModeV2)
            : this.entityMovementMaximum(mode);
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
        if (this.isMoveModeDisabled(mode)) return;
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
        if (this.prone() && (mode === 'jump' || mode === 'sprint')) return true;
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
        if (!this.canSpot()) return;
        if (runtime) {
            void runtime.toggleSpotting();
            return;
        }
        const snapshot = this.entitySnapshot();
        if (snapshot) void this.dispatchEntity({
            kind: 'set-spotting',
            spotting: !snapshot.state.turn.spotting,
        });
    }

    selectCover(cover: UnitCover): void {
        const runtime = this.runtime();
        if (runtime) {
            void runtime.selectCover(cover);
            return;
        }
        const snapshot = this.entitySnapshot();
        if (snapshot) void this.dispatchEntity({
            kind: 'set-cover',
            cover: snapshot.state.turn.cover === cover ? null : cover,
        });
    }

    selectWaterDepth(value: string): void {
        if (isUnitWaterDepth(value)) this.selectCover(value);
    }

    selectBuildingLevel(value: string): void {
        if (isUnitBuildingLevel(value)) this.selectCover(value);
    }

    handleEquipmentTrackChoice(
        row: EquipmentTrackControlRow,
        choice: EquipmentTrackChoice,
    ): void {
        const runtime = this.runtime();
        if (runtime) {
            if (!('value' in choice)) void runtime.selectEquipmentTrackChoice(choice);
            return;
        }
        if (choice.disabled || !('value' in choice)) return;
        const edit: NonMekEscalatingFailureEdit = choice.value
            === ESCALATING_FAILURE_DISABLED_CHOICE_VALUE
            ? Object.freeze({
                kind: 'set-status',
                status: choice.active ? 'available' : 'disabled',
            })
            : Object.freeze({
                kind: 'select-sequence',
                index: Number(choice.value),
            });
        void this.dispatchEntity({
            kind: 'edit-escalating-failure',
            componentId: row.componentId as ComponentId,
            edit,
        });
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
            readonly kind: 'set-cover';
            readonly cover: UnitCover | null;
        }> | Readonly<{
            readonly kind: 'set-spotting';
            readonly spotting: boolean;
        }> | Readonly<{
            readonly kind: 'end-turn';
        }> | Readonly<{
            readonly kind: 'edit-escalating-failure';
            readonly componentId: ComponentId;
            readonly edit: NonMekEscalatingFailureEdit;
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
