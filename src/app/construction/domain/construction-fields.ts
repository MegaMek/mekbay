// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILDING_CLASSES, BUILDING_TYPES, buildingHexKey, buildingLimits } from '../../models/entity/types/building';
import { setConstructionBuildingTopology } from './construction-building-topology';
import {
  MOBILE_MOTIVE_TYPES,
  MOBILE_POWER_SYSTEMS,
  mobileMaximumMP,
  type MobilePowerSystem,
} from '../../models/entity/entities/misc/mobile-structure-rules';
import { normalizeMulId } from '../../models/entity/utils/mul-id';
import type { WritableSignal } from '@angular/core';
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { FACTION_DATA, type FactionCode } from '../../models/entity/types/faction';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { COCKPIT_DATA } from '../../models/entity/components/cockpit-data';
import { GYRO_DATA } from '../../models/entity/components/gyro-data';
import {
  ENGINE_DATA,
  MountedEngine,
  DROPSHIP_COLLAR_TECH,
  getSupportComponentTech,
  getAeroCockpitTechAdvancement,
  getAerospaceFighterConstructionTech,
  getBattleArmorConstructionTech,
  getIndustrialAdvancedFireControlTech,
  getLamConstructionTech,
  getMekConstructionTech,
} from '../../models/entity/components';
import type { CockpitType, EngineType, MotiveType, TechRatingSource } from '../../models/entity/types';
import {
  constructionEquipmentEligibilityIssues,
  constructionMyomerEquipment,
  setConstructionMyomer,
  setConstructionOmni,
  setConstructionTechBase,
} from './construction-rules';
import { constructionTechnologyEligibility } from './construction-technology-rules';
import { calculateHeatNeutralRequirement } from '../../models/entity/utils/cost/common';
import {
  constructionInfantryPrimaryApplies,
  constructionInfantrySecondaryLimit,
} from './construction-infantry-ba-rules';
import {
  constructionBattleArmorChassisApplies,
  constructionCockpitApplies,
  constructionEngineCompatible,
  constructionGyroApplies,
  constructionGyroTechnology,
  constructionMotiveCompatible,
  constructionSupportEngineRatingApplies,
  constructionOmniApplies,
  constructionFullHeadEjectionApplies,
  constructionOmniWeaponRemovesArmActuators,
} from './construction-system-rules';
import {
  AeroEntity,
  BattleArmorEntity,
  ConvFighterEntity,
  DropShipEntity,
  InfantryEntity,
  JumpShipEntity,
  LamEntity,
  MekEntity,
  ProtoMekEntity,
  SmallCraftEntity,
  SpaceStationEntity,
  StaticEmplacementEntity,
  VehicleEntity,
} from '../../models/entity/entities';

export type ConstructionFieldValue = string | number | boolean | null;
export interface ConstructionField {
  readonly id: string;
  readonly label: string;
  readonly group: 'Chassis' | 'Systems' | 'Movement' | 'Crew' | 'Special';
  readonly kind: 'text' | 'number' | 'select' | 'boolean';
  readonly get: () => ConstructionFieldValue;
  readonly set: (value: ConstructionFieldValue) => void;
  readonly options?: readonly { value: string | number; label: string; disabled?: boolean }[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly hint?: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
}

/** Explicit bindings keep designer inputs separate from parsed/runtime/derived signals. */
export function getConstructionFields(entity: BaseEntity, showIncompatible = false): ConstructionField[] {
  const fields: ConstructionField[] = [];
  type Group = ConstructionField['group'];
  const text = (id: string, label: string, input: WritableSignal<string>, group: Group = 'Chassis') => {
    fields.push({ id, label, group, kind: 'text', get: input, set: (value) => input.set(String(value)) });
  };
  const number = (
    id: string,
    label: string,
    get: () => number,
    set: (value: number) => void,
    group: Group = 'Systems',
    min = 0,
    max?: number,
    step = 1,
  ) => {
    fields.push({
      id,
      label,
      group,
      kind: 'number',
      get,
      set: (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < min || (max !== undefined && numeric > max)) {
          throw new Error(`${label} must be between ${min} and ${max ?? 'the available capacity'}.`);
        }
        if (Number.isInteger(step) && !Number.isInteger(numeric)) throw new Error(`${label} must be a whole number.`);
        if (min === -1 && numeric < 0 && numeric !== -1)
          throw new Error(`${label} must be -1 for automatic calculation or zero or greater.`);
        set(numeric);
      },
      min,
      max,
      step,
    });
  };
  const boolean = (
    id: string,
    label: string,
    input: WritableSignal<boolean>,
    group: Group = 'Special',
    options: { set?: (value: boolean) => void; compatible?: () => boolean; hint?: string } = {},
  ) => {
    const compatible = options.compatible ?? (() => true);
    fields.push({
      id,
      label,
      group,
      kind: 'boolean',
      get: input,
      disabled: !input() && !compatible(),
      invalid: input() && !compatible(),
      hint: options.hint,
      set: (value) => {
        const enabled = value === true || value === 'true';
        if (enabled && !compatible()) throw new Error(options.hint ?? `${label} is incompatible with this design.`);
        (options.set ?? input.set)(enabled);
      },
    });
  };
  const technologyAllowed = (source: TechRatingSource) => {
    const result = constructionTechnologyEligibility(entity, source);
    return result.techBase && result.available && result.rulesLevel;
  };
  const select = <T extends string | number>(
    id: string,
    label: string,
    get: () => T,
    set: (value: T) => void,
    choices: readonly T[],
    group: Group = 'Systems',
    compatible: (value: T) => boolean = () => true,
    format: (value: T) => string = (value) =>
      id === 'rulesLevel'
        ? ['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'][Number(value) - 1]
        : id === 'techBase' && value === 'IS'
          ? 'Inner Sphere'
          : String(value),
  ) => {
    const current = get();
    const options = [...new Set([...choices, current])]
      .map((value) => ({ value, compatible: choices.includes(value) && compatible(value) }))
      .filter((option) => option.compatible || showIncompatible || option.value === current)
      .map((option) => ({
        value: option.value,
        label: `${format(option.value)}${option.compatible ? '' : ' (incompatible)'}`,
        disabled: !option.compatible,
      }));
    fields.push({
      id,
      label,
      group,
      kind: 'select',
      get,
      options,
      invalid: options.find((option) => option.value === current)?.disabled ?? false,
      set: (value) => {
        const choice = choices.find((option) => String(option) === String(value));
        if (choice === undefined) throw new Error(`Unknown ${label.toLowerCase()} selection.`);
        if (!compatible(choice)) throw new Error(`${label} is incompatible with this design.`);
        set(choice);
      },
    });
  };

