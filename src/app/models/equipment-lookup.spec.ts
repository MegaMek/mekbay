// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentRegistry } from './equipment-lookup';
import { AmmoEquipment, WeaponEquipment, createEquipment, type EquipmentMap } from './equipment.model';

describe('equipment lookup', () => {
    const equipmentDb: EquipmentMap = {
        ISWidget: createEquipment({
            id: 'ISWidget',
            name: 'Widget',
            type: 'misc',
            aliases: ['IS Widget', 'Widget Alias'],
            tech: { base: 'IS' },
        }),
        'Widget Alias': createEquipment({
            id: 'Widget Alias',
            name: 'Exact Widget',
            type: 'misc',
            tech: { base: 'All' },
        }),
    };
    const registry = new EquipmentRegistry(equipmentDb);

    it('indexes internal names and aliases case-insensitively', () => {
        expect(registry.findEquipment('iswidget')?.id).toBe('ISWidget');
        expect(registry.findEquipment('IS WIDGET')?.id).toBe('ISWidget');
    });

    it('trims lookup keys', () => {
        expect(registry.findEquipment('  IS Widget  ')?.id).toBe('ISWidget');
    });

    it('never lets an alias shadow an internal name', () => {
        expect(registry.findEquipment('Widget Alias')?.id).toBe('Widget Alias');
        expect(registry.findEquipment('widget alias')?.id).toBe('Widget Alias');
    });

    it('is not invalidated by later changes to the source map', () => {
        const source = { ...equipmentDb };
        const isolatedRegistry = new EquipmentRegistry(source);
        delete source['ISWidget'];

        expect(isolatedRegistry.findEquipment('ISWidget')?.id).toBe('ISWidget');
    });

    it('returns null for unknown equipment', () => {
        expect(registry.findEquipment('Missing')).toBeNull();
    });

    it('indexes ammo by weapon type, rack size, and Battle Armor class', () => {
        const standard = createEquipment({ id: 'AC20 Ammo', name: 'AC/20 Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 20 } }) as AmmoEquipment;
        const otherRack = createEquipment({ id: 'AC10 Ammo', name: 'AC/10 Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 10 } }) as AmmoEquipment;
        const battleArmor = createEquipment({ id: 'BA AC20 Ammo', name: 'BA AC/20 Ammo', type: 'ammo', flags: ['F_BATTLEARMOR'], ammo: { type: 'AC', rackSize: 20 } }) as AmmoEquipment;
        const standardWeapon = createEquipment({ id: 'AC20', name: 'AC/20', type: 'weapon', weapon: { ammoType: 'AC', rackSize: 20 } }) as WeaponEquipment;
        const battleArmorWeapon = createEquipment({ id: 'BA AC20', name: 'BA AC/20', type: 'weapon', flags: ['F_BA_WEAPON'], weapon: { ammoType: 'AC', rackSize: 20 } }) as WeaponEquipment;
        const ammoRegistry = new EquipmentRegistry({
            [standard.id]: standard,
            [otherRack.id]: otherRack,
            [battleArmor.id]: battleArmor,
        });

        expect(ammoRegistry.getAmmoForWeapon(standardWeapon)).toEqual([standard]);
        expect(ammoRegistry.getAmmoForWeapon(battleArmorWeapon)).toEqual([battleArmor]);
        expect(ammoRegistry.getAmmoForAmmo(standard)).toEqual([standard, otherRack]);
    });

    it('rebuilds ammo indexes when a replacement registry is created for a changed catalog', () => {
        const initialAmmo = createEquipment({ id: 'AC20 Ammo', name: 'AC/20 Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 20 } }) as AmmoEquipment;
        const replacementAmmo = createEquipment({ id: 'AC20 Precision Ammo', name: 'AC/20 Precision Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 20 } }) as AmmoEquipment;
        const weapon = createEquipment({ id: 'AC20', name: 'AC/20', type: 'weapon', weapon: { ammoType: 'AC', rackSize: 20 } }) as WeaponEquipment;
        const initialRegistry = new EquipmentRegistry({ [initialAmmo.id]: initialAmmo });
        const replacementRegistry = new EquipmentRegistry({ [replacementAmmo.id]: replacementAmmo });

        expect(initialRegistry.getAmmoForWeapon(weapon)).toEqual([initialAmmo]);
        expect(replacementRegistry.getAmmoForWeapon(weapon)).toEqual([replacementAmmo]);
    });
});
