import { ArmorEquipment, Equipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import {
  MountedArmor,
  MountedEngine,
  MountedStructure,
  STANDARD_STRUCTURE_EQUIPMENT,
} from '../../components';
import { EntityMountedEquipment } from '../../types';
import {
  TestBipedMekEntity as BipedMekEntity,
  TestLamEntity as LamEntity,
  TestQuadMekEntity as QuadMekEntity,
} from '../../testing/test-entities';

const TEST_IS_ENDO_STRUCTURE = new StructureEquipment({
  id: 'IS Endo Steel',
  name: 'Endo Steel',
  type: 'structure',
  tech: { base: 'IS' },
  structure: { typeId: 1 },
});

function standardStructure(tonnage: number): MountedStructure {
  return new MountedStructure({ tonnage, structure: STANDARD_STRUCTURE_EQUIPMENT });
}

describe('MekEntity optional systems', () => {
  it('contributes technology only for installed optional systems', () => {
    const entity = new BipedMekEntity();
    const baseSourceCount = entity.entityTechAdvancements().length;

    entity.hasFullHeadEjectionSystem.set(true);
    expect(entity.entityTechAdvancements()).toHaveSize(baseSourceCount + 1);
    expect(entity.entityTechAdvancements().at(-1)?.rating).toBe('D');

    entity.hasRiscHeatSinkOverrideKit.set(true);
    expect(entity.entityTechAdvancements()).toHaveSize(baseSourceCount + 2);
    const riscTech = entity.entityTechAdvancements().at(-1);
    expect(riscTech?.techBase).toBe('IS');
    expect(riscTech?.dates).toEqual({ prototype: 3134 });
  });
});

describe('MekEntity patchwork armor', () => {
  it('supports assigning armor per location without parsing a unit file', () => {
    const entity = new BipedMekEntity();
    const reactive = new ArmorEquipment({
      id: 'IS Reactive', name: 'Reactive', type: 'armor',
      armor: { type: 'REACTIVE' },
      tech: { base: 'IS', rating: 'E', availability: { sl: 'X', sw: 'X', clan: 'E', da: 'D' } },
    });
    const standard = new ArmorEquipment({
      id: 'Standard Armor', name: 'Standard', type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All', rating: 'D', availability: { sl: 'C', sw: 'C', clan: 'C', da: 'C' } },
    });

    const uniform = new MountedArmor({ armor: standard, techBase: 'IS' });
    entity.setUniformArmor(uniform);
    entity.setArmorEquipmentAt('LA', reactive);
    entity.setArmorEquipmentAt('RA', standard, 'Clan');

    expect(entity.hasPatchworkArmor()).toBeTrue();
    expect(entity.armorAt('LA').armor).toBe(reactive);
    expect(entity.armorAt('RA').armor).toBe(standard);
    expect(entity.armorAt('RA').techBase).toBe('Clan');
    expect(entity.armorAt('CT')).toBe(uniform);
    expect(entity.implicitSystemEquipment()).not.toContain(reactive);

    entity.setArmorAt('LA', uniform);
    expect(entity.armorAt('LA')).toBe(uniform);
    expect(entity.hasPatchworkArmor()).toBeTrue();
    entity.setArmorAt('RA', uniform);
    expect(entity.hasPatchworkArmor()).toBeFalse();
  });

  it('rejects patchwork armor as a patchwork location', () => {
    const entity = new BipedMekEntity();
    const nested = new ArmorEquipment({
      id: 'Patchwork Armor', name: 'Patchwork', type: 'armor',
      armor: { type: 'PATCHWORK' },
      tech: { base: 'All', rating: 'E', availability: { sl: 'X', sw: 'X', clan: 'E', da: 'E' } },
    });

    expect(() => entity.setArmorEquipmentAt('LA', nested)).toThrowError(
      'Patchwork is an entity layout, not an installable location armor',
    );
  });
});

describe('MekEntity location structures', () => {
  it('provides one effective uniform structure at every active location', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);
    const standard = standardStructure(55);
    entity.setUniformStructure(standard);

    expect([...entity.structureByLocation().keys()]).toEqual(entity.locationOrder);
    expect([...entity.structureByLocation().values()].every(structure => structure === standard)).toBeTrue();
    expect(entity.tonnage()).toBe(55);
    expect(entity.hasHybridStructure()).toBeFalse();
  });

  it('derives Mek tonnage from the center torso structure', () => {
    const entity = new BipedMekEntity();
    entity.setUniformStructure(standardStructure(60));
    entity.setStructureAt('LA', standardStructure(70));

    expect(entity.hasHybridStructure()).toBeTrue();
    expect(entity.tonnage()).toBe(60);

    entity.setStructureAt('CT', standardStructure(80));
    expect(entity.tonnage()).toBe(80);
  });

  it('compares complete location structures by material and tonnage', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(60);
    const standard = standardStructure(60);
    const equivalentStandard = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      tech: { base: 'All' }, structure: { typeId: 0 },
    });
    const distinctStandard = new MountedStructure({ tonnage: 60, structure: equivalentStandard });
    const heavierStandard = standardStructure(70);
    const endo = new MountedStructure({ tonnage: 70, structure: TEST_IS_ENDO_STRUCTURE });
    entity.setUniformStructure(standard);

    entity.setStructureAt('LA', distinctStandard);
    expect(entity.hasHybridStructure()).toBeFalse();
    expect(entity.hasMixedStructureMaterials()).toBeFalse();

    entity.setStructureAt('RA', heavierStandard);
    expect(entity.hasHybridStructure()).toBeTrue();
    expect(entity.hasMixedStructureMaterials()).toBeFalse();

    entity.setStructureAt('RA', endo);
    expect(entity.hasMixedStructureMaterials()).toBeTrue();
    expect(entity.structureAt('RA')).toBe(endo);
    expect(entity.structureAt('CT')).toBe(standard);

    entity.setStructureAt('RA', standard);
    expect(entity.hasHybridStructure()).toBeFalse();
  });

  it('retains donor metadata only while normalized location structure remains unchanged', () => {
    const entity = new BipedMekEntity();
    const standard = standardStructure(60);
    entity.setUniformStructure(standard);
    entity.setStructureAt('LA', standard.withTonnage(70));
    entity.setStructureDonor('LA', { name: 'Donor', unitType: 'BattleMek' });

    entity.setStructureAt('LA', standardStructure(70));
    expect(entity.structureDonorAt('LA')).toEqual({ name: 'Donor', unitType: 'BattleMek' });

    entity.setStructureAt('LA', standard.withTonnage(75));
    expect(entity.structureDonorAt('LA')).toBeNull();
  });

  it('returns to non-Hybrid when the differing location is restored', () => {
    const entity = new BipedMekEntity();
    const standard = standardStructure(60);
    entity.setUniformStructure(standard);
    const endo = new MountedStructure({ tonnage: 70, structure: TEST_IS_ENDO_STRUCTURE });
    entity.setStructureAt('LA', endo);
    entity.setStructureDonor('LA', { name: 'Donor', unitType: null });

    entity.setStructureAt('LA', standard);

    expect(entity.hasHybridStructure()).toBeFalse();
    expect(entity.structureDonorAt('LA')).toBeNull();
    expect([...entity.structureByLocation().values()].every(structure => structure === standard)).toBeTrue();
  });
});

