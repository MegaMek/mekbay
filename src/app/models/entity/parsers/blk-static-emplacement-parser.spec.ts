// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { StaticEmplacementEntity } from '../entities/misc/static-emplacement-entity';
import { parseEntity } from '../parse-entity';
import { encodeNativeEntity } from '../write-entity';

describe('static emplacement BLK parser', () => {
  const standardArmor = new ArmorEquipment({
    id: 'Standard Armor', name: 'Standard', type: 'armor',
    armor: { type: 'STANDARD' }, tech: { base: 'All' },
  });
  const registry = new EquipmentRegistry({ [standardArmor.id]: standardArmor });

  it('rejects deprecated gun-emplacement BLKs', () => {
    expect(() => parseEntity('<UnitType>\nGunEmplacement\n</UnitType>', 'gun.blk', registry))
      .toThrowError('Unsupported BLK UnitType: "GunEmplacement"');
  });

  it('keeps BuildingEntity construction and dynamic level equipment facts', () => {
    const result = parseEntity(`
<UUID>
019f583e-a180-7c31-9022-0249f8fabff2
</UUID>
<UnitType>
BuildingEntity
</UnitType>
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
