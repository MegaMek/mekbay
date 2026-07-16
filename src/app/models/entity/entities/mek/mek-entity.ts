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

import { Signal, computed, signal } from '@angular/core';
import { MiscEquipment } from '../../../equipment.model';
import {
  BaseEntity,
  COLLECT_ALL_MIXED_TECH_REASONS,
  MixedTechResult,
  MovementCalculationOptions,
} from '../../base-entity';
import {
  buildCTSystemLayout,
  buildHeadSystemLayout,
  buildSideTorsoSystemLayout,
  type GyroType,
  type GyroTypeDescriptor,
  GYRO_DATA,
  type CockpitTypeDescriptor,
  COCKPIT_DATA,
  MountedEngine,
} from '../../components';
import {
  CockpitType,
  CriticalSlotView,
  EngineFlag,
  EntityTechBase,
  EntityMountedEquipment,
  EntityType,
  EntityValidationMessage,
  getMekLegLocations,
  getMekHeatSinkType,
  HeatSinkType,
  IntegralHeatSinkCapability,
  IntrinsicWeapon,
  isMekLegLocation,
  isTechAvailableForBase,
  MEK_INTERNAL_STRUCTURE,
  MEK_REAR_ARMOR_LOCATIONS,
  MEK_SLOTS_PER_LOCATION,
  MekConfig,
  MekLocation,
  MekSystemType,
} from '../../types';
import { generateMountId } from '../../utils/signal-helpers';

// ============================================================================
// MekEntity - abstract base for all Mek-type entities
// ============================================================================

export interface FrankenMekLocationData {
  tonnage: number;
  structureName?: string;
  donor?: string;
  donorType?: string;
}

export abstract class MekEntity extends BaseEntity {
  override readonly entityType: EntityType = 'Mek';

