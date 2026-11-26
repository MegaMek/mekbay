// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ArmorEquipment, WeaponEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { writeBlkVehicle } from '../writers/blk-vehicle-writer';
import { BuildingBlock } from './building-block';
import { parseBlkVehicle } from './blk-vehicle-parser';
import { parseEntity } from '../parse-entity';
import { ParseContext } from './parse-context';
import { encodeNativeEntity } from '../write-entity';
import { buildEquipmentRegistry } from '../../../services/catalogs/equipment-catalog-builder';
import { calculateHeatNeutralRequirement } from '../utils/cost/common';

describe('BLK vehicle parser', () => {
  const standardArmor = new ArmorEquipment({
    id: 'Standard Armor',
    name: 'Standard',
    type: 'armor',
    armor: { type: 'STANDARD' },
    tech: { base: 'All' },
  });
  const registry = new EquipmentRegistry({ [standardArmor.id]: standardArmor });

  for (const motive of ['Rail', 'MagLev']) {
    it(`accepts ${motive} support vehicles without an unknown-motive warning`, () => {
      const context = new ParseContext('rail-support.blk', registry);
      const source = vehicleBlk('')
        .replace('<UnitType>\nTank\n', '<UnitType>\nSupportTank\n')
        .replace('<motion_type>\nTracked\n', `<motion_type>\n${motive}\n`);
      const entity = parseBlkVehicle(new BuildingBlock(source), context);

      expect(entity.motiveType()).toBe(motive);
      expect(context.diagnostics.filter((issue) => issue.field === 'motion_type')).toEqual([]);
      expect(writeBlkVehicle(entity)).toContain(`<motion_type>\n${motive}\n</motion_type>`);
    });
  }

  it("reads and writes MegaMek's canonical extra_seats key", () => {
    const entity = parseBlkVehicle(
      new BuildingBlock(vehicleBlk('<extra_seats>\n3\n</extra_seats>')),
      new ParseContext('extra-seats.blk', registry),
    );

    expect(entity.extraSeats()).toBe(3);
    expect(writeBlkVehicle(entity)).toContain('<extra_seats>\n3\n</extra_seats>');
  });

  it('reads a fuel name MegaMek does not know as petrochemicals and reports it', () => {
    const known = new ParseContext('alcohol.blk', registry);
    const fuel = (name: string) => new BuildingBlock(vehicleBlk(`<fuelType>\n${name}\n</fuelType>`));
    expect(parseBlkVehicle(fuel('ALCOHOL'), known).fuelType()).toBe('ALCOHOL');
    expect(known.diagnostics.filter((issue) => issue.field === 'fuelType')).toEqual([]);

    const unknown = new ParseContext('coal.blk', registry);
    const entity = parseBlkVehicle(fuel('COAL'), unknown);
    expect(entity.fuelType()).toBe('PETROCHEMICALS');
    expect(unknown.diagnostics.filter((issue) => issue.field === 'fuelType').length).toBe(1);
  });

  it('accepts the historical camel-case alias but canonicalizes it on write', () => {
    const entity = parseBlkVehicle(
      new BuildingBlock(vehicleBlk('<extraSeats>\n2\n</extraSeats>')),
      new ParseContext('legacy-extra-seats.blk', registry),
    );
    const written = writeBlkVehicle(entity);

    expect(entity.extraSeats()).toBe(2);
    expect(written).toContain('<extra_seats>\n2\n</extra_seats>');
    expect(written).not.toContain('<extraSeats>');
  });

  describe('weapon enhancements', () => {
    let catalog: EquipmentRegistry;
    beforeAll(async () => {
      catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
    });
    const load = (lines: readonly string[]) => parseEntity(vehicleBlk(`<Front Equipment>\n${lines.join('\n')}\n</Front Equipment>\n`),
      'enhanced.blk', catalog).entity;
    const carried = (entity: ReturnType<typeof load>) => entity.equipment().filter((mount) => mount.equipment instanceof WeaponEquipment)
      .map((weapon) => entity.getLinkingMounts(weapon).length);

    it('gives each enhancement the weapon listed above it, and keeps that through a save', () => {
      const entity = load(['Medium Laser', 'ISLaserInsulator', 'ISLaserInsulator', 'Medium Laser', 'ISLaserInsulator',
        'ISRISCLaserPulseModule', 'Medium Laser']);
      expect(carried(entity)).toEqual([2, 2, 0]);
      expect(carried(parseEntity(encodeNativeEntity(entity), 'again.blk', catalog).entity)).toEqual([2, 2, 0]);
    });

    it('sinks the pulse-mode heat of the laser a pulse module modifies, and nothing for a module without one', () => {
      // IO:AE p. 87: a vehicle mounts heat sinks for the modified laser's extra 2 heat.
      expect(calculateHeatNeutralRequirement(load(['Medium Laser', 'ISRISCLaserPulseModule']))).toBe(5);
      expect(calculateHeatNeutralRequirement(load(['ISRISCLaserPulseModule']))).toBe(0);
    });
  });

  it('drops a weapon quirk whose weapon is missing from the file', () => {
    const parsed = parseEntity(
      vehicleBlk('<weaponquirks>\naccurate:FR:0:Missing Laser\n</weaponquirks>'),
      'missing-weapon-quirk.blk',
      registry,
    );

    expect(parsed.entity.weaponQuirks()).toEqual([]);
  });

  it('round trips faction and embedded presentation bytes', () => {
    const entity = parseBlkVehicle(
      new BuildingBlock(
        vehicleBlk('<faction>\nDC\n</faction>\n<icon>\nabc\n</icon>\n<fluffimage>\ndef\n</fluffimage>'),
      ),
      new ParseContext('metadata.blk', registry),
    );
    const written = writeBlkVehicle(entity);

    expect(entity.faction()).toBe('DC');
    expect(entity.iconEncoded()).toBe('abc');
    expect(entity.fluffImageEncoded()).toBe('def');
    expect(written).toContain('<faction>\nDC\n</faction>');
    expect(written).toContain('<icon>\nabc\n</icon>');
    expect(written).toContain('<fluffimage>\ndef\n</fluffimage>');
  });

  for (const tonnage of [20, 150]) {
    for (const turrets of [0, 1, 2]) {
      it(`preserves all armor through repeated saves for a ${tonnage}-ton tank with ${turrets} turrets`, () => {
        const armor = Array.from({ length: (tonnage > 100 ? 6 : 4) + turrets }, (_, index) => 10 + index);
        let source = vehicleBlk('', tonnage, armor);
        for (let cycle = 0; cycle < 3; cycle++) {
          const entity = parseBlkVehicle(new BuildingBlock(source), new ParseContext('armor.blk', registry));
          if (turrets === 2) {
            expect(entity.armorValues().get('Rear Turret')?.front).toBe(armor[armor.length - 2]);
            expect(entity.armorValues().get('Front Turret')?.front).toBe(armor[armor.length - 1]);
          }
          source = writeBlkVehicle(entity);
          expect(new BuildingBlock(source).getDataAsInt('armor')).toEqual(armor);
        }
      });
    }
  }
});

function vehicleBlk(extraSeats: string, tonnage = 20, armor: readonly number[] = [1, 1, 1, 1]): string {
  return `<UnitType>
Tank
</UnitType>
<Name>
Test Tank
</Name>
<year>
3075
</year>
<type>
IS Level 2
</type>
<motion_type>
Tracked
</motion_type>
<tonnage>
${tonnage}
</tonnage>
<cruiseMP>
4
</cruiseMP>
<engine_type>
0
</engine_type>
<armor_type>
0
</armor_type>
<armor>
${armor.join('\n')}
</armor>
${extraSeats}`;
}
