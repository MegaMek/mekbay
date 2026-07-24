import { computed, signal, type WritableSignal } from "@angular/core";
import { canChangeAirborneGround, getMotiveModeMaxDistance, type MotiveModes } from "./motiveModes.model";
import { getMekLegLocations, inferMekConfigFromLocations } from "./entity/types";
import type { CBTForceUnitState } from "./cbt-force-unit-state.model";
import type { SerializedPSRChecks, SerializedTurnState } from "./force-serialization";
import { calculateModifierTotal, type PSRCheck, type UnitHeatSource, type UnitModifierBreakdownEntry, type UnitModifierTotal } from "./rules/unit-type-rules";

export type { PSRCheck } from "./rules/unit-type-rules";

export interface PSRChecks {
    legActuators?: Map<string, number>;
    hipsHit?: Set<string>;
    gyroHit?: number;
    gyroDestroyed?: boolean;
    legsDestroyed?: Set<string>;
    shutdown?: boolean;
}

export class TurnState {
    unitState: CBTForceUnitState;
    private suppressModified = false;
    airborne = this.modifiedSignal<boolean | null>(null);
    moveMode = this.modifiedSignal<MotiveModes | null>(null);
    moveDistance = this.modifiedSignal<number | null>(null);
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
        const dmgReceived = this.dmgReceived();
        const unconsolidatedCrits = this.unitState.hasUnconsolidatedCrits();
        const unconsolidatedLocations = this.unitState.hasUnconsolidatedLocations();
        const unconsolidatedInventory = this.unitState.hasUnconsolidatedInventory();
        return airborne !== null
            || moveMode !== null
            || moveDistance !== null
            || dmgReceived != 0
            || this.spotting()
            || this.hasPendingPSRChecks()
            || unconsolidatedCrits
            || unconsolidatedLocations
                || unconsolidatedInventory
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
            || unconsolidatedInventory;
    });

    autoFall = computed<boolean>(() => {
        return this.unitState.unit.rules.autoFall();
    });

    getPSRChecks = computed<PSRCheck[]>(() => {
        return this.unitState.unit.rules.getPSRChecks(this);
    });

    canRun = computed<boolean>(() => {
        const unit = this.unitState.unit;
        let damagedLegsCount = 0;
        const internalLocations = unit.locations?.internal;
        const config = inferMekConfigFromLocations(internalLocations?.keys() ?? []);
        // Calculate pre-existing leg destruction modifiers. If a leg is gone, is gone.
        for (const loc of getMekLegLocations(config)) {
            if (!internalLocations?.has(loc)) continue;
            if (unit.isInternalLocCommittedDestroyed(loc)) {
                damagedLegsCount++;
            }
        }
        return config === 'Quad' ? damagedLegsCount < 2 : damagedLegsCount < 1;
    });

    getSpottingModifier = computed<number>(() => {
        return this.spotting() ? this.unitState.unit.rules.getSpottingModifier() : 0;
    });

    getAttackMovementModifier = computed<number>(() => {
        return this.unitState.unit.rules.getAttackMovementModifier(this.moveMode(), this.airborne() ?? false);
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
        return this.moveMode() === null && this.attackMovementModifierCanApply();
    });

    getTotalTargetModifierAsAttacker = computed<number>(() => {
        return this.getAttackModifierBreakdown()
            .reduce((total, entry) => total + entry.modifier, 0);
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

    PSRRollsCount = computed<number>(() => {
        return this.unitState.unit.rules.getPSRChecks(this).filter((entry) => entry.fallCheck !== undefined).length;
    });

    currentPhase = computed<'I' | 'M' | 'W' | 'P' | 'H'>(() => {
        if (this.moveMode() === null || (this.moveMode() !== 'stationary' && this.moveDistance() === null)) {
            return 'M';
        } else {
            return 'W';
        }
    });

    heatSources = computed<UnitHeatSource[]>(() => {
        return this.unitState.unit.rules.heatSources(this);
    });

    constructor(unitState: CBTForceUnitState) {
        this.unitState = unitState;
    }

    private modifiedSignal<T>(initialValue: T): WritableSignal<T> {
        const state = signal<T>(initialValue);
        const originalSet = state.set.bind(state);
        const originalUpdate = state.update.bind(state);
        state.set = (newValue: T) => {
            const previousValue = state();
            originalSet(newValue);
            this.markModifiedIfChanged(previousValue, newValue);
        };
        state.update = (updateFn: (value: T) => T) => {
            const previousValue = state();
            originalUpdate(updateFn);
            this.markModifiedIfChanged(previousValue, state());
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
        const airborne = this.airborne();
        const moveMode = this.moveMode();
        const moveDistance = this.moveDistance();
        const psrChecks = this.serializePSRChecks();

        if (airborne === true) turnState.airborne = true;
        if (moveMode !== null) turnState.moveMode = moveMode;
        if (moveDistance !== null) turnState.moveDistance = moveDistance;
        if (this.dmgReceived() > 0) turnState.dmgReceived = this.dmgReceived();
        if (this.weaponsHeat() > 0) turnState.weaponsHeat = this.weaponsHeat();
        if (psrChecks) turnState.psrChecks = psrChecks;
        if (this.spotting()) turnState.spotting = true;

        return Object.keys(turnState).length > 0 ? turnState : undefined;
    }

    update(data: SerializedTurnState | undefined) {
        this.withSuppressedModified(() => {
            this.airborne.set(data?.airborne ?? null);
            this.moveMode.set(data?.moveMode ?? null);
            this.moveDistance.set(data?.moveDistance ?? null);
            this.dmgReceived.set(data?.dmgReceived ?? 0);
            this.weaponsHeat.set(data?.weaponsHeat ?? 0);
            this.psrChecks.set(this.deserializePSRChecks(data?.psrChecks));
            this.applyMovePSR.set(data?.applyMovePSR ?? true);
            this.spotting.set(data?.spotting ?? false);
        });
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
        this.dmgReceived.set(0);
    }

    addDmgReceived(amount: number) {
        this.dmgReceived.update((value)=> { return value + amount });
    }

    addFiredHeat(amount: number) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.weaponsHeat.update((value)=> { return value + amount });
    }

    resetTurnHeatSources() {
        this.weaponsHeat.set(0);
    }

    maxDistanceCurrentMoveMode = computed<number>(() => {
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

    minDistanceCurrentMoveMode = computed<number>(() => {
        const moveMode = this.moveMode();
        if (moveMode === 'stationary' || !moveMode) {
            return 0;
        }
        const rulesMinDistance = this.unitState.unit.rules.getMinDistanceForMoveMode(moveMode);
        return Math.max(0, rulesMinDistance ?? 0);
    });

}