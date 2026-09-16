// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
  AeroEntity,
  BattleArmorEntity,
  InfantryEntity,
  MekEntity,
  ProtoMekEntity,
  VehicleEntity,
} from '../../models/entity/entities';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { MountedArmor } from '../../models/entity/components';
import {
  AmmoEquipment,
  ArmorEquipment,
  Equipment,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
} from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { createConstructionEntity, type ConstructionUnitKind } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';
import { constructionMaterialMessages } from './construction-material-rules';
import { setConstructionInfantryAugmentation } from './construction-infantry-ba-rules';
import {
  constructionEquipmentEligibilityIssues,
  equipmentPlacementIssues,
  installConstructionEquipment,
  moveConstructionEquipment,
  setConstructionHybridStructure,
  setConstructionOmni,
  setConstructionPatchwork,
  setConstructionStructure,
  validateConstruction,
} from './construction-rules';

const codes = (entity: BaseEntity) => validateConstruction(entity).messages.map((message) => message.code);
const field = (entity: BaseEntity, id: string) => getConstructionFields(entity).find((item) => item.id === id)!;
const tech = { base: 'All', level: 'Standard' } as const;
const design = (kind: ConstructionUnitKind = 'Biped', registry = createTestEquipmentRegistry()) => {
  const entity = createConstructionEntity(kind, registry);
  entity.year.set(3150);
  entity.rulesLevel.set(5);
  entity.mixedTech.set(true);
  return entity;
};
const misc = (id: string, flags: EquipmentFlag[], slots = 1, tons = 0) =>
  new MiscEquipment({
    id,
    name: id,
    type: 'misc',
    flags,
    tech,
    stats: { criticalSlots: slots, tonnage: tons },
  });
const gun = (id: string, flags: EquipmentFlag[] = [], slots = 1, tons = 0) =>
  new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags,
    tech,
    stats: { criticalSlots: slots, tonnage: tons },
    ...(flags.includes('F_INFANTRY') ? { infantry: { crew: 1 } } : {}),
  });