  text('chassis', 'Chassis', entity.chassis);
  text('model', 'Model/Variant', entity.model);
  if (entity instanceof MekEntity) text('clanName', 'Clan name', entity.clanName);
  text('role', 'Role', entity.role);
  fields.push({
    id: 'mulId',
    label: 'MUL ID',
    group: 'Chassis',
    kind: 'number',
    get: entity.mulId,
    set: (value) => entity.mulId.set(normalizeMulId(value === true || value === false ? null : value)),
    min: 1,
    step: 1,
  });
  select(
    'faction',
    'Construction faction',
    entity.faction,
    entity.faction.set,
    Object.keys(FACTION_DATA) as FactionCode[],
    'Chassis',
    undefined,
  );
  number(
    'year',
    'Introduction year',
    entity.year,
    (value) => {
      if (entity.originalBuildYear() > value) throw new Error('Introduction year cannot be earlier than the OEM year.');
      entity.year.set(value);
      if (entity.originalBuildYear() === value) entity.originalBuildYear.set(-1);
    },
    'Chassis',
    1,
    9999,
  );
  fields.push({
    id: 'originalBuildYear',
    label: 'OEM year',
    group: 'Chassis',
    kind: 'number',
    min: 1,
    max: entity.year() - 1,
    get: () => (entity.originalBuildYear() > 0 ? entity.originalBuildYear() : ''),
    set: (value) => {
      if (value === '') {
        entity.originalBuildYear.set(-1);
        return;
      }
      const year = Number(value);
      if (!Number.isInteger(year) || year < 1 || year > entity.year())
        throw new Error('OEM year must be earlier than the introduction year.');
      entity.originalBuildYear.set(year === entity.year() ? -1 : year);
    },
    hint: 'The OEM year is when the unit was first designed or built. The introduction year is when this version was released. Equipment available at any time from the OEM year through the introduction year is allowed, even if it became unavailable later.',
  });
  select(
    'techBase',
    'Tech base',
    entity.techBase,
    (base) => setConstructionTechBase(entity, base),
    ['IS', 'Clan'],
    'Chassis',
  );
  boolean('mixedTech', 'Mixed technology', entity.mixedTech, 'Chassis');
  select('rulesLevel', 'Rules level', entity.rulesLevel, entity.rulesLevel.set, [1, 2, 3, 4, 5], 'Chassis');
  fields.push({
    id: 'manualBV',
    label: 'Manual BV',
    group: 'Chassis',
    kind: 'number',
    get: () => (entity.manualBV() > 0 ? entity.manualBV() : null),
    set: (value) => {
      const bv = Number(value);
      if (!Number.isFinite(bv) || (bv > 0 && !Number.isInteger(bv)))
        throw new Error('Manual BV must be a whole number.');
      entity.manualBV.set(Math.max(0, bv));
    },
    min: 0,
    step: 1,
  });
  if (
    entity instanceof MekEntity ||
    entity instanceof VehicleEntity ||
    (entity instanceof AeroEntity && !entity.isLargeCraft())
  )
    boolean('omni', 'Omni chassis', entity.omni, 'Chassis', {
      set: (value) => setConstructionOmni(entity, value),
      compatible: () => constructionOmniApplies(entity),
      hint: "Omni technology requires a compatible chassis. FrankenMek can't be Omni.",
    });

  const replaceEngine = (changes: Partial<{ type: EngineType; rating: number; techBase: 'IS' | 'Clan' }>) => {
    const old = entity.mountedEngine();
    const next = new MountedEngine({
      type: old.type(),
      rating: old.rating,
      techBase: old.techBase,
      installed: true,
      isSuperHeavy: old.isSuperHeavy,
      baseChassisHeatSinks: old.getBaseChassisHeatSinks(false),
      ...changes,
    });
    if (entity instanceof MekEntity) entity.configureEngine(next);
    else entity.mountedEngine.set(next);
  };
  const mekEngineLimit = (primitive = entity instanceof MekEntity && entity.mountedCockpit().isPrimitive) =>
    primitive || entity.mountedEngine().type() === 'Compact' ? 400 : 500;
  const syncMekEngine =
    entity instanceof MekEntity
      ? (
          walkMP = entity.originalWalkMP(),
          tonnage = entity.tonnage(),
          primitive = entity.mountedCockpit().isPrimitive,
        ) => {
          const rating = entity.calculateEngineRating(walkMP, tonnage, primitive);
          if (rating < 10 || rating > mekEngineLimit(primitive) || rating % 5 !== 0)
            throw new Error(
              `This movement and tonnage require engine rating ${rating}; choose a rating from 10 to ${mekEngineLimit(primitive)} in increments of five.`,
            );
          if (rating !== entity.mountedEngine().rating) replaceEngine({ rating });
        }
      : undefined;
  const mekEngineChoices =
    entity instanceof MekEntity && entity.tonnage() > 0
      ? Array.from({ length: Math.floor(mekEngineLimit() / entity.tonnage()) }, (_, index) => ({
          walkMP: index + 1,
          rating: entity.calculateEngineRating(index + 1),
        })).filter((choice) => choice.rating >= 10 && choice.rating <= mekEngineLimit() && choice.rating % 5 === 0)
      : [];

