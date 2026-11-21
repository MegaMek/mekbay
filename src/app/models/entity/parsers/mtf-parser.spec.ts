// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  AmmoEquipment,
  ArmorEquipment,
  EquipmentMap,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
} from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { ParseContext } from './parse-context';
import { MtfSourceLimitError, parseMtf } from './mtf-parser';
import { writeMtf } from '../writers/mtf-writer';
import { encodeNativeEntity } from '../write-entity';
import { evaluateMekRuntimeCapability } from '../../runtime/mek-runtime-capability';
import { parseEntity, UnsupportedNativeFormatError } from '../parse-entity';
import { buildEquipmentRegistry } from '../../../services/catalogs/equipment-catalog-builder';

const STANDARD_ARMOR = new ArmorEquipment({
  id: 'Standard Armor',
  name: 'Standard',
  type: 'armor',
  armor: { type: 'STANDARD' },
  tech: { base: 'All', level: 'Introductory' },
});
const STANDARD_ARMOR_REGISTRY = equipmentRegistry({});

describe('MTF parser identity', () => {
  it('preserves repeated force-generator availability and reports inverted years', () => {
    const source = minimalMtf().replace(
      'Config:Biped',
      'Config:Biped\navailability:2810-2839 CLAN:4\navailability:2840- CLAN:4\navailability:3100-3000 FS:5',
    );
    const context = new ParseContext('availability.mtf', STANDARD_ARMOR_REGISTRY);
    const entity = parseMtf(source, context);
    expect(entity.forceGeneratorAvailability()).toEqual([
      { startYear: 2810, endYear: 2839, availabilityCodes: 'CLAN:4' },
      { startYear: 2840, endYear: 0, availabilityCodes: 'CLAN:4' },
    ]);
    expect(context.warnings).toContain(
      jasmine.objectContaining({
        field: 'availability',
        message: 'Availability end year 3000 is before start year 3100',
      }),
    );
    const written = writeMtf(entity);
    expect(written).toContain('availability:2810-2839 CLAN:4\navailability:2840- CLAN:4');
    expect(
      parseMtf(written, new ParseContext('availability.mtf', STANDARD_ARMOR_REGISTRY)).forceGeneratorAvailability(),
    ).toEqual(entity.forceGeneratorAvailability());
  });

  it('warns about a field it does not keep', () => {
    const context = new ParseContext('unknown.mtf', STANDARD_ARMOR_REGISTRY);
    parseMtf(minimalMtf().replace('Config:Biped', 'Config:Biped\nfuturefield:42'), context);
    expect(context.warnings).toContain(jasmine.objectContaining({ field: 'futurefield' }));
  });

  it('preserves Force Generator mission roles', () => {
    const source = minimalMtf().replace('Config:Biped', 'Config:Biped\nmissionroles: fire_support,urban ');
    const entity = parseMtf(source, new ParseContext('roles.mtf', STANDARD_ARMOR_REGISTRY));
    expect(entity.missionRoles()).toBe('fire_support,urban');
    expect(writeMtf(entity)).toContain('\nmissionroles:fire_support,urban\n');
    entity.missionRoles.set('');
    expect(writeMtf(entity)).not.toContain('missionroles');
  });

  it('preserves an earlier original era and treats an era equal to introduction as unset', () => {
    const source = minimalMtf().replace('Config:Biped', 'Config:Biped\nera:3050\noriginal era:2750');
    const entity = parseMtf(source, new ParseContext('oem.mtf', STANDARD_ARMOR_REGISTRY));
    expect(entity.originalBuildYear()).toBe(2750);
    expect(writeMtf(entity)).toContain('original era:2750');
    const sameYear = parseMtf(
      source.replace('original era:2750', 'original era:3050'),
      new ParseContext('same-year.mtf', STANDARD_ARMOR_REGISTRY),
    );
    expect(sameYear.originalBuildYear()).toBe(-1);
    entity.originalBuildYear.set(entity.year());
    expect(writeMtf(entity)).not.toContain('original era:');
    expect(writeMtf(sameYear)).not.toContain('original era:');
  });

  it('bounds untrusted MTF source before parsing it', () => {
    const oversized = `chassis:${'x'.repeat(8 * 1024 * 1024)}`;

    expect(() => parseMtf(oversized, new ParseContext('oversized.mtf', STANDARD_ARMOR_REGISTRY))).toThrowError(
      MtfSourceLimitError,
    );
  });

  it('diagnoses junk-suffix integers instead of truncating them', () => {
    const context = new ParseContext('junk-number.mtf', STANDARD_ARMOR_REGISTRY);
    const entity = parseMtf(minimalMtf().replace('mass:20', 'mass:20tons'), context);

    expect(context.errors).toContain(
      jasmine.objectContaining({
        field: 'mass',
        message: 'Invalid integer "20tons"',
      }),
    );
    expect(entity.tonnage()).toBe(0);
  });

  it('rejects Mek BLK as an unsupported native format', () => {
    let error: unknown;
    try {
      parseEntity('<UnitType>\nBipedMek\n</UnitType>\n', 'invalid-mek.blk', STANDARD_ARMOR_REGISTRY);
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(
      jasmine.objectContaining<Partial<UnsupportedNativeFormatError>>({
        code: 'UNSUPPORTED_NATIVE_FORMAT',
        format: 'blk',
        unitType: 'BipedMek',
      }),
    );
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

    expect(parsed.diagnostics).toContain(
      jasmine.objectContaining({
        code: 'EQUIPMENT_NOT_FOUND',
        severity: 'error',
        field: 'RA',
        message: 'Equipment not found: "Missing Test Equipment"',
      }),
    );
    expect(parsed.entity.loadIssues()).toEqual(parsed.diagnostics);
    expect(Object.isFrozen(parsed.entity.loadIssues())).toBeTrue();
  });

  it('keeps weapon quirks for installed weapons and drops those whose weapon is missing', () => {
    const laser = new WeaponEquipment({
      id: 'Test Laser',
      name: 'Test Laser',
      type: 'weapon',
      stats: { criticalSlots: 1 },
    });
    const registry = equipmentRegistry({ [laser.id]: laser });
    const parsed = parseEntity(
      minimalMtf().replace(
        'armor:Standard(Inner Sphere)',
        'armor:Standard(Inner Sphere)\nweaponquirk:accurate:RA:0:Test Laser\n' +
          'weaponquirk:accurate:RA:3:Missing Laser\nRight Arm:\nTest Laser',
      ),
      'weapon-quirks.mtf',
      registry,
    );

    expect(parsed.entity.weaponQuirks()).toEqual([
      { name: 'accurate', location: 'RA', slot: 0, weaponName: 'Test Laser' },
    ]);
  });

  it('decodes optional Mek systems and writes their canonical MTF values', () => {
    const entity = parseMtf(
      minimalMtf('ejection:full head ejection system\n' + 'heat sink kit:risc heat sink override kit\n'),
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
      id: '1 Compact Heat Sink',
      name: '1 Compact Heat Sink',
      type: 'misc',
      flags: ['F_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
    });
    const registry = equipmentRegistry({ [compactHeatSink.id]: compactHeatSink });
    const entity = parseMtf(
      minimalMtf().replace('heat sinks:10 Single', 'heat sinks:10 Compact'),
      new ParseContext('test.mtf', registry),
    );

    expect(entity.heatSinkEquipment()).toBe(compactHeatSink);
    expect(entity.integralHeatSinks()).toEqual({ count: 8, equipment: compactHeatSink });
    expect(entity.equipment().filter((mount) => mount.allocation.kind !== 'engine').length).toBe(2);
    expect(entity.totalHeatSinks()).toBe(10);
  });

  it('preserves Freezers identified by critical slots under a Single header', () => {
    const singleHeatSink = new MiscEquipment({
      id: 'Heat Sink',
      name: 'Heat Sink',
      type: 'misc',
      flags: ['F_HEAT_SINK'],
    });
    const freezer = new MiscEquipment({
      id: 'ISDoubleHeatSinkFreezer',
      name: 'Double Heat Sink (Freezers)',
      type: 'misc',
      aliases: ['Freezers'],
      stats: { criticalSlots: 3 },
      flags: ['F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'],
    });
    const registry = equipmentRegistry({
      [singleHeatSink.id]: singleHeatSink,
      [freezer.id]: freezer,
    });
    const entity = parseMtf(
      minimalMtf().replace('heat sinks:10 Single', 'heat sinks:1 Single\nLeft Torso:\nFreezers\nFreezers\nFreezers'),
      new ParseContext('freezer.mtf', registry),
    );

    expect(entity.heatSinkEquipment()).toBe(singleHeatSink);
    expect(entity.equipment().filter((mount) => mount.equipment === freezer).length).toBe(1);
    expect(entity.integralHeatSinks()).toBeNull();
    expect(entity.totalHeatSinks()).toBe(1);
  });

  it('preserves installed Standard structure technology on an opposite-tech chassis', () => {
    const standardStructure = new StructureEquipment({
      id: 'Standard',
      name: 'Standard',
      type: 'structure',
      tech: { base: 'All' },
      structure: { typeId: 0 },
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
    expect(entity.structureAt('RA').structure).toEqual(
      jasmine.objectContaining({
        name: 'Endo Steel',
        techBase: 'IS',
      }),
    );
    expect(entity.structureDonorAt('LA')).toEqual({
      name: 'Donor Mek',
      unitType: 'BattleMek',
    });

    const written = writeMtf(entity);
    expect(written).toContain('\nstructure:Hybrid\n');
    expect(written).toContain('\nRA structure:IS Endo Steel:60\n');
    expect(written).toContain('\ndonor: Donor Mek\ndonor type: BattleMek\n');
  });

  it('derives engine critical slots and unspecified donor tonnages from the center torso', () => {
    for (const [center, other, engineSlots] of [[100, 105, 6], [105, 100, 3]]) {
      const entity = parseMtf(frankenMtf(`structure:Standard\nCT structure:${center}\nLA structure:${other}\n`),
        new ParseContext('franken-boundary.mtf', structureRegistry()));
      expect(entity.tonnage()).toBe(center);
      expect(entity.structureAt('RT').tonnage).toBe(center);
      expect(entity.structureAt('LA').tonnage).toBe(other);
      const ctEngineSlots = () => entity.criticalSlotGrid().get('CT')!
        .filter(slot => slot.type === 'system' && slot.systemType === 'Engine').length;
      expect(ctEngineSlots()).toBe(engineSlots);
      expect(entity.frankenMekDonorSizeIssues().map(issue => issue.location)).toEqual(['LA']);
      entity.setStructureAt('CT', entity.structureAt('CT').withTonnage(other));
      expect(ctEngineSlots()).toBe(center === 100 ? 3 : 6);
    }
  });

  it('ignores bare donor tonnages under a Hybrid structure line, as MtfFile does', () => {
    const entity = parseMtf(frankenMtf('structure:Hybrid\nCT structure:35\nLT structure:10\n'),
      new ParseContext('franken-hybrid.mtf', structureRegistry()));
    expect(entity.tonnage()).toBe(20);
    expect(entity.structureAt('LT').tonnage).toBe(20);
  });

  it('diagnoses malformed FrankenMek structure tonnage instead of coercing it to zero', () => {
    const ctx = new ParseContext('invalid-franken.mtf', structureRegistry());
    const entity = parseMtf(frankenMtf('structure:Standard\nLA structure:20.5\n'), ctx);

    expect(ctx.errors).toContain(
      jasmine.objectContaining({
        field: 'LA structure',
        message: 'Invalid structure tonnage "20.5"',
      }),
    );
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

  it('keeps MTF VGL front and rear facings distinct from rear mounting', () => {
    const vgl = new WeaponEquipment({
      id: 'Test VGL',
      name: 'Test VGL',
      type: 'weapon',
      flags: ['F_VGL'],
    });
    const registry = equipmentRegistry({ [vgl.id]: vgl });

    for (const [suffix, facing] of [
      ['F', 2],
      ['R', 3],
    ] as const) {
      const entity = parseMtf(
        `${minimalMtf()}\nLeft Torso:\nTest VGL (${suffix})\n`,
        new ParseContext(`vgl-${suffix}.mtf`, registry),
      );
      const mount = entity.equipment().find((candidate) => candidate.equipment === vgl);

      expect(mount?.facing).toBe(facing);
      expect(mount?.rearMounted).toBeFalse();
      expect(writeMtf(entity)).toContain(`\nTest VGL (${suffix})\n`);
    }
  });

  it('models QuadVee conversion gear as an intrinsic fixed system', () => {
    const context = new ParseContext('quadvee.mtf', STANDARD_ARMOR_REGISTRY);
    const entity = parseMtf(
      minimalMtf().replace('Config:Biped', 'Config:QuadVee\nmotive:Track') + quadVeeLegCriticals(),
      context,
    );

    expect(entity.chassisConfig).toBe('QuadVee');
    expect(context.errors.filter((error) => error.message.includes('Conversion Gear'))).toEqual([]);
    expect(entity.equipment().some((mount) => mount.equipmentId === 'Conversion Gear')).toBeFalse();

    for (const location of ['FLL', 'FRL', 'RLL', 'RRL'] as const) {
      expect(entity.criticalSlotGrid().get(location)?.[4]).toEqual(
        jasmine.objectContaining({
          type: 'system',
          systemType: 'Conversion Gear',
        }),
      );
    }

    const written = writeMtf(entity);
    expect(written.match(/^Conversion Gear$/gm)?.length).toBe(4);
  });

  it('does not add implicit Clan CASE where explicit CASE already protects the location', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE',
      name: 'CASE',
      type: 'misc',
      flags: ['F_CASE'],
    });
    const innerSphereCase = new MiscEquipment({
      id: 'ISCASE',
      name: 'CASE',
      type: 'misc',
      flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo' });
    const registry = equipmentRegistry({
      [clanCase.id]: clanCase,
      [innerSphereCase.id]: innerSphereCase,
      [ammo.id]: ammo,
    });
    const entity = parseMtf(clanMtf('Left Torso:\nISCASE\nTest Ammo'), new ParseContext('explicit-case.mtf', registry));

    expect(entity.equipment().filter((mount) => mount.equipment === clanCase)).toHaveSize(0);
    expect(entity.equipment().filter((mount) => mount.equipment === innerSphereCase)).toHaveSize(1);
  });

  it('respects Clan CASE opt-outs', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE',
      name: 'CASE',
      type: 'misc',
      flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo' });
    const registry = equipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      clanMtf('clancaseoptedoutlocs:LT\nLeft Torso:\nTest Ammo'),
      new ParseContext('case-opt-out.mtf', registry),
    );

    expect(entity.equipment().filter((mount) => mount.equipment === clanCase)).toHaveSize(0);
  });

  it('derives implicit Clan CASE for a Clan location containing explosive ammo', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE',
      name: 'CASE',
      type: 'misc',
      flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({
      id: 'Test Ammo',
      name: 'Test Ammo',
      type: 'ammo',
      stats: { explosive: true },
    });
    const registry = equipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(clanMtf('Right Torso:\nTest Ammo'), new ParseContext('explosive-ammo.mtf', registry));

    expect(entity.equipment().filter((mount) => mount.equipment === clanCase)).toHaveSize(0);
    expect([...entity.implicitClanCaseLocations()]).toEqual(['RT']);
  });

  it('derives implicit Clan CASE for explosive non-ammunition equipment', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE',
      name: 'CASE',
      type: 'misc',
      flags: ['F_CASE'],
    });
    const explosiveWeapon = new WeaponEquipment({
      id: 'Explosive Weapon',
      name: 'Explosive Weapon',
      type: 'weapon',
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

    expect(entity.equipment().filter((mount) => mount.equipment === clanCase)).toHaveSize(0);
    expect([...entity.implicitClanCaseLocations()].sort()).toEqual(['RA', 'RT']);
  });

  it('materializes both sides of a superheavy combined ammo slot', () => {
    const ammo = new AmmoEquipment({
      id: 'Test Ammo',
      name: 'Test Ammo',
      type: 'ammo',
      stats: { criticalSlots: 1 },
    });
    const entity = parseMtf(
      minimalMtf().replace('mass:20', 'mass:150') +
        'Right Arm:\nShoulder\nUpper Arm Actuator\nTest Ammo|Test Ammo (OMNIPOD)\n',
      new ParseContext('superheavy-ammo.mtf', equipmentRegistry({ [ammo.id]: ammo })),
    );

    const mounts = entity.equipment().filter((mount) => mount.equipmentId === ammo.id);
    expect(mounts).toHaveSize(2);
    expect(mounts.map((mount) => mount.placements)).toEqual([
      [{ location: 'RA', slotIndex: 2 }],
      [{ location: 'RA', slotIndex: 2 }],
    ]);
    expect(mounts.map((mount) => mount.omniPodMounted)).toEqual([true, true]);
    expect(entity.criticalSlotGrid().get('RA')?.[2]).toEqual(
      jasmine.objectContaining({
        type: 'equipment',
        mounts,
        omniPod: true,
      }),
    );
    expect(writeMtf(entity)).toContain('\nTest Ammo|Test Ammo (OMNIPOD)\n');
    expect(entity.validationResult().messages).not.toContain(
      jasmine.objectContaining({
        code: 'CRIT_SLOT_SHARING_INVALID',
      }),
    );
  });

  it('materializes consecutive single-slot variable cargo as distinct mounts', () => {
    const cargo = new MiscEquipment({
      id: 'Cargo',
      name: 'Cargo',
      type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' },
      flags: ['F_CARGO'],
    });
    const entity = parseMtf(
      minimalMtf() + 'Center Torso:\nCargo:SIZE:1.0\nCargo:SIZE:1.0\n',
      new ParseContext('separate-cargo.mtf', equipmentRegistry({ [cargo.id]: cargo })),
    );

    const mounts = entity.equipment().filter((mount) => mount.equipment === cargo);
    expect(mounts).toHaveSize(2);
    expect(mounts.map((mount) => mount.size)).toEqual([1, 1]);
    expect(mounts.map((mount) => mount.placedCriticalSlotCount)).toEqual([1, 1]);
  });

  it('preserves distinct sizes for consecutive variable cargo mounts', () => {
    const cargo = new MiscEquipment({
      id: 'Cargo',
      name: 'Cargo',
      type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' },
      flags: ['F_CARGO'],
    });
    const entity = parseMtf(
      minimalMtf() + 'Center Torso:\nCargo:SIZE:1.0\nCargo:SIZE:0.5\n',
      new ParseContext('mixed-cargo.mtf', equipmentRegistry({ [cargo.id]: cargo })),
    );

    const mounts = entity.equipment().filter((mount) => mount.equipment === cargo);
    expect(mounts).toHaveSize(2);
    expect(mounts.map((mount) => mount.size)).toEqual([1, 0.5]);
  });

  it('merges consecutive critical rows until a variable mount reaches its requirement', () => {
    const communications = new MiscEquipment({
      id: 'Communications Equipment',
      name: 'Communications Equipment',
      type: 'misc',
      stats: { criticalSlots: 'variable', tonnage: 'variable' },
      flags: ['F_COMMUNICATIONS'],
    });
    const entity = parseMtf(
      minimalMtf() +
        'Center Torso:\n' +
        Array.from({ length: 6 }, () => 'Communications Equipment:SIZE:3.0').join('\n') +
        '\n',
      new ParseContext('communications.mtf', equipmentRegistry({ [communications.id]: communications })),
    );

    const mounts = entity.equipment().filter((mount) => mount.equipment === communications);
    expect(mounts).toHaveSize(2);
    expect(mounts.map((mount) => mount.placedCriticalSlotCount)).toEqual([3, 3]);
    expect(mounts.map((mount) => mount.size)).toEqual([3, 3]);
  });

  it('retains both loads for repair when a non-superheavy slot illegally combines equipment', () => {
    const ammo = new AmmoEquipment({
      id: 'Test Ammo',
      name: 'Test Ammo',
      type: 'ammo',
      stats: { criticalSlots: 1 },
    });
    const entity = parseMtf(
      minimalMtf() + 'Right Arm:\nShoulder\nUpper Arm Actuator\nTest Ammo|Test Ammo\n',
      new ParseContext('normal-combined-ammo.mtf', equipmentRegistry({ [ammo.id]: ammo })),
    );

    expect(encodeNativeEntity(entity)).toContain('\nTest Ammo|Test Ammo\n');
    const admission = evaluateMekRuntimeCapability(entity);
    expect(admission.readiness).toBe('deferred');
    if (admission.readiness === 'deferred') {
      expect(admission.blockers.map(blocker => blocker.code)).toContain('CRIT_SLOT_SHARING_INVALID');
    }
    expect(entity.validationResult().messages).toContain(
      jasmine.objectContaining({
        code: 'CRIT_SLOT_SHARING_INVALID',
        location: 'RA',
      }),
    );
  });

  it('does not propagate implicit Clan CASE on an Inner Sphere unit with explicit Clan CASE', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE',
      name: 'CASE',
      type: 'misc',
      tech: { base: 'Clan' },
      flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({
      id: 'Test Ammo',
      name: 'Test Ammo',
      type: 'ammo',
      stats: { explosive: true },
    });
    const registry = equipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      minimalMtf().replace(
        'armor:Standard(Inner Sphere)',
        'armor:Standard(Inner Sphere)\nLeft Torso:\nClan CASE\nRight Torso:\nTest Ammo',
      ),
      new ParseContext('is-explicit-clan-case.mtf', registry),
    );

    expect(
      entity
        .equipment()
        .filter((mount) => mount.equipment === clanCase)
        .map((mount) => mount.location),
    ).toEqual(['LT']);
  });
});

