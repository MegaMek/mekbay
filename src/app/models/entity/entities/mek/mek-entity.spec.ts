import { Equipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import { MountedEngine } from '../../components';
import { EntityMountedEquipment } from '../../types';
import { BipedMekEntity } from './biped-mek-entity';
import { LamEntity } from './lam-entity';
import { QuadMekEntity } from './quad-mek-entity';

describe('MekEntity jumpMP', () => {
  it('reacts to jump jets, partial wings, and shields', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);
    entity.equipment.set([
      ...mountsWithFlag('F_JUMP_JET', 6),
      mountWithFlag('F_PARTIAL_WING'),
    ]);

    expect(entity.jumpMP()).toBe(8);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('S_SHIELD_MEDIUM')]);
    expect(entity.jumpMP()).toBe(7);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('F_MODULAR_ARMOR')]);
    expect(entity.jumpMP()).toBe(6);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('S_SHIELD_LARGE')]);
    expect(entity.jumpMP()).toBe(0);
  });

  it('uses the smaller partial-wing bonus for heavy Meks', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(75);
    entity.equipment.set([
      ...mountsWithFlag('F_JUMP_JET', 4),
      mountWithFlag('F_PARTIAL_WING'),
    ]);

    expect(entity.jumpMP()).toBe(5);
  });

  it('calculates maximum jump directly when modular armor reduces normal jump to zero', () => {
    const entity = new BipedMekEntity();
    entity.equipment.set([
      mountWithFlag('F_JUMP_JET'),
      mountWithFlag('F_MODULAR_ARMOR'),
    ]);

    expect(entity.jumpMP()).toBe(0);
    expect(entity.maxJumpMP()).toBe(1);
  });

  it('reduces run MP by one for hardened armor', () => {
    const entity = new BipedMekEntity();
    entity.originalWalkMP.set(5);

    expect(entity.runMP()).toBe(8);

    entity.mountedArmor.update(armor => ({ ...armor, type: 'HARDENED' }));
    expect(entity.runMP()).toBe(7);
  });

  it('applies static shield, modular armor, and chain drape walk penalties', () => {
    const entity = new BipedMekEntity();
    entity.originalWalkMP.set(8);
    entity.equipment.set([
      mountWithFlag('S_SHIELD_MEDIUM'),
      mountWithFlag('S_SHIELD_LARGE'),
      mountWithFlag('F_MODULAR_ARMOR'),
      mountWithFlag('F_MODULAR_ARMOR'),
      mountWithFlag('F_CHAIN_DRAPE'),
    ]);

    expect(entity.walkMP()).toBe(4);
    expect(entity.runMP()).toBe(6);
    expect(entity.maxWalkMP()).toBe(5);
    expect(entity.maxRunMP()).toBe(8);
  });

  it('uses TSM and movement boosters for maximum movement', () => {
    const entity = new BipedMekEntity();
    entity.originalWalkMP.set(5);
    entity.equipment.set([mountWithFlag('F_TSM'), mountWithFlag('F_MASC')]);

    expect(entity.walkMP()).toBe(5);
    expect(entity.runMP()).toBe(8);
    expect(entity.maxWalkMP()).toBe(6);
    expect(entity.maxRunMP()).toBe(12);
  });

  it('does not apply shield walk penalties to quad Meks', () => {
    const entity = new QuadMekEntity();
    entity.originalWalkMP.set(6);
    entity.equipment.set([mountWithFlag('S_SHIELD_MEDIUM')]);

    expect(entity.walkMP()).toBe(6);
  });
});