describe('construction chassis exclusions and dependent settings', () => {
  for (const kind of [
    'Biped',
    'Quad',
    'Tripod',
    'QuadVee',
    'Tank',
    'Naval',
    'VTOL',
    'SupportTank',
    'SupportNaval',
    'SupportVTOL',
    'LargeSupportTank',
    'FixedWingSupport',
    'Aero',
  ] as const) {
    it(`allows Omni technology on ${kind}`, () => {
      const entity = design(kind);
      setConstructionOmni(entity, true);
      expect(entity.omni()).toBeTrue();
      expect(codes(entity)).not.toContain('OMNI_CHASSIS');
    });
  }
  for (const kind of [
    'LAM',
    'ConvFighter',
    'ProtoMek',
    'Infantry',
    'BattleArmor',
    'SmallCraft',
    'DropShip',
    'JumpShip',
    'WarShip',
    'SpaceStation',
  ] as const) {
    it(`rejects newly selected Omni technology and diagnoses imported Omni ${kind}`, () => {
      const entity = design(kind);
      expect(() => setConstructionOmni(entity, true)).toThrowError(/Omni/);
      entity.omni.set(true);
      expect(codes(entity)).toContain('OMNI_CHASSIS');
      expect(entity.omni()).toBeTrue();
      setConstructionOmni(entity, false);
      expect(codes(entity)).not.toContain('OMNI_CHASSIS');
    });
  }

  it('treats Omni and hybrid structure as last-selected-wins without excluding patchwork armor', () => {
    const entity = design() as MekEntity;
    setConstructionOmni(entity, true);
    setConstructionPatchwork(entity, true);
    expect(entity.omni()).toBeTrue();
    setConstructionHybridStructure(entity, true);
    expect(entity.omni()).toBeFalse();
    expect(entity.hasHybridStructure()).toBeTrue();
    setConstructionOmni(entity, true);
    expect(entity.hasHybridStructure()).toBeFalse();
    expect(entity.hasPatchworkArmor()).toBeTrue();
    expect(entity.structureDonorAt('CT')).toBeNull();
    const loaded = parseEntity(encodeNativeEntity(entity), 'omni.mtf', entity.getEquipmentRegistry())
      .entity as MekEntity;
    expect(loaded.omni()).toBeTrue();
    expect(loaded.hasHybridStructure()).toBeFalse();
    expect(loaded.hasPatchworkArmor()).toBeTrue();
  });

  it('clears equipment and transporter pod flags when hybrid structure removes Omni technology', () => {
    const entity = design() as MekEntity;
    setConstructionOmni(entity, true);
    addTestEquipment(entity, gun('pod laser'), { location: 'RT', omniPodMounted: true });
    entity.transporters.set([{ id: 'troops', kind: 'troop-space', totalSpace: 1, omni: true }]);
    setConstructionHybridStructure(entity, true);
    expect(entity.equipment().every((mount) => !mount.omniPodMounted)).toBeTrue();
    expect(entity.transporters().every((item) => !item.omni)).toBeTrue();
  });

  it('clears incompatible cockpit options while permitting repairs to imported invalid switches', () => {
    const entity = design() as MekEntity;
    entity.hasFullHeadEjectionSystem.set(true);
    field(entity, 'cockpit').set('Command Console');
    expect(entity.hasFullHeadEjectionSystem()).toBeFalse();
    expect(field(entity, 'fullHeadEjection').disabled).toBeTrue();
    expect(() => field(entity, 'fullHeadEjection').set(true)).toThrow();
    entity.hasFullHeadEjectionSystem.set(true);
    expect(field(entity, 'fullHeadEjection').invalid).toBeTrue();
    expect(field(entity, 'fullHeadEjection').disabled).toBeFalse();
    field(entity, 'fullHeadEjection').set(false);
    field(entity, 'cockpit').set('Interface');
    field(entity, 'gyro').set('None');
    field(entity, 'cockpit').set('Standard');
    expect(entity.gyroType()).toBe('Standard');
  });

  it('updates both arm actuator dependencies and preserves mandatory LAM lower arms', () => {
    const entity = design() as MekWithArmsEntity;
    field(entity, 'leftLowerArm').set('false');
    expect(entity.hasLowerArmActuator().left).toBeFalse();
    expect(entity.hasHandActuator().left).toBeFalse();
    field(entity, 'leftHand').set(true);
    expect(entity.hasLowerArmActuator().left).toBeTrue();
    expect(entity.hasHandActuator().left).toBeTrue();
    expect(() => field(design('LAM'), 'leftLowerArm').set(false)).toThrowError(/LAM/);
  });

  it('maintains vehicle turret and trailer dependencies using actual boolean values', () => {
    const entity = design('Tank') as VehicleEntity;
    field(entity, 'turret').set(false);
    field(entity, 'dualTurret').set(true);
    expect(entity.hasTurret()).toBeTrue();
    field(entity, 'turret').set('false');
    expect(entity.hasDualTurret()).toBeFalse();
    expect(() => field(entity, 'noControlSystems').set(true)).toThrow();
    field(entity, 'trailer').set(true);
    field(entity, 'noControlSystems').set(true);
    field(entity, 'trailer').set('false');
    expect(entity.hasNoControlSystems()).toBeFalse();
  });

  it('clears battle armor propulsion and turret settings on incompatible chassis changes', () => {
    const entity = design('BattleArmor') as BattleArmorEntity;
    entity.motiveType.set('Jump');
    entity.propulsionMP.set(3);
    field(entity, 'chassisType').set('Quad');
    expect(entity.motiveType()).toBe('Leg');
    expect(entity.propulsionMP()).toBe(0);
    field(entity, 'turretType').set('Standard');
    field(entity, 'chassisType').set('Biped');
    expect(entity.turretConfig()).toBe('');
    expect(() => field(entity, 'turretType').set('Standard')).toThrow();
  });

  it('clears exoskeleton and HarJel exceptions when changing out of ultra-light armor', () => {
    const entity = design('BattleArmor') as BattleArmorEntity;
    entity.techBase.set('Clan');
    field(entity, 'weightClass').set('Ultra Light');
    field(entity, 'exoskeleton').set(true);
    field(entity, 'noHarJel').set(true);
    field(entity, 'weightClass').set('Light');
    expect(entity.isExoskeleton()).toBeFalse();
    expect(entity.clanExoWithoutHarJel()).toBeFalse();
    expect(() => field(entity, 'exoskeleton').set(true)).toThrow();
  });

  it('makes conventional fighter heat sinks automatic and prohibits double sinks', () => {
    const entity = design('ConvFighter') as AeroEntity;
    const before = field(entity, 'heatSinks').get();
    addTestEquipment(
      entity,
      new WeaponEquipment({
        id: 'heat',
        name: 'heat',
        type: 'weapon',
        flags: ['F_ENERGY', 'F_LASER'],
        weapon: { heat: 3 },
      }),
      { location: 'Nose' },
    );
    expect(field(entity, 'heatSinks').get()).toBe(Number(before) + 3);
    expect(field(entity, 'heatSinks').disabled).toBeTrue();
    expect(() => field(entity, 'heatSinks').set(0)).toThrow();
    expect(() => field(entity, 'heatSinkType').set('Double')).toThrow();
    entity.heatSinkType.set('Double');
    expect(codes(entity)).toContain('CONVENTIONAL_HEAT_SINK_TYPE');
  });

  for (const [first, second, code] of [
    ['dermal_armor', 'dermal_camo_armor', 'INFANTRY_DERMAL_CONFLICT'],
    ['pl_glider', 'pl_flight', 'INFANTRY_WING_CONFLICT'],
  ])
    it(`excludes ${first} and ${second} in both directions and diagnoses imported conflicts`, () => {
      const entity = design('Infantry') as InfantryEntity;
      for (const [a, b] of [
        [first, second],
        [second, first],
      ]) {
        setConstructionInfantryAugmentation(entity, a, true);
        setConstructionInfantryAugmentation(entity, b, true);
        expect(entity.augmentations()).toContain(b);
        expect(entity.augmentations()).not.toContain(a);
      }
      entity.augmentations.set([first, second]);
      expect(codes(entity)).toContain(code);
      expect(entity.augmentations()).toEqual([first, second]);
    });
});

