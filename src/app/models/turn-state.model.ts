// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal, type WritableSignal } from "@angular/core";
import { canChangeAirborneGround, getMotiveModeMaxDistance, type MotiveModes } from "./motiveModes.model";
import type { CBTForceUnitState } from "./cbt-force-unit-state.model";
import type {
    PendingEventInput,
    RuleCheckOutcome,
    SerializedEndTurnCheckpoint,
    SerializedMekCriticalChanceResult,
    SerializedPendingEvent,
    SerializedPendingMekCriticalCaseII,
    SerializedPendingMekCritical,
    SerializedPendingMekCriticalChance,
    SerializedPendingMekFloatingCriticalLocation,
    SerializedPendingMekFall,
    SerializedPendingUnitCheck,
    SerializedPSRChecks,
    SerializedTurnState,
} from "./force-serialization";
import { calculateModifierTotal, type PSRCheck, type UnitHeatSource, type UnitModifierBreakdownEntry, type UnitModifierTotal } from "./rules/unit-type-rules";
import { deserializeUnitCover, isUnitBuildingLevel, isUnitWaterDepth, resolveUnitBuildingCoverState, resolveUnitWaterState, serializeUnitCover, type UnitCover } from "./unit-cover.model";
import {
    closePilotDamagePhase,
    closePilotDamageTurn,
    createPilotDamageGroup,
    isOpenCombatPilotDamageGroup,
} from "../utils/pilot-damage-group.util";
import {
    isAmmoExplosionCheck,
    isCascadeUnitCheck,
    isConsciousnessCheck,
    pendingUnitCheckOutcome,
    pendingUnitCheckList,
    pendingUnitCheckPriority,
    refreshPendingUnitCheck,
    type CascadeUnitCheck,
} from '../utils/unit-check.util';

export type { PSRCheck } from "./rules/unit-type-rules";

export interface PSRChecks {
    legActuators?: Map<string, number>;
    hipsHit?: Set<string>;
    gyroHit?: number;
    gyroDestroyed?: boolean;
    legsDestroyed?: Set<string>;
    shutdown?: boolean;
}

export interface HeatProjection {
    current: number;
    sourceHeat: number;
    dissipation: number;
    consumedDissipation: number;
    projected: number;
    delta: number;
}

export function calculateHeatProjection(current: number, sources: readonly UnitHeatSource[], dissipation: number): HeatProjection {
    const normalizedCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
    const sourceHeat = sources.reduce((total, source) => (
        total + (Number.isFinite(source.value) ? Math.max(0, source.value) : 0)
    ), 0);
    const normalizedDissipation = Number.isFinite(dissipation) ? Math.max(0, dissipation) : 0;
    const heatBeforeDissipation = normalizedCurrent + sourceHeat;
    const consumedDissipation = Math.min(normalizedDissipation, heatBeforeDissipation);
    const projected = heatBeforeDissipation - consumedDissipation;
    return {
        current: normalizedCurrent,
        sourceHeat,
        dissipation: normalizedDissipation,
        consumedDissipation,
        projected,
        delta: projected - normalizedCurrent,
    };
}

export class TurnState {
    private pilotDamageGroup = createPilotDamageGroup('combat');
    private static readonly HEAT_DISSIPATION_DEFICIT_SOURCE_ID = 'heat-dissipation-deficit';
    unitState: CBTForceUnitState;
    private suppressModified = false;
    private readonly passiveHeatSourceBaseline = signal('');
    private readonly acknowledgedHeatSources = this.modifiedSignal<Record<string, string>>({});
    private readonly heatDissipationConsumed = this.modifiedSignal<number>(0);
    private readonly psrOutcomes = this.modifiedSignal<Record<string, RuleCheckOutcome>>({});
    private readonly pendingEvents = this.modifiedSignal<readonly SerializedPendingEvent[]>([]);
    private readonly endTurnCheckpoint = this.modifiedSignal<SerializedEndTurnCheckpoint | undefined>(undefined);
    private readonly equipmentStateChanged = this.modifiedSignal<boolean>(false);
    /** Per-unit turn sequence, retained across phase commits. */
    private turnCounter: number;
    airborne = this.modifiedSignal<boolean | null>(null, 'movement');
    moveMode = this.modifiedSignal<MotiveModes | null>(null, 'movement');
    moveDistance = this.modifiedSignal<number | null>(null, 'movement');
    /** Movement mode used by rules; Core defaults an unassigned Immobile unit to stationary. */
    effectiveMoveMode = computed<MotiveModes | null>(() => {
        const selectedMoveMode = this.moveMode();
        if (selectedMoveMode !== null) return selectedMoveMode;
        const unit = this.unitState.unit;
        return unit.gameRules.id === 'core2026' && unit.getCondition('immobile')
            ? 'stationary'
            : null;
    });
    standAttempts = this.modifiedSignal<number | undefined>(undefined);
    carefulStand = this.modifiedSignal<boolean>(false);
    cover = this.modifiedSignal<UnitCover | undefined>(undefined);
    private readonly waterState = computed(() => {
        const cover = this.cover();
        return resolveUnitWaterState(
            isUnitWaterDepth(cover) ? cover : undefined,
            this.unitState.unit.getHeight(),
        );
    });
    readonly partiallyUnderwater = computed(() => this.waterState().partiallyUnderwater);
    readonly submerged = computed(() => this.waterState().submerged);
    readonly buildingCoverState = computed(() => {
        const cover = this.cover();
        return resolveUnitBuildingCoverState(
            isUnitBuildingLevel(cover) ? cover : undefined,
            this.unitState.unit.getHeight(),
        );
    });
    dmgReceived = this.modifiedSignal<number>(0);
    weaponsHeat = this.modifiedSignal<number>(0);
    private psrChecks = this.modifiedSignal<PSRChecks>({});
    applyMovePSR = this.modifiedSignal<boolean>(true);
    spotting = this.modifiedSignal<boolean>(false);

