// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, ArmorEquipment, EquipmentMap, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { ParseContext } from './parse-context';
import { MtfSourceLimitError, parseMtf } from './mtf-parser';
import { writeMtf } from '../writers/mtf-writer';
import { encodeNativeEntity } from '../write-entity';
import { parseEntity, UnsupportedNativeFormatError } from '../parse-entity';

const STANDARD_ARMOR = new ArmorEquipment({
  id: 'Standard Armor',
  name: 'Standard',
  type: 'armor',
  armor: { type: 'STANDARD' },
  tech: { base: 'All', level: 'Introductory' },
});
const STANDARD_ARMOR_REGISTRY = equipmentRegistry({});

describe('MTF parser identity', () => {
  it('bounds untrusted MTF source before parsing it', () => {
    const oversized = `chassis:${'x'.repeat(8 * 1024 * 1024)}`;

    expect(() => parseMtf(
      oversized,
      new ParseContext('oversized.mtf', STANDARD_ARMOR_REGISTRY),
    )).toThrowError(MtfSourceLimitError);
  });

  it('diagnoses junk-suffix integers instead of truncating them', () => {
    const context = new ParseContext('junk-number.mtf', STANDARD_ARMOR_REGISTRY);
    const entity = parseMtf(minimalMtf().replace('mass:20', 'mass:20tons'), context);

    expect(context.errors).toContain(jasmine.objectContaining({
      field: 'mass', message: 'Invalid integer "20tons"',
    }));
    expect(entity.tonnage()).toBe(0);
  });

  it('rejects Mek BLK as an unsupported native format', () => {
    let error: unknown;
    try {
      parseEntity('<UnitType>\nBipedMek\n</UnitType>\n', 'invalid-mek.blk', STANDARD_ARMOR_REGISTRY);
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(jasmine.objectContaining<Partial<UnsupportedNativeFormatError>>({
      code: 'UNSUPPORTED_NATIVE_FORMAT',
      format: 'blk',
      unitType: 'BipedMek',
    }));
  });

  it('preserves an existing UUID', () => {
    const uuid = '019f6767-0dcb-7bb8-992f-aef08202f5e1';
    const entity = parseMtf(minimalMtf(`uuid:${uuid}\n`), new ParseContext('test.mtf', STANDARD_ARMOR_REGISTRY));

    expect(entity.uuid()).toBe(uuid);
  });

  it('generates a UUID when the file does not provide one', () => {
    const entity = parseMtf(minimalMtf(), new ParseContext('test.mtf', STANDARD_ARMOR_REGISTRY));

    expect(entity.uuid()).toBeTruthy();
  });

  it('attaches unresolved equipment errors to the parsed entity', () => {
    const parsed = parseEntity(
      `${minimalMtf()}Right Arm:\nMissing Test Equipment\n`,
      'missing-equipment.mtf',
      STANDARD_ARMOR_REGISTRY,
    );

    expect(parsed.diagnostics).toContain(jasmine.objectContaining({
      code: 'EQUIPMENT_NOT_FOUND',
      severity: 'error',
      field: 'RA',
      message: 'Equipment not found: "Missing Test Equipment"',
    }));
    expect(parsed.entity.loadIssues()).toEqual(parsed.diagnostics);
    expect(Object.isFrozen(parsed.entity.loadIssues())).toBeTrue();
  });

  it('decodes optional Mek systems and writes their canonical MTF values', () => {
    const entity = parseMtf(
      minimalMtf(
        'ejection:full head ejection system\n' +
        'heat sink kit:risc heat sink override kit\n',
      ),
      new ParseContext('optional-systems.mtf', STANDARD_ARMOR_REGISTRY),
    );

    expect(entity.hasFullHeadEjectionSystem()).toBe(true);
    expect(entity.hasRiscHeatSinkOverrideKit()).toBe(true);
    expect(writeMtf(entity)).toContain('\nejection:Full Head Ejection System\n');
    expect(writeMtf(entity)).toContain('\nheat sink kit:RISC Heat Sink Override Kit\n');
  });

  it('does not retain unknown optional Mek system strings', () => {
    const entity = parseMtf(
      minimalMtf('ejection:Unknown\nheat sink kit:Unknown\n'),
      new ParseContext('unknown-optional-systems.mtf', STANDARD_ARMOR_REGISTRY),
    );

    expect(entity.hasFullHeadEjectionSystem()).toBe(false);
    expect(entity.hasRiscHeatSinkOverrideKit()).toBe(false);
    expect(writeMtf(entity)).not.toContain('\nejection:');
    expect(writeMtf(entity)).not.toContain('\nheat sink kit:');
  });

  it('resolves the selected heat-sink technology to real equipment', () => {
    const compactHeatSink = new MiscEquipment({
      id: '1 Compact Heat Sink', name: '1 Compact Heat Sink', type: 'misc',
      flags: ['F_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
    });
    const registry = equipmentRegistry({ [compactHeatSink.id]: compactHeatSink });
    const entity = parseMtf(
      minimalMtf().replace('heat sinks:10 Single', 'heat sinks:10 Compact'),
      new ParseContext('test.mtf', registry),
    );

    expect(entity.heatSinkEquipment()).toBe(compactHeatSink);
    expect(entity.integralHeatSinks()).toEqual({ count: 8, equipment: compactHeatSink });
    expect(entity.equipment().filter(mount => mount.allocation.kind !== 'engine').length).toBe(2);
    expect(entity.totalHeatSinks()).toBe(10);
  });

  it('preserves Freezers identified by critical slots under a Single header', () => {
    const singleHeatSink = new MiscEquipment({
      id: 'Heat Sink', name: 'Heat Sink', type: 'misc', flags: ['F_HEAT_SINK'],
    });
    const freezer = new MiscEquipment({
      id: 'ISDoubleHeatSinkFreezer', name: 'Double Heat Sink (Freezers)', type: 'misc',
      aliases: ['Freezers'],
      stats: { criticalSlots: 3 },
      flags: ['F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'],
    });
    const registry = equipmentRegistry({
      [singleHeatSink.id]: singleHeatSink,
      [freezer.id]: freezer,
    });
    const entity = parseMtf(
      minimalMtf().replace(
        'heat sinks:10 Single',
        'heat sinks:1 Single\nLeft Torso:\nFreezers\nFreezers\nFreezers',
      ),
      new ParseContext('freezer.mtf', registry),
    );

    expect(entity.heatSinkEquipment()).toBe(singleHeatSink);
    expect(entity.equipment().filter(mount => mount.equipment === freezer).length).toBe(1);
    expect(entity.integralHeatSinks()).toBeNull();
    expect(entity.totalHeatSinks()).toBe(1);
  });

  it('preserves installed Standard structure technology on an opposite-tech chassis', () => {
    const standardStructure = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      tech: { base: 'All' }, structure: { typeId: 0 },
    });
    const registry = equipmentRegistry({ [standardStructure.id]: standardStructure });
    const entity = parseMtf(
      minimalMtf()
        .replace('Config:Biped', 'Config:Biped\ntechbase:Clan')
        .replace('engine:100 Fusion Engine', 'engine:100 Fusion Engine\nstructure:IS Standard'),
      new ParseContext('mixed-structure.mtf', registry),
    );

    expect(writeMtf(entity)).toContain('\nstructure:IS Standard\n');
  });

  it('models different Standard-part tonnages as Hybrid while preserving uniform-material MTF syntax', () => {
    const registry = structureRegistry();
    const entity = parseMtf(
      frankenMtf(
        'structure:Standard\n' +
        'LA structure:70\nRA structure:60\nLT structure:65\nRT structure:60\n' +
        'CT structure:60\nHD structure:60\nLL structure:60\nRL structure:60\n',
      ),
      new ParseContext('uniform-franken.mtf', registry),
    );

    expect(entity.hasHybridStructure()).toBeTrue();
    expect(entity.hasMixedStructureMaterials()).toBeFalse();
    expect(entity.structureByLocation().size).toBe(8);
    expect(entity.structureAt('LA').tonnage).toBe(70);
    expect(entity.structureAt('CT').structure.name).toBe('Standard');
    expect(entity.tonnage()).toBe(60);

    const written = writeMtf(entity);
    expect(written).toContain('\nstructure:Standard\n');
    expect(written).toContain('\nLA structure:70\n');
    expect(written).not.toContain('\nLA structure:Standard:70\n');
  });

  it('derives Hybrid from effective location structures and preserves donor metadata', () => {
    const entity = parseMtf(
      frankenMtf(
        'structure:Hybrid\n' +
        'LA structure:Standard:60\nRA structure:IS Endo Steel:60\n' +
        'LT structure:Standard:60\nRT structure:Standard:60\n' +
        'CT structure:Standard:60\nHD structure:Standard:60\n' +
        'LL structure:IS Endo Steel:60\nRL structure:IS Endo Steel:90\n' +
        '\nLeft Arm:\ndonor: Donor Mek\ndonor type: BattleMek\n',
      ),
      new ParseContext('hybrid-franken.mtf', structureRegistry()),
    );

    expect(entity.hasHybridStructure()).toBeTrue();
    expect(entity.hasMixedStructureMaterials()).toBeTrue();
    expect(entity.structureAt('RA').structure).toEqual(jasmine.objectContaining({
      name: 'Endo Steel',
      techBase: 'IS',
    }));
    expect(entity.structureDonorAt('LA')).toEqual({
      name: 'Donor Mek',
      unitType: 'BattleMek',
    });

    const written = writeMtf(entity);
    expect(written).toContain('\nstructure:Hybrid\n');
    expect(written).toContain('\nRA structure:IS Endo Steel:60\n');
    expect(written).toContain('\ndonor: Donor Mek\ndonor type: BattleMek\n');
  });

  it('diagnoses malformed FrankenMek structure tonnage instead of coercing it to zero', () => {
    const ctx = new ParseContext('invalid-franken.mtf', structureRegistry());
    const entity = parseMtf(
      frankenMtf('structure:Standard\nLA structure:20.5\n'),
      ctx,
    );

    expect(ctx.errors).toContain(jasmine.objectContaining({
      field: 'LA structure',
      message: 'Invalid structure tonnage "20.5"',
    }));
    expect(entity.structureAt('LA').tonnage).toBe(20);
  });

  it('always serializes a Mek in native MTF', () => {
    const entity = parseMtf(
      frankenMtf('structure:Standard\nLA structure:25\n'),
      new ParseContext('franken.mtf', structureRegistry()),
    );

    const encoded = encodeNativeEntity(entity);

    expect(encoded).toContain('\nConfig:Biped FrankenMek\n');
    expect(encoded).toContain('\nLA structure:25\n');
    expect(encoded).not.toContain('<UnitType>');
  });

  it('derives construction jump MP from equipment while preserving the source field', () => {
    const entity = parseMtf(
      minimalMtf().replace('jump mp:0', 'jump mp:5'),
      new ParseContext('construction-jump-mp.mtf', STANDARD_ARMOR_REGISTRY),
    );

    expect(entity.installedJumpJetMP()).toBe(0);
    expect(entity.jumpMP()).toBe(0);
    expect(writeMtf(entity)).toContain('\njump mp:5\n');
  });

  it('keeps MTF VGL front and rear facings distinct from rear mounting', () => {
    const vgl = new WeaponEquipment({
      id: 'Test VGL', name: 'Test VGL', type: 'weapon', flags: ['F_VGL'],
    });
    const registry = equipmentRegistry({ [vgl.id]: vgl });

    for (const [suffix, facing] of [['F', 2], ['R', 3]] as const) {
      const entity = parseMtf(
        `${minimalMtf()}\nLeft Torso:\nTest VGL (${suffix})\n`,
        new ParseContext(`vgl-${suffix}.mtf`, registry),
      );
      const mount = entity.equipment().find(candidate => candidate.equipment === vgl);

      expect(mount?.facing).toBe(facing);
      expect(mount?.rearMounted).toBeFalse();
      expect(writeMtf(entity)).toContain(`\nTest VGL (${suffix})\n`);
    }
  });

  it('models QuadVee conversion gear as an intrinsic fixed system', () => {
    const context = new ParseContext('quadvee.mtf', STANDARD_ARMOR_REGISTRY);
    const entity = parseMtf(
      minimalMtf()
        .replace('Config:Biped', 'Config:QuadVee\nmotive:Track')
        + quadVeeLegCriticals(),
      context,
    );

    expect(entity.chassisConfig).toBe('QuadVee');
    expect(context.errors.filter(error => error.message.includes('Conversion Gear'))).toEqual([]);
    expect(entity.equipment().some(mount => mount.equipmentId === 'Conversion Gear')).toBeFalse();

    for (const location of ['FLL', 'FRL', 'RLL', 'RRL']) {
      expect(entity.criticalSlotGrid().get(location)?.[4]).toEqual(jasmine.objectContaining({
        type: 'system',
        systemType: 'Conversion Gear',
      }));
    }

    const written = writeMtf(entity);
    expect(written.match(/^Conversion Gear$/gm)?.length).toBe(4);
  });

  it('does not add implicit Clan CASE where explicit CASE already protects the location', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const innerSphereCase = new MiscEquipment({
      id: 'ISCASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo' });
    const registry = equipmentRegistry({
      [clanCase.id]: clanCase,
      [innerSphereCase.id]: innerSphereCase,
      [ammo.id]: ammo,
    });
    const entity = parseMtf(
      clanMtf('Left Torso:\nISCASE\nTest Ammo'),
      new ParseContext('explicit-case.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase)).toHaveSize(0);
    expect(entity.equipment().filter(mount => mount.equipment === innerSphereCase)).toHaveSize(1);
  });

  it('respects Clan CASE opt-outs', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo' });
    const registry = equipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      clanMtf('clancaseoptedoutlocs:LT\nLeft Torso:\nTest Ammo'),
      new ParseContext('case-opt-out.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase)).toHaveSize(0);
  });

  it('derives implicit Clan CASE for a Clan location containing explosive ammo', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({
      id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', stats: { explosive: true },
    });
    const registry = equipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      clanMtf('Right Torso:\nTest Ammo'),
      new ParseContext('explosive-ammo.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase)).toHaveSize(0);
    expect([...entity.implicitClanCaseLocations()]).toEqual(['RT']);
  });

  it('derives implicit Clan CASE for explosive non-ammunition equipment', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const explosiveWeapon = new WeaponEquipment({
      id: 'Explosive Weapon', name: 'Explosive Weapon', type: 'weapon',
      stats: { criticalSlots: 8, explosive: true },
    });
    const registry = equipmentRegistry({
      [clanCase.id]: clanCase,
      [explosiveWeapon.id]: explosiveWeapon,
    });
    const entity = parseMtf(
      clanMtf(
        'Right Arm:\nExplosive Weapon\nExplosive Weapon\nExplosive Weapon\nExplosive Weapon\n' +
        'Right Torso:\nExplosive Weapon (Split)\nExplosive Weapon\nExplosive Weapon\nExplosive Weapon',
      ),
      new ParseContext('split-explosive.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase)).toHaveSize(0);
    expect([...entity.implicitClanCaseLocations()].sort()).toEqual(['RA', 'RT']);
  });

  it('materializes both sides of a superheavy combined ammo slot', () => {
    const ammo = new AmmoEquipment({
      id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', stats: { criticalSlots: 1 },
    });
    const entity = parseMtf(
      minimalMtf()
        .replace('mass:20', 'mass:150')
        + 'Right Arm:\nShoulder\nUpper Arm Actuator\nTest Ammo|Test Ammo (OMNIPOD)\n',
      new ParseContext('superheavy-ammo.mtf', equipmentRegistry({ [ammo.id]: ammo })),
    );

    const mounts = entity.equipment().filter(mount => mount.equipmentId === ammo.id);
    expect(mounts).toHaveSize(2);
    expect(mounts.map(mount => mount.placements)).toEqual([
      [{ location: 'RA', slotIndex: 2 }],
      [{ location: 'RA', slotIndex: 2 }],
    ]);
    expect(mounts.map(mount => mount.omniPodMounted)).toEqual([true, true]);
    expect(entity.criticalSlotGrid().get('RA')?.[2]).toEqual(jasmine.objectContaining({
      type: 'equipment', mounts, omniPod: true,
    }));
    expect(writeMtf(entity)).toContain('\nTest Ammo|Test Ammo (OMNIPOD)\n');
    expect(entity.validationResult().messages).not.toContain(jasmine.objectContaining({
      code: 'CRIT_SLOT_SHARING_INVALID',
    }));
  });

  it('materializes consecutive single-slot variable cargo as distinct mounts', () => {
    const cargo = new MiscEquipment({
      id: 'Cargo', name: 'Cargo', type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' }, flags: ['F_CARGO'],
    });
    const entity = parseMtf(
      minimalMtf() + 'Center Torso:\nCargo:SIZE:1.0\nCargo:SIZE:1.0\n',
      new ParseContext('separate-cargo.mtf', equipmentRegistry({ [cargo.id]: cargo })),
    );

    const mounts = entity.equipment().filter(mount => mount.equipment === cargo);
    expect(mounts).toHaveSize(2);
    expect(mounts.map(mount => mount.size)).toEqual([1, 1]);
    expect(mounts.map(mount => mount.placedCriticalSlotCount)).toEqual([1, 1]);
  });

  it('preserves distinct sizes for consecutive variable cargo mounts', () => {
    const cargo = new MiscEquipment({
      id: 'Cargo', name: 'Cargo', type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' }, flags: ['F_CARGO'],
    });
    const entity = parseMtf(
      minimalMtf() + 'Center Torso:\nCargo:SIZE:1.0\nCargo:SIZE:0.5\n',
      new ParseContext('mixed-cargo.mtf', equipmentRegistry({ [cargo.id]: cargo })),
    );

    const mounts = entity.equipment().filter(mount => mount.equipment === cargo);
    expect(mounts).toHaveSize(2);
    expect(mounts.map(mount => mount.size)).toEqual([1, 0.5]);
  });

  it('merges consecutive critical rows until a variable mount reaches its requirement', () => {
    const communications = new MiscEquipment({
      id: 'Communications Equipment', name: 'Communications Equipment', type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' }, flags: ['F_COMMUNICATIONS'],
    });
    const entity = parseMtf(
      minimalMtf() + 'Center Torso:\n' +
        Array.from({ length: 6 }, () => 'Communications Equipment:SIZE:3.0').join('\n') + '\n',
      new ParseContext('communications.mtf', equipmentRegistry({ [communications.id]: communications })),
    );

    const mounts = entity.equipment().filter(mount => mount.equipment === communications);
    expect(mounts).toHaveSize(2);
    expect(mounts.map(mount => mount.placedCriticalSlotCount)).toEqual([3, 3]);
    expect(mounts.map(mount => mount.size)).toEqual([3, 3]);
  });

  it('rejects combined equipment in a non-superheavy critical slot', () => {
    const ammo = new AmmoEquipment({
      id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', stats: { criticalSlots: 1 },
    });
    const entity = parseMtf(
      minimalMtf() + 'Right Arm:\nShoulder\nUpper Arm Actuator\nTest Ammo|Test Ammo\n',
      new ParseContext('normal-combined-ammo.mtf', equipmentRegistry({ [ammo.id]: ammo })),
    );

    expect(entity.validationResult().messages).toContain(jasmine.objectContaining({
      code: 'CRIT_SLOT_SHARING_INVALID', location: 'RA',
    }));
  });

  it('does not propagate implicit Clan CASE on an Inner Sphere unit with explicit Clan CASE', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', tech: { base: 'Clan' }, flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({
      id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', stats: { explosive: true },
    });
    const registry = equipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      minimalMtf().replace('armor:Standard(Inner Sphere)', 'armor:Standard(Inner Sphere)\nLeft Torso:\nClan CASE\nRight Torso:\nTest Ammo'),
      new ParseContext('is-explicit-clan-case.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase).map(mount => mount.location))
      .toEqual(['LT']);
  });
});

