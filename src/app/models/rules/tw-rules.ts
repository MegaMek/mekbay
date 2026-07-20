/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import { AeroRules } from './aero-rules';
import { computed } from '@angular/core';
import { InfantryRules } from './infantry-rules';
import { MekRules, type MekLegDamageState, type MekLegMovementResult } from './mek-rules';
import { ProtoMekRules } from './protomek-rules';
import { TW_RULES_DATA } from './cbt-rules-data';
import { VehicleRules } from './vehicle-rules';
import type { ChargeDamage, PSRCheck } from './unit-type-rules';
import type { SerializedC3NetworkGroup } from '../force-serialization';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { C3NetworkUtil } from '../../utils/c3-network.util';

function calculateTWC3Tax(
    unit: CBTForceUnit,
    networks: SerializedC3NetworkGroup[],
    allUnits: CBTForceUnit[]
): number {
    return C3NetworkUtil.calculateTWUnitC3Tax(unit, networks, allUnits);
}

export class TWMekRules extends MekRules {
    override readonly rulesData = TW_RULES_DATA;

    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[]): number {
        return calculateTWC3Tax(this.unit, networks, allUnits);
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
    override readonly rulesData = TW_RULES_DATA;

    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[]): number {
        return calculateTWC3Tax(this.unit, networks, allUnits);
    }
}

export class TWInfantryRules extends InfantryRules {
    override readonly rulesData = TW_RULES_DATA;

    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[]): number {
        return calculateTWC3Tax(this.unit, networks, allUnits);
    }
}

export class TWProtoMekRules extends ProtoMekRules {
    override readonly rulesData = TW_RULES_DATA;

    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[]): number {
        return calculateTWC3Tax(this.unit, networks, allUnits);
    }
}

export class TWVehicleRules extends VehicleRules {
    override readonly rulesData = TW_RULES_DATA;

    override calculateC3Tax(networks: SerializedC3NetworkGroup[], allUnits: CBTForceUnit[]): number {
        return calculateTWC3Tax(this.unit, networks, allUnits);
    }

    protected override computeChargeDamage(bonusDamage = 0, maxBonusDamage = bonusDamage): ChargeDamage {
        return { damage: null, maxDamage: null, bonusDamage, maxBonusDamage };
    }
}
