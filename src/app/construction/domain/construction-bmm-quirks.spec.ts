// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Quirk } from '../../models/quirks.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { weaponQuirkAddress, weaponQuirkDefinition } from '../../models/entity/utils/weapon-quirks';
import { createConstructionEntity } from './construction-factory';
import {
  BMM_CHASSIS_QUIRKS,
  BMM_CHASSIS_WEAPON_QUIRKS,
  applyBmmQuirks,
  applyBmmWeaponQuirks,
} from './construction-bmm-quirks';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { normalizeLooseText } from '../../utils/string.util';

const registry = createTestEquipmentRegistry({});
const catalog = new Map<string, Quirk>(
  [
    'battle_fists_la',
    'battle_fists_ra',
    'barrel_fists_la',
    'barrel_fists_ra',
    'command_mech',
    'stable',
    'ubiquitous_is',
    'ubiquitous_clan',
    'cramped_cockpit',
    'obsolete',
    'poor_target_long',
    'combat_computer',
    'low_profile',
  ].map((key) => [key, { key, name: key, description: '', type: 'positive' }]),
);

function keys(entity: BaseEntity): string[] {
  return entity.quirks().map((entry) => entry.quirk.key);
}

describe('BMM chassis quirk application', () => {
  it('stores a recommendation for a new unassigned weapon without applying it in play', () => {
    const gauss = new WeaponEquipment({
      id: 'ISGaussRifle',
      name: 'Gauss Rifle',
      type: 'weapon',
      flags: ['F_MEK_WEAPON', 'F_BALLISTIC'],
      stats: { criticalSlots: 7 },
      weapon: { ammoType: 'GAUSS' },
    });
    const entity = createConstructionEntity('Biped', createTestEquipmentRegistry({ [gauss.id]: gauss }));
    entity.chassis.set('Cestus');
    const mount = addTestEquipment(entity, gauss, { allocation: { kind: 'unallocated' } });
    applyBmmWeaponQuirks(entity, [mount]);
    expect(entity.weaponQuirks()).toEqual([{ name: 'stable_weapon', ...weaponQuirkAddress(entity, mount) }]);
    expect(entity.applicableWeaponQuirks()).toEqual([]);
    applyBmmWeaponQuirks(entity, [mount]);
    expect(entity.weaponQuirks()).toHaveSize(1);
  });

  it('stores only chassis rows that assign quirks', () => {
    expect(BMM_CHASSIS_QUIRKS.filter((row) => row.quirks.length === 0)).toEqual([]);
  });

  it('adds the listed quirks, keeps suppressed fists stored, and reactivates them with the hands', () => {
    const entity = createConstructionEntity('Biped', registry) as MekWithArmsEntity;
    entity.chassis.set('Archer');
    entity.hasHandActuator.update((hands) => ({ ...hands, left: false, right: false }));

    applyBmmQuirks(entity, catalog);
    expect(keys(entity)).toEqual(['battle_fists_la', 'battle_fists_ra', 'command_mech', 'stable', 'ubiquitous_is']);
    expect(entity.applicableQuirks().map((entry) => entry.quirk.key)).toEqual([
      'command_mech',
      'stable',
      'ubiquitous_is',
    ]);

    entity.hasHandActuator.update((hands) => ({ ...hands, right: true }));
    expect(entity.applicableQuirks().map((entry) => entry.quirk.key)).toEqual([
      'battle_fists_ra',
      'command_mech',
      'stable',
      'ubiquitous_is',
    ]);
    expect(keys(entity)).toEqual(['battle_fists_la', 'battle_fists_ra', 'command_mech', 'stable', 'ubiquitous_is']);

    entity.hasHandActuator.update((hands) => ({ ...hands, left: true }));
    expect(entity.applicableQuirks().map((entry) => entry.quirk.key)).toEqual(keys(entity));
  });

  it('keeps quirks a chassis can never use while suppressing them from play', () => {
    const quad = createConstructionEntity('Quad', registry);
    quad.chassis.set('Archer');
    applyBmmQuirks(quad, catalog);
    expect(keys(quad)).toEqual(['battle_fists_la', 'battle_fists_ra', 'command_mech', 'stable', 'ubiquitous_is']);
    expect(quad.applicableQuirks().map((entry) => entry.quirk.key)).toEqual([
      'command_mech',
      'stable',
      'ubiquitous_is',
    ]);
  });

  it('resolves Clan alias chassis, tech-base keys and option values', () => {
    const alias = createConstructionEntity('Biped', registry);
    alias.chassis.set('Black Hawk');
    alias.clanName.set('Nova');
    applyBmmQuirks(alias, catalog);
    expect(keys(alias)).toEqual(['combat_computer', 'low_profile']);

    const crossbow = createConstructionEntity('Biped', registry);
    crossbow.chassis.set('Crossbow');
    applyBmmQuirks(crossbow, catalog);
    expect(crossbow.quirks().map((entry) => [entry.quirk.key, entry.value])).toEqual([
      ['obsolete', '2550,3070'],
      ['poor_target_long', undefined],
    ]);

    const cougar = createConstructionEntity('Biped', registry);
    cougar.chassis.set('Cougar');
    cougar.techBase.set('Clan');
    applyBmmQuirks(cougar, catalog);
    expect(keys(cougar)).toEqual(['ubiquitous_clan']);
  });

  it('only adds missing entries and leaves every other assignment untouched', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.chassis.set('Archer');
    entity.quirks.set([{ quirk: catalog.get('cramped_cockpit')! }]);
    applyBmmQuirks(entity, catalog);
    const assigned = entity.quirks();
    applyBmmQuirks(entity, catalog);
    expect(entity.quirks()).toEqual(assigned);
    expect(new Set(keys(entity)).size).toBe(keys(entity).length);
    expect(keys(entity)[0]).toBe('cramped_cockpit');
  });

  it('ignores chassis names on non-Mek units', () => {
    const tank = createConstructionEntity('Tank', registry);
    tank.chassis.set('Archer');
    applyBmmQuirks(tank, catalog);
    expect(tank.quirks()).toEqual([]);
  });
});

