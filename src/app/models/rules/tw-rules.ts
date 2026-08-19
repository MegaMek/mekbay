// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AeroRules } from './aero-rules';
import { computed } from '@angular/core';
import { InfantryRules } from './infantry-rules';
import { MekRules, type MekLegDamageState, type MekLegMovementResult } from './mek-rules';
import { ProtoMekRules } from './protomek-rules';
import { VehicleRules } from './vehicle-rules';
import type { ChargeDamage, PSRCheck, UnitHeatSource } from './unit-type-rules';
import type { CriticalSlot, SerializedC3NetworkGroup } from '../force-serialization';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { C3TaxCalculator } from '../c3-network.model';
import { getMekLimbLocations, inferMekConfigFromLocations, LEG_LOCATIONS, MEK_SIDE_TORSO_LOCATIONS, MEK_TORSO_LOCATIONS, QUAD_LEG_LOCATIONS, type MekConfig } from '../entity/types';
import type { TurnState } from '../turn-state.model';
import type { Equipment } from '../equipment.model';
import type { MountedEquipment } from '../mounted-equipment.model';

function calculateTWC3Tax(
    unit: CBTForceUnit,
    networks: SerializedC3NetworkGroup[],
    allUnits: CBTForceUnit[],
    calculator = new C3TaxCalculator(networks, allUnits),
): number {
    return calculator.totalWar(unit);
}

function calculateTWChargeDamage(
    unit: CBTForceUnit,
    bonusDamage = 0,
    maxBonusDamage = bonusDamage,
): ChargeDamage {
    const damagePerHex = unit.getUnit().tons / 10;
    const moveMode = unit.turnState().effectiveMoveMode();
    const movedHexes = Math.max(1, unit.turnState().moveDistance() ?? 0);
    const maxMovedHexes = Math.max(1, unit.getUnit().run);
    const ramPlates = unit.getInventory().filter(entry => entry.equipment?.hasFlag('F_RAM_PLATE'));
    const hasRamPlate = ramPlates.length > 0;
    const hasWorkingRamPlate = ramPlates.some(entry => unit.isEquipmentOperational(entry));
    const damageFor = (hexes: number, hasRamPlate: boolean): number => {
        // TW counts every movement hex after the first; MegaMek rounds before applying a Ram Plate.
        const baseDamage = Math.ceil(damagePerHex * (hexes - 1));
        return hasRamPlate ? Math.ceil(baseDamage * 1.5) : baseDamage;
    };
    const formulaDamagePerHex = Math.round(
        damagePerHex * (hasWorkingRamPlate ? 1.5 : 1) * 100,
    ) / 100;
    return {
        damage: damageFor(movedHexes, hasWorkingRamPlate) + bonusDamage,
        maxDamage: damageFor(maxMovedHexes, hasRamPlate) + maxBonusDamage,
        bonusDamage,
        maxBonusDamage,
        ...(moveMode !== 'walk' && moveMode !== 'run' && {
            displayFormula: `${formulaDamagePerHex}/hex${bonusDamage > 0 ? `+${bonusDamage}` : ''}`,
        }),
    };
}

export class TWMekRules extends MekRules {
    override readonly standingUpPSRModifier: number = 0;
    override readonly supportsCarefulStand: boolean = true;
    protected override get shieldBashPunchBonusEnabled(): boolean { return false; }
    protected override get standaloneShieldDamageEnabled(): boolean { return true; }

    protected override shieldRetainsMobilityPenalty(entry: MountedEquipment): boolean {
        if (entry.committedDestroyed()) return false;
        const criticals = this.entryCriticalSlots(entry);
        if (criticals.length === 0) {
            return this.unit.getEquipmentInstallationLocationStatus(entry) === 'available';
        }
        // TW retains the modifier until every shield critical is unavailable.
        // Critical status also accounts for a committed destroyed/blown-off arm.
        return criticals.some(slot => this.unit.isEquipmentOperational(slot));
    }

    protected override destroyedLegStandThreshold(config: MekConfig): number {
        return config === 'Quad' ? 2 : 1;
    }

    override getStandAttemptLimit(_turnState: TurnState): number | null {
        const { config, destroyedLegs } = this.currentLegState();
        return this.isDestroyedLegStandException(config, destroyedLegs.length) ? 1 : null;
    }

    protected override isMovementPSRFoldedIntoStandAttempt(turnState: TurnState): boolean {
        const { config, destroyedLegs } = this.currentLegState();
        return (turnState.standAttempts() ?? 0) > 0
            && (turnState.moveDistance() ?? 0) === 0
            && this.isDestroyedLegStandException(config, destroyedLegs.length);
    }

    override heatLifeSupportPilotHits(heat: number): number {
        if (!this.hasDamagedLifeSupport() || heat <= 0) return 0;

        if (this.hasTorsoMountedCockpit()) return heat >= 15 ? 2 : 1;
        if (heat >= 26) return 2;
        return heat >= 15 ? 1 : 0;
    }

    override mountedCriticalDamageDestructionThreshold(_equipment: Equipment | null): number {
        return 1;
    }

