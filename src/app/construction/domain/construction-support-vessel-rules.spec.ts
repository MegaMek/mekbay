// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { MountedEngine } from '../../models/entity/components';
import { JumpShipEntity, SmallCraftEntity, SupportTankEntity, WarShipEntity } from '../../models/entity/entities';
import type { EntityTransportBay, TransportBayConfiguration } from '../../models/entity/types';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { calculateSpacecraftRequiredGunners } from '../../models/entity/utils/crew-requirements';
import { constructionSupportCrew, constructionSupportSlots, constructionSupportVesselMessages } from './construction-support-vessel-rules';

const registry = createTestEquipmentRegistry();
const misc = (id: string, flag: EquipmentFlag, extra: EquipmentFlag[] = []) => new MiscEquipment({ id, name: id, type: 'misc', flags: [flag, ...extra], stats: { criticalSlots: 0, svSlots: 0 } });
const weapon = (id = 'gun', tons = 6, flags: EquipmentFlag[] = []) => new WeaponEquipment({ id, name: id, type: 'weapon', flags,
  stats: { tonnage: tons, criticalSlots: 1, svSlots: 1 }, weapon: { ranges: [3, 6, 9, 12], ammoType: 'AC', rackSize: 5 } });
const bay = (type: TransportBayConfiguration, capacity: number, doors = 0): EntityTransportBay => ({ id: `bay-${type.type}`, kind: 'bay', configuration: type, capacity, doors, bayNumber: 1, omni: false });
function add(entity: SupportTankEntity | SmallCraftEntity | JumpShipEntity, eq: MiscEquipment | WeaponEquipment | AmmoEquipment, location = 'Body') {
  return entity.addEquipment({ equipmentId: eq.id, equipment: eq, allocation: { kind: 'location', location }, rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
}
const codes = (entity: SupportTankEntity | SmallCraftEntity | JumpShipEntity) => constructionSupportVesselMessages(entity).map(message => message.code);

describe('support vehicle construction rules', () => {
  it('checks chassis modification exclusions independently of flags permitting the family', () => {
    const entity = new SupportTankEntity(registry); entity.setTonnage(20); entity.motiveType.set('Wheeled');
    add(entity, misc('snow', 'F_SNOWMOBILE', ['F_CHASSIS_MODIFICATION']));
    add(entity, misc('dune', 'F_DUNE_BUGGY', ['F_CHASSIS_MODIFICATION']));
    expect(codes(entity)).toContain('SUPPORT_MOD_CONFLICT');
    entity.hasTurret.set(true);
    add(entity, misc('convertible', 'F_CONVERTIBLE', ['F_CHASSIS_MODIFICATION']));
    expect(codes(entity)).toContain('SUPPORT_CONVERTIBLE_TURRET');
  });

  it('counts support ammo by family/rack and jump jets as one slot', () => {
    const entity = new SupportTankEntity(registry); entity.setTonnage(20);
    add(entity, weapon());
    for (let i = 0; i < 3; i++) add(entity, new AmmoEquipment({ id: `ammo${i}`, name: 'ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 5 } }));
    add(entity, misc('jj1', 'F_JUMP_JET')); add(entity, misc('jj2', 'F_JUMP_JET'));
    expect(constructionSupportSlots(entity)).toEqual({ used: 3, capacity: 7 });
  });

  it('requires small support seats and lets advanced fire control share the driver', () => {
    const entity = new SupportTankEntity(registry); entity.setTonnage(2);
    add(entity, weapon('rifle', 0.01), 'Front'); add(entity, weapon('rifle2', 0.01), 'Front');
    expect(constructionSupportCrew(entity)).toBe(3);
    add(entity, misc('fire-control', 'F_ADVANCED_FIRE_CONTROL'));
    expect(constructionSupportCrew(entity)).toBe(1);
    expect(codes(entity)).toContain('SUPPORT_CREW_SEATING');
    entity.transporters.set([bay({ type: 'standard-seats' }, 1)]);
    expect(codes(entity)).not.toContain('SUPPORT_CREW_SEATING');
  });

  it('uses weapon tonnage and command staff in medium support crew requirements', () => {
    const entity = new SupportTankEntity(registry); entity.setTonnage(20);
    add(entity, weapon());
    expect(constructionSupportCrew(entity)).toBe(6); // 2 base + 3 gunners + 1 commander.
    add(entity, misc('fire-control', 'F_ADVANCED_FIRE_CONTROL')); entity.structuralTechRating.set(5);
    expect(constructionSupportCrew(entity)).toBe(3);
  });

  it('reserves quarters slots only above crew minimum and always for second-class passengers', () => {
    const entity = new SupportTankEntity(registry); entity.setTonnage(20);
    entity.transporters.set([bay({ type: 'crew-quarters' }, 2), bay({ type: 'second-class-quarters' }, 21)]);
    expect(constructionSupportSlots(entity).used).toBe(2);
    entity.transporters.set([bay({ type: 'steerage-quarters' }, 53)]);
    expect(constructionSupportSlots(entity).used).toBe(2);
  });

  it('requires external power hardware and advanced fire control for C3', () => {
    const entity = new SupportTankEntity(registry); entity.setTonnage(20); entity.motiveType.set('Rail');
    entity.mountedEngine.set(new MountedEngine({ type: 'External', rating: 0, techBase: 'IS' }));
    expect(codes(entity)).toContain('SUPPORT_EXTERNAL_POWER');
    add(entity, misc('pickup', 'F_EXTERNAL_POWER_PICKUP', ['F_CHASSIS_MODIFICATION']));
    expect(codes(entity)).not.toContain('SUPPORT_EXTERNAL_POWER');
    add(entity, misc('C3', 'F_C3S'));
    expect(codes(entity)).toContain('SUPPORT_C3_FIRE_CONTROL');
  });
});

describe('vessel construction rules', () => {
  it('validates officers and quarters while excluding personnel already accommodated in bays', () => {
    const entity = new SmallCraftEntity(registry); entity.setTonnage(100); entity.crew.set(5); entity.officers.set(0);
    entity.transporters.set([bay({ type: 'fighter', arts: false }, 1, 1), bay({ type: 'crew-quarters' }, 3)]);
    expect(codes(entity)).not.toContain('VESSEL_CREW_MINIMUM');
    expect(codes(entity)).not.toContain('VESSEL_QUARTERS_MINIMUM');
    expect(codes(entity)).toContain('VESSEL_OFFICER_MINIMUM');
    entity.passengers.set(1);
    expect(codes(entity)).toContain('VESSEL_QUARTERS_MINIMUM');
  });

  it('enforces door minima and per-vessel door maximum', () => {
    const entity = new SmallCraftEntity(registry); entity.setTonnage(100); entity.motiveType.set('Aerodyne');
    entity.transporters.set([bay({ type: 'fighter', arts: false }, 1)]);
    expect(codes(entity)).toContain('BAY_DOOR_REQUIRED');
    entity.transporters.set([bay({ type: 'cargo' }, 1, 3)]);
    expect(codes(entity)).toContain('VESSEL_BAY_DOOR_LIMIT');
  });

  it('checks drive tonnage increments, gravity deck size and competing docking facilities', () => {
    const entity = new JumpShipEntity(registry); entity.setTonnage(100001); entity.gravDecks.set([251]);
    entity.transporters.set([bay({ type: 'drop-shuttle', facing: 0 }, 2, 1), { id: 'collar', kind: 'docking-collar', collarNumber: 1, omni: false }]);
    expect(codes(entity)).toContain('VESSEL_DRIVE_TONNAGE');
    expect(codes(entity)).toContain('VESSEL_GRAV_DECK_DIAMETER');
    entity.setTonnage(100000);
    expect(codes(entity)).toContain('VESSEL_DOCKING_HARDPOINTS');
  });

  it('assigns ten gunners to each mass driver and checks vessel mass and arc', () => {
    const entity = new WarShipEntity(registry); entity.setTonnage(100000);
    const driver = new WeaponEquipment({ id: 'mass-driver', name: 'mass driver', type: 'weapon', flags: ['F_MASS_DRIVER'], weapon: { ranges: [12, 24, 36, 48], ammoType: 'LMASS', capital: true } });
    add(entity, driver, 'FLS');
    expect(calculateSpacecraftRequiredGunners(entity)).toBe(10);
    expect(codes(entity)).toContain('VESSEL_MASS_DRIVER_ARC');
    expect(codes(entity)).toContain('VESSEL_MASS_DRIVER_TONNAGE');
    expect(codes(entity)).toContain('VESSEL_LATERAL_WEAPONS');
  });
});
