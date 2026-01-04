import { computed, signal } from "@angular/core";
import { ForceUnitState } from "./force-unit-state.model";
import { getMotiveModeMaxDistance, MotiveModes } from "./motiveModes.model";
import { CriticalSlot } from "./force-serialization";
import { UnitSvgMekService } from "../services/unit-svg-mek.service";
import { FOUR_LEGGED_LOCATIONS, LEG_LOCATIONS } from "../models/common.model";
import { CBTForceUnitState } from "./cbt-force-unit-state.model";

export interface PSRCheck {
    fallCheck?: number;
    pilotCheck?: number;
    reason: string;
    loc?: string;
    legFilter?: string;
    ignorePreExistingGyro?: boolean;
}

interface PSRChecks {
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

    dirty = computed<boolean>(() => {
        const heat = this.unitState.heat();
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
            || unconsolidatedCrits
            || heat.next !== undefined;
    });

    dirtyPhase = computed<boolean>(() => {
        const psrChecks = this.psrChecks();
        const dmgReceived = this.dmgReceived();
        const unconsolidatedCrits = this.unitState.hasUnconsolidatedCrits();
        return dmgReceived != 0
            || Object.keys(psrChecks).length > 0
            || unconsolidatedCrits;
    });

    autoFall = computed<boolean>(() => {
        return (this.psrChecks().legsDestroyed?.size || 0) > 0
            || this.psrChecks().gyroDestroyed === true;
    });

    getPSRChecks = computed<PSRCheck[]>(() => {
        const checks: PSRCheck[] = [];
        const psr = this.psrChecks();
        const unit = this.unitState.unit;

        if (psr.gyroDestroyed) {
            checks.push({
                fallCheck: 100,
                pilotCheck: 6,
                reason: 'Gyro destroyed',
                ignorePreExistingGyro: true,
            });
        } else if ((psr.legsDestroyed?.size || 0) > 0) {
            psr.legsDestroyed?.forEach((loc => {
                checks.push({
                    fallCheck: 100,
                    pilotCheck: 5,
                    loc: loc,
                    legFilter: loc,
                    reason: 'Leg destroyed'
                });
            }));
        } else {
            if (this.psrChecks().shutdown) {
                checks.push({
                    fallCheck: 3,
                    pilotCheck: 3,
                    reason: 'Shutdown'
                });
            }
            if (this.dmgReceived() >= 20) {
                checks.push({
                    fallCheck: 1,
                    pilotCheck: 1,
                    reason: 'Received 20 or more damage'
                });
            }
            // We place the actuators FIRST so that the hips of this turn will not filter them out
            psr.legActuators?.forEach((count, loc) => {
                for (let i = 0; i < count; i++) {
                    checks.push({
                        fallCheck: 1,
                        pilotCheck: 1,
                        loc: loc,
                        reason: 'Leg actuator hit',
                    });
                }
            });
            if (psr.hipsHit) {
                psr.hipsHit.forEach((loc) => {
                    checks.push({
                        fallCheck: 2,
                        pilotCheck: 2,
                        loc: loc,
                        legFilter: loc,
                        reason: 'Hip hit'
                    });
                });
            }
            const gyroHits = (psr.gyroHit || 0);
            if (gyroHits > 0) {
                const critSlots = unit.getCritSlots();
                const hasHeavyDutyGyro = critSlots.some(slot => slot.name && slot.name.includes('Heavy Duty') && slot.name.includes('Gyro'));
                const previouslyDestroyedGyroCount = unit.getCritSlots().filter(slot => {
                    if (!slot.name || !slot.destroyed) return false;
                    if (!slot.name.includes('Gyro')) return false;
                    return true;
                }).length;
                if (hasHeavyDutyGyro && (previouslyDestroyedGyroCount + gyroHits) === 1) {
                    checks.push({
                        pilotCheck: 1,
                        reason: 'Gyro hit', // This will not trigger a PSR, no fallCheck value
                    });
                } else {
                    checks.push({
                        fallCheck: 3,
                        pilotCheck: 3,
                        reason: 'Gyro hit',
                        ignorePreExistingGyro: true,
                    });
                    
                }
            }
            if (this.applyMovePSR()) {
                const moveMode = this.moveMode();
                if (moveMode === 'run' || moveMode === 'jump') {
                    const critSlots = unit.getCritSlots();
                    const hasDamagedGyro = critSlots.some(slot => {
                        if (!slot.name || !slot.destroyed) return false;
                        if (!slot.name.includes('Gyro')) return false;
                        return true;
                    });
                    let hasDamagedLeg = false;
                    unit.locations?.internal?.forEach((_value, loc) => {
                        if (hasDamagedLeg) return;
                        if (!LEG_LOCATIONS.has(loc)) return; // Only consider leg locations
                        if (unit.isInternalLocDestroyed(loc)) {
                            hasDamagedLeg = true;
                        }
                    });
                    const hasDamagedLegActuators = critSlots.some(slot => {
                            if (!slot.name || !slot.loc || !slot.destroyed) return false;
                            if (!LEG_LOCATIONS.has(slot.loc)) return false;
                            return (slot.name.includes('Leg') || slot.name.includes('Foot') || slot.name.includes('Hip'));
                        });
                    if (moveMode === 'jump') {
                        if (hasDamagedGyro) {
                            checks.push({
                                fallCheck: 0,
                                pilotCheck: 0,
                                reason: 'Jumping with damaged gyro'
                            });
                        } else if (hasDamagedLeg) {
                            checks.push({
                                fallCheck: 0,
                                pilotCheck: 0,
                                reason: 'Jumping with damaged leg'
                            });
                        } else if (hasDamagedLegActuators) {
                            checks.push({
                                fallCheck: 0,
                                pilotCheck: 0,
                                reason: 'Jumping with damaged leg actuator'
                            });
                        }
                    } else if (moveMode === 'run') {
                        if (hasDamagedGyro) {
                            checks.push({
                                fallCheck: 0,
                                pilotCheck: 0,
                                reason: 'Running with damaged gyro'
                            });
                        } else if (hasDamagedLegActuators) {             
                            const hasDamagedHip = critSlots.some(slot => {
                                if (!slot.name || !slot.loc || !slot.destroyed) return false;
                                if (!LEG_LOCATIONS.has(slot.loc)) return false;
                                return slot.name.includes('Hip');
                            });
                            if (hasDamagedHip) {
                                checks.push({
                                    fallCheck: 0,
                                    pilotCheck: 0,
                                    reason: 'Running with damaged hip'
                                });
                            }
                        } 
                    }
                }
            }
        }
        return checks;
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
            if (unit.isInternalLocDestroyed(loc)) {
                damagedLegsCount++;
            }
        });
        if (isFourLegged) {
            return damagedLegsCount < 2;
        } else {
            return damagedLegsCount < 1;
        }
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