    dirty = computed<boolean>(() => {
        const heat = this.unitState.heat();
        const airborne = this.airborne();
        const moveMode = this.moveMode();
        const moveDistance = this.moveDistance();
        const standAttempts = this.standAttempts();
        const carefulStand = this.carefulStand();
        const cover = this.cover();
        const dmgReceived = this.dmgReceived();
        const weaponsHeat = this.weaponsHeat();
        const unconsolidatedCrits = this.unitState.hasUnconsolidatedCrits();
        const unconsolidatedLocations = this.unitState.hasUnconsolidatedLocations();
        const unconsolidatedInventory = this.unitState.hasUnconsolidatedInventory();
        return airborne !== null
            || moveMode !== null
            || moveDistance !== null
            || standAttempts !== undefined
            || carefulStand
            || cover !== undefined
            || dmgReceived != 0
            || weaponsHeat > 0
            || this.spotting()
            || this.hasPendingPSRChecks()
            || unconsolidatedCrits
            || unconsolidatedLocations
            || unconsolidatedInventory
            || this.equipmentStateChanged()
            || this.endTurnCheckpoint() !== undefined
            || this.passiveHeatSourceSignature() !== this.passiveHeatSourceBaseline()
            || Object.keys(this.acknowledgedHeatSources()).length > 0
            || this.heatDissipationConsumed() > 0
            || heat.next !== undefined;
    });

    dirtyPhase = computed<boolean>(() => {
        const dmgReceived = this.dmgReceived();
        const unconsolidatedCrits = this.unitState.hasUnconsolidatedCrits();
        const unconsolidatedLocations = this.unitState.hasUnconsolidatedLocations();
        const unconsolidatedInventory = this.unitState.hasUnconsolidatedInventory();
        return dmgReceived != 0
            || this.hasPendingPSRChecks()
            || unconsolidatedCrits
            || unconsolidatedLocations
            || unconsolidatedInventory
            || this.equipmentStateChanged();
    });

    autoFall = computed<boolean>(() => {
        return this.unitState.unit.rules.autoFall();
    });

    getPSRChecks = computed<PSRCheck[]>(() => {
        const occurrences = new Map<string, number>();
        return this.unitState.unit.rules.getPSRChecks(this).map(check => {
            const baseId = check.id ?? this.psrCheckBaseId(check);
            const occurrence = occurrences.get(baseId) ?? 0;
            occurrences.set(baseId, occurrence + 1);
            return {
                ...check,
                id: occurrence === 0 ? baseId : `${baseId}#${occurrence + 1}`,
                failureOutcome: check.failureOutcome ?? 'Fall',
            };
        });
    });

    canStandUp = computed<boolean>(() => {
        return this.unitState.unit.rules.canStandUp(this);
    });

    canStandWithoutPSR = computed<boolean>(() => {
        return this.unitState.unit.rules.canStandWithoutPSR(this);
    });

    getAttackMovementModifier = computed<number>(() => {
        return this.unitState.unit.rules.getAttackMovementModifier(this.effectiveMoveMode(), this.airborne() ?? false);
    });

    attackMovementModifierCanApply = computed<boolean>(() => {
        const unit = this.unitState.unit;
        const canChangeAirborne = canChangeAirborneGround(unit.getUnit());
        if (!canChangeAirborne) {
            return unit.getAvailableMotiveModes(false)
                .some(option => unit.rules.getAttackMovementModifier(option.mode, false) !== 0);
        }
        return unit.getAvailableMotiveModes(false)
            .some(option => unit.rules.getAttackMovementModifier(option.mode, false) !== 0) ||
            unit.getAvailableMotiveModes(true)
            .some(option => unit.rules.getAttackMovementModifier(option.mode, true) !== 0);
    });

    missingAttackMovementModifier = computed<boolean>(() => {
        return this.effectiveMoveMode() === null && this.attackMovementModifierCanApply();
    });

    getAttackModifierBreakdown = computed<UnitModifierBreakdownEntry[]>(() => {
        return this.unitState.unit.rules.getAttackModifierBreakdown(this);
    });

    getTotalTargetModifierAsDefender = computed<UnitModifierTotal>(() => {
        return calculateModifierTotal(this.getDefenseModifierBreakdown());
    });

    getDefenseModifierBreakdown = computed<UnitModifierBreakdownEntry[]>(() => {
        return this.unitState.unit.rules.getDefenseModifierBreakdown(this);
    });

    private unresolvedPSRChecks(): readonly PSRCheck[] {
        const outcomes = this.psrOutcomes();
        return this.getPSRChecks().filter(entry =>
            entry.fallCheck !== undefined && entry.id !== undefined && outcomes[entry.id] === undefined
        );
    }

    PSRRollsCount = computed<number>(() => this.unresolvedPSRChecks().length);

    actionablePSRRollsCount = computed<number>(() => {
        const checks = this.unresolvedPSRChecks()
            .filter(check => !this.isPSRCheckAutomaticFailure(check));
        return this.autoFall()
            ? checks.filter(check => check.failureOutcome !== 'Fall').length
            : checks.length;
    });

    automaticPSRFailure = computed<boolean>(() => {
        const unit = this.unitState.unit;
        if (unit.rules.getActivePilotCrewId() === null) return true;
        const checks = this.unresolvedPSRChecks();
        return checks.length > 0
            && checks.every(check => this.isPSRCheckAutomaticFailure(check));
    });

    isPSRCheckAutomaticFailure(check: PSRCheck): boolean {
        const unit = this.unitState.unit;
        return unit.rules.getActivePilotCrewId() === null
            || (unit.getUnit().type === 'Mek'
                && unit.getCondition('shutdown')
                && !unit.getCondition('prone')
                && check.kind !== 'shutdown');
    }

    getPSROutcome(checkId: string): RuleCheckOutcome | undefined {
        return this.psrOutcomes()[checkId];
    }

    resolvePSRCheck(checkId: string, outcome: RuleCheckOutcome): boolean {
        const check = this.getPSRChecks().find(entry => entry.id === checkId);
        if (!check || check.resolution || this.getPSROutcome(checkId)) return false;
        const resolvedChecks = outcome === 'failed'
            ? this.getPSRChecks().filter(entry =>
                !entry.resolution
                && entry.id !== undefined
                && entry.failureOutcome === check.failureOutcome
                && this.getPSROutcome(entry.id) === undefined
            )
            : [check];
        this.psrOutcomes.update(current => ({
            ...current,
            ...Object.fromEntries(resolvedChecks.map(entry => [entry.id!, outcome])),
        }));
        if (outcome === 'failed') {
            if (check.failureOutcome === 'Fall' && !this.unitState.hasCondition('prone')) {
                this.unitState.unit.queueFall('psr');
                this.unitState.unit.setCondition('prone', true);
            }
        }
        return true;
    }

    resolveStandAttempt(outcome: RuleCheckOutcome, options: { carefulStand?: boolean } = {}): boolean {
        const carefulStand = options.carefulStand === true;
        if (carefulStand && !this.unitState.unit.rules.canCarefulStand(this)) return false;
        if (!this.prepareStandAttempt()) return false;
        this.adjustStandAttempts(1);
        if (carefulStand) {
            this.carefulStand.set(true);
            this.clampMoveDistanceToCurrentModeRange();
        }
        if (outcome === 'success') {
            this.unitState.unit.setCondition('prone', false);
        } else {
            this.unitState.unit.queueFall('stand-attempt');
        }
        return true;
    }

