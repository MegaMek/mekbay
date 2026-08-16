// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, type Equipment, WeaponEquipment } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { MountedAmmo, MountedEquipment, type MountedWeapon } from '../models/mounted-equipment.model';
import type { TestUnitOverrides } from '../testing/unit-test-helpers';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { WeaponType } from '../models/weapon-types.model';

interface EntryFixture {
    readonly entry: MountedEquipment;
    readonly owner: CBTForceUnit;
    readonly registry: EquipmentRegistry;
}

describe('MountedEquipment.getDisplayName', () => {
    it('keeps the raw name for an untyped mounted attack', () => {
        const entry = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'punch',
            name: 'Punch',
            states: new Map(),
        });

        expect(entry.getDisplayName()).toBe('Punch');
    });

    it('calculates every mount suffix in StandardInventoryEntry order', () => {
        const weapon = new WeaponEquipment({
            id: 'CLMicroLaser',
            name: 'Micro Laser',
            type: 'weapon',
        });
        const { entry } = createEntry(weapon, {
            unit: { type: 'Infantry', subtype: 'Battle Armor' },
            attributes: 'rearMounted="1" mekTurretMounted="1" sponsonTurretMounted="1" '
                + 'pintleTurretMounted="1" baMountLoc="body" SSW="1" dwpMounted="1"',
        });

        expect(entry.getDisplayName()).toBe(
            'Micro Laser (R, T, S, P, Body, SSW: Trooper 1, DWP)',
        );
    });

    it('does not duplicate the turret suffix for a BA turret-mounted Mek turret weapon', () => {
        const weapon = new WeaponEquipment({ id: 'BALaser', name: 'BA Laser', type: 'weapon' });
        const { entry } = createEntry(weapon, {
            unit: { type: 'Infantry', subtype: 'Battle Armor' },
            attributes: 'mekTurretMounted="1" baMountLoc="turret"',
        });

        expect(entry.getDisplayName()).toBe('BA Laser (T)');
    });

    it('omits the rear suffix for spheroid small craft and still calculates aerospace info', () => {
        const weapon = new WeaponEquipment({
            id: 'SmallLaser',
            name: 'Small Laser',
            type: 'weapon',
            flags: ['F_ENERGY', 'F_DIRECT_FIRE'],
            weapon: { damage: 3 },
        });
        const { entry } = createEntry(weapon, {
            unit: { type: 'Aero', subtype: 'Spheroid Small Craft' },
            attributes: 'rearMounted="1"',
        });

        expect(entry.getDisplayName()).toBe('Small Laser [DE]');
    });

    it('adds mixed-tech base only when another official equipment definition is ambiguous', () => {
        const clanLaser = new WeaponEquipment({
            id: 'CLERMediumLaser',
            name: 'ER Medium Laser',
            type: 'weapon',
            tech: { base: 'Clan', level: 'Standard' },
        });
        const innerSphereLaser = new WeaponEquipment({
            id: 'ISERMediumLaser',
            name: 'ER Medium Laser',
            type: 'weapon',
            tech: { base: 'IS', level: 'Standard' },
        });
        const { entry } = createEntry(clanLaser, {
            unit: { mixed: true },
            catalog: [innerSphereLaser],
        });

        expect(entry.getDisplayName()).toBe('ER Medium Laser (C)');
    });

    it('uses the short name and strips tech tags on non-mixed units', () => {
        const equipment = new WeaponEquipment({
            id: 'LongLaser',
            name: 'Extremely Long Laser Name (Clan)',
            shortName: 'Long Laser (Clan)',
            type: 'weapon',
        });
        const { entry } = createEntry(equipment);

        expect(entry.getDisplayName()).toBe('Long Laser');
    });

    it('calculates support-vehicle infantry weapon shot counts from mount size', () => {
        const weapon = new WeaponEquipment({
            id: 'InfantryRifle',
            name: 'Infantry Rifle',
            type: 'weapon',
            flags: ['F_INFANTRY', 'F_BALLISTIC'],
            infantry: { shots: 3 },
        });
        const { entry } = createEntry(weapon, {
            unit: { type: 'Tank', subtype: 'Support Vehicle' },
            attributes: 'mountSize="2"',
        });
        const { entry: defaultSizeEntry } = createEntry(weapon, {
            unit: { type: 'Tank', subtype: 'Support Vehicle' },
        });

        expect(entry.getDisplayName()).toBe('Infantry Rifle [6 shots]');
        expect(defaultSizeEntry.getDisplayName()).toBe('Infantry Rifle [3 shots]');
    });

    it('calculates the selected one-shot munition suffix from linked ammo', () => {
        const weapon = new WeaponEquipment({
            id: 'OneShotLauncher',
            name: 'One-Shot Launcher',
            type: 'weapon',
            flags: ['F_ONE_SHOT'],
            weapon: { ammoType: 'SRM', rackSize: 2 },
        });
        const standardAmmo = new AmmoEquipment({
            id: 'StandardAmmo',
            name: 'Standard Ammo',
            type: 'ammo',
            ammo: { type: 'SRM', rackSize: 2 },
        });
        const infernoAmmo = new AmmoEquipment({
            id: 'InfernoAmmo',
            name: 'Inferno Ammo',
            type: 'ammo',
            ammo: {
                type: 'SRM', rackSize: 2, baseAmmo: standardAmmo.id, mutatorName: '(Clan) Inferno',
            },
        });
        const fixture = createEntry(weapon, { catalog: [standardAmmo, infernoAmmo] });
        const ammoMount = new MountedAmmo({
            owner: fixture.owner,
            id: 'intrinsic-ammo',
            name: standardAmmo.id,
            equipment: standardAmmo,
            intrinsicOneShotAmmo: true,
            ammo: infernoAmmo.id,
        });
        fixture.entry.setLinkedEquipment([ammoMount]);

        expect(fixture.entry.getDisplayName()).toBe('One-Shot Launcher [Inferno]');
    });

    it('renders aerospace annotations from canonical effective weapon types', () => {
        const weapon = new WeaponEquipment({
            id: 'ISUltraAC5',
            name: 'Ultra AC/5',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType: 'AC_ULTRA', rackSize: 5, damage: 5 },
        });
        const { entry } = createEntry(weapon, {
            unit: { type: 'Aero', subtype: 'Aerospace Fighter' },
        });

        expect(entry.getDisplayName()).toBe('Ultra AC/5 [DB,R]');
    });

    it('uses mount-aware effective types for conditional aerospace X', () => {
        const ppc = new WeaponEquipment({
            id: 'ISPPC',
            name: 'PPC',
            type: 'weapon',
            flags: ['F_ENERGY', 'F_DIRECT_FIRE', 'F_PPC'],
            weapon: { damage: 10 },
        });
        const { entry } = createEntry(ppc, {
            unit: { type: 'Aero', subtype: 'Aerospace Fighter' },
            effectiveWeaponTypes: ['DE', 'X'],
        });

        expect(entry.getDisplayName()).toBe('PPC [DE,X]');
    });
});

function createEntry(
    equipment: Equipment,
    options: {
        unit?: TestUnitOverrides;
        catalog?: Equipment[];
        attributes?: string;
        effectiveWeaponTypes?: WeaponType[];
    } = {},
): EntryFixture {
    const unit = createEmptyUnit(options.unit);
    const catalog = [equipment, ...(options.catalog ?? [])];
    const registry = new EquipmentRegistry(Object.fromEntries(catalog.map(item => [item.id, item])));
    const owner = {
        getUnit: () => unit,
        getEquipmentRegistry: () => registry,
        getEffectiveWeaponTypes: (entry: MountedWeapon) => new Set(
            options.effectiveWeaponTypes ?? entry.getWeaponTypes(),
        ),
    } as unknown as CBTForceUnit;
    const id = `${equipment.id}@RA#0`;
    const element = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg"><g id="${id}" ${options.attributes ?? ''}/></svg>`,
        'image/svg+xml',
    ).documentElement.querySelector<SVGElement>('g')!;
    const entry = MountedEquipment.from({
        owner,
        id,
        name: equipment.id,
        equipment,
        locations: new Set(['RA']),
        el: element,
    });
    return { entry, owner, registry };
}
