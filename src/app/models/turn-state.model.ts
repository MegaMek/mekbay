import { computed, signal } from "@angular/core";
import { ForceUnitState } from "./force-unit-state.model";
import { getMotiveModeMaxDistance, MotiveModes } from "./motiveModes.model";
import { CriticalSlot } from "./force-serialization";
import { UnitSvgMekService } from "../services/unit-svg-mek.service";

export interface PSRCheck {
    difficulty: number;
    reason: string;
}

interface PSRChecks {
    legsFeetHit?: number;
    hipsHit?: number;
    gyrosHit?: number;
    gyrosDestroyed?: boolean;
    legsDestroyed?: number;
    shutdown?: boolean;
}

export class TurnState {
    unitState: ForceUnitState;
    airborne = signal<boolean | null>(null);
    moveMode = signal<MotiveModes | null>(null);
    moveDistance = signal<number | null>(null);
    dmgReceived = signal<number>(0);
    psrChecks = signal<PSRChecks>({});

    dirty = computed<boolean>(() => {
        const airborne = this.airborne();
        const moveMode = this.moveMode();
        const moveDistance = this.moveDistance();
        const psrChecks = this.psrChecks();
        const dmgReceived = this.dmgReceived();
        const unconsolidatedCrits = this.unitState.hasUnconsolidatedCrits();
        return airborne !== null
            || moveMode !== null
            || moveDistance !== null
            || dmgReceived != 0
            || Object.keys(psrChecks).length > 0
            || unconsolidatedCrits;
    });

    autoFall = computed<boolean>(() => {
        return (this.psrChecks().legsDestroyed || 0) > 0
            || this.psrChecks().gyrosDestroyed === true;
    });

    getPSRChecks = computed<PSRCheck[]>(() => {
        const checks: PSRCheck[] = [];
        if (this.dmgReceived() >= 20) {
            checks.push({
                difficulty: 1,
                reason: 'Received 20 or more damage this turn'
            });
        }
        if (this.psrChecks().shutdown) {
            checks.push({
                difficulty: 3,
                reason: 'Shutdown this turn'
            });
        }
        const psr = this.psrChecks();
        for (let i = 0; i < (psr.legsFeetHit || 0); i++) {
            checks.push({
                difficulty: 1,
                reason: 'Legs/Feet hit this turn'
            });
        }
        for (let i = 0; i < (psr.hipsHit || 0); i++) {
            checks.push({
                difficulty: 2,
                reason: 'Hips hit this turn'
            });
        }
        for (let i = 0; i < (psr.gyrosHit || 0); i++) {
            checks.push({
                difficulty: 3,
                reason: 'Gyros hit this turn'
            });
        }
        // if ((psr.legsDestroyedThisTurn || 0) > 0) {
        //     checks.push({
        //         difficulty: 5,
        //         reason: 'Legs destroyed this turn'
        //     });
        // }
        return checks;
    });

    getTargetModifierAsAttacker = computed<number>(() => {
        let mod = 0;
        const moveMode = this.moveMode();
        if (moveMode === 'walk') {
            mod += 1;
        } else if (moveMode === 'run') {
            mod += 2;
        } else if (moveMode === 'jump') {
            mod += 3;
        }
        return mod;
    });

    getTargetModifierAsDefender = computed<number>(() => {
        let mod = 0;
        if (this.unitState.prone()) { mod += 1; }
        if (this.unitState.immobile()) { mod -= 4; }
        if (this.unitState.skidding()) { mod += 2; }
        const moveMode = this.moveMode();
        if (moveMode !== 'stationary' && moveMode !== null) {
            if (moveMode === 'jump') { mod += 1; }
            const moveDistance = this.moveDistance() || 0;
            if (moveDistance >= 3 && moveDistance <= 4) {
                mod += 1;
            } else if (moveDistance >= 5 && moveDistance <= 6) {
                mod += 2;
            } else if (moveDistance >= 7 && moveDistance <= 9) {
                mod += 3;
            } else if (moveDistance >= 10 && moveDistance <= 17) {
                mod += 4;
            } else if (moveDistance >= 18 && moveDistance <= 24) {
                mod += 5;
            } else if (moveDistance >= 25) {
                mod += 6;
            }
        }
        const baseUnit = this.unitState.unit.getUnit();
        if (baseUnit.subtype === 'Battle Armor') {
            mod += 1;
        }
        if (baseUnit.moveType === 'VTOL' || baseUnit.moveType === 'WiGE') {
            mod += 1;
        }
        return mod;
    });