    prepareStandAttempt(): boolean {
        if (!this.canStandUp()) return false;
        const standingMovementMode = this.unitState.unit.rules.getStandAttemptMovementMode(this);
        if (standingMovementMode !== null && standingMovementMode !== this.moveMode()) {
            this.moveMode.set(standingMovementMode);
            if (this.moveDistance() === null) this.moveDistance.set(0);
        }
        return true;
    }

    failPendingPSRChecks(): void {
        const unresolved = this.getPSRChecks().filter(check =>
            check.resolution || (check.id !== undefined && this.getPSROutcome(check.id) === undefined));
        for (const check of unresolved) {
            if (check.resolution) {
                this.unitState.unit.resolveRuleCheck(check.resolution.key, check.resolution.token, 'failed');
            } else if (check.id) {
                this.resolvePSRCheck(check.id, 'failed');
            }
        }
    }

    /** Applies an unavoidable fall before the phase is committed. */
    resolveAutomaticFall(): boolean {
        if (!this.autoFall() || this.unitState.hasCondition('prone')) return false;
        this.unitState.unit.queueFall('psr');
        this.unitState.unit.setCondition('prone', true);
        return true;
    }

    adjustStandAttempts(delta: number): void {
        if (!Number.isFinite(delta)) return;
        const normalizedDelta = Math.trunc(delta);
        const current = this.standAttempts() ?? 0;
        const next = Math.max(0, current + normalizedDelta);
        const removedCarefulStand = normalizedDelta < 0 && this.carefulStand();
        if (removedCarefulStand) this.carefulStand.set(false);
        if (next === current && !removedCarefulStand) return;
        this.standAttempts.set(next);
        this.clampMoveDistanceToCurrentModeRange();
        this.reconcileHeatSources();
    }

    resetStandAttempts(): void {
        this.standAttempts.set(0);
        this.carefulStand.set(false);
        this.clampMoveDistanceToCurrentModeRange();
        this.reconcileHeatSources();
    }

    setCover(cover: UnitCover | undefined): void {
        this.cover.set(cover);
        this.unitState.unit.applyUnderwaterBreachAndFlooding?.();
        this.unitState.unit.force?.units?.().forEach(unit => unit.inventoryControl.markInventoryViewChanged());
    }

    private psrCheckBaseId(check: PSRCheck): string {
        return [
            check.reason.replace(/\d+(?:\.\d+)?/g, '#'),
            check.loc ?? '',
            check.legFilter ?? '',
            check.fallCheck ?? '',
            check.pilotCheck ?? '',
            check.ignorePreExistingGyro ? 'ignore-gyro' : '',
        ].join('|');
    }

    currentPhase = computed<'I' | 'M' | 'W' | 'P' | 'H'>(() => {
        const moveMode = this.effectiveMoveMode();
        if (moveMode === null || (moveMode !== 'stationary' && this.moveDistance() === null)) {
            return 'M';
        } else {
            return 'W';
        }
    });

    private committedHeatSources = computed<UnitHeatSource[]>(() => {
        return this.unitState.unit.rules.heatSources(this);
    });

    private unresolvedHeatSources = computed<UnitHeatSource[]>(() => {
        if (this.unitState.unit.automationMode('heatAndDissipationResolution') === 'no') return this.committedHeatSources();
        const acknowledged = this.acknowledgedHeatSources();
        return this.committedHeatSources().filter(source => acknowledged[source.id] !== this.heatSourceSignature(source));
    });

    private heatDissipationCapacity = computed<number>(() => {
        const dissipation = this.unitState.unit.rules.heatDissipation();
        const capacity = dissipation?.totalDissipationWithWings ?? dissipation?.totalDissipation ?? 0;
        return Number.isFinite(capacity) ? Math.max(0, capacity) : 0;
    });

    heatDissipationBalance = computed<number>(() => {
        return this.heatDissipationCapacity() - this.heatDissipationConsumed();
    });

    effectiveHeatDissipation = computed<number>(() => {
        return Math.max(0, this.heatDissipationBalance());
    });

    private heatDissipationDeficit = computed<number>(() => {
        return Math.max(0, -this.heatDissipationBalance());
    });

    heatSources = computed<UnitHeatSource[]>(() => {
        const deficit = this.heatDissipationDeficit();
        return [
            ...this.unresolvedHeatSources(),
            ...(deficit > 0 ? [{
                id: TurnState.HEAT_DISSIPATION_DEFICIT_SOURCE_ID,
                label: 'Dissipation',
                value: deficit,
            }] : []),
        ];
    });

    heatProjection = computed<HeatProjection>(() => {
        return calculateHeatProjection(this.unitState.heat().current, this.heatSources(), this.effectiveHeatDissipation());
    });

    hasPendingHeatResolution = computed<boolean>(() => {
        return this.heatSources().some(source => source.value > 0)
            || this.heatProjection().projected !== this.unitState.heat().current;
    });

    heatProjectionVisible = computed<boolean>(() => this.hasPendingHeatResolution());

    constructor(unitState: CBTForceUnitState, turnCounter = 0) {
        this.unitState = unitState;
        this.turnCounter = turnCounter;
    }

    capturePassiveHeatSourceBaseline(): void {
        this.passiveHeatSourceBaseline.set(this.passiveHeatSourceSignature());
    }

    private passiveHeatSourceSignature(): string {
        return JSON.stringify(this.committedHeatSources()
            .filter(source => source.value > 0 && source.id !== 'movement' && source.id !== 'weapons')
            .map(source => [source.id, this.heatSourceSignature(source)])
            .sort(([left], [right]) => left.localeCompare(right)));
    }

    private modifiedSignal<T>(initialValue: T, affectedHeatSourceId?: string): WritableSignal<T> {
        const state = signal<T>(initialValue);
        const originalSet = state.set.bind(state);
        const originalUpdate = state.update.bind(state);
        state.set = (newValue: T) => {
            const previousValue = state();
            originalSet(newValue);
            this.markModifiedIfChanged(previousValue, newValue);
            if (affectedHeatSourceId && !Object.is(previousValue, newValue)) {
                this.invalidateHeatSource(affectedHeatSourceId);
            }
        };
        state.update = (updateFn: (value: T) => T) => {
            const previousValue = state();
            originalUpdate(updateFn);
            this.markModifiedIfChanged(previousValue, state());
            if (affectedHeatSourceId && !Object.is(previousValue, state())) {
                this.invalidateHeatSource(affectedHeatSourceId);
            }
        };
        return state;
    }

