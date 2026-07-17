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
import {
  MountedEngine,
  createMountedArmor,
  MountedArmor,
} from './components';
import { StructureEquipment } from '../equipment.model';
import { SourcebookReference } from '../sourcebook.model';
import {
  ArmorFace,
  C3SystemType,
  EngineFlag,
  FactionCode,
  MEK_WEIGHT_LIMITS,
  MotiveType,
  resolveWeightClass,
  WeightClass,
  EntityFluff,
  EntityMountedEquipment,
  EntityMountedEquipmentInit,
  EntityMountedWeapon,
  EntityWeapon,
  EntityQuirk,
  EntityTechBase,
  EntityTransporter,
  EntityType,
  EntityValidationMessage,
  EntityValidationResult,
  EntityWeaponQuirk,
  IntrinsicWeapon,
  isTechAvailableForBase,
  isEntityMountedWeapon,
  LocationArmor,
  locationArmor,
  MountPlacement,
} from './types';
import { generateMountId, removeMountById, updateMap } from './utils/signal-helpers';
import { uuidv7 } from '../../utils/uuid.util';
import type { SupportVehicle } from './entities/support-vehicle';
import type { UnitSubtype, UnitType } from './types';

/**
 * Set to `true` to make `computeMixedTech` collect ALL mixed-tech reasons
 * instead of returning at the first detection.  Useful for debugging.
 */
export const COLLECT_ALL_MIXED_TECH_REASONS = true;

/** Result of mixed-tech detection, with diagnostic reasons. */
export interface MixedTechResult {
  readonly mixed: boolean;
  /** Human-readable reasons explaining why mixed tech was detected. */
  readonly reasons: readonly string[];
}

export interface MovementCalculationOptions {
  readonly ignoreGravity: boolean;
  readonly ignoreHeat: boolean;
  readonly ignoreModularArmor: boolean;
  readonly ignoreChainDrape: boolean;
  readonly ignoreMASC: boolean;
  readonly ignoreMyomerBooster: boolean;
  readonly ignoreDWP: boolean;
  readonly ignoreBurden: boolean;
  readonly ignoreCargo: boolean;
  readonly ignoreWeather: boolean;
  readonly singleMASC: boolean;
  readonly ignoreSubmergedJumpJets: boolean;
  readonly ignoreGrounded: boolean;
  readonly ignoreOptionalRules: boolean;
  readonly ignoreConversion: boolean;
  readonly forceTSM: boolean;
}

export const STANDARD_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ignoreGravity: false,
  ignoreHeat: false,
  ignoreModularArmor: false,
  ignoreChainDrape: false,
  ignoreMASC: false,
  ignoreMyomerBooster: false,
  ignoreDWP: false,
  ignoreBurden: false,
  ignoreCargo: false,
  ignoreWeather: false,
  singleMASC: false,
  ignoreSubmergedJumpJets: true,
  ignoreGrounded: false,
  ignoreOptionalRules: false,
  ignoreConversion: false,
  forceTSM: false,
};

export const RUN_WITHOUT_MASC_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  ignoreMASC: true,
};

export const BV_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  ignoreGravity: true,
  ignoreHeat: true,
  ignoreModularArmor: true,
  ignoreDWP: true,
  ignoreBurden: true,
  ignoreCargo: true,
  ignoreWeather: true,
  ignoreGrounded: true,
  ignoreOptionalRules: true,
  ignoreConversion: true,
  forceTSM: true,
};

export const AS_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  ignoreGravity: true,
  ignoreHeat: true,
  ignoreModularArmor: true,
  ignoreChainDrape: true,
  ignoreMyomerBooster: true,
  ignoreDWP: true,
  ignoreBurden: true,
  ignoreCargo: true,
  ignoreWeather: true,
  ignoreGrounded: true,
  ignoreOptionalRules: true,
  ignoreConversion: true,
};

