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

  it('loads and writes a GunEmplacement as its own catalog family', () => {
    const result = parseEntity(`
<UUID>
019f583e-b5e8-7032-b925-ba6c429a0687
</UUID>
<UnitType>
GunEmplacement
</UnitType>
<Name>
Medium Sniper Turret
</Name>
<Model>
(3075)
</Model>
<year>
3075
</year>
<type>
IS Level 3
</type>
<GUNS Equipment>
Unknown Test Weapon
</GUNS Equipment>
`, 'gun.blk', registry);

    expect(result.entity instanceof StaticEmplacementEntity).toBeTrue();
    expect(result.entity.entityType).toBe('GunEmplacement');
    expect(result.entity.unitType()).toBe('Gun Emplacement');
    expect(result.entity.equipment()[0]?.allocation).toEqual({ kind: 'location', location: 'Guns' });
    const encoded = encodeNativeEntity(result.entity);
    expect(encoded).toContain('<UnitType>\nGunEmplacement\n</UnitType>');
    expect(encoded).toContain('<GUNS Equipment>\nUnknown Test Weapon\n</GUNS Equipment>');
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
  });
});