  if (!(
    entity instanceof InfantryEntity ||
    entity instanceof BattleArmorEntity ||
    entity instanceof StaticEmplacementEntity
  )) {
    number(
      'tonnage',
      'Chassis tonnage',
      entity.tonnage,
      (value) => {
        syncMekEngine?.(entity.originalWalkMP(), value);
        entity.setTonnage(value);
      },
      'Chassis',
      0.001,
      undefined,
      entity instanceof MekEntity ? 5 : entity instanceof ProtoMekEntity ? 1 : 0.5,
    );
  }

  const modes = constructionMotiveTypes(entity);
  if (modes.length > 1)
    select('motiveType', 'Movement system', entity.motiveType, entity.motiveType.set, modes, 'Movement', (value) =>
      constructionMotiveCompatible(entity, value),
    );
  if (!(entity instanceof StaticEmplacementEntity) && entity.entityType !== 'HandheldWeapon') {
    number(
      'walkMP',
      entity instanceof AeroEntity ? 'Safe thrust' : 'Walk / cruise MP',
      entity.originalWalkMP,
      (value) => {
        syncMekEngine?.(value);
        entity.originalWalkMP.set(value);
      },
      'Movement',
      entity instanceof MekEntity ? 1 : 0,
      entity instanceof MekEntity ? mekEngineChoices.at(-1)?.walkMP : undefined,
    );
    if (entity instanceof MekEntity)
      number('jumpMP', 'Declared jump MP', entity.originalJumpMP, entity.originalJumpMP.set, 'Movement');
  }
  if (
    entity instanceof MekEntity ||
    entity instanceof VehicleEntity ||
    (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity))
  ) {
    const engineBase = (type: EngineType) =>
      [
        ...new Set([
          entity.mountedEngine().techBase,
          entity.techBase(),
          ...(entity.mixedTech() ? (['IS', 'Clan'] as const) : []),
        ]),
      ].find((base) => constructionEngineCompatible(entity, type, base));
    select(
      'engineType',
      'Engine',
      () => entity.mountedEngine().type(),
      (value) => replaceEngine({ type: value, techBase: engineBase(value)! }),
      Object.keys(ENGINE_DATA) as EngineType[],
      'Systems',
      (value) => engineBase(value) !== undefined,
    );
    if (entity instanceof MekEntity)
      select(
        'engineRating',
        'Engine rating',
        () => entity.mountedEngine().rating,
        (value) => {
          replaceEngine({ rating: value });
          entity.originalWalkMP.set(mekEngineChoices.find((choice) => choice.rating === value)!.walkMP);
        },
        mekEngineChoices.map((choice) => choice.rating),
        'Systems',
        undefined,
        (value) => {
          const choice = mekEngineChoices.find((choice) => choice.rating === value);
          return choice ? `${value} · ${choice.walkMP} Walk MP` : String(value);
        },
      );
    if (!entity.isSupportVehicle())
      select(
        'engineTechBase',
        'Engine tech base',
        () => entity.mountedEngine().techBase,
        (value) => replaceEngine({ techBase: value }),
        ['IS', 'Clan'],
        'Systems',
        (value) => constructionEngineCompatible(entity, entity.mountedEngine().type(), value),
      );
  }

  if (entity instanceof MekEntity) {
    select(
      'cockpit',
      'Cockpit',
      entity.cockpitType,
      (value) => {
        if (COCKPIT_DATA[value].isPrimitive !== entity.mountedCockpit().isPrimitive)
          syncMekEngine?.(entity.originalWalkMP(), entity.tonnage(), COCKPIT_DATA[value].isPrimitive);
        entity.cockpitType.set(value);
        if (!constructionOmniApplies(entity)) setConstructionOmni(entity, false);
        if (!constructionFullHeadEjectionApplies(entity)) entity.hasFullHeadEjectionSystem.set(false);
        if (entity.gyroType() === 'None' && value !== 'Interface') entity.gyroType.set('Standard');
      },
      Object.keys(COCKPIT_DATA) as CockpitType[],
      'Systems',
      (value) =>
        constructionCockpitApplies(entity, value) &&
        technologyAllowed(COCKPIT_DATA[value].tech) &&
        technologyAllowed(
          getMekConstructionTech({
            primitive: COCKPIT_DATA[value].isPrimitive,
            industrial: entity.isIndustrial(),
            tripod: entity.motiveType() === 'Tripod',
            weightClass: entity.weightClass(),
          }),
        ) &&
        (!entity.isIndustrial() ||
          COCKPIT_DATA[value].isIndustrial ||
          technologyAllowed(getIndustrialAdvancedFireControlTech())),
    );
    select(
      'gyro',
      'Gyro',
      entity.gyroType,
      entity.gyroType.set,
      Object.keys(GYRO_DATA) as (keyof typeof GYRO_DATA)[],
      'Systems',
      (value) => constructionGyroApplies(entity, value) && technologyAllowed(constructionGyroTechnology(entity, value)),
    );
    select(
      'myomer',
      'Myomer',
      entity.myomerType,
      (value) => setConstructionMyomer(entity, value),
      ['Standard', 'Triple Strength', 'Industrial Triple Strength', 'Super-Cooled'],
      'Systems',
      (value) => value === 'Standard' || constructionMyomerEquipment(entity, value) !== undefined,
    );
    const installedSink = entity.heatSinkEquipment();
    const sinks = [
      ...new Map(
        [
          ...Object.values(entity.getEquipmentRegistry().equipment).filter(
            (item): item is MiscEquipment =>
              item instanceof MiscEquipment &&
              item.isHeatSink &&
              (!item.isCompactHeatSink || item.heatSinkUnitsPerMount === 1),
          ),
          ...(installedSink ? [installedSink] : []),
        ].map((item) => [item.id, item]),
      ).values(),
    ];
    if (sinks.length) {
      select(
        'heatSinkType',
        'Heat sink type',
        () => entity.heatSinkEquipment()?.id ?? '',
        (value) =>
          entity.configureHeatSinks(
            sinks.find((eq) => eq.id === value)!,
            entity.heatSinkCount(),
          ),
        sinks.map((eq) => eq.id),
        'Systems',
        (value) => {
          const sink = sinks.find((eq) => eq.id === value);
          return !!sink && constructionEquipmentEligibilityIssues(entity, sink).length === 0;
        },
        (value) => sinks.find((eq) => eq.id === value)?.name ?? value,
      );
      number('heatSinkCount', 'Heat sinks', entity.heatSinkCount, (value) => {
        const sink = entity.heatSinkEquipment() ?? sinks[0];
        entity.configureHeatSinks(sink, value);
      });
    }
    boolean('fullHeadEjection', 'Full-head ejection system', entity.hasFullHeadEjectionSystem, 'Special', {
      compatible: () => constructionFullHeadEjectionApplies(entity),
      hint: 'Full-head ejection is incompatible with torso-mounted cockpits and command consoles.',
    });
    boolean('riscHeatSinkOverride', 'RISC heat sink override', entity.hasRiscHeatSinkOverrideKit);
    if (entity instanceof MekWithArmsEntity) {
      for (const side of ['left', 'right'] as const) {
        for (const [id, label, signal] of [
          ['LowerArm', 'lower arm actuator', entity.hasLowerArmActuator],
          ['Hand', 'hand actuator', entity.hasHandActuator],
        ] as const)
          fields.push({
            id: `${side}${id}`,
            label: `${side === 'left' ? 'Left' : 'Right'} ${label}`,
            group: 'Systems',
            kind: 'boolean',
            get: () => signal()[side],
            disabled:
              (id === 'LowerArm' && entity.chassisConfig === 'LAM' && signal()[side]) ||
              (!signal()[side] &&
                entity.omni() &&
                entity
                  .getEquipmentAtLocation(side === 'left' ? 'LA' : 'RA')
                  .some((mount) => mount.equipment && constructionOmniWeaponRemovesArmActuators(mount.equipment))),
            set: (value) => {
              const enabled = value === true || value === 'true';
              if (!enabled && id === 'LowerArm' && entity.chassisConfig === 'LAM')
                throw new Error('LAMs require both lower arm actuators.');
              if (
                enabled &&
                entity.omni() &&
                entity
                  .getEquipmentAtLocation(side === 'left' ? 'LA' : 'RA')
                  .some((mount) => mount.equipment && constructionOmniWeaponRemovesArmActuators(mount.equipment))
              )
                throw new Error(
                  'Omni arm-mounted Gauss rifles, autocannons and PPCs require removal of the hand and lower arm actuators.',
                );
              signal.update((current) => ({ ...current, [side]: enabled }));
              if (!enabled && id === 'LowerArm')
                entity.hasHandActuator.update((current) => ({ ...current, [side]: false }));
              if (enabled && id === 'Hand')
                entity.hasLowerArmActuator.update((current) => ({ ...current, [side]: true }));
            },
          });
      }
    }
  }
  if (entity instanceof LamEntity)
    select(
      'lamType',
      'Conversion system',
      entity.lamType,
      entity.lamType.set,
      ['Standard', 'Bimodal'],
      'Systems',
      (value) => technologyAllowed(getLamConstructionTech(value === 'Bimodal' ? 'Bimodal' : 'Standard')),
    );
  if (entity instanceof VehicleEntity) {
    boolean('turret', 'Turret', entity.hasTurret, 'Chassis', {
      set: (value) => {
        entity.hasTurret.set(value);
        if (!value) entity.hasDualTurret.set(false);
      },
    });
    if (!['VTOL', 'SupportVTOL', 'LargeSupportTank'].includes(entity.entityType))
      fields.push({
        id: 'dualTurret',
        label: 'Second turret',
        group: 'Chassis',
        kind: 'boolean',
        get: entity.hasDualTurret,
        set: (value) => {
          const enabled = value === true || value === 'true';
          entity.hasDualTurret.set(enabled);
          if (enabled) entity.hasTurret.set(true);
        },
      });
    boolean('trailer', 'Trailer', entity.isTrailer, 'Chassis', {
      set: (value) => {
        entity.isTrailer.set(value);
        if (!value) entity.hasNoControlSystems.set(false);
      },
    });
    boolean('noControlSystems', 'No control systems', entity.hasNoControlSystems, 'Special', {
      compatible: () => entity.effectiveIsTrailer(),
      hint: 'Only trailers may omit control systems.',
    });
    number('extraSeats', 'Extra seats', entity.extraSeats, entity.extraSeats.set, 'Crew');
    text('fuelType', 'Fuel type', entity.fuelType, 'Systems');
    if (entity.omni() && entity.hasTurret())
      number(
        'baseTurretMass',
        'Base chassis turret tons',
        entity.baseChassisTurretWeight,
        entity.baseChassisTurretWeight.set,
        'Systems',
        -1,
        undefined,
        0.01,
      );
    if (entity.omni() && entity.hasDualTurret())
      number(
        'baseTurret2Mass',
        'Base chassis second turret tons',
        entity.baseChassisTurret2Weight,
        entity.baseChassisTurret2Weight.set,
        'Systems',
        -1,
        undefined,
        0.01,
      );
    number(
      'baseSponsonMass',
      'Base chassis sponson / pintle tons',
      entity.baseChassisSponsonPintleWeight,
      entity.baseChassisSponsonPintleWeight.set,
      'Systems',
      -1,
      undefined,
      0.01,
    );
  }
  if (entity.isSupportVehicle()) {
    // The existing type guard narrows all five support-family classes.
    const support = entity;
    select(
      'structuralTechRating',
      'Structure tech rating',
      support.structuralTechRating,
      support.structuralTechRating.set,
      [0, 1, 2, 3, 4, 5],
      'Systems',
      (value) => technologyAllowed(getSupportComponentTech(value)),
    );
    select(
      'engineTechRating',
      'Engine tech rating',
      support.engineTechRating,
      support.engineTechRating.set,
      [0, 1, 2, 3, 4, 5],
      'Systems',
      (value) =>
        constructionSupportEngineRatingApplies(entity.mountedEngine().type(), value) &&
        technologyAllowed(getSupportComponentTech(value)),
    );
    if (entity.omni())
      number(
        'baseFireControlMass',
        'Base chassis fire-control tons',
        entity.baseChassisFireConWeight,
        entity.baseChassisFireConWeight.set,
        'Systems',
        -1,
        undefined,
        0.01,
      );
    // BAR comes from the selected BAR armor material. Independent overrides are not a durable design fact.
    if (!(entity instanceof AeroEntity)) number('fuel', 'Fuel', support.fuel, support.fuel.set);
  }
  if (entity instanceof AeroEntity) {
    if (!(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity))
      select(
        'aeroCockpit',
        'Cockpit',
        entity.cockpitType,
        (value) => {
          entity.cockpitType.set(value);
          if (!constructionOmniApplies(entity)) setConstructionOmni(entity, false);
        },
        ['Standard', 'Small', 'Command Console', 'Primitive'],
        'Systems',
        (value) =>
          (!(entity instanceof ConvFighterEntity) || value === 'Standard') &&
          technologyAllowed(getAeroCockpitTechAdvancement(value)) &&
          (entity.entityType !== 'Aero' ||
            technologyAllowed(getAerospaceFighterConstructionTech(value === 'Primitive'))),
      );
    select(
      'heatSinkType',
      'Heat sink type',
      entity.heatSinkType,
      entity.heatSinkType.set,
      ['Single', 'Double'],
      'Systems',
      (value) =>
        value === 'Single' ||
        (!(entity instanceof ConvFighterEntity) &&
          Object.values(entity.getEquipmentRegistry().equipment).some(
            (eq) =>
              eq instanceof MiscEquipment &&
              eq.hasAnyFlag(['F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE']) &&
              !eq.isCompactHeatSink &&
              !eq.hasFlag('F_LASER_HEAT_SINK') &&
              technologyAllowed(eq.tech),
          )),
    );
    if (entity instanceof ConvFighterEntity)
      fields.push({
        id: 'heatSinks',
        label: 'Heat sinks (automatic)',
        group: 'Systems',
        kind: 'number',
        disabled: true,
        get: () => calculateHeatNeutralRequirement(entity),
        set: () => {
          throw new Error('Conventional fighter heat sinks are calculated from the heat-neutral requirement.');
        },
        hint: 'Heat sinks and their mass are calculated from the installed weapons and equipment.',
      });
    else number('heatSinks', 'Heat sinks', entity.heatSinkCount, entity.heatSinkCount.set);
    if (entity.omni() && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity))
      number('omnipodHeatSinks', 'OmniPod heat sinks', entity.omnipodHeatSinkCount, entity.omnipodHeatSinkCount.set);
    if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)
      number('structuralIntegrity', 'Structural integrity', entity.structuralIntegrity, entity.structuralIntegrity.set);
    number('fuel', 'Fuel points', entity.fuel, entity.fuel.set);
  }
  if (entity instanceof ConvFighterEntity) boolean('vstol', 'VSTOL', entity.vstol);
  if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) {
    select('designType', 'Design type', entity.designType, entity.designType.set, ['Civilian', 'Military'], 'Chassis');
    for (const [id, label, signal] of [
      ['crew', 'Crew', entity.crew],
      ['officers', 'Officers', entity.officers],
      ['gunners', 'Gunners', entity.gunners],
      ['passengers', 'Passengers', entity.passengers],
      ['marines', 'Marines', entity.marines],
      ['battleArmor', 'Battle armor personnel', entity.battleArmor],
      ['lifeboats', 'Lifeboats', entity.lifeboats],
      ['escapePods', 'Escape pods', entity.escapePods],
    ] as const)
      number(id, label, signal, signal.set, 'Crew');
  }
  if (entity instanceof SmallCraftEntity)
    number('otherPassengers', 'Other passengers', entity.otherPassenger, entity.otherPassenger.set, 'Crew');
  if (entity instanceof DropShipEntity) {
    select(
      'collarType',
      'Docking collar',
      entity.collarType,
      entity.collarType.set,
      ['Unspecified', 'Standard', 'Prototype', 'No Boom'],
      'Systems',
      (value) => value === 'Unspecified' || value === 'No Boom' || technologyAllowed(DROPSHIP_COLLAR_TECH),
    );
  }
  if (entity instanceof JumpShipEntity) {
    if (entity.entityType === 'WarShip')
      select('driveCore', 'K-F drive core', entity.driveCoreType, entity.driveCoreType.set, [
        'Compact',
        'Subcompact',
        'None',
      ]);
    boolean('sail', 'Solar sail', entity.sail);
    boolean('lithiumFusion', 'Lithium-fusion battery', entity.lithiumFusion);
    boolean('hpg', 'Hyperpulse generator', entity.hpg);
    number('jumpRange', 'Jump range (light-years)', entity.jumpRange, entity.jumpRange.set);
    fields.push({
      id: 'gravDecks',
      label: 'Gravity deck diameters (m, comma separated)',
      group: 'Special',
      kind: 'text',
      get: () => entity.gravDecks().join(', '),
      set: (value) => {
        const values = String(value).trim()
          ? String(value)
              .split(',')
              .map((part) => Number(part.trim()))
          : [];
        if (values.some((v) => !Number.isFinite(v) || v <= 0))
          throw new Error('Enter positive gravity deck diameters.');
        entity.gravDecks.set(values);
      },
    });
  }
  if (entity instanceof SpaceStationEntity)
    boolean('modularAdapter', 'Modular / K-F adapter', entity.modularOrKFAdapter);
  if (entity instanceof ProtoMekEntity) {
    boolean('mainGun', 'Main gun', entity.hasMainGun, 'Chassis');
    fields.push({
      id: 'glider',
      label: 'Glider',
      group: 'Chassis',
      kind: 'boolean',
      get: entity.isGlider,
      set: (value) => {
        const enabled = value === true || value === 'true';
        entity.isGlider.set(enabled);
        if (enabled) entity.isQuad.set(false);
        entity.motiveType.set(enabled ? 'WiGE' : entity.isQuad() ? 'Quad' : 'Biped');
      },
    });
    fields.push({
      id: 'quad',
      label: 'Quad chassis',
      group: 'Chassis',
      kind: 'boolean',
      get: entity.isQuad,
      set: (value) => {
        const enabled = value === true || value === 'true';
        entity.isQuad.set(enabled);
        if (enabled) entity.isGlider.set(false);
        entity.motiveType.set(enabled ? 'Quad' : entity.isGlider() ? 'WiGE' : 'Biped');
      },
    });
    boolean('interfaceCockpit', 'Interface cockpit', entity.interfaceCockpit);
  }
  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) {
    number(
      'squadSize',
      entity instanceof BattleArmorEntity ? 'Troopers' : 'Troopers per squad',
      entity.squadSize,
      entity.squadSize.set,
      'Crew',
      1,
      entity instanceof BattleArmorEntity ? 6 : undefined,
    );
    if (entity instanceof InfantryEntity)
      number('squadCount', 'Squads', entity.squadCount, entity.squadCount.set, 'Crew', 1);
  }
  if (entity instanceof BattleArmorEntity) {
    select(
      'weightClass',
      'Suit weight class',
      entity.declaredWeightClass,
      (value) => {
        entity.declaredWeightClass.set(value);
        if (value !== 'Ultra Light') {
          entity.isExoskeleton.set(false);
          entity.clanExoWithoutHarJel.set(false);
        }
        if (['Heavy', 'Assault'].includes(value) && entity.motiveType() === 'VTOL') {
          entity.motiveType.set('Leg');
          entity.propulsionMP.set(0);
        }
      },
      ['Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault'],
      'Chassis',
      (value) =>
        constructionBattleArmorChassisApplies(entity.chassisType(), value) &&
        technologyAllowed(getBattleArmorConstructionTech(value, entity.isExoskeleton())),
    );
    select(
      'chassisType',
      'Suit chassis',
      entity.chassisType,
      (value) => {
        entity.chassisType.set(value);
        if (value === 'Quad') {
          entity.motiveType.set('Leg');
          entity.propulsionMP.set(0);
        } else entity.turretConfig.set('');
      },
      ['Biped', 'Quad'],
      'Chassis',
      (value) => constructionBattleArmorChassisApplies(value, entity.weightClass()),
    );
    number('propulsionMP', 'Propulsion MP', entity.propulsionMP, entity.propulsionMP.set, 'Movement');
    const turretType = () => entity.turretConfig().split(':')[0] || 'None';
    const turretCapacity = () => Number(entity.turretConfig().split(':')[1] ?? 0);
    select(
      'turretType',
      'Turret type',
      turretType,
      (value) =>
        entity.turretConfig.set(
          value === 'None' ? '' : `${value}:${Math.min(value === 'Modular' ? 9 : 10, Math.max(1, turretCapacity()))}`,
        ),
      ['None', 'Standard', 'Modular'],
      'Systems',
      (value) => value === 'None' || entity.chassisType() === 'Quad',
    );
    if (turretType() !== 'None')
      number(
        'turretCapacity',
        'Turret capacity (slots)',
        turretCapacity,
        (value) => entity.turretConfig.set(`${turretType()}:${value}`),
        'Systems',
        1,
        turretType() === 'Modular' ? 9 : 10,
      );
    boolean('exoskeleton', 'Exoskeleton', entity.isExoskeleton, 'Special', {
      compatible: () => entity.weightClass() === 'Ultra Light',
      set: (value) => {
        entity.isExoskeleton.set(value);
        if (!value) entity.clanExoWithoutHarJel.set(false);
      },
      hint: 'Exoskeletons require ultra-light powered armor.',
    });
    boolean('noHarJel', 'Clan exoskeleton without HarJel', entity.clanExoWithoutHarJel, 'Special', {
      compatible: () => entity.isExoskeleton() && entity.techBase() === 'Clan',
      hint: 'Omitting HarJel requires a Clan exoskeleton.',
    });
  }
  if (entity instanceof InfantryEntity) {
    const weapons = Object.values(entity.getEquipmentRegistry().equipment).filter(
      (eq): eq is WeaponEquipment => eq instanceof WeaponEquipment && eq.isInfantryWeapon(),
    );
    for (const [id, label, signal] of [
      ['primaryWeapon', 'Primary weapon', entity.primaryWeapon],
      ['secondaryWeapon', 'Secondary weapon', entity.secondaryWeapon],
    ] as const) {
      select(
        id,
        label,
        () => signal()?.id ?? '',
        (value) => {
          const weapon = weapons.find((eq) => eq.id === value);
          signal.set(weapon?.isInfantryWeapon() ? weapon : null);
        },
        ['', ...weapons.map((eq) => eq.id)],
        'Systems',
        (value) => {
          if (value === '') return true;
          const weapon = weapons.find((eq) => eq.id === value)!;
          return (
            (id === 'primaryWeapon'
              ? constructionInfantryPrimaryApplies(weapon)
              : constructionInfantrySecondaryLimit(entity) > 0) &&
            constructionEquipmentEligibilityIssues(entity, weapon).length === 0
          );
        },
        (value) => (value ? (weapons.find((eq) => eq.id === value)?.name ?? signal()?.name ?? value) : 'None'),
      );
    }
    if (entity.secondaryWeapon())
      number('secondaryCount', 'Secondary weapons per squad', entity.secondaryCount, entity.secondaryCount.set);
    number(
      'armorDivisor',
      'Armor damage divisor',
      entity.armorDivisor,
      entity.armorDivisor.set,
      'Systems',
      0.1,
      undefined,
      0.1,
    );
    for (const [id, label, signal] of [
      ['encumberingArmor', 'Encumbering armor', entity.encumberingArmor],
      ['spaceSuit', 'Space suits', entity.spaceSuit],
      ['dest', 'DEST', entity.hasDEST],
      ['sneakCamo', 'Sneak camouflage', entity.sneakCamo],
      ['sneakIR', 'Sneak IR', entity.sneakIR],
      ['sneakECM', 'Sneak ECM', entity.sneakECM],
    ] as const)
      boolean(id, label, signal);
    if (entity.motiveType() === 'VTOL') boolean('microlite', 'Microlite', entity.isMicrolite);
    if (entity.motiveType() === 'UMU') boolean('motorizedScuba', 'Motorized SCUBA', entity.isMotorizedScuba);
  }
  if (entity instanceof StaticEmplacementEntity) {
    select(
      'buildingClass',
      'Building class',
      () => entity.buildingClass() ?? 0,
      (value) => {
        const type = entity.constructionLimits(entity.buildingType() ?? 2, value)
          ? (entity.buildingType() ?? 2)
          : [1, 2, 3, 4, 6].find((type) => entity.constructionLimits(type, value))!;
        const limits = entity.constructionLimits(type, value)!;
        entity.buildingClass.set(value);
        entity.buildingType.set(type);
        entity.constructionFactor.set(
          Math.max(limits.minimumCF, Math.min(limits.maximumCF, entity.constructionFactor() ?? 0)),
        );
        setConstructionBuildingTopology(entity, entity.coordinates(), Math.min(entity.height() ?? 1, limits.levels));
      },
      entity.isMobile() ? [0, 1, 2] : Object.keys(BUILDING_CLASSES).map(Number),
      'Systems',
      undefined,
      (value) => BUILDING_CLASSES[value] ?? String(value),
    );
    select(
      'buildingType',
      'Building type',
      () => entity.buildingType() ?? 2,
      entity.buildingType.set,
      [1, 2, 3, 4, 6],
      'Systems',
      (type) => entity.constructionLimits(type, entity.buildingClass() ?? 0) !== null,
      (value) => BUILDING_TYPES[value] ?? String(value),
    );
    if (entity.isMobile()) {
      select(
        'mobile-motive',
        'Motive system',
        entity.motiveType,
        entity.motiveType.set,
        MOBILE_MOTIVE_TYPES,
        'Systems',
        (motive) => motive !== 'VTOL' || entity.buildingClass() !== 2,
      );
      number(
        'mobile-mp',
        'Maximum MP',
        entity.originalWalkMP,
        (value) => {
          if (!Number.isInteger(value * 4)) throw new Error('Maximum MP must use quarter-point increments.');
          entity.originalWalkMP.set(value);
        },
        'Systems',
        0.25,
        mobileMaximumMP(entity.motiveType()),
        0.25,
      );
      select(
        'mobile-power',
        'Power system',
        entity.mobilePowerSystem,
        entity.mobilePowerSystem.set,
        Object.keys(MOBILE_POWER_SYSTEMS) as MobilePowerSystem[],
        'Systems',
        undefined,
        (power) => MOBILE_POWER_SYSTEMS[power].label,
      );
      if (MOBILE_POWER_SYSTEMS[entity.mobilePowerSystem()].fuel)
        number('mobile-range', 'Operating range (km)', entity.operatingRange, entity.operatingRange.set, 'Systems', 0);
    }
    number('building-crew', 'Crew', entity.crew, entity.crewCount.set, 'Systems', 0);
    const crewField = fields.find((field) => field.id === 'building-crew')!;
    fields[fields.indexOf(crewField)] = { ...crewField, disabled: entity.crewCount() === null };
    fields.push({
      id: 'building-auto-crew',
      label: 'Use minimum crew',
      group: 'Systems',
      kind: 'boolean',
      get: () => entity.crewCount() === null,
      set: (value) => entity.crewCount.set(value === true || value === 'true' ? null : entity.crew()),
    });
    number(
      'constructionFactor',
      entity.isCastleBrian()
        ? 'Construction factor (capital points)'
        : entity.usesHexsides()
          ? 'Construction factor per hexside'
          : 'Construction factor',
      () => entity.constructionFactor() ?? 0,
      entity.constructionFactor.set,
    );
    number(
      'height',
      'Floors',
      () => entity.height() ?? 1,
      (value) => setConstructionBuildingTopology(entity, entity.coordinates(), value),
      'Systems',
      1,
    );
    for (const [key, label] of [
      ['sealing', 'Environmental sealing'],
      ['heavyMetal', 'Heavy-metal superstructure'],
      ['openSpace', 'Open-space construction (600 t total, ground equipment only)'],
      ['tunnel', 'Tunnel construction'],
      ['roofClearance', 'Roof clearance inside a larger cave'],
      ['civilianOfficers', 'Officers in a civilian building'],
    ] as const) {
      if (entity.isMobile() && key !== 'sealing' && key !== 'openSpace') continue;
      fields.push({
        id: 'building-' + key,
        label: entity.isMobile() && key === 'openSpace' ? 'Large Portal open-space construction (600 t total)' : label,
        group: 'Special',
        kind: 'boolean',
        get: () => (key === 'sealing' ? entity.hasEnvironmentalSealing() : entity.buildingOptions()[key]),
        disabled:
          key === 'sealing' && (entity.isCastleBrian() || (entity.isMobile() && entity.motiveType() === 'Submarine')),
        set: (value) =>
          entity.buildingOptions.update((options) => ({ ...options, [key]: value === true || value === 'true' })),
      });
    }
    if (!entity.isMobile())
      select(
        'building-ceiling',
        'Ceiling height',
        () => entity.buildingOptions().ceiling,
        (value) => entity.buildingOptions.update((options) => ({ ...options, ceiling: value })),
        ['STANDARD', 'HIGH', 'LOW'],
        'Special',
        (value) => value === 'STANDARD' || [0, 2, 4].includes(entity.buildingClass() ?? 0),
      );
    if (entity.isMobile() && entity.buildingClass() === 1 && entity.buildingOptions().openSpace) {
      for (const [reference, field] of [
        [2, entity.portalHex2],
        [3, entity.portalHex3],
      ] as const) {
        select(
          `mobile-portal-hex${reference}`,
          `Portal equipment template: Hex ${reference}`,
          () => (field() ? buildingHexKey(field()!) : ''),
          (value) => field.set(entity.coordinates().find((hex) => buildingHexKey(hex) === value) ?? null),
          ['', ...entity.coordinates().map(buildingHexKey)],
          'Special',
          undefined,
          (value) =>
            value
              ? entity.displayHex(entity.coordinates().find((hex) => buildingHexKey(hex) === value)!)
              : 'Choose hex',
        );
        fields[fields.length - 1] = {
          ...fields[fields.length - 1],
          hint: 'Identifies the equipment copied into each tunnel section. The rules name Hex 2 and Hex 3 without specifying their positions (TO:AUE p. 76).',
        };
      }
    }
    if (!entity.isMobile())
      select(
        'building-site',
        'Site',
        () => entity.buildingOptions().site,
        (value) => entity.buildingOptions.update((options) => ({ ...options, site: value })),
        ['SURFACE', 'UNDERGROUND', 'UNDERWATER'],
        'Special',
        (value) => value === 'SURFACE' || [0, 1, 2, 4].includes(entity.buildingClass() ?? 0),
      );
    if (entity.buildingOptions().site !== 'SURFACE')
      number(
        'building-depth',
        'Cover depth above roof',
        () => entity.buildingOptions().depth,
        (value) => entity.buildingOptions.update((options) => ({ ...options, depth: value })),
        'Special',
        1,
      );
    const heightField = fields.find((field) => field.id === 'height')!;
    fields[fields.indexOf(heightField)] = {
      ...heightField,
      disabled: entity.isBridge() || entity.buildingClass() === 5 || entity.buildingClass() === 3,
    };
  }
  return fields.map((field) => ({
    ...field,
    set: (value) => {
      field.set(value);
      if (entity instanceof VehicleEntity || entity instanceof ProtoMekEntity) {
        const engine = entity.mountedEngine();
        entity.mountedEngine.set(
          new MountedEngine({
            type: engine.type(),
            rating: entity.calculatedEngineRating(),
            techBase: engine.techBase,
            installed: engine.installed,
          }),
        );
      } else if (
        entity instanceof AeroEntity &&
        !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)
      ) {
        const engine = entity.mountedEngine();
        const basic =
          entity.tonnage() *
          (entity instanceof ConvFighterEntity || entity.isSupportVehicle()
            ? entity.originalWalkMP()
            : entity.originalWalkMP() - 2);
        const rating = entity.isSupportVehicle()
          ? Math.min(500, basic)
          : entity.cockpitType() === 'Primitive'
            ? Math.ceil(Math.round(basic * 1.2) / 5) * 5
            : basic;
        entity.mountedEngine.set(
          new MountedEngine({ type: engine.type(), rating, techBase: engine.techBase, installed: engine.installed }),
        );
        entity.autoSetStructuralIntegrity();
      }
    },
  }));
}

function constructionMotiveTypes(entity: BaseEntity): readonly MotiveType[] {
  if (entity instanceof MekEntity) return entity.chassisConfig === 'QuadVee' ? ['Track', 'Wheel'] : [];
  if (entity instanceof InfantryEntity)
    return ['Leg', 'Motorized', 'Jump', 'UMU', 'Hover', 'Wheeled', 'Tracked', 'VTOL', 'Submarine', 'Beast'];
  if (entity instanceof BattleArmorEntity) return ['Leg', 'Jump', 'VTOL', 'UMU'];
  if (entity instanceof SmallCraftEntity) return ['Aerodyne', 'Spheroid'];
  if (entity.entityType === 'FixedWingSupport') return ['Aerodyne', 'Airship', 'Station Keeping'];
  if (entity.entityType === 'Naval' || entity.entityType === 'SupportNaval') return ['Naval', 'Hydrofoil', 'Submarine'];
  if (entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL') return ['VTOL'];
  if (entity instanceof VehicleEntity)
    return entity.isSupportVehicle()
      ? ['Tracked', 'Wheeled', 'Hover', 'WiGE', 'Rail', 'MagLev']
      : ['Tracked', 'Wheeled', 'Hover', 'WiGE'];
  return [];
}