  override locationIsLeg(location: string): boolean {
    return isMekLegLocation(this.chassisConfig, location);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS - user / parser inputs
  // ═══════════════════════════════════════════════════════════════════════════

  gyroType = signal<GyroType>('Standard');
  mountedGyro = computed<GyroTypeDescriptor>(() => GYRO_DATA[this.gyroType()] ?? GYRO_DATA['Standard']);
  cockpitType = signal<CockpitType>('Standard');
  mountedCockpit = computed<CockpitTypeDescriptor>(() =>  COCKPIT_DATA[this.cockpitType()] ?? COCKPIT_DATA['Standard']);
  myomerType = signal<string>('Standard');
  structureTechBase = signal<EntityTechBase | null>(null);
  hybridStructure = signal(false);
  ejectionType = signal<string>('');
  heatSinkKit = signal<string>('');
  isFrankenMek = signal<boolean>(false);
  frankenMekLocations = signal<Map<MekLocation, FrankenMekLocationData>>(new Map());

  /**
   * Set of armored system slot keys: "LOC:INDEX" (e.g. "HD:0", "CT:3").
   * Parsed from MTF/BLK `(ARMORED)` suffix on system crit slots.
   * Equipment armored flags are stored on the mount itself, but system
   * components (Life Support, Sensors, Cockpit, Gyro, Engine, etc.) use
   * this set because they are not part of the equipment list.
   */
  armoredSystemSlots = signal<Set<string>>(new Set());

  /**
   * Locations where Clan CASE has been explicitly opted out.
   * Stores canonical location IDs (e.g. "LA", "RT").
   * When auto-adding Clan CASE to explosive locations, opted-out locations are skipped.
   */
  clanCaseOptOutLocations = signal<Set<string>>(new Set());

  /** Equipment definition selected for this Mek's heat-sink technology. */
  heatSinkEquipment = signal<MiscEquipment | null>(null);
  /** Heat-sink technology derived from the selected equipment definition. */
  heatSinkType = computed<HeatSinkType>(() => getMekHeatSinkType(this.heatSinkEquipment()));
  /** Total installed heat sinks, including engine-integrated mounts. */
  totalHeatSinks = computed<number>(() => this.heatSinkCount());

  // NOTE: No `criticalSlots` signal!  The crit grid is DERIVED - see
  // `criticalSlotGrid` computed below.  Equipment `placements` on each
  // mount are the single source of truth for slot assignments.

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPUTED - derived from signals
  // ═══════════════════════════════════════════════════════════════════════════

  isSuperHeavy = computed(() => this.tonnage() > 100);

  /**
   * Whether this Mek has an Industrial structure type.
   */
  isIndustrial = computed(
    () => this.mountedStructure()?.hasFlag('F_INDUSTRIAL_STRUCTURE')
  );

  heatSinkCount = computed(() =>
    this.equipment().reduce((sum, mount) =>
      sum + (mount.equipment instanceof MiscEquipment ? mount.equipment.heatSinkUnitsPerMount : 0), 0)
  );

  integralHeatSinks = computed<IntegralHeatSinkCapability | null>(() => {
    const integrated = this.equipment().filter(mount =>
      mount.allocation.kind === 'engine'
      && mount.equipment instanceof MiscEquipment
      && mount.equipment.isHeatSink);
    const count = integrated.reduce(
      (total, mount) => total + (mount.equipment as MiscEquipment).heatSinkUnitsPerMount,
      0,
    );
    if (count <= 0) return null;

    const equipment = this.heatSinkEquipment();
    if (equipment?.hasFlag('F_IS_DOUBLE_HEAT_SINK_PROTOTYPE')) return null;
    return equipment ? { count, equipment } : null;
  });

  /** Replace the Mek engine and rebalance its engine-allocated heat-sink mounts. */
  configureEngine(engine: MountedEngine): void {
    const equipment = this.heatSinkEquipment();
    const totalCount = this.heatSinkCount();

    this.mountedEngine.set(engine);
    if (equipment) {
      this.rebalanceHeatSinkMounts(equipment, totalCount);
    }
  }

  /**
   * Change the installed heat-sink technology and total count atomically.
   * Existing Omni base-chassis integration is preserved; a new configuration
   * integrates as many sinks as the engine permits.
   */
  configureHeatSinks(equipment: MiscEquipment, totalCount: number): void {
    this.validateHeatSinkConfiguration(equipment, totalCount);
    if (this.omni() && this.mountedEngine().getBaseChassisHeatSinks(false) < 0) {
      this.mountedEngine().setBaseChassisHeatSinks(totalCount);
    }

    this.heatSinkEquipment.set(equipment);
    this.rebalanceHeatSinkMounts(equipment, totalCount);
  }

  initializeParsedHeatSinkMounts(totalCount: number, baseChassisCount?: number): void {
    const equipment = this.heatSinkEquipment();
    if (!equipment) return;
    this.validateHeatSinkConfiguration(equipment, totalCount);
    if (this.omni() && baseChassisCount !== undefined) {
      this.mountedEngine().setBaseChassisHeatSinks(baseChassisCount >= 10 ? baseChassisCount : totalCount);
    }
    this.rebalanceHeatSinkMounts(equipment, totalCount, true);
  }

  private validateHeatSinkConfiguration(equipment: MiscEquipment, totalCount: number): void {
    if (!equipment.isHeatSink) throw new Error(`Equipment "${equipment.id}" is not a heat sink`);
    if (equipment.isCompactHeatSink && equipment.heatSinkUnitsPerMount !== 1) {
      throw new Error('Compact heat-sink configuration must use the single-unit equipment definition');
    }
    if (!Number.isInteger(totalCount) || totalCount < 0) {
      throw new Error(`Heat sink count must be a non-negative integer, got ${totalCount}`);
    }
  }

  private rebalanceHeatSinkMounts(
    equipment: MiscEquipment,
    totalCount: number,
    preserveExternal = false,
  ): void {
    const current = this.equipment();
    const nonHeatSinks = current.filter(mount =>
      !(mount.equipment instanceof MiscEquipment) || !mount.equipment.isHeatSink);
    const externalCandidates = current.filter(mount =>
      mount.allocation.kind !== 'engine'
      && mount.equipment instanceof MiscEquipment
      && mount.equipment.isHeatSink
      && (preserveExternal
        || (equipment.isCompactHeatSink
        ? mount.equipment.isCompactHeatSink
        : mount.equipment.id === equipment.id)));
    const capacity = this.integralHeatSinkCapacity(equipment);
    const configuredBaseCount = this.mountedEngine().getBaseChassisHeatSinks(equipment.isCompactHeatSink);
    const maximumIntegralCount = this.omni() && configuredBaseCount >= 0
      ? configuredBaseCount
      : capacity;
    let preservedExternalUnits = 0;
    if (preserveExternal) {
      for (const mount of externalCandidates) {
        const units = (mount.equipment as MiscEquipment).heatSinkUnitsPerMount;
        if (preservedExternalUnits + units <= totalCount) preservedExternalUnits += units;
      }
    }
    const integralCount = Math.min(totalCount - preservedExternalUnits, maximumIntegralCount);
    let externalUnitsRemaining = totalCount - integralCount;
    const externalMounts: EntityMountedEquipment[] = [];

    for (const mount of externalCandidates) {
      const units = (mount.equipment as MiscEquipment).heatSinkUnitsPerMount;
      if (units > externalUnitsRemaining) continue;
      externalMounts.push(mount);
      externalUnitsRemaining -= units;
    }

    while (externalUnitsRemaining > 0) {
      externalMounts.push(this.createHeatSinkMount(equipment, 'unallocated'));
      externalUnitsRemaining--;
    }

    const integralMounts = Array.from(
      { length: integralCount },
      () => this.createHeatSinkMount(equipment, 'engine'),
    );
    this.equipment.set([...nonHeatSinks, ...externalMounts, ...integralMounts]);
  }

  private integralHeatSinkCapacity(equipment: MiscEquipment): number {
    if (equipment.hasFlag('F_IS_DOUBLE_HEAT_SINK_PROTOTYPE')) return 0;
    return this.mountedEngine().integralHeatSinkCapacity(equipment.isCompactHeatSink);
  }

  private createHeatSinkMount(
    equipment: MiscEquipment,
    allocationKind: 'engine' | 'unallocated',
  ): EntityMountedEquipment {
    return new EntityMountedEquipment({
      mountId: generateMountId(),
      equipmentId: equipment.id,
      equipment,
      allocation: { kind: allocationKind },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
  }

  protected override computeIntrinsicWeapons(): readonly IntrinsicWeapon[] {
    const attacks: IntrinsicWeapon[] = [];
    const tsm = this.equipment().some(mount =>
      mount.equipment?.hasFlag('F_TSM') && !mount.equipment.hasFlag('F_PROTOTYPE'));
    const talons = this.equipment().some(mount => mount.equipment?.hasFlag('F_TALON'));
    const isLam = this.chassisConfig === 'LAM';

    if (this instanceof MekWithArmsEntity) {
      const lowerArms = this.hasLowerArmActuator();
      const hands = this.hasHandActuator();
      for (const side of ['left', 'right'] as const) {
        const location = side === 'left' ? 'LA' : 'RA';
        if (!this.hasClawAt(location)) {
          let baseDamage = Math.ceil(this.tonnage() / 10);
          if (isLam) baseDamage /= 2;
          const damage = Math.ceil(lowerArms[side] ? baseDamage : Math.floor(baseDamage / 2));
          const hitModifier = (hands[side] ? 0 : 1)
            + (lowerArms[side] ? 0 : 2)
            - (this.hasAesAt(location) ? 1 : 0);
          attacks.push(intrinsicWeapon(
            `punch:${location}`, 'punch', 'Punch', [location],
            fixedPhysicalDamage(damage, tsm), hitModifier, false,
          ));
        }
      }

      if (hands.left && hands.right) {
        const armAes = this.hasAesAt('LA') && this.hasAesAt('RA');
        const clawModifier = this.equipment().some(mount =>
          mount.equipment?.hasFlag('F_CLUB') && mount.equipment.hasFlag('S_CLAW')) ? 2 : 0;
        attacks.push(intrinsicWeapon(
          'club', 'club', 'Club', [], fixedPhysicalDamage(Math.ceil(this.tonnage() / 5), tsm),
          -1 + clawModifier - (armAes ? 1 : 0), true,
        ));
      }
    }

    const kickDamage = talons
      ? Math.ceil(Math.ceil(this.tonnage() / 5) * 1.5)
      : Math.ceil(this.tonnage() / 5);
    const alternateKickDamage = isLam ? Math.ceil(kickDamage / 2) : undefined;
    attacks.push(intrinsicWeapon(
      'kick', 'kick', talons ? 'Kick [Talons]' : 'Kick', [],
      fixedPhysicalDamage(kickDamage, tsm, alternateKickDamage),
      this.hasLegAes() ? -3 : -2, false,
    ));

    if (this.equipment().some(mount => mount.equipment?.hasFlag('F_JUMP_JET'))) {
      const baseDfaDamage = Math.ceil(this.tonnage() / 10 * 3);
      const dfaDamage = talons ? Math.ceil(baseDfaDamage * 1.5) : baseDfaDamage;
      attacks.push(intrinsicWeapon(
        'death-from-above', 'death-from-above', talons ? 'DFA [Talons]' : 'Death From Above', [],
        fixedPhysicalDamage(dfaDamage, false), 'versus', true,
      ));
    }

    const ramPlate = this.equipment().some(mount => mount.equipment?.hasFlag('F_RAM_PLATE'));
    const spikeCount = this.equipment().filter(mount => mount.equipment?.hasFlag('F_SPIKES')).length;
    attacks.push(intrinsicWeapon(
      'charge', 'charge', 'Charge', [], {
        kind: 'physical-per-hex',
        damagePerHex: this.tonnage() / 10 * (ramPlate ? 1.5 : 1),
        bonusDamage: spikeCount * 2,
      }, 'versus', true,
    ));

    if (isLam) {
      attacks.push(intrinsicWeapon(
        'airmek-ram', 'airmek-ram', 'AirMek Ram', [], {
          kind: 'physical-per-hex', damagePerHex: this.tonnage() / 5, bonusDamage: 0,
        }, 'versus', true,
      ));
    }

    if (this instanceof MekWithArmsEntity) {
      const armAes = this.hasAesAt('LA') && this.hasAesAt('RA');
      attacks.push(intrinsicWeapon(
        'push', 'push', 'Push', [], { kind: 'physical-none' }, armAes ? -2 : -1, true,
      ));
    }

    return attacks;
  }

  private hasAesAt(location: string): boolean {
    return this.getEquipmentAtLocation(location)
      .some(mount => mount.equipment?.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM'));
  }

  private hasLegAes(): boolean {
    const legs = getMekLegLocations(this.chassisConfig);
    return legs.length > 0 && legs.every(location => this.hasAesAt(location));
  }

  private hasClawAt(location: string): boolean {
    return this.getEquipmentAtLocation(location).some(mount =>
      mount.equipment?.hasFlag('F_HAND_WEAPON') && mount.equipment.hasFlag('S_CLAW'));
  }

  override computeWalkMP(options: MovementCalculationOptions): number {
    const equipment = this.equipment();
    const shieldPenalty = this.chassisConfig === 'Quad' || this.chassisConfig === 'QuadVee'
      ? 0
      : equipment.filter(mount =>
        mount.equipment?.hasFlag('S_SHIELD_LARGE')
        || mount.equipment?.hasFlag('S_SHIELD_MEDIUM')
      ).length;
    const modularArmorPenalty = equipment.some(
      mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR'),
    ) && !options.ignoreModularArmor ? 1 : 0;
    const chainDrapePenalty = !options.ignoreChainDrape && equipment.some(
      mount => mount.equipment?.hasFlag('F_CHAIN_DRAPE'),
    ) ? 1 : 0;
    const tsmBonus = options.forceTSM && equipment.some(mount =>
      mount.equipment?.hasFlag('F_TSM') && !mount.equipment?.hasFlag('F_PROTOTYPE'),
    ) ? 1 : 0;
    return Math.max(
      0,
      this.originalWalkMP() - shieldPenalty - modularArmorPenalty - chainDrapePenalty + tsmBonus,
    );
  }

  override computeRunMP(options: MovementCalculationOptions): number {
    const walkMP = this.computeWalkMP(options);
    const installedBoosterCount = this.equipment().filter(
      mount => mount.equipment?.hasFlag('F_MASC'),
    ).length;
    const mascCount = options.ignoreMASC
      ? 0
      : options.singleMASC ? Math.min(installedBoosterCount, 1) : installedBoosterCount;
    let runMP = Math.ceil(walkMP * 1.5);
    if (mascCount > 1) runMP = Math.ceil(walkMP * 2.5);
    else if (mascCount === 1) runMP = walkMP * 2;
    return this.hasMPReducingHardenedArmor() ? Math.max(0, runMP - 1) : runMP;
  }

  override computeJumpMP(options: MovementCalculationOptions): number {
    const equipment = this.equipment();
    const jumpJets = equipment.filter(mount => mount.equipment?.hasFlag('F_JUMP_JET')).length;
    if (jumpJets === 0 || equipment.some(mount => mount.equipment?.hasFlag('S_SHIELD_LARGE'))) {
      return 0;
    }

    const partialWingBonus = equipment.some(mount => mount.equipment?.hasFlag('F_PARTIAL_WING'))
      ? (this.weightClass() === 'Ultra Light' || this.weightClass() === 'Light' || this.weightClass() === 'Medium' ? 2 : 1)
      : 0;
    const mediumShields = equipment.filter(mount => mount.equipment?.hasFlag('S_SHIELD_MEDIUM')).length;
    const modularArmorPenalty = equipment.some(
      mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR'),
    ) && !options.ignoreModularArmor ? 1 : 0;
    return Math.max(0, jumpJets + partialWingBonus - mediumShields - modularArmorPenalty);
  }

  private hasMPReducingHardenedArmor(): boolean {
    const armor = this.mountedArmor();
    if (armor.type === 'HARDENED') return true;
    if (armor.type !== 'PATCHWORK' || !armor.patchwork) return false;

    return getMekLegLocations(this.chassisConfig).some(location =>
      armor.patchwork?.types.get(location)?.startsWith('Hardened')
    );
  }

  protected override computeMaximumArmorPoints(): number {
    let totalInternal = 0;
    for (const value of this.structureValues().values()) totalInternal += value;
    return totalInternal * 2 + (this.weightClass() === 'Super Heavy' ? 4 : 3);
  }

  override engineFlags = computed<Set<EngineFlag>>(() => {
    const flags = new Set<EngineFlag>();
    if (this.techBase() === 'Clan' && !this.mixedTech()) flags.add('clan');
    if (this.mountedEngine()?.rating > 400) flags.add('large');
    if (this.isSuperHeavy()) flags.add('superheavy');
    return flags;
  });

  /**
   * Override mixedTech to also check cockpit and gyro tech-base availability.
   *
   * A cockpit/gyro with `techBase: 'All'` may have different availability
   * timelines for IS and Clan (e.g. Small Cockpit: IS from 3061, Clan from
   * 3081).  If the component is not yet available for the chassis tech base
   * at the entity's year, the unit must be using the other tech base's
   * variant — making it mixed tech.
   *
   * Components with `techBase: 'IS'` on a Clan chassis (or vice versa)
   * are also mixed (e.g. Compact Gyro is IS-only).
   */
  protected override computeMixedTech(): MixedTechResult {
    const base = super.computeMixedTech();
    if (base.mixed && !COLLECT_ALL_MIXED_TECH_REASONS) return base;

    const reasons = [...base.reasons];
    let mixed = base.mixed;

    // ── Cockpit advancement-date check ────────────────────────────────
    // A cockpit with techBase 'All' may have different IS/Clan availability
    // timelines (e.g. Small Cockpit: IS from 3061, Clan from 3081).
    const chassisTechBase = this.techBase();
    const year = this.year();
    const cockpit = this.mountedCockpit();
    const cockpitTech = cockpit.tech;
    if (cockpitTech.techBase === 'All') {
      if (!isTechAvailableForBase(cockpitTech.dates, chassisTechBase, year)) {
        const oppositeBase = chassisTechBase === 'Clan' ? 'IS' : 'Clan';
        if (isTechAvailableForBase(cockpitTech.dates, oppositeBase, year)) {
          reasons.push(
            `Cockpit "${cockpit.fullName}" (techBase All): not available for ${chassisTechBase} ` +
            `at year ${year}, but available for ${oppositeBase}`,
          );
          if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
          mixed = true;
        }
      }
    } else if (cockpitTech.techBase !== chassisTechBase) {
      reasons.push(
        `Cockpit "${cockpit.fullName}" tech base ${cockpitTech.techBase} ≠ chassis ${chassisTechBase}`,
      );
      if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
      mixed = true;
    }

    // ── Gyro advancement-date check ──────────────────────────────────
    // Same logic as cockpit: a gyro with techBase 'All' may have split
    // IS/Clan availability timelines, and IS-only gyros (e.g. Compact)
    // on a Clan chassis are mixed.
    const gyro = this.mountedGyro();
    const gyroTech = gyro.tech;
    if (gyroTech.techBase === 'All') {
      if (!isTechAvailableForBase(gyroTech.dates, chassisTechBase, year)) {
        const oppositeBase = chassisTechBase === 'Clan' ? 'IS' : 'Clan';
        if (isTechAvailableForBase(gyroTech.dates, oppositeBase, year)) {
          reasons.push(
            `Gyro "${gyro.fullName}" (techBase All): not available for ${chassisTechBase} ` +
            `at year ${year}, but available for ${oppositeBase}`,
          );
          if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
          mixed = true;
        }
      }
    } else if (gyroTech.techBase !== chassisTechBase) {
      reasons.push(
        `Gyro "${gyro.fullName}" tech base ${gyroTech.techBase} ≠ chassis ${chassisTechBase}`,
      );
      if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
      mixed = true;
    }

    return { mixed, reasons };
  }

  // ── Derived crit-slot grid ────────────────────────────────────────────

  /**
   * Complete critical-slot grid for every location.
   *
   * Built by:
   * 1. Laying down the system template (engine, gyro, actuators, …)
   * 2. Overlaying equipment from mount `placements`
   *
   * This is a READ-ONLY view.  To change slot assignments, mutate the
   * `equipment` signal (update mount placements), and this recomputes.
   */
  criticalSlotGrid = computed<Map<string, CriticalSlotView[]>>(() => {
    const grid = new Map<string, CriticalSlotView[]>();
    const slotsPerLoc = MEK_SLOTS_PER_LOCATION;
    const armoredSys = this.armoredSystemSlots();

    for (const loc of this.locationOrder) {
      // Start with system template + empty fill
      const systemSlots = this.getSystemSlotsForLocation(loc as string);
      const slots: CriticalSlotView[] = [];
      for (let i = 0; i < slotsPerLoc; i++) {
        const s = systemSlots[i] ?? EMPTY_SLOT;
        // Apply armored flag for system slots
        if (s.type === 'system' && armoredSys.has(`${loc}:${i}`)) {
          slots.push({ ...s, armored: true });
        } else {
          slots.push(s);
        }
      }

      grid.set(loc as string, slots);
    }

    // Overlay equipment placements
    for (const mount of this.equipment()) {
      if (!mount.placements) continue;
      for (const p of mount.placements) {
        const slots = grid.get(p.location);
        if (slots && p.slotIndex >= 0 && p.slotIndex < MEK_SLOTS_PER_LOCATION) {
          slots[p.slotIndex] = {
            type: 'equipment',
            mountId: mount.mountId,
            armored: mount.armored,
            omniPod: mount.omniPodMounted,
          };
        }
      }
    }

    return grid;
  });

  // ── Abstract ──────────────────────────────────────────────────────────

  abstract get chassisConfig(): MekConfig;

  // ═══════════════════════════════════════════════════════════════════════════
  //  Base abstract implementations
  // ═══════════════════════════════════════════════════════════════════════════

  override hasRearArmor(loc: string): boolean {
    return MEK_REAR_ARMOR_LOCATIONS.has(loc);
  }

  protected override computeExpectedEngineRating(): number | null {
    return this.walkMP() * this.tonnage();
  }

  protected override computeStructureValues(tonnage: number): Map<string, number> {
    const values = new Map<string, number>();
    for (const loc of this.locationOrder) {
      const location = loc as MekLocation;
      const structureTonnage = this.structureTonnages().get(location) ?? tonnage;
      values.set(location, getInternalForTonnage(structureTonnage, location));
    }
    return values;
  }

  protected override computeStructureTonnages(): Map<string, number> {
    const tonnages = new Map<string, number>();
    for (const loc of this.locationOrder) {
      const location = loc as MekLocation;
      const tonnage = this.isFrankenMek()
        ? this.frankenMekLocations().get(location)?.tonnage ?? this.tonnage()
        : this.tonnage();
      tonnages.set(location, tonnage);
    }
    return tonnages;
  }

  protected override computeMaxArmor(structureValues: Map<string, number>): Map<string, number> {
    const maxArmor = new Map<string, number>();
    for (const [loc, isVal] of structureValues) {
      // Head: flat cap (9 normal, 12 superheavy). Torsos: 2xIS (combined front+rear).
      // Arms/legs: 2xIS (front only, no rear).
      maxArmor.set(loc, loc === 'HD' ? (this.isSuperHeavy() ? 12 : 9) : isVal * 2);
    }
    return maxArmor;
  }

  // ── Tiered validation slice ───────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    // Minimum 10 heat sinks
    if (this.totalHeatSinks() < 10) {
      msgs.push({
        severity: 'error', category: 'heat', code: 'HEAT_SINKS_BELOW_MIN',
        message: `Mek needs at least 10 heat sinks (has ${this.totalHeatSinks()})`,
      });
    }

    // Engine rating ≥ 10
    const engine = this.mountedEngine();
    if (engine && engine.rating > 0 && engine.rating < 10) {
      msgs.push({
        severity: 'error', category: 'engine', code: 'ENGINE_RATING_TOO_LOW',
        message: `Engine rating must be at least 10 (has ${engine.rating})`,
      });
    }

    // Crit slot overflow (derived grid vs slots-per-location)
    for (const [loc, slots] of this.criticalSlotGrid()) {
      const usedSlots = slots.filter(s => s.type !== 'empty').length;
      if (usedSlots > MEK_SLOTS_PER_LOCATION) {
        msgs.push({
          severity: 'error', category: 'crit', code: 'CRIT_SLOTS_OVERFLOW',
          message: `${loc} has ${usedSlots} crit slots but max is ${MEK_SLOTS_PER_LOCATION}`,
          location: loc,
        });
      }
    }

    // Equipment placed on system slots (placement conflict)
    for (const mount of this.equipment()) {
      if (!mount.placements) continue;
      for (const p of mount.placements) {
        const systemSlots = this.getSystemSlotsForLocation(p.location);
        if (p.slotIndex < systemSlots.length && systemSlots[p.slotIndex].type === 'system') {
          msgs.push({
            severity: 'error', category: 'crit', code: 'CRIT_PLACEMENT_CONFLICT',
            message: `"${mount.equipmentId}" placed on system slot ${p.slotIndex} in ${p.location}`,
            location: p.location,
          });
        }
      }
    }

    return msgs;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SYSTEM TEMPLATE - generates fixed system slots per location
  //
  //  Delegates to system-components.ts for engine/gyro/cockpit layouts,
  //  then converts the (string | null)[] layout to CriticalSlotView[].
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns the system slots for a given location.
   * Entries at a given index mean "this slot is reserved for this system."
   * Remaining indices (up to MEK_SLOTS_PER_LOCATION) are empty.
   */
  protected getSystemSlotsForLocation(loc: string): CriticalSlotView[] {
    switch (loc) {
      case 'HD': {
        const layout = buildHeadSystemLayout(this.mountedCockpit());
        return layout.map(s => s ? sys(s as MekSystemType) : EMPTY_SLOT);
      }
      case 'CT': {
        const me = this.mountedEngine();
        const layout = buildCTSystemLayout(me, this.gyroType());
        // Torso-Mounted / VRRP cockpit adds Cockpit + Sensors to CT after engine/gyro
        if (this.mountedCockpit().hasTorsoSlots) {
          const firstEmpty = layout.indexOf(null);
          if (firstEmpty >= 0 && firstEmpty + 1 < MEK_SLOTS_PER_LOCATION) {
            layout[firstEmpty] = 'Cockpit';
            layout[firstEmpty + 1] = 'Sensors';
          }
        }
        return layout.map(s => s ? sys(s as MekSystemType) : EMPTY_SLOT);
      }
      case 'LT': case 'RT': {
        const me = this.mountedEngine();
        const layout = buildSideTorsoSystemLayout(me);
        // Torso-Mounted / VRRP cockpit adds Life Support at slot 0 of each side torso,
        // shifting engine slots down by 1. Matches Java's addTorsoMountedCockpit()
        // which explicitly does setCritical(LOC_*_TORSO, 0, LIFE_SUPPORT).
        if (this.mountedCockpit().hasTorsoSlots) {
          // Shift everything down by 1 (drop last null) and insert Life Support at 0
          layout.pop();
          layout.unshift('Life Support');
        }
        return layout.map(s => s ? sys(s as MekSystemType) : EMPTY_SLOT);
      }
      case 'LA': case 'RA':
        return this.getArmSystemSlots(loc);
      case 'FLL': case 'FRL':
      case 'LL': case 'RL':
      case 'RLL': case 'RRL':
      case 'CL':
        return [
          sys('Hip'), sys('Upper Leg Actuator'),
          sys('Lower Leg Actuator'), sys('Foot Actuator'),
        ];
      default:
        return [];
    }
  }

  private getArmSystemSlots(loc: string): CriticalSlotView[] {
    const slots: CriticalSlotView[] = [sys('Shoulder'), sys('Upper Arm Actuator')];
    if (this instanceof MekWithArmsEntity) {
      const side = loc === 'LA' ? 'left' : 'right';
      if (this.hasLowerArmActuator()[side]) slots.push(sys('Lower Arm Actuator'));
      if (this.hasHandActuator()[side])     slots.push(sys('Hand Actuator'));
    }
    return slots;
  }
}

// ============================================================================
// MekWithArmsEntity - abstract, adds arm actuator management
// ============================================================================

export abstract class MekWithArmsEntity extends MekEntity {
  hasLowerArmActuator = signal<{ left: boolean; right: boolean }>({ left: true, right: true });
  hasHandActuator = signal<{ left: boolean; right: boolean }>({ left: true, right: true });
}

// ============================================================================
// Helpers
// ============================================================================

const EMPTY_SLOT: CriticalSlotView = Object.freeze({
  type: 'empty', armored: false, omniPod: false,
});

function sys(systemType: MekSystemType): CriticalSlotView {
  return { type: 'system', systemType, armored: false, omniPod: false };
}

function getInternalForTonnage(tonnage: number, location: MekLocation): number {
  const nearestTonnage = Math.max(10, Math.min(200, Math.floor((tonnage + 4) / 5) * 5));
  const [head, centerTorso, sideTorso, arm, leg] = MEK_INTERNAL_STRUCTURE[nearestTonnage];
  switch (location) {
    case 'HD': return head;
    case 'CT': return centerTorso;
    case 'LT': case 'RT': return sideTorso;
    case 'LA': case 'RA': return arm;
    default: return leg;
  }
}

function fixedPhysicalDamage(
  damage: number,
  tsm: boolean,
  alternateDamage?: number,
): IntrinsicWeapon['damage'] {
  return {
    kind: 'physical-fixed',
    primary: { damage, ...(tsm ? { tsmDamage: damage * 2 } : {}) },
    ...(alternateDamage === undefined ? {} : {
      alternate: {
        mode: 'airmek' as const,
        value: { damage: alternateDamage, ...(tsm ? { tsmDamage: alternateDamage * 2 } : {}) },
      },
    }),
  };
}

function intrinsicWeapon(
  id: string,
  kind: IntrinsicWeapon['kind'],
  name: string,
  locations: readonly string[],
  damage: IntrinsicWeapon['damage'],
  hitModifier: IntrinsicWeapon['hitModifiers'][number],
  optional: boolean,
): IntrinsicWeapon {
  return {
    source: 'intrinsic',
    id: `intrinsic:${id}`,
    kind,
    name,
    locations,
    category: 'physical',
    heat: 0,
    damage,
    hitModifiers: [hitModifier],
    minimumRange: 0,
    ranges: [],
    optional,
  };
}
