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

import { computed } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../force-serialization';
import { CrewStateControlDefinition, CrewStateDefinition, crewStateDefinitions, UnitConditionControl, unitConditionControls, UnitTypeRulesBase, type LocationConditionControl, type PSRCheck, type MountedEquipmentRuleState, type UnitHeatSource, type UnitModifierBreakdownEntry } from './unit-type-rules';
import type { TurnState } from '../turn-state.model';
import { type HeatScaleEntry, HeatManagement, getHeatEffects } from './heat-management';
import type { MotiveModes } from '../motiveModes.model';
import { getDefaultAttackerMovementModifier, TN_PRONE, TN_PRONE_ADJACENT, TN_PRONE_ATTACKER } from '../target-number-calculator.model';

type ArmLocation = 'LA' | 'RA';

const SIDE_TORSO_LOCATIONS = new Set(['LT', 'RT']);
export const TORSO_LOCATIONS = new Set(['CT', 'LT', 'RT']);
export const BIPED_LEGS = new Set(['LL', 'RL']);
export const TRIPOD_LEGS = new Set(['LL', 'CL', 'RL']);
export const QUAD_LEGS = new Set(['RLL', 'FLL', 'RRL', 'FRL']);
const LIMB_LOCATIONS = new Set(['LA', 'RA', 'LL', 'RL', 'CL', 'RLL', 'FLL', 'RRL', 'FRL']);
export const LINKED_LOCATIONS: { [key: string]: string[] } = {
    'RT': ['RA', 'FRL'],
    'LT': ['LA', 'FLL'],
};
export const LEG_LOCATIONS = new Set(['LL', 'RL', 'CL', 'FRL', 'FLL', 'RRL', 'RLL']);
export const FOUR_LEGGED_LOCATIONS = new Set(['FRL', 'FLL', 'RRL', 'RLL']);

export const MEK_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['shutdown', 'prone', 'swarmed', 'tagged', 'skidding', 'jammed']);
export const MEK_CREW_STATE_CONTROLS: readonly CrewStateControlDefinition[] = crewStateDefinitions(['unconscious', 'ejected']) as readonly CrewStateControlDefinition[];
export const MEK_CREW_STATE_DISPLAYS: readonly CrewStateDefinition[] = crewStateDefinitions(['unconscious', 'ejected', 'dead']);
export const MEK_LOCATION_CONDITION_CONTROLS: readonly LocationConditionControl[] = [
    { key: 'flooded', label: 'Flooded', color: '#66f' },
    { key: 'blown-off', label: 'Blown Off', color: '#808080' },
    { key: 'narc', label: 'NARC', color: '#f00', counted: true },
];

/**
 * Mek-specific game rules: destruction evaluation, systems status,
 * Piloting Skill Roll modifiers, and PSR target roll.
 */
export class MekRules extends UnitTypeRulesBase {

    protected override supportsDroneOperatingSystem(): boolean {
        return true;
    }

    protected override readonly baseConditionControls = MEK_UNIT_CONDITION_CONTROLS;
    protected override readonly baseCrewStateControls = MEK_CREW_STATE_CONTROLS;
    override readonly locationConditionControls = MEK_LOCATION_CONDITION_CONTROLS;
    protected override readonly crewStateDisplayDefinitions = MEK_CREW_STATE_DISPLAYS;

    override get crewStateControls(): readonly CrewStateControlDefinition[] {
        const controls = super.crewStateControls;
        return this.hasTorsoMountedCockpit()
            ? controls.filter(control => control.key !== 'ejected')
            : controls;
    }

    protected override readonly abandoned = computed<boolean>(() => {
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.every(crewMember => {
            const state = crewMember.getState();
            return state === 'dead' || state === 'ejected';
        });
    });