describe('MekEntity weapons', () => {
  it('derives a typed reactive weapon index from canonical equipment', () => {
    const entity = new BipedMekEntity();
    const laser = new WeaponEquipment({
      id: 'laser', name: 'Laser', type: 'weapon', weapon: { damage: 5 },
    });
    const heatSink = new MiscEquipment({
      id: 'heat-sink', name: 'Heat Sink', type: 'misc', flags: ['F_HEAT_SINK'],
    });

    entity.equipment.set([mounted(laser), mounted(heatSink)]);
    expect(entity.mountedWeapons().map(mount => mount.equipment.id)).toEqual(['laser']);
    expect(entity.weapons().some(weapon => weapon.source === 'mounted' && weapon.id.includes('laser'))).toBeTrue();

    entity.equipment.set([mounted(heatSink)]);
    expect(entity.mountedWeapons()).toEqual([]);
  });

  it('exposes semantic intrinsic weapons', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);

    const intrinsic = entity.intrinsicWeapons();
    expect(intrinsic.map(weapon => weapon.name)).toEqual([
      'Punch', 'Punch', 'Club', 'Kick', 'Charge', 'Push',
    ]);
    expect(intrinsic.find(weapon => weapon.id === 'intrinsic:punch:LA')?.damage).toEqual({
      kind: 'physical-fixed', primary: { damage: 6 },
    });
    expect(intrinsic.find(weapon => weapon.id === 'intrinsic:kick')?.hitModifiers).toEqual([-2]);
    expect(entity.weapons().filter(weapon => weapon.source === 'intrinsic').length).toBe(6);
  });

  it('reacts to actuator, AES, claw, TSM, talon, and jump equipment state', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);
    entity.hasLowerArmActuator.set({ left: false, right: true });
    entity.hasHandActuator.set({ left: false, right: true });
    entity.equipment.set([
      mountWithFlags(['F_ACTUATOR_ENHANCEMENT_SYSTEM'], 'LA'),
      mountWithFlags(['F_HAND_WEAPON', 'S_CLAW'], 'RA'),
      mountWithFlag('F_TSM'),
      mountWithFlag('F_TALON'),
      mountWithFlag('F_JUMP_JET'),
      mountWithFlag('S_SHIELD_LARGE'),
    ]);

    const intrinsic = entity.intrinsicWeapons();
    expect(intrinsic.find(weapon => weapon.id === 'intrinsic:punch:LA')).toEqual(
      jasmine.objectContaining({
        damage: { kind: 'physical-fixed', primary: { damage: 3, tsmDamage: 6 } },
        hitModifiers: [2],
      }),
    );
    expect(intrinsic.some(weapon => weapon.id === 'intrinsic:punch:RA')).toBeFalse();
    expect(intrinsic.find(weapon => weapon.id === 'intrinsic:kick')).toEqual(
      jasmine.objectContaining({
        name: 'Kick [Talons]',
        damage: { kind: 'physical-fixed', primary: { damage: 17, tsmDamage: 34 } },
      }),
    );
    expect(intrinsic.some(weapon => weapon.kind === 'death-from-above')).toBeTrue();
    expect(entity.jumpMP()).toBe(0);
  });

  it('represents LAM mode damage as an explicit alternate', () => {
    const entity = new LamEntity();
    entity.setTonnage(55);

    expect(entity.intrinsicWeapons().find(weapon => weapon.kind === 'kick')?.damage).toEqual({
      kind: 'physical-fixed',
      primary: { damage: 11 },
      alternate: { mode: 'airmek', value: { damage: 6 } },
    });
    expect(entity.intrinsicWeapons().some(weapon => weapon.kind === 'airmek-ram')).toBeTrue();
  });
});

