// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AeroRules } from './aero-rules';
import { computed } from '@angular/core';
import { InfantryRules } from './infantry-rules';
import { MekRules, type MekLegDamageState, type MekLegMovementResult } from './mek-rules';
import { ProtoMekRules } from './protomek-rules';
import { VehicleRules } from './vehicle-rules';
import type { ChargeDamage, PSRCheck } from './unit-type-rules';
import type { CriticalSlot, SerializedC3NetworkGroup } from '../force-serialization';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { C3TaxCalculator } from '../c3-network.model';
import { getMekLimbLocations, inferMekConfigFromLocations, LEG_LOCATIONS, MEK_SIDE_TORSO_LOCATIONS, MEK_TORSO_LOCATIONS } from '../entity/types';
import type { TurnState } from '../turn-state.model';

function calculateTWC3Tax(
    unit: CBTForceUnit,
    networks: SerializedC3NetworkGroup[],
    allUnits: CBTForceUnit[],
    calculator = new C3TaxCalculator(networks, allUnits),
): number {
    return calculator.totalWar(unit);
}

export class TWMekRules extends MekRules {
    protected override getLegActuatorPSRChecks(
        turnState: TurnState,
        movementCheck: PSRCheck | null,
    ): PSRCheck[] {
        const checks: PSRCheck[] = [];
        const psr = turnState.getPSRCheckState();
        psr.legActuators?.forEach((count, loc) => {
            for (let index = 0; index < count; index++) {
                checks.push({
                    fallCheck: 1,
                    pilotCheck: 1,
                    loc,
                    reason: 'Leg actuator hit',
                });
            }
        });
        psr.hipsHit?.forEach(loc => {
            checks.push({
                fallCheck: this.hipPSRModifier,
                pilotCheck: this.hipPSRModifier,
                loc,
                legFilter: loc,
                reason: 'Hip hit',
            });
        });
        if (movementCheck?.reason === 'Jumping with damaged leg actuator'
            || movementCheck?.reason === 'Running with damaged hip') {
            checks.push(movementCheck);
        }
        return checks;
    }

    protected override getPreExistingLegActuatorPSRModifiers(
        critSlots: readonly CriticalSlot[],
        ignoreLeg: Set<string>,
    ): { modifier: number; modifiers: PSRCheck[] } {
        let modifier = 0;
        const modifiers: PSRCheck[] = [];
        const destroyedHips = critSlots.filter(slot => slot.loc
            && LEG_LOCATIONS.has(slot.loc)
            && this.unit.isEquipmentUnavailable(slot)
            && !ignoreLeg.has(slot.loc)
            && this.isNamedCrit(slot, 'Hip'));
        for (const hip of destroyedHips) {
            modifier += this.hipPSRModifier;
            modifiers.push({ pilotCheck: this.hipPSRModifier, loc: hip.loc!, reason: 'Hip Destroyed' });
            ignoreLeg.add(hip.loc!);
        }
        const destroyedActuators = critSlots.filter(slot => slot.loc
            && LEG_LOCATIONS.has(slot.loc)
            && this.unit.isEquipmentUnavailable(slot)
            && !ignoreLeg.has(slot.loc)
            && (this.isNamedCrit(slot, 'Leg') || this.isNamedCrit(slot, 'Foot')));
        const destroyedActuatorCounts = new Map<string, number>();
        for (const actuator of destroyedActuators) {
            destroyedActuatorCounts.set(actuator.loc!, (destroyedActuatorCounts.get(actuator.loc!) ?? 0) + 1);
        }
        for (const [loc, count] of destroyedActuatorCounts) {
            modifier += count;
            modifiers.push({
                pilotCheck: count,
                loc,
                reason: 'Leg Actuator(s) Destroyed',
                modifierReason: count === 1
                    ? 'Leg Actuator Destroyed'
                    : `Leg Actuators Destroyed (${count})`,
            });
        }
        return { modifier, modifiers };
    }

    protected override usesTorsoCripplingRules(): boolean {
        return false;
    }

