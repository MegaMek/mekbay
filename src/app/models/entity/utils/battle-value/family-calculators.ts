// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import type { Equipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';
import type { EntityMountedEquipment } from '../../types';
import { AeroEntity } from '../../entities/aero/aero-entity';
import { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../../entities/infantry/infantry-entity';
import { MekEntity } from '../../entities/mek/mek-entity';
import { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import { getMekLegLocations, isQuadMekConfig } from '../../types/mek';
import { BV_MOVEMENT_CALCULATION } from '../../types';
import { getPpcCapacitorBV } from '../equipment-bv';
import { vehicleTypeModifier, targetMovementModifier } from './rules';
import { BVCalculator } from './bv-calculator';
import { getVibrobladeHeat } from '../../../rules/vibroblade-rules';
import { laserInsulatorAdjustedHeat } from '../../../laser-insulator.model';
import { isGaussEquipment } from '../../../gauss-equipment.model';
import {
  RISC_LASER_PULSE_HEAT_BONUS,
  isRiscLaserPulseModule,
} from '../../../risc-laser-mode.model';
import {
  PPC_CAPACITOR_HEAT_BONUS,
  isPpcCapacitorEquipment,
  isPpcEquipment,
} from '../../../ppc-capacitor.model';

import {
  canMakeAntiMekAttacks,
  hasDermalCamoStealth,
  hasInfantryAugmentation,
  hasProstheticAntiMekBonus,
  infantryDamageDivisor,
  prostheticDamageBonus,
} from './infantry-rules';
import {
  isCaseIIEquipment,
  isStandardCaseEquipment,
} from '../../../case-equipment.model';
import { structureBattleValueMultiplier } from '../../../construction-equipment.model';
import { hasEquipmentVariant } from '../../../equipment-variant.model';
import {
  isArmoredGloveEquipment,
  isBasicManipulatorEquipment,
  isBattleClawEquipment,
  isMagnetClawEquipment,
} from '../../../battle-armor-equipment.model';
import {
  chassisDefensiveBattleValueBonus,
  isMagneticClampEquipment,
} from '../../../chassis-equipment.model';
import { isAdvancedFireControlEquipment } from '../fire-control';
import { isClubOrHandWeaponEquipment, isShieldEquipment } from '../physical-weapon';
import { ecmDefensiveSystemValue, isEcmEquipment } from '../../../ecm-mode.model';
import { isBapEquipment } from '../../../bap-equipment.model';
import {
  BLUE_SHIELD_BV_BONUS,
  BLUE_SHIELD_BV_MULTIPLIER,
  EMERGENCY_COOLANT_HEAT_EFFICIENCY_BONUS,
  isBlueShieldEquipment,
  isEmergencyCoolantSystemEquipment,
} from '../../../escalating-equipment.model';
import {
  adjustedStealthTmm,
  isChameleonShieldEquipment,
  isNullSignatureEquipment,
  isVoidSignatureEquipment,
  signatureHeatEfficiencyPenalty,
} from '../../../stealth-equipment.model';
import {
  isImprovedJumpJetEquipment,
  isJumpJetEquipment,
  isPartialWingEquipment,
  isPrototypeImprovedJumpJetEquipment,
  isSuperCooledMyomerEquipment,
  partialWingJumpBonus,
} from '../../../jump-equipment.model';
import {
  isActuatorEnhancementSystem,
  tripleStrengthMyomerBvMultiplier,
  tripleStrengthMyomerKind,
} from '../../../myomer-equipment.model';
import {
  DRONE_FIRE_CONTROL_BV_MULTIPLIER,
  isDroneOperatingSystemEquipment,
} from '../../../drone-operating-system.model';
/** Shared Java HeatTrackingBVCalculator behavior for pristine mounts. */
export class HeatTrackingBVCalculator extends BVCalculator {
  protected heatEfficiency(): number { return Number.MAX_SAFE_INTEGER; }

  protected processWeaponsWithoutHeat(): void {
    super.processWeapons();
  }

  protected override processExplosiveEquipment(): void {
    const before = this.defensiveValue;
    this.defensiveValue = Math.max(1, this.defensiveValue);
    if (this.defensiveValue !== before) this.addValueLine('Minimum Defensive Value', undefined, before);
  }

  protected weaponHeat(mount: EntityMountedEquipment): number {
    const weapon = mount.equipment;
    if (weapon instanceof MiscEquipment) {
      if (this.entity.unitType() !== 'Mek' || !['LA', 'RA'].includes(mount.location)) return 0;
      return getVibrobladeHeat(weapon);
    }
    if (!(weapon instanceof WeaponEquipment)) return 0;
    let heat = weapon.heat;
    if (weapon.weapon.heatAdjustmentForBvCalculation) {
      heat += weapon.weapon.heatAdjustmentForBvCalculation;
    }
    if (weapon.oneShotCount) heat /= 4;
    if (weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB') heat *= 2;
    else if (weapon.ammoType === 'AC_ROTARY') heat *= 6;
    if (['SRM_STREAK', 'LRM_STREAK', 'IATM'].includes(weapon.ammoType)) heat *= 0.5;
    const linkedMount = this.entity.getLinkingMount(mount);
    const linkedBy = linkedMount && this.isWorking(linkedMount) ? linkedMount.equipment : undefined;
    if (linkedBy instanceof MiscEquipment) {
      if (isRiscLaserPulseModule(linkedBy)) heat += RISC_LASER_PULSE_HEAT_BONUS;
      heat = laserInsulatorAdjustedHeat(heat, linkedBy, weapon);
      if (isPpcCapacitorEquipment(linkedBy)) heat += PPC_CAPACITOR_HEAT_BONUS;
    }
    return heat;
  }

  protected override processWeapons(): void {
    const before = this.offensiveValue;
    const records = this.entity.equipment()
      .filter(mount => this.countsAsOffensiveWeapon(mount))
      .map(mount => ({ mount, bv: this.weaponBV(mount, true), heat: this.weaponHeat(mount) }))
      .sort((a, b) => a.heat === 0 ? -1 : b.heat === 0 ? 1 : b.bv - a.bv || a.heat - b.heat);
    const details = this.captureDetails(() => {
      const efficiency = this.heatEfficiency();
      this.addReportLine('Heat Efficiency', this.heatEfficiencyCalculation(efficiency));
      let heat = 0;
      let exceeded = efficiency <= 0;
      for (const record of records) {
        let value = this.weaponBV(record.mount, true);
        const calculation = `+ ${this.format(value)}${exceeded ? ' x 0.5 (Overheat)' : ''}`;
        if (exceeded) value *= 0.5;
        const itemBefore = this.offensiveValue;
        this.offensiveValue += value;
        heat += record.heat;
        this.addValueLine(this.equipmentDescriptor(record.mount), `${calculation}${exceeded ? '' : ` (Heat: ${this.format(heat)})`}`, itemBefore);
        if (heat >= efficiency) exceeded = true;
      }
    });
    this.addValueLine('Weapons', undefined, before, details);
  }

  protected heatEfficiencyCalculation(efficiency: number): string { return `= ${this.format(efficiency)}`; }
}

export class MekBVCalculator extends HeatTrackingBVCalculator {
  declare readonly entity: MekEntity;

  protected override runningTmm(): number {
    if (!this.entity.isLandAirMek()) return super.runningTmm();
    const airMekFlankMP = this.state ? this.jumpMP * 3 * 1.5 : this.entity.airMekFlankMP();
    return airMekFlankMP === 0 ? 0 : targetMovementModifier(airMekFlankMP, false, true);
  }

  protected override supplementalArmorAt(
    location: string,
    armor: Readonly<{ front: number; rear: number }>,
  ): number {
    return location === 'CT' && this.entity.mountedCockpit().addsDefensiveBVForCTArmor
      ? armor.front + armor.rear
      : 0;
  }

  protected override processStructure(): void {
    const before = this.defensiveValue;
    let multiplier = 1;
    const structures = [...this.entity.structureByLocation().values()];
    if (structures.length > 0) {
      const structureMultipliers = structures.map(s => structureBattleValueMultiplier(s.structure));
      if (structureMultipliers.every(value => value === 0.5)) multiplier = 0.5;
      else if (structureMultipliers.every(value => value === 2)) multiplier = 2;
    }
    if (this.hasEquipment(isBlueShieldEquipment)) multiplier += BLUE_SHIELD_BV_BONUS;

    const sideTorsoEngineCriticals = this.entity.mountedEngine().getSideTorsoSlots().length;
    const engineMultiplier = sideTorsoEngineCriticals >= 6 ? 0.25
      : sideTorsoEngineCriticals >= 3 ? 0.5
        : sideTorsoEngineCriticals === 2 ? 0.75
          : sideTorsoEngineCriticals === 1 ? 0.825 : 1;
    const internal = this.currentInternalPoints();
    this.defensiveValue += internal * 1.5 * multiplier * engineMultiplier;
    const structureTotal = this.defensiveValue;
    const typeModifier = multiplier === 1 ? '' : ` x ${this.format(multiplier)}`;
    const engineModifier = engineMultiplier === 1 ? '' : ` x ${this.format(engineMultiplier)}`;
    const engine = this.entity.mountedEngine();
    const engineLabel = engineMultiplier === 1 ? '' : ` (${engine.rating} ${engine.type()})`;
    this.addValueLine('Internal Structure', `+ ${internal} x 1.5${typeModifier}${engineModifier}${engineLabel}`, before);

    let gyro = this.entity.mountedGyro().bvMultiplier;
    if (gyro === 0 && this.entity.cockpitType() === 'Interface') gyro = 0.5;
    this.defensiveValue += this.entity.tonnage() * gyro;
    this.addValueLine('Gyro', `+ ${this.format(this.entity.tonnage())} x ${this.format(gyro)}`, structureTotal);
  }

  protected override processDefensiveEquipment(): void {
    super.processDefensiveEquipment();
    const before = this.defensiveValue;
    let armoredBV = 0;
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      if (!mount.armored || !equipment || isPpcCapacitorEquipment(equipment)
        || !this.notDestroyed(mount)) continue;
      const placedSlots = mount.placedCriticalSlotCount;
      const requiredSlots = mount.getNumCriticalSlots(this.entity);
      let slots = placedSlots > 0 ? placedSlots
        : typeof requiredSlots === 'number' ? requiredSlots : 0;
      let value = mount.getBV(this.entity);
      if (equipment instanceof WeaponEquipment && isPpcEquipment(equipment)) {
        const capacitor = this.entity.getLinkingMount(mount)?.equipment;
        if (isPpcCapacitorEquipment(capacitor)) {
          value += getPpcCapacitorBV(mount);
          slots++;
        }
      }
      armoredBV += value > 0 ? value * 0.05 * slots : 5 * slots;
    }
    for (const slots of this.entity.criticalSlotGrid().values()) {
      for (const slot of slots) {
        if (slot.type !== 'system' || !slot.armored) continue;
        armoredBV += slot.systemType === 'Gyro'
          ? this.entity.tonnage() * this.entity.mountedGyro().bvMultiplier * 0.05 : 5;
      }
    }
    this.defensiveValue += armoredBV;
    if (armoredBV > 0) this.addValueLine('Armored Components', `+ ${this.format(armoredBV)}`, before);
  }

  private locationHasEquipment(location: string, predicate: (equipment: Equipment) => boolean): boolean {
    return this.entity.equipment().some(mount => mount.getOccupiedLocations().includes(location)
      && this.isWorking(mount) && mount.equipment !== undefined && predicate(mount.equipment));
  }

  private locationHasStandardCase(location: string): boolean {
    // Generated Clan CASE is structural and has no destroyable mount. Explicit
    // CASE remains subject to the runtime status of its own equipment.
    if (this.entity.implicitClanCaseLocations().has(location)) return true;
    return this.locationHasEquipment(location, isStandardCaseEquipment);
  }

  private hasExplosivePenalty(location: string): boolean {
    if (location === 'Unallocated' || this.locationHasEquipment(location, isCaseIIEquipment)) return false;
    const sideEngineSlots = this.entity.mountedEngine().getSideTorsoSlots().length;
    if (!isQuadMekConfig(this.entity.chassisConfig) && (location === 'LA' || location === 'RA')) {
      const transfer = location === 'LA' ? 'LT' : 'RT';
      return !this.locationHasStandardCase(location) && this.hasExplosivePenalty(transfer);
    }
    if (location === 'LT' || location === 'RT') {
      return !this.locationHasStandardCase(location) || sideEngineSlots >= 3;
    }
    return true;
  }

  protected blueShieldUnprotectedLocations(): number {
    if (!this.hasEquipment(isBlueShieldEquipment)) return 0;
    const locations = ['CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL'];
    const sideEngineSlots = this.entity.mountedEngine().getSideTorsoSlots().length;
    return locations.filter(location => {
      if (this.locationHasEquipment(location, isCaseIIEquipment)) return false;
      if (this.entity.techBase() === 'Clan') {
        if (['CT', 'RL', 'LL'].includes(location)) return true;
        return ['RT', 'LT'].includes(location) && sideEngineSlots > 2;
      }
      if (sideEngineSlots <= 2) {
        if (['RT', 'LT'].includes(location) && this.locationHasStandardCase(location)) return false;
        if (location === 'LA' && (this.locationHasStandardCase('LA') || this.locationHasStandardCase('LT'))) return false;
        if (location === 'RA' && (this.locationHasStandardCase('RA') || this.locationHasStandardCase('RT'))) return false;
      }
      return true;
    }).length;
  }

  protected override processExplosiveEquipment(): void {
    const before = this.defensiveValue;
    const details = this.captureDetails(() => {
      const blueShieldPenalty = this.blueShieldUnprotectedLocations();
      if (blueShieldPenalty > 0) {
        const itemBefore = this.defensiveValue;
        this.defensiveValue -= blueShieldPenalty;
        this.addValueLine('Blue Shield', `- ${blueShieldPenalty}`, itemBefore);
      }
      for (const mount of this.entity.equipment()) {
        const equipment = mount.equipment;
        if (!equipment || !this.notDestroyed(mount) || !this.isExplosive(mount) || mount.location === 'Unallocated'
          || isBlueShieldEquipment(equipment)
          || !mount.getOccupiedLocations().some(location => this.hasExplosivePenalty(location))) continue;
        if (equipment instanceof AmmoEquipment && this.ammoShots(mount) <= 0) continue;
        if (equipment instanceof WeaponEquipment) {
          if (['AC_ROTARY', 'AC', 'AC_IMP', 'AC_PRIMITIVE', 'PAC', 'LAC'].includes(equipment.ammoType)) continue;
        }

        const reducedWeapon = equipment instanceof WeaponEquipment && (
          isGaussEquipment(equipment)
          || equipment.hasWeaponTrait('heavy-vehicle-autocannon')
          || equipment.hasWeaponTrait('hyper')
          || equipment.hasWeaponTrait('tsemp')
          || equipment.hasWeaponTrait('b-pod')
          || equipment.hasWeaponTrait('m-pod')
          || (equipment.hasWeaponTrait('taser') && equipment.hasWeaponTrait('mek-weapon'))
          || (equipment.hasWeaponTrait('laser') && hasEquipmentVariant(equipment, 'improved'))
          || isPpcEquipment(equipment)
        );
        const reducedMisc = equipment instanceof MiscEquipment && (
          isJumpJetEquipment(equipment)
          || isEmergencyCoolantSystemEquipment(equipment)
          || isPpcCapacitorEquipment(equipment)
          || isRiscLaserPulseModule(equipment)
        );
        const reducedAmmo = equipment instanceof AmmoEquipment && equipment.ammoType === 'COOLANT_POD';
        const reduced = reducedWeapon || reducedMisc || reducedAmmo;
        const placedSlots = mount.placedCriticalSlotCount;
        const requiredSlots = mount.getNumCriticalSlots(this.entity);
        const slots = equipment instanceof WeaponEquipment
          && equipment.hasWeaponTrait('heavy-vehicle-autocannon')
          && !mount.isSplitAcrossLocations && !this.entity.isSuperHeavy()
          ? 1
          : placedSlots > 0 ? placedSlots
            : typeof requiredSlots === 'number' ? requiredSlots : 1;
        const itemBefore = this.defensiveValue;
        const penalty = (reduced ? 1 : 15) * Math.max(1, slots);
        this.defensiveValue -= penalty;
        this.addValueLine(this.equipmentDescriptor(mount), `- ${this.format(penalty)}`, itemBefore);
      }
    });
    if (details.length > 0) this.addValueLine('Explosive Equipment', undefined, before, details);
    super.processExplosiveEquipment();
  }

  protected override tmmFactor(running: number, jumping: number, umu: number): number {
    const tmm = Math.max(running, jumping, umu);
    const armorStealth = [...this.entity.armorByLocation().values()].some(a => a.armor.armorType === 'STEALTH');
    return 1 + adjustedStealthTmm(tmm, {
      armorStealth,
      nullSignature: this.hasEquipment(isNullSignatureEquipment),
      chameleonShield: this.hasEquipment(isChameleonShieldEquipment),
      voidSignature: this.hasEquipment(isVoidSignatureEquipment),
    }) / 10;
  }

  protected override frontWeapon(mount: EntityMountedEquipment): boolean {
    return !['LA', 'RA'].includes(mount.location) && !mount.turretMounted && !mount.rearMounted;
  }

  protected override rearWeapon(mount: EntityMountedEquipment): boolean {
    return !['LA', 'RA'].includes(mount.location) && !mount.turretMounted && mount.rearMounted;
  }

  protected override isNominalRear(mount: EntityMountedEquipment): boolean {
    return !['LA', 'RA'].includes(mount.location) && !mount.turretMounted && super.isNominalRear(mount);
  }

  protected hasAesAt(location: string): boolean {
    return this.entity.equipment().some(mount => mount.location === location
      && this.isWorking(mount) && isActuatorEnhancementSystem(mount.equipment));
  }

  private hasCompleteLegAes(): boolean {
    const legs = getMekLegLocations(this.entity.chassisConfig);
    return legs.length > 0 && legs.every(location => this.hasAesAt(location));
  }

  protected override weaponMountModifier(mount: EntityMountedEquipment): number {
    return ['LA', 'RA'].includes(mount.location) && this.hasAesAt(mount.location) ? 1.25 : 1;
  }

  protected override offensiveEquipmentModifier(mount: EntityMountedEquipment): number {
    const equipment = mount.equipment;
    return equipment instanceof MiscEquipment
      && (isShieldEquipment(equipment) || isClubOrHandWeaponEquipment(equipment))
      && ['LA', 'RA'].includes(mount.location) && this.hasAesAt(mount.location) ? 1.25 : 1;
  }

  protected override heatEfficiency(): number {
    let efficiency = 6 + Math.max(0, this.entity.heatDissipation());
    const standardLam = this.entity.isLandAirMek();
    if (standardLam) efficiency += 3;
    const coolantPods = this.entity.equipment().filter(mount =>
      this.isWorking(mount) && mount.equipment instanceof AmmoEquipment
      && mount.equipment.ammoType === 'COOLANT_POD').length;
    if (coolantPods > 0) efficiency += Math.ceil(this.entity.totalHeatSinks() * coolantPods / 5);
    let moveHeat: number;
    if (standardLam) {
      moveHeat = Math.round(this.entity.airMekFlankMP() / 3);
    } else {
      moveHeat = this.movementHeat().heat;
    }
    efficiency -= moveHeat;
    const stealth = [...this.entity.armorByLocation().values()].some(a => a.armor.armorType === 'STEALTH');
    efficiency -= signatureHeatEfficiencyPenalty({
      stealthArmor: stealth,
      chameleonShield: this.hasEquipment(isChameleonShieldEquipment),
      nullSignature: this.hasEquipment(isNullSignatureEquipment),
      voidSignature: this.hasEquipment(isVoidSignatureEquipment),
    });
    if (this.entity.equipment().some(mount => isEmergencyCoolantSystemEquipment(mount.equipment))) {
      efficiency += EMERGENCY_COOLANT_HEAT_EFFICIENCY_BONUS;
    }
    efficiency -= (this.state?.engineHits ?? 0) * 5;
    return efficiency;
  }

  protected override heatEfficiencyCalculation(efficiency: number): string {
    const capacity = Math.max(0, this.entity.heatDissipation());
    const movement = this.movementHeat();
    return `6 + ${capacity} - ${movement.heat} (${movement.type}) = ${this.format(efficiency)}`;
  }

  private movementHeat(): { heat: number; type: 'Jump' | 'Run' } {
    const runHeat = this.entity.isIndustrial() || this.entity.equipment().some(
      mount => isSuperCooledMyomerEquipment(mount.equipment),
    )
      ? 0
      : this.entity.mountedEngine().descriptor().movementHeat.run;
    const jumpMP = this.state?.movement.jump ?? this.entity.computeJumpMP({
      ...BV_MOVEMENT_CALCULATION,
      includeAlternateJumpSystems: false,
    });
    if (jumpMP <= 0) return { heat: runHeat, type: 'Run' };

    const partialWingBonus = this.entity.equipment().some(
      mount => isPartialWingEquipment(mount.equipment),
    ) ? partialWingJumpBonus(this.entity.weightClass()) : 0;
    const movedMP = Math.max(0, jumpMP - partialWingBonus);
    const firstJumpJet = this.entity.equipment()
      .find(mount => this.isWorking(mount) && isJumpJetEquipment(mount.equipment))?.equipment;
    const improved = isImprovedJumpJetEquipment(firstJumpJet);
    const prototype = isPrototypeImprovedJumpJetEquipment(firstJumpJet);
    const adjustedMP = improved
      ? prototype ? movedMP * 2 : Math.ceil(movedMP / 2)
      : movedMP;
    const engineHeat = this.entity.mountedEngine().descriptor().movementHeat;
    let jumpHeat = Math.max(engineHeat.jumpMin, adjustedMP * engineHeat.jumpPerMP);
    if (improved && prototype) jumpHeat = Math.max(6, jumpHeat);
    return jumpHeat > runHeat
      ? { heat: jumpHeat, type: 'Jump' }
      : { heat: runHeat, type: 'Run' };
  }

  protected override processWeight(): void {
    const before = this.offensiveValue;
    let aesMultiplier = 1;
    if (this.hasAesAt('LA')) aesMultiplier += 0.1;
    if (this.hasAesAt('RA')) aesMultiplier += 0.1;
    if (this.hasCompleteLegAes()) aesMultiplier += isQuadMekConfig(this.entity.chassisConfig) ? 0.4 : 0.2;
    const myomerKind = this.entity.equipment()
      .map(mount => tripleStrengthMyomerKind(mount.equipment))
      .find(kind => kind !== undefined);
    const myomerMultiplier = tripleStrengthMyomerBvMultiplier(myomerKind);
    this.offensiveValue += this.entity.tonnage() * aesMultiplier * myomerMultiplier;
    const modifiers = `${aesMultiplier === 1 ? '' : ` x ${this.format(aesMultiplier)}`}${myomerMultiplier === 1 ? '' : ` x ${this.format(myomerMultiplier)}`}`;
    this.addValueLine('Weight', `+ ${this.format(this.entity.tonnage())}${modifiers}`, before);
  }

  protected override currentOffensiveSpeedFactorMP(): number {
    if (!this.entity.isLandAirMek()) return super.currentOffensiveSpeedFactorMP();
    return this.runMP + Math.round(this.jumpMP * 3 * 1.5 / 2);
  }

  protected override processOffensiveTypeModifier(): void {
    if (this.entity.mountedCockpit().isIndustrial
      && !this.hasEquipment(isAdvancedFireControlEquipment)) {
      const before = this.offensiveValue;
      this.offensiveValue *= 0.9;
      this.addValueLine('Fire Control Modifier', `${this.format(before)} x 0.9`, before);
    }
  }

  protected override summarize(value: number): number {
    const cockpitType = this.entity.cockpitType();
    let modifier = 1;
    if (['Small', 'Torso-Mounted', 'Small Command Console'].includes(cockpitType)) modifier = 0.95;
    else if (this.hasEquipment(isDroneOperatingSystemEquipment)) modifier = DRONE_FIRE_CONTROL_BV_MULTIPLIER;
    else if (cockpitType === 'Interface') modifier = 1.3;
    else if (cockpitType === 'Virtual Reality Piloting Pod') modifier = 1.4;
    let result = value * modifier;
    if (this.entity.hasRiscHeatSinkOverrideKit()) result *= 1.01;
    return result;
  }
}

export class CombatVehicleBVCalculator extends BVCalculator {
  declare readonly entity: VehicleEntity;

  protected override processTypeModifier(): void {
    const before = this.defensiveValue;
    let modifier = vehicleTypeModifier(this.entity.motiveType());
    if (!this.entity.isSupportVehicle()) {
      for (const mount of this.entity.equipment()) {
        const equipment = mount.equipment;
        if (!(equipment instanceof MiscEquipment)) continue;
        modifier += chassisDefensiveBattleValueBonus(equipment);
      }
    }
    this.defensiveValue *= modifier;
    this.addValueLine('Type Modifier', `${this.format(before)} x ${this.format(modifier)}`, before);
  }

  protected override processDefensiveFactor(): void {
    const airborne = this.entity.entityType === 'VTOL' || this.entity.entityType === 'SupportVTOL'
      || this.entity.motiveType() === 'WiGE';
    let running = this.runMP === 0 ? 0 : targetMovementModifier(this.runMP, false, airborne);
    let jumping = this.jumpMP === 0 ? 0 : targetMovementModifier(this.jumpMP, true);
    const stealth = !this.entity.hasPatchworkArmor()
      && [...this.entity.armorByLocation().values()]
        .some(value => ['STEALTH', 'STEALTH_VEHICLE'].includes(value.armor.armorType));
    if (stealth) {
      if (this.runMP > 0) running += 2;
      if (this.jumpMP > 0) jumping += 2;
    }
    this.addReportLine('TMMs', `${running} (R), ${jumping} (J), 0 (U)`);
    const before = this.defensiveValue;
    const factor = 1 + Math.max(running, jumping) / 10;
    this.defensiveValue *= factor;
    this.addValueLine('Defensive Factor', `${this.format(before)} x ${this.format(factor)}`, before);
  }

  protected override frontWeapon(mount: EntityMountedEquipment): boolean { return mount.location === 'Front'; }
  protected override rearWeapon(mount: EntityMountedEquipment): boolean { return mount.location === 'Rear'; }
  protected override isNominalRear(mount: EntityMountedEquipment): boolean {
    // MegaMek compares inherited Tank turret indices. On a superheavy those
    // indices correspond to Rear Left and Rear, not its actual turret(s).
    const excluded = this.entity.isSuperHeavy()
      ? ['Rear Left', 'Rear']
      : ['Turret', 'Front Turret', 'Rear Turret'];
    return !excluded.includes(mount.location) && super.isNominalRear(mount);
  }
  protected override processWeight(): void {
    const before = this.offensiveValue;
    this.offensiveValue += this.entity.tonnage() / 2;
    this.addValueLine('Weight', `+ ${this.format(this.entity.tonnage())} / 2`, before);
  }
}

export class AeroBVCalculator extends HeatTrackingBVCalculator {
  declare readonly entity: AeroEntity;
  protected override processStructure(): void {
    const before = this.defensiveValue;
    const blueShieldMultiplier = this.hasEquipment(isBlueShieldEquipment) ? BLUE_SHIELD_BV_MULTIPLIER : 1;
    const structuralIntegrity = this.currentStructuralIntegrity();
    this.defensiveValue += structuralIntegrity * 2 * blueShieldMultiplier;
    const modifier = blueShieldMultiplier === 1 ? '' : ' x 1.2 (Blue Shield)';
    this.addValueLine(
      'Structural Integrity',
      `+ ${structuralIntegrity} x 2${modifier}`,
      before,
    );
  }
  protected currentStructuralIntegrity(): number {
    return this.state?.structureRemaining('SI') ?? this.entity.structuralIntegrity();
  }
  protected override processTypeModifier(): void {
    const before = this.defensiveValue;
    let modifier = this.entity.isSupportVehicle() || this.entity.entityType === 'SmallCraft' ? 1
      : this.entity.entityType === 'ConvFighter' ? 1.1 : 1.2;
    const stealth = !this.entity.hasPatchworkArmor() && [...this.entity.armorByLocation().values()]
      .some(a => ['STEALTH', 'STEALTH_VEHICLE'].includes(a.armor.armorType));
    if (stealth) modifier += 0.3;
    this.defensiveValue *= modifier;
    this.addValueLine('Type Modifier', `${this.format(before)} x ${this.format(modifier)}`, before);
  }
  protected override processExplosiveEquipment(): void {
    if (this.entity.techBase() !== 'Clan'
      && !this.hasEquipment(isStandardCaseEquipment)
      && !this.hasEquipment(isCaseIIEquipment)) {
      const ammoTypes = new Set<string>();
      let otherExplosives = 0;
      for (const mount of this.entity.equipment()) {
        const equipment = mount.equipment;
        if (!this.isExplosive(mount) || mount.location === 'Unallocated') continue;
        if (equipment instanceof AmmoEquipment) {
          if ((mount.getAmmoShots() ?? 0) > 0) ammoTypes.add(equipment.id);
        } else if (!(equipment instanceof WeaponEquipment)
          || !['AC_ROTARY', 'AC', 'AC_IMP', 'AC_PRIMITIVE', 'PAC', 'LAC'].includes(equipment.ammoType)) {
          otherExplosives++;
        }
      }
      this.defensiveValue -= ammoTypes.size * 15 + otherExplosives;
    }
    super.processExplosiveEquipment();
  }
  protected override processDefensiveFactor(): void {}
  protected override frontWeapon(mount: EntityMountedEquipment): boolean {
    return !mount.rearMounted && mount.location !== 'Aft';
  }
  protected override rearWeapon(mount: EntityMountedEquipment): boolean {
    return mount.rearMounted || mount.location === 'Aft';
  }
  protected override heatEfficiency(): number { return 6 + Math.max(0, this.entity.heatCapacity()); }
  protected override processWeapons(): void {
    // MegaMek FixedWingSupport extends ConvFighter, so both families bypass
    // HeatTrackingBVCalculator and count every weapon at full BV.
    if (this.entity.entityType === 'ConvFighter' || this.entity.entityType === 'FixedWingSupport') {
      this.processWeaponsWithoutHeat();
      return;
    }
    super.processWeapons();
  }
  protected override summarize(value: number): number {
    const reduced = ['Small', 'Command Console'].includes(this.entity.cockpitType())
      || this.hasEquipment(isDroneOperatingSystemEquipment);
    return super.summarize(value) * (reduced ? 0.95 : 1);
  }
}

export class LargeAeroBVCalculator extends AeroBVCalculator {
  protected nominalNoseLocation = 0;
  protected nominalLeftLocation = 1;
  protected nominalRightLocation = 5;

  protected override processStructure(): void { this.defensiveValue += this.currentStructuralIntegrity() * 20; }
  protected override armorFactor(): number { return 25; }
  protected override processTypeModifier(): void {
    this.defensiveValue *= this.entity.entityType === 'SpaceStation' ? 0.7
      : this.entity.entityType === 'WarShip' ? 0.8 : 0.75;
  }
  protected override heatEfficiency(): number { return Math.max(0, this.entity.heatCapacity()); }
  protected override processExplosiveEquipment(): void {}

  protected arc(mount: EntityMountedEquipment): number {
    const arcs = ['Nose', 'FLS', 'ALS', 'Aft', 'ARS', 'FRS'];
    const result = arcs.indexOf(mount.location);
    return result >= 0 ? result : 5;
  }

  protected adjacentCCW(arc: number): number { return (arc + 1) % 6; }
  protected adjacentCW(arc: number): number { return (arc + 5) % 6; }
  protected opposite(arc: number): number { return (arc + 3) % 6; }
  protected nominalCandidates(): readonly number[] { return [0, 1, 2, 3, 4, 5]; }

  protected arcTotals(): number[] {
    const totals = Array.from({ length: 8 }, () => 0);
    for (const mount of this.entity.equipment()) {
      if (this.countsAsOffensiveWeapon(mount)) totals[this.arc(mount)] += this.weaponBV(mount, false);
    }
    return totals;
  }

  protected override determineFront(): void {
    const totals = this.arcTotals();
    const candidates = this.nominalCandidates();
    this.nominalNoseLocation = candidates.reduce((best, arc) => totals[arc] > totals[best] ? arc : best, candidates[0]);
    const ccw = this.adjacentCCW(this.nominalNoseLocation);
    const cw = this.adjacentCW(this.nominalNoseLocation);
    if (totals[ccw] > totals[cw]) {
      this.nominalLeftLocation = ccw;
      this.nominalRightLocation = cw;
    } else {
      this.nominalLeftLocation = cw;
      this.nominalRightLocation = ccw;
    }
    this.frontDecided = true;
  }

  protected arcFactor(arc: number, heatExceeded: boolean): number {
    if (arc === this.nominalNoseLocation) return 1;
    if (arc === this.nominalLeftLocation) return heatExceeded ? 0.5 : 1;
    if (arc === this.nominalRightLocation) return heatExceeded ? 0.25 : 0.5;
    return 0.25;
  }

  protected processArc(arc: number, heatExceeded: boolean): number {
    const factor = this.arcFactor(arc, heatExceeded);
    let heat = 0;
    const weaponGroups = new Map<string, { mount: EntityMountedEquipment; count: number }>();
    const weaponCaps = new Map<string, number>();
    const ammoTotals = new Map<string, number>();
    for (const mount of this.entity.equipment()) {
      if (this.arc(mount) !== arc) continue;
      const equipment = mount.equipment;
      if (this.countsAsOffensiveWeapon(mount)) {
        const enhancementId = this.entity.getLinkingMount(mount)?.equipment?.id ?? '';
        const key = equipment instanceof WeaponEquipment
          ? JSON.stringify([equipment.id, mount.location, mount.rearMounted, enhancementId])
          : mount.mountId;
        const group = weaponGroups.get(key);
        if (group) group.count++;
        else weaponGroups.set(key, { mount, count: 1 });
        heat += this.weaponHeat(mount);
      }
      if (equipment instanceof WeaponEquipment && this.weaponUsesAmmo(equipment)) {
        const key = `${equipment.ammoType}:${equipment.rackSize}`;
        weaponCaps.set(key, (weaponCaps.get(key) ?? 0) + mount.getBV(this.entity));
      } else if (equipment instanceof AmmoEquipment && this.ammoCounts(mount)) {
        const key = `${equipment.ammoType}:${equipment.rackSize}`;
        ammoTotals.set(key, (ammoTotals.get(key) ?? 0) + this.ammoBV(mount));
      }
    }
    for (const group of weaponGroups.values()) {
      this.offensiveValue += this.weaponBV(group.mount, false, group.count, factor);
    }
    for (const [key, ammo] of ammoTotals) {
      const cap = weaponCaps.get(key);
      if (cap !== undefined) this.offensiveValue += Math.min(ammo, cap) * factor;
      else if (key === 'COOLANT_POD:1') this.offensiveValue += ammo * factor;
    }
    return heat;
  }

  protected weaponArcOrder(): number[] {
    return [
      this.nominalNoseLocation,
      this.nominalLeftLocation,
      this.nominalRightLocation,
      this.opposite(this.nominalNoseLocation),
      this.opposite(this.nominalLeftLocation),
      this.opposite(this.nominalRightLocation),
    ];
  }

  protected override processWeapons(): void {
    const order = this.weaponArcOrder();
    const heatLimit = this.heatEfficiency();
    let heat = this.processArc(order[0], false);
    let exceeded = heat > heatLimit;
    heat += this.processArc(order[1], exceeded);
    exceeded = heat > heatLimit;
    for (const arc of order.slice(2)) this.processArc(arc, exceeded);
  }

  protected override processAmmo(): void {}
}

export class DropShipBVCalculator extends LargeAeroBVCalculator {
  protected override processStructure(): void {
    this.defensiveValue += this.currentStructuralIntegrity() * 2
      * (this.hasEquipment(isBlueShieldEquipment) ? BLUE_SHIELD_BV_MULTIPLIER : 1);
  }
  protected override armorFactor(): number { return 2.5; }
  protected override processTypeModifier(): void {
    const stealth = !this.entity.hasPatchworkArmor()
      && this.entity.uniformArmor()?.armor.armorType === 'STEALTH';
    this.defensiveValue *= stealth ? 1.3 : 1;
  }
  protected override arc(mount: EntityMountedEquipment): number {
    if (mount.location === 'Nose') return 0;
    if (mount.location === 'Left Side') return mount.rearMounted ? 2 : 1;
    if (mount.location === 'Aft') return 3;
    if (mount.location === 'Right Side') return mount.rearMounted ? 4 : 5;
    return 5;
  }
}

export class JumpShipBVCalculator extends LargeAeroBVCalculator {}

export class WarShipBVCalculator extends JumpShipBVCalculator {
  private static readonly CW = [5, 0, 6, 2, 3, 7, 1, 4] as const;
  private static readonly CCW = [1, 6, 3, 4, 7, 0, 2, 5] as const;
  private static readonly OPPOSITE = [3, 4, 5, 0, 1, 2, 7, 6] as const;
  private weakerAdjacentArc = 5;

  protected override arc(mount: EntityMountedEquipment): number {
    const arcs = [
      'Nose', 'FLS', 'ALS', 'Aft', 'ARS', 'FRS',
      'Left Broadside', 'Right Broadside',
    ];
    const result = arcs.indexOf(mount.location);
    return result >= 0 ? result : 7;
  }
  protected override adjacentCCW(arc: number): number { return WarShipBVCalculator.CCW[arc]; }
  protected override adjacentCW(arc: number): number { return WarShipBVCalculator.CW[arc]; }
  protected override opposite(arc: number): number { return WarShipBVCalculator.OPPOSITE[arc]; }
  protected override nominalCandidates(): readonly number[] { return [0, 3, 6, 7]; }
  protected override determineFront(): void {
    super.determineFront();
    this.weakerAdjacentArc = this.nominalRightLocation;
    this.nominalRightLocation = this.opposite(this.nominalNoseLocation);
  }
  protected override weaponArcOrder(): number[] {
    return [
      this.nominalNoseLocation,
      this.nominalLeftLocation,
      this.nominalRightLocation,
      this.adjacentCCW(this.nominalRightLocation),
      this.adjacentCW(this.nominalRightLocation),
      this.adjacentCCW(this.adjacentCCW(this.nominalRightLocation)),
      this.adjacentCW(this.adjacentCW(this.nominalRightLocation)),
      this.weakerAdjacentArc,
    ];
  }
}

export class ProtoMekBVCalculator extends BVCalculator {
  declare readonly entity: ProtoMekEntity;
  protected override processDefensiveFactor(): void {
    const run = targetMovementModifier(this.runMP) + (this.entity.isGlider() ? 1 : 0);
    const jump = targetMovementModifier(this.jumpMP, true);
    const umu = targetMovementModifier(this.umuMP);
    this.addReportLine('TMMs', `${run} (R), ${jump} (J), ${umu} (U)`);
    const before = this.defensiveValue;
    const factor = 1.1 + Math.max(run, jump, umu) / 10;
    this.defensiveValue *= factor;
    this.addValueLine('Defensive Factor', `${this.format(before)} x ${this.format(factor)}`, before);
  }
  protected override ammoBV(mount: EntityMountedEquipment): number {
    const ammo = this.ammoEquipment(mount);
    const bv = ammo && this.gameRules.getAmmoBV(ammo, this.entity.getEquipmentRegistry());
    return ammo instanceof AmmoEquipment
      && typeof bv === 'number'
      ? this.ammoKgPerShot(ammo) * this.ammoShots(mount) / 1000 * bv
      : 0;
  }
}

export class InfantryBVCalculator extends BVCalculator {
  declare readonly entity: InfantryEntity;
  protected override processArmor(): void {}
  protected override processStructure(): void {
    const troopers = this.currentTroopers();
    this.defensiveValue = troopers * 1.5 * infantryDamageDivisor(this.entity);
    if (hasInfantryAugmentation(this.entity, 'gas_effuser_pheromone')) {
      this.defensiveValue += troopers * 0.05;
    }
  }
  protected override tmmFactor(running: number, jumping: number, umu: number): number {
    const maximum = Math.max(running, jumping, umu, hasDermalCamoStealth(this.entity) ? 3 : 0);
    let factor = 1 + maximum / 10;
    if (this.entity.effectiveDEST()) factor += 0.2;
    if (this.entity.effectiveSneakCamo()) factor += 0.2;
    if (this.entity.effectiveSneakIR()) factor += 0.2;
    if (this.entity.effectiveSneakECM()) factor += 0.1;
    return factor;
  }
  protected override processWeapons(): void {
    const originalTroopers = Math.max(0, this.entity.squadSize() * this.entity.squadCount());
    const secondary = this.entity.secondaryCount() * this.entity.squadCount();
    const primary = originalTroopers - secondary;
    const primaryBV = this.entity.primaryWeapon()?.bv;
    const secondaryBV = this.entity.secondaryWeapon()?.bv;
    if (typeof primaryBV === 'number') this.offensiveValue += primaryBV * primary;
    if (typeof secondaryBV === 'number') this.offensiveValue += secondaryBV * secondary;
    if (canMakeAntiMekAttacks(this.entity)) {
      const beforeAntiMek = this.offensiveValue;
      if (typeof primaryBV === 'number' && !this.entity.primaryWeapon()?.hasWeaponTrait('infantry-archaic')) this.offensiveValue += primaryBV * primary;
      if (typeof secondaryBV === 'number' && !this.entity.secondaryWeapon()?.hasWeaponTrait('infantry-archaic')) this.offensiveValue += secondaryBV * secondary;
      if (hasProstheticAntiMekBonus(this.entity)) {
        this.offensiveValue += (this.offensiveValue - beforeAntiMek) * 0.2;
      }
    }
    if (hasInfantryAugmentation(this.entity, 'gas_effuser_toxin')) this.offensiveValue += originalTroopers * 0.23;
    const troopers = this.currentTroopers();
    if (troopers < originalTroopers && originalTroopers > 0) {
      this.offensiveValue *= troopers / originalTroopers;
    }
    if (hasInfantryAugmentation(this.entity, 'tsm_implant')) this.offensiveValue += troopers * 0.1;
    if (hasInfantryAugmentation(this.entity, 'suicide_implants')) this.offensiveValue += troopers * 0.12;
    if (hasInfantryAugmentation(this.entity, 'pl_enhanced')
      || hasInfantryAugmentation(this.entity, 'pl_ienhanced')) {
      this.offensiveValue += troopers * prostheticDamageBonus(this.entity);
    }
    if (hasInfantryAugmentation(this.entity, 'pl_tail')) this.offensiveValue += troopers * 0.2;
    for (const mount of this.entity.equipment().filter(m => m.location === 'Field Guns')) {
      if (this.countsAsOffensiveWeapon(mount)) this.offensiveValue += this.weaponBV(mount, false);
    }
  }
  private currentTroopers(): number {
    return Math.max(0, this.state?.structureRemaining('Infantry')
      ?? this.entity.squadSize() * this.entity.squadCount());
  }
  protected override summarize(value: number): number {
    let modifier = 1;
    const specs = this.entity.specializations();
    if (['bridge-engineers', 'demo-engineers', 'fire-engineers', 'mine-engineers',
      'sensor-engineers', 'trench-engineers'].some(spec => specs.has(spec as never))) modifier += 0.1;
    if (specs.has('marines')) modifier += 0.3;
    if (specs.has('mountain-troops')) modifier += 0.2;
    if (specs.has('paratroops')) modifier += 0.1;
    if (specs.has('scuba')) modifier += 0.1;
    if (specs.has('xct')) modifier += 0.1;
    return value * modifier;
  }
}

export class BattleArmorBVCalculator extends BVCalculator {
  declare readonly entity: BattleArmorEntity;
  protected currentTrooper = 1;

  /**
   * Mirrors MegaMek's BattleArmorBVCalculator.singleTrooperBattleValue().
   * Record sheets print this beside the formation BV.
   */
  singleTrooperBattleValue(): number {
    this.prepare();
    this.currentTrooper = 1;
    this.defensiveValue = this.offensiveValue = 0;
    this.processDefensiveValue();
    this.processOffensiveValue();
    return Math.round(this.defensiveValue + this.offensiveValue);
  }

  override calculateBaseBV(): number { return this.calculate().base; }
  override calculate() {
    if (this.state?.destroyed) {
      return {
        defensive: 0,
        offensive: 0,
        base: 0,
        details: [{ type: 'Battle Value', calculation: 'Destroyed', total: 0, delta: 0 }],
      };
    }
    this.prepare();
    let sum = 0;
    const activeTroopers = Array.from({ length: this.entity.trooperCount() }, (_, index) => index + 1)
      .filter(trooper => !this.state || this.state.structureRemaining(`Trooper ${trooper}`) > 0);
    const count = activeTroopers.length;
    if (count === 0) {
      return {
        defensive: 0,
        offensive: 0,
        base: 0,
        details: [{ type: 'Battle Value', calculation: 'No surviving troopers', total: 0, delta: 0 }],
      };
    }
    for (const trooper of activeTroopers) {
      this.currentTrooper = trooper;
      this.defensiveValue = this.offensiveValue = 0;
      this.processDefensiveValue();
      this.processOffensiveValue();
      sum += this.defensiveValue + this.offensiveValue;
    }
    const base = sum / count * ((0.9 + 0.1 * count) * count);
    const rounded = Math.round(base);
    return {
      defensive: 0,
      offensive: 0,
      base: rounded,
      details: [
        { type: 'Effective MP', calculation: `R: ${this.runMP}, J: ${this.jumpMP}, U: ${this.umuMP}` },
        { type: 'Defensive Battle Rating', details: [] },
        { type: 'Offensive Battle Rating', details: [] },
        {
          type: 'Battle Value',
          details: [{
            type: 'Base Unit BV',
            calculation: `${this.format(sum)} / ${count} x ${this.format((0.9 + 0.1 * count) * count)}, rn`,
            total: rounded,
            delta: rounded,
          }],
        },
      ],
    };
  }
  protected override processArmor(): void {
    const points = this.state?.armorRemaining(`Trooper ${this.currentTrooper}`, 'front')
      ?? this.entity.armorValues().get('Squad')?.front
      ?? 0;
    const armor = this.entity.uniformArmor()?.armor;
    const factor = armor?.armorType === 'BA_FIRE_RESIST' || armor?.armorType === 'BA_REFLECTIVE'
      || armor?.armorType === 'BA_REACTIVE' ? 3.5 : 2.5;
    this.defensiveValue += 1 + points * factor;
  }
  protected override processStructure(): void {}
  protected override tmmFactor(running: number, jumping: number, umu: number): number {
    let bonus = 0.1;
    const armorType = this.entity.uniformArmor()?.armor.armorType;
    if (this.hasEquipmentId('Camo System')) bonus += 0.2;
    if (armorType === 'BA_STEALTH_IMP') bonus += 0.3;
    else if (['BA_STEALTH_BASIC', 'BA_STEALTH', 'BA_STEALTH_PROTOTYPE'].includes(armorType ?? '')) bonus += 0.2;
    if (armorType === 'BA_MIMETIC') bonus += 0.3;
    return super.tmmFactor(running, jumping, umu) + bonus;
  }

  protected override countsAsOffensiveWeapon(mount: EntityMountedEquipment): boolean {
    return mount.equipment?.id !== 'InfantryAssaultRifle' && super.countsAsOffensiveWeapon(mount);
  }

  protected override processDefensiveEquipment(): void {
    let systems = 0;
    const equipment = this.entity.equipment().map(mount => mount.equipment).filter(item => item != null);
    if (equipment.some(item => ['ISImprovedSensors', 'CLImprovedSensors'].includes(item.id))) systems++;
    if (equipment.some(item => isBapEquipment(item)
      && !['ISImprovedSensors', 'CLImprovedSensors'].includes(item.id))) systems++;
    const ecm = equipment.find(isEcmEquipment);
    systems += ecmDefensiveSystemValue(ecm);
    this.defensiveValue += systems;

    const troopers = Math.max(1, this.entity.trooperCount());
    for (const mount of this.entity.equipment()) {
      if (mount.equipment instanceof WeaponEquipment
        && mount.equipment.hasWeaponTrait('anti-missile')) {
        this.defensiveValue += mount.getBV(this.entity) / (mount.location === 'Squad' ? 1 : troopers);
      }
    }
  }

  protected override processWeapons(): void {
    const trooper = `Trooper ${this.currentTrooper}`;
    const mounts = this.entity.equipment().filter(mount => this.countsAsOffensiveWeapon(mount));

    // Ordinary squad equipment excludes squad-support weapons and battle claws.
    for (const mount of mounts) {
      const claw = mount.equipment instanceof MiscEquipment
        && (mount.equipment.hasWeaponTrait('vibroclaw')
          || isMagnetClawEquipment(mount.equipment));
      if (mount.location === 'Squad' && !mount.isSSWM && !claw) {
        this.offensiveValue += this.weaponBV(mount, false);
      }
    }

    // Per-trooper and squad-support weapons form a separate Java section.
    for (const mount of mounts) {
      if (!(mount.equipment instanceof WeaponEquipment)
        || mount.equipment.hasWeaponTrait('infantry-weapon')) continue;
      if (mount.location === trooper || mount.isSSWM) {
        this.offensiveValue += this.weaponBV(mount, false)
          / (mount.isSSWM ? this.entity.trooperCount() : 1);
      }
    }

    if (!this.canMakeAntiMekAttacks()) return;
    for (const mount of this.entity.equipment()) {
      if (!this.countsAsOffensiveWeapon(mount)) continue;
      const inTrooperSection = mount.location === 'Squad' || mount.location === trooper;
      const claw = mount.equipment instanceof MiscEquipment
        && (mount.equipment.hasWeaponTrait('vibroclaw')
          || isMagnetClawEquipment(mount.equipment));
      const weapon = mount.equipment instanceof WeaponEquipment
        && !mount.equipment.hasWeaponTrait('infantry-weapon')
        && !mount.equipment.hasWeaponTrait('missile')
        && mount.baMountLocation !== 'Body';
      if (inTrooperSection && (claw || weapon)) {
        this.offensiveValue += this.weaponBV(mount, false)
          / (mount.isSSWM ? this.entity.trooperCount() : 1);
      }
    }
  }

  protected override processOffensiveEquipment(): void {
    const trooper = `Trooper ${this.currentTrooper}`;
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      if (mount.location !== trooper || !(equipment instanceof MiscEquipment)
        || this.countsAsOffensiveWeapon(mount)) continue;
      this.offensiveValue += mount.getBV(this.entity);
    }
  }

  private canMakeAntiMekAttacks(): boolean {
    if (this.entity.chassisType().toLowerCase().includes('quad') || this.entity.motiveType() === 'UMU') return false;
    if (this.entity.weightClass() === 'Assault' || this.entity.weightClass() === 'Heavy') return false;
    const equipment = this.entity.equipment().map(mount => mount.equipment).filter(item => item != null);
    if (equipment.some(isMagneticClampEquipment)) return true;
    const gloves = equipment.filter(isArmoredGloveEquipment).length;
    const lightEnoughForGloves = this.entity.weightClass() === 'Ultra Light'
      || this.entity.weightClass() === 'Light';
    return (lightEnoughForGloves && gloves >= 2)
      || equipment.some(item => isBasicManipulatorEquipment(item) || isBattleClawEquipment(item));
  }

  private hasEquipmentId(id: string): boolean {
    return this.entity.equipment().some(mount => mount.equipment?.id === id);
  }
  protected override ammoCounts(mount: EntityMountedEquipment): boolean {
    return (mount.location === 'Squad' || mount.location === `Trooper ${this.currentTrooper}`) && super.ammoCounts(mount);
  }
  protected override ammoBV(mount: EntityMountedEquipment): number {
    const ammo = this.ammoEquipment(mount);
    const bv = ammo && this.gameRules.getAmmoBV(ammo, this.entity.getEquipmentRegistry());
    return ammo instanceof AmmoEquipment
      && typeof bv === 'number'
      ? this.ammoKgPerShot(ammo) * this.ammoShots(mount) / 1000 * bv
      : 0;
  }
}

export class HandheldWeaponBVCalculator extends BVCalculator {
  protected override processDefensiveValue(): void { this.processArmor(); this.processDefensiveEquipment(); }
  protected override processArmor(): void { this.defensiveValue += this.entity.totalArmorPoints() * 2; }
  protected override processOffensiveValue(): void {
    this.processWeapons(); this.processAmmo(); this.processOffensiveEquipment();
  }
  protected override ammoBV(mount: EntityMountedEquipment): number {
    const tonnage = mount.getTonnage(this.entity) ?? 0;
    const ammo = this.ammoEquipment(mount);
    if (!ammo) return 0;
    const bv = this.gameRules.getAmmoBV(ammo, this.entity.getEquipmentRegistry());
    return typeof bv === 'number' ? bv * tonnage : 0;
  }
}