describe('MekEntity integral heat sinks', () => {
  it('derives reactive intrinsic sink capabilities from total and mounted sinks', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
    const singleHeatSink = new MiscEquipment({
      id: 'Heat Sink', name: 'Heat Sink', type: 'misc', flags: ['F_HEAT_SINK'],
      stats: { criticalSlots: 1 },
    });
    entity.configureHeatSinks(singleHeatSink, 10);

    expect(entity.integralHeatSinks()).toEqual({
      count: 10,
      equipment: singleHeatSink,
    });

    const doubleHeatSink = new MiscEquipment({
      id: 'ISDoubleHeatSink',
      name: 'Double Heat Sink',
      type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK'],
      stats: { criticalSlots: 3 },
    });
    entity.configureHeatSinks(doubleHeatSink, 12);

    expect(entity.integralHeatSinks()).toEqual({
      count: 10,
      equipment: doubleHeatSink,
    });
    expect(entity.equipment().filter(mount => mount.allocation.kind !== 'engine').length).toBe(2);
    expect(entity.totalHeatSinks()).toBe(12);
  });

  it('uses the single compact component as the selected integral sink type', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 125, techBase: 'IS' }));
    const compactHeatSink = new MiscEquipment({
      id: '1 Compact Heat Sink', name: '1 Compact Heat Sink', type: 'misc',
      flags: ['F_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
      stats: { criticalSlots: 1 },
    });

    entity.configureHeatSinks(compactHeatSink, 10);

    expect(entity.heatSinkType()).toBe('Compact');
    expect(entity.integralHeatSinks()).toEqual({ count: 10, equipment: compactHeatSink });
  });

  it('rebalances integral heat sinks when the engine changes', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
    const singleHeatSink = new MiscEquipment({
      id: 'Heat Sink', name: 'Heat Sink', type: 'misc', flags: ['F_HEAT_SINK'],
    });
    entity.configureHeatSinks(singleHeatSink, 10);

    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 125, techBase: 'IS' }));

    expect(entity.integralHeatSinks()?.count).toBe(5);
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'unallocated').length).toBe(5);
    expect(entity.totalHeatSinks()).toBe(10);
  });

  it('represents Omni base-chassis sinks as engine-integrated mounts', () => {
    const entity = new BipedMekEntity();
    entity.omni.set(true);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'Clan' }));
    const doubleHeatSink = new MiscEquipment({
      id: 'CLDoubleHeatSink', name: 'Double Heat Sink', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK'],
      stats: { criticalSlots: 2 },
      tech: { base: 'Clan' },
    });
    entity.heatSinkEquipment.set(doubleHeatSink);

    entity.initializeParsedHeatSinkMounts(15, 12);

    expect(entity.mountedEngine().getBaseChassisHeatSinks(false)).toBe(10);
    expect(entity.integralHeatSinks()).toEqual({ count: 10, equipment: doubleHeatSink });
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'engine').length).toBe(10);
    expect(entity.equipment().filter(mount => mount.allocation.kind !== 'engine').length).toBe(5);
    expect(entity.totalHeatSinks()).toBe(15);

    entity.configureHeatSinks(doubleHeatSink, 18);

    expect(entity.integralHeatSinks()?.count).toBe(10);
    expect(entity.equipment().filter(mount => mount.allocation.kind !== 'engine').length).toBe(8);
  });

  it('normalizes legacy Omni base-chassis counts below ten to total sinks', () => {
    const entity = new BipedMekEntity();
    entity.omni.set(true);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'Clan' }));
    const doubleHeatSink = new MiscEquipment({
      id: 'CLDoubleHeatSink', name: 'Double Heat Sink', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK'],
      stats: { criticalSlots: 2 },
      tech: { base: 'Clan' },
    });
    entity.heatSinkEquipment.set(doubleHeatSink);

    entity.initializeParsedHeatSinkMounts(10, 8);

    expect(entity.mountedEngine().getBaseChassisHeatSinks(false)).toBe(8);
    expect(entity.integralHeatSinks()).toEqual({ count: 8, equipment: doubleHeatSink });
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'unallocated').length).toBe(2);
  });

  it('limits Omni integral mounts to the configured engine base count', () => {
    const entity = new BipedMekEntity();
    entity.omni.set(true);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'Clan' }));
    const doubleHeatSink = new MiscEquipment({
      id: 'CLDoubleHeatSink', name: 'Double Heat Sink', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK'], tech: { base: 'Clan' },
    });
    entity.heatSinkEquipment.set(doubleHeatSink);

    entity.initializeParsedHeatSinkMounts(15, 10);

    expect(entity.mountedEngine().integralHeatSinkCapacity(false)).toBe(12);
    expect(entity.integralHeatSinks()?.count).toBe(10);
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'unallocated').length).toBe(5);
  });

  it('rejects a compact two-pack as the selected integral sink definition', () => {
    const entity = new BipedMekEntity();
    const compactTwoPack = new MiscEquipment({
      id: '2 Compact Heat Sinks', name: '2 Compact Heat Sinks', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
    });

    expect(() => entity.configureHeatSinks(compactTwoPack, 10))
      .toThrowError('Compact heat-sink configuration must use the single-unit equipment definition');
  });

  it('preserves parsed compact two-packs before adding integral sinks', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 125, techBase: 'IS' }));
    const compactHeatSink = new MiscEquipment({
      id: '1 Compact Heat Sink', name: '1 Compact Heat Sink', type: 'misc',
      flags: ['F_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
    });
    const compactTwoPack = new MiscEquipment({
      id: '2 Compact Heat Sinks', name: '2 Compact Heat Sinks', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
    });
    const parsedMount = new EntityMountedEquipment({
      mountId: 'parsed-compact-two-pack',
      equipmentId: compactTwoPack.id,
      equipment: compactTwoPack,
      allocation: { kind: 'location', location: 'CT' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    entity.heatSinkEquipment.set(compactHeatSink);
    entity.equipment.set([parsedMount]);

    entity.initializeParsedHeatSinkMounts(10);

    expect(entity.equipment()).toContain(parsedMount);
    expect(entity.integralHeatSinks()?.count).toBe(8);
    expect(entity.totalHeatSinks()).toBe(10);
  });

  it('does not expose prototype double sinks as engine-integrated', () => {
    const entity = new BipedMekEntity();
    const prototype = new MiscEquipment({
      id: 'ISDoubleHeatSinkPrototype', name: 'Double Heat Sink Prototype', type: 'misc',
      flags: ['F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'],
    });

    entity.configureHeatSinks(prototype, 10);

    expect(entity.integralHeatSinks()).toBeNull();
  });
});

function mountsWithFlag(flag: string, count: number): EntityMountedEquipment[] {
  return Array.from({ length: count }, () => mountWithFlag(flag));
}

function mountWithFlag(flag: string): EntityMountedEquipment {
  return mountWithFlags([flag]);
}

function mountWithFlags(flags: readonly string[], location = 'CT'): EntityMountedEquipment {
  const flagSet = new Set(flags);
  const mountId = `${flags.join(':')}-${nextMountId++}`;
  return new EntityMountedEquipment({
    mountId,
    equipmentId: flags.join(':'),
    equipment: { hasFlag: (candidate: string) => flagSet.has(candidate) } as Equipment,
    allocation: { kind: 'location', location },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}

let nextMountId = 0;

function mounted(equipment: Equipment): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-${nextMountId++}`,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location: 'CT' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}