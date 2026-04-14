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
import type { MountedEquipment } from '../force-serialization';
import type { UnitTypeRules } from './unit-type-rules';
import { linkedLocs, LEG_LOCATIONS, FOUR_LEGGED_LOCATIONS } from '../common.model';
import type { PSRCheck } from '../turn-state.model';
import { type HeatScaleEntry, HeatManagement, getHeatEffects } from './heat-management';

type ArmLocation = 'LA' | 'RA';

/**
 * Mek-specific game rules: destruction evaluation, systems status,
 * Piloting Skill Roll modifiers, and PSR target roll.
 */
export class MekRules implements UnitTypeRules {

    private readonly heatMgmt: HeatManagement;

    constructor(private unit: CBTForceUnit) {
        this.heatMgmt = new HeatManagement(unit);
    }

    // ── Destruction ──────────────────────────────────────────────────────────

    /**
     * Mek destruction: propagate crit destruction from destroyed locations
     * (including linked: RT→RA, LT→LA), then check engine/cockpit.
     */
    evaluateDestroyed(): void {
        // Build set of destroyed internal locations, including linked
        const locationsToDestroy = new Set<string>();
        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (this.unit.isInternalLocDestroyed(loc)) {
                locationsToDestroy.add(loc);
                const linked = linkedLocs[loc];
                if (linked) {
                    for (const linkedLoc of linked) {
                        if (this.unit.locations?.internal?.has(linkedLoc)) {
                            locationsToDestroy.add(linkedLoc);
                        }
                    }
                }
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
        const destroyedEngineSlots = crits.filter(slot => slot.name?.includes("Engine") && slot.destroyed).length;
        const engineBlown = destroyedEngineSlots >= engineHitThreshold;
        const cockpitDestroyed = crits.some(slot => slot.name?.includes("Cockpit") && slot.destroyed);

        const destroyed = engineBlown || cockpitDestroyed;
        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    // ── Systems Status ───────────────────────────────────────────────────────

    /** Mek systems status computed from crit slots and locations */
    readonly systemsStatus = computed(() => {
        const critSlots = this.unit.getCritSlots();
        const hasMASC = critSlots.some(slot => slot.name && slot.name.includes('MASC'));
        const destroyedMASC = critSlots.some(slot => slot.name && slot.name.includes('MASC') && slot.destroyed);
        const hasSupercharger = critSlots.some(slot => slot.name && slot.name.includes('Supercharger'));
        const destroyedSupercharger = critSlots.some(slot => slot.name && slot.name.includes('Supercharger') && slot.destroyed);
        const jumpJetsCount = critSlots.filter(slot => slot.name && (slot.name.includes('Jump Jet') || slot.name.includes('JumpJet'))).length;
        const destroyedJumpJetsCount = critSlots.filter(slot => slot.name && (slot.name.includes('Jump Jet') || slot.name.includes('JumpJet')) && slot.destroyed).length;
        const UMUCount = critSlots.filter(slot => slot.name && (slot.name.includes('UMU'))).length;
        const destroyedUMUCount = critSlots.filter(slot => slot.name && (slot.name.includes('UMU')) && slot.destroyed).length;
        const hasPartialWings = critSlots.some(slot => slot.name && slot.name.includes('PartialWing'));
        const destroyedPartialWings = hasPartialWings ? critSlots.filter(slot => slot.name && slot.name.includes('PartialWing') && slot.destroyed).length : 0;
        const hasTripleStrengthMyomer = critSlots.some(slot => slot.name && slot.name.includes('Triple Strength Myomer'));
        const cockpitLoc = critSlots.find(slot => slot.name && slot.name.includes("Cockpit"))?.loc ?? 'HD';
        const destroyedSensorsCountInHD = critSlots.filter(slot => slot.loc === 'HD' && slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        const destroyedSensorsCount = critSlots.filter(slot => slot.name && slot.name.includes('Sensor') && slot.destroyed).length;
        const destroyedTargetingComputers = critSlots.filter(slot => slot.name && slot.name.includes('Targeting Computer') && slot.destroyed).length;

        const internalLocations = new Set<string>(this.unit.locations?.internal?.keys() || []);

        let destroyedLegsCount = 0;
        let destroyedHipsCount = 0;
        let destroyedLegActuatorsCount = 0;
        let destroyedFeetCount = 0;
        let destroyedLegAES = false;

        const checkLeg = (loc: string) => {
            if (!destroyedLegAES) {
                destroyedLegAES = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('AES') && slot.destroyed);
            }
            if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                destroyedLegsCount++;
            } else {
                destroyedHipsCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name.includes('Hip') && slot.destroyed).length;
                destroyedLegActuatorsCount += critSlots.filter(slot => slot.loc === loc && slot.name && (slot.name.includes('Upper Leg') || slot.name.includes('Lower Leg')) && slot.destroyed).length;
                destroyedFeetCount += critSlots.filter(slot => slot.loc === loc && slot.name && slot.name.includes('Foot') && slot.destroyed).length;
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
            const destroyedAES = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('AES') && slot.destroyed);
            if (!this.unit.locations?.armor?.has(loc)) {
                return null;
            }

            const destroyedShoulder = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Shoulder') && slot.destroyed);
            const destroyedHand = critSlots.some(slot => slot.loc == loc && slot.name && slot.name.includes('Hand') && slot.destroyed);
            const destroyedUpperArmsCount = critSlots.filter(slot => slot.loc == loc && slot.name && slot.name.includes('Upper Arm') && slot.destroyed).length;
            const destroyedLowerArmsCount = critSlots.filter(slot => slot.loc == loc && slot.name && slot.name.includes('Lower Arm') && slot.destroyed).length;
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
            destroyedPartialWings,
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

    readonly PSRModifiers = computed<{ modifier: number; modifiers: PSRCheck[] }>(() => {
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
                reason: "Four-legged 'Mech with all legs intact"
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
        const hasAESinLegs = critSlots.some(slot => slot.name && slot.loc && !slot.destroyed && LEG_LOCATIONS.has(slot.loc) && slot.name.includes('AES'));
        const hasAESinLegsDestroyed = critSlots.some(slot => slot.name && slot.loc && slot.destroyed && LEG_LOCATIONS.has(slot.loc) && slot.name.includes('AES'));
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
        const modularArmorPanelsCount = critSlots.filter(slot => slot.name && slot.name.includes('Modular Armor')).length;
        if (modularArmorPanelsCount > 0) {
            const destroyedModularArmorPanelsCount = critSlots.filter(slot => slot.name && slot.name.includes('Modular Armor') && (slot.destroyed || ((slot.consumed ?? 0) >= 10))).length;
            if (destroyedModularArmorPanelsCount < modularArmorPanelsCount) {
                preExisting += 1; // Modular armor gives +1 modifier (until destroyed or fully consumed)
                modifiers.push({
                    pilotCheck: 1,
                    reason: "Mounts Modular Armor"
                });
            }
        }
        const hasSmallOrTorsoCockpit = critSlots.some(slot => slot.name && slot.loc
            && ((slot.name.includes('Cockpit') && slot.name.includes('Small'))
                || (slot.name.includes('Command') && slot.name.includes('Small'))))
            || critSlots.some(slot => slot.name && slot.loc && slot.loc === 'CT' && slot.name.includes('Cockpit'));
        if (hasSmallOrTorsoCockpit) {
            preExisting += 1; // Small or Torso cockpit gives +1 modifier
            modifiers.push({
                pilotCheck: +1,
                reason: "Mounts small or torso cockpit"
            });
        }
        const destroyedHips = critSlots.filter(slot => slot.name && slot.loc && slot.destroyed && LEG_LOCATIONS.has(slot.loc) && !ignoreLeg.has(slot.loc) && slot.name.includes('Hip'));
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
            if (!slot.loc || !slot.name || !slot.destroyed) return false;
            if (!LEG_LOCATIONS.has(slot.loc)) return false;
            if (ignoreLeg.has(slot.loc)) return false;
            if (!slot.name.includes('Foot') && !slot.name.includes('Leg')) return false;
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
            const hasHeavyDutyGyro = critSlots.some(slot => slot.name && slot.name.includes('Heavy Duty') && slot.name.includes('Gyro'));
            const previouslyDestroyedGyroCount = critSlots.filter(slot => {
                if (!slot.name || !slot.destroyed) return false;
                if (!slot.name.includes('Gyro')) return false;
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

    readonly PSRTargetRoll = computed<number>(() => {
        const pilot = this.unit.getCrewMember(0);
        const piloting = pilot?.getSkill('piloting') ?? 5;
        const modifiers = this.PSRModifiers();
        return piloting + modifiers.modifier;
    });

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
    readonly heatDissipation = computed(() => {
        const base = this.heatMgmt.baseDissipation();
        if (!base) return null;

        const profile = this.heatMgmt.heatsinkProfile();
        const critSlots = this.unit.getCritSlots();

        // SuperCooledMyomer destroyed reduces dissipation
        const destroyedSuperCooledMyomer = critSlots.filter(
            slot => slot.name?.includes('SuperCooledMyomer') && slot.destroyed
        ).length;

        let totalDissipation = base.totalDissipation;
        if (destroyedSuperCooledMyomer > 0 && profile) {
            totalDissipation -= destroyedSuperCooledMyomer * profile.engineDissipationPer;
            totalDissipation = Math.max(0, totalDissipation);
        }

        // Partial wing heat bonus
        const partialWingBonus = this.systemsStatus().hasPartialWings
            ? Math.max(0, 3 - this.systemsStatus().destroyedPartialWings)
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

    /**
     * Derived movement profile: walk/run/jump/UMU MP after damage & heat.
     */
    readonly movementState = computed(() => {
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

        // Heat effects
        const heat = this.unit.getHeat().current;
        const heatMoveModifier = MekRules.getHeatEffects(heat).moveModifier;

        walkValue += heatMoveModifier;
        if (heatMoveModifier != 0) {
            moveImpaired = true;
        }
        walkValue = Math.max(0, walkValue);
        let maxWalkValue = walkValue;
        if (systemsStatus.tripleStrengthMyomerMoveBonusActive) {
            walkValue += 2;
            maxWalkValue += 2;
        } else if (systemsStatus.hasTripleStrengthMyomer) {
            maxWalkValue += 1 - heatMoveModifier; // Simulate heat at 9+
        }
        walkValue = Math.max(0, walkValue);

        // Run MP
        const hasWorkingMASC = systemsStatus.hasMASC && !systemsStatus.destroyedMASC;
        const hasWorkingSupercharger = systemsStatus.hasSupercharger && !systemsStatus.destroyedSupercharger;
        const armorModifierOnRun = (unit.armorType === 'Hardened') ? -1 : 0;
        let runValue: number;
        let maxRunValue: number;
        if (walkValue === 0 || runDisabled) {
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

        // Jump MP
        let partialWingHeatBonus: number | null = null;
        if (systemsStatus.destroyedJumpJetsCount === systemsStatus.jumpJetsCount) {
            jumpValue = 0;
        } else {
            jumpValue = Math.max(0, jumpValue - systemsStatus.destroyedJumpJetsCount);
            if (systemsStatus.hasPartialWings) {
                const maxWingBonus = unit.tons <= 55 ? 2 : 1;
                jumpValue -= Math.min(systemsStatus.destroyedPartialWings, maxWingBonus);
                partialWingHeatBonus = Math.max(0, 3 - systemsStatus.destroyedPartialWings);
            }
        }

        if (systemsStatus.destroyedUMUCount === systemsStatus.UMUCount) {
            UMUValue = 0;
        } else {
            UMUValue = Math.max(0, UMUValue - systemsStatus.destroyedUMUCount);
        }

        return {
            moveImpaired,
            walk: walkValue,
            maxWalk: maxWalkValue,
            run: runValue,
            maxRun: maxRunValue,
            jumpImpaired: (jumpValue < unit.jump),
            jump: jumpValue,
            UMUImpaired: (UMUValue < unit.umu),
            UMU: UMUValue,
            partialWingHeatBonus,
        };
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
        const totalSpikes = critSlots.filter(slot => slot.name?.includes('Spikes')).length;
        const spikeBonus = totalSpikes > 0 ? {
            total: totalSpikes,
            working: critSlots.filter(slot => slot.name?.includes('Spikes') && !slot.destroyed).length,
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
    computeAllEntryStates(): Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }> {
        const entries = this.unit.getInventory();
        // Pass 1: sync destroyed flag from critSlots
        for (const entry of entries) {
            if (entry.critSlots?.length) {
                entry.destroyed = entry.critSlots.some(s => s.destroyed);
            }
        }
        // Pass 2: compute full state
        const result = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>();
        for (const entry of entries) {
            result.set(entry, this.computeEntryState(entry));
        }
        return result;
    }

    /**
     * Compute per-entry game state (damaged/disabled/hitMod) for an inventory entry.
     * Pure rules logic — no SVG/DOM access.
     */
    computeEntryState(entry: MountedEquipment): { isDamaged: boolean; isDisabled: boolean; hitMod: number } {
        const physical = this.physicalCombat();
        const fire = this.fireControl();
        const systemsStatus = this.systemsStatus();
        if (!physical || !fire) return { isDamaged: false, isDisabled: false, hitMod: 0 };

        let isDamaged = !!(entry.critSlots?.some(slot => slot.destroyed));
        let isDisabled = false;
        let hitMod = 0;

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
            if (entry.linkedWith) {
                for (const linked of entry.linkedWith) {
                    if (linked.equipment?.flags.has('F_ARTEMIS_V') && linked.destroyed) {
                        hitMod += 1;
                    }
                }
            }
        }

        if (entry.states.get('state') === 'jammed') isDisabled = true;

        return { isDamaged, isDisabled, hitMod };
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
}