describe('MekEntity jumpMP', () => {
  it('reacts to jump jets, partial wings, and shields', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(55);
    entity.equipment.set([
      ...mountsWithFlag('F_JUMP_JET', 6),
      mountWithFlag('F_PARTIAL_WING'),
    ]);

    expect(entity.jumpMP()).toBe(8);
    expect(entity.installedJumpJetMP()).toBe(6);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('S_SHIELD_MEDIUM')]);
    expect(entity.jumpMP()).toBe(7);
    expect(entity.installedJumpJetMP()).toBe(6);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('F_MODULAR_ARMOR')]);
    expect(entity.jumpMP()).toBe(6);
    expect(entity.installedJumpJetMP()).toBe(6);

    entity.equipment.update(equipment => [...equipment, mountWithFlag('S_SHIELD_LARGE')]);
    expect(entity.jumpMP()).toBe(0);
    expect(entity.installedJumpJetMP()).toBe(6);
  });

  it('does not treat UMUs as jump movement', () => {
    const entity = new BipedMekEntity();
    entity.equipment.set(mountsWithFlag('F_UMU', 4));

    expect(entity.installedJumpJetMP()).toBe(0);
    expect(entity.jumpMP()).toBe(0);
    expect(entity.installedUmuMP()).toBe(4);
    expect(entity.umuMP()).toBe(4);
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

  it('weights FrankenMek jump jets by their donor location tonnage', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(100);
    entity.originalWalkMP.set(4);
    entity.setStructureAt('CT', standardStructure(100));
    entity.setStructureAt('LT', standardStructure(50));
    const jumpJet = new MiscEquipment({
      id: 'FrankenJumpJet', name: 'Jump Jet', type: 'misc',
      stats: { tonnage: 'variable' }, flags: ['F_JUMP_JET'],
    });
    entity.equipment.set(Array.from({ length: 4 }, () => mountedAt(jumpJet, 'LT')));

    expect(entity.installedJumpJetMP()).toBe(1);
    expect(entity.jumpMP()).toBe(1);
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

    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({
        id: 'Hardened Armor',
        name: 'Hardened',
        type: 'armor',
        armor: { type: 'HARDENED' },
      }),
      techBase: 'IS',
    }));
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
  return mountedAt(equipment, 'CT');
}

function mountedAt(equipment: Equipment, location: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-${nextMountId++}`,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}