// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { StaticEmplacementEntity } from '../entities/misc/static-emplacement-entity';
import { parseEntity } from '../parse-entity';
import { encodeNativeEntity } from '../write-entity';

describe('static emplacement BLK parser', () => {
  it('keeps an explicit crew complement through native export and equipment changes', () => {
    const entity = parseEntity('<UnitType>\nBuildingEntity\n</UnitType>\n<coords>\n0,0,0\n</coords>\n<crew>\n100\n</crew>',
      'crew.blk', registry).entity as StaticEmplacementEntity;
    expect(entity.crew()).toBe(100);
    const reloaded = parseEntity(encodeNativeEntity(entity), 'crew.blk', registry).entity as StaticEmplacementEntity;
    expect(reloaded.crewCount()).toBe(100);
    reloaded.buildingClass.set(2);
    expect(reloaded.crew()).toBe(100);
    reloaded.crewCount.set(null);
    expect(reloaded.crew()).toBe(reloaded.buildingCrew().total);
    expect(encodeNativeEntity(reloaded)).not.toContain('<crew>');
  });
  const standardArmor = new ArmorEquipment({
    id: 'Standard Armor', name: 'Standard', type: 'armor',
    armor: { type: 'STANDARD' }, tech: { base: 'All' },
  });
  const registry = new EquipmentRegistry({ [standardArmor.id]: standardArmor });

  it('round-trips linked and independent doors with the same four-field format', () => {
    for (const linkGroup of [0, 9, 2147483647]) {
      const source = `<UnitType>\nBuildingEntity\n</UnitType>\n<coords>\n0,0,0\n</coords>
<building_doors>\n0,0,0/0;0;1;${linkGroup}\n0,0,0/0;1;1;${linkGroup}\n</building_doors>`;
      const entity = parseEntity(source, 'doors.blk', registry).entity as StaticEmplacementEntity;
      const encoded = encodeNativeEntity(entity);
      expect(encoded).toContain(`0,0,0/0;0;1;${linkGroup}\n0,0,0/0;1;1;${linkGroup}`);
      const loaded = parseEntity(encoded, 'doors.blk', registry).entity as StaticEmplacementEntity;
      expect(loaded.doors()).toEqual(entity.doors());
      expect(loaded.doors()[0].linkGroup).toBe(linkGroup || undefined);
    }
  });

  it('rejects malformed door rows', () => {
    for (const suffix of ['', ';', ';-1', ';2147483648', ';text', ';1;extra']) {
      const source = `<UnitType>\nBuildingEntity\n</UnitType>\n<coords>\n0,0,0\n</coords>
<building_doors>\n0,0,0/0;0;1${suffix}\n</building_doors>`;
      expect(() => parseEntity(source, 'doors.blk', registry)).toThrow();
    }
  });

  it('requires an explicit footprint', () => {
    for (const coords of ['', '<coords>\n</coords>', '<coords>\n1,2,3\n</coords>']) {
      expect(() => parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>\n${coords}`, 'building.blk', registry))
        .toThrowError('Building requires a non-empty coords block.');
    }
  });

  it('round-trips a ground reference without rewriting equipment, door or elevator floor indices', () => {
    const entity = parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>
<coords>\n0,0,0\n</coords>
<height>\n4\n</height>
<building_options>\nbase_level=-2\n</building_options>
<Level 1 0.0,0.0,0.0 Equipment>\nTest equipment\n</Level 1 0.0,0.0,0.0 Equipment>
<building_doors>\n0,0,0/2;0;1;0\n</building_doors>
<building_elevators>\n0,0,0;20;0=0,1=0,2=0,3=0,4=0\n</building_elevators>`, 'building.blk', registry).entity as StaticEmplacementEntity;
    expect(entity.locationOrder.map(location => entity.displayLocation(location))).toEqual(['0101/-2', '0101/-1', '0101/Ground', '0101/1']);
    const encoded = encodeNativeEntity(entity);
    expect(encoded).toContain('base_level=-2');
    expect(encoded).toContain('<Level 1 0.0,0.0,0.0 Equipment>');
    const loaded = parseEntity(encoded, 'building.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.buildingOptions().baseLevel).toBe(-2);
    expect(loaded.equipment()[0].location).toBe(entity.equipment()[0].location);
    expect(loaded.doors()).toEqual(entity.doors());
    expect(loaded.elevators()).toEqual(entity.elevators());
    expect(loaded.roofLevelLabel(4)).toBe('Roof (2)');
  });

  it('derives an omitted reference from site and roof cover while preserving an explicit zero', () => {
    for (const site of ['SURFACE', 'UNDERGROUND', 'UNDERWATER'] as const) {
      const entity = parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>
<coords>\n0,0,0\n</coords>
<height>\n3\n</height>
<building_options>\nsite=${site}\ndepth=2\n</building_options>`, 'building.blk', registry).entity as StaticEmplacementEntity;
      expect(entity.buildingOptions().baseLevel).toBeNull();
      expect(entity.levelLabel(0)).toBe(site === 'SURFACE' ? 'Ground' : '-5');
      expect(encodeNativeEntity(entity)).not.toContain('base_level');
      entity.buildingOptions.update(options => ({ ...options, baseLevel: 0 }));
      const loaded = parseEntity(encodeNativeEntity(entity), 'building.blk', registry).entity as StaticEmplacementEntity;
      expect(loaded.buildingOptions().baseLevel).toBe(0);
      expect(loaded.levelLabel(0)).toBe('Ground');
      loaded.buildingOptions.update(options => ({ ...options, baseLevel: null }));
      expect(loaded.roofLevelLabel(3)).toBe(site === 'SURFACE' ? 'Roof (3)' : 'Roof (-2)');
    }
  });

  it('reports non-integer and out-of-range ground references at the BLK boundary', () => {
    for (const value of ['-1.5', '2147483648', '-2147483649', 'NaN']) {
      const result = parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>\n<coords>\n0,0,0\n</coords>\n<building_options>\nbase_level=${value}\n</building_options>`, 'building.blk', registry);
      expect(result.diagnostics.some(issue => issue.field === 'building_options' && issue.severity === 'error')).toBeTrue();
    }
  });

  it('rejects deprecated gun-emplacement BLKs', () => {
    expect(() => parseEntity('<UnitType>\nGunEmplacement\n</UnitType>', 'gun.blk', registry))
      .toThrowError('Unsupported BLK UnitType: "GunEmplacement"');
  });

  it('rejects malformed authored placements rather than silently losing them on save', () => {
    for (const tag of ['building_doors', 'building_elevators', 'building_equipment_space', 'building_bay_space']) {
      expect(() => parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>\n<coords>\n0,0,0\n</coords>\n<${tag}>\nauthored placement\n</${tag}>`, 'building.blk', registry))
        .toThrowError(/building|Building/);
    }
    for (const side of [-1, 6]) expect(() => parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>\n<coords>\n0,0,0\n</coords>\n<building_doors>\n0,0,0/0;${side};1;0\n</building_doors>`, 'building.blk', registry))
      .toThrowError(/door facing/);
  });

  it('drops equipment outside the footprint or height instead of preserving it as unallocated', () => {
    const result = parseEntity(`<UnitType>\nBuildingEntity\n</UnitType>
<coords>\n0,0,0\n</coords>
<height>\n1\n</height>
<Level 0 0.0,0.0,0.0 Equipment>\nGround equipment\n</Level 0 0.0,0.0,0.0 Equipment>
<Level 1 0.0,0.0,0.0 Equipment>\nUpper equipment\n</Level 1 0.0,0.0,0.0 Equipment>
<Level 0 1.0,0.0,-1.0 Equipment>\nOutside equipment\n</Level 0 1.0,0.0,-1.0 Equipment>
<Unallocated Equipment>\nLoose equipment\n</Unallocated Equipment>`, 'building.blk', registry);
    expect(result.entity.equipment().map(mount => mount.equipmentId)).toEqual(['Ground equipment']);
    const encoded = encodeNativeEntity(result.entity);
    expect(encoded).not.toContain('Upper equipment');
    expect(encoded).not.toContain('Outside equipment');
    expect(encoded).not.toContain('Loose equipment');
    expect(encoded).not.toContain('Unallocated');
  });

  it('keeps BuildingEntity construction and dynamic level equipment facts', () => {
    const result = parseEntity(`
<UUID>
019f583e-a180-7c31-9022-0249f8fabff2
</UUID>
<UnitType>
BuildingEntity
</UnitType>
<coords>
0,0,0
</coords>
<Name>
Medium Sniper Gun Emplacement
</Name>
<Model>
(3075) (Fusion)
</Model>
<year>
3075
</year>
<type>
IS Level 3
</type>
<armor>
60
</armor>
<building_class>
3
</building_class>
<building_type>
2
</building_type>
<cf>
90
</cf>
<Level 0 0.0,0.0,0.0 Equipment>
Unknown Test Weapon
</Level 0 0.0,0.0,0.0 Equipment>
`, 'building.blk', registry);

    const entity = result.entity as StaticEmplacementEntity;
    expect(entity.entityType).toBe('BuildingEntity');
    expect(entity.buildingClass()).toBe(3);
    expect(entity.buildingType()).toBe(2);
    expect(entity.constructionFactor()).toBe(90);
    expect(entity.totalArmorPoints()).toBe(60);
    expect(entity.locationOrder).toEqual(['Level 0 0.0,0.0,0.0']);
    const encoded = encodeNativeEntity(entity);
    expect(encoded).toContain('<UnitType>\nBuildingEntity\n</UnitType>');
    expect(encoded).toContain('<Level 0 0.0,0.0,0.0 Equipment>\nUnknown Test Weapon\n</Level 0 0.0,0.0,0.0 Equipment>');
    const reloaded = parseEntity(encoded, 'building.blk', registry).entity as StaticEmplacementEntity;
    expect(reloaded.buildingClass()).toBe(3);
    expect(reloaded.constructionFactor()).toBe(90);
    expect(reloaded.totalArmorPoints()).toBe(60);
    expect(reloaded.equipment()[0]?.location).toBe('Level 0 0.0,0.0,0.0');
  });
});
