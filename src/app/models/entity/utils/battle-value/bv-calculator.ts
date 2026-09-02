// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import type { Equipment } from '../../../equipment.model';
import { CORE_2026_GAME_RULES, type CBTGameRules } from '../../../rules/game-rules';
import type { BaseEntity } from '../../base-entity';
import type { EntityStateView } from '../../entity-state-view';
import { BV_MOVEMENT_CALCULATION, type EntityMountedEquipment } from '../../types';
import { getOffensiveSpeedFactor, offensiveSpeedFactor } from '../battle-value';
import { getPpcCapacitorBV } from '../equipment-bv';
import {
  fireControlBattleValueModifier,
} from '../fire-control';
import {
  isDirectFireEquipment,
  isTargetingComputerEquipment,
} from '../targeting-computer';
import { ammoKey, armorBVMultiplier, mekArmorBarFactor, targetMovementModifier } from './rules';
import { isModularArmorEquipment } from '../../../modular-armor.model';
import { isApolloEquipment } from '../../../apollo-mode.model';
import { isRiscLaserPulseModule } from '../../../risc-laser-mode.model';
import { isPpcCapacitorEquipment, isPpcEquipment } from '../../../ppc-capacitor.model';
import { isEcmEquipment } from '../../../ecm-mode.model';
import { isBapEquipment } from '../../../bap-equipment.model';
import { isShieldEquipment } from '../physical-weapon';
import {
  BLUE_SHIELD_BV_BONUS,
  isBlueShieldEquipment,
  isViralJammerEquipment,
} from '../../../escalating-equipment.model';
import {
  DRONE_FIRE_CONTROL_BV_MULTIPLIER,
  DRONE_WEAPON_BV_MULTIPLIER,
  isDroneOperatingSystemEquipment,
} from '../../../drone-operating-system.model';
import { isSpikesEquipment } from '../../../physical-augmentation.model';
import { artemisBattleValueMultiplier } from '../../../artemis-equipment.model';
import {
  isElectricDischargeArmor,
  structureBattleValueMultiplier,
} from '../../../construction-equipment.model';
import { getVibrobladeProfile } from '../../../rules/vibroblade-rules';
import {
  harJelArmorMultiplier,
  isDefensiveBattleValueUtility,
  isOffensiveBattleValueExcludedUtility,
} from '../../../utility-equipment.model';
import { isWatchdogEquipment } from '../../../sensor-equipment.model';
import { isMagnetClawEquipment } from '../../../battle-armor-equipment.model';

export interface BattleValueBreakdown {
  readonly defensive: number;
  readonly offensive: number;
  readonly base: number;
  readonly details: readonly BattleValueDetail[];
}

/** A JSON-safe line in the same hierarchical shape as MegaMek's BV export. */
export interface BattleValueDetail {
  readonly type: string;
  readonly calculation?: string;
  readonly total?: number;
  readonly delta?: number;
  readonly details?: readonly BattleValueDetail[];
}

/**
 * Template-method port of MegaMek BVCalculator. The entity owns the formula;
 * an optional runtime view supplies current damage/status facts.
 */
export class BVCalculator {
  protected defensiveValue = 0;
  protected offensiveValue = 0;
  protected runMP = 0;
  protected jumpMP = 0;
  protected umuMP = 0;
  protected frontDecided = false;
  protected switchRearAndFront = false;
  private report: BattleValueDetail[] = [];
  private reportTarget: 'defensive' | 'offensive' = 'defensive';

  constructor(
    readonly entity: BaseEntity,
    protected readonly state?: EntityStateView,
    protected readonly gameRules: CBTGameRules = CORE_2026_GAME_RULES,
  ) {}

  protected isExplosive(mount: EntityMountedEquipment): boolean {
    const equipment = mount.equipment;
    if (!equipment) return false;
    if (equipment instanceof MiscEquipment && isRiscLaserPulseModule(equipment)) {
      const linkedWeapon = this.entity.getLinkedMount(mount);
      return linkedWeapon !== undefined && this.isWorking(linkedWeapon);
    }
    return this.entity.isMountedEquipmentExplosive(mount);
  }

  calculateBaseBV(): number {
    return this.calculate().base;
  }

  calculate(): BattleValueBreakdown {
    if (this.state?.destroyed) {
      return {
        defensive: 0,
        offensive: 0,
        base: 0,
        details: [{ type: 'Battle Value', calculation: 'Destroyed', total: 0, delta: 0 }],
      };
    }
    this.prepare();
    this.addReportLine('Effective MP', `R: ${this.runMP}, J: ${this.jumpMP}, U: ${this.umuMP}`);
    this.reportTarget = 'defensive';
    const defensiveDetails = this.captureDetails(() => this.processDefensiveValue());
    this.report.push({ type: 'Defensive Battle Rating', details: defensiveDetails });
    this.reportTarget = 'offensive';
    const offensiveDetails = this.captureDetails(() => this.processOffensiveValue());
    this.report.push({ type: 'Offensive Battle Rating', details: offensiveDetails });
    const unrounded = this.summarize(this.defensiveValue + this.offensiveValue);
    const base = Math.round(unrounded);
    this.report.push({
      type: 'Battle Value',
      details: [{
        type: 'Base Unit BV',
        calculation: `${this.format(this.defensiveValue)} + ${this.format(this.offensiveValue)}, rn`,
        total: base,
        delta: base,
      }],
    });
    return { defensive: this.defensiveValue, offensive: this.offensiveValue, base, details: this.report };
  }

  protected prepare(): void {
    this.defensiveValue = 0;
    this.offensiveValue = 0;
    this.frontDecided = false;
    this.switchRearAndFront = false;
    this.report = [];
    this.runMP = this.state?.movement.run ?? this.entity.maxRunMP();
    this.jumpMP = this.state?.movement.jump ?? this.entity.computeJumpMP(BV_MOVEMENT_CALCULATION);
    this.umuMP = this.state?.movement.umu ?? this.entity.umuMP();
  }

  protected processDefensiveValue(): void {
    this.processArmor();
    this.processStructure();
    this.processDefensiveEquipment();
    this.processExplosiveEquipment();
    this.processTypeModifier();
    this.processDefensiveFactor();
  }

  protected processOffensiveValue(): void {
    this.determineFront();
    this.processWeapons();
    this.processAmmo();
    this.processOffensiveEquipment();
    this.processWeight();
    this.processSpeedFactor();
    this.processOffensiveTypeModifier();
  }

  protected processArmor(): void {
    const before = this.defensiveValue;
    let armorBV = 0;
    for (const [location, maximum] of this.entity.armorValues()) {
      const value = this.state ? {
        front: this.state.armorRemaining(location, 'front'),
        rear: this.state.armorRemaining(location, 'rear'),
      } : maximum;
      const armor = this.entity.armorByLocation().get(location)?.armor;
      const bar = this.entity.isSupportVehicle()
        ? this.entity.barRating() / 10
        : this.entity.entityType === 'Mek' ? mekArmorBarFactor(armor?.armorType) : 1;
      const modularArmor = this.entity.equipment()
        .filter(mount => mount.location === location && mount.equipment instanceof MiscEquipment
          && isModularArmorEquipment(mount.equipment) && this.isWorking(mount))
        .reduce((sum, mount) => sum + (mount.equipment as MiscEquipment).baseDamageCapacity, 0);
      const mountsAtLocation = this.entity.equipment()
        .filter(mount => mount.getOccupiedLocations().includes(location) && this.isWorking(mount));
      const harjelMultiplier = harJelArmorMultiplier(
        mountsAtLocation.map(mount => mount.equipment),
      );
      const supplementalArmor = this.supplementalArmorAt(location, value);
      armorBV += Math.max(0, value.front + value.rear + modularArmor + supplementalArmor)
        * (armorBVMultiplier(armor) + (this.hasEquipment(isBlueShieldEquipment) ? BLUE_SHIELD_BV_BONUS : 0))
        * bar * harjelMultiplier;
    }
    this.defensiveValue += armorBV * this.armorFactor();
    this.addValueLine('Armor', `${this.format(armorBV)} x ${this.format(this.armorFactor())}`, before);
  }

  protected supplementalArmorAt(
    _location: string,
    _armor: Readonly<{ front: number; rear: number }>,
  ): number { return 0; }

  protected armorFactor(): number { return 2.5; }