    PSRRollsCount = computed<number>(() => {
        return this.getPSRChecks().filter((entry) => entry.fallCheck !== undefined).length;
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

    heatGeneratedFromDamagedEngine = computed(() => {
        if (this.unitState.unit.shutdown) return 0;
        const critSlots = this.unitState.unit.getCritSlots();
        const engineHits = critSlots.filter(slot => slot.name && slot.name.includes('Engine') && slot.destroyed).length;
        return engineHits * 5;
    });

    constructor(unitState: CBTForceUnitState) {
        this.unitState = unitState;
    }

    resetPSRChecks() {
        this.applyMovePSR.set(false);
        this.psrChecks.set({});
        this.dmgReceived.set(0);
    }

    addDmgReceived(amount: number) {
        this.dmgReceived.set(this.dmgReceived() + amount);
    }

    evaluateLegDestroyed(location: string, hits: number) {
        if (!LEG_LOCATIONS.has(location)) return;
        const unit = this.unitState.unit;
        if (!unit) return;
        const destroyed = unit.isInternalLocDestroyed(location);
        let isPsrRelevant = false;
        const psr = this.psrChecks();
        if (destroyed) {
            if (!psr.legsDestroyed) {
                psr.legsDestroyed = new Set<string>();
            }
            if (hits > 0) {
                psr.legsDestroyed.add(location);
                isPsrRelevant = true;
            }
        } else {
            if (psr.legsDestroyed && psr.legsDestroyed.has(location) && hits < 0) {
                psr.legsDestroyed.delete(location);
                isPsrRelevant = true;
            }
        }
        if (isPsrRelevant) {
            this.psrChecks.set({ ...psr });
        }
    }

    evaluateCritSlotHit(crit: CriticalSlot) {
        if (!crit.loc) return;
        let isPsrRelevant = false;
        const delta = (crit.destroying) ? 1 : -1;
        const psr = this.psrChecks();
        if (LEG_LOCATIONS.has(crit.loc)) { // Leg location, check for leg/foot/hip hits
            if (crit.name?.includes('Foot') || crit.name?.includes('Leg')) {
                if (!psr.legActuators) {
                    psr.legActuators = new Map<string, number>();
                }
                psr.legActuators.set(crit.loc, Math.max(0, (psr.legActuators.get(crit.loc) || 0) + delta));
                isPsrRelevant = true;
            } else if (crit.name?.includes('Hip')) {
                if (!psr.hipsHit) {
                    psr.hipsHit = new Set<string>();
                }
                if (delta > 0) {
                    psr.hipsHit.add(crit.loc);
                } else {
                    psr.hipsHit.delete(crit.loc);
                }
                isPsrRelevant = true;
            }
        } else if (crit.name?.includes('Gyro')) {
            psr.gyroHit = Math.max(0, (psr.gyroHit || 0) + delta);
            isPsrRelevant = true;
            // This is an Hit. Check if gyros are destroyed
            const critSlots = this.unitState.unit.getCritSlots();
            const hasHeavyDutyGyro = critSlots.some(slot => slot.name && slot.name.includes('Heavy Duty') && slot.name.includes('Gyro'));
            const gyroHits = critSlots.filter(slot => {
                if (!slot.name) return false;
                if (!slot.destroyed && !slot.destroying) return false;
                if (!slot.name.includes('Gyro')) return false;
                return true;
            }).length;
            if (((hasHeavyDutyGyro && gyroHits > 2) || (!hasHeavyDutyGyro && gyroHits > 1))) { // It's destroyed this turn
                psr.gyroDestroyed = true;
            } else {
                psr.gyroDestroyed = false;
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