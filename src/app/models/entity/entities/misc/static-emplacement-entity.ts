// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  BUILDING_ORIGIN,
  DEFAULT_BUILDING_OPTIONS,
  buildingBridgeSpan,
  buildingBridgeLevels,
  buildingNeighbors,
  buildingLocationName,
  buildingHexKey,
  buildingLimits,
  buildingConnectedComponents,
  buildingSheetGrid,
  parseBuildingLocation,
  type BuildingHex,
  type BuildingOptions,
} from '../../types/building';
import { computed, signal, type Signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import { AmmoEquipment, WeaponEquipment } from '../../../equipment.model';
import { powerGeneratorDefinition } from '../../../support-equipment.model';
import { calculateBuildingHexWeight } from '../../utils/weight/building-weight';
import { getBayConstructionWeight } from '../../bays/bay-definitions';
import type { EntityTransportBay, EntityMountedEquipment } from '../../types';
import type {
  BuildingDoor,
  BuildingBayDoor,
  BuildingElevator,
  BuildingEquipmentPlacement,
  BuildingLocation,
  BuildingSpace,
} from '../../types/building';
import { buildingDesignValidation } from './building-design-rules';
import { buildingCapitalWeapon, buildingFacility, buildingRoofFacility } from '../../utils/building-construction';
import type { EntityValidationMessage, UnitSubtype, UnitType, WeightClass } from '../../types';
import type { EquipmentRegistry } from '../../../equipment-lookup';
import type { MovementCalculationOptions } from '../../types';
import { MOBILE_POWER_SYSTEMS, mobileBaseCrew, mobileStructureLimits, mobileStructureValidation, mobileSystemWeights, type MobilePowerSystem } from './mobile-structure-rules';

/** Entity source of truth for MegaMek's building BLKs. */
export class StaticEmplacementEntity extends BaseEntity {
  constructor(registry: EquipmentRegistry, override readonly entityType: 'BuildingEntity' | 'MobileStructure' = 'BuildingEntity') {
    super(registry);
  }
  isMobile(): boolean { return this.entityType === 'MobileStructure'; }
  readonly hexHeights = signal<ReadonlyMap<string, number>>(new Map());
  readonly mobilePowerSystem = signal<MobilePowerSystem>('FUSION');
  readonly operatingRange = signal(0);
  /** Empty means distribute evenly. Explicit allocations retain their actual tonnages. */
  readonly fuelLocations = signal<ReadonlyMap<string, number>>(new Map());
  readonly mobileSystems = computed(() => mobileSystemWeights(this));
  hexHeight(hex: BuildingHex): number {
    return this.isMobile() ? this.hexHeights().get(buildingHexKey(hex)) ?? this.height() ?? 1 : this.height() ?? 1;
  }
  fuelInHex(hex: BuildingHex): number {
    return this.fuelLocations().size ? this.fuelLocations().get(buildingHexKey(hex)) ?? 0
      : this.mobileSystems().fuel / this.coordinates().length;
  }
  exteriorSides(hex: BuildingHex): number[] {
    const occupied = new Set(this.coordinates().map(buildingHexKey));
    return buildingNeighbors(hex).flatMap((neighbor, side) => occupied.has(buildingHexKey(neighbor)) ? [] : [side]);
  }
  constructionLimits(type: number, classification: number) {
    return this.isMobile() ? mobileStructureLimits(type, classification) : buildingLimits(type, classification);
  }
  readonly equipmentLocations = computed<readonly string[]>(() =>
    this.coordinates().flatMap((hex) =>
      Array.from({ length: this.hexHeight(hex) }, (_, floor) => buildingLocationName(hex, floor)),
    ),
  );
  readonly buildingClass = signal<number | undefined>(undefined);
  readonly buildingType = signal<number | undefined>(undefined);
  readonly constructionFactor = signal<number | undefined>(undefined);
  readonly height = signal<number | undefined>(undefined);
  readonly coordinates = signal<readonly BuildingHex[]>([BUILDING_ORIGIN]);
  readonly displayGrid = computed(() => buildingSheetGrid(this.coordinates()));
  readonly buildingOptions = signal<BuildingOptions>(DEFAULT_BUILDING_OPTIONS);
  readonly wallSides = signal<ReadonlyMap<string, number>>(new Map());
  readonly bridgeDecks = signal<ReadonlyMap<string, number>>(new Map());
  readonly doors = signal<readonly BuildingDoor[]>([]);
  readonly bayDoors = signal<readonly BuildingBayDoor[]>([]);
  readonly portalHex2 = signal<BuildingHex | null>(null);
  readonly portalHex3 = signal<BuildingHex | null>(null);
  readonly mapDoors = computed<readonly BuildingDoor[]>(() => [...this.doors(),
    ...this.bayDoors().map(door => ({ position: door.position, facing: door.facing, height: 1 }))]);
  readonly elevators = signal<readonly BuildingElevator[]>([]);
  readonly equipmentDesign = signal<ReadonlyMap<string, BuildingEquipmentPlacement>>(new Map());
  readonly crewCount = signal<number | null>(null);
  readonly crew = computed(() => this.crewCount() ?? this.buildingCrew().total);
  readonly buildingCrew = computed(() => {
    let crew = this.isMobile() ? mobileBaseCrew(this) : 0,
      gunners = 0;
    for (const mount of this.equipment()) {
      const equipment = mount.equipment;
      if (!equipment) continue;
      const tons = mount.getTonnage(this) ?? 0,
        size = mount.size ?? 1;
      if (equipment.hasFlag('F_COMMUNICATIONS')) crew += Math.ceil(tons);
      if (equipment.hasFlag('F_FIELD_KITCHEN')) crew += 3;
      if (equipment.hasFlag('F_MASH')) crew += 5 * size;
      if (equipment.hasFlag('F_MOBILE_FIELD_BASE')) crew += 5;
      crew += buildingFacility(equipment, size, this.constructionFactor() ?? 0)?.crew ?? 0;
      if (
        equipment instanceof WeaponEquipment &&
        (!this.isMobile() || (equipment.ranges?.[2] ?? 0) > 1) &&
        !equipment.hasAnyFlag(['F_AMS', 'F_AMS_BAY', 'F_B_POD', 'F_AP_POD']) &&
        !this.equipmentDesign().get(mount.mountId)?.automated
      )
        gunners += buildingCapitalWeapon(equipment) ? 7 : equipment.isInfantryWeapon() ? 1 : Math.ceil(tons / 5);
    }
    const officers =
      crew + gunners > 0 && (this.isMobile() || [2, 3, 4].includes(this.buildingClass() ?? 0) || this.buildingOptions().civilianOfficers)
        ? Math.max(1, Math.ceil((crew + gunners) / 10))
        : 0;
    return { crew, gunners, officers, total: crew + gunners + officers };
  });
  readonly baySpace = signal<ReadonlyMap<string, readonly BuildingSpace[]>>(new Map());
  readonly isCastleBrian = computed(() => this.buildingClass() === 4);
  readonly isBridge = computed(() => this.buildingClass() === 8);
  readonly usesHexsides = computed(() => this.buildingClass() === 6 || this.buildingClass() === 7);
  readonly hasNoInterior = computed(() => [5, 7, 8].includes(this.buildingClass() ?? 0));
  readonly cfScale = computed(() => (this.isCastleBrian() ? 10 : 1));
  readonly hasEnvironmentalSealing = computed(() => this.isCastleBrian() || (this.isMobile() && this.motiveType() === 'Submarine') || this.buildingOptions().sealing);
  readonly mapLevels = computed(() =>
    this.isBridge()
      ? [...new Set(this.coordinates().map((hex) => this.deckLevel(hex)))].sort((a, b) => b - a)
      : Array.from({ length: this.height() ?? 1 }, (_, index) => (this.height() ?? 1) - 1 - index),
  );

  /** Floor numbering only; storage, placement rules, and bridge decks keep their native indices. */
  readonly baseLevel = computed(() => {
    if (this.isBridge()) return 0;
    if (this.isMobile()) return this.motiveType() === 'Tracked' ? 2
      : ['Naval', 'Submarine'].includes(this.motiveType()) ? -Math.ceil((this.height() ?? 1) / 2) : 0;
    const options = this.buildingOptions();
    return options.baseLevel ?? (options.site === 'SURFACE' ? 0 : -(this.height() ?? 1) - options.depth);
  });

  levelLabel(level: number, compact = false): string {
    const displayed = this.baseLevel() + level;
    return displayed === 0 ? (compact ? 'G' : 'Ground') : String(displayed);
  }

  roofLevelLabel(level: number, compact = false, hex?: BuildingHex): string {
    const label = this.levelLabel(level, compact);
    return level === (hex ? this.hexHeight(hex) : this.height()) ? `Roof (${label})` : label;
  }

  sideMask(hex: BuildingHex): number {
    return this.wallSides().get(buildingHexKey(hex)) ?? 1;
  }
  hasSide(hex: BuildingHex, side: number): boolean {
    return (this.sideMask(hex) & (1 << side)) !== 0;
  }
  deckLevel(hex: BuildingHex): number {
    return this.bridgeDecks().get(buildingHexKey(hex)) ?? 0;
  }
  segmentsInHex(hex: BuildingHex): number {
    return this.usesHexsides() ? [0, 1, 2, 3, 4, 5].filter((side) => this.sideMask(hex) & (1 << side)).length : 1;
  }
  occupiesMapLevel(hex: BuildingHex, level: number): boolean {
    return this.isBridge() ? this.deckLevel(hex) === level : level >= 0 && level < this.hexHeight(hex);
  }
  capacityInHex(hex: BuildingHex): number {
    return this.capacityPerHex() * this.segmentsInHex(hex);
  }

  displayHex(hex: BuildingHex): string {
    return this.displayGrid().label(hex);
  }

  displayLocation(location: string, compact = false): string {
    const parsed = parseBuildingLocation(location);
    return parsed
      ? `${this.displayHex(parsed.hex)}/${this.levelLabel(this.isBridge() ? this.deckLevel(parsed.hex) : parsed.floor, compact)}`
      : location;
  }

  readonly limits = computed(() => this.constructionLimits(this.buildingType() ?? 2, this.buildingClass() ?? 0));
  readonly capacityPerHex = computed(() => {
    if (this.hasNoInterior()) return 0;
    const height = this.height() ?? 1;
    let capacity = (this.constructionFactor() ?? 0) * this.cfScale() * height;
    if (this.buildingClass() === 1) capacity = Math.min(capacity * 3, (this.isMobile() ? 300 : 600) * Math.ceil(height / 4));
    if (this.buildingOptions().openSpace) capacity = Math.min(600, capacity);
    return this.buildingOptions().heavyMetal ? Math.floor(capacity * 0.75) : capacity;
  });
  readonly hexLoads = computed(() => this.coordinates().map((hex) => calculateBuildingHexWeight(this, hex)));
  readonly powerSupply = computed(() => {
    if (this.isMobile()) return { external: false, nuclear: ['FUSION', 'FISSION'].includes(this.mobilePowerSystem()),
      provided: this.mobileSystems().power, required: this.mobileSystems().power, label: MOBILE_POWER_SYSTEMS[this.mobilePowerSystem()].label };
    const generators = this.equipment().filter(
      (mount) => mount.allocation.kind === 'location' && mount.equipment?.hasFlag('F_POWER_GENERATOR'),
    );
    const nuclear = generators.some((mount) => powerGeneratorDefinition(mount.equipment)?.nuclear);
    const provided = generators.reduce(
      (total, mount) =>
        total + (mount.size ?? 1) / (powerGeneratorDefinition(mount.equipment)?.buildingWeightMultiplier ?? Infinity),
      0,
    );
    const energyWeapons = this.equipment().reduce((total, mount) => {
      const eq = mount.equipment;
      const tons = mount.getTonnage(this) ?? 0;
      return (
        total +
        (mount.allocation.kind === 'location' &&
        eq instanceof WeaponEquipment &&
        eq.hasFlag('F_ENERGY') &&
        !eq.isInfantryWeapon() &&
        tons >= 0.25
          ? tons
          : 0)
      );
    }, 0);
    const required =
      this.hasNoInterior() || this.usesHexsides()
        ? 0
        : this.coordinates().length * (this.height() ?? 1) + energyWeapons / 10;
    return {
      external: !generators.length,
      nuclear,
      provided,
      required,
      label:
        required === 0
          ? 'NA'
          : generators.length
            ? [...new Set(generators.map((mount) => mount.equipment?.name ?? mount.equipmentId))].join(', ')
            : 'External',
    };
  });

  getEquipmentInHex(hex: BuildingHex) {
    const key = buildingHexKey(hex);
    return this.equipment().filter((mount) =>
      this.equipmentPositions(mount).some((position) => buildingHexKey(position.hex) === key),
    );
  }

  equipmentPositions(mount: EntityMountedEquipment): readonly BuildingLocation[] {
    const anchor = mount.allocation.kind === 'location' ? parseBuildingLocation(mount.location) : null;
    return !anchor
      ? []
      : this.equipmentDesign().get(mount.mountId)?.positions.length
        ? this.equipmentDesign().get(mount.mountId)!.positions
        : [anchor];
  }

  equipmentWeightInHex(mount: EntityMountedEquipment, hex: BuildingHex): number {
    const positions = this.equipmentPositions(mount);
    const tons = positions.length
      ? ((mount.getTonnage(this) ?? 0) *
          positions.filter((position) => buildingHexKey(position.hex) === buildingHexKey(hex)).length) /
          positions.length
      : 0;
    return this.isMobile() && positions.length > 1 ? Math.ceil(tons * 2) / 2 : tons;
  }

  baySpaces(bay: EntityTransportBay): readonly BuildingSpace[] {
    const authored = this.baySpace().get(bay.id);
    if (authored) return authored;
    const locations = this.locationOrder
      .map(parseBuildingLocation)
      .filter(
        (position): position is BuildingLocation =>
          !!position && (!this.buildingOptions().openSpace || position.floor === 0),
      );
    return locations.map((position) => ({ position, tons: getBayConstructionWeight(bay) / locations.length }));
  }

  protected override computeTonnage(): number {
    const total = this.coordinates().reduce((sum, hex) => sum + this.capacityInHex(hex), 0);
    return this.buildingOptions().openSpace ? Math.min(this.buildingOptions().heavyMetal ? 450 : 600, total) : total;
  }

  override unitType(): UnitType {
    return 'Building';
  }

  override unitSubtype(): UnitSubtype {
    return this.isMobile() ? 'Mobile Structure' : 'Building';
  }

  override computeRunMP(options: MovementCalculationOptions): number {
    return this.isMobile() ? this.computeWalkMP(options) : super.computeRunMP(options);
  }

  get locationOrder(): readonly string[] {
    return this.equipmentLocations();
  }

  get validLocations(): ReadonlySet<string> {
    return new Set(this.equipmentLocations());
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  protected override computeExpectedEngineRating(): number | null {
    return null;
  }

  protected override computeWeightClass(): WeightClass {
    return 'Medium';
  }

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    const constructionFactor = this.constructionFactor();
    if (constructionFactor === undefined || this.locationOrder.length === 0) return new Map();
    return new Map(this.locationOrder.map((location) => [location, constructionFactor]));
  }

  protected override computeMaxArmor(structureValues: Map<string, number>): Map<string, number> {
    const factor = this.isCastleBrian() ? 2 : [2, 3, 6].includes(this.buildingClass() ?? 0) ? 1 : 0;
    return new Map([...structureValues].map(([location, value]) => [location, factor * value]));
  }

  protected override computeMaximumArmorPoints(): number {
    return this.totalMaxArmor();
  }

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const messages: EntityValidationMessage[] = [];
    messages.push(...buildingDesignValidation(this));
    if (this.isMobile()) messages.push(...mobileStructureValidation(this));
    if (!this.usesHexsides() && buildingConnectedComponents(this.coordinates()).length > 1)
      messages.push({
        severity: this.isMobile() ? 'error' : 'warning',
        message: 'The building footprint contains disconnected sections.',
        category: 'structure',
        code: 'BUILDING_DISCONNECTED',
      });
    const add = (
      code: string,
      message: string,
      category: EntityValidationMessage['category'] = 'structure',
      location?: string,
    ) => messages.push({ severity: 'error', code, message, category, location });
    if (this.crewCount() !== null && (!Number.isSafeInteger(this.crewCount()) || this.crew() < this.buildingCrew().total))
      add('BUILDING_CREW', `Crew must be a whole number of at least ${this.buildingCrew().total}.`);
    const limits = this.limits(),
      cf = this.constructionFactor() ?? 0,
      height = this.height() ?? 1;
    if (!limits)
      add('BUILDING_CLASS_TYPE', `This type/class combination is outside the ${this.isMobile() ? 'mobile' : 'static'} building construction table.`);
    else {
      if (cf < limits.minimumCF || cf > limits.maximumCF)
        add('BUILDING_CF', `CF must be between ${limits.minimumCF} and ${limits.maximumCF}.`);
      const halve = this.buildingOptions().site === 'UNDERGROUND' && !this.isCastleBrian();
      const hexes = halve ? Math.ceil(limits.hexes / 2) : limits.hexes;
      const levels = halve ? Math.ceil(limits.levels / 2) : limits.levels;
      if (this.coordinates().length > hexes || height > levels)
        add(
          'BUILDING_SIZE',
          `Maximum size is ${Number.isFinite(hexes) ? hexes : 'unlimited'} hexes and ${levels} levels.`,
        );
    }
    const infantryAllowed = this.isMobile() || [0, 1, 6].includes(this.buildingClass() ?? 0);
    const options = this.buildingOptions();
    if (this.hasNoInterior() && (this.equipment().length || this.transporters().length))
      add('BUILDING_NO_INTERIOR', 'Tents, fences and bridges cannot install equipment or bays.', 'equipment');
    if (options.openSpace && !this.isCastleBrian() && !(this.isMobile() && this.buildingClass() === 1))
      add('BUILDING_OPEN_SPACE', 'Open-space construction requires Castles Brian or a Hangar Mobile Structure (Large Portal).');
    if (options.heavyMetal && ![3, 4].includes(this.buildingType() ?? 0))
      add('BUILDING_HEAVY_METAL', 'Heavy-metal superstructure requires Heavy or Hardened construction.');
    if (options.ceiling !== 'STANDARD' && ![0, 2, 4].includes(this.buildingClass() ?? 0))
      add('BUILDING_CEILINGS', 'High/low ceilings require Standard, Fortress or Castles Brian construction.');
    if (options.sealing && (this.hasNoInterior() || this.usesHexsides()))
      add('BUILDING_SEALING', 'This classification has no enclosed interior to seal.');
    if (options.site !== 'SURFACE' && (![0, 1, 2, 4].includes(this.buildingClass() ?? 0) || options.depth < 1))
      add(
        'BUILDING_SUBSURFACE',
        'Subsurface construction requires cover and a Standard, Hangar, Fortress or Castles Brian building.',
      );
    if (options.site === 'UNDERWATER' && (!this.hasEnvironmentalSealing() || options.depth + height > cf))
      add('BUILDING_UNDERWATER', 'Underwater construction requires sealing and a total depth no greater than CF.');
    if (
      this.isBridge() &&
      this.coordinates().some(
        (hex) =>
          this.deckLevel(hex) < 0 ||
          buildingNeighbors(hex).some(
            (other) =>
              this.coordinates().some((candidate) => buildingHexKey(candidate) === buildingHexKey(other)) &&
              Math.abs(this.deckLevel(hex) - this.deckLevel(other)) > 1,
          ),
      )
    )
      add('BUILDING_BRIDGE_SLOPE', 'Bridge decks may change at most one level per hex.');
    if (this.isBridge()) {
      const span = buildingBridgeSpan(this.coordinates());
      if (span) {
        const expected = buildingBridgeLevels(span, this.deckLevel(span.start), this.deckLevel(span.end));
        if (this.coordinates().some((hex) => this.deckLevel(hex) !== expected.get(buildingHexKey(hex))))
          add(
            'BUILDING_BRIDGE_LINEAR_SLOPE',
            'Bridge elevations must follow one steady linear slope between endpoints, rounded per hex.',
          );
      }
    }
    if (this.usesHexsides()) {
      if (!this.coordinates().some((hex) => this.segmentsInHex(hex)))
        add('BUILDING_WALL_SIDES', 'Select at least one wall/fence hexside.');
      for (const hex of this.coordinates())
        for (const [side, neighbor] of buildingNeighbors(hex).entries()) {
          if (
            this.sideMask(hex) & (1 << side) &&
            this.coordinates().some((other) => buildingHexKey(other) === buildingHexKey(neighbor)) &&
            this.sideMask(neighbor) & (1 << ((side + 3) % 6))
          )
            add('BUILDING_DUPLICATE_SIDE', 'A shared wall/fence hexside must be drawn only once.');
        }
    }
    let energyHeat = 0,
      cooling = 0;
    const infantryCounts = new Map<string, number>();
    for (const mount of this.equipment()) {
      const eq = mount.equipment;
      if (
        options.openSpace &&
        (this.equipmentPositions(mount).some((position) => position.floor !== 0) ||
          mount.turretType === 'sponson' ||
          buildingRoofFacility(eq))
      )
        add(
          'BUILDING_OPEN_SPACE_EQUIPMENT',
          'Open-space equipment belongs on the lowest floor; rooftop equipment is not allowed.',
          'equipment',
          mount.location,
        );
      if (mount.allocation.kind !== 'location' || !this.validLocations.has(mount.location)) {
        add(
          'BUILDING_EQUIPMENT_LOCATION',
          `${mount.displayName()} has no valid hex/level.`,
          'equipment',
          mount.location,
        );
        continue;
      }
      if (eq?.hasFlag('F_DOUBLE_HEAT_SINK')) cooling += 2;
      else if (eq?.hasFlag('F_HEAT_SINK')) cooling++;
      if (eq instanceof AmmoEquipment && (mount.getAmmoShots()! < 0 || mount.getAmmoShots()! > eq.shots))
        add('BUILDING_AMMO_CAPACITY', `${eq.name} permits 0–${eq.shots} shots per bin.`, 'equipment', mount.location);
      if (!(eq instanceof WeaponEquipment)) continue;
      if (eq.isInfantryWeapon()) infantryCounts.set(mount.location, (infantryCounts.get(mount.location) ?? 0) + 1);
      else if (eq.hasFlag('F_ENERGY')) energyHeat += eq.heat;
      if (eq.capital || eq.subCapital) {
        if (this.buildingClass() !== 2 && !this.isCastleBrian())
          add(
            'BUILDING_CAPITAL_WEAPON',
            'Capital weapons require a Fortress or Castles Brian.',
            'equipment',
            mount.location,
          );
        if (!eq.hasFlag('F_MISSILE') && !this.powerSupply().nuclear)
          add(
            'BUILDING_CAPITAL_POWER',
            'Non-missile capital weapons require fusion or fission power.',
            'engine',
            mount.location,
          );
        if (mount.turretType === 'sponson' || mount.turretType === 'pintle')
          add(
            'BUILDING_CAPITAL_MOUNT',
            'Capital weapons cannot be turret or pintle mounted.',
            'equipment',
            mount.location,
          );
      }
      if (mount.turretType === 'pintle' && !eq.isInfantryWeapon())
        add('BUILDING_PINTLE', 'Pintles can mount only infantry weapons.', 'equipment', mount.location);
      if (mount.turretType === 'sponson' && parseBuildingLocation(mount.location)?.floor !== this.hexHeight(parseBuildingLocation(mount.location)!.hex) - 1)
        add('BUILDING_ROOF_TURRET', 'Roof turret weapons must be on the highest level.', 'equipment', mount.location);
    }
    for (const [location, count] of infantryCounts)
      if (count > (infantryAllowed ? 6 * this.segmentsInHex(parseBuildingLocation(location)!.hex) : 0))
        add(
          'BUILDING_INFANTRY_WEAPONS',
          !infantryAllowed
            ? 'This classification cannot mount infantry weapons.'
            : 'At most six infantry weapons are allowed per hex/level (per hexside for walls).',
          'equipment',
          location,
        );
    const power = this.powerSupply();
    if (!power.external && power.provided + 0.00001 < power.required)
      add('BUILDING_POWER', 'The installed generators do not meet the building’s power requirements.', 'engine');
    if (!power.nuclear && energyHeat > cooling)
      add(
        'BUILDING_COOLING',
        `Energy weapons require heat sinks dissipating ${energyHeat} heat with this power supply.`,
        'heat',
      );
    // Unresolved equipment is reported by the base validator and construction mass check.
    if (this.equipment().every((mount) => mount.equipment && mount.getTonnage(this) !== undefined)) {
      for (const load of this.hexLoads()) {
        const location = buildingLocationName(load.hex, 0);
        if (load.exact > this.capacityInHex(load.hex) + 0.00001)
          add(
            'BUILDING_HEX_CAPACITY',
            `Hex ${this.displayHex(load.hex)} exceeds its ${this.capacityInHex(load.hex)} t carrying capacity.`,
            'weight',
            location,
          );
        const equipment = this.getEquipmentInHex(load.hex);
        const capital = equipment.filter(
          (mount) =>
            mount.equipment instanceof WeaponEquipment && (mount.equipment.capital || mount.equipment.subCapital),
        );
        if (capital.filter((mount) => !mount.equipment!.hasFlag('F_MISSILE')).length > 1)
          add(
            'BUILDING_CAPITAL_COUNT',
            `Hex ${this.displayHex(load.hex)} may mount only one non-missile capital weapon.`,
            'equipment',
            location,
          );
        if (
          capital.length &&
          equipment.some((mount) => mount.turretType === 'sponson' || mount.turretType === 'pintle')
        )
          add(
            'BUILDING_CAPITAL_ROOF',
            `Hex ${this.displayHex(load.hex)} cannot combine capital weapons with roof turrets or pintles.`,
            'equipment',
            location,
          );
        const heavy = equipment.reduce((total, mount) => {
          const tons = this.equipmentWeightInHex(mount, load.hex);
          return (
            total +
            (mount.equipment instanceof WeaponEquipment &&
            !mount.equipment.isInfantryWeapon() &&
            !mount.equipment.capital &&
            !mount.equipment.subCapital &&
            (mount.getTonnage(this) ?? 0) >= (this.isMobile() ? .5 : .25)
              ? tons
              : 0)
          );
        }, 0);
        const limit =
          this.buildingClass() === 3
            ? Math.floor(cf / 3)
            : this.buildingClass() === 2
              ? (cf * height) / 10
              : this.isCastleBrian()
                ? cf * height
                : 0;
        if (heavy > limit + 0.00001)
          add(
            'BUILDING_HEAVY_WEAPONS',
            `Hex ${this.displayHex(load.hex)} exceeds its ${limit} t heavy-weapon limit.`,
            'equipment',
            location,
          );
      }
    }
    return messages;
  });
}