    protected override readonly immobile = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        if (this.unit.getCondition('shutdown')) return true;
        if (this.allLimbsDestroyedOrMissing()) return true;
        if (this.hasDroneOperatingSystem()) return false;
        if (this.hasFunctionalCrew()) return false;
        return true;
    });

    protected override readonly crippled = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        return this.allCrewCrippled()
            || this.allSensorsDestroyedOrDestroying()
            || this.gyroEngineCrippledOrCrippling()
            || this.sideTorsoDestroyedOrDestroying()
            || this.internalStructureCrippledOrCrippling()
    });

    private readonly heatMgmt: HeatManagement;

    constructor(unit: CBTForceUnit) {
        super(unit);
        this.heatMgmt = new HeatManagement(unit);
    }

    // ── Cripple Check Utilities ──────────────────────────────────────────────

    private allLimbsDestroyedOrMissing(): boolean {
        const internalLocations = this.unit.locations?.internal;
        if (!internalLocations) return false;

        const limbLocations = this.mekLimbsLocations(internalLocations);
        return limbLocations.every(loc => !internalLocations.has(loc) || this.unit.isInternalLocCommittedDestroyed(loc));
    }

    private mekLimbsLocations(internalLocations: Map<string, unknown>): readonly string[] {
        if (Array.from(FOUR_LEGGED_LOCATIONS).some(loc => internalLocations.has(loc))) {
            return ['RLL', 'FLL', 'RRL', 'FRL'];
        }
        if (internalLocations.has('CL')) {
            return ['LL', 'RL', 'CL', 'LA', 'RA'];
        }
        return ['LL', 'RL', 'LA', 'RA'];
    }

    private allSensorsDestroyedOrDestroying(): boolean {
        const sensorSlots = this.unit.getCritSlots().filter(slot => this.isNamedCrit(slot, 'Sensor'));
        return sensorSlots.length > 0 && sensorSlots.every(slot => this.isDestroyedOrDestroyingCrit(slot));
    }

    private gyroEngineCrippledOrCrippling(): boolean {
        const critSlots = this.unit.getCritSlots();
        const gyroHits = critSlots.filter(slot => this.isNamedCrit(slot, 'Gyro') && this.isDestroyedOrDestroyingCrit(slot)).length;
        const engineHits = critSlots.filter(slot => this.isNamedCrit(slot, 'Engine') && this.isDestroyedOrDestroyingCrit(slot)).length;
        return engineHits >= 2 || (engineHits >= 1 && gyroHits >= 1);
    }

    private sideTorsoDestroyedOrDestroying(): boolean {
        return Array.from(SIDE_TORSO_LOCATIONS).some(loc => this.unit.isInternalLocDestroyed(loc));
    }

    private internalStructureCrippledOrCrippling(): boolean {
        let damagedLimbs = 0;
        let damagedTorsos = 0;

        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (this.unit.getInternalHits(loc) <= 0) return;
            if (LIMB_LOCATIONS.has(loc)) {
                damagedLimbs++;
            } else if (TORSO_LOCATIONS.has(loc) && this.unit.isArmorLocDestroyed(loc)) {
                damagedTorsos++;
            }
        });

        return damagedLimbs >= 3 || damagedTorsos >= 2;
    }

    private isDestroyedOrDestroyingCrit(slot: CriticalSlot): boolean {
        return !!slot.destroying || this.isCritUnavailable(slot);
    }

    private isCritUnavailable(slot: CriticalSlot): boolean {
        return this.unit.isEquipmentUnavailable(slot);
    }

    private isCritStructurallyDestroyed(slot: CriticalSlot): boolean {
        return !!slot.destroyed || this.locationPhysicallyDestroyed(slot.loc);
    }

    // ── Destruction ──────────────────────────────────────────────────────────

    /**
    * Mek destruction: propagate crit destruction from structurally destroyed locations,
    * then check engine.
     */
    evaluateDestroyed(): void {
        // Build set of destroyed internal locations, including linked
        const locationsToDestroy = new Set<string>();
        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (this.unit.isInternalLocStructurallyDestroyed(loc)) {
                locationsToDestroy.add(loc);
            }
        });

        // Propagate destruction to crits in destroyed locations (batch update)
        const crits = this.unit.getCritSlots();
        let critsChanged = false;
        for (const crit of crits) {
            if (!crit.loc || !this.unit.locations?.internal?.has(crit.loc)) continue;
            const locDestroyed = locationsToDestroy.has(crit.loc);
            const maxHits = crit.armored ? 2 : 1;
            const shouldDestroy = locDestroyed || (crit.hits ?? 0) >= maxHits;
            if (!!shouldDestroy !== !!crit.destroying) {
                crit.destroying = shouldDestroy ? Date.now() : undefined;
                if (!crit.destroying && crit.destroyed) {
                    crit.destroyed = crit.destroying;
                }
                critsChanged = true;
            }
        }
        if (critsChanged) {
            this.unit.writeCrits([...crits]);
        }

        // Check engine and cockpit destruction (committed state only)
        const svg = this.unit.svg();
        const engineHitThreshold = svg?.querySelectorAll('[id^="engine_hit_"]').length ?? 3;
        const destroyedEngineSlots = crits.filter(slot => this.isNamedCrit(slot, "Engine") && this.isCritUnavailable(slot)).length;
        const engineBlown = destroyedEngineSlots >= engineHitThreshold;
        const cockpitDestroyed = crits.some(slot => this.isNamedCrit(slot, "Cockpit") && this.isCritUnavailable(slot));

        const destroyed = engineBlown || cockpitDestroyed;
        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    // ── PSR ──────────────────────────────────────────────────────────────────

    override readonly autoFall = computed<boolean>(() => {
        const psr = this.unit.turnState().getPSRCheckState();
        return (psr.legsDestroyed?.size || 0) > 0
            || psr.gyroDestroyed === true;
    });

    override getPSRChecks(turnState: TurnState): PSRCheck[] {
        const checks: PSRCheck[] = [];
        const psr = turnState.getPSRCheckState();

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
            if (psr.shutdown) {
                checks.push({
                    fallCheck: 3,
                    pilotCheck: 3,
                    reason: 'Shutdown'
                });
            }
            if (turnState.dmgReceived() >= 20) {
                checks.push({
                    fallCheck: 1,
                    pilotCheck: 1,
                    reason: `Received ${turnState.dmgReceived()} damage`
                });
            }
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
                const critSlots = this.unit.getCritSlots();
                const hasHeavyDutyGyro = critSlots.some(slot => this.isNamedCrit(slot, 'Heavy Duty') && this.isNamedCrit(slot, 'Gyro'));
                const previouslyDestroyedGyroCount = critSlots.filter(slot => {
                    if (!this.isCritUnavailable(slot)) return false;
                    if (!this.isNamedCrit(slot, 'Gyro')) return false;
                    return true;
                }).length;
                if (hasHeavyDutyGyro && (previouslyDestroyedGyroCount + gyroHits) === 1) {
                    checks.push({
                        pilotCheck: 1,
                        reason: 'Gyro hit',
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
            const movementCheck = turnState.applyMovePSR()
                ? this.getCommittedDamageMovementModePSRCheck(turnState.moveMode())
                : null;
            if (movementCheck) {
                checks.push(movementCheck);
            }
        }
        return checks;
    }

    override getCommittedDamageMovementModePSRCheck(moveMode: MotiveModes | null): PSRCheck | null {
        if (moveMode !== 'run' && moveMode !== 'jump') return null;

        const critSlots = this.unit.getCritSlots();
        const hasDamagedGyro = critSlots.some(slot => {
            if (!this.isCritUnavailable(slot)) return false;
            return this.isNamedCrit(slot, 'Gyro');
        });

        let hasDamagedLeg = false;
        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (hasDamagedLeg) return;
            if (!LEG_LOCATIONS.has(loc)) return;
            if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                hasDamagedLeg = true;
            }
        });

        const hasDamagedLegActuators = critSlots.some(slot => {
            if (!slot.name || !slot.loc || !this.isCritUnavailable(slot)) return false;
            if (!LEG_LOCATIONS.has(slot.loc)) return false;
            return this.isNamedCrit(slot, 'Leg') || this.isNamedCrit(slot, 'Foot') || this.isNamedCrit(slot, 'Hip');
        });

        if (moveMode === 'jump') {
            if (hasDamagedGyro) {
                return {
                    fallCheck: 0,
                    pilotCheck: 0,
                    reason: 'Jumping with damaged gyro'
                };
            }
            if (hasDamagedLeg) {
                return {
                    fallCheck: 0,
                    pilotCheck: 0,
                    reason: 'Jumping with damaged leg'
                };
            }
            if (hasDamagedLegActuators) {
                return {
                    fallCheck: 0,
                    pilotCheck: 0,
                    reason: 'Jumping with damaged leg actuator'
                };
            }
            return null;
        }

        if (hasDamagedGyro) {
            return {
                fallCheck: 0,
                pilotCheck: 0,
                reason: 'Running with damaged gyro'
            };
        }
        if (!hasDamagedLegActuators) return null;

        const hasDamagedHip = critSlots.some(slot => {
            if (!slot.name || !slot.loc || !this.isCritUnavailable(slot)) return false;
            if (!LEG_LOCATIONS.has(slot.loc)) return false;
            return this.isNamedCrit(slot, 'Hip');
        });
        if (!hasDamagedHip) return null;

        return {
            fallCheck: 0,
            pilotCheck: 0,
            reason: 'Running with damaged hip'
        };
    }

    override evaluateLegDestroyed(location: string, hits: number): void {
        if (!LEG_LOCATIONS.has(location)) return;
        const turnState = this.unit.turnState();
        const destroyed = this.unit.isInternalLocDestroyed(location);
        let isPsrRelevant = false;
        const psr = turnState.getPSRCheckState();
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
            turnState.setPSRCheckState(psr);
        }
    }

    override evaluateCritSlotHit(crit: CriticalSlot): void {
        if (!crit.loc) return;
        let isPsrRelevant = false;
        const delta = (crit.destroying) ? 1 : -1;
        const turnState = this.unit.turnState();
        const psr = turnState.getPSRCheckState();
        if (LEG_LOCATIONS.has(crit.loc)) {
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
            const critSlots = this.unit.getCritSlots();
            const hasHeavyDutyGyro = critSlots.some(slot => this.isNamedCrit(slot, 'Heavy Duty') && this.isNamedCrit(slot, 'Gyro'));
            const gyroHits = critSlots.filter(slot => {
                if (!this.isDestroyedOrDestroyingCrit(slot)) return false;
                if (!this.isNamedCrit(slot, 'Gyro')) return false;
                return true;
            }).length;
            if (((hasHeavyDutyGyro && gyroHits > 2) || (!hasHeavyDutyGyro && gyroHits > 1))) {
                psr.gyroDestroyed = true;
            } else {
                psr.gyroDestroyed = false;
            }
        }
        if (isPsrRelevant) {
            turnState.setPSRCheckState(psr);
        }
    }

    override heatSources(turnState: TurnState): UnitHeatSource[] {
        const sources: UnitHeatSource[] = [
            {
                id: 'movement',
                label: 'Movement',
                value: this.computeMovementHeat(turnState),
            }
        ];
        const damagedEngineHeat = this.computeDamagedEngineHeat();
        if (damagedEngineHeat > 0) {
            sources.push({
                id: 'damaged-engine',
                label: 'Damaged Engine',
                value: damagedEngineHeat,
            });
        }
        sources.push(...super.heatSources(turnState));
        return sources;
    }

    private computeMovementHeat(turnState: TurnState): number {
        const moveMode = turnState.moveMode();
        const hasXXLEngine = this.hasXXLEngine();
        const superCooledMyomerActive = this.hasActiveSuperCooledMyomer();
        if (moveMode === 'stationary') {
            if (superCooledMyomerActive) return 0;
            return hasXXLEngine ? 2 : 0;
        } else if (moveMode === 'walk') {
            if (superCooledMyomerActive) return 0;
            return hasXXLEngine ? 4 : 1;
        } else if (moveMode === 'run') {
            if (superCooledMyomerActive) return 0;
            return hasXXLEngine ? 6 : 2;
        } else if (moveMode === 'jump') {
            const distance = turnState.moveDistance() || 0;
            return this.computeJumpHeat(distance, hasXXLEngine);
        }
        return 0;
    }

    private computeJumpHeat(distance: number, hasXXLEngine: boolean): number {
        const jumpJetType = this.getWorkingJumpJetType();
        const engineMultiplier = hasXXLEngine ? 2 : 1;
        if (jumpJetType === 'improved') {
            return Math.max(3, Math.ceil((distance * engineMultiplier) / 2));
        }
        const prototypeMultiplier = jumpJetType === 'prototypeImproved' ? 2 : 1;
        const multiplier = engineMultiplier * prototypeMultiplier;
        const heat = distance * multiplier;
        const minimum = 3 * multiplier;
        return Math.max(minimum, heat);
    }

    private getWorkingJumpJetType(): 'standard' | 'improved' | 'prototypeImproved' {
        for (const slot of this.unit.getCritSlots()) {
            const equipment = slot.eq;
            if (this.isCritUnavailable(slot) || !equipment?.hasFlag('F_JUMP_JET')) continue;
            if (equipment.hasFlag('S_PROTOTYPE')) {
                return 'prototypeImproved';
            }
            if (equipment.hasFlag('S_IMPROVED')) return 'improved';
        }
        return 'standard';
    }

    private hasXXLEngine(): boolean {
        return this.unit.getUnit().engine?.startsWith('XXL ') ?? false;
    }

    private hasActiveSuperCooledMyomer(): boolean {
        const superCooledMyomerSlots = this.unit.getCritSlots().filter(slot => this.isSuperCooledMyomerSlot(slot));
        return superCooledMyomerSlots.length > 0
            && superCooledMyomerSlots.some(slot => !this.isCritUnavailable(slot));
    }

    private isSuperCooledMyomerSlot(slot: CriticalSlot): boolean {
        return slot.eq?.hasFlag('F_SCM') === true;
    }

    private computeDamagedEngineHeat(): number {
        if (this.unit.shutdown) return 0;
        const critSlots = this.unit.getCritSlots();
        const engineHits = critSlots.filter(slot => this.isNamedCrit(slot, 'Engine') && this.isDestroyedOrDestroyingCrit(slot)).length;
        return Math.min(10, engineHits * 5);
    }

    private hasTorsoMountedCockpit(): boolean {
        return this.unit.getCritSlots().some(slot => !!slot.loc && TORSO_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'Cockpit'));
    }

    // ── Systems Status ───────────────────────────────────────────────────────

    /** Mek systems status computed from crit slots and locations */
    readonly systemsStatus = computed(() => {
        const critSlots = this.unit.getCritSlots();
        const hasMASC = critSlots.some(slot => this.isNamedCrit(slot, 'MASC'));
        const destroyedMASC = critSlots.some(slot => this.isNamedCrit(slot, 'MASC') && this.isCritUnavailable(slot));
        const hasSupercharger = critSlots.some(slot => this.isNamedCrit(slot, 'Supercharger'));
        const destroyedSupercharger = critSlots.some(slot => this.isNamedCrit(slot, 'Supercharger') && this.isCritUnavailable(slot));
        const jumpJetsCount = critSlots.filter(slot => this.isNamedCrit(slot, 'Jump Jet') || this.isNamedCrit(slot, 'JumpJet')).length;
        const destroyedJumpJetsCount = critSlots.filter(slot => (this.isNamedCrit(slot, 'Jump Jet') || this.isNamedCrit(slot, 'JumpJet')) && this.isCritUnavailable(slot)).length;
        const UMUCount = critSlots.filter(slot => this.isNamedCrit(slot, 'UMU')).length;
        const destroyedUMUCount = critSlots.filter(slot => this.isNamedCrit(slot, 'UMU') && this.isCritUnavailable(slot)).length;
        const hasPartialWings = critSlots.some(slot => slot.eq?.hasFlag('F_PARTIAL_WING'));
        const destroyedPartialWingsCount = hasPartialWings ? critSlots.filter(slot => slot.eq?.hasFlag('F_PARTIAL_WING') && this.isCritUnavailable(slot)).length : 0;
        const partialWingsHeatBonus = hasPartialWings ? Math.max(0, 3 - destroyedPartialWingsCount) : 0;
        const hasTripleStrengthMyomer = critSlots.some(slot => slot.eq?.hasFlag('F_TSM') && !slot.eq?.hasFlag('F_PROTOTYPE'));
        const cockpitLoc = critSlots.find(slot => this.isNamedCrit(slot, "Cockpit"))?.loc ?? 'HD';
        const destroyedSensorsCountInHD = critSlots.filter(slot => slot.loc === 'HD' && this.isNamedCrit(slot, 'Sensor') && this.isCritUnavailable(slot)).length;
        const destroyedSensorsCount = critSlots.filter(slot => this.isNamedCrit(slot, 'Sensor') && this.isCritUnavailable(slot)).length;
        const destroyedTargetingComputers = critSlots.filter(slot => this.isNamedCrit(slot, 'Targeting Computer') && this.isCritUnavailable(slot)).length;

        const internalLocations = new Set<string>(this.unit.locations?.internal?.keys() || []);

        let destroyedLegsCount = 0;
        let destroyedHipsCount = 0;
        let destroyedLegActuatorsCount = 0;
        let destroyedFeetCount = 0;
        let destroyedLegAES = false;

        const checkLeg = (loc: string) => {
            if (!destroyedLegAES) {
                destroyedLegAES = critSlots.some(slot => slot.loc == loc && this.isNamedCrit(slot, 'AES') && this.isCritUnavailable(slot));
            }
            if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                destroyedLegsCount++;
            } else {
                destroyedHipsCount += critSlots.filter(slot => slot.loc === loc && this.isNamedCrit(slot, 'Hip') && this.isCritUnavailable(slot)).length;
                destroyedLegActuatorsCount += critSlots.filter(slot => slot.loc === loc && (this.isNamedCrit(slot, 'Upper Leg') || this.isNamedCrit(slot, 'Lower Leg')) && this.isCritUnavailable(slot)).length;
                destroyedFeetCount += critSlots.filter(slot => slot.loc === loc && this.isNamedCrit(slot, 'Foot') && this.isCritUnavailable(slot)).length;
            }
        };

        if (internalLocations.has('LL') && internalLocations.has('RL')) {
            // Biped and Tripods
            checkLeg('LL');
            checkLeg('RL');
            if (internalLocations.has('CL')) { // Tripods
                checkLeg('CL');
            }
        } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
            // Quadrupeds
            checkLeg('RLL');
            checkLeg('FLL');
            checkLeg('RRL');
            checkLeg('FRL');
        }

        let destroyedArmActuatorsCount = { 'LA': 0, 'RA': 0 };

        // Capabilities
        const getArmsModifiers = (loc: string) => {
            const destroyedAES = critSlots.some(slot => slot.loc == loc && this.isNamedCrit(slot, 'AES') && this.isCritUnavailable(slot));
            if (!this.unit.locations?.armor?.has(loc)) {
                return null;
            }

            const destroyedShoulder = critSlots.some(slot => slot.loc == loc && this.isNamedCrit(slot, 'Shoulder') && this.isCritUnavailable(slot));
            const destroyedHand = critSlots.some(slot => slot.loc == loc && this.isNamedCrit(slot, 'Hand') && this.isCritUnavailable(slot));
            const destroyedUpperArmsCount = critSlots.filter(slot => slot.loc == loc && this.isNamedCrit(slot, 'Upper Arm') && this.isCritUnavailable(slot)).length;
            const destroyedLowerArmsCount = critSlots.filter(slot => slot.loc == loc && this.isNamedCrit(slot, 'Lower Arm') && this.isCritUnavailable(slot)).length;
            const destroyedUpperArms = destroyedUpperArmsCount > 0;
            const destroyedLowerArms = destroyedLowerArmsCount > 0;
            destroyedArmActuatorsCount[loc as 'LA' | 'RA'] += destroyedUpperArmsCount + destroyedLowerArmsCount;

            return {
                canPunch: !destroyedShoulder,
                canPhysWeapon: !destroyedShoulder && !destroyedHand,
                pushMod: destroyedShoulder ? 2 : 0,
                punchMod: (destroyedHand ? 1 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0),
                fireMod: destroyedShoulder ? 4 : (destroyedUpperArms ? 1 : 0) + (destroyedLowerArms ? 1 : 0),
                physWeaponMod: (destroyedHand ? 2 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0),
                singleArmMod: destroyedAES ? 1 : 0,
            };
        };
        const locationModifiers: { [key: string]: { canPunch: boolean; canPhysWeapon: boolean; pushMod: number; punchMod: number; fireMod: number; physWeaponMod: number; singleArmMod: number; } | null } = {
            'LA': getArmsModifiers('LA'),
            'RA': getArmsModifiers('RA'),
        };

        return {
            hasMASC,
            destroyedMASC,
            hasSupercharger,
            destroyedSupercharger,
            jumpJetsCount,
            destroyedJumpJetsCount,
            UMUCount,
            destroyedUMUCount,
            hasPartialWings,
            destroyedPartialWingsCount,
            partialWingsHeatBonus,
            internalLocations,
            hasTripleStrengthMyomer,
            tripleStrengthMyomerMoveBonusActive: (this.unit.getHeat().current >= 9 && hasTripleStrengthMyomer),
            cockpitLoc,
            destroyedSensorsCountInHD,
            destroyedSensorsCount,
            destroyedTargetingComputers,
            destroyedLegAES,
            destroyedLegsCount,
            destroyedHipsCount,
            destroyedLegActuatorsCount,
            destroyedFeetCount,
            destroyedArmActuatorsCount,
            locationModifiers: locationModifiers,
        };
    });

    // ── PSR ──────────────────────────────────────────────────────────────────

    override readonly PSRModifiers = computed<{ modifier: number; modifiers: PSRCheck[] }>(() => {
        const ignoreLeg = new Set<string>();
        let preExisting = 0;
        const modifiers: PSRCheck[] = [];

        let isFourLegged = false;
        let undamagedLegs = true;
        // Calculate pre-existing leg destruction modifiers. If a leg is gone, is gone.
        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (!LEG_LOCATIONS.has(loc)) return; // Only consider leg locations
            if (!isFourLegged && FOUR_LEGGED_LOCATIONS.has(loc)) {
                isFourLegged = true;
            }
            if (this.unit.isInternalLocDestroyed(loc)) {
                undamagedLegs = false;
                ignoreLeg.add(loc); // Track destroyed legs, we ignore further modifiers on that leg
                preExisting += 5;
                modifiers.push({
                    pilotCheck: 5,
                    reason: 'Leg Destroyed'
                });
            }
        });
        if (isFourLegged && undamagedLegs) {
            preExisting -= 2; // Four-legged unit with all legs intact gets -2 modifier
            modifiers.push({
                pilotCheck: -2,
                reason: "All legs are intact"
            });
        }
        // Calculate current turn modifiers
        let ignorePreExistingGyro = false;
        let currentModifiers = 0;
        const turnState = this.unit.turnState();
        const phasePSRs = turnState.getPSRChecks();
        phasePSRs.forEach((check) => {
            if (check.pilotCheck === undefined) return; // No fall check, skip
            if (check.loc) {
                if (ignoreLeg.has(check.loc)) {
                    return; // Ignore this leg for further calculations
                }
            }
            currentModifiers += check.pilotCheck;
            if (check.legFilter) {
                ignoreLeg.add(check.legFilter); // Ignore this leg for further calculations
            }
            if (check.ignorePreExistingGyro) {
                ignorePreExistingGyro = true;
            }
            modifiers.push(check);
        });

        // Calculate pre-existing modifiers for hips and leg actuators destroyed the previous turns
        const critSlots = this.unit.getCritSlots();
        const hasAESinLegs = critSlots.some(slot => slot.name && slot.loc && !this.isCritUnavailable(slot) && LEG_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'AES'));
        const hasAESinLegsDestroyed = critSlots.some(slot => slot.name && slot.loc && this.isCritUnavailable(slot) && LEG_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'AES'));
        if (hasAESinLegs && !hasAESinLegsDestroyed) {
            preExisting -= 2; // AES in legs intact gives -2 modifier
            modifiers.push({
                pilotCheck: -2,
                reason: "Mounts AES in its legs"
            });
        }
        const hardenedArmor = this.unit.getUnit().armorType === 'Hardened';
        if (hardenedArmor) {
            preExisting += 1; // Hardened armor gives +1 modifier
            modifiers.push({
                pilotCheck: 1,
                reason: "Mounts Hardened Armor"
            });
        }
        const modularArmorPanelsCount = critSlots.filter(slot => this.isNamedCrit(slot, 'Modular Armor')).length;
        if (modularArmorPanelsCount > 0) {
            const destroyedModularArmorPanelsCount = critSlots.filter(slot => this.isNamedCrit(slot, 'Modular Armor') && (slot.destroyed || ((slot.consumed ?? 0) >= 10))).length;
            if (destroyedModularArmorPanelsCount < modularArmorPanelsCount) {
                preExisting += 1; // Modular armor gives +1 modifier (until destroyed or fully consumed)
                modifiers.push({
                    pilotCheck: 1,
                    reason: "Mounts Modular Armor"
                });
            }
        }
        if (this.hasDroneOperatingSystem()) {
            preExisting += 1;
            modifiers.push({
                pilotCheck: 1,
                reason: 'Drone operating system'
            });
        }
        const hasSmallOrTorsoCockpit = critSlots.some(slot => slot.loc
            && ((this.isNamedCrit(slot, 'Cockpit') && this.isNamedCrit(slot, 'Small'))
                || (this.isNamedCrit(slot, 'Command') && this.isNamedCrit(slot, 'Small'))))
            || this.hasTorsoMountedCockpit();
        if (hasSmallOrTorsoCockpit && !this.hasDroneOperatingSystem()) {
            preExisting += 1; // Small or Torso cockpit gives +1 modifier
            modifiers.push({
                pilotCheck: +1,
                reason: "Mounts small or torso cockpit"
            });
        }
        const destroyedHips = critSlots.filter(slot => slot.loc && this.isCritUnavailable(slot) && LEG_LOCATIONS.has(slot.loc) && !ignoreLeg.has(slot.loc) && this.isNamedCrit(slot, 'Hip'));
        for (const hip of destroyedHips) {
            if (!hip.loc) continue;
            preExisting += 2;
            modifiers.push({
                pilotCheck: 2,
                reason: 'Hip Destroyed'
            });
            ignoreLeg.add(hip.loc); // Track destroyed hip locations, we ignore further modifiers on that leg
        }
        const relevantDestroyedLegActuatorsCount = critSlots.filter(slot => {
            if (!slot.loc || !slot.name || !this.isCritUnavailable(slot)) return false;
            if (!LEG_LOCATIONS.has(slot.loc)) return false;
            if (ignoreLeg.has(slot.loc)) return false;
            if (!this.isNamedCrit(slot, 'Foot') && !this.isNamedCrit(slot, 'Leg')) return false;
            return true;
        }).length;
        preExisting += relevantDestroyedLegActuatorsCount;
        if (relevantDestroyedLegActuatorsCount > 0) {
            modifiers.push({
                pilotCheck: relevantDestroyedLegActuatorsCount,
                reason: 'Leg Actuator(s) Destroyed'
            });
        }
        if (!ignorePreExistingGyro) {
            const hasHeavyDutyGyro = critSlots.some(slot => this.isNamedCrit(slot, 'Heavy Duty') && this.isNamedCrit(slot, 'Gyro'));
            const previouslyDestroyedGyroCount = critSlots.filter(slot => {
                if (!this.isCritUnavailable(slot)) return false;
                if (!this.isNamedCrit(slot, 'Gyro')) return false;
                return true;
            }).length;
            if (hasHeavyDutyGyro && (previouslyDestroyedGyroCount === 1)) {
                modifiers.push({
                    pilotCheck: 1,
                    reason: 'Heavy Duty Gyro first damage'
                });
                preExisting += 1;
            } else if (previouslyDestroyedGyroCount > 0) {
                preExisting += 3;
                modifiers.push({
                    pilotCheck: 3,
                    reason: 'Gyro damaged'
                });
            }
        }
        const finalModifier = preExisting + currentModifiers;
        return { modifier: finalModifier, modifiers: modifiers };
    });

    override readonly PSRTargetRoll = computed<number>(() => {
        const pilot = this.unit.getCrewMember(0);
        const piloting = pilot?.getSkill('piloting') ?? 5;
        const modifiers = this.PSRModifiers();
        return piloting + modifiers.modifier;
    });

    override getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null {
        const movement = this.movementState();
        if (moveMode === 'walk') return movement?.maxWalk ?? 0;
        if (moveMode === 'run') return movement?.maxRun ?? 0;
        if (moveMode === 'jump') return movement?.jump ?? 0;
        if (moveMode === 'UMU') return movement?.UMU ?? 0;
        return null;
    }

    override getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, turnState: TurnState): number | null {
        if (moveMode !== 'run') return this.getMaxDistanceForMoveMode(moveMode);
        const movement = this.movementState();
        if (!movement || movement.run === 0) return 0;

        const runValueCoeff = 1.5 + this.unit.getRunMovementMultiplierBonus(turnState);
        const armorModifierOnRun = (this.unit.getUnit().armorType === 'Hardened') ? -1 : 0;
        return Math.max(0, Math.round(movement.walk * runValueCoeff) + armorModifierOnRun);
    }

    override getAttackMovementModifier(moveMode: MotiveModes | null | undefined, airborne: boolean = false): number {
        const baseUnit = this.unit.getUnit();
        // LAM have different movement modifiers when airborne
        if (baseUnit.subtype === 'Land-Air BattleMek' && airborne) { 
            if (moveMode === 'walk') return 3;
            if (moveMode === 'run') return 4;
        }
        return getDefaultAttackerMovementModifier(moveMode);
    }

    override getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries = [...super.getAttackModifierBreakdown(turnState)];
        if (turnState.unitState.hasCondition('prone')) {
            const subtype = this.unit.getUnit().subtype;
            let proneEntry: UnitModifierBreakdownEntry | null = null;
            const isTripod = subtype.startsWith('Tripod');
            const isQuad = subtype.startsWith('Quad');
            if (isTripod || isQuad) {
                const legLocations = isTripod ? TRIPOD_LEGS : QUAD_LEGS;
                let proneModifier = isTripod ? 1 : 0;
                for (const loc of legLocations) {
                    if (!this.unit.locations?.internal?.has(loc) || this.unit.isInternalLocCommittedDestroyed(loc)) {
                        proneModifier = TN_PRONE_ATTACKER;
                    }
                }
                const hasCommittedHipHit = this.unit.getCritSlots().some(slot => {
                    if (!slot.loc || !legLocations.has(slot.loc)) return false;
                    if (!this.isNamedCrit(slot, 'Hip')) return false;
                    return this.isCritUnavailable(slot);
                });
                proneEntry = { label: 'Prone', modifier: hasCommittedHipHit ? TN_PRONE_ATTACKER : proneModifier };
            } else { 
                // Biped
                proneEntry = { label: 'Prone', modifier: TN_PRONE_ATTACKER };
            }
            if (proneEntry) {
                entries.push(proneEntry);
            }
        }
        return entries;
    }

    override getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries = [...super.getDefenseModifierBreakdown(turnState)];
        if (turnState.unitState.hasCondition('prone')) {
            entries.push({
                label: 'Prone',
                modifier: Math.max(TN_PRONE, TN_PRONE_ADJACENT),
                alternateModifier: Math.min(TN_PRONE, TN_PRONE_ADJACENT),
                alternateModifierLabel: 'adjacent',
            });
        }
        return entries;
    }

    // ── Heat Scale ───────────────────────────────────────────────────────────

    /**
     * BattleTech Heat Scale
     * Sorted by heat level. Each entry carries the cumulative effect at that threshold.
     * - move:     MP penalty (negative)
     * - fire:     to-hit modifier (positive)
     * - shutdown: target number to avoid shutdown (100 = virtually automatic, no roll)
     * - ammoExp:  target number to avoid ammo explosion
     */
    static readonly HEAT_SCALE: readonly HeatScaleEntry[] = [
        { heat: 5,  move: -1 },
        { heat: 8,  fire: 1 },
        { heat: 10, move: -2 },
        { heat: 13, fire: 2 },
        { heat: 14, shutdown: 4 },
        { heat: 15, move: -3 },
        { heat: 17, fire: 3 },
        { heat: 18, shutdown: 6 },
        { heat: 19, ammoExp: 4 },
        { heat: 20, move: -4 },
        { heat: 22, shutdown: 8 },
        { heat: 23, ammoExp: 6 },
        { heat: 24, fire: 4 },
        { heat: 25, move: -5 },
        { heat: 26, shutdown: 10 },
        { heat: 28, ammoExp: 8 },
        { heat: 30, shutdown: 100 }, // always fails
    ];

    /** Compute heat-based move/fire modifiers from current heat level. */
    static getHeatEffects(heat: number): { moveModifier: number; fireModifier: number } {
        return getHeatEffects(MekRules.HEAT_SCALE, heat);
    }

    // ── Heat Dissipation ─────────────────────────────────────────────────────

    /**
     * Mek heat dissipation: extends base with SuperCooledMyomer and partial wing bonus.
     */
    override readonly heatDissipation = computed(() => {
        const base = this.heatMgmt.baseDissipation();
        if (!base) return null;

        const profile = this.heatMgmt.heatsinkProfile();
        const critSlots = this.unit.getCritSlots();

        // SuperCooledMyomer destroyed reduces dissipation
        const destroyedSuperCooledMyomer = critSlots.filter(
            slot => this.isSuperCooledMyomerSlot(slot) && this.isCritUnavailable(slot)
        ).length;

        let totalDissipation = base.totalDissipation;
        if (destroyedSuperCooledMyomer > 0 && profile) {
            totalDissipation -= destroyedSuperCooledMyomer * profile.engineDissipationPer;
            totalDissipation = Math.max(0, totalDissipation);
        }

        // Partial wing heat bonus
        const partialWingBonus = this.systemsStatus().hasPartialWings
            ? Math.max(0, 3 - this.systemsStatus().destroyedPartialWingsCount)
            : 0;

        return {
            ...base,
            totalDissipation,
            destroyedSuperCooledMyomer,
            /** Total dissipation including partial wing bonus (for heat profile display). */
            totalDissipationWithWings: totalDissipation + partialWingBonus,
            partialWingBonus,
        };
    });

    // ── Movement State ───────────────────────────────────────────────────────

    // Derive movement profile from the unit conditions, before any heat effect or other modifiers are applied.
    private computeBaseMovementProfile() {
        if (!this.unit.isLoaded()) return null;
        const unit = this.unit.getUnit();
        if (!unit) return null;

        let walkValue = unit.walk;
        let jumpValue = unit.jump;
        let UMUValue = unit.umu;
        let moveImpaired = false;

        const systemsStatus = this.systemsStatus();
        const internalLocations = systemsStatus.internalLocations;
        let runDisabled = false;

        // Walk MP and crits computation
        if (internalLocations.has('LL') && internalLocations.has('RL')) {
            for (let i = 0; i < systemsStatus.destroyedHipsCount; i++) {
                walkValue = Math.ceil(walkValue * 0.5);
                moveImpaired = true;
            }
            if (systemsStatus.destroyedLegsCount == 1) {
                walkValue = 1;
                moveImpaired = true;
                runDisabled = true;
            }
            if (systemsStatus.destroyedLegsCount >= 2) {
                walkValue = 0;
                moveImpaired = true;
                runDisabled = true;
            }
        } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
            // Quadrupeds
            if (systemsStatus.destroyedHipsCount != 0) {
                moveImpaired = true;
                walkValue -= systemsStatus.destroyedHipsCount;
            }
            if (systemsStatus.destroyedLegsCount === 1) {
                walkValue = walkValue - 1;
                moveImpaired = true;
            }
            if (systemsStatus.destroyedLegsCount === 2) {
                walkValue = 1;
                moveImpaired = true;
                runDisabled = true;
            }
            if (systemsStatus.destroyedLegsCount >= 3) {
                walkValue = 0;
                moveImpaired = true;
                runDisabled = true;
            }
        }
        walkValue -= systemsStatus.destroyedLegActuatorsCount;
        walkValue -= systemsStatus.destroyedFeetCount;
        if (systemsStatus.destroyedLegActuatorsCount != 0 || systemsStatus.destroyedFeetCount != 0) {
            moveImpaired = true;
        }
        
        // Jump MP
        if (systemsStatus.destroyedJumpJetsCount === systemsStatus.jumpJetsCount) {
            jumpValue = 0;
        } else {
            jumpValue = Math.max(0, jumpValue - systemsStatus.destroyedJumpJetsCount);
            if (systemsStatus.hasPartialWings) {
                const maxWingBonus = unit.tons <= 55 ? 2 : 1;
                jumpValue -= Math.min(systemsStatus.destroyedPartialWingsCount, maxWingBonus);
            }
        }

        if (systemsStatus.destroyedUMUCount === systemsStatus.UMUCount) {
            UMUValue = 0;
        } else {
            UMUValue = Math.max(0, UMUValue - systemsStatus.destroyedUMUCount);
        }

        return {
            walk: walkValue,
            runDisabled,
            jump: jumpValue,
            UMU: UMUValue,
            moveImpaired,
            jumpImpaired: (jumpValue < unit.jump),
            UMUImpaired: (UMUValue < unit.umu),
        };
    }

    // Returns the movement capabilities of the unit after applying heat, damage and other modifiers.
    private computeMovementState() {
        const unit = this.unit.getUnit();
        if (!unit) return null;
        const baseMovement = this.computeBaseMovementProfile();
        if (!baseMovement) return null;

        if (this.unit.getCondition('disconnected') || this.allCrewUnconscious()) {
            return {
                moveImpaired: true,
                walk: 0,
                maxWalk: 0,
                run: 0,
                maxRun: 0,
                jumpImpaired: unit.jump > 0,
                jump: 0,
                UMUImpaired: unit.umu > 0,
                UMU: 0,
            };
        }

        const systemsStatus = this.systemsStatus();
        let walkValue = baseMovement?.walk ?? 0;

        // Heat effects
        const heat = this.unit.getHeat().current;
        const heatMoveModifier = MekRules.getHeatEffects(heat).moveModifier;

        walkValue += heatMoveModifier;
        walkValue = Math.max(0, walkValue);
        let maxWalkValue = walkValue;
        if (systemsStatus.destroyedLegsCount === 0) {
            if (systemsStatus.tripleStrengthMyomerMoveBonusActive) {
                walkValue += 2;
                maxWalkValue += 2;
            } else if (systemsStatus.hasTripleStrengthMyomer) {
                maxWalkValue += 1 - heatMoveModifier; // Simulate heat at 9+
            }
            walkValue = Math.max(0, walkValue);
        }

        // Run MP
        const hasWorkingMASC = systemsStatus.hasMASC && !systemsStatus.destroyedMASC;
        const hasWorkingSupercharger = systemsStatus.hasSupercharger && !systemsStatus.destroyedSupercharger;
        const armorModifierOnRun = (unit.armorType === 'Hardened') ? -1 : 0;
        let runValue: number;
        let maxRunValue: number;
        if (walkValue === 0 || baseMovement.runDisabled) {
            runValue = 0;
            maxRunValue = 0;
        } else {
            runValue = Math.round(walkValue * 1.5) + armorModifierOnRun;
            let runValueCoeff = 1.5;
            if (hasWorkingMASC && hasWorkingSupercharger) {
                runValueCoeff = 2.5;
            } else if (hasWorkingMASC || hasWorkingSupercharger) {
                runValueCoeff = 2;
            }
            maxRunValue = Math.round(walkValue * runValueCoeff) + armorModifierOnRun;
            if (systemsStatus.hasTripleStrengthMyomer && !systemsStatus.tripleStrengthMyomerMoveBonusActive) {
                maxRunValue = Math.round((walkValue + (1 - heatMoveModifier)) * runValueCoeff) + armorModifierOnRun;
            }
        }

        return {
            moveImpaired: baseMovement.moveImpaired || (walkValue < unit.walk),
            walk: walkValue,
            maxWalk: maxWalkValue,
            run: runValue,
            maxRun: maxRunValue,
            jumpImpaired: baseMovement.jumpImpaired,
            jump: baseMovement.jump,
            UMUImpaired: baseMovement.UMUImpaired,
            UMU: baseMovement.UMU
        };
    };

    readonly movementState = computed(() => {
        return this.computeMovementState();
    });

    // ── Physical Combat State ────────────────────────────────────────────────

    /**
     * Derived physical combat capabilities: kick/punch/push/club availability
     * and hit modifiers from actuator/arm damage.
     */
    readonly physicalCombat = computed(() => {
        if (!this.unit.isLoaded()) return null;

        const systemsStatus = this.systemsStatus();
        const destroyedLA = this.unit.isInternalLocCommittedDestroyed('LA');
        const destroyedRA = this.unit.isInternalLocCommittedDestroyed('RA');
        const locationModifiers = systemsStatus.locationModifiers;

        // Spike bonus for charge attacks
        const critSlots = this.unit.getCritSlots();
        const totalSpikes = critSlots.filter(slot => this.isNamedCrit(slot, 'Spikes')).length;
        const spikeBonus = totalSpikes > 0 ? {
            total: totalSpikes,
            working: critSlots.filter(slot => this.isNamedCrit(slot, 'Spikes') && !this.isCritUnavailable(slot)).length,
        } : null;

        return {
            canKick: systemsStatus.destroyedLegsCount === 0 && systemsStatus.destroyedHipsCount === 0,
            kickMod: (systemsStatus.destroyedLegActuatorsCount * 2) + (systemsStatus.destroyedFeetCount) + (systemsStatus.destroyedLegAES ? 1 : 0),
            canPunch: {
                'LA': (locationModifiers['LA']?.canPunch && !destroyedLA) || false,
                'RA': (locationModifiers['RA']?.canPunch && !destroyedRA) || false,
            },
            punchMod: {
                'LA': locationModifiers['LA']?.punchMod || 0,
                'RA': locationModifiers['RA']?.punchMod || 0,
            },
            canPhysWeapon: {
                'LA': (locationModifiers['LA']?.canPhysWeapon && !destroyedLA) || false,
                'RA': (locationModifiers['RA']?.canPhysWeapon && !destroyedRA) || false,
            },
            physWeaponMod: {
                'LA': locationModifiers['LA']?.physWeaponMod || 0,
                'RA': locationModifiers['RA']?.physWeaponMod || 0,
            },
            canPush: !destroyedLA && !destroyedRA,
            pushMod: (locationModifiers['LA']?.pushMod || 0) + (locationModifiers['RA']?.pushMod || 0),
            canClub: (locationModifiers['LA']?.canPhysWeapon && !destroyedLA) && (locationModifiers['RA']?.canPhysWeapon && !destroyedRA),
            clubMod: (locationModifiers['LA']?.physWeaponMod || 0) + (locationModifiers['RA']?.physWeaponMod || 0),
            spikeBonus,
        };
    });

    // ── Fire Control State ───────────────────────────────────────────────────

    /**
     * Derived fire control: weapon-fire availability, sensor damage modifiers,
     * heat-based to-hit penalties, and per-arm fire modifiers.
     */
    readonly fireControl = computed(() => {
        if (!this.unit.isLoaded()) return null;

        const systemsStatus = this.systemsStatus();
        const heat = this.unit.getHeat().current;
        const heatFireModifier = MekRules.getHeatEffects(heat).fireModifier;

        let canFire = true;
        if (systemsStatus.cockpitLoc === 'HD' && systemsStatus.destroyedSensorsCount >= 2) {
            canFire = false;
        } else if (systemsStatus.destroyedSensorsCount >= 3) {
            canFire = false;
        }

        let globalFireMod = heatFireModifier;
        if (systemsStatus.cockpitLoc === 'HD' && systemsStatus.destroyedSensorsCount > 0) {
            globalFireMod += (systemsStatus.destroyedSensorsCount * 2);
        } else if (systemsStatus.cockpitLoc !== 'HD' && systemsStatus.destroyedSensorsCountInHD < 2 && systemsStatus.destroyedSensorsCount >= 1) {
            globalFireMod += systemsStatus.destroyedSensorsCount * 2;
        }

        let globalMod = 0;
        if (systemsStatus.cockpitLoc !== 'HD' && systemsStatus.destroyedSensorsCountInHD >= 2) {
            globalMod += 4;
        }

        const locationModifiers = systemsStatus.locationModifiers;
        return {
            canFire,
            globalFireMod,
            fireMod: {
                'LA': locationModifiers['LA']?.fireMod || 0,
                'RA': locationModifiers['RA']?.fireMod || 0,
            },
            globalMod,
            singleArmMod: {
                'LA': locationModifiers['LA']?.singleArmMod || 0,
                'RA': locationModifiers['RA']?.singleArmMod || 0,
            },
        };
    });

    // ── Per-Entry Inventory State ─────────────────────────────────────────────

    /**
     * Compute game state for ALL inventory entries in a single pass.
     */
    private readonly entryStates = computed<Map<MountedEquipment, MountedEquipmentRuleState>>(() => {
        const entries = this.unit.getInventory();
        const result = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>();
        for (const entry of entries) {
            result.set(entry, this.computeEntryState(entry));
        }
        return result;
    });

    override computeAllEntryStates(): Map<MountedEquipment, MountedEquipmentRuleState> {
        return this.entryStates();
    }

    private isEntryDestroyedByCriticalDamage(entry: MountedEquipment): boolean {
        const destroyedCritSlots = this.entryCriticalSlots(entry).filter(slot => this.isCritStructurallyDestroyed(slot)).length;
        // TODO: Equipment with F_SURVIVES_TWO_CRIT_HITS should use a higher destruction threshold here.
        const destructionThreshold = 1;
        return destroyedCritSlots >= destructionThreshold;
    }

    /**
     * Compute per-entry game state (damaged/disabled/hitMod) for an inventory entry.
     * Pure rules logic — no SVG/DOM access.
     */
    override computeEntryState(entry: MountedEquipment): MountedEquipmentRuleState {
        const physicallyDestroyed = this.entryInPhysicallyDestroyedLocation(entry);
        const functionallyDestroyed = this.entryInFunctionallyDestroyedLocation(entry);
        let isDamaged = entry.committedDestroyed() || physicallyDestroyed || this.isEntryDestroyedByCriticalDamage(entry);
        let isDisabled = functionallyDestroyed || this.isEntryStateDisabled(entry);
        let hitMod = 0;

        const physical = this.physicalCombat();
        const fire = this.fireControl();
        const systemsStatus = this.systemsStatus();
        if (!physical || !fire) return { isDamaged, isDisabled, hitMod };

        if (fire.globalMod !== 0) hitMod += fire.globalMod;
        if (entry.locations?.size === 1) {
            const singleLoc = Array.from(entry.locations)[0];
            if (singleLoc in fire.singleArmMod) {
                hitMod += fire.singleArmMod[singleLoc as ArmLocation];
            }
        }

        if (entry.physical) {
            switch (entry.name) {
                case 'punch': {
                    const loc = Array.from(entry.locations!)[0] as ArmLocation;
                    if (loc in physical.canPunch && !physical.canPunch[loc]) isDisabled = true;
                    if (loc in physical.punchMod) hitMod += physical.punchMod[loc];
                    break;
                }
                case 'club':
                    if (!physical.canClub) isDisabled = true;
                    hitMod += physical.clubMod;
                    break;
                case 'push':
                    if (!physical.canPush) isDisabled = true;
                    hitMod += physical.pushMod || 0;
                    break;
                case 'kick [talons]':
                case 'kick':
                    if (!physical.canKick) isDisabled = true;
                    hitMod += physical.kickMod;
                    break;
            }
        } else if (entry.equipment?.flags.has('F_CLUB') || entry.equipment?.flags.has('F_HAND_WEAPON')) {
            entry.locations?.forEach(loc => {
                if ((loc in physical.canPhysWeapon) && !physical.canPhysWeapon[loc as ArmLocation]) isDisabled = true;
                if (loc in physical.physWeaponMod) hitMod += physical.physWeaponMod[loc as ArmLocation];
            });
        } else {
            if (!fire.canFire) isDisabled = true;
            if (fire.globalFireMod) hitMod += fire.globalFireMod;
            entry.locations?.forEach(loc => {
                if (loc in fire.fireMod) hitMod += fire.fireMod[loc as ArmLocation];
            });
            if (systemsStatus.destroyedTargetingComputers > 0 && entry.equipment) {
                const equipment = entry.parent?.equipment ?? entry.equipment;
                if ((equipment.flags.has('F_ENERGY') || equipment.flags.has('F_BALLISTIC'))
                    && equipment.flags.has('F_DIRECT_FIRE')) {
                    hitMod += 1;
                }
            }
        }
        return { isDamaged, isDisabled, hitMod };
    }

    private entryInPhysicallyDestroyedLocation(entry: MountedEquipment): boolean {
        if (this.entryCriticalSlots(entry).some(slot => this.locationPhysicallyDestroyed(slot.loc))) return true;
        return Array.from(entry.locations ?? []).some(loc => this.locationPhysicallyDestroyed(loc));
    }

    private entryInFunctionallyDestroyedLocation(entry: MountedEquipment): boolean {
        if (this.entryCriticalSlots(entry).some(slot => this.locationFunctionallyDestroyed(slot.loc))) return true;
        return Array.from(entry.locations ?? []).some(loc => this.locationFunctionallyDestroyed(loc));
    }

    private locationPhysicallyDestroyed(loc: string | undefined): boolean {
        if (!loc) return false;
        return this.unit.isInternalLocCommittedStructurallyDestroyed(loc);
    }

    private locationFunctionallyDestroyed(loc: string | undefined): boolean {
        if (!loc) return false;
        return this.unit.isInternalLocCommittedDestroyed(loc);
    }

    /**
     * Compute melee damage after actuator losses and TSM modifiers.
     * @param baseDamage   - original damage value from the record sheet
     * @param attackType   - which melee attack (determines which actuators matter)
     * @param loc          - arm location (for punch/physWeapon)
     * @param ignoreMyomer - true for weapons immune to TSM bonus (e.g. flails)
     */
    computeMeleeDamage(
        baseDamage: number,
        attackType: 'punch' | 'kick' | 'club' | 'physWeapon',
        loc?: string,
        ignoreMyomer?: boolean
    ): { damage: number; maxDamage: number } {
        const ss = this.systemsStatus();
        let damage = baseDamage;

        // Actuator damage halving
        if (attackType === 'punch' && loc) {
            for (let i = 0; i < ss.destroyedArmActuatorsCount[loc as ArmLocation]; i++) {
                damage = Math.floor(damage * 0.5);
                if (damage < 1) damage = 1;
            }
        } else if (attackType === 'kick') {
            for (let i = 0; i < ss.destroyedLegActuatorsCount; i++) {
                damage = Math.floor(damage * 0.5);
                if (damage < 1) damage = 1;
            }
        }

        // TSM modifier
        let maxDamage = damage;
        if (!ignoreMyomer) {
            if (ss.hasTripleStrengthMyomer) maxDamage *= 2;
            if (ss.tripleStrengthMyomerMoveBonusActive) damage *= 2;
        }

        return { damage, maxDamage };
    }

    private isNamedCrit(slot: CriticalSlot, name: string): boolean {
        return (slot.name && slot.name.includes(name)) ? true : false;
    }
}