describe('shared picker and Issues conflict rules', () => {
  const pairs: [EquipmentFlag, EquipmentFlag, string][] = [
    ['F_NULL_SIG', 'F_TARGETING_COMPUTER', 'MEK_NULL_TARGETING'],
    ['F_NULL_SIG', 'F_VOID_SIG', 'MEK_NULL_VOID'],
    ['F_VOID_SIG', 'F_NOVA', 'MEK_VOID_C3'],
    ['F_HARJEL_II', 'F_HARJEL_III', 'MEK_HARJEL_GENERATION'],
    ['F_MASC', 'F_ACTUATOR_ENHANCEMENT_SYSTEM', 'MEK_AES_MASC'],
    ['F_UMU', 'F_JUMP_JET', 'MEK_UMU_JUMP_CONFLICT'],
    ['F_ARTEMIS', 'F_ARTEMIS_V', 'ARTEMIS_GENERATION'],
    ['F_C3S', 'F_C3I', 'NETWORK_SYSTEM_CONFLICT'],
  ];
  for (const [first, second, code] of pairs)
    for (const reverse of [false, true]) {
      it(`rejects ${reverse ? first : second} against ${reverse ? second : first} before installation`, () => {
        const entity = design();
        const a = misc('installed', [reverse ? second : first, 'F_MEK_EQUIPMENT']);
        const b = misc('candidate', [reverse ? first : second, 'F_MEK_EQUIPMENT']);
        addTestEquipment(entity, a, { location: 'RT' });
        const issue = constructionEquipmentConflictMessages(entity, b).find((message) => message.code === code)!;
        expect(issue).toBeDefined();
        expect(constructionEquipmentEligibilityIssues(entity, b)).toContain(issue.message);
        expect(() => installConstructionEquipment(entity, b, 'LT')).toThrow();
        addTestEquipment(entity, b, { location: 'LT' });
        expect(codes(entity)).toContain(code);
      });
    }

  it('ignores a mount being moved and does not block unrelated additions to an invalid design', () => {
    const entity = design();
    const computer = misc('computer', ['F_TARGETING_COMPUTER', 'F_MEK_EQUIPMENT']);
    const mount = addTestEquipment(entity, computer, { location: 'RT' });
    expect(constructionEquipmentConflictMessages(entity, computer, mount)).toEqual([]);
    expect(constructionEquipmentConflictMessages(entity, computer).map((message) => message.code)).toContain(
      'MEK_SINGLE_SYSTEM',
    );
    addTestEquipmentWithFlags(entity, ['F_NULL_SIG'], { location: 'LT' });
    expect(codes(entity)).toContain('MEK_NULL_TARGETING');
    expect(constructionEquipmentConflictMessages(entity, gun('unrelated laser'))).toEqual([]);
  });

  it('preserves the documented supercharger/AES and null-signature/Nova exceptions', () => {
    const entity = design();
    addTestEquipmentWithFlags(entity, ['F_MASC', 'S_SUPERCHARGER']);
    expect(constructionEquipmentConflictMessages(entity, misc('AES', ['F_ACTUATOR_ENHANCEMENT_SYSTEM']))).toEqual([]);
    addTestEquipmentWithFlags(entity, 'F_NULL_SIG');
    expect(constructionEquipmentConflictMessages(entity, misc('Nova', ['F_NOVA']))).toEqual([]);
  });

  it('checks stealth material selection and incompatible equipment selection against the same rule', () => {
    const entity = design();
    const stealth = new ArmorEquipment({
      id: 'Stealth',
      name: 'Stealth',
      type: 'armor',
      armor: { type: 'STEALTH' },
      flags: ['F_MEK_EQUIPMENT'],
      tech,
    });
    const nullSig = misc('Null signature', ['F_NULL_SIG', 'F_MEK_EQUIPMENT']);
    const mount = addTestEquipment(entity, nullSig, { location: 'RT' });
    expect(constructionMaterialMessages(entity, stealth).map((message) => message.code)).toContain('MEK_NULL_STEALTH');
    entity.removeEquipment(mount);
    entity.setUniformArmor(new MountedArmor({ armor: stealth }));
    expect(constructionEquipmentConflictMessages(entity, nullSig).map((message) => message.code)).toContain(
      'MEK_NULL_STEALTH',
    );
  });
});

