import { computed, signal } from "@angular/core";
import type { ForceUnitState } from "./force-unit-state.model";
import { canChangeAirborneGround, getMotiveModeMaxDistance, type MotiveModes } from "./motiveModes.model";
import type { CriticalSlot } from "./force-serialization";
import { FOUR_LEGGED_LOCATIONS, LEG_LOCATIONS } from "./common.model";
import type { CBTForceUnitState } from "./cbt-force-unit-state.model";
import type { PSRCheck, UnitHeatSource } from "./rules/unit-type-rules";
import {
    getTargetMovementDistanceModifier,
    getTargetMoveTypeModifier,
    getTargetStanceModifier,
    getTargetUnitTypeModifier,
    TN_AIRBORNE_MOVE_TYPE_MODIFIER,
    TN_SKIDDING_MODIFIER,
} from "./target-number-calculator.model";

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
    airborne = signal<boolean | null>(null);
    moveMode = signal<MotiveModes | null>(null);
    moveDistance = signal<number | null>(null);
    dmgReceived = signal<number>(0);
    private psrChecks = signal<PSRChecks>({});
    applyMovePSR = signal<boolean>(true);
    spotting = signal<boolean>(false);

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
        let isFourLegged = false;
        // Calculate pre-existing leg destruction modifiers. If a leg is gone, is gone.
        unit.locations?.internal?.forEach((_value, loc) => {
            if (!LEG_LOCATIONS.has(loc)) return; // Only consider leg locations
            if (!isFourLegged && FOUR_LEGGED_LOCATIONS.has(loc)) {
                isFourLegged = true;
            }
            if (unit.isInternalLocCommittedDestroyed(loc)) {
                damagedLegsCount++;
            }
        });
        if (isFourLegged) {
            return damagedLegsCount < 2;
        } else {
            return damagedLegsCount < 1;
        }
    });

    getSpottingModifier = computed<number>(() => {
        return this.spotting() ? 1 : 0;
    });

    getAttackMovementModifier = computed<number>(() => {
        return this.unitState.unit.rules.getAttackMovementModifier(this.moveMode());
    });

    attackMovementModifierCanApply = computed<boolean>(() => {
        const unit = this.unitState.unit;
        const canChangeAirborne = canChangeAirborneGround(unit.getUnit());
        if (!canChangeAirborne) {
            return unit.getAvailableMotiveModes(false)
                .some(option => unit.rules.getAttackMovementModifier(option.mode) !== 0);
        }
        return unit.getAvailableMotiveModes(false)
            .some(option => unit.rules.getAttackMovementModifier(option.mode) !== 0) ||
            unit.getAvailableMotiveModes(true)
            .some(option => unit.rules.getAttackMovementModifier(option.mode) !== 0);
    });

    missingAttackMovementModifier = computed<boolean>(() => {
        return this.moveMode() === null && this.attackMovementModifierCanApply();
    });

    getTotalTargetModifierAsAttacker = computed<number>(() => {
        let modifier = this.unitState.unit.gunneryModifier();
        modifier += this.getAttackMovementModifier();
        modifier += this.getSpottingModifier();
        return modifier;
    });

    getTotalTargetModifierAsDefender = computed<number>(() => {
        let mod = 0;
        if (this.unitState.prone()) { mod += getTargetStanceModifier('prone', 1); }
        if (this.unitState.immobile()) { mod += getTargetStanceModifier('immobile', 1); }
        if (this.unitState.skidding()) { mod += TN_SKIDDING_MODIFIER; }
        const moveMode = this.moveMode();
        if (moveMode !== 'stationary' && moveMode !== null) {
            if (moveMode === 'jump') { mod += TN_AIRBORNE_MOVE_TYPE_MODIFIER; }
            const moveDistance = this.moveDistance() || 0;
            mod += getTargetMovementDistanceModifier(moveDistance);
        }
        const baseUnit = this.unitState.unit.getUnit();
        if (baseUnit.subtype === 'Battle Armor') {
            mod += getTargetUnitTypeModifier('battle-armor');
        }
        mod += getTargetMoveTypeModifier(baseUnit.moveType);
        return mod;
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
        this.dmgReceived.set(this.dmgReceived() + amount);
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
        const rulesMaxDistance = rules.getMaxDistanceForMoveMode(moveMode);
        if (rulesMaxDistance !== null) {
            return rulesMaxDistance;
        }
        const unit = this.unitState.unit.getUnit();
        return getMotiveModeMaxDistance(moveMode, unit, airborne ?? false);
    });

}