    private markModifiedIfChanged<T>(previousValue: T, nextValue: T): void {
        if (this.suppressModified || Object.is(previousValue, nextValue)) return;
        this.unitState.unit.setModified?.();
    }

    private withSuppressedModified(action: () => void): void {
        this.suppressModified = true;
        try {
            action();
        } finally {
            this.suppressModified = false;
        }
    }

    markModified(): void {
        if (this.suppressModified) return;
        this.unitState.unit.setModified?.();
    }

    setMoveDistance(value: number | null, options: { markModified?: boolean } = {}) {
        if (options.markModified === false) {
            this.withSuppressedModified(() => this.moveDistance.set(value));
            return;
        }
        this.moveDistance.set(value);
    }

    clampMoveDistanceToCurrentModeRange(): void {
        const moveDistance = this.moveDistance();
        if (moveDistance === null) return;
        const maxDistance = this.maxDistanceCurrentMoveMode();
        const minDistance = Math.min(this.minDistanceCurrentMoveMode(), maxDistance);
        const nextDistance = Math.max(minDistance, Math.min(maxDistance, moveDistance));
        if (nextDistance !== moveDistance) {
            this.setMoveDistance(nextDistance);
        }
    }

    serialize(): SerializedTurnState | undefined {
        const turnState: SerializedTurnState = {};
        const turnCounter = this.turnCounter;
        const airborne = this.airborne();
        const moveMode = this.moveMode();
        const moveDistance = this.moveDistance();
        const standAttempts = this.standAttempts();
        const carefulStand = this.carefulStand();
        const cover = this.cover();
        const psrChecks = this.serializePSRChecks();
        const endTurnCheckpoint = this.endTurnCheckpoint();

        if (turnCounter > 0) turnState.turnCounter = turnCounter;
        if (endTurnCheckpoint !== undefined) turnState.endTurnCheckpoint = endTurnCheckpoint;
        if (airborne === true) turnState.airborne = true;
        if (moveMode !== null) turnState.moveMode = moveMode;
        if (moveDistance !== null) turnState.moveDistance = moveDistance;
        if (standAttempts !== undefined) turnState.standAttempts = standAttempts;
        if (carefulStand && this.unitState.unit.rules.supportsCarefulStand) turnState.carefulStand = true;
        if (cover !== undefined) turnState.cover = serializeUnitCover(cover);
        if (this.dmgReceived() > 0) turnState.dmgReceived = this.dmgReceived();
        if (this.weaponsHeat() > 0) turnState.weaponsHeat = this.weaponsHeat();
        if (Object.keys(this.acknowledgedHeatSources()).length > 0) {
            turnState.acknowledgedHeatSources = { ...this.acknowledgedHeatSources() };
        }
        if (this.heatDissipationConsumed() > 0) {
            turnState.heatDissipationConsumed = this.heatDissipationConsumed();
        }
        if (Object.keys(this.psrOutcomes()).length > 0) {
            turnState.psrOutcomes = { ...this.psrOutcomes() };
        }
        if (psrChecks) turnState.psrChecks = psrChecks;
        if (this.pendingEvents().length > 0) {
            turnState.pendingEvents = this.pendingEvents().map(event => structuredClone(event));
        }
        if (!this.applyMovePSR()) turnState.applyMovePSR = false;
        if (this.spotting()) turnState.spotting = true;
        if (this.equipmentStateChanged()) turnState.equipmentStateChanged = true;

        return Object.keys(turnState).length > 0 ? turnState : undefined;
    }

    update(data: SerializedTurnState | undefined) {
        this.withSuppressedModified(() => {
            this.turnCounter = data?.turnCounter ?? this.turnCounter;
            this.endTurnCheckpoint.set(data?.endTurnCheckpoint);
            this.airborne.set(data?.airborne ?? null);
            this.moveMode.set(data?.moveMode ?? null);
            this.moveDistance.set(data?.moveDistance ?? null);
            this.standAttempts.set(data?.standAttempts);
            this.carefulStand.set(
                data?.carefulStand === true && this.unitState.unit.rules.supportsCarefulStand
            );
            this.cover.set(deserializeUnitCover(data?.cover));
            this.dmgReceived.set(data?.dmgReceived ?? 0);
            this.weaponsHeat.set(data?.weaponsHeat ?? 0);
            this.acknowledgedHeatSources.set({ ...(data?.acknowledgedHeatSources ?? {}) });
            this.heatDissipationConsumed.set(data?.heatDissipationConsumed ?? 0);
            this.psrOutcomes.set({ ...(data?.psrOutcomes ?? {}) });
            this.psrChecks.set(this.deserializePSRChecks(data?.psrChecks));
            this.pendingEvents.set((data?.pendingEvents ?? []).map(event => structuredClone(event)));
            this.applyMovePSR.set(data?.applyMovePSR ?? true);
            this.spotting.set(data?.spotting ?? false);
            this.equipmentStateChanged.set(data?.equipmentStateChanged ?? false);
        });
    }

    getTurnCounter(): number {
        return this.turnCounter;
    }

    getEndTurnCheckpoint(): SerializedEndTurnCheckpoint | undefined {
        return this.endTurnCheckpoint();
    }

    markEndTurnPhaseEnded(): void {
        if (this.endTurnCheckpoint() === undefined) this.endTurnCheckpoint.set('phase-ended');
    }

    markEndTurnHeatStaged(): void {
        this.endTurnCheckpoint.set('heat-staged');
    }

    markPhaseStateChanged(): void {
        this.equipmentStateChanged.set(true);
    }

    markEquipmentStateChanged(): void {
        this.markPhaseStateChanged();
    }

    commitEquipmentStateChanges(): void {
        this.equipmentStateChanged.set(false);
    }

    private serializePSRChecks(): SerializedPSRChecks | undefined {
        const psrChecks = this.getPSRCheckState();
        const serialized: SerializedPSRChecks = {};

        if ((psrChecks.legActuators?.size ?? 0) > 0) {
            const legActuators = Object.fromEntries(
                Array.from(psrChecks.legActuators!.entries()).filter(([, count]) => count > 0)
            );
            if (Object.keys(legActuators).length > 0) serialized.legActuators = legActuators;
        }
        if ((psrChecks.hipsHit?.size ?? 0) > 0) serialized.hipsHit = Array.from(psrChecks.hipsHit!);
        if ((psrChecks.gyroHit ?? 0) > 0) serialized.gyroHit = psrChecks.gyroHit;
        if (psrChecks.gyroDestroyed) serialized.gyroDestroyed = true;
        if ((psrChecks.legsDestroyed?.size ?? 0) > 0) serialized.legsDestroyed = Array.from(psrChecks.legsDestroyed!);
        if (psrChecks.shutdown) serialized.shutdown = true;

        return Object.keys(serialized).length > 0 ? serialized : undefined;
    }

    private deserializePSRChecks(data: SerializedPSRChecks | undefined): PSRChecks {
        return {
            ...(data?.legActuators && { legActuators: new Map(Object.entries(data.legActuators)) }),
            ...(data?.hipsHit && { hipsHit: new Set(data.hipsHit) }),
            ...(data?.gyroHit !== undefined && { gyroHit: data.gyroHit }),
            ...(data?.gyroDestroyed !== undefined && { gyroDestroyed: data.gyroDestroyed }),
            ...(data?.legsDestroyed && { legsDestroyed: new Set(data.legsDestroyed) }),
            ...(data?.shutdown !== undefined && { shutdown: data.shutdown }),
        };
    }

    resetPSRChecks() {
        this.applyMovePSR.set(false);
        this.clearPSRCheckState();
    }

    getPSRCheckState(): PSRChecks {
        return this.psrChecks();
    }

    hasPendingPSRChecks = computed<boolean>(() => {
        return Object.keys(this.getPSRCheckState()).length > 0;
    });

    setPSRCheckState(psrChecks: PSRChecks) {
        this.psrChecks.set({ ...psrChecks });
    }

    clearPSRCheckState() {
        this.psrChecks.set({});
        this.psrOutcomes.set({});
        this.dmgReceived.set(0);
    }

    currentPilotDamageGroup(): string {
        // Core aggregates all pilot damage in a tracked phase. Total Warfare
        // resolves Movement damage immediately; without phase tracking there
        // is no safe aggregation boundary for either ruleset.
        return !this.unitState.unit.tracksPhaseAndTurn()
            || (!this.unitState.unit.gameRules.aggregatedEndPhaseConsciousRolls && this.currentPhase() === 'M')
            ? createPilotDamageGroup('immediate')
            : this.pilotDamageGroup;
    }

    completePilotDamagePhase(): void {
        const completedGroup = this.pilotDamageGroup;
        this.pendingEvents.update(current => current.map(event =>
            'pilotDamageGroup' in event && event.pilotDamageGroup === completedGroup
                ? { ...event, pilotDamageGroup: closePilotDamagePhase(completedGroup) } as SerializedPendingEvent
                : event));
        this.pilotDamageGroup = createPilotDamageGroup('combat');
    }

    completePilotDamageTurn(): void {
        const current = this.pendingEvents();
        let changed = false;
        const next = current.map(event => {
            if (!('pilotDamageGroup' in event) || typeof event.pilotDamageGroup !== 'string') return event;
            const pilotDamageGroup = closePilotDamageTurn(event.pilotDamageGroup);
            if (pilotDamageGroup === event.pilotDamageGroup) return event;
            changed = true;
            return { ...event, pilotDamageGroup } as SerializedPendingEvent;
        });
        if (changed) this.pendingEvents.set(next);
    }

    getPendingEvents(): readonly SerializedPendingEvent[] {
        return this.pendingEvents();
    }

    private queuePendingEvent(event: SerializedPendingEvent): boolean {
        if (!event.id || this.pendingEvents().some(candidate => candidate.id === event.id)) return false;
        this.pendingEvents.update(current => [...current, structuredClone(event)]);
        return true;
    }

    private discardPendingEvent(id: string, type: SerializedPendingEvent['type']): boolean {
        const current = this.pendingEvents();
        const next = current.filter(event => event.id !== id || event.type !== type);
        if (next.length === current.length) return false;
        this.pendingEvents.set(next);
        return true;
    }

    getPendingUnitChecks(): readonly SerializedPendingUnitCheck[] {
        return this.pendingEvents().filter(
            (event): event is SerializedPendingUnitCheck => event.type === 'unit-check'
        );
    }

    getPendingUnitCheck(id: string): SerializedPendingUnitCheck | undefined {
        const event = this.pendingEvents().find(candidate => candidate.id === id);
        return event?.type === 'unit-check' ? event : undefined;
    }

    actionablePendingUnitChecks = computed(() => this.getPendingUnitChecks().filter(pending =>
        (!('readyTurn' in pending) || pending.readyTurn <= this.turnCounter)
        && !(this.unitState.unit.gameRules.aggregatedEndPhaseConsciousRolls
            && isConsciousnessCheck(pending)
            && isOpenCombatPilotDamageGroup(pending.pilotDamageGroup))));

    /** Includes this phase's consciousness roll while END PHASE is waiting to commit. */
    phaseEndPendingUnitChecks = computed(() => this.getPendingUnitChecks().filter(pending =>
        !('readyTurn' in pending) || pending.readyTurn <= this.turnCounter));

    pendingUnitCheckCount = computed(() =>
        pendingUnitCheckList(this.unitState.unit).length);

    pendingUnitCheckCountAtPhaseEnd = computed(() =>
        pendingUnitCheckList(this.unitState.unit, true).length);

    queuePendingUnitCheck(pending: PendingEventInput<SerializedPendingUnitCheck>): boolean {
        return this.queuePendingEvent({ type: 'unit-check', ...pending } as SerializedPendingUnitCheck);
    }

    setPendingUnitCheckOutcome(id: string, outcome: RuleCheckOutcome, roll?: readonly number[]): boolean {
        const pending = this.getPendingUnitCheck(id);
        if (!pending || pending.target === undefined
            || (roll && (roll.length !== 2
                || roll.some(die => !Number.isInteger(die) || die < 1 || die > 6)))) return false;
        const result = roll
            ? { kind: 'roll' as const, dice: [roll[0], roll[1]] as const }
            : { kind: 'manual' as const, outcome };
        this.pendingEvents.update(current => {
            const updated = current.map(candidate => candidate.id === id
                && candidate.type === 'unit-check'
                ? { ...candidate, result } as SerializedPendingUnitCheck
                : candidate);
            return isConsciousnessCheck(pending)
                ? this.withCascadedConsciousnessFailures(updated)
                : updated;
        });
        return true;
    }