function minimalMtf(identity = ''): string {
  return `${identity}chassis:Test
model:TST-1
Config:Biped
mass:20
engine:100 Fusion Engine
heat sinks:10 Single
walk mp:5
jump mp:0
armor:Standard(Inner Sphere)
`;
}

function quadVeeLegCriticals(): string {
  return ['Front Left Leg', 'Front Right Leg', 'Rear Left Leg', 'Rear Right Leg']
    .map(location => `${location}:\nHip\nUpper Leg Actuator\nLower Leg Actuator\nFoot Actuator\nConversion Gear\n`)
    .join('');
}

function clanMtf(extra: string): string {
  return minimalMtf()
    .replace('Config:Biped', 'Config:Biped\ntechbase:Clan')
    .replace('armor:Standard(Inner Sphere)', `armor:Standard(Clan)\n${extra}`);
}

function frankenMtf(structure: string): string {
  return minimalMtf()
    .replace('Config:Biped', 'Config:Biped FrankenMek')
    .replace('engine:100 Fusion Engine', `engine:100 Fusion Engine\n${structure}`);
}

function structureRegistry(): EquipmentRegistry {
  const standard = new StructureEquipment({
    id: 'Standard', name: 'Standard', type: 'structure',
    tech: { base: 'All' }, structure: { typeId: 0 },
  });
  const endo = new StructureEquipment({
    id: 'IS Endo Steel', name: 'Endo Steel', type: 'structure',
    tech: { base: 'IS' }, structure: { typeId: 1 },
  });
  return equipmentRegistry({ [standard.id]: standard, [endo.id]: endo });
}

function equipmentRegistry(equipment: EquipmentMap): EquipmentRegistry {
  return new EquipmentRegistry({
    [STANDARD_ARMOR.id]: STANDARD_ARMOR,
    ...equipment,
  });
}
