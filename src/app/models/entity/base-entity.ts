/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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
  MIXED_TECH,
  OMNI_TECH,
  PATCHWORK_ARMOR_TECH,
  createLocationComponentLayout,
  effectiveLocationComponents,
  LocationComponentLayout,
  locationComponentAt,
  getStructureTechAdvancement,
  MountedArmor,
  MountedStructure,
  uniformLocationComponent,
  withLocationComponent,
  withUniformLocationComponent,
} from './components';
import { AmmoEquipment, ArmorEquipment, Equipment, MiscEquipment, WeaponEquipment } from '../equipment.model';
import { SourcebookReference } from '../sourcebook.model';
import { EquipmentRelationships, type EquipmentBayInput } from './equipment-relationships';
import {
  STANDARD_MOVEMENT_CALCULATION,
  RUN_WITHOUT_MASC_CALCULATION,
  ANY_TYPE_JUMP_MOVEMENT_CALCULATION,
  BV_MOVEMENT_CALCULATION,
  ArmorFace,
  calculateCompositeStaticTechLevel,
  calculateCompositeTechRating,
  C3SystemType,
  EngineFlag,
  FactionCode,
  MEK_WEIGHT_LIMITS,
  MotiveType,
  type MovementCalculationOptions,
  resolveWeightClass,
  WeightClass,
  EntityFluff,
  EquipmentBay,
  EquipmentBayKind,
  EntityMountedEquipment,
  EntityMountedEquipmentInput,
  EntityMountedWeapon,
  EntityLocationMetadata,
  EntityWeapon,
  EntityQuirk,
  EntityTechBase,
  EntityTransporter,
  EntityTechnology,
  EntityType,
  EntityValidationMessage,
  EntityValidationResult,
  EntityWeaponQuirk,
  IntrinsicWeapon,
  isTechAvailableForBase,
  isEntityMountedWeapon,
  LocationArmor,
  locationArmor,
  createMountId,
  MountId,
  MountPlacement,
  requireArmorEquipment,
  TechRatingSource,
} from './types';
import { uuidv7 } from '../../utils/uuid.util';
import type { SupportVehicle } from './entities/support-vehicle';
import type { UnitSubtype, UnitType } from './types';
import { EquipmentRegistry } from '../equipment-lookup';
import { CLAN_EXCEPTIONAL_BAY_IDS, weaponBayEquipmentId } from './utils/implicit-equipment';
import { calculateEntityCostDetails } from './utils/cost/entity-cost';
import {
  calculateBattleValueDetails,
  getOffensiveSpeedFactor,
} from './utils/battle-value';
import { reconcileEquipmentRelationships } from './utils/equipment-relationship-rules';
import { canLinkEquipment as isCompatibleEquipmentLink } from './utils/equipment-link-rules';
import { calculateEntityEffectiveTonnage } from './utils/weight/entity-weight';

export interface AddEquipmentOptions {
  /** Enhancement target. The newly installed enhancement becomes the link source. */
  readonly linkedTo?: EntityMountedEquipment;
}

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
 * 2. **Immutable snapshots**: Entity mutation methods replace Arrays and Maps;
 *    signal payloads are never mutated in place.
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
export abstract class BaseEntity implements EntityTechnology {
  constructor(protected readonly equipmentRegistry: EquipmentRegistry) {
    this.setUniformArmor(new MountedArmor({
      armor: requireArmorEquipment('STANDARD', false, equipmentRegistry),
      techBase: 'IS',
    }));
  }

  // ── Identity (immutable after construction) ─────────────────────────────
  abstract readonly entityType: EntityType;

  /** Broad Classic BattleTech type used by exported unit metadata. */
  abstract unitType(): UnitType;

  /** Detailed Classic BattleTech subtype used by exported unit metadata. */
  abstract unitSubtype(): UnitSubtype;

  isSupportVehicle(): this is this & SupportVehicle {
    return false;
  }

  /** Large aerospace craft price transport bays in their family calculator. */
  isLargeCraft(): boolean {
    return false;
  }