/**
 * Abstract base class for all entity types.
 *
 * Properties are categorised as:
 * - **signal** - user-editable inputs (designer's choices or parser values)
 * - **computed** - derived automatically from signals; reactive and read-only
 *
 * === Architectural invariants ===
 *
 * 1. **Single canonical model**: The `equipment` signal is the sole source
 *    of truth for installed gear.  Mek crit grids and location inventories
 *    are DERIVED views.
 *
 * 2. **Immutable snapshots**: Every signal write creates a fresh Array or Map.
 *    Helpers in `signal-helpers.ts` enforce this; in-place mutation is never
 *    performed on signal payloads.
 *
 * 3. **Tiered validation**: Validation is split into independent computed
 *    slices (`engineValidation`, `armorValidation`, `equipmentValidation`,
 *    `typeSpecificValidation`) so changing armor doesn't re-run the engine
 *    check, etc.  A single `validationResult` aggregate collects them.
 *
 * 4. **Typed locations**: Location IDs use canonical literal unions
 *    (`MekLocation`, `TankLocation`, …).  Parsers normalise raw strings at
 *    ingress; all other code uses canonical IDs only.
 */
export abstract class BaseEntity {
  // ── Identity (immutable after construction) ─────────────────────────────
  abstract readonly entityType: EntityType;

  /** Broad Classic BattleTech type used by exported unit metadata. */
  abstract unitType(): UnitType;

  /** Detailed Classic BattleTech subtype used by exported unit metadata. */
  abstract unitSubtype(): UnitSubtype;

  isSupportVehicle(): this is this & SupportVehicle {
    return false;
  }

  protected withOmniSubtype(subtype: string): UnitSubtype {
    return `${subtype}${this.omni() ? ' Omni' : ''}` as UnitSubtype;
  }