    /** Later rolls for an already-unconscious crew member are automatic failures. */
    private withCascadedConsciousnessFailures(
        events: readonly SerializedPendingEvent[],
    ): SerializedPendingEvent[] {
        const orderedChecks = events.flatMap((event, index) =>
            event.type === 'unit-check' && isCascadeUnitCheck(event)
                ? [{ check: this.withoutCascadedFailure(event), index }]
                : [])
            .sort((left, right) =>
                pendingUnitCheckPriority(this.unitState.unit, left.check)
                - pendingUnitCheckPriority(this.unitState.unit, right.check)
                || left.index - right.index);
        const failedCrew = new Set<number>();
        const automaticFailures = new Set<string>();
        for (const { check } of orderedChecks) {
            if (failedCrew.has(check.crewId)) {
                automaticFailures.add(check.id);
                continue;
            }
            if (isConsciousnessCheck(check) && pendingUnitCheckOutcome(check) === 'failed') {
                failedCrew.add(check.crewId);
            }
        }

        return events.map(event => {
            if (event.type !== 'unit-check' || !isCascadeUnitCheck(event)) return event;
            const explicit = this.withoutCascadedFailure(event);
            return automaticFailures.has(event.id)
                ? {
                    ...explicit,
                    result: { kind: 'automatic', outcome: 'failed' },
                } as SerializedPendingUnitCheck
                : explicit;
        });
    }

    private withoutCascadedFailure(
        pending: CascadeUnitCheck,
    ): CascadeUnitCheck {
        // A targeted automatic result is created only by this cascade. Clear
        // it first so changing an earlier consciousness result is reversible.
        return pending.target !== undefined && pending.result?.kind === 'automatic'
            ? this.withoutPendingUnitCheckResult(pending) as typeof pending
            : pending;
    }

    private withoutPendingUnitCheckResult(
        pending: SerializedPendingUnitCheck,
    ): SerializedPendingUnitCheck {
        const { result: _result, ...facts } = pending;
        return facts as SerializedPendingUnitCheck;
    }

    setPendingUnitCheckSelection(id: string, selectionId: string): boolean {
        const pending = this.getPendingUnitCheck(id);
        if (!selectionId || !pending || !isAmmoExplosionCheck(pending)) return false;
        this.pendingEvents.update(current => current.map(candidate => candidate.id === id
            && candidate.type === 'unit-check' && isAmmoExplosionCheck(candidate)
            ? { ...candidate, selectionId }
            : candidate));
        return true;
    }

    discardPendingUnitCheck(id: string): boolean {
        return this.discardPendingEvent(id, 'unit-check');
    }

    discardPendingUnitChecks(predicate: (pending: SerializedPendingUnitCheck) => boolean): number {
        const current = this.pendingEvents();
        const next = current.filter(event => event.type !== 'unit-check' || !predicate(event));
        this.pendingEvents.set(next);
        return current.length - next.length;
    }

    refreshPendingUnitCheckTargets(): void {
        this.pendingEvents.update(current => current.flatMap<SerializedPendingEvent>(event => {
            if (event.type !== 'unit-check'
                || ('readyTurn' in event && event.readyTurn > this.turnCounter)) return [event];
            const refreshed = refreshPendingUnitCheck(this.unitState.unit, event);
            return refreshed ? [refreshed] : [];
        }));
    }

    getPendingCriticalChances(): readonly SerializedPendingMekCriticalChance[] {
        return this.pendingEvents().filter(
            (event): event is SerializedPendingMekCriticalChance => event.type === 'mek-critical-chance'
        );
    }

    getPendingCriticalChance(id: string): SerializedPendingMekCriticalChance | undefined {
        const event = this.pendingEvents().find(candidate => candidate.id === id);
        return event?.type === 'mek-critical-chance' ? event : undefined;
    }

    getNextPendingCriticalEvent(): SerializedPendingMekCriticalChance | SerializedPendingMekCritical | undefined {
        return this.pendingEvents().find(
            (event): event is SerializedPendingMekCriticalChance | SerializedPendingMekCritical =>
                event.type === 'mek-critical-chance' || event.type === 'mek-critical-hit',
        );
    }

    pendingCriticalChanceCount = computed<number>(() => this.getPendingCriticalChances().length);

    queuePendingCriticalChance(pending: PendingEventInput<SerializedPendingMekCriticalChance>): boolean {
        if (!pending.id || !pending.location) return false;
        return this.queuePendingEvent({
            type: 'mek-critical-chance',
            ...pending,
        } as SerializedPendingMekCriticalChance);
    }

    setPendingCriticalChanceResult(id: string, result: SerializedMekCriticalChanceResult | undefined): boolean {
        const currentPending = this.getPendingCriticalChance(id);
        if (!currentPending || currentPending.result === result) return false;
        this.pendingEvents.update(current => current.map(event => {
            if (event.id !== id || event.type !== 'mek-critical-chance') return event;
            if (result !== undefined) return { ...event, result };
            const { result: _result, ...withoutResult } = event;
            return withoutResult;
        }));
        return true;
    }

    setPendingCriticalChanceRoll(id: string, roll: readonly number[] | undefined): boolean {
        if (roll && (roll.length !== 2
            || roll.some(die => !Number.isInteger(die) || die < 1 || die > 6))) return false;
        const pending = this.getPendingCriticalChance(id);
        if (!pending) return false;
        const unchanged = roll === undefined
            ? pending.roll === undefined
            : pending.roll?.[0] === roll[0] && pending.roll?.[1] === roll[1];
        if (unchanged) return false;
        this.pendingEvents.update(current => current.map(event => {
            if (event.id !== id || event.type !== 'mek-critical-chance') return event;
            if (roll) return { ...event, roll: [roll[0], roll[1]] as const };
            const { roll: _roll, ...withoutRoll } = event;
            return withoutRoll;
        }));
        return true;
    }

    discardPendingCriticalChance(id: string): boolean {
        return this.discardPendingEvent(id, 'mek-critical-chance');
    }

    getPendingCriticalHits(): readonly SerializedPendingMekCritical[] {
        return this.pendingEvents().filter(
            (event): event is SerializedPendingMekCritical => event.type === 'mek-critical-hit'
        );
    }

    getPendingCriticalHit(id: string): SerializedPendingMekCritical | undefined {
        const event = this.pendingEvents().find(candidate => candidate.id === id);
        return event?.type === 'mek-critical-hit' ? event : undefined;
    }

    pendingCriticalHitCount = computed<number>(() => this.getPendingCriticalHits()
        .reduce((total, pending) => total + pending.remainingHits, 0));

    queuePendingCriticalHits(pending: PendingEventInput<SerializedPendingMekCritical>): boolean {
        if (!pending.id || !pending.location || !pending.targetLocation
            || !Number.isInteger(pending.remainingHits) || pending.remainingHits < 1
            || pending.remainingHits > 4) {
            return false;
        }
        return this.queuePendingEvent({ type: 'mek-critical-hit', ...pending } as SerializedPendingMekCritical);
    }

