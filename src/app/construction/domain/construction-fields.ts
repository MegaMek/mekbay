// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { WritableSignal } from '@angular/core';
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { COCKPIT_DATA } from '../../models/entity/components/cockpit-data';
import { GYRO_DATA } from '../../models/entity/components/gyro-data';
import { ENGINE_DATA, MountedEngine } from '../../models/entity/components';
import type { CockpitType, EngineType, MotiveType } from '../../models/entity/types';
import {
  AeroEntity, BattleArmorEntity, ConvFighterEntity, DropShipEntity, InfantryEntity,
  JumpShipEntity, LamEntity, MekEntity, ProtoMekEntity, SmallCraftEntity,
  SpaceStationEntity, StaticEmplacementEntity, VehicleEntity,
} from '../../models/entity/entities';

export type ConstructionFieldValue = string | number | boolean;
export interface ConstructionField {
  readonly id: string;
  readonly label: string;
  readonly group: 'Chassis' | 'Systems' | 'Movement' | 'Crew' | 'Special';
  readonly kind: 'text' | 'number' | 'select' | 'boolean';
  readonly get: () => ConstructionFieldValue;
  readonly set: (value: ConstructionFieldValue) => void;
  readonly options?: readonly { value: string | number; label: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly hint?: string;
}

/** Explicit bindings keep designer inputs separate from parsed/runtime/derived signals. */
export function getConstructionFields(entity: BaseEntity): ConstructionField[] {
  const fields: ConstructionField[] = [];
  type Group = ConstructionField['group'];
  const text = (id: string, label: string, input: WritableSignal<string>, group: Group = 'Chassis') => {
    fields.push({ id, label, group, kind: 'text', get: input, set: value => input.set(String(value)) });
  };
  const number = (id: string, label: string, get: () => number, set: (value: number) => void,
    group: Group = 'Systems', min = 0, max?: number, step = 1) => {
    fields.push({ id, label, group, kind: 'number', get, set: value => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < min || (max !== undefined && numeric > max)) {
        throw new Error(`${label} must be between ${min} and ${max ?? 'the available capacity'}.`);
      }
      if (Number.isInteger(step) && !Number.isInteger(numeric)) throw new Error(`${label} must be a whole number.`);
      if (min === -1 && numeric < 0 && numeric !== -1) throw new Error(`${label} must be -1 for automatic calculation or zero or greater.`);
      set(numeric);
    }, min, max, step });
  };
  const boolean = (id: string, label: string, input: WritableSignal<boolean>, group: Group = 'Special') => {
    fields.push({ id, label, group, kind: 'boolean', get: input, set: value => input.set(value === true || value === 'true') });
  };
  const select = <T extends string | number>(id: string, label: string, get: () => T,
    set: (value: T) => void, choices: readonly T[], group: Group = 'Systems') => {
    fields.push({ id, label, group, kind: 'select', get, options: choices.map(value => ({ value,
      label: id === 'rulesLevel' ? ['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'][Number(value) - 1]
        : id === 'techBase' && value === 'IS' ? 'Inner Sphere' : String(value) })),
      set: value => {
        const choice = choices.find(option => String(option) === String(value));
        if (choice === undefined) throw new Error(`Unknown ${label.toLowerCase()} selection.`);
        set(choice);
      } });
  };

  text('chassis', 'Chassis', entity.chassis);
  text('model', 'Variant', entity.model);
  text('role', 'Role', entity.role);
  number('year', 'Introduction year', entity.year, entity.year.set, 'Chassis', 1, 9999);
  select('techBase', 'Tech base', entity.techBase, entity.techBase.set, ['IS', 'Clan'], 'Chassis');
  boolean('mixedTech', 'Mixed technology', entity.mixedTech, 'Chassis');
  select('rulesLevel', 'Rules level', entity.rulesLevel, entity.rulesLevel.set, [1, 2, 3, 4, 5], 'Chassis');
  if (entity instanceof MekEntity || entity instanceof VehicleEntity || (entity instanceof AeroEntity && !entity.isLargeCraft())) boolean('omni', 'Omni chassis', entity.omni, 'Chassis');
  if (!(entity instanceof InfantryEntity || entity instanceof BattleArmorEntity || entity instanceof StaticEmplacementEntity)) {
    number('tonnage', 'Chassis tonnage', entity.tonnage, value => entity.setTonnage(value), 'Chassis', 0.001, undefined,
      entity instanceof MekEntity ? 5 : entity instanceof ProtoMekEntity ? 1 : 0.5);
  }

  const modes = constructionMotiveTypes(entity);
  if (modes.length > 1) select('motiveType', 'Movement system', entity.motiveType, entity.motiveType.set, modes, 'Movement');
  if (!(entity instanceof StaticEmplacementEntity) && entity.entityType !== 'HandheldWeapon') {
    number('walkMP', entity instanceof AeroEntity ? 'Safe thrust' : 'Walk / cruise MP', entity.originalWalkMP,
      entity.originalWalkMP.set, 'Movement');
    if (entity instanceof MekEntity) number('jumpMP', 'Declared jump MP', entity.originalJumpMP,
      entity.originalJumpMP.set, 'Movement');
  }
  if (entity instanceof MekEntity || entity instanceof VehicleEntity || (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity))) {
    const replaceEngine = (changes: Partial<{ type: EngineType; rating: number; techBase: 'IS' | 'Clan' }>) => {
      const old = entity.mountedEngine();
      const next = new MountedEngine({ type: old.type(), rating: old.rating, techBase: old.techBase,
        installed: true, isSuperHeavy: old.isSuperHeavy, baseChassisHeatSinks: old.getBaseChassisHeatSinks(false), ...changes });
      if (entity instanceof MekEntity) entity.configureEngine(next); else entity.mountedEngine.set(next);
    };
    select('engineType', 'Engine', () => entity.mountedEngine().type(), value => replaceEngine({ type: value }),
      entity instanceof MekEntity ? ['Fusion', 'XL', 'XXL', 'Light', 'Compact', 'ICE', 'Fuel Cell', 'Fission'] : Object.keys(ENGINE_DATA) as EngineType[]);
    if (entity instanceof MekEntity) number('engineRating', 'Engine rating', () => entity.mountedEngine().rating, value => replaceEngine({ rating: value }), 'Systems', 0, 500, 5);
    select('engineTechBase', 'Engine tech base', () => entity.mountedEngine().techBase, value => replaceEngine({ techBase: value }), ['IS', 'Clan']);
  }

  if (entity instanceof MekEntity) {
    select('cockpit', 'Cockpit', entity.cockpitType, entity.cockpitType.set, Object.keys(COCKPIT_DATA) as CockpitType[]);
    select('gyro', 'Gyro', entity.gyroType, entity.gyroType.set, Object.keys(GYRO_DATA) as (keyof typeof GYRO_DATA)[]);
    select('myomer', 'Myomer', entity.myomerType, entity.myomerType.set, ['Standard', 'Triple Strength', 'Industrial Triple Strength', 'Super-Cooled']);
    const sinks = Object.values(entity.getEquipmentRegistry().equipment).filter((item): item is MiscEquipment =>
      item instanceof MiscEquipment && item.isHeatSink && (!item.isCompactHeatSink || item.heatSinkUnitsPerMount === 1));
    if (sinks.length) {
      fields.push({ id: 'heatSinkType', label: 'Heat sink type', group: 'Systems', kind: 'select',
        get: () => entity.heatSinkEquipment()?.id ?? '', options: sinks.map(eq => ({ value: eq.id, label: eq.name })),
        set: value => { const sink = sinks.find(eq => eq.id === value); if (sink) entity.configureHeatSinks(sink, entity.heatSinkCount()); } });
      number('heatSinkCount', 'Heat sinks', entity.heatSinkCount, value => {
        const sink = entity.heatSinkEquipment() ?? sinks[0]; entity.configureHeatSinks(sink, value);
      });
    }
    boolean('fullHeadEjection', 'Full-head ejection system', entity.hasFullHeadEjectionSystem);
    boolean('riscHeatSinkOverride', 'RISC heat sink override', entity.hasRiscHeatSinkOverrideKit);
    if (entity instanceof MekWithArmsEntity) {
      for (const side of ['left', 'right'] as const) {
        for (const [id, label, signal] of [
          ['LowerArm', 'lower arm actuator', entity.hasLowerArmActuator], ['Hand', 'hand actuator', entity.hasHandActuator],
        ] as const) fields.push({ id: `${side}${id}`, label: `${side === 'left' ? 'Left' : 'Right'} ${label}`,
          group: 'Systems', kind: 'boolean', get: () => signal()[side],
          set: value => signal.update(current => ({ ...current, [side]: Boolean(value) })) });
      }
    }
  }
  if (entity instanceof LamEntity) select('lamType', 'Conversion system', entity.lamType, entity.lamType.set, ['Standard', 'Bimodal']);
  if (entity instanceof VehicleEntity) {
    boolean('turret', 'Turret', entity.hasTurret, 'Chassis');
    if (!['VTOL', 'SupportVTOL', 'LargeSupportTank'].includes(entity.entityType)) fields.push({ id: 'dualTurret', label: 'Second turret', group: 'Chassis', kind: 'boolean', get: entity.hasDualTurret,
      set: value => { entity.hasDualTurret.set(Boolean(value)); if (value) entity.hasTurret.set(true); } });
    boolean('trailer', 'Trailer', entity.isTrailer, 'Chassis');
    boolean('noControlSystems', 'No control systems', entity.hasNoControlSystems);
    number('extraSeats', 'Extra seats', entity.extraSeats, entity.extraSeats.set, 'Crew');
    text('fuelType', 'Fuel type', entity.fuelType, 'Systems');
    if (entity.omni() && entity.hasTurret()) number('baseTurretMass', 'Base chassis turret tons', entity.baseChassisTurretWeight, entity.baseChassisTurretWeight.set, 'Systems', -1, undefined, 0.01);
    if (entity.omni() && entity.hasDualTurret()) number('baseTurret2Mass', 'Base chassis second turret tons', entity.baseChassisTurret2Weight, entity.baseChassisTurret2Weight.set, 'Systems', -1, undefined, 0.01);
    number('baseSponsonMass', 'Base chassis sponson / pintle tons', entity.baseChassisSponsonPintleWeight, entity.baseChassisSponsonPintleWeight.set, 'Systems', -1, undefined, 0.01);
  }
  if (entity.isSupportVehicle()) {
    // The existing type guard narrows all five support-family classes.
    const support = entity;
    select('structuralTechRating', 'Structure tech rating', support.structuralTechRating, support.structuralTechRating.set, [0, 1, 2, 3, 4, 5]);
    select('engineTechRating', 'Engine tech rating', support.engineTechRating, support.engineTechRating.set, [0, 1, 2, 3, 4, 5]);
    if (entity.omni()) number('baseFireControlMass', 'Base chassis fire-control tons', entity.baseChassisFireConWeight, entity.baseChassisFireConWeight.set, 'Systems', -1, undefined, 0.01);
    // BAR comes from the selected BAR armor material. Independent overrides are not a durable design fact.
    if (!(entity instanceof AeroEntity)) number('fuel', 'Fuel', support.fuel, support.fuel.set);
  }
  if (entity instanceof AeroEntity) {
    if (!(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)) select('aeroCockpit', 'Cockpit', entity.cockpitType, entity.cockpitType.set, ['Standard', 'Small', 'Command Console', 'Primitive']);
    select('heatSinkType', 'Heat sink type', entity.heatSinkType, entity.heatSinkType.set, ['Single', 'Double']);
    number('heatSinks', 'Heat sinks', entity.heatSinkCount, entity.heatSinkCount.set);
    if (!(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)) number('omnipodHeatSinks', 'OmniPod heat sinks', entity.omnipodHeatSinkCount, entity.omnipodHeatSinkCount.set);
    if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) number('structuralIntegrity', 'Structural integrity', entity.structuralIntegrity, entity.structuralIntegrity.set);
    number('fuel', 'Fuel points', entity.fuel, entity.fuel.set);
  }
  if (entity instanceof ConvFighterEntity) boolean('vstol', 'VSTOL', entity.vstol);
  if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) {
    select('designType', 'Design type', entity.designType, entity.designType.set, ['Civilian', 'Military'], 'Chassis');
    for (const [id, label, signal] of [
      ['crew', 'Crew', entity.crew], ['officers', 'Officers', entity.officers], ['gunners', 'Gunners', entity.gunners],
      ['passengers', 'Passengers', entity.passengers], ['marines', 'Marines', entity.marines],
      ['battleArmor', 'Battle armor personnel', entity.battleArmor], ['lifeboats', 'Lifeboats', entity.lifeboats],
      ['escapePods', 'Escape pods', entity.escapePods],
    ] as const) number(id, label, signal, signal.set, 'Crew');
  }
  if (entity instanceof SmallCraftEntity) number('otherPassengers', 'Other passengers', entity.otherPassenger, entity.otherPassenger.set, 'Crew');
  if (entity instanceof DropShipEntity) {
    select('collarType', 'Docking collar', entity.collarType, entity.collarType.set, ['Unspecified', 'Standard', 'Prototype', 'No Boom']);
  }
  if (entity instanceof JumpShipEntity) {
    if (entity.entityType === 'WarShip') select('driveCore', 'K-F drive core', entity.driveCoreType, entity.driveCoreType.set, ['Compact', 'Subcompact', 'None']);
    boolean('sail', 'Solar sail', entity.sail);
    boolean('lithiumFusion', 'Lithium-fusion battery', entity.lithiumFusion);
    boolean('hpg', 'Hyperpulse generator', entity.hpg);
    number('jumpRange', 'Jump range (light-years)', entity.jumpRange, entity.jumpRange.set);
    fields.push({ id: 'gravDecks', label: 'Gravity deck diameters (m, comma separated)', group: 'Special', kind: 'text',
      get: () => entity.gravDecks().join(', '), set: value => {
        const values = String(value).trim() ? String(value).split(',').map(part => Number(part.trim())) : [];
        if (values.some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Enter positive gravity deck diameters.');
        entity.gravDecks.set(values);
      } });
  }
  if (entity instanceof SpaceStationEntity) boolean('modularAdapter', 'Modular / K-F adapter', entity.modularOrKFAdapter);
  if (entity instanceof ProtoMekEntity) {
    boolean('mainGun', 'Main gun', entity.hasMainGun, 'Chassis');
    fields.push({ id: 'glider', label: 'Glider', group: 'Chassis', kind: 'boolean', get: entity.isGlider,
      set: value => { entity.isGlider.set(Boolean(value)); if (value) entity.isQuad.set(false); entity.motiveType.set(value ? 'WiGE' : entity.isQuad() ? 'Quad' : 'Biped'); } });
    fields.push({ id: 'quad', label: 'Quad chassis', group: 'Chassis', kind: 'boolean', get: entity.isQuad,
      set: value => { entity.isQuad.set(Boolean(value)); if (value) entity.isGlider.set(false); entity.motiveType.set(value ? 'Quad' : entity.isGlider() ? 'WiGE' : 'Biped'); } });
    boolean('interfaceCockpit', 'Interface cockpit', entity.interfaceCockpit);
  }
  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) {
    number('squadSize', entity instanceof BattleArmorEntity ? 'Troopers' : 'Troopers per squad', entity.squadSize, entity.squadSize.set, 'Crew', 1,
      entity instanceof BattleArmorEntity ? 6 : undefined);
    if (entity instanceof InfantryEntity) number('squadCount', 'Squads', entity.squadCount, entity.squadCount.set, 'Crew', 1);
  }
  if (entity instanceof BattleArmorEntity) {
    select('weightClass', 'Suit weight class', entity.declaredWeightClass, entity.declaredWeightClass.set, ['Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault'], 'Chassis');
    select('chassisType', 'Suit chassis', entity.chassisType, entity.chassisType.set, ['Biped', 'Quad'], 'Chassis');
    number('propulsionMP', 'Propulsion MP', entity.propulsionMP, entity.propulsionMP.set, 'Movement');
    const turretType = () => entity.turretConfig().split(':')[0] || 'None';
    const turretCapacity = () => Number(entity.turretConfig().split(':')[1] ?? 0);
    select('turretType', 'Turret type', turretType, value => entity.turretConfig.set(value === 'None' ? ''
      : `${value}:${Math.min(value === 'Modular' ? 9 : 10, Math.max(1, turretCapacity()))}`), ['None', 'Standard', 'Modular']);
    if (turretType() !== 'None') number('turretCapacity', 'Turret capacity (slots)', turretCapacity,
      value => entity.turretConfig.set(`${turretType()}:${value}`), 'Systems', 1, turretType() === 'Modular' ? 9 : 10);
    boolean('exoskeleton', 'Exoskeleton', entity.isExoskeleton);
    boolean('noHarJel', 'Clan exoskeleton without HarJel', entity.clanExoWithoutHarJel);
  }
  if (entity instanceof InfantryEntity) {
    const weapons = Object.values(entity.getEquipmentRegistry().equipment).filter((eq): eq is WeaponEquipment =>
      eq instanceof WeaponEquipment && eq.isInfantryWeapon());
    for (const [id, label, signal] of [['primaryWeapon', 'Primary weapon', entity.primaryWeapon], ['secondaryWeapon', 'Secondary weapon', entity.secondaryWeapon]] as const) {
      fields.push({ id, label, group: 'Systems', kind: 'select', get: () => signal()?.id ?? '',
        options: [{ value: '', label: 'None' }, ...weapons.map(eq => ({ value: eq.id, label: eq.name }))],
        set: value => { const weapon = weapons.find(eq => eq.id === value); signal.set(weapon?.isInfantryWeapon() ? weapon : null); } });
    }
    if (entity.secondaryWeapon()) number('secondaryCount', 'Secondary weapons per squad', entity.secondaryCount, entity.secondaryCount.set);
    number('armorDivisor', 'Armor damage divisor', entity.armorDivisor, entity.armorDivisor.set, 'Systems', 0.1, undefined, 0.1);
    for (const [id, label, signal] of [
      ['encumberingArmor', 'Encumbering armor', entity.encumberingArmor], ['spaceSuit', 'Space suits', entity.spaceSuit],
      ['dest', 'DEST', entity.hasDEST], ['sneakCamo', 'Sneak camouflage', entity.sneakCamo], ['sneakIR', 'Sneak IR', entity.sneakIR],
      ['sneakECM', 'Sneak ECM', entity.sneakECM],
    ] as const) boolean(id, label, signal);
    if (entity.motiveType() === 'VTOL') boolean('microlite', 'Microlite', entity.isMicrolite);
    if (entity.motiveType() === 'UMU') boolean('motorizedScuba', 'Motorized SCUBA', entity.isMotorizedScuba);
  }
  if (entity instanceof StaticEmplacementEntity && entity.staticKind === 'BuildingEntity') {
    number('constructionFactor', 'Construction factor', () => entity.constructionFactor() ?? 0, entity.constructionFactor.set);
    number('height', 'Height', () => entity.height() ?? 0, entity.height.set);
    number('buildingClass', 'Building class', () => entity.buildingClass() ?? 0, entity.buildingClass.set);
    number('buildingType', 'Building type', () => entity.buildingType() ?? 0, entity.buildingType.set);
  }
  if (entity instanceof StaticEmplacementEntity && entity.staticKind === 'GunEmplacement') boolean('turret', 'Turret', entity.turret);
  return fields.map(field => ({ ...field, set: value => {
    field.set(value);
    if (entity instanceof VehicleEntity || entity instanceof ProtoMekEntity) {
      const engine = entity.mountedEngine();
      entity.mountedEngine.set(new MountedEngine({ type: engine.type(), rating: entity.calculatedEngineRating(), techBase: engine.techBase, installed: engine.installed }));
    } else if (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)) {
      const engine = entity.mountedEngine();
      const basic = entity.tonnage() * (entity instanceof ConvFighterEntity || entity.isSupportVehicle() ? entity.originalWalkMP() : entity.originalWalkMP() - 2);
      const rating = entity.cockpitType() === 'Primitive' ? Math.ceil(Math.round(basic * 1.2) / 5) * 5 : basic;
      entity.mountedEngine.set(new MountedEngine({ type: engine.type(), rating, techBase: engine.techBase, installed: engine.installed }));
      entity.structuralIntegrity.set(entity.originalWalkMP());
    }
  } }));
}

function constructionMotiveTypes(entity: BaseEntity): readonly MotiveType[] {
  if (entity instanceof MekEntity) return entity.chassisConfig === 'QuadVee' ? ['Track', 'Wheel'] : [];
  if (entity instanceof InfantryEntity) return ['Leg', 'Motorized', 'Jump', 'UMU', 'Hover', 'Wheeled', 'Tracked', 'VTOL', 'Submarine', 'Beast'];
  if (entity instanceof BattleArmorEntity) return ['Leg', 'Jump', 'VTOL', 'UMU'];
  if (entity instanceof SmallCraftEntity) return ['Aerodyne', 'Spheroid'];
  if (entity.entityType === 'FixedWingSupport') return ['Aerodyne', 'Airship', 'Station Keeping'];
  if (entity.entityType === 'Naval' || entity.entityType === 'SupportNaval') return ['Naval', 'Hydrofoil', 'Submarine'];
  if (entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL') return ['VTOL'];
  if (entity instanceof VehicleEntity) return entity.isSupportVehicle() ? ['Tracked', 'Wheeled', 'Hover', 'WiGE', 'Rail', 'MagLev'] : ['Tracked', 'Wheeled', 'Hover', 'WiGE'];
  return [];
}