describe('BMM weapon quirk application', () => {
  it('resolves every specific table label against the real catalog and distinguishes Streak one-shots', async () => {
    const realRegistry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
    const names = new Set(
      Object.values(realRegistry.equipment).flatMap((equipment) =>
        [equipment.id, equipment.name, ...equipment.aliases].map(normalizeLooseText),
      ),
    );
    const families = new Set(['Autocannon', 'SRM', 'Shield']);
    for (const row of BMM_CHASSIS_WEAPON_QUIRKS) {
      for (const assignment of row.quirks) {
        for (const name of assignment.names ?? []) {
          expect(families.has(name) || names.has(normalizeLooseText(name)))
            .withContext(`${row.chassis}: ${name}`)
            .toBeTrue();
        }
      }
    }
    const entity = createConstructionEntity('Biped', realRegistry);
    entity.chassis.set('War Dog');
    for (const [index, id] of ['ISSRM2OS', 'ISStreakSRM2OS', 'ISStreakSRM2IOS', 'ISStreakSRM2'].entries()) {
      const equipment = realRegistry.equipment[id];
      expect(equipment).withContext(id).toBeDefined();
      addTestEquipment(entity, equipment, {
        allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: index }] },
      });
    }
    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks().map((entry) => [entry.name, entry.weaponName])).toEqual([
      ['accurate', 'ISStreakSRM2OS'],
      ['fast_reload', 'ISStreakSRM2OS'],
    ]);
  });
  const ac10 = new WeaponEquipment({
    id: 'AC/10',
    name: 'AC/10',
    type: 'weapon',
    flags: ['F_MEK_WEAPON'],
    stats: { tonnage: 12, criticalSlots: 10 },
    weapon: { heat: 3, damage: 10, ammoType: 'AC' },
  });
  const laser = new WeaponEquipment({
    id: 'Medium Laser',
    name: 'Medium Laser',
    type: 'weapon',
    flags: ['F_MEK_WEAPON', 'F_ENERGY', 'F_LASER'],
    stats: { tonnage: 1, criticalSlots: 1 },
    weapon: { heat: 3, damage: 5, ammoType: 'NA' },
  });
  const enforcer = () => {
    const entity = createConstructionEntity('Biped', createTestEquipmentRegistry({ ac10, laser }));
    entity.chassis.set('Enforcer');
    return entity;
  };

  it('adds rows to matching installed weapons without duplicating assignments', () => {
    const entity = enforcer();
    addTestEquipment(entity, ac10, {
      allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 0 }] },
    });
    addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LA', placements: [{ location: 'LA', slotIndex: 0 }] },
    });

    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks().map((entry) => entry.name)).toEqual([
      'fast_reload',
      'imp_cooling',
      'ammo_feed_problems',
    ]);
    expect(entity.applicableWeaponQuirks().map((entry) => entry.name)).toEqual([
      'fast_reload',
      'imp_cooling',
      'ammo_feed_problems',
    ]);

    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks().filter((entry) => entry.weaponName === ac10.id)).toHaveSize(3);
  });

  it('keeps explicit assignments and reacts to the weapon that actually matches', () => {
    const entity = enforcer();
    const acMount = addTestEquipment(entity, ac10, {
      allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 0 }] },
    });
    addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 0 }] },
    });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, acMount) }]);

    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks().map((entry) => entry.name)).toEqual([
      'accurate',
      'fast_reload',
      'imp_cooling',
      'ammo_feed_problems',
    ]);
    expect(entity.weaponQuirks()[0]).toEqual({ name: 'accurate', ...weaponQuirkAddress(entity, acMount) });
    expect(entity.weaponQuirks().every((entry) => entry.weaponName === ac10.id)).toBeTrue();
  });

  it('skips mounts without an addressable critical slot', () => {
    const entity = enforcer();
    addTestEquipment(entity, ac10, { allocation: { kind: 'unallocated' } });
    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks()).toEqual([]);
  });

  it('matches exact weapon aliases without treating shorter names as specific variants', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.chassis.set('Jackal');
    for (const [index, name] of ['PPC', 'ER PPC', 'Enhanced ER PPC'].entries()) {
      const equipment = new WeaponEquipment({
        id: `Test ${name}`,
        name: `Test ${name}`,
        aliases: [name],
        type: 'weapon',
        stats: { criticalSlots: 1 },
        weapon: { heat: 10, atClass: 'PPC' },
      });
      addTestEquipment(entity, equipment, {
        allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: index }] },
      });
    }
    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks().map((entry) => entry.weaponName)).toEqual(['Test ER PPC']);
  });
  it('matches explicit weapon-family rows using equipment facts', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.chassis.set('Mauler');
    for (const [index, atClass] of ['AC', 'LBX_AC', 'PPC'].entries()) {
      const equipment = new WeaponEquipment({
        id: `Family ${index}`,
        name: `Family ${index}`,
        type: 'weapon',
        stats: { criticalSlots: 1 },
        weapon: { atClass },
      });
      addTestEquipment(entity, equipment, {
        allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: index }] },
      });
    }
    applyBmmQuirks(entity, catalog);
    expect(entity.weaponQuirks().map((entry) => entry.weaponName)).toEqual(['Family 0', 'Family 1']);
  });
  it('only names real weapon quirk definitions', () => {
    for (const row of BMM_CHASSIS_WEAPON_QUIRKS) {
      for (const entry of row.quirks) {
        expect(weaponQuirkDefinition(entry.key)).withContext(`${row.chassis}: ${entry.key}`).toBeDefined();
      }
    }
  });
});