  getEquipmentRegistry(): EquipmentRegistry {
    return this.equipmentRegistry;
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

  /** Entity systems that participate in the composite technology rating. */
  entityTechAdvancements(): readonly TechRatingSource[] {
    return [];
  }

  protected omniTechAdvancement(): TechRatingSource | null {
    return OMNI_TECH;
  }

  /** Engine, armor, structure, and other systems added by Entity's base implementation. */
  protected baseSystemTechAdvancements(): readonly TechRatingSource[] {
    const sources: TechRatingSource[] = [];
    const engine = this.mountedEngine();
    if (engine.installed) {
      sources.push(engine.getTechAdvancement({ supportVee: this.isSupportVehicle() }));
    }
    const armorEquipment = new Map<string, ArmorEquipment>();
    for (const mountedArmor of this.armorByLocation().values()) {
      armorEquipment.set(mountedArmor.armor.id, mountedArmor.armor);
    }
    sources.push(...[...armorEquipment.values()].map(armor => armor.tech));
    const structures = new Map<string, MountedStructure>();
    for (const structure of this.structureByLocation().values()) {
      structures.set(structure.structure.id, structure);
    }
    sources.push(...[...structures.values()].map(structure =>
      getStructureTechAdvancement(structure.structure)
    ));
    const omniTech = this.omniTechAdvancement();
    if (this.omni() && omniTech) sources.push(omniTech);
    if (this.hasPatchworkArmor()) sources.push(PATCHWORK_ARMOR_TECH);
    if (this.mixedTech()) sources.push(MIXED_TECH);
    return sources;
  }

  /** Whether a rating above 400 selects MegaMek's Large Engine technology record. */
  protected usesLargeEngineTechnology(): boolean {
    return true;
  }

  /** Whether a mounted item contributes to the context-free static technology level. */
  protected mountedEquipmentContributesStaticTech(_equipment: Equipment): boolean {
    return true;
  }

  private staticTechLevelSources(): TechRatingSource[] {
    const sources: TechRatingSource[] = this.equipment()
      .flatMap(mount => mount.equipment && this.mountedEquipmentContributesStaticTech(mount.equipment)
        ? [mount.equipment.tech]
        : []);
    const systemSources = [...this.baseSystemTechAdvancements()];
    const engine = this.mountedEngine();
    if (engine.installed && !this.usesLargeEngineTechnology()) {
      systemSources[0] = engine.getTechAdvancement({
        large: false,
        supportVee: this.isSupportVehicle(),
      });
    }
    sources.push(...systemSources);
    sources.push(...this.entityTechAdvancements());
    return sources;
  }

  private techRatingSources(): TechRatingSource[] {
    const sources: TechRatingSource[] = this.equipment()
      .flatMap(mount => mount.equipment ? [mount.equipment.tech] : []);
    sources.push(...this.implicitSystemEquipment().map(equipment => equipment.tech));
    if (this.entityType === 'Mek' && this.automaticClanCaseLocations().size > 0) {
      const clanCase = this.equipmentRegistry.findForTechBase('CLCASE', 'Clan');
      if (clanCase) sources.push(clanCase.tech);
    }
    sources.push(...this.baseSystemTechAdvancements());
    sources.push(...this.entityTechAdvancements());
    return sources.filter(source => {
      if (!('advancement' in source)) return true;
      const equipment = this.equipment().find(mount => mount.equipment?.tech === source)?.equipment;
      return equipment == null || this.mountedEquipmentContributesTech(equipment);
    });
  }

  /** Mirror CompositeTechLevel's blank-progression early return. */
  private mountedEquipmentContributesTech(equipment: Equipment): boolean {
    if (this.mixedTech() || this.techBase() !== 'IS' || equipment.techBase !== 'Clan'
      || equipment.type === 'ammo') return true;
    const dates = equipment.tech.advancement;
    if (!dates || !('is' in dates || 'clan' in dates)) return true;
    if (dates.is != null) return true;
    const clanCommon = dates.clan?.common;
    if (clanCommon == null) return false;
    const commonYear = Number.parseInt(String(clanCommon).replace(/\D/g, ''), 10);
    return Number.isFinite(commonYear) && commonYear <= this.year();
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

  effectiveOriginalBuildYear(): number {
    if (this.originalBuildYear() > 0) {
      return Math.min(this.originalBuildYear(), this.year());
    }
    return Math.max(this.originalBuildYear(), this.year());
  }

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
  /** User-selected chassis capacity. This is not installed construction mass. */
  readonly tonnage = computed(() => this.computeTonnage());
  /** Installed construction mass calculated from systems and equipment. */
  readonly effectiveTonnage = computed(() => calculateEntityEffectiveTonnage(this));
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
  private readonly armorLayout = signal<LocationComponentLayout<string, MountedArmor> | null>(null);
  /** Total effective armor material/configuration for every armor-bearing location. */
  readonly armorByLocation = computed<ReadonlyMap<string, MountedArmor>>(() => {
    const layout = this.armorLayout();
    return layout ? effectiveLocationComponents(layout, this.armorLocations) : new Map();
  });
  /** Common effective armor, or null when the entity uses patchwork armor. */
  readonly uniformArmor = computed<MountedArmor | null>(() => {
    const layout = this.armorLayout();
    return layout
      ? uniformLocationComponent(layout, this.armorLocations, (left, right) => left.equals(right))
      : null;
  });
  /** Patchwork is derived from heterogeneous effective location armor. */
  readonly hasPatchworkArmor = computed(() =>
    this.armorLayout() !== null && this.uniformArmor() === null
  );
  /**
   * Armor per location.  Keys are canonical location IDs ("CT", "LT", etc.).
   * Each value is `{ front, rear }`.  For locations without rear armour the
   * `rear` field is 0.
   */
  armorValues = signal<Map<string, LocationArmor>>(new Map());

  // ── Internal Structure ──
  private readonly structureLayout = signal<LocationComponentLayout<string, MountedStructure> | null>(null);
  /** Total effective structure material for every active entity location. */
  readonly structureByLocation = computed<ReadonlyMap<string, MountedStructure>>(() => {
    const layout = this.structureLayout();
    return layout ? effectiveLocationComponents(layout, this.locationOrder) : new Map();
  });
  /** Common effective structure, or null when location structures differ. */
  readonly uniformStructure = computed<MountedStructure | null>(() => {
    const layout = this.structureLayout();
    return layout
      ? uniformLocationComponent(layout, this.locationOrder, (left, right) => left.equals(right))
      : null;
  });
  /** Common structure material, ignoring location tonnage used by wire formats. */
  readonly uniformStructureMaterial = computed<MountedStructure | null>(() => {
    const layout = this.structureLayout();
    return layout
      ? uniformLocationComponent(
        layout,
        this.locationOrder,
        (left, right) => left.hasSameMaterialAs(right),
      )
      : null;
  });
  /** Database-resolved systems derived from entity state but not serialized as mounts. */
  readonly implicitSystemEquipment = computed<readonly Equipment[]>(() => {
    const equipment = this.computeImplicitSystemEquipment();
    return [...new Map(equipment.map(item => [item.id, item])).values()];
  });

  readonly #locationMetadata = signal<ReadonlyMap<string, EntityLocationMetadata>>(new Map());
  readonly locationMetadata = this.#locationMetadata.asReadonly();

  readonly clanCaseOptOutLocations = computed<ReadonlySet<string>>(() => new Set(
    [...this.#locationMetadata()]
      .filter(([, metadata]) => metadata.clanCaseOptOut)
      .map(([location]) => location),
  ));

  protected readonly allowsImplicitClanCase = computed<boolean>(()=>{
    return this.techBase() === 'Clan';
  });

  static readonly #NO_IMPLICIT_CLAN_CASE = new Set<string>();

  /** Locations where MegaMek's load-time Mek.addClanCase() installs generated Clan CASE. */
  readonly automaticClanCaseLocations = computed<ReadonlySet<string>>(() => {
    if (!this.allowsImplicitClanCase()) return BaseEntity.#NO_IMPLICIT_CLAN_CASE;

    const protectedLocations = new Set(this.equipment()
      .filter(mount => mount.equipment?.hasFlag('F_CASE') || mount.equipment?.hasFlag('F_CASE_II'))
      .flatMap(mount => mount.getOccupiedLocations()));
    const optedOut = this.clanCaseOptOutLocations();
    const locations = new Set<string>();
    for (const mount of this.equipment()) {
      const equipment = mount.equipment;
      if (!equipment || equipment.hasFlag('F_CASE') || equipment.hasFlag('F_CASE_II')) continue;
      // addClanCase() ignores capacitor charge state, but unjammed RACs remain non-explosive.
      if (equipment instanceof WeaponEquipment && equipment.ammoType === 'AC_ROTARY') continue;
      if (equipment.hasFlag('F_PPC_CAPACITOR') && !this.getLinkedMount(mount)) continue;
      if (!equipment.isExplosive() && mount.secondEquipment?.isExplosive() !== true) continue;
      for (const location of mount.getOccupiedLocations()) {
        if (location !== 'Unallocated' && !protectedLocations.has(location) && !optedOut.has(location)) {
          locations.add(location);
        }
      }
    }
    return locations;
  });

  readonly implicitClanCaseLocations = computed<ReadonlySet<string>>(() => {
    if (!this.allowsImplicitClanCase()) {
      return BaseEntity.#NO_IMPLICIT_CLAN_CASE;
    }
    const locations = new Set<string>();
    const optedOut = this.clanCaseOptOutLocations();
    for (const mount of this.equipment()) {
      const equipment = mount.equipment;
      if (!equipment || equipment.hasFlag('F_CASE')) continue;
      // RACs are only explosive when jammed. Capacitors load in Charge mode and
      // therefore contribute to pristine construction cost when marked explosive.
      if (equipment instanceof WeaponEquipment && equipment.ammoType === 'AC_ROTARY') continue;
      if (equipment.hasFlag('F_PPC_CAPACITOR') && !this.getLinkedMount(mount)) continue;
      if (!equipment.isExplosive() && mount.secondEquipment?.isExplosive() !== true) continue;
      for (const location of mount.getOccupiedLocations()) {
        if (location !== 'Unallocated' && !optedOut.has(location)) locations.add(location);
      }
    }
    return locations;
  });

  // ── Equipment - SINGLE SOURCE OF TRUTH ──
  readonly #equipment = signal<EntityMountedEquipment[]>([]);
  readonly equipment = this.#equipment.asReadonly();
  #nextMountSequence = 1;
  readonly #equipmentById = computed(() => new Map(
    this.#equipment().map(mount => [mount.mountId, mount]),
  ));
  readonly #equipmentRelationships = signal(new EquipmentRelationships());

  /** Resolved aggregates whose members are canonical mounts from `equipment`. */
  readonly equipmentBays = computed<readonly EquipmentBay[]>(() =>
    this.#equipmentRelationships().resolveBays(this.#equipmentById()));

  /** Full construction-cost calculation, derived only from canonical entity state. */
  readonly costDetails = computed(() => calculateEntityCostDetails(this, { ignoreAmmo: false }));

  /** Construction cost, sourced from the same calculation as `costDetails`. */
  readonly cost = computed(() => this.costDetails().total);

  /** One reactive traversal supplies both pristine BV and its structured report. */
  readonly #battleValueCalculation = computed(() => calculateBattleValueDetails(this));
  /** Pristine-entity BV, equivalent to Java calculateBV(false, true). */
  readonly battleValue = computed(() => this.#battleValueCalculation().base);
  /** Structured, Java-export-shaped details computed from canonical entity state. */
  readonly battleValueDetails = computed(() => this.#battleValueCalculation().details);

  setLocationMetadata(location: string, metadata: EntityLocationMetadata): void {
    if (!this.locationOrder.includes(location)) {
      throw new Error(`Unknown location "${location}"`);
    }
    const next = new Map(this.#locationMetadata());
    if (Object.values(metadata).every(value => value === undefined || value === false)) next.delete(location);
    else next.set(location, { ...metadata });
    this.#locationMetadata.set(next);
  }

  setClanCaseOptOutLocations(locations: ReadonlySet<string>): void {
    const next = new Map(this.#locationMetadata());
    for (const [location, metadata] of next) {
      const updated = { ...metadata, clanCaseOptOut: undefined };
      if (Object.values(updated).every(value => value === undefined || value === false)) next.delete(location);
      else next.set(location, updated);
    }
    for (const location of locations) {
      if (!this.locationOrder.includes(location)) throw new Error(`Unknown location "${location}"`);
      next.set(location, { ...next.get(location), clanCaseOptOut: true });
    }
    this.#locationMetadata.set(next);
  }

  locationHasCaseProtection(location: string): boolean {
    return this.implicitClanCaseLocations().has(location)
      || this.equipment().some(mount => mount.getOccupiedLocations().includes(location)
        && mount.equipment?.hasFlag('F_CASE'));
  }

  reconcileEquipmentRelationships(): void {
    reconcileEquipmentRelationships(this);
  }

  protected computeImplicitSystemEquipment(): readonly Equipment[] {
    const implicit: Equipment[] = [];
    if (!this.supportsWeaponBays()) return implicit;
    for (const equipmentBay of this.equipmentBays()) {
      if (equipmentBay.kind !== 'weapon-bay') continue;
      const mount = equipmentBay.weapons[0];
      if (!mount || !(mount.equipment instanceof WeaponEquipment)) continue;
      const bayId = weaponBayEquipmentId(mount.equipment);
      if (this.techBase() === 'Clan' && CLAN_EXCEPTIONAL_BAY_IDS.has(bayId)) continue;
      const bay = this.equipmentRegistry.findForTechBase(bayId, this.techBase());
      if (bay) implicit.push(bay);
    }
    return implicit;
  }

  protected supportsWeaponBays(): boolean {
    return false;
  }
  /** Composite technology rating and four-era availability code. */
  readonly obsoleteYears = computed<readonly number[]>(() => {
    const obsolete = this.quirks().find(quirk => quirk.quirk.key === 'obsolete');
    if (!obsolete) return [];
    const value = obsolete.value?.trim() ?? '';
    if (!value || value.toLowerCase() === 'unknown') return [];
    return value.split(',')
      .map(part => Number.parseInt(part.trim(), 10))
      .filter(Number.isFinite);
  });

  readonly techRating = computed(() => calculateCompositeTechRating(
    this.techRatingSources(),
    {
      techBase: this.techBase(),
      year: this.year(),
      obsoleteYears: this.obsoleteYears(),
    },
  ));
  readonly staticTechLevel = computed(() => {
    const componentLevel = calculateCompositeStaticTechLevel(this.staticTechLevelSources());
    return this.equipment().some(mount => mount.armored)
      ? calculateCompositeStaticTechLevel([
        { rating: 'E', level: componentLevel, availability: ['X', 'X', 'X', 'X'] },
        { rating: 'E', level: 'Advanced', availability: ['X', 'X', 'F', 'E'] },
      ])
      : componentLevel;
  });
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
    this.onTonnageChanged(tonnage);
  }

  /** Keep ordinary entity structures synchronized with chassis tonnage. */
  protected onTonnageChanged(tonnage: number): void {
    const layout = this.structureLayout();
    if (!layout) return;
    this.structureLayout.set(createLocationComponentLayout(
      layout.defaultComponent.withTonnage(tonnage),
      [...layout.overrides].map(([location, structure]) =>
        [location, structure.withTonnage(tonnage)] as const
      ),
    ));
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
  maxJumpMP = computed(() => this.computeJumpMP(ANY_TYPE_JUMP_MOVEMENT_CALCULATION));

  /** TM p.316 offensive speed factor used by the BV calculator and export. */
  readonly offensiveSpeedFactor = computed(() => getOffensiveSpeedFactor(this));

  /** Installed underwater maneuvering units, derived from canonical equipment mounts. */
  readonly installedUmuMP = computed(() => this.equipment().filter(
    mount => mount.equipment?.hasFlag('F_UMU'),
  ).length);

  /** Usable UMU movement; large shields prevent mounted UMUs from functioning. */
  readonly umuMP = computed(() => this.equipment().some(
    mount => mount.equipment?.hasFlag('S_SHIELD_LARGE'),
  ) ? 0 : this.installedUmuMP());

  /** Whether this construction uses the heat scale. */
  tracksHeat(): boolean {
    return false;
  }

  /** Maximum static equipment heat, independent of combat state. */
  readonly heatGeneration = computed(() => this.tracksHeat() ? this.computeHeatGeneration() : -1);

  protected computeHeatGeneration(): number {
    let heat = 0;
    for (const mount of this.equipment()) {
      if (mount.equipment instanceof WeaponEquipment) {
        const multiplier = mount.equipment.ammoType === 'AC_ROTARY'
          ? 6
          : mount.equipment.ammoType === 'AC_ULTRA' || mount.equipment.ammoType === 'AC_ULTRA_THB'
            ? 2
            : 1;
        heat += mount.equipment.heat * multiplier;
      } else if (mount.equipment instanceof MiscEquipment) {
        heat += mount.equipment.operatingHeat;
        if (mount.equipment.hasFlag('F_PPC_CAPACITOR')) heat += 5;
        if (mount.equipment.hasFlag('F_LASER_INSULATOR')) heat -= 1;
      }
    }
    const armor = this.uniformArmor()?.armor;
    if (!this.hasPatchworkArmor() && armor?.armorType === 'STEALTH') heat += 10;
    return heat;
  }

  /** Normal undamaged heat dissipation. */
  readonly heatDissipation = computed(() => this.tracksHeat() ? this.computeHeatDissipation(true) : -1);

  /** Canonical undamaged heat capacity, including systems such as radical heat sinks. */
  heatCapacity(includeRadical = true): number {
    return this.computeHeatDissipation(includeRadical);
  }

  /** Normal and one-turn maximum dissipation, absent on non-heat units. */
  readonly heatDissipationRange = computed<readonly [number, number] | undefined>(() => {
    if (!this.tracksHeat()) return undefined;
    const normal = this.computeHeatDissipation(false);
    return [normal, this.computeMaximumHeatDissipation(normal)];
  });

  protected computeHeatDissipation(_includeRadical: boolean): number {
    return 0;
  }

  protected computeMaximumHeatDissipation(normal: number): number {
    return normal;
  }

  /** Exporter's historical engine-sink count. */
  readonly engineHeatSinks = computed(() => 0);

  /** Canonical heat-sink equipment name, or null for non-heat units. */
  readonly engineHeatSinkType = computed<string | null>(() => null);

  /** Number of independently tracked crew positions, not physical complement. */
  readonly crewSlotCount = computed<number>(() => this.entityType === 'HandheldWeapon' ? 0 : 1);

  protected hasEquipmentFlag(flag: string): boolean {
    return this.equipment().some(mount => mount.equipment?.hasFlag(flag));
  }

  protected hasCoolantPod(): boolean {
    return this.equipment().some(mount =>
      mount.equipment instanceof AmmoEquipment && mount.equipment.ammoType === 'COOLANT_POD'
    );
  }

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

  /** Locations that carry armor material. Override when locationOrder contains non-armor locations. */
  get armorLocations(): readonly string[] {
    return this.locationOrder;
  }

  /** Whether a given location supports rear armor */
  abstract hasRearArmor(loc: string): boolean;

  locationIsLeg(_loc: string): boolean {
    return false;
  }

  protected abstract computeStructureValues(tonnage: number): Map<string, number>;

  protected computeStructureTonnages(): Map<string, number> {
    return new Map([...this.structureByLocation()].map(([location, structure]) =>
      [location, structure.tonnage]
    ));
  }

  /** Return the effective structure material installed at a location. */
  structureAt(location: string): MountedStructure {
    this.assertStructureLocation(location);
    const layout = this.structureLayout();
    if (!layout) throw new Error(`No structure installed for ${this.entityType}`);
    return locationComponentAt(layout, location);
  }

  /** Install one effective structure definition at every active location. */
  setUniformStructure(structure: MountedStructure): void {
    this.structureLayout.set(withUniformLocationComponent(structure));
  }

  /** Install an effective structure definition at one active location. */
  setStructureAt(location: string, structure: MountedStructure): void {
    this.assertStructureLocation(location);
    this.structureLayout.update(layout => {
      if (!layout) throw new Error(`No structure installed for ${this.entityType}`);
      return withLocationComponent(layout, location, structure, (left, right) => left.equals(right));
    });
  }

  private assertStructureLocation(location: string): void {
    if (!this.locationOrder.includes(location)) {
      throw new Error(`Invalid structure location "${location}" for ${this.entityType}`);
    }
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

  /** Resolve the mount targeted by a source mount. */
  getLinkedMount(source: EntityMountedEquipment): EntityMountedEquipment | undefined {
    return this.#equipmentRelationships().linkedMount(source, this.#equipmentById());
  }

  /** Resolve the mount that targets this mount. */
  getLinkingMount(target: EntityMountedEquipment): EntityMountedEquipment | undefined {
    return this.#equipmentRelationships().linkingMount(target, this.#equipmentById());
  }

  /** Whether an installed enhancement can target an installed weapon. */
  canLinkEquipment(source: EntityMountedEquipment, target: EntityMountedEquipment): boolean {
    const currentSource = this.findCurrentMount(source);
    const currentTarget = this.findCurrentMount(target);
    if (!currentSource || !currentTarget
      || !isCompatibleEquipmentLink(currentSource, currentTarget, { year: this.year() })) return false;
    const existingSource = this.getLinkingMount(currentTarget);
    return !existingSource || existingSource.mountId === currentSource.mountId;
  }

  /** Compatible, currently available targets for an installed enhancement. */
  getCompatibleLinkTargets(source: EntityMountedEquipment): readonly EntityMountedEquipment[] {
    const currentSource = this.requireCurrentMount(source);
    return this.equipment().filter(target => this.canLinkEquipment(currentSource, target));
  }

  /** Create or replace an enhancement-to-weapon link after validating domain rules. */
  linkEquipment(source: EntityMountedEquipment, target: EntityMountedEquipment): void {
    const currentSource = this.requireCurrentMount(source);
    const currentTarget = this.requireCurrentMount(target);
    if (!this.canLinkEquipment(currentSource, currentTarget)) {
      throw new Error('Equipment link must connect a compatible weapon enhancement to a weapon in the same location');
    }
    this.#equipmentRelationships.update(relationships => relationships.withLink(currentSource, currentTarget));
  }

  unlinkEquipment(source: EntityMountedEquipment): void {
    const currentSource = this.requireCurrentMount(source);
    this.#equipmentRelationships.update(relationships => relationships.withoutLink(currentSource));
  }

  addEquipmentBay(kind: EquipmentBayKind, input: EquipmentBayInput): void {
    this.requireBayMounts(input);
    this.#equipmentRelationships.update(relationships => relationships.withBay(kind, input));
  }

  replaceEquipmentBays(kind: EquipmentBayKind, inputs: readonly EquipmentBayInput[]): void {
    for (const input of inputs) this.requireBayMounts(input);
    this.#equipmentRelationships.update(relationships => relationships.withBays(kind, inputs));
  }

  /** Install equipment, optionally linking a new enhancement to an existing weapon. */
  addEquipment(
    input: EntityMountedEquipmentInput,
    options: AddEquipmentOptions = {},
  ): EntityMountedEquipment {
    const mount = this.createEquipmentMount(input);

    let relationships = this.#equipmentRelationships();
    if (options.linkedTo) {
      const target = this.requireCurrentMount(options.linkedTo);
      if (!isCompatibleEquipmentLink(mount, target, { year: this.year() })) {
        throw new Error('Equipment link must connect a compatible weapon enhancement to a weapon in the same location');
      }
      relationships = relationships.withLink(mount, target);
    }

    this.#equipment.set([...this.#equipment(), mount]);
    this.#equipmentRelationships.set(relationships);
    return mount;
  }

  /** Create an identified mount for an atomic subclass batch update without installing it yet. */
  protected createEquipmentMount(input: EntityMountedEquipmentInput): EntityMountedEquipment {
    return new EntityMountedEquipment({ ...input, mountId: this.allocateMountId() });
  }

  /** Replace all mounts and discard relationships to identities no longer present. */
  setEquipment(equipment: readonly EntityMountedEquipment[]): void {
    const mounts = [...equipment];
    const mountIds = mounts.map(mount => mount.mountId);
    if (new Set(mountIds).size !== mountIds.length) {
      throw new Error('Equipment mount IDs must be unique within an entity');
    }
    this.#equipmentRelationships.update(relationships => relationships.withMounts(mounts));
    this.#equipment.set(mounts);
  }

  updateEquipment(
    update: (equipment: readonly EntityMountedEquipment[]) => readonly EntityMountedEquipment[],
  ): void {
    this.setEquipment(update(this.#equipment()));
  }

  /** Structurally remove equipment and its relationships. Runtime destruction must retain the mount. */
  removeEquipment(mount: EntityMountedEquipment): void {
    const removed = this.findCurrentMount(mount);
    if (!removed) return;
    this.#equipment.update(equipment => equipment.filter(candidate => candidate.mountId !== removed.mountId));
    this.#equipmentRelationships.update(relationships => relationships.withoutMount(removed));
  }

  /** Move equipment to a new location, optionally with new placements */
  moveEquipment(
    mount: EntityMountedEquipment,
    newLocation: string,
    newPlacements?: readonly MountPlacement[],
  ): EntityMountedEquipment {
    const previous = this.requireCurrentMount(mount);
    const replacement = previous.clone({
        allocation: {
          kind: 'location',
          location: newLocation,
          placements: newPlacements ?? previous.placements,
        },
      });
    let relationships = this.#equipmentRelationships();
    const linked = relationships.linkedMount(previous, this.#equipmentById());
    const linking = relationships.linkingMount(previous, this.#equipmentById());
    const linkContext = { year: this.year() };
    if ((linked && !isCompatibleEquipmentLink(replacement, linked, linkContext))
      || (linking && !isCompatibleEquipmentLink(linking, replacement, linkContext))) {
      relationships = relationships.withoutLinksFor(previous);
    }
    this.#equipment.set(this.#equipment().map(mount => mount === previous ? replacement : mount));
    this.#equipmentRelationships.set(relationships);
    return replacement;
  }

  private findCurrentMount(mount: EntityMountedEquipment): EntityMountedEquipment | undefined {
    return this.#equipmentById().get(mount.mountId);
  }

  private allocateMountId(): MountId {
    let id: MountId;
    do {
      id = createMountId(`m${this.#nextMountSequence++}`);
    } while (this.#equipmentById().has(id));
    return id;
  }

  private requireCurrentMount(mount: EntityMountedEquipment): EntityMountedEquipment {
    const current = this.findCurrentMount(mount);
    if (!current) throw new Error(`Equipment mount "${mount.mountId}" does not belong to this entity`);
    return current;
  }

  private requireBayMounts(input: EquipmentBayInput): void {
    if (input.controller) this.requireCurrentMount(input.controller);
    for (const mount of input.mounts) this.requireCurrentMount(mount);
  }

  /** Set armor for a specific location and face, always creating new Map */
  setArmorValue(loc: string, face: ArmorFace, value: number): void {
    this.armorValues.update(armorValues => {
      const updated = new Map(armorValues);
      const previous = updated.get(loc) ?? locationArmor(0);
      updated.set(loc, { ...previous, [face]: value });
      return updated;
    });
  }

  /** Get armor for a specific location and face */
  getArmorValue(loc: string, face: ArmorFace = 'front'): number {
    const la = this.armorValues().get(loc);
    return la ? la[face] : 0;
  }

  /** Return the effective armor installed at a location. */
  armorAt(location: string): MountedArmor {
    this.assertArmorLocation(location);
    const layout = this.armorLayout();
    if (!layout) throw new Error(`No armor material installed for ${this.entityType}`);
    return locationComponentAt(layout, location);
  }

  /** Install one effective armor definition at every armor-bearing location. */
  setUniformArmor(armor: MountedArmor): void {
    this.armorLayout.set(withUniformLocationComponent(armor));
  }

  /** Initialize entity families whose Java model has no location armor material. */
  protected clearArmorMaterial(): void {
    this.armorLayout.set(null);
  }

  /** Install armor at one location; patchwork status is derived automatically. */
  setArmorAt(location: string, armor: MountedArmor): void {
    this.assertArmorLocation(location);
    this.armorLayout.update(layout => {
      if (!layout) throw new Error(`No armor material installed for ${this.entityType}`);
      return withLocationComponent(layout, location, armor, (left, right) => left.equals(right));
    });
  }

  /** Convenience operation for resolved armor equipment selected by a designer. */
  setArmorEquipmentAt(
    location: string,
    armor: ArmorEquipment,
    techBase = armor.techBase === 'All' ? this.techBase() : armor.techBase,
  ): void {
    if (armor.armorType === 'PATCHWORK') {
      throw new Error('Patchwork is an entity layout, not an installable location armor');
    }
    this.setArmorAt(location, new MountedArmor({
      armor,
      techBase,
    }));
  }

  private assertArmorLocation(location: string): void {
    if (!this.armorLocations.includes(location)) {
      throw new Error(`Invalid armor location "${location}" for ${this.entityType}`);
    }
  }
}