    replacePendingCriticalChanceWithHits(
        pending: Pick<SerializedPendingMekCritical,
            'id' | 'targetLocation' | 'remainingHits' | 'caseII' | 'floatingLocation'>,
    ): boolean {
        const current = this.pendingEvents();
        const index = current.findIndex(event => event.id === pending.id && event.type === 'mek-critical-chance');
        if (index < 0 || !pending.targetLocation || !Number.isInteger(pending.remainingHits)
            || pending.remainingHits < 1 || pending.remainingHits > 4) return false;
        const chance = current[index] as SerializedPendingMekCriticalChance;
        const {
            type: _type,
            result: _result,
            roll: _chanceRoll,
            explosionProtection,
            hardenedArmorApplies,
            throughArmorHitArc,
            ...base
        } = chance;
        const next = [...current];
        next[index] = structuredClone({
            ...base,
            type: 'mek-critical-hit',
            targetLocation: pending.targetLocation,
            remainingHits: pending.remainingHits,
            chanceOrigin: {
                ...(explosionProtection !== undefined ? { explosionProtection } : {}),
                ...(hardenedArmorApplies !== undefined ? { hardenedArmorApplies } : {}),
                ...(throughArmorHitArc !== undefined ? { throughArmorHitArc } : {}),
            },
            ...(pending.floatingLocation ? { floatingLocation: pending.floatingLocation } : {}),
            ...(pending.caseII ? { caseII: pending.caseII } : {}),
        } as SerializedPendingMekCritical);
        this.pendingEvents.set(next);
        return true;
    }

    replacePendingCriticalHitWithChance(id: string): boolean {
        const current = this.pendingEvents();
        const index = current.findIndex(event => event.id === id && event.type === 'mek-critical-hit');
        if (index < 0) return false;
        const pending = current[index] as SerializedPendingMekCritical;
        if (pending.chanceOrigin === undefined) return false;
        const {
            type: _type,
            targetLocation: _targetLocation,
            remainingHits: _remainingHits,
            chanceOrigin,
            floatingLocation: _floatingLocation,
            caseII: _caseII,
            roll: _roll,
            ...base
        } = pending;
        const next = [...current];
        next[index] = structuredClone({
            ...base,
            type: 'mek-critical-chance',
            ...chanceOrigin,
        } as SerializedPendingMekCriticalChance);
        this.pendingEvents.set(next);
        return true;
    }

    setPendingFloatingCriticalLocation(
        id: string,
        locationRoll: number | null,
        dice: readonly number[] | null = null,
        tripodLegRoll: number | null = null,
    ): boolean {
        const pending = this.getPendingCriticalHit(id);
        const floating = pending?.floatingLocation;
        if (!pending || !floating) return false;
        if (locationRoll !== null
            && (!Number.isInteger(locationRoll) || locationRoll < 2 || locationRoll > 12)) return false;
        if (dice !== null && (dice.length !== 2
            || dice.some(die => !Number.isInteger(die) || die < 1 || die > 6)
            || locationRoll !== dice[0] + dice[1])) return false;
        if (tripodLegRoll !== null
            && (!Number.isInteger(tripodLegRoll) || tripodLegRoll < 1 || tripodLegRoll > 6)) return false;
        const next: SerializedPendingMekFloatingCriticalLocation = {
            hitArc: floating.hitArc,
            ...(locationRoll !== null ? { locationRoll } : {}),
            ...(dice !== null ? { dice: [dice[0], dice[1]] as const } : {}),
            ...(tripodLegRoll !== null ? { tripodLegRoll } : {}),
        };
        this.pendingEvents.update(current => current.map(event =>
            event.id === id && event.type === 'mek-critical-hit'
                ? { ...event, floatingLocation: next }
                : event));
        return true;
    }

    resolvePendingFloatingCriticalLocation(id: string, targetLocation: string): boolean {
        const normalizedLocation = targetLocation.trim();
        const pending = this.getPendingCriticalHit(id);
        if (!normalizedLocation || !pending?.floatingLocation) return false;
        this.pendingEvents.update(current => current.map(event => {
            if (event.id !== id || event.type !== 'mek-critical-hit' || !event.floatingLocation) return event;
            const { floatingLocation: _floatingLocation, ...resolved } = event;
            return { ...resolved, targetLocation: normalizedLocation };
        }));
        return true;
    }

    setPendingCriticalCaseIICheckResult(
        id: string,
        result: Extract<SerializedPendingMekCriticalCaseII, { status: 'pending' }>['result'],
        roll?: readonly number[],
    ): boolean {
        if (roll && (roll.length !== 2
            || roll.some(die => !Number.isInteger(die) || die < 1 || die > 6))) return false;
        const pending = this.getPendingCriticalHit(id);
        if (pending?.caseII?.status !== 'pending') return false;
        const unchangedRoll = roll === undefined
            ? pending.caseII.roll === undefined
            : pending.caseII.roll?.[0] === roll[0] && pending.caseII.roll?.[1] === roll[1];
        if (pending.caseII.result === result && unchangedRoll) return false;
        this.pendingEvents.update(current => current.map(candidate => {
            if (candidate.id !== id || candidate.type !== 'mek-critical-hit') return candidate;
            return {
                ...candidate,
                caseII: {
                    status: 'pending',
                    ...(result ? { result } : {}),
                    ...(roll ? { roll: [roll[0], roll[1]] as const } : {}),
                },
            };
        }));
        return true;
    }

    passPendingCriticalCaseIICheck(id: string): boolean {
        const pending = this.getPendingCriticalHit(id);
        if (pending?.caseII?.status !== 'pending') return false;
        this.pendingEvents.update(current => current.map(candidate => {
            if (candidate.id !== id || candidate.type !== 'mek-critical-hit') return candidate;
            return { ...candidate, caseII: { status: 'passed' } };
        }));
        return true;
    }

    setPendingCriticalRoll(id: string, roll: readonly number[]): boolean {
        if (roll.length < 1 || roll.length > 2
            || roll.some(die => !Number.isInteger(die) || die < 1 || die > 6)) {
            return false;
        }
        const pending = this.getPendingCriticalHit(id);
        if (!pending || pending.caseII?.status === 'pending' || pending.floatingLocation) return false;
        this.pendingEvents.update(current => current.map(event => {
            if (event.id !== id || event.type !== 'mek-critical-hit') return event;
            return { ...event, roll: [...roll] };
        }));
        return true;
    }