    hasPSRCheck = computed<boolean>(() => {
        return this.getPSRChecks().length > 0;
    });

    currentPhase = computed<'I' | 'M' | 'W' | 'P' | 'H'>(() => {
        if (this.moveMode() === null || (this.moveMode() !== 'stationary' && this.moveDistance() === null)) {
            return 'M';
        } else {
            return 'W';
        }
    });

    heatGeneratedFromMovement = computed(() => {
        let heat = 0;
        const moveMode = this.moveMode();
        const critSlots = this.unitState.unit.getCritSlots();
        if (moveMode === 'walk') {
            heat += 1;
        } else if (moveMode === 'run') {
            heat += 2;
        } else if (moveMode === 'jump') {
            const distance = this.moveDistance() || 0;
            const hasImprovedJumpJet = critSlots.some(slot => slot.name && slot.name.includes('Improved Jump Jet') && slot.destroyed);
            heat += Math.max(3, hasImprovedJumpJet ? Math.ceil(distance / 2) : distance);
        }
        return heat;
    });

    heatGeneratedFromStatusEffects = computed(() => {
        const critSlots = this.unitState.unit.getCritSlots();
        const engineHits = critSlots.filter(slot => slot.name && slot.name.includes('Engine') && slot.destroyed).length;
        return engineHits * 5;
    });

    heatGenerated = computed(() => {
        return this.heatGeneratedFromMovement() + this.heatGeneratedFromStatusEffects();
    });

    heatDissipated = computed(() => {
        return 0;
    });

    totalHeatDelta = computed(() => {
        return 0;
    });

    constructor(unitState: ForceUnitState) {
        this.unitState = unitState;
    }

    addDmgReceived(amount: number) {
        this.dmgReceived.set(this.dmgReceived() + amount);
    }

    evaluateCritSlot(crit: CriticalSlot) {
        let isPsrRelevant = false;
        const delta = (crit.hits && crit.hits > 0) ? 1 : -1;
        const psr = this.psrChecks();
        if (crit.name?.includes('Foot') || crit.name?.includes('Leg')) {
            psr.legsFeetHit = Math.max(0, (psr.legsFeetHit || 0) + delta);
            isPsrRelevant = true;
        } else if (crit.name?.includes('Hip')) {
            psr.hipsHit = Math.max(0, (psr.hipsHit || 0) + delta);
            isPsrRelevant = true;
        } else if (crit.name?.includes('Gyro')) {
            psr.gyrosHit = Math.max(0, (psr.gyrosHit || 0) + delta);
            isPsrRelevant = true;
            if (delta > 0 && !psr.gyrosDestroyed) {
                // This is an Hit. Check if gyros are destroyed
                const critSlots = this.unitState.unit.getCritSlots();
                const gyroHits = critSlots.filter(slot => slot.name && slot.name.includes('Gyro') && slot.destroyed).length;
                if (gyroHits === 2 && (gyroHits - delta < 2) && !psr.gyrosDestroyed) { // It's destroyed this turn
                    psr.gyrosDestroyed = true;
                } else if (gyroHits < 2) {
                    psr.gyrosDestroyed = false;
                }
            }
        }
        if (isPsrRelevant) {
            this.psrChecks.set({ ...psr });
        }
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
        const svgService = forceUnit.svgService;
        if (svgService instanceof UnitSvgMekService) {
            if (moveMode === 'walk') {
                return svgService.unitState()?.maxWalk ?? 0;
            }
            if (moveMode === 'run') {
                return svgService.unitState()?.maxRun ?? 0;
            }
            if (moveMode === 'jump') {
                return svgService.unitState()?.jump ?? 0;
            }
            if (moveMode === 'UMU') {
                return svgService.unitState()?.UMU ?? 0;
            }
        }
        const unit = this.unitState.unit.getUnit();
        return getMotiveModeMaxDistance(moveMode, unit, airborne ?? false);
    });

}