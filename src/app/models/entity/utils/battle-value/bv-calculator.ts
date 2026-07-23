import { AmmoEquipment, ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';
import { BV_MOVEMENT_CALCULATION, type EntityMountedEquipment } from '../../types';
import { getOffensiveSpeedFactor } from '../battle-value';
import { getPpcCapacitorBV } from '../equipment-bv';
import { ammoKey, armorBVMultiplier, targetMovementModifier } from './rules';

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
 * Template-method port of MegaMek BVCalculator for pristine canonical entities.
 * Runtime-only state (damage, modes, game/C3/TAG, crew implants and bombs) is
 * intentionally absent rather than inferred from construction data.
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

  constructor(readonly entity: BaseEntity) {}

  calculateBaseBV(): number {
    return this.calculate().base;
  }

  calculate(): BattleValueBreakdown {
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
    this.runMP = this.entity.maxRunMP();
    this.jumpMP = this.entity.computeJumpMP(BV_MOVEMENT_CALCULATION);
    this.umuMP = this.entity.umuMP();
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
    for (const [location, value] of this.entity.armorValues()) {
      const armor = this.entity.armorByLocation().get(location)?.armor;
      const bar = this.entity.isSupportVehicle() ? this.entity.barRating() / 10 : 1;
      const modularArmor = this.entity.equipment()
        .filter(mount => mount.location === location && mount.equipment instanceof MiscEquipment
          && mount.equipment.hasFlag('F_MODULAR_ARMOR'))
        .reduce((sum, mount) => sum + (mount.equipment as MiscEquipment).baseDamageCapacity, 0);
      armorBV += Math.max(0, value.front + value.rear + modularArmor) * armorBVMultiplier(armor) * bar;
    }
    this.defensiveValue += armorBV * this.armorFactor();
    this.addValueLine('Armor', `${this.format(armorBV)} x ${this.format(this.armorFactor())}`, before);
  }

  protected armorFactor(): number { return 2.5; }

  protected processStructure(): void {
    const before = this.defensiveValue;
    let multiplier = 1;
    const structures = [...this.entity.structureByLocation().values()];
    if (structures.length > 0 && structures.every(s => s.structure.hasAnyFlag([
      'F_INDUSTRIAL_STRUCTURE', 'F_COMPOSITE', 'F_COMPOSITE_STRUCTURE',
    ]))) multiplier = 0.5;
    else if (structures.length > 0 && structures.every(s => s.structure.hasFlag('F_REINFORCED_STRUCTURE'))) multiplier = 2;
    if (this.has('F_BLUE_SHIELD')) multiplier += 0.2;
    this.defensiveValue += this.entity.totalInternalPoints() * 1.5 * multiplier;
    const modifier = multiplier === 1 ? '' : ` x ${this.format(multiplier)}`;
    this.addValueLine('Internal Structure', `+ ${this.entity.totalInternalPoints()} x 1.5${modifier}`, before);
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
      if (!equipment) continue;
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
    const equipment = mount.equipment;
    if (equipment instanceof WeaponEquipment) {
      return equipment.hasAnyFlag(['F_AMS', 'F_M_POD', 'F_B_POD']) || equipment.ammoType === 'SCREEN_LAUNCHER';
    }
    return equipment instanceof MiscEquipment && equipment.hasAnyFlag([
      'F_ECM', 'F_BAP', 'F_VIRAL_JAMMER_DECOY', 'F_VIRAL_JAMMER_HOMING', 'F_AP_POD',
      'F_MASS', 'F_HEAVY_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_LIGHT_BRIDGE_LAYER',
      'F_BULLDOZER', 'F_CHAFF_POD', 'F_SPIKES',
      'F_HARJEL_II', 'F_HARJEL_III', 'F_MINESWEEPER', 'F_SHIELD',
    ]);
  }

  protected processTypeModifier(): void {}
  protected processExplosiveEquipment(): void {}

  protected processDefensiveFactor(): void {
    const running = targetMovementModifier(this.runMP);
    const jumping = targetMovementModifier(this.jumpMP, true);
    const umu = targetMovementModifier(this.umuMP);
    this.addReportLine('TMMs', `${running} (R), ${jumping} (J), ${umu} (U)`);
    const factor = this.tmmFactor(running, jumping, umu);
    const before = this.defensiveValue;
    this.defensiveValue *= factor;
    this.addValueLine('Defensive Factor', `${this.format(before)} x ${this.format(factor)}`, before);
  }

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
    const equipment = mount.equipment;
    if (equipment instanceof WeaponEquipment) {
      return !equipment.hasAnyFlag(['F_AMS', 'F_B_POD', 'F_M_POD'])
        && equipment.ammoType !== 'SCREEN_LAUNCHER'
        && (mount.getBV(this.entity) > 0 || equipment.hasFlag('F_MGA'));
    }
    return equipment instanceof MiscEquipment
      && equipment.hasAnyFlag(['F_VIBROCLAW', 'F_MAGNET_CLAW', 'S_VIBRO_SMALL', 'S_VIBRO_MEDIUM', 'S_VIBRO_LARGE'])
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
    if (this.has('F_DRONE_OPERATING_SYSTEM')) value *= 0.8;
    if (equipment instanceof WeaponEquipment) {
      const linkedBy = this.entity.getLinkingMount(mount);
      if (linkedBy?.equipment instanceof MiscEquipment) {
        const system = linkedBy.equipment;
        if (equipment.hasFlag('F_PPC') && system.hasFlag('F_PPC_CAPACITOR')) {
          value += getPpcCapacitorBV(mount);
        }
        if (system.hasFlag('F_ARTEMIS')) value *= 1.2;
        else if (system.hasFlag('F_ARTEMIS_PROTO')) value *= 1.1;
        else if (system.hasFlag('F_ARTEMIS_V')) value *= 1.3;
        else if (system.hasAnyFlag(['F_RISC_LASER_PULSE_MODULE', 'F_APOLLO'])) value *= 1.15;
      }
      if (equipment.hasFlag('F_DIRECT_FIRE') && this.has('F_TARGETING_COMPUTER')) value *= 1.25;
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
      if (equipment instanceof WeaponEquipment && this.weaponUsesAmmo(equipment)) {
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
    return weapon.ammoType !== 'NA' && !weapon.hasAnyFlag(['F_ONE_SHOT', 'F_INFANTRY'])
      && !(weapon.hasFlag('F_ENERGY') && !['PLASMA', 'VEHICLE_FLAMER', 'HEAVY_FLAMER', 'CHEMICAL_LASER'].includes(weapon.ammoType));
  }

  protected ammoCounts(mount: EntityMountedEquipment): boolean {
    const ammo = mount.equipment;
    return ammo instanceof AmmoEquipment && (mount.getAmmoShots() ?? 0) > 0
      && !['AMS', 'APDS', 'SCREEN_LAUNCHER'].includes(ammo.ammoType);
  }

  protected ammoBV(mount: EntityMountedEquipment): number {
    const ammo = mount.equipment;
    if (!(ammo instanceof AmmoEquipment)) return 0;
    const shots = mount.getAmmoShots() ?? ammo.shots;
    const ratio = ammo.shots > 0 ? Math.max(1, Math.trunc(shots / ammo.shots)) : 1;
    return mount.getBV(this.entity) * ratio;
  }

  protected processOffensiveEquipment(): void {
    const before = this.offensiveValue;
    const details = this.captureDetails(() => {
    const excluded = [
      'F_AP_POD', 'F_VIRAL_JAMMER_DECOY', 'F_VIRAL_JAMMER_HOMING',
      'F_LIGHT_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_HEAVY_BRIDGE_LAYER',
      'F_CHAFF_POD', 'F_BULLDOZER', 'F_BAP', 'F_TARGETING_COMPUTER', 'F_SPIKES',
      'F_MINESWEEPER', 'F_MINE', 'F_HARJEL_II', 'F_HARJEL_III', 'F_MASS', 'F_SHIELD',
    ];
    for (const mount of this.entity.equipment()) {
      const equipment = mount.equipment;
      // Java ArmorType extends MiscType, so EDP armor participates here even
      // though MekBay models armor and miscellaneous equipment as siblings.
      const isOffensiveArmor = equipment instanceof ArmorEquipment
        && equipment.hasFlag('F_ELECTRIC_DISCHARGE_ARMOR');
      if (!(equipment instanceof MiscEquipment || isOffensiveArmor) || equipment.hasAnyFlag(excluded)
        || (equipment.hasFlag('F_ECM') && !equipment.hasFlag('F_WATCHDOG'))
        || this.countsAsOffensiveWeapon(mount)) continue;
      let value = mount.getBV(this.entity);
      if (equipment.hasFlag('F_WATCHDOG')) value = 7;
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
    if (this.has('F_BASIC_FIRE_CONTROL')) return 0.9;
    return this.has('F_ADVANCED_FIRE_CONTROL') ? 1 : 0.8;
  }

  protected processWeight(): void {}
  protected processOffensiveTypeModifier(): void {}

  protected summarize(value: number): number {
    return value * (this.has('F_DRONE_OPERATING_SYSTEM') ? 0.95 : 1);
  }

  protected has(flag: string): boolean {
    return this.entity.equipment().some(mount => mount.equipment?.hasFlag(flag));
  }

  protected processSpeedFactor(): void {
    const before = this.offensiveValue;
    const factor = getOffensiveSpeedFactor(this.entity);
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

  private currentValue(): number {
    return this.reportTarget === 'defensive' ? this.defensiveValue : this.offensiveValue;
  }

  private roundReport(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

}