    protected override readonly crippled = computed<boolean>(() => {
        if (!this.unit.usesForcedWithdrawal()) return false;
        if (!this.unit.isLoaded()) return false;
        return this.allCrewCrippled()
            || this.allSensorsDestroyedOrDestroying()
            || this.gyroEngineCrippledOrCrippling()
            || this.sideTorsoDestroyedOrDestroying()
            || this.internalStructureCrippledOrCrippling();
    });

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
        return MEK_SIDE_TORSO_LOCATIONS.some(loc => this.unit.isInternalLocDestroyed(loc));
    }

    private internalStructureCrippledOrCrippling(): boolean {
        let damagedLimbs = 0;
        let damagedTorsos = 0;
        const internalLocations = this.unit.locations?.internal;
        if (!internalLocations) return false;

        const config = inferMekConfigFromLocations(internalLocations.keys());
        const limbLocations = new Set<string>(getMekLimbLocations(config));

        internalLocations.forEach((_value, loc) => {
            if (this.unit.getInternalHits(loc) <= 0) return;
            if (limbLocations.has(loc)) {
                damagedLimbs++;
            } else if (MEK_TORSO_LOCATIONS.has(loc) && this.unit.isArmorLocDestroyed(loc)) {
                damagedTorsos++;
            }
        });

        return damagedLimbs >= 3 || damagedTorsos >= 2;
    }

    override calculateC3Tax(
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[],
        calculator?: C3TaxCalculator,
    ): number {
        return calculateTWC3Tax(this.unit, networks, allUnits, calculator);
    }

    protected override get gyroHitPSRModifier(): number { return 3; }
    protected override get hipPSRModifier(): number { return 2; }
    protected override get lowerArmFireModifier(): number { return 1; }
    protected override get footHitsCausePSR(): boolean { return true; }

    protected override gyroHitPSRCheck(gyroHits: number): PSRCheck | null {
        if (this.hasHeavyDutyGyro()) {
            const previouslyDestroyedGyroCount = this.unit.getCritSlots()
                .filter(slot => this.unit.isEquipmentUnavailable(slot) && slot.name?.includes('Gyro')).length;
            if (previouslyDestroyedGyroCount + gyroHits === 1) {
                return { pilotCheck: 1, reason: 'Gyro hit' };
            }
        }
        return {
            fallCheck: this.gyroHitPSRModifier,
            pilotCheck: this.gyroHitPSRModifier,
            reason: 'Gyro hit',
            ignorePreExistingGyro: true,
        };
    }

    protected override destroyedGyroPSRCheck(): PSRCheck {
        return {
            fallCheck: 100,
            pilotCheck: 6,
            reason: 'Gyro destroyed',
            ignorePreExistingGyro: true,
        };
    }

    protected override damagedGyroMovementPSRCheck(moveMode: 'run' | 'jump'): PSRCheck {
        return {
            fallCheck: 0,
            pilotCheck: 0,
            reason: `${moveMode === 'jump' ? 'Jumping' : 'Running'} with damaged gyro`,
        };
    }

    protected override gyroDestructionHitThreshold(): number {
        return this.hasHeavyDutyGyro() ? 3 : 2;
    }

    protected override gyroPSRModifierHitCount(): number {
        return this.unit.getCritSlots()
            .filter(slot => this.unit.isEquipmentUnavailable(slot) && slot.name?.includes('Gyro')).length;
    }

    protected override preExistingGyroPSRModifier(destroyedGyroCount: number): PSRCheck | null {
        if (destroyedGyroCount === 0) return null;
        if (this.hasHeavyDutyGyro() && destroyedGyroCount === 1) {
            return { pilotCheck: 1, reason: 'Heavy Duty Gyro first damage' };
        }
        return { pilotCheck: this.gyroHitPSRModifier, reason: 'Gyro damaged' };
    }

    protected override criticalDamageDestructionThreshold(): number {
        return 1;
    }

    protected override readonly immobile = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        if (this.unit.getCondition('shutdown')) return true;
        if (this.allLimbsDestroyedOrMissing()) return true;
        if (!this.hasDroneOperatingSystem() && !this.hasFunctionalCrew()) return true;
        return false;
    });

    protected override destroyedLegCausesAutoFall(): boolean {
        return true;
    }

    protected override destroyedLegPSR(_isQuadruped: boolean): { fallCheck: number; pilotCheck: number } {
        return { fallCheck: 100, pilotCheck: 5 };
    }

    protected override damagedLegRequiresMovementCheck(_isQuadruped: boolean, destroyedLegsCount: number): boolean {
        return destroyedLegsCount > 0;
    }

    protected override runningWithDestroyedLegRequiresCheck(): boolean {
        return false;
    }

    protected override destroyedLegRequiresImmediatePSR(_destroyedLegsCount: number): boolean {
        return true;
    }

    protected override applyLegDamageToMovement(
        walk: number,
        _unitRun: number,
        damage: MekLegDamageState,
        isBiped: boolean,
        isQuadruped: boolean
    ): MekLegMovementResult {
        let runDisabled = false;
        let moveImpaired = false;

        if (isBiped) {
            for (let index = 0; index < damage.destroyedHipsCount; index++) {
                walk = Math.ceil(walk * 0.5);
                moveImpaired = true;
            }
            if (damage.destroyedLegsCount === 1) {
                walk = Math.min(walk, 1);
                moveImpaired = true;
                runDisabled = true;
            } else if (damage.destroyedLegsCount >= 2) {
                walk = 0;
                moveImpaired = true;
                runDisabled = true;
            }
        } else if (isQuadruped) {
            if (damage.destroyedHipsCount !== 0) {
                walk -= damage.destroyedHipsCount;
                moveImpaired = true;
            }
            if (damage.destroyedLegsCount === 1) walk--;
            if (damage.destroyedLegsCount === 2) {
                walk = Math.min(walk, 1);
                runDisabled = true;
            } else if (damage.destroyedLegsCount >= 3) {
                walk = 0;
                runDisabled = true;
            }
        }

        return { walk, runDisabled, runCap: null, moveImpaired, applyActuatorDamage: true };
    }

    protected override computeChargeDamage(bonusDamage = 0, maxBonusDamage = bonusDamage): ChargeDamage {
        return {
            damage: null,
            maxDamage: null,
            bonusDamage,
            maxBonusDamage,
        };
    }
}

export class TWAeroRules extends AeroRules {
    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[], calculator?: C3TaxCalculator): number {
        return calculateTWC3Tax(this.unit, networks, allUnits, calculator);
    }
}

export class TWInfantryRules extends InfantryRules {
    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[], calculator?: C3TaxCalculator): number {
        return calculateTWC3Tax(this.unit, networks, allUnits, calculator);
    }
}

export class TWProtoMekRules extends ProtoMekRules {
    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[], calculator?: C3TaxCalculator): number {
        return calculateTWC3Tax(this.unit, networks, allUnits, calculator);
    }
}

export class TWVehicleRules extends VehicleRules {
    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[], calculator?: C3TaxCalculator): number {
        return calculateTWC3Tax(this.unit, networks, allUnits, calculator);
    }

    protected override computeChargeDamage(bonusDamage = 0, maxBonusDamage = bonusDamage): ChargeDamage {
        return { damage: null, maxDamage: null, bonusDamage, maxBonusDamage };
    }
}