    override heatSources(turnState: TurnState): UnitHeatSource[] {
        return super.heatSources(turnState).map(source => source.id === 'movement'
            ? { ...source, value: source.value + (turnState.standAttempts() ?? 0) }
            : source
        );
    }

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
        if (this.isLegDamageMovementPSRCheck(movementCheck)) {
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
            && !this.unit.isEquipmentOperational(slot)
            && !ignoreLeg.has(slot.loc)
            && this.isNamedCrit(slot, 'Hip'));
        for (const hip of destroyedHips) {
            modifier += this.hipPSRModifier;
            modifiers.push({ pilotCheck: this.hipPSRModifier, loc: hip.loc!, reason: 'Hip Destroyed' });
            ignoreLeg.add(hip.loc!);
        }
        const destroyedActuators = critSlots.filter(slot => slot.loc
            && LEG_LOCATIONS.has(slot.loc)
            && !this.unit.isEquipmentOperational(slot)
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
                .filter(slot => !this.unit.isEquipmentOperational(slot) && slot.name?.includes('Gyro')).length;
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
            .filter(slot => !this.unit.isEquipmentOperational(slot) && slot.name?.includes('Gyro')).length;
    }

    protected override preExistingGyroPSRModifier(destroyedGyroCount: number): PSRCheck | null {
        if (destroyedGyroCount === 0) return null;
        if (this.hasHeavyDutyGyro() && destroyedGyroCount === 1) {
            return { pilotCheck: 1, reason: 'Heavy Duty Gyro first damage' };
        }
        return { pilotCheck: this.gyroHitPSRModifier, reason: 'Gyro damaged' };
    }

    protected override readonly immobile = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        if (this.unit.getCondition('shutdown')) return true;
        if (this.allLimbsDestroyedOrMissing()) return true;
        if (!this.hasDroneOperatingSystem() && !this.hasFunctionalCrew()) return true;
        return false;
    });

    protected override destroyedLegPSR(_isQuadruped: boolean): { fallCheck: number; pilotCheck: number } {
        return { fallCheck: 100, pilotCheck: 5 };
    }

    protected override getPreExistingDestroyedLegPSRModifiers(
        config: MekConfig,
        destroyedLegs: readonly string[],
    ): PSRCheck[] {
        if (config !== 'Quad') return super.getPreExistingDestroyedLegPSRModifiers(config, destroyedLegs);
        if (destroyedLegs.length !== 2) return [];
        return [{
            pilotCheck: 5,
            reason: 'Leg Destroyed',
            modifierReason: 'Legs Destroyed (2)',
        }];
    }

    protected override destroyedLegMovementPSRModifier(
        moveMode: 'run' | 'jump',
        isQuadruped: boolean,
        destroyedLegsCount: number,
    ): number {
        return moveMode === 'jump' && isQuadruped && destroyedLegsCount === 1 ? 5 : 0;
    }

    protected override damagedLegRequiresMovementCheck(_isQuadruped: boolean, destroyedLegsCount: number): boolean {
        return destroyedLegsCount > 0;
    }

    protected override runningWithDestroyedLegRequiresCheck(): boolean {
        return false;
    }

    protected override runningDamageCheckRequiresHexMovement(): boolean {
        return false;
    }

    protected override destroyedLegsApplyHipMovementCheck(_isQuadruped: boolean, _destroyedLegsCount: number): boolean {
        return false;
    }

    protected override getRunningMinimumMovementDistance(): number {
        const movement = this.movementState();
        if (!movement || movement.walk < 1) return 0;
        const systemsStatus = this.systemsStatus();
        const isQuadruped = QUAD_LEG_LOCATIONS.some(loc => systemsStatus.internalLocations.has(loc));
        const oneLeggedDestroyedCount = isQuadruped ? 2 : 1;
        return systemsStatus.destroyedLegsCount === oneLeggedDestroyedCount ? 1 : 0;
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
            if (damage.destroyedHipsCount === 2) {
                walk = 0;
                moveImpaired = true;
                runDisabled = true;
            } else {
                for (let index = 0; index < damage.destroyedHipsCount; index++) {
                    walk = Math.ceil(walk * 0.5);
                    moveImpaired = true;
                }
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
            if (damage.destroyedLegsCount === 1) walk--;
            if (damage.destroyedLegsCount === 2) {
                walk = Math.min(walk, 1);
                runDisabled = true;
            } else if (damage.destroyedLegsCount >= 3) {
                walk = 0;
                runDisabled = true;
            }
            
            if (damage.destroyedHipsCount === 4) {
                walk = 0;
                moveImpaired = true;
                runDisabled = true;
            } else {
                for (let index = 0; index < damage.destroyedHipsCount && walk > 0; index++) {
                    walk = Math.ceil(walk * 0.5);
                    moveImpaired = true;
                }
            }
        }

        return { walk, runDisabled, runCap: null, moveImpaired, applyActuatorDamage: true };
    }

    protected override computeChargeDamage(bonusDamage = 0, maxBonusDamage = bonusDamage): ChargeDamage {
        return calculateTWChargeDamage(this.unit, bonusDamage, maxBonusDamage);
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
        return calculateTWChargeDamage(this.unit, bonusDamage, maxBonusDamage);
    }
}