describe('new construction capacity and configuration boundaries', () => {
  it('accepts combat vehicle weights in whole tons from one ton, without a Mek-style five-ton restriction', () => {
    const entity = design('Tank');
    for (const tons of [1, 3, 6, 19]) {
      entity.setTonnage(tons);
      expect(codes(entity)).not.toContain('VEHICLE_TONNAGE_INCREMENT');
    }
    for (const tons of [0.5, 5.5]) {
      entity.setTonnage(tons);
      expect(codes(entity)).toContain('VEHICLE_TONNAGE_INCREMENT');
    }
  });

  it('validates vehicle controls, WiGE minimum speed, rotor mast and mast counts', () => {
    const vehicle = design('Tank') as VehicleEntity;
    vehicle.hasNoControlSystems.set(true);
    vehicle.motiveType.set('WiGE');
    vehicle.originalWalkMP.set(4);
    expect(codes(vehicle)).toEqual(jasmine.arrayContaining(['VEHICLE_CONTROL_SYSTEMS', 'VEHICLE_WIGE_SPEED']));
    vehicle.originalWalkMP.set(5);
    expect(codes(vehicle)).not.toContain('VEHICLE_WIGE_SPEED');
    const vtol = design('VTOL');
    addTestEquipmentWithFlags(vtol, 'F_ECM', { location: 'Rotor' });
    expect(codes(vtol)).toContain('VEHICLE_ROTOR_MAST');
    addTestEquipmentWithFlags(vtol, 'F_MAST_MOUNT', { location: 'Rotor' });
    expect(codes(vtol)).not.toContain('VEHICLE_ROTOR_MAST');
    addTestEquipmentWithFlags(vtol, 'F_MAST_MOUNT', { location: 'Rotor' });
    expect(codes(vtol)).toContain('VEHICLE_MAST_COUNT');
  });

  it('allows two manipulators per vehicle location and diagnoses the third', () => {
    const entity = design('Tank');
    for (const location of ['Front', 'Rear'])
      for (let i = 0; i < 2; i++) addTestEquipmentWithFlags(entity, 'F_MANIPULATOR', { location });
    expect(codes(entity)).not.toContain('VEHICLE_MANIPULATOR_LIMIT');
    addTestEquipmentWithFlags(entity, 'F_MANIPULATOR', { location: 'Front' });
    expect(codes(entity)).toContain('VEHICLE_MANIPULATOR_LIMIT');
  });

  it('rounds Omni turret structure to half tons and excludes ammunition from its load', () => {
    const entity = design('Tank') as VehicleEntity;
    setConstructionOmni(entity, true);
    entity.hasTurret.set(true);
    entity.baseChassisTurretWeight.set(0.5);
    addTestEquipment(entity, gun('turret gun', [], 1, 5), { location: 'Turret' });
    addTestEquipment(entity, new AmmoEquipment({ id: 'ammo', name: 'ammo', type: 'ammo', stats: { tonnage: 1 } }), {
      location: 'Turret',
    });
    expect(codes(entity)).not.toContain('VEHICLE_OMNI_TURRET_CAPACITY');
    addTestEquipment(entity, misc('extra turret load', [], 1, 0.1), { location: 'Turret' });
    expect(codes(entity)).toContain('VEHICLE_OMNI_TURRET_CAPACITY');
  });

  it('uses the primary chassis turret capacity for the rear of a dual-turret vehicle', () => {
    const entity = design('Tank') as VehicleEntity;
    setConstructionOmni(entity, true);
    entity.hasTurret.set(true);
    entity.hasDualTurret.set(true);
    entity.baseChassisTurretWeight.set(2.5);
    entity.baseChassisTurret2Weight.set(3);
    addTestEquipment(entity, gun('rear turret gun', [], 1, 21), { location: 'Rear Turret' });
    addTestEquipment(entity, gun('front turret guns', [], 1, 30), { location: 'Front Turret' });
    expect(codes(entity)).not.toContain('VEHICLE_OMNI_TURRET_CAPACITY');
    addTestEquipment(entity, misc('extra rear load', [], 1, 5), { location: 'Rear Turret' });
    expect(codes(entity)).toContain('VEHICLE_OMNI_TURRET_CAPACITY');
  });

  it('reserves ProtoMek torso slots for armor even without an equipment marker', () => {
    const entity = design('ProtoMek') as ProtoMekEntity;
    const armor = new ArmorEquipment({
      id: 'Proto armor',
      name: 'Proto armor',
      type: 'armor',
      armor: { type: 'STANDARD' },
      stats: { criticalSlots: 1 },
      flags: ['F_PROTOMEK_EQUIPMENT'],
      tech,
    });
    entity.setUniformArmor(new MountedArmor({ armor }));
    const weapon = gun('proto laser', ['F_PROTO_WEAPON'], 1, 0.5);
    addTestEquipment(entity, weapon, { location: 'Torso' });
    expect(codes(entity)).not.toContain('PROTO_LOCATION_SLOTS');
    expect(equipmentPlacementIssues(entity, weapon, 'Torso').length).toBeGreaterThan(0);
    addTestEquipment(entity, weapon, { location: 'Torso' });
    expect(codes(entity)).toContain('PROTO_LOCATION_SLOTS');
    addTestEquipment(entity, gun('heavy torso weapon', ['F_PROTO_WEAPON'], 1, 2), { location: 'Torso' });
    expect(codes(entity)).toContain('PROTO_LOCATION_WEIGHT');
  });

  it('checks ProtoMek jump and UMU limits without counting slot-free propulsion as body equipment', () => {
    const entity = design('ProtoMek') as ProtoMekEntity;
    entity.originalWalkMP.set(4);
    for (let index = 0; index < 4; index++) addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'Body' });
    expect(entity.installedJumpJetMP()).toBe(4);
    expect(codes(entity)).not.toContain('PROTO_JUMP_LIMIT');
    addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'Body' });
    expect(entity.installedJumpJetMP()).toBe(5);
    expect(codes(entity)).toContain('PROTO_JUMP_LIMIT');
    addTestEquipmentWithFlags(entity, ['F_JUMP_JET', 'S_IMPROVED'], { location: 'Body' });
    expect(entity.installedJumpJetMP()).toBe(6);
    expect(codes(entity)).not.toContain('PROTO_JUMP_LIMIT');
    for (let i = 0; i < 6; i++) addTestEquipmentWithFlags(entity, 'F_UMU', { location: 'Body' });
    expect(codes(entity)).not.toContain('PROTO_UMU_LIMIT');
    expect(codes(entity)).not.toContain('PROTO_LOCATION_SLOTS');
    addTestEquipmentWithFlags(entity, 'F_UMU', { location: 'Body' });
    expect(codes(entity)).toContain('PROTO_UMU_LIMIT');
  });

  it('shares the four-weapon limit across a quad battle armor body and turret', () => {
    const entity = design('BattleArmor') as BattleArmorEntity;
    entity.chassisType.set('Quad');
    entity.turretConfig.set('Standard:5');
    for (const part of ['Body', 'Turret'] as const)
      for (let i = 0; i < 2; i++)
        addTestEquipment(entity, gun(`${part} gun ${i}`, ['F_BA_WEAPON']), {
          location: 'Squad',
          baMountLocation: part,
        });
    expect(codes(entity)).not.toContain('BA_ANTI_MEK_WEAPON_LIMIT');
    addTestEquipment(entity, gun('fifth gun', ['F_BA_WEAPON']), { location: 'Squad', baMountLocation: 'Turret' });
    expect(codes(entity)).toContain('BA_ANTI_MEK_WEAPON_LIMIT');
  });

  it('counts detached infantry weapons and exempts weapons linked to AP mounts', () => {
    for (const linked of [true, false]) {
      const entity = design('BattleArmor') as BattleArmorEntity;
      const parent = addTestEquipment(entity, misc('parent', ['F_AP_MOUNT']), {
        location: 'Squad',
        baMountLocation: 'LA',
      });
      const weapon = addTestEquipment(entity, gun('rifle', ['F_INFANTRY']), {
        location: 'Squad',
        baMountLocation: 'LA',
        isAPM: true,
      });
      if (linked) entity.linkEquipment(parent, weapon);
      for (let i = 0; i < 2; i++)
        addTestEquipment(entity, misc(`filler ${i}`, []), { location: 'Squad', baMountLocation: 'LA' });
      expect(codes(entity).includes('BA_LOCATION_SLOTS'))
        .withContext(linked ? 'linked' : 'detached')
        .toBe(!linked);
    }
  });

  it('enforces handheld item, melee exclusivity, and ammunition bin limits', () => {
    const entity = design('HandheldWeapon');
    for (let i = 0; i < 6; i++) addTestEquipment(entity, gun(`gun ${i}`));
    expect(codes(entity)).not.toContain('HANDHELD_ITEM_LIMIT');
    addTestEquipment(entity, gun('seventh'));
    expect(codes(entity)).toContain('HANDHELD_ITEM_LIMIT');
    addTestEquipmentWithFlags(entity, 'F_CLUB');
    expect(codes(entity)).toContain('HANDHELD_MELEE_EXCLUSIVE');
    const ammo = new AmmoEquipment({ id: 'ammo', name: 'ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 5 } });
    addTestEquipment(entity, ammo);
    addTestEquipment(entity, ammo);
    expect(codes(entity)).toContain('HANDHELD_AMMO_BIN_LIMIT');
  });
});