  protected processStructure(): void {
    const before = this.defensiveValue;
    let multiplier = 1;
    const structures = [...this.entity.structureByLocation().values()];
    if (structures.length > 0) {
      const structureMultipliers = structures.map(s => structureBattleValueMultiplier(s.structure));
      if (structureMultipliers.every(value => value === 0.5)) multiplier = 0.5;
      else if (structureMultipliers.every(value => value === 2)) multiplier = 2;
    }
    if (this.hasEquipment(isBlueShieldEquipment)) multiplier += BLUE_SHIELD_BV_BONUS;
    const internal = this.currentInternalPoints();
    this.defensiveValue += internal * 1.5 * multiplier;
    const modifier = multiplier === 1 ? '' : ` x ${this.format(multiplier)}`;
    this.addValueLine('Internal Structure', `+ ${internal} x 1.5${modifier}`, before);
  }

  protected processDefensiveEquipment(): void {
    const before = this.defensiveValue;
    const details = this.captureDetails(() => this.processDefensiveEquipmentItems());
    if (details.length > 0) this.addValueLine('Defensive Equipment', undefined, before, details);
  }

  private processDefensiveEquipmentItems(): void {
    let amsWeapons = 0;
    let amsAmmo = 0;
    let screenWeapons = 0;
    let screenAmmo = 0;
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      if (!equipment || !this.notDestroyed(mount)) continue;
      if (equipment instanceof AmmoEquipment) {
        const value = this.ammoBV(mount);
        if (equipment.ammoType === 'AMS' || equipment.ammoType === 'APDS') amsAmmo += value;
        if (equipment.ammoType === 'SCREEN_LAUNCHER') screenAmmo += value;
        continue;
      }
      if (!this.countsAsDefensiveEquipment(mount)) continue;
      const value = mount.getBV(this.entity);
      const before = this.defensiveValue;
      this.defensiveValue += value;
      this.addValueLine(this.equipmentDescriptor(mount), `${value >= 0 ? '+' : '-'} ${this.format(Math.abs(value))}`, before);
      if (equipment instanceof WeaponEquipment && equipment.hasFlag('F_AMS')
        && ['AMS', 'APDS'].includes(equipment.ammoType)) amsWeapons += value;
      if (equipment instanceof WeaponEquipment && equipment.ammoType === 'SCREEN_LAUNCHER') screenWeapons += value;
    }
    const ams = Math.min(amsWeapons, amsAmmo);
    if (ams > 0) {
      const before = this.defensiveValue;
      this.defensiveValue += ams;
      this.addValueLine('AMS Ammo', `+ ${this.format(ams)}`, before);
    }
    const screen = Math.min(screenWeapons, screenAmmo);
    if (screen > 0) {
      const before = this.defensiveValue;
      this.defensiveValue += screen;
      this.addValueLine('Screen Launcher Ammo', `+ ${this.format(screen)}`, before);
    }
  }

  protected countsAsDefensiveEquipment(mount: EntityMountedEquipment): boolean {
    if (!this.notDestroyed(mount)) return false;
    const equipment = mount.equipment;
    if (equipment instanceof WeaponEquipment) {
      return equipment.hasFlag('F_AMS')
        || equipment.hasFlag('F_M_POD')
        || equipment.hasFlag('F_B_POD')
        || equipment.ammoType === 'SCREEN_LAUNCHER';
    }
    return equipment instanceof MiscEquipment && (isShieldEquipment(equipment)
      || isEcmEquipment(equipment) || isBapEquipment(equipment)
      || isViralJammerEquipment(equipment) || isSpikesEquipment(equipment)
      || isDefensiveBattleValueUtility(equipment));
  }

  protected processTypeModifier(): void {}
  protected processExplosiveEquipment(): void {}

  protected processDefensiveFactor(): void {
    const running = this.runningTmm();
    const jumping = targetMovementModifier(this.jumpMP, true);
    const umu = targetMovementModifier(this.umuMP);
    this.addReportLine('TMMs', `${running} (R), ${jumping} (J), ${umu} (U)`);
    const factor = this.tmmFactor(running, jumping, umu);
    const before = this.defensiveValue;
    this.defensiveValue *= factor;
    this.addValueLine('Defensive Factor', `${this.format(before)} x ${this.format(factor)}`, before);
  }

  protected runningTmm(): number { return targetMovementModifier(this.runMP); }

  protected tmmFactor(running: number, jumping: number, umu: number): number {
    return 1 + Math.max(running, jumping, umu) / 10;
  }

  protected determineFront(): void {
    const front = this.weaponSectionBV(m => this.frontWeapon(m));
    const rear = this.weaponSectionBV(m => this.rearWeapon(m));
    this.switchRearAndFront = front < rear;
    if (this.switchRearAndFront) this.addReportLine('Front BV < Rear BV', 'Switching Front and Rear');
    this.frontDecided = true;
  }

  protected frontWeapon(_mount: EntityMountedEquipment): boolean { return true; }
  protected rearWeapon(_mount: EntityMountedEquipment): boolean { return false; }

  protected isNominalRear(mount: EntityMountedEquipment): boolean {
    return this.switchRearAndFront !== this.rearWeapon(mount);
  }

  protected weaponSectionBV(predicate: (mount: EntityMountedEquipment) => boolean): number {
    return this.entity.equipment().filter(m => this.countsAsOffensiveWeapon(m) && predicate(m))
      .reduce((sum, mount) => sum + this.weaponBV(mount, false), 0);
  }

  protected processWeapons(): void {
    const before = this.offensiveValue;
    const details = this.captureDetails(() => {
    for (const mount of this.entity.equipment()) {
      if (!this.countsAsOffensiveWeapon(mount)) continue;
      const itemBefore = this.offensiveValue;
      const value = this.weaponBV(mount, true);
      this.offensiveValue += value;
      this.addValueLine(this.equipmentDescriptor(mount), `+ ${this.format(value)}`, itemBefore);
    }
    });
    this.addValueLine('Weapons', undefined, before, details);
  }

  protected countsAsOffensiveWeapon(mount: EntityMountedEquipment): boolean {
    if (!this.isWorking(mount)) return false;
    const equipment = mount.equipment;
    if (equipment instanceof WeaponEquipment) {
      return !equipment.hasFlag('F_AMS')
        && !equipment.hasFlag('F_B_POD')
        && !equipment.hasFlag('F_M_POD')
        && equipment.ammoType !== 'SCREEN_LAUNCHER'
        && (mount.getBV(this.entity) > 0 || equipment.hasFlag('F_MGA'));
    }
    return equipment instanceof MiscEquipment
      && (equipment.hasFlag('F_VIBROCLAW') || isMagnetClawEquipment(equipment)
        || getVibrobladeProfile(equipment) !== null)
      && mount.getBV(this.entity) > 0;
  }

  protected weaponBV(
    mount: EntityMountedEquipment,
    applyRear: boolean,
    weaponCount = 1,
    weaponFactor = 1,
  ): number {
    const equipment = mount.equipment;
    if (!equipment) return 0;
    let value = mount.getBV(this.entity);
    if (equipment.hasFlag('F_MGA')) {
      const bay = this.entity.equipmentBays()
        .find(candidate => candidate.kind === 'machine-gun-array' && candidate.controller === mount);
      if (bay) value = bay.mounts.reduce((sum, member) => sum + member.getBV(this.entity), 0) * 0.67;
    }
    value *= weaponCount;
    value *= this.weaponMountModifier(mount) * weaponFactor;
    if (applyRear && this.frontDecided && this.isNominalRear(mount)) value *= 0.5;
    if (this.hasEquipment(isDroneOperatingSystemEquipment)) value *= DRONE_WEAPON_BV_MULTIPLIER;
    if (equipment instanceof WeaponEquipment) {
      const linkedBy = this.entity.getLinkingMount(mount);
      if (linkedBy?.equipment instanceof MiscEquipment && this.isWorking(linkedBy)) {
        const system = linkedBy.equipment;
        if (isPpcEquipment(equipment) && isPpcCapacitorEquipment(system)) {
          value += getPpcCapacitorBV(mount);
        }
        const artemisMultiplier = artemisBattleValueMultiplier(system);
        if (artemisMultiplier !== 1) value *= artemisMultiplier;
        else if (isRiscLaserPulseModule(system) || isApolloEquipment(system)) value *= 1.15;
      }
      if (isDirectFireEquipment(equipment) && this.hasEquipment(isTargetingComputerEquipment)) value *= 1.25;
      else if (!equipment.hasFlag('F_INFANTRY')) value *= this.fireControlModifier();
    }
    return value;
  }

  protected weaponMountModifier(_mount: EntityMountedEquipment): number { return 1; }

  protected processAmmo(): void {
    const before = this.offensiveValue;
    const details = this.captureDetails(() => {
    const weaponBV = new Map<string, number>();
    const ammoBV = new Map<string, number>();
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      if (equipment instanceof WeaponEquipment && this.isWorking(mount) && this.weaponUsesAmmo(equipment)) {
        const key = ammoKey(equipment.ammoType, equipment.rackSize);
        weaponBV.set(key, (weaponBV.get(key) ?? 0) + mount.getBV(this.entity));
      } else if (equipment instanceof AmmoEquipment && this.ammoCounts(mount)) {
        const key = ammoKey(equipment.ammoType, equipment.rackSize);
        ammoBV.set(key, (ammoBV.get(key) ?? 0) + this.ammoBV(mount));
      }
    }
    for (const [key, ammo] of ammoBV) {
      const weapons = weaponBV.get(key);
      const value = weapons !== undefined ? Math.min(ammo, weapons) * this.fireControlModifier()
        : key === ammoKey('COOLANT_POD', 1) ? ammo : 0;
      if (value > 0) {
        const itemBefore = this.offensiveValue;
        this.offensiveValue += value;
        this.addValueLine(`${key} Ammo`, `+ ${this.format(value)}`, itemBefore);
      }
    }
    });
    if (details.length > 0) this.addValueLine('Ammo', undefined, before, details);
  }

  protected weaponUsesAmmo(weapon: WeaponEquipment): boolean {
    return weapon.ammoType !== 'NA'
      && !weapon.hasFlag('F_ONE_SHOT')
      && !weapon.hasFlag('F_INFANTRY')
      && !(weapon.hasFlag('F_ENERGY')
        && !['PLASMA', 'VEHICLE_FLAMER', 'HEAVY_FLAMER', 'CHEMICAL_LASER'].includes(weapon.ammoType));
  }

  protected ammoCounts(mount: EntityMountedEquipment): boolean {
    const ammo = mount.equipment;
    return ammo instanceof AmmoEquipment && this.isWorking(mount) && this.ammoShots(mount) > 0
      && !['AMS', 'APDS', 'SCREEN_LAUNCHER'].includes(ammo.ammoType);
  }

  protected ammoBV(mount: EntityMountedEquipment): number {
    const ammo = this.ammoEquipment(mount);
    if (!(ammo instanceof AmmoEquipment) || !this.isWorking(mount)) return 0;
    const shots = this.ammoShots(mount);
    if (shots <= 0) return 0;
    const binShots = this.gameRules.getAmmoShots(ammo, this.entity.getEquipmentRegistry());
    const ratio = binShots > 0 ? Math.max(1, Math.trunc(shots / binShots)) : 1;
    const bv = this.gameRules.getAmmoBV(ammo, this.entity.getEquipmentRegistry());
    return (typeof bv === 'number' ? bv : 0) * ratio;
  }

  protected processOffensiveEquipment(): void {
    const before = this.offensiveValue;
    const details = this.captureDetails(() => {
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      const isOffensiveArmor = equipment instanceof ArmorEquipment
        && isElectricDischargeArmor(equipment);
      if (!this.notDestroyed(mount)
        || !(equipment instanceof MiscEquipment || isOffensiveArmor)
        || isOffensiveBattleValueExcludedUtility(equipment)
        || (equipment instanceof MiscEquipment && isShieldEquipment(equipment))
        || isBapEquipment(equipment)
        || isViralJammerEquipment(equipment)
        || isSpikesEquipment(equipment)
        || isTargetingComputerEquipment(equipment)
        || (isEcmEquipment(equipment) && !isWatchdogEquipment(equipment))
        || this.countsAsOffensiveWeapon(mount)) continue;
      let value = mount.getBV(this.entity);
      if (isWatchdogEquipment(equipment)) value = 7;
      value *= this.offensiveEquipmentModifier(mount);
      const itemBefore = this.offensiveValue;
      this.offensiveValue += value;
      this.addValueLine(this.equipmentDescriptor(mount), `+ ${this.format(value)}`, itemBefore);
    }
    });
    if (details.length > 0) this.addValueLine('Offensive Equipment', undefined, before, details);
  }

  protected offensiveEquipmentModifier(_mount: EntityMountedEquipment): number { return 1; }

  protected fireControlModifier(): number {
    if (!this.entity.isSupportVehicle()) return 1;
    return fireControlBattleValueModifier(this.entity.equipment()
      .filter(mount => this.isWorking(mount))
      .map(mount => mount.equipment));
  }

  protected processWeight(): void {}
  protected processOffensiveTypeModifier(): void {}

  protected summarize(value: number): number {
    return value * (this.hasEquipment(isDroneOperatingSystemEquipment) ? DRONE_FIRE_CONTROL_BV_MULTIPLIER : 1);
  }

  protected hasEquipment(predicate: (equipment: Equipment) => boolean): boolean {
    return this.entity.equipment().some(mount => {
      const equipment = mount.equipment;
      return equipment !== undefined && this.isWorking(mount) && predicate(equipment);
    });
  }

  protected processSpeedFactor(): void {
    const before = this.offensiveValue;
    const factor = this.state
      ? offensiveSpeedFactor(this.currentOffensiveSpeedFactorMP())
      : getOffensiveSpeedFactor(this.entity);
    this.offensiveValue *= factor;
    this.addValueLine('Speed Factor', `${this.format(before)} x ${this.format(factor)}`, before);
  }

  protected addReportLine(type: string, calculation?: string): void {
    this.report.push({ type, ...(calculation === undefined ? {} : { calculation }) });
  }

  protected addValueLine(
    type: string,
    calculation: string | undefined,
    before: number,
    details?: readonly BattleValueDetail[],
  ): void {
    const total = this.currentValue();
    this.report.push({
      type,
      ...(calculation === undefined ? {} : { calculation }),
      total: this.roundReport(total),
      delta: this.roundReport(total - before),
      ...(details && details.length > 0 ? { details } : {}),
    });
  }

  protected captureDetails(action: () => void): BattleValueDetail[] {
    const parent = this.report;
    const details: BattleValueDetail[] = [];
    this.report = details;
    try { action(); } finally { this.report = parent; }
    return details;
  }

  protected format(value: number): string {
    return this.roundReport(value).toString();
  }

  protected equipmentDescriptor(mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    if (!equipment) return mount.equipmentId;
    if (equipment instanceof AmmoEquipment) return `${equipment.shortName}${equipment.shortName.includes('Ammo') ? '' : ' Ammo'}`;
    if (equipment instanceof WeaponEquipment) {
      return `${equipment.shortName}${mount.location === 'Unallocated' ? '' : ` (${mount.location})`}`;
    }
    return equipment.shortName;
  }

  protected isWorking(mount: EntityMountedEquipment): boolean {
    return this.state?.equipmentStatus(mount.mountId) !== 'disabled'
      && this.state?.equipmentStatus(mount.mountId) !== 'destroyed';
  }

  protected notDestroyed(mount: EntityMountedEquipment): boolean {
    return this.state?.equipmentStatus(mount.mountId) !== 'destroyed';
  }

  protected ammoShots(mount: EntityMountedEquipment): number {
    if (this.state) return this.state.ammoRemaining(mount.mountId);
    const ammo = mount.equipment;
    if (!(ammo instanceof AmmoEquipment)) return 0;
    return mount.shotsCount
      ?? this.gameRules.getAmmoShots(ammo, this.entity.getEquipmentRegistry());
  }

  protected ammoEquipment(mount: EntityMountedEquipment): AmmoEquipment | null {
    if (this.state) return this.state.ammoEquipment(mount.mountId);
    return mount.equipment instanceof AmmoEquipment ? mount.equipment : null;
  }

  protected ammoKgPerShot(ammo: AmmoEquipment): number {
    return this.gameRules.getAmmoKgPerShot(ammo, this.entity.getEquipmentRegistry());
  }

  protected currentInternalPoints(): number {
    if (!this.state) return this.entity.totalInternalPoints();
    return this.entity.damageLocations()
      .reduce((sum, location) => sum + this.state!.structureRemaining(location.code), 0);
  }

  /** Family calculators may override special current-movement formulas. */
  protected currentOffensiveSpeedFactorMP(): number {
    return this.runMP + Math.round(Math.max(this.jumpMP, this.umuMP) / 2);
  }

  private currentValue(): number {
    return this.reportTarget === 'defensive' ? this.defensiveValue : this.offensiveValue;
  }

  private roundReport(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

}