    clearPendingCriticalRoll(id: string): boolean {
        if (!this.getPendingCriticalHit(id)?.roll) return false;
        this.pendingEvents.update(current => current.map(event => {
            if (event.id !== id || event.type !== 'mek-critical-hit' || !event.roll) return event;
            const { roll: _roll, ...withoutRoll } = event;
            return withoutRoll;
        }));
        return true;
    }

    resolvePendingCriticalHit(id: string): boolean {
        if (!this.getPendingCriticalHit(id) || this.getPendingCriticalHit(id)?.floatingLocation) return false;
        this.pendingEvents.update(current => current.flatMap(event => {
            if (event.id !== id || event.type !== 'mek-critical-hit') return [event];
            if (event.remainingHits <= 1) return [];
            const {
                roll: _roll,
                caseII,
                chanceOrigin: _chanceOrigin,
                floatingLocation: _floatingLocation,
                ...facts
            } = event;
            return [{
                ...facts,
                remainingHits: event.remainingHits - 1,
                ...(caseII ? { caseII: { status: 'pending' as const } } : {}),
            }];
        }));
        return true;
    }

    discardPendingCriticalHits(id: string): boolean {
        return this.discardPendingEvent(id, 'mek-critical-hit');
    }

    getPendingFalls(): readonly SerializedPendingMekFall[] {
        return this.pendingEvents().filter(
            (event): event is SerializedPendingMekFall => event.type === 'mek-fall'
        );
    }

    getPendingFall(id?: string): SerializedPendingMekFall | undefined {
        return id
            ? this.getPendingFalls().find(event => event.id === id)
            : this.getPendingFalls()[0];
    }

    pendingFallCount = computed(() => this.getPendingFalls().length);

    queuePendingFall(pending: PendingEventInput<SerializedPendingMekFall>): boolean {
        return this.queuePendingEvent({ type: 'mek-fall', ...pending });
    }

    discardPendingFall(id: string): boolean {
        return this.discardPendingEvent(id, 'mek-fall');
    }

    replacePendingFallWithUnitChecks(
        id: string,
        checks: readonly PendingEventInput<SerializedPendingUnitCheck>[],
    ): boolean {
        const current = this.pendingEvents();
        const index = current.findIndex(event => event.id === id && event.type === 'mek-fall');
        if (index < 0) return false;
        const replacements = checks.map(check => ({ type: 'unit-check' as const, ...check } as SerializedPendingUnitCheck));
        const replacementIds = new Set(replacements.map(check => check.id));
        if (replacementIds.size !== replacements.length
            || current.some((event, eventIndex) => eventIndex !== index && replacementIds.has(event.id))) return false;
        this.pendingEvents.set([
            ...current.slice(0, index),
            ...replacements.map(check => structuredClone(check)),
            ...current.slice(index + 1),
        ]);
        return true;
    }

    preparePendingCriticalWorkAfterPhaseCommit(): void {
        if (!this.pendingEvents().some(event =>
            (event.type === 'mek-critical-chance' || event.type === 'mek-critical-hit')
            && !event.consolidateImmediately)) return;
        this.pendingEvents.update(current => current.map(event =>
            event.type === 'mek-critical-chance' || event.type === 'mek-critical-hit'
                ? { ...event, consolidateImmediately: true }
                : event));
    }

    addDmgReceived(amount: number) {
        this.dmgReceived.update(current => current + amount);
    }

    addFiredHeat(amount: number) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.invalidateHeatSource('weapons');
        this.weaponsHeat.update((value)=> { return value + amount });
    }

    acknowledgeHeatSources(consumedDissipation = 0): void {
        const acknowledged = { ...this.acknowledgedHeatSources() };
        this.unresolvedHeatSources().forEach(source => acknowledged[source.id] = this.heatSourceSignature(source));
        this.acknowledgedHeatSources.set(acknowledged);
        this.withSuppressedModified(() => this.weaponsHeat.set(0));
        this.reconcileHeatSources();
        const normalizedConsumption = Number.isFinite(consumedDissipation) ? Math.max(0, consumedDissipation) : 0;
        const capacity = this.heatDissipationCapacity();
        this.heatDissipationConsumed.update(current => Math.min(current, capacity) + normalizedConsumption);
    }

    settleHeatDissipationDeficit(): void {
        const capacity = this.heatDissipationCapacity();
        this.heatDissipationConsumed.update(current => Math.min(current, capacity));
    }

    reconcileHeatSources(): void {
        if (this.suppressModified) return;
        const currentSources = new Map(this.committedHeatSources().map(source => [source.id, source]));
        const acknowledged = this.acknowledgedHeatSources();
        const next = Object.fromEntries(Object.entries(acknowledged).filter(([id, signature]) => {
            const source = currentSources.get(id);
            return source !== undefined && this.heatSourceSignature(source) === signature;
        }));
        if (Object.keys(next).length !== Object.keys(acknowledged).length) {
            this.acknowledgedHeatSources.set(next);
        }
    }

    invalidateHeatSource(id: string): void {
        const acknowledged = this.acknowledgedHeatSources();
        if (!(id in acknowledged)) return;
        const next = { ...acknowledged };
        delete next[id];
        this.acknowledgedHeatSources.set(next);
    }

    private heatSourceSignature(source: UnitHeatSource): string {
        return JSON.stringify([source.value, source.replacedByFiringEntryId ?? null, source.signature ?? null]);
    }

    movementCapacityCurrentMoveMode = computed<number>(() => {
        const moveMode = this.moveMode();
        if (moveMode === 'stationary') {
            return 0;
        }
        const airborne = this.airborne();
        if (!moveMode) {
            return 0;
        }
        const forceUnit = this.unitState.unit;
        const rules = forceUnit.rules;
        const rulesMaxDistance = rules.getEffectiveMaxDistanceForMoveMode(moveMode, this);
        if (rulesMaxDistance !== null) {
            return rulesMaxDistance;
        }
        const unit = this.unitState.unit.getUnit();
        return getMotiveModeMaxDistance(moveMode, unit, airborne ?? false);
    });

    maxDistanceCurrentMoveMode = computed<number>(() => {
        const capacity = this.movementCapacityCurrentMoveMode();
        const rules = this.unitState.unit.rules;
        return Math.max(0, capacity - rules.getMovementPointsSpent(this));
    });

    minDistanceCurrentMoveMode = computed<number>(() => {
        const moveMode = this.moveMode();
        if (moveMode === 'stationary' || !moveMode) {
            return 0;
        }
        const rulesMinDistance = this.unitState.unit.rules.getMinDistanceForMoveMode(moveMode);
        return Math.max(0, rulesMinDistance ?? 0);
    });

}
