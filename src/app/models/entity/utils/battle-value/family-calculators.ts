import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';
import type { EntityMountedEquipment } from '../../types';
import { AeroEntity } from '../../entities/aero/aero-entity';
import { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../../entities/infantry/infantry-entity';
import { MekEntity } from '../../entities/mek/mek-entity';
import { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { getMekLegLocations, isQuadMekConfig } from '../../types/mek';
import { getPpcCapacitorBV } from '../equipment-bv';
import { vehicleTypeModifier, targetMovementModifier } from './rules';
import { BVCalculator } from './bv-calculator';
import {
  canMakeAntiMekAttacks,
  hasDermalCamoStealth,
  hasInfantryAugmentation,
  hasProstheticAntiMekBonus,
  infantryDamageDivisor,
  prostheticDamageBonus,
} from './infantry-rules';

/** Shared Java HeatTrackingBVCalculator behavior for pristine mounts. */
export class HeatTrackingBVCalculator extends BVCalculator {
  protected heatEfficiency(): number { return Number.MAX_SAFE_INTEGER; }

  protected override processExplosiveEquipment(): void {
    const before = this.defensiveValue;
    this.defensiveValue = Math.max(1, this.defensiveValue);
    if (this.defensiveValue !== before) this.addValueLine('Minimum Defensive Value', undefined, before);
  }

  protected weaponHeat(mount: EntityMountedEquipment): number {
    const weapon = mount.equipment;
    if (!(weapon instanceof WeaponEquipment)) return 0;
    let heat = weapon.heat;
    if (weapon.weapon.heatAdjustmentForBvCalculation) {
      heat += weapon.weapon.heatAdjustmentForBvCalculation;
    }
    if (weapon.oneShotCount) heat /= 4;
    if (weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB') heat *= 2;
    else if (weapon.ammoType === 'AC_ROTARY') heat *= 6;
    if (['SRM_STREAK', 'LRM_STREAK', 'IATM'].includes(weapon.ammoType)) heat *= 0.5;
    const linkedBy = this.entity.getLinkingMount(mount)?.equipment;
    if (linkedBy instanceof MiscEquipment) {
      if (linkedBy.hasFlag('F_RISC_LASER_PULSE_MODULE')) heat += 2;
      if (linkedBy.hasFlag('F_LASER_INSULATOR')) heat = Math.max(1, heat - 1);
      if (linkedBy.hasFlag('F_PPC_CAPACITOR')) heat += 5;
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

  protected override processArmor(): void {
    super.processArmor();
    const before = this.defensiveValue;
    if (this.entity.mountedCockpit().addsDefensiveBVForCTArmor) {
      const ct = this.entity.armorValues().get('CT');
      const armor = this.entity.armorByLocation().get('CT')?.armor;
      if (ct) this.defensiveValue += (ct.front + ct.rear) * 2.5
        * (armor?.armorType === 'HARDENED' ? 2 : 1);
    }
    if (this.defensiveValue !== before) {
      this.addValueLine('Torso-Mounted Cockpit Armor', `+ ${this.format(this.defensiveValue - before)}`, before);
    }
  }

  protected override processStructure(): void {
    const before = this.defensiveValue;
    let multiplier = 1;
    const structures = [...this.entity.structureByLocation().values()];
    if (structures.length > 0 && structures.every(s => s.structure.hasAnyFlag([
      'F_INDUSTRIAL_STRUCTURE', 'F_COMPOSITE', 'F_COMPOSITE_STRUCTURE',
    ]))) multiplier = 0.5;
    else if (structures.length > 0 && structures.every(s => s.structure.hasFlag('F_REINFORCED_STRUCTURE'))) {
      multiplier = 2;
    }
    if (this.has('F_BLUE_SHIELD')) multiplier += 0.2;

    const sideTorsoEngineCriticals = this.entity.mountedEngine().getSideTorsoSlots().length;
    const engineMultiplier = sideTorsoEngineCriticals >= 6 ? 0.25
      : sideTorsoEngineCriticals >= 3 ? 0.5
        : sideTorsoEngineCriticals === 2 ? 0.75
          : sideTorsoEngineCriticals === 1 ? 0.825 : 1;
    this.defensiveValue += this.entity.totalInternalPoints() * 1.5 * multiplier * engineMultiplier;
    const structureTotal = this.defensiveValue;
    const typeModifier = multiplier === 1 ? '' : ` x ${this.format(multiplier)}`;
    const engineModifier = engineMultiplier === 1 ? '' : ` x ${this.format(engineMultiplier)}`;
    const engine = this.entity.mountedEngine();
    const engineLabel = engineMultiplier === 1 ? '' : ` (${engine.rating} ${engine.type()})`;
    this.addValueLine('Internal Structure', `+ ${this.entity.totalInternalPoints()} x 1.5${typeModifier}${engineModifier}${engineLabel}`, before);

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
      if (!mount.armored || !equipment || equipment.hasFlag('F_PPC_CAPACITOR')) continue;
      const placedSlots = mount.placements?.length;
      const requiredSlots = mount.getCriticalSlotRequirement(this.entity);
      let slots = placedSlots && placedSlots > 0 ? placedSlots
        : typeof requiredSlots === 'number' ? requiredSlots : 0;
      let value = mount.getBV(this.entity);
      if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_PPC')) {
        const capacitor = this.entity.getLinkingMount(mount)?.equipment;
        if (capacitor?.hasFlag('F_PPC_CAPACITOR')) {
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

  private locationHas(location: string, flag: string): boolean {
    if (flag === 'F_CASE' && this.entity.locationHasCaseProtection(location)) return true;
    return this.entity.equipment().some(mount => mount.getOccupiedLocations().includes(location)
      && mount.equipment?.hasFlag(flag));
  }

  private hasExplosivePenalty(location: string): boolean {
    if (location === 'Unallocated' || this.locationHas(location, 'F_CASE_II')) return false;
    const sideEngineSlots = this.entity.mountedEngine().getSideTorsoSlots().length;
    if (!isQuadMekConfig(this.entity.chassisConfig) && (location === 'LA' || location === 'RA')) {
      const transfer = location === 'LA' ? 'LT' : 'RT';
      return !this.locationHas(location, 'F_CASE') && this.hasExplosivePenalty(transfer);
    }
    if (location === 'LT' || location === 'RT') {
      return !this.locationHas(location, 'F_CASE') || sideEngineSlots >= 3;
    }
    return true;
  }

  protected override processExplosiveEquipment(): void {
    const before = this.defensiveValue;
    const details = this.captureDetails(() => {
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      if (!equipment?.isExplosive() || mount.location === 'Unallocated'
        || equipment.hasFlag('F_BLUE_SHIELD')
        || !mount.getOccupiedLocations().some(location => this.hasExplosivePenalty(location))) continue;
      if (equipment instanceof AmmoEquipment && (mount.getAmmoShots() ?? 0) <= 0) continue;
      if (equipment instanceof WeaponEquipment) {
        if (equipment.hasFlag('F_PPC')
          && !this.entity.getLinkingMount(mount)?.equipment?.hasFlag('F_PPC_CAPACITOR')) continue;
        if (['AC_ROTARY', 'AC', 'AC_IMP', 'AC_PRIMITIVE', 'PAC', 'LAC'].includes(equipment.ammoType)) continue;
      }

      const reduced = equipment.hasAnyFlag([
        'F_PPC', 'F_PPC_CAPACITOR', 'F_RISC_LASER_PULSE_MODULE',
        'F_EMERGENCY_COOLANT_SYSTEM', 'F_JUMP_JET', 'F_B_POD', 'F_M_POD', 'F_TASER',
      ]) || (equipment instanceof AmmoEquipment && equipment.ammoType === 'COOLANT_POD')
        || (equipment instanceof WeaponEquipment && equipment.ammoType.includes('GAUSS'));
      const placedSlots = mount.placements?.length;
      const requiredSlots = mount.getCriticalSlotRequirement(this.entity);
      const slots = placedSlots && placedSlots > 0 ? placedSlots
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
    let tmm = Math.max(running, jumping, umu);
    const armorStealth = [...this.entity.armorByLocation().values()].some(a => a.armor.armorType === 'STEALTH');
    if (armorStealth || this.has('F_NULL_SIG')) tmm += 2;
    if (this.has('F_CHAMELEON_SHIELD')) tmm += 2;
    if (this.has('F_VOID_SIG')) tmm = tmm < 3 ? 3 : tmm === 3 ? 4 : tmm;
    return 1 + tmm / 10;
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
      && mount.equipment?.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM'));
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
      && equipment.hasAnyFlag(['F_CLUB', 'F_HAND_WEAPON'])
      && ['LA', 'RA'].includes(mount.location) && this.hasAesAt(mount.location) ? 1.25 : 1;
  }

  protected override heatEfficiency(): number {
    let efficiency = 6 + Math.max(0, this.entity.heatDissipation());
    const standardLam = this.entity.isLandAirMek();
    if (standardLam) efficiency += 3;
    const coolantPods = this.entity.equipment().filter(mount =>
      mount.equipment instanceof AmmoEquipment && mount.equipment.ammoType === 'COOLANT_POD').length;
    if (coolantPods > 0) efficiency += Math.ceil(this.entity.totalHeatSinks() * coolantPods / 5);
    let moveHeat: number;
    if (standardLam) {
      moveHeat = Math.round(this.entity.airMekFlankMP() / 3);
    } else {
      const jumpHeat = this.jumpMP > 0 ? Math.max(3, this.jumpMP) : 0;
      const runHeat = this.has('F_SCM') ? 0 : this.entity.mountedEngine().descriptor().movementHeat.run;
      moveHeat = Math.max(jumpHeat, runHeat);
    }
    efficiency -= moveHeat;
    const stealth = [...this.entity.armorByLocation().values()].some(a => a.armor.armorType === 'STEALTH');
    if (stealth) efficiency -= 10;
    if (this.has('F_CHAMELEON_SHIELD')) efficiency -= 6;
    if (this.has('F_NULL_SIG') || this.has('F_VOID_SIG')) efficiency -= 10;
    if (this.has('F_EMERGENCY_COOLANT_SYSTEM')) efficiency += 4;
    return efficiency;
  }

  protected override heatEfficiencyCalculation(efficiency: number): string {
    const capacity = Math.max(0, this.entity.heatDissipation());
    const runHeat = this.has('F_SCM') ? 0 : this.entity.mountedEngine().descriptor().movementHeat.run;
    const jumpHeat = this.jumpMP > 0 ? Math.max(3, this.jumpMP) : 0;
    return `6 + ${capacity} - ${Math.max(jumpHeat, runHeat)} (${jumpHeat > runHeat ? 'Jump' : 'Run'}) = ${this.format(efficiency)}`;
  }

  protected override processWeight(): void {
    const before = this.offensiveValue;
    let aesMultiplier = 1;
    if (this.hasAesAt('LA')) aesMultiplier += 0.1;
    if (this.hasAesAt('RA')) aesMultiplier += 0.1;
    if (this.hasCompleteLegAes()) aesMultiplier += isQuadMekConfig(this.entity.chassisConfig) ? 0.4 : 0.2;
    let myomerMultiplier = 1;
    if (this.has('F_TSM')) myomerMultiplier = 1.5;
    else if (this.has('F_INDUSTRIAL_TSM')) myomerMultiplier = 1.15;
    this.offensiveValue += this.entity.tonnage() * aesMultiplier * myomerMultiplier;
    const modifiers = `${aesMultiplier === 1 ? '' : ` x ${this.format(aesMultiplier)}`}${myomerMultiplier === 1 ? '' : ` x ${this.format(myomerMultiplier)}`}`;
    this.addValueLine('Weight', `+ ${this.format(this.entity.tonnage())}${modifiers}`, before);
  }

  protected override processOffensiveTypeModifier(): void {
    if (this.entity.mountedCockpit().isIndustrial && !this.has('F_ADVANCED_FIRE_CONTROL')) {
      const before = this.offensiveValue;
      this.offensiveValue *= 0.9;
      this.addValueLine('Fire Control Modifier', `${this.format(before)} x 0.9`, before);
    }
  }

  protected override summarize(value: number): number {
    let result = value * this.entity.mountedCockpit().bvMultiplier;
    if (this.entity.hasRiscHeatSinkOverrideKit()) result *= 1.01;
    return result;
  }
}

export class CombatVehicleBVCalculator extends BVCalculator {
  protected override processTypeModifier(): void {
    const before = this.defensiveValue;
    let modifier = vehicleTypeModifier(this.entity.motiveType());
    if (!this.entity.isSupportVehicle()) {
      for (const mount of this.entity.equipment()) {
        const equipment = mount.equipment;
        if (!(equipment instanceof MiscEquipment)) continue;
        if (equipment.hasFlag('F_FULLY_AMPHIBIOUS')) modifier += 0.2;
        else if (equipment.hasAnyFlag([
          'F_LIMITED_AMPHIBIOUS', 'F_DUNE_BUGGY', 'F_FLOTATION_HULL',
          'F_ENVIRONMENTAL_SEALING', 'F_ARMORED_MOTIVE_SYSTEM',
        ])) modifier += 0.1;
      }
    }
    this.defensiveValue *= modifier;
    this.addValueLine('Type Modifier', `${this.format(before)} x ${this.format(modifier)}`, before);
  }

  protected override processDefensiveFactor(): void {
    const airborne = this.entity.entityType === 'VTOL' || this.entity.entityType === 'SupportVTOL'
      || this.entity.motiveType() === 'WiGE';
    let running = targetMovementModifier(this.runMP, false, airborne);
    let jumping = targetMovementModifier(this.jumpMP, true);
    const stealth = !this.entity.hasPatchworkArmor()
      && [...this.entity.armorByLocation().values()]
        .some(value => ['STEALTH', 'STEALTH_VEHICLE'].includes(value.armor.armorType));
    if (stealth) { running += 2; jumping += 2; }
    this.addReportLine('TMMs', `${running} (R), ${jumping} (J), 0 (U)`);
    const before = this.defensiveValue;
    const factor = 1 + Math.max(running, jumping) / 10;
    this.defensiveValue *= factor;
    this.addValueLine('Defensive Factor', `${this.format(before)} x ${this.format(factor)}`, before);
  }

  protected override frontWeapon(mount: EntityMountedEquipment): boolean { return mount.location === 'Front'; }
  protected override rearWeapon(mount: EntityMountedEquipment): boolean { return mount.location === 'Rear'; }
  protected override isNominalRear(mount: EntityMountedEquipment): boolean {
    return !['Turret', 'Front Turret', 'Rear Turret'].includes(mount.location)
      && super.isNominalRear(mount);
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
    this.defensiveValue += this.entity.structuralIntegrity() * 2 * (this.has('F_BLUE_SHIELD') ? 1.2 : 1);
  }
  protected override processTypeModifier(): void {
    let modifier = this.entity.isSupportVehicle() || this.entity.entityType === 'SmallCraft' ? 1
      : this.entity.entityType === 'ConvFighter' ? 1.1 : 1.2;
    const stealth = !this.entity.hasPatchworkArmor() && [...this.entity.armorByLocation().values()]
      .some(a => ['STEALTH', 'STEALTH_VEHICLE'].includes(a.armor.armorType));
    if (stealth) modifier += 0.3;
    this.defensiveValue *= modifier;
  }
  protected override processExplosiveEquipment(): void {
    if (this.entity.techBase() !== 'Clan' && !this.has('F_CASE') && !this.has('F_CASE_II')) {
      const ammoTypes = new Set<string>();
      let otherExplosives = 0;
      for (const mount of this.entity.equipment()) {
        const equipment = mount.equipment;
        if (!equipment?.isExplosive() || mount.location === 'Unallocated') continue;
        if (equipment instanceof AmmoEquipment) {
          if ((mount.getAmmoShots() ?? 0) > 0) ammoTypes.add(equipment.id);
        } else if (!(equipment instanceof WeaponEquipment)
          || !['AC_ROTARY', 'AC', 'AC_IMP', 'AC_PRIMITIVE', 'PAC', 'LAC'].includes(equipment.ammoType)) {
          if (!(equipment instanceof WeaponEquipment && equipment.hasFlag('F_PPC')
            && !this.entity.getLinkingMount(mount)?.equipment?.hasFlag('F_PPC_CAPACITOR'))) otherExplosives++;
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
    if (this.entity.entityType === 'ConvFighter') {
      for (const mount of this.entity.equipment()) {
        if (this.countsAsOffensiveWeapon(mount)) this.offensiveValue += this.weaponBV(mount, true);
      }
      return;
    }
    super.processWeapons();
  }
  protected override summarize(value: number): number {
    const reduced = ['Small', 'Command Console'].includes(this.entity.cockpitType())
      || this.has('F_DRONE_OPERATING_SYSTEM');
    return super.summarize(value) * (reduced ? 0.95 : 1);
  }
}

export class LargeAeroBVCalculator extends AeroBVCalculator {
  protected nominalNoseLocation = 0;
  protected nominalLeftLocation = 1;
  protected nominalRightLocation = 5;

  protected override processStructure(): void { this.defensiveValue += this.entity.structuralIntegrity() * 20; }
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
    const weaponCaps = new Map<string, number>();
    const ammoTotals = new Map<string, number>();
    for (const mount of this.entity.equipment()) {
      if (this.arc(mount) !== arc) continue;
      const equipment = mount.equipment;
      if (this.countsAsOffensiveWeapon(mount)) {
        this.offensiveValue += this.weaponBV(mount, false) * factor;
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
    this.defensiveValue += this.entity.structuralIntegrity() * 2 * (this.has('F_BLUE_SHIELD') ? 1.2 : 1);
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
    const arcs = ['Nose', 'FLS', 'ALS', 'Aft', 'ARS', 'FRS', 'LBS', 'RBS'];
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
    const ammo = mount.equipment;
    return ammo instanceof AmmoEquipment
      ? ammo.kgPerShot * (mount.getAmmoShots() ?? ammo.shots) / 1000 * mount.getBV(this.entity)
      : 0;
  }
}

export class InfantryBVCalculator extends BVCalculator {
  declare readonly entity: InfantryEntity;
  protected override processArmor(): void {}
  protected override processStructure(): void {
    const troopers = Math.max(0, this.entity.squadSize() * this.entity.squadCount());
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
    const troopers = Math.max(0, this.entity.squadSize() * this.entity.squadCount());
    const secondary = this.entity.secondaryCount() * this.entity.squadCount();
    const primary = troopers - secondary;
    const primaryBV = this.entity.primaryWeapon()?.bv;
    const secondaryBV = this.entity.secondaryWeapon()?.bv;
    if (typeof primaryBV === 'number') this.offensiveValue += primaryBV * primary;
    if (typeof secondaryBV === 'number') this.offensiveValue += secondaryBV * secondary;
    if (canMakeAntiMekAttacks(this.entity)) {
      const beforeAntiMek = this.offensiveValue;
      if (typeof primaryBV === 'number' && !this.entity.primaryWeapon()?.hasFlag('F_INF_ARCHAIC')) this.offensiveValue += primaryBV * primary;
      if (typeof secondaryBV === 'number' && !this.entity.secondaryWeapon()?.hasFlag('F_INF_ARCHAIC')) this.offensiveValue += secondaryBV * secondary;
      if (hasProstheticAntiMekBonus(this.entity)) {
        this.offensiveValue += (this.offensiveValue - beforeAntiMek) * 0.2;
      }
    }
    if (hasInfantryAugmentation(this.entity, 'gas_effuser_toxin')) this.offensiveValue += troopers * 0.23;
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
  override calculateBaseBV(): number { return this.calculate().base; }
  override calculate() {
    this.prepare();
    let sum = 0;
    const count = Math.max(1, this.entity.trooperCount());
    for (this.currentTrooper = 1; this.currentTrooper <= count; this.currentTrooper++) {
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
    const points = this.entity.armorValues().get('Squad')?.front ?? 0;
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
    if (equipment.some(item => item.hasFlag('F_BAP')
      && !['ISImprovedSensors', 'CLImprovedSensors'].includes(item.id))) systems++;
    const ecm = equipment.find(item => item.hasFlag('F_ECM'));
    if (ecm) systems += ecm.hasFlag('F_ANGEL_ECM') ? 2 : 1;
    this.defensiveValue += systems;

    const troopers = Math.max(1, this.entity.trooperCount());
    for (const mount of this.entity.equipment()) {
      if (mount.equipment instanceof WeaponEquipment && mount.equipment.hasFlag('F_AMS')) {
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
        && mount.equipment.hasAnyFlag(['F_VIBROCLAW', 'F_MAGNET_CLAW']);
      if (mount.location === 'Squad' && !mount.isSSWM && !claw) {
        this.offensiveValue += this.weaponBV(mount, false);
      }
    }

    // Per-trooper and squad-support weapons form a separate Java section.
    for (const mount of mounts) {
      if (!(mount.equipment instanceof WeaponEquipment) || mount.equipment.hasFlag('F_INFANTRY')) continue;
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
        && mount.equipment.hasAnyFlag(['F_VIBROCLAW', 'F_MAGNET_CLAW']);
      const weapon = mount.equipment instanceof WeaponEquipment
        && !mount.equipment.hasAnyFlag(['F_INFANTRY', 'F_MISSILE'])
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
    if (equipment.some(item => item.hasFlag('F_MAGNETIC_CLAMP'))) return true;
    const gloves = equipment.filter(item => item.hasFlag('F_ARMORED_GLOVE')).length;
    const lightEnoughForGloves = this.entity.weightClass() === 'Ultra Light'
      || this.entity.weightClass() === 'Light';
    return (lightEnoughForGloves && gloves >= 2)
      || equipment.some(item => item.hasAnyFlag(['F_BASIC_MANIPULATOR', 'F_BATTLE_CLAW']));
  }

  private hasEquipmentId(id: string): boolean {
    return this.entity.equipment().some(mount => mount.equipment?.id === id);
  }
  protected override ammoCounts(mount: EntityMountedEquipment): boolean {
    return (mount.location === 'Squad' || mount.location === `Trooper ${this.currentTrooper}`) && super.ammoCounts(mount);
  }
  protected override ammoBV(mount: EntityMountedEquipment): number {
    const ammo = mount.equipment;
    return ammo instanceof AmmoEquipment
      ? ammo.kgPerShot * (mount.getAmmoShots() ?? ammo.shots) / 1000 * mount.getBV(this.entity)
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
    return mount.getBV(this.entity) * tonnage;
  }
}