describe('MTF material slots with the opposite tech base', () => {
  let catalog: EquipmentRegistry;
  beforeAll(async () => {
    catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  const slots = (location: string, name: string, count: number) =>
    `${location}:\n${Array.from({ length: count }, () => name).join('\n')}\n`;
  const placements = (entity: ReturnType<typeof parseMtf>, id: string) =>
    entity.equipment().filter((mount) => mount.equipmentId === id).map((mount) => mount.placements?.map((p) => p.location));

  it('converts uniform armor slots to the installed material and saves them corrected', () => {
    const context = new ParseContext('inverse-ff.mtf', catalog);
    const entity = parseMtf(
      minimalMtf().replace(
        'armor:Standard(Inner Sphere)',
        'armor:Ferro-Fibrous(Inner Sphere)\n' +
          slots('Left Arm', 'Clan Ferro-Fibrous', 7) +
          slots('Right Arm', 'Clan Ferro-Fibrous', 7),
      ),
      context,
    );

    expect(placements(entity, 'IS Ferro-Fibrous')).toEqual([[...Array(7).fill('LA'), ...Array(7).fill('RA')]]);
    expect(placements(entity, 'Clan Ferro-Fibrous')).toEqual([]);
    expect(context.warnings.filter((warning) => warning.code === 'MATERIAL_SLOT_TECH_BASE').length).toBe(1);
    expect(writeMtf(entity)).not.toContain('Clan Ferro-Fibrous');
  });

  it('keeps correct slots when an undesignated armor line takes the unit tech base', () => {
    const context = new ParseContext('undesignated-ff.mtf', catalog);
    const entity = parseMtf(
      minimalMtf()
        .replace('Config:Biped', 'Config:Biped\ntechbase:Clan')
        .replace('armor:Standard(Inner Sphere)', 'armor:Ferro-Fibrous\n' + slots('Left Arm', 'Clan Ferro-Fibrous', 7)),
      context,
    );

    expect(entity.uniformArmor()?.armor.id).toBe('Clan Ferro-Fibrous');
    expect(placements(entity, 'Clan Ferro-Fibrous')).toEqual([Array(7).fill('LA')]);
    expect(context.warnings.some((warning) => warning.code === 'MATERIAL_SLOT_TECH_BASE')).toBeFalse();
  });

  it('checks patchwork armor per location', () => {
    const entity = parseMtf(
      minimalMtf().replace(
        'armor:Standard(Inner Sphere)',
        'armor:Patchwork\nLA armor:Ferro-Fibrous(Clan):4\nRA armor:Ferro-Fibrous(Inner Sphere):4\n' +
          slots('Left Arm', 'IS Ferro-Fibrous', 1) +
          slots('Right Arm', 'IS Ferro-Fibrous', 2),
      ),
      new ParseContext('patchwork-ff.mtf', catalog),
    );

    expect(placements(entity, 'Clan Ferro-Fibrous')).toEqual([['LA']]);
    expect(placements(entity, 'IS Ferro-Fibrous')).toEqual([['RA', 'RA']]);
  });

  it('resolves unprefixed material slots to the material installed at their location', () => {
    const context = new ParseContext('unprefixed-ff.mtf', catalog);
    const entity = parseMtf(
      minimalMtf().replace(
        'armor:Standard(Inner Sphere)',
        'armor:Patchwork\nLA armor:Ferro-Fibrous(Clan):4\nRA armor:Ferro-Fibrous(Inner Sphere):4\n' +
          slots('Left Arm', 'Ferro-Fibrous', 1) +
          slots('Right Arm', 'Ferro-Fibrous', 2),
      ),
      context,
    );

    expect(placements(entity, 'Clan Ferro-Fibrous')).toEqual([['LA']]);
    expect(placements(entity, 'IS Ferro-Fibrous')).toEqual([['RA', 'RA']]);
    expect(context.errors.filter((error) => error.code === 'EQUIPMENT_NOT_FOUND')).toEqual([]);
  });

  it('checks hybrid structure per location', () => {
    const entity = parseMtf(
      frankenMtf(
        'structure:Hybrid\n' +
          'LA structure:Clan Endo Steel:20\nRA structure:IS Endo Steel:20\n' +
          'LT structure:Standard:20\nRT structure:Standard:20\nCT structure:Standard:20\n' +
          'HD structure:Standard:20\nLL structure:Standard:20\nRL structure:Standard:20\n',
      ).replace(
        'armor:Standard(Inner Sphere)',
        'armor:Standard(Inner Sphere)\n' + slots('Left Arm', 'IS Endo Steel', 1) + slots('Right Arm', 'IS Endo Steel', 2),
      ),
      new ParseContext('hybrid-endo.mtf', catalog),
    );

    expect(placements(entity, 'Clan Endo Steel')).toEqual([['LA']]);
    expect(placements(entity, 'IS Endo Steel')).toEqual([['RA', 'RA']]);
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
    .map((location) => `${location}:\nHip\nUpper Leg Actuator\nLower Leg Actuator\nFoot Actuator\nConversion Gear\n`)
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
    id: 'Standard',
    name: 'Standard',
    type: 'structure',
    tech: { base: 'All' },
    structure: { typeId: 0 },
  });
  const endo = new StructureEquipment({
    id: 'IS Endo Steel',
    name: 'Endo Steel',
    type: 'structure',
    tech: { base: 'IS' },
    structure: { typeId: 1 },
  });
  return equipmentRegistry({ [standard.id]: standard, [endo.id]: endo });
}

function equipmentRegistry(equipment: EquipmentMap): EquipmentRegistry {
  return new EquipmentRegistry({
    [STANDARD_ARMOR.id]: STANDARD_ARMOR,
    ...equipment,
  });
}

describe('MTF rules level on load', () => {
  let catalog: EquipmentRegistry;
  beforeAll(async () => {
    catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  const load = (rulesLevel: number, armor: string) =>
    parseEntity(
      minimalMtf()
        .replace('Config:Biped', `Config:Biped\nrules level:${rulesLevel}`)
        .replace('armor:Standard(Inner Sphere)', `armor:${armor}`),
      'rules.mtf',
      catalog,
    ).entity;

  it('raises a saved level below what the components require, as MegaMekLab does', () => {
    const entity = load(2, 'Reflective(Inner Sphere)');

    expect(entity.staticTechLevel()).toBe('Advanced');
    expect(entity.rulesLevel()).toBe(3);
    expect(encodeNativeEntity(entity)).toContain('\nrules level:3\n');
  });

  it('keeps a saved level above what the components require', () => {
    expect(load(4, 'Standard(Inner Sphere)').rulesLevel()).toBe(4);
  });

  it('raises combinations that need experimental rules, not only single components', () => {
    const loadMtf = (source: string) => parseEntity(source, 'combination.mtf', catalog).entity;
    const industrial = loadMtf(minimalMtf()
      .replace('Config:Biped', 'Config:Biped\nrules level:3')
      .replace('engine:100 Fusion Engine', 'engine:100 Fusion Engine\nstructure:IS Industrial')
      .replace('armor:Standard(Inner Sphere)', 'armor:Ferro-Fibrous(Inner Sphere)'));
    const iceBattleMek = loadMtf(minimalMtf().replace('engine:100 Fusion Engine', 'engine:100 ICE Engine'));

    expect(industrial.staticTechLevel()).toBe('Experimental');
    expect(industrial.rulesLevel()).toBe(4);
    expect(iceBattleMek.staticTechLevel()).toBe('Experimental');
    expect(iceBattleMek.rulesLevel()).toBe(4);
  });
});

describe('MTF jump mp line', () => {
  let catalog: EquipmentRegistry;
  beforeAll(async () => {
    catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  const mek = (torso: string, leftLeg: string, rightLeg: string) => `chassis:Jump Test
model:JT-1
Config:Biped
techbase:Clan
era:3080
rules level:3
mass:75
engine:300 Fusion Engine
heat sinks:10 Single
walk mp:4
jump mp:9
armor:Standard(Clan)
Left Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
Right Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
Left Torso:
${torso}
Right Torso:
${torso}
Left Leg:
Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
${leftLeg}
Right Leg:
Hip
Upper Leg Actuator
Lower Leg Actuator
Foot Actuator
${rightLeg}
`;

  // MegaMek and MegaMekLab store the number of jump jets, which TechManual prices; the wing bonus is not a jet.
  it('writes the number of jump jets, not jump MP raised by a partial wing', () => {
    const entity = parseEntity(mek('CLPartialWing\nCLPartialWing\nCLPartialWing', 'Jump Jet\nJump Jet', 'Jump Jet'),
      'wing.mtf', catalog).entity;

    expect(entity.maxJumpMP()).toBeGreaterThan(3);
    expect(encodeNativeEntity(entity)).toContain('\njump mp:3\n');
  });

  it('writes no jump MP for UMUs, as MegaMekLab does', () => {
    const entity = parseEntity(mek('-Empty-', 'UMU\nUMU', 'UMU\nUMU'), 'umu.mtf', catalog).entity;

    expect(encodeNativeEntity(entity)).toContain('\njump mp:0\n');
  });
});

describe('MTF weapon rows', () => {
  let catalog: EquipmentRegistry;
  beforeAll(async () => {
    catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  const rows = (location: string, lines: readonly string[]) => `${location}:\n${lines.join('\n')}\n\n`;
  const guns = (entity: ReturnType<typeof parseMtf>) => entity.equipment().filter((mount) => mount.equipment?.id === 'Autocannon/20')
    .map((mount) => mount.placements!.map((p) => `${p.location}${p.slotIndex + 1}`).join(','));

  it('reads a location as MegaMek does: empty rows close up and a waiting split takes the first matching row', () => {
    // MtfFile.remapCritDataAroundSystemSlots fills the free slots in file order, and the arm's split gun is still
    // waiting for a slot when the torso's first AC/20 row arrives.
    const source = minimalMtf() + 'Weapons:2\nAutocannon/20, Right Torso\nAutocannon/20, Right Torso\n\n'
      + rows('Right Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(9).fill('Autocannon/20')])
      + rows('Right Torso', [...Array(10).fill('Autocannon/20'), '-Empty-', 'Autocannon/20']);
    const context = new ParseContext('gapped.mtf', catalog);
    expect(guns(parseMtf(source, context))).toEqual([
      [...Array.from({ length: 9 }, (_, index) => `RA${index + 3}`), 'RT1'].join(','),
      Array.from({ length: 10 }, (_, index) => `RT${index + 2}`).join(','),
    ]);
    expect(context.warnings.filter((warning) => warning.code === 'MTF_WEAPON_COUNT_MISMATCH')).toEqual([]);
  });

  it('writes a split gun\'s torso part before the whole gun it shares the torso with, so both read back as placed', () => {
    const entity = parseMtf(minimalMtf()
      + rows('Right Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(9).fill('Autocannon/20')])
      + rows('Right Torso', Array(11).fill('Autocannon/20')), new ParseContext('packed.mtf', catalog));
    const placed = guns(entity);
    // Asking the editor's packer for the whole gun first still puts the arm gun's waiting part ahead of it.
    const [split, whole] = entity.equipment().filter((mount) => mount.equipment?.id === 'Autocannon/20');
    entity.arrangeEquipment('RT', [whole.mountId, split.mountId]);
    expect(guns(entity)).toEqual(placed);
    expect(guns(parseMtf(writeMtf(entity), new ParseContext('again.mtf', catalog)))).toEqual(placed);
  });

  it('armors a placed system by identity wherever the file lists its rows, as MtfFile does', () => {
    const entity = parseMtf(minimalMtf()
      // One armored row armors the whole gyro, and MtfFile matches the system name in any case.
      + rows('Center Torso', ['gyro (ARMORED)', 'Gyro', 'Gyro', 'Gyro', ...Array(6).fill('Fusion Engine')]), new ParseContext('gyro.mtf', catalog));
    const armored = [...entity.armoredSystemSlots()].filter((key) => key.startsWith('CT:'))
      .map((key) => entity.getSystemSlotsForLocation('CT')[Number(key.slice(3))]);
    expect(armored.map((slot) => slot.type === 'system' ? slot.systemType : slot.type)).toEqual(Array(4).fill('Gyro'));
  });

  it('finds a weapon quirk on any slot of its weapon in the packed rows, as MtfFile does', () => {
    const parse = (quirk: string) => parseEntity(minimalMtf().replace('armor:Standard(Inner Sphere)',
      `armor:Standard(Inner Sphere)\nweaponquirk:${quirk}`) + rows('Left Torso', ['-Empty-', 'Large Laser', 'Large Laser']),
    'quirk.mtf', catalog).entity as ReturnType<typeof parseMtf>;
    // The empty first row closes up, so the laser fills slots 0 and 1 and slot 2 is empty.
    for (const slot of [0, 1]) {
      const entity = parse(`accurate:LT:${slot}:Large Laser`);
      expect(entity.weaponQuirks()).toEqual([{ name: 'accurate', location: 'LT', slot: 0, weaponName: 'Large Laser' }]);
      expect(parseEntity(writeMtf(entity), 'again.mtf', catalog).entity.weaponQuirks()).toEqual(entity.weaponQuirks());
    }
    expect(parse('accurate:LT:2:Large Laser').weaponQuirks()).toEqual([]);
  });

  it('reads a split gun the same whatever order the file lists its sections in', () => {
    const arm = rows('Right Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(9).fill('Autocannon/20')]);
    const torso = rows('Right Torso', Array(11).fill('Autocannon/20'));
    expect(guns(parseMtf(minimalMtf() + torso + arm, new ParseContext('torso-first.mtf', catalog))))
      .toEqual(guns(parseMtf(minimalMtf() + arm + torso, new ParseContext('arm-first.mtf', catalog))));
  });

  it('numbers mounts in the order the file lists its sections, so saved state still names the same weapon', () => {
    // Saved runtime state addresses a component by its mount ID, so a file must keep the IDs it has always loaded with.
    const weaponIds = (source: string) => parseMtf(source, new ParseContext('order.mtf', catalog)).equipment()
      .filter((mount) => mount.equipment instanceof WeaponEquipment)
      .map((mount) => [mount.equipment!.name, Number(mount.mountId.slice(1))] as const);
    const left = rows('Left Torso', ['Medium Laser']);
    const right = rows('Right Torso', ['Large Laser', 'Large Laser']);
    const [rightFirstLarge, rightFirstMedium] = weaponIds(minimalMtf() + right + left);
    expect([rightFirstLarge[0], rightFirstMedium[0]]).toEqual(['Large Laser', 'Medium Laser']);
    expect(rightFirstLarge[1]).toBeLessThan(rightFirstMedium[1]);
    const [leftFirstMedium, leftFirstLarge] = weaponIds(minimalMtf() + left + right);
    expect([leftFirstMedium[0], leftFirstLarge[0]]).toEqual(['Medium Laser', 'Large Laser']);
    expect(leftFirstMedium[1]).toBeLessThan(leftFirstLarge[1]);
  });

  it('reads a mount tag only on equipment that splits over critical slots, as MtfFile does', () => {
    const entity = parseMtf(minimalMtf() + rows('Right Torso', ['Medium Laser#2', 'Medium Laser#2']), new ParseContext('lasers.mtf', catalog));
    expect(entity.equipment().filter((mount) => mount.equipment?.id === 'Medium Laser').length).toBe(2);
  });

  for (const splitRowsOnTop of [true, false]) {
    it(`keeps a split gun apart from a whole one in the torso with its rows ${splitRowsOnTop ? 'on top' : 'below'}`, () => {
      const split = [...Array(2).fill('Autocannon/20#1')];
      const whole = [...Array(10).fill('Autocannon/20#2')];
      const source = minimalMtf() + rows('Right Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(8).fill('Autocannon/20#1')])
        + rows('Right Torso', splitRowsOnTop ? [...split, ...whole] : [...whole, ...split]);
      const entity = parseMtf(source, new ParseContext('split.mtf', catalog));
      const layout = guns(entity);
      const written = writeMtf(entity);
      // The split gun shares the torso with the whole one, so only its rows are tagged (MegaMek MtfFile.mountTags)
      expect(written.match(/Autocannon\/20#1/gu)?.length).toBe(10);
      expect(written.includes('Autocannon/20#2')).toBeFalse();
      expect(guns(parseMtf(written, new ParseContext('again.mtf', catalog)))).toEqual(layout);
    });
  }

  it('keeps two guns split over the same locations apart by their #N tags, and writes the tags back', () => {
    const range = (location: string, from: number) => Array.from({ length: 5 }, (_, index) => `${location}${from + index}`);
    const source = minimalMtf()
      + rows('Right Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(5).fill('Autocannon/20#1'), ...Array(5).fill('Autocannon/20#2')])
      + rows('Right Torso', [...Array(5).fill('Autocannon/20#2'), ...Array(5).fill('Autocannon/20#1')]);
    const entity = parseMtf(source, new ParseContext('tagged.mtf', catalog));
    const tagged = [[...range('RA', 3), ...range('RT', 6)].join(','), [...range('RA', 8), ...range('RT', 1)].join(',')];
    expect(guns(entity)).toEqual(tagged);
    // Without the tags the first torso rows go to the first gun still waiting for slots, as in MtfFile.
    expect(guns(parseMtf(source.replace(/#\d/gu, ''), new ParseContext('untagged.mtf', catalog)))).not.toEqual(tagged);
    const written = writeMtf(entity);
    expect(written).toContain('Autocannon/20#2');
    expect(guns(parseMtf(written, new ParseContext('again.mtf', catalog)))).toEqual(tagged);
  });

  it('gives each enhancement the nearest weapon above it that can take it', () => {
    const load = (lines: readonly string[]) => parseEntity(minimalMtf().replace('Config:Biped', 'Config:Biped\nera:3150')
      + rows('Right Torso', lines), 'enhanced.mtf', catalog).entity as ReturnType<typeof parseMtf>;
    const carried = (entity: ReturnType<typeof parseMtf>) => entity.equipment().filter((mount) => mount.equipment instanceof WeaponEquipment)
      .map((weapon) => entity.getLinkingMounts(weapon).map((mount) => mount.equipment?.name).join('+'));
    // A laser takes any number of insulators and one pulse module.
    expect(carried(load(['Medium Laser', 'ISLaserInsulator', 'ISLaserInsulator', 'Medium Laser', 'ISLaserInsulator',
      'ISRISCLaserPulseModule', 'Medium Laser']))).toEqual(['Laser Insulator+Laser Insulator', 'Laser Insulator+RISC Laser Pulse Module', '']);
    // Every launcher carries one Artemis (TM p. 206): the second skips the launcher that already has one.
    expect(carried(load([...Array(3).fill('LRM 15'), ...Array(3).fill('LRM 15'), 'ISArtemisIV', 'ISArtemisIV'])))
      .toEqual(['Artemis IV FCS', 'Artemis IV FCS']);
    // With no weapon above it that can take it, an enhancement takes the first one in its location that can.
    expect(carried(load(['PPC Capacitor', ...Array(3).fill('PPC'), ...Array(3).fill('PPC')]))).toEqual(['PPC Capacitor', '']);
    // Insulators above every laser stack on the first laser once each laser has one.
    expect(carried(load(['ISLaserInsulator', 'ISLaserInsulator', 'Medium Laser'])))
      .toEqual(['Laser Insulator+Laser Insulator']);
    // A pulse module adds 2 heat (IO:AE p. 87); insulators take 1 off a laser only once, to a minimum of 1 (TO:AUE p. 134).
    expect(load(['Medium Laser', 'ISLaserInsulator', 'ISLaserInsulator']).heatGeneration()).toBe(2);
    expect(load(['Medium Laser', 'ISRISCLaserPulseModule', 'ISLaserInsulator']).heatGeneration()).toBe(4);
    expect(load(['Small Laser', 'ISLaserInsulator']).heatGeneration()).toBe(1);
    // The 2 heat is the modified laser's; a pulse module with no laser to modify adds none.
    expect(load([...Array(3).fill('PPC'), 'ISRISCLaserPulseModule']).heatGeneration()).toBe(10);
  });

  it('reads a split weapon at its first row in the enhancement\'s location, not where the weapon starts', () => {
    // The Extended LRM starts in the arm, but in the torso its rows stand between the LRM 5 and the Artemis.
    const entity = parseEntity(minimalMtf().replace('Config:Biped', 'Config:Biped\nera:3150')
      + rows('Left Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(3).fill('Extended LRM 20')])
      + rows('Left Torso', ['LRM 5', ...Array(5).fill('Extended LRM 20'), 'ISArtemisIV']), 'split.mtf', catalog).entity;
    const artemis = entity.equipment().find((mount) => mount.equipment?.id === 'ISArtemisIV')!;
    expect(entity.getLinkedMount(artemis)?.equipment?.id).toBe('Extended LRM 20');
  });

  it('links an enhancement in either location of a split weapon (TM pp. 57, 207)', () => {
    // The Artemis sits in the arm, the Extended LRM's other location.
    const entity = parseEntity(minimalMtf().replace('Config:Biped', 'Config:Biped\nera:3150')
      + rows('Left Arm', ['Shoulder', 'Upper Arm Actuator', ...Array(3).fill('Extended LRM 20'), 'ISArtemisIV'])
      + rows('Left Torso', Array(5).fill('Extended LRM 20')), 'split-arm.mtf', catalog).entity;
    const artemis = entity.equipment().find((mount) => mount.equipment?.id === 'ISArtemisIV')!;
    expect(entity.getLinkedMount(artemis)?.equipment?.id).toBe('Extended LRM 20');
  });

  it('loads a row with an unreadable mount tag as if it had none, and says so', () => {
    const context = new ParseContext('garbled.mtf', catalog);
    const entity = parseMtf(minimalMtf() + rows('Right Torso', ['Medium Laser#x', 'Medium Laser#007']), context);
    expect(entity.equipment().filter((mount) => mount.placements?.[0]?.location === 'RT').map((mount) => mount.equipment?.id))
      .toEqual(['Medium Laser', 'Medium Laser']);
    expect(context.warnings.filter((warning) => warning.code === 'MTF_MOUNT_TAG').length).toBe(2);
  });

  it('reads a mount tag only where it ends the row, so the row keeps its other modifiers', () => {
    const context = new ParseContext('modifiers.mtf', catalog);
    const entity = parseMtf(minimalMtf() + rows('Right Torso', ['Medium Laser (R)#x', 'Medium Laser#x (R)',
      'Autocannon/2#2 (ARMORED)']) + rows('Left Torso', ['Autocannon/2#2(ARMORED)']), context);
    const mounts = (id: string) => entity.equipment().filter((mount) => mount.equipmentId === id);
    // An unreadable tag ending the row is dropped, with a warning; the rear mounting before it stays.
    expect(mounts('Medium Laser').map((mount) => mount.rearMounted)).toEqual([true]);
    expect(context.warnings.filter((warning) => warning.code === 'MTF_MOUNT_TAG').length).toBe(1);
    // A # before the modifiers is part of the name, as in MtfFile (#([1-9]\d*)$), and the modifiers still apply,
    // with or without a space before them.
    expect(mounts('Medium Laser#x').map((mount) => mount.rearMounted)).toEqual([true]);
    expect(mounts('Autocannon/2#2').map((mount) => [mount.location, mount.armored])).toEqual([['RT', true], ['LT', true]]);
    expect(mounts('Autocannon/2').length).toBe(0);
  });

  it('armors a targeting computer whose rows in different locations disagree', () => {
    const context = new ParseContext('tc.mtf', catalog);
    const entity = parseMtf(minimalMtf() + rows('Left Torso', ['ISTargeting Computer'])
      + rows('Right Torso', ['ISTargeting Computer (ARMORED)']), context);
    expect(entity.equipment().filter((mount) => mount.equipment?.id === 'ISTargeting Computer').map((mount) => mount.armored)).toEqual([true]);
    expect(context.warnings.map((warning) => warning.code)).toContain('MTF_PARTIAL_COMPONENT_ARMOR');
  });

  it('armors a whole weapon whose rows disagree, and says so', () => {
    for (const lines of [['Large Laser', 'Large Laser (ARMORED)'], ['Large Laser (ARMORED)', 'Large Laser']]) {
      const context = new ParseContext('armor.mtf', catalog);
      const entity = parseMtf(minimalMtf() + rows('Left Torso', lines), context);
      expect(entity.equipment().filter((mount) => mount.equipment?.name === 'Large Laser').map((mount) => mount.armored)).toEqual([true]);
      expect(context.warnings.map((warning) => warning.code)).toContain('MTF_PARTIAL_COMPONENT_ARMOR');
    }
  });

  it('warns once for a component with only some armored rows, however many rows disagree', () => {
    const context = new ParseContext('armor.mtf', catalog);
    const lines = Array.from({ length: 10 }, (_, row) => row === 0 ? 'Autocannon/20 (ARMORED)' : 'Autocannon/20');
    const entity = parseMtf(minimalMtf() + rows('Left Torso', lines), context);
    expect(entity.equipment().filter((mount) => mount.equipment?.id === 'Autocannon/20').map((mount) => mount.armored)).toEqual([true]);
    expect(context.warnings.filter((warning) => warning.code === 'MTF_PARTIAL_COMPONENT_ARMOR').length).toBe(1);
  });

  it('warns when the Weapons count disagrees with the weapons the critical rows hold', () => {
    const source = (count: string) => minimalMtf()
      + (count ? `Weapons:${count}\nMedium Laser, Left Torso\nMedium Laser, Left Torso\n\n` : '')
      + rows('Left Torso', ['Medium Laser']);
    const warnings = (count: string) => {
      const context = new ParseContext('weapons.mtf', catalog);
      parseMtf(source(count), context);
      return context.warnings.filter((warning) => warning.code === 'MTF_WEAPON_COUNT_MISMATCH').map((warning) => warning.message);
    };
    expect(warnings('2')).toEqual(['The Weapons list names 2 weapons, but the critical slots hold 1.']);
    expect(warnings('1')).toEqual([]);
    expect(warnings('')).toEqual([]);
  });
});