  /** Mirrors MegaMek Entity.initMilitary()/hasViableWeapons(). */
  isMilitary(): boolean {
    let totalDamage = 0;
    let hasRangeSixPlus = false;

    for (const mount of this.mountedWeapons()) {
      const weapon = mount.equipment;
      const damage = weapon.damage;
      if (damage === 'variable' || damage === 'artillery' || damage === 'cluster') {
        totalDamage += weapon.rackSize;
      } else if (Array.isArray(damage)) {
        totalDamage += Math.max(0, ...damage);
      } else if (typeof damage === 'number' && damage >= 0) {
        totalDamage += damage;
      }
      hasRangeSixPlus ||= (weapon.ranges[2] ?? 0) >= 6;
    }

    return totalDamage >= 5 || hasRangeSixPlus;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Identity ──
  readonly uuid = signal<string>(uuidv7());
  readonly chassis = signal<string>('');
  readonly model = signal<string>('');
  readonly clanName = signal<string>('');
  readonly mulId = signal<number>(-1);
  readonly role = signal<string>('');
  readonly omni = signal<boolean>(false);

  // ── Tech ──
  readonly year = signal<number>(3145);
  readonly originalBuildYear = signal<number>(-1);
  readonly techBase = signal<EntityTechBase>('IS');
  /** Whether the entity uses mixed technology. */
  readonly mixedTech = signal<boolean>(false);
  readonly rulesLevel = signal<number>(2);

  // ── Meta ──
  readonly source = signal<SourcebookReference[]>([]);
  readonly published = signal<SourcebookReference[]>([]);
  readonly canon = computed(() => [...this.source(), ...this.published()].some(source => source.canon));
  generator?: string; // software who created the file

  /** Tech faction code (e.g. "DC", "FW", "TH"). 'None' = unset. */
  faction = signal<FactionCode>('None');

  // ── Weight ──
  private readonly storedTonnage = signal<number>(0);
  readonly tonnage = computed(() => this.computeTonnage());
  baseChassisFireConWeight = signal<number>(0);

  // ── Movement ──
  motiveType = signal<MotiveType>('None');
  /** Construction walk MP, corresponding to MegaMek's Entity.walkMP field.  */
  originalWalkMP = signal<number>(0);

  /**
   * The motive type as a BLK-compatible string, or `null` if the
   * entity should not write a `motion_type` block at all.
   * Base implementation returns the canonical MotiveType value
   * (or `null` when `'None'`).
   * Subclasses (e.g. InfantryEntity) override to produce compound
   * strings like `"Beast:Tariq"` or `"Motorized SCUBA"`.
   */
  getMotiveTypeAsString(): string | null {
    const m = this.motiveType();
    return m === 'None' ? null : m;
  }

  // ── Engine ──
  mountedEngine = signal<MountedEngine>(
    new MountedEngine({ type: 'None', rating: 0, techBase: 'IS', installed: false }),
  );

  // ── Armor ──
  mountedArmor = signal<MountedArmor>(createMountedArmor());
  /**
   * Armor per location.  Keys are canonical location IDs ("CT", "LT", etc.).
   * Each value is `{ front, rear }`.  For locations without rear armour the
   * `rear` field is 0.
   */
  armorValues = signal<Map<string, LocationArmor>>(new Map());

  // ── Internal Structure ──
  readonly mountedStructure = signal<StructureEquipment | null>(null);

  // ── Equipment - SINGLE SOURCE OF TRUTH ──
  equipment = signal<EntityMountedEquipment[]>([]);
  readonly mountedWeapons = computed<readonly EntityMountedWeapon[]>(() =>
    this.equipment().filter(isEntityMountedWeapon)
  );
  readonly intrinsicWeapons = computed<readonly IntrinsicWeapon[]>(() =>
    this.computeIntrinsicWeapons()
  );
  readonly weapons = computed<readonly EntityWeapon[]>(() => [
    ...this.mountedWeapons().map(mount => {
      const characteristics = mount.equipment.characteristics;
      return {
        source: 'mounted' as const,
        id: mount.mountId,
        name: characteristics.name,
        locations: mount.getOccupiedLocations(),
        category: characteristics.category,
        heat: characteristics.heat,
        damage: characteristics.damage,
        hitModifiers: characteristics.hitModifiers,
        minimumRange: characteristics.minimumRange,
        ranges: characteristics.ranges,
        oneShotCount: characteristics.oneShotCount,
        optional: false,
        mount,
      };
    }),
    ...this.intrinsicWeapons(),
  ]);

  // ── Transporters / Bays ──
  transporters = signal<EntityTransporter[]>([]);
  dockingCollarCount = computed(() => this.transporters()
    .filter(transporter => transporter.kind === 'docking-collar')
    .length);

  // ── Quirks ──
  quirks = signal<EntityQuirk[]>([]);
  weaponQuirks = signal<EntityWeaponQuirk[]>([]);

  // ── Fluff ──
  fluff = signal<EntityFluff>({});

  // ── BV Override ──
  manualBV = signal<number>(0);

  // ── Icon / Fluff image ──
  iconEncoded = signal<string>('');
  fluffImageEncoded = signal<string>('');

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPUTED
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full chassis name including the clan alternate name if present.
   * E.g. "Black Hawk (Nova)"
   */
  fullChassis = computed(() => {
    const clan = this.clanName();
    return clan ? `${this.chassis()} (${clan})` : this.chassis();
  });

  displayName = computed(() => {
    const c = this.fullChassis();
    const m = this.model();
    return m ? `${c} ${m}`.trim() : c;
  });

  c3System = computed<C3SystemType>(() => {
    const equipment = this.equipment().map(mount => mount.equipment);
    if (equipment.some(item => item?.type === 'weapon'
      && item.hasAnyFlag(['F_C3M', 'F_C3MBS']))) {
      return 'C3';
    }

    for (const item of equipment) {
      if (item?.type !== 'misc') continue;
      if (item.hasAnyFlag(['F_C3S', 'F_C3SBS', 'F_C3EM'])) return 'C3';
      if (item.hasFlag('F_C3I')) return 'C3i';
      if (item.hasFlag('F_NAVAL_C3')) return 'Naval C3';
      if (item.hasFlag('F_NOVA')) return 'Nova CEWS';
    }
    return 'None';
  });

  /**
   * Weight class for this entity, derived from tonnage.
   * Subclasses override `computeWeightClass()` to use appropriate limits.
   */
  weightClass = computed<WeightClass>(() => this.computeWeightClass());

  /**
   * Resolve the weight class from tonnage using the appropriate limit table.
   * Default implementation uses Mek limits (mirrors Java fallback).
   * Subclasses override for entity-specific tables.
   */
  protected computeWeightClass(): WeightClass {
    return resolveWeightClass(this.tonnage(), MEK_WEIGHT_LIMITS);
  }

  setTonnage(tonnage: number): void {
    this.storedTonnage.set(tonnage);
  }

  protected computeTonnage(): number {
    return this.storedTonnage();
  }

  computedMixedTechResult = computed<MixedTechResult>(() => this.computeMixedTech());

  /**
   * Core mixed-tech detection: engine tech base, engine advancement dates,
   * and equipment tech bases / advancement dates.
   *
   * Returns a result with `mixed` flag and human-readable `reasons`.
   * Subclasses override this, call `super.computeMixedTech()`, and
   * append their own checks (e.g. cockpit for Meks).
   */
  protected computeMixedTech(): MixedTechResult {
    const reasons: string[] = [];
    const chassisTechBase = this.techBase();
    const year = this.year();
    const isClan = chassisTechBase === 'Clan';
    const oppositeBase = isClan ? 'IS' : 'Clan';
    let mixed = false;

    // ── Engine tech-base mismatch ──────────────────────────────────────
    const engine = this.mountedEngine();
    if (chassisTechBase !== engine.techBase) {
      reasons.push(`Engine tech base ${engine.techBase} ≠ chassis ${chassisTechBase}`);
      if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
      mixed = true;
    }

    // ── Engine advancement-date check ──────────────────────────────────
    // Only for universal ('All') engine types: if the engine's advancement
    // dates aren't available for the chassis tech base at the entity's year
    // but ARE available for the opposite tech base, the unit must be using
    // the other tech base's variant => mixed.
    // Engines with explicit IS or Clan tech entries (XL, XXL, etc.) already
    // have their tech base determined by engine.techBase — dates don't
    // change which variant is installed.
    const engineTech = engine.getTechAdvancement({ clan: isClan, large: engine.isLarge });
    if (engineTech.techBase === 'All') {
      if (!isTechAvailableForBase(engineTech.dates, chassisTechBase, year)) {
        const oppositeEngTech = engine.getTechAdvancement({ clan: !isClan, large: engine.isLarge });
        if (isTechAvailableForBase(oppositeEngTech.dates, oppositeBase, year)) {
          reasons.push(
            `Engine ${engine.type} (techBase All): not available for ${chassisTechBase} at year ${year}, ` +
            `but available for ${oppositeBase}`,
          );
          if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
          mixed = true;
        }
      }
    }

    // ── Equipment tech-base & advancement checks ──────────────────────
    for (const m of this.equipment()) {
      if (!m.equipment) continue;
      if ((m.equipment.techBase === 'Clan' && chassisTechBase === 'IS') ||
          (m.equipment.techBase === 'IS' && chassisTechBase === 'Clan')) {
        reasons.push(
          `Equipment "${m.equipment.name}" tech base ${m.equipment.techBase} ≠ chassis ${chassisTechBase}`,
        );
        if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
        mixed = true;
      }
      if (m.equipment.techBase === 'All') {
        // 'All' tech base equipment may have different IS/Clan advancement
        // timelines.  If the equipment is not yet available for the chassis
        // tech base at the entity's year, but IS available for the opposite
        // tech base, the unit must be using the other side's variant => mixed.
        const adv = m.equipment.tech.advancement;
        if (adv.is && adv.clan) {
          const chassisSide = isClan ? adv.clan : adv.is;
          const oppositeSide = isClan ? adv.is : adv.clan;
          if (!isTechAvailableForBase(chassisSide, chassisTechBase, year) &&
              isTechAvailableForBase(oppositeSide, oppositeBase, year)) {
            reasons.push(
              `Equipment "${m.equipment.name}" (techBase All): not available for ${chassisTechBase} ` +
              `at year ${year}, but available for ${oppositeBase}`,
            );
            if (!COLLECT_ALL_MIXED_TECH_REASONS) return { mixed: true, reasons };
            mixed = true;
          }
        }
      }
    }
    return { mixed, reasons };
  }

  engineFlags = computed<Set<EngineFlag>>(() => {
    const flags = new Set<EngineFlag>();
    if (this.techBase() === 'Clan' && !this.mixedTech()) flags.add('clan');
    if (this.mountedEngine().rating > 400) flags.add('large');
    return flags;
  });

  walkMP = computed(() => this.computeWalkMP(STANDARD_MOVEMENT_CALCULATION));
  runMP = computed(() => this.computeRunMP(RUN_WITHOUT_MASC_CALCULATION));
  jumpMP = computed(() => this.computeJumpMP(STANDARD_MOVEMENT_CALCULATION));

  maxWalkMP = computed(() => this.computeWalkMP(BV_MOVEMENT_CALCULATION));
  maxRunMP = computed(() => this.computeRunMP(BV_MOVEMENT_CALCULATION));
  maxJumpMP = computed(() => this.computeJumpMP(BV_MOVEMENT_CALCULATION));

  computeWalkMP(_options: MovementCalculationOptions): number {
    return this.originalWalkMP();
  }

  computeRunMP(options: MovementCalculationOptions): number {
    return Math.ceil(this.computeWalkMP(options) * 1.5);
  }

  computeJumpMP(_options: MovementCalculationOptions): number {
    return this.equipment().filter(e => e.equipment?.hasFlag?.('F_JUMP_JET')).length;
  }

  /** Effective tonnage per location. */
  structureTonnages = computed<Map<string, number>>(() => this.computeStructureTonnages());

  /** Internal structure points per location, derived from the effective structure configuration. */
  structureValues = computed<Map<string, number>>(() =>
    this.computeStructureValues(this.tonnage())
  );

  totalInternalPoints = computed(() => this.computeTotalInternalPoints());

  protected computeTotalInternalPoints(): number {
    let total = 0;
    for (const value of this.structureValues().values()) {
      if (value > 0) total += value;
    }
    return total;
  }

  maxArmorValues = computed<Map<string, number>>(() =>
    this.computeMaxArmor(this.structureValues())
  );

  totalArmorPoints = computed(() => {
    let sum = 0;
    for (const la of this.armorValues().values()) {
      sum += la.front + la.rear;
    }
    return sum;
  });

  totalMaxArmor = computed(() => {
    let sum = 0;
    for (const v of this.maxArmorValues().values()) sum += v;
    return sum;
  });

  maximumArmorPoints = computed(() => this.computeMaximumArmorPoints());

  protected computeMaximumArmorPoints(): number {
    return 0;
  }

  // ── Derived indexes (reused across validators) ─────────────────────────

  /** Equipment grouped by location - rebuilt only when equipment changes */
  protected mountsByLocation = computed(() => {
    const idx = new Map<string, EntityMountedEquipment[]>();
    for (const m of this.equipment()) {
      let arr = idx.get(m.location);
      if (!arr) { arr = []; idx.set(m.location, arr); }
      arr.push(m);
    }
    return idx;
  });

  /** Set of unresolved mount IDs - rebuilt only when equipment changes */
  protected unresolvedMounts = computed(() =>
    this.equipment().filter(m => !m.equipment)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  TIERED VALIDATION - independent computed slices
  // ═══════════════════════════════════════════════════════════════════════════

  /** Engine rating cross-check */
  protected engineValidation = computed<EntityValidationMessage[]>(() => {
    const msgs: EntityValidationMessage[] = [];
    const expected = this.computeExpectedEngineRating();
    if (expected !== null && this.mountedEngine().rating !== expected) {
      msgs.push({
        severity: 'warning', category: 'engine', code: 'ENGINE_RATING_MISMATCH',
        message: `Engine rating ${this.mountedEngine().rating} ≠ expected ${expected} `
          + `(walkMP=${this.walkMP()} × tonnage=${this.tonnage()})`,
      });
    }
    return msgs;
  });

  /** Per-location armor bounds */
  protected armorValidation = computed<EntityValidationMessage[]>(() => {
    const msgs: EntityValidationMessage[] = [];
    for (const [loc, la] of this.armorValues()) {
      const maxTotal = this.maxArmorValues().get(loc) ?? 0;
      const total = la.front + la.rear;
      if (total > maxTotal) {
        msgs.push({
          severity: 'error', category: 'armor', code: 'ARMOR_EXCEEDS_MAX',
          message: `${loc} armor ${total} exceeds maximum ${maxTotal}`, location: loc,
        });
      }
      if (la.rear > 0 && !this.hasRearArmor(loc)) {
        msgs.push({
          severity: 'error', category: 'armor', code: 'ARMOR_REAR_INVALID',
          message: `${loc} does not support rear armor`, location: loc,
        });
      }
    }
    return msgs;
  });

  /** Unresolved equipment names */
  protected equipmentValidation = computed<EntityValidationMessage[]>(() =>
    this.unresolvedMounts().map(m => ({
      severity: 'error' as const, category: 'equipment' as const,
      code: 'EQUIPMENT_UNRESOLVED',
      message: `Equipment "${m.equipmentId}" could not be resolved`,
    }))
  );

  /** Override in subclasses for type-specific rules */
  protected abstract typeSpecificValidation: Signal<EntityValidationMessage[]>;

  /** Aggregated validation result */
  readonly validationResult: Signal<EntityValidationResult> = computed(() => {
    const messages = [
      ...this.engineValidation(),
      ...this.armorValidation(),
      ...this.equipmentValidation(),
      ...this.typeSpecificValidation(),
    ];
    return { valid: messages.every(m => m.severity !== 'error'), messages };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT - implemented by each entity type
  // ═══════════════════════════════════════════════════════════════════════════

  abstract get locationOrder(): readonly string[];
  abstract get validLocations(): ReadonlySet<string>;

  /** Whether a given location supports rear armor */
  abstract hasRearArmor(loc: string): boolean;

  locationIsLeg(_loc: string): boolean {
    return false;
  }

  protected abstract computeStructureValues(tonnage: number): Map<string, number>;

  protected computeStructureTonnages(): Map<string, number> {
    return new Map(this.locationOrder.map(location => [location, this.tonnage()]));
  }

  getStructureTonnageAtLocation(location: string): number {
    return this.structureTonnages().get(location) ?? this.tonnage();
  }

  protected abstract computeMaxArmor(structureValues: Map<string, number>): Map<string, number>;
  protected abstract computeExpectedEngineRating(): number | null;

  protected computeIntrinsicWeapons(): readonly IntrinsicWeapon[] {
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  METHODS - immutable equipment management
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get all equipment at a specific location */
  getEquipmentAtLocation(loc: string): EntityMountedEquipment[] {
    return this.mountsByLocation().get(loc) ?? [];
  }

  /** Find a mount by its stable ID */
  getMountById(mountId: string): EntityMountedEquipment | undefined {
    return this.equipment().find(m => m.mountId === mountId);
  }

  /** Append a new equipment mount (auto-generates mountId if missing) */
  addEquipment(equip: EntityMountedEquipment | EntityMountedEquipmentInit): void {
    const mount = EntityMountedEquipment.from(equip.mountId
      ? equip
      : { ...equip, mountId: generateMountId() });
    this.equipment.update(list => [...list, mount]);
  }

  /** Remove equipment by mountId */
  removeEquipment(mountId: string): void {
    removeMountById(this.equipment, mountId);
  }

  /** Move equipment to a new location, optionally with new placements */
  moveEquipment(mountId: string, newLocation: string, newPlacements?: readonly MountPlacement[]): void {
    this.equipment.update(list => list.map(m => {
      if (m.mountId !== mountId) return m;
      return m.clone({
        allocation: {
          kind: 'location',
          location: newLocation,
          placements: newPlacements ?? m.placements,
        },
      });
    }));
  }

  /** Set armor for a specific location and face, always creating new Map */
  setArmorValue(loc: string, face: ArmorFace, value: number): void {
    updateMap(this.armorValues, draft => {
      const prev = draft.get(loc) ?? locationArmor(0);
      draft.set(loc, { ...prev, [face]: value });
    });
  }

  /** Get armor for a specific location and face */
  getArmorValue(loc: string, face: ArmorFace = 'front'): number {
    const la = this.armorValues().get(loc);
    return la ? la[face] : 0;
  }
}