describe('catalog-backed chassis transitions', () => {
  let registry: EquipmentRegistry;
  beforeAll(async () => {
    registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });
  const find = (predicate: (equipment: Equipment) => boolean) => {
    const equipment = Object.values(registry.equipment).find(predicate);
    if (!equipment) throw new Error('Missing catalog fixture');
    return equipment;
  };

  it('removes incompatible Omni arm actuators before allocating an AC/20 and when moving it', () => {
    const entity = design('Biped', registry) as MekWithArmsEntity;
    const weapon = find((eq) => eq instanceof WeaponEquipment && eq.ammoType === 'AC' && eq.rackSize === 20);
    setConstructionOmni(entity, true);
    const mounted = installConstructionEquipment(entity, weapon, 'RA');
    expect(entity.hasLowerArmActuator().right).toBeFalse();
    expect(entity.hasHandActuator().right).toBeFalse();
    expect(codes(entity)).not.toContain('CRIT_PLACEMENT_CONFLICT');
    moveConstructionEquipment(entity, mounted, 'LA');
    expect(entity.hasLowerArmActuator().left).toBeFalse();
    expect(entity.hasHandActuator().left).toBeFalse();
    expect(() => field(entity, 'leftHand').set(true)).toThrowError(/Omni/);
  });

  it('removes Omni technology when selecting industrial structure', () => {
    const entity = design('Biped', registry) as MekEntity;
    setConstructionOmni(entity, true);
    const industrial = find(
      (eq) => eq instanceof StructureEquipment && eq.hasFlag('F_INDUSTRIAL_STRUCTURE'),
    ) as StructureEquipment;
    setConstructionStructure(entity, industrial);
    expect(entity.isIndustrial()).toBeTrue();
    expect(entity.omni()).toBeFalse();
    expect(() => setConstructionOmni(entity, true)).toThrowError(/Omni/);
  });
});
