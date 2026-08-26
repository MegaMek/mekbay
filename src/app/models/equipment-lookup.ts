// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, Equipment, EquipmentMap, WeaponEquipment } from './equipment.model';
import { isBattleArmorAmmo } from './equipment-platform.model';

function normalizeEquipmentLookupKey(name: string): string {
    return name.trim().toLowerCase();
}

/** Canonical equipment collection with an inseparable internal-name and alias index. */
export class EquipmentRegistry {
    readonly equipment: EquipmentMap;
    readonly #internalNames = new Map<string, Equipment>();
    readonly #aliases = new Map<string, Equipment>();
    readonly #variants = new Map<string, Equipment[]>();
    readonly #ammoByType = new Map<string, readonly AmmoEquipment[]>();
    readonly #ammoByWeapon = new Map<string, readonly AmmoEquipment[]>();

    constructor(equipment: EquipmentMap) {
        this.equipment = Object.freeze({ ...equipment });

        for (const [internalName, item] of Object.entries(this.equipment)) {
            const key = normalizeEquipmentLookupKey(internalName);
            if (!this.#internalNames.has(key)) this.#internalNames.set(key, item);
            this.addVariant(key, item);
        }

        for (const item of Object.values(this.equipment)) {
            for (const alias of item.aliases ?? []) {
                const key = normalizeEquipmentLookupKey(alias);
                this.#aliases.set(key, item);
                this.addVariant(key, item);
            }
        }

        this.indexAmmo();
    }

    get size(): number {
        return Object.keys(this.equipment).length;
    }

    get lookupKeyCount(): number {
        return new Set([...this.#internalNames.keys(), ...this.#aliases.keys()]).size;
    }

    findEquipment(name: string): Equipment | null {
        if (!name) return null;
        const exact = this.equipment[name];
        if (exact) return exact;

        const key = normalizeEquipmentLookupKey(name);
        return this.#internalNames.get(key) ?? this.#aliases.get(key) ?? null;
    }

    /** Returns the catalog definition of the ammo that a derived munition is based on. */
    getBaseAmmo(ammo: AmmoEquipment): AmmoEquipment | null {
        if (!ammo.baseAmmo) return null;
        const baseAmmo = this.findEquipment(ammo.baseAmmo);
        return baseAmmo instanceof AmmoEquipment ? baseAmmo : null;
    }

    findForTechBase(name: string, techBase: 'IS' | 'Clan'): Equipment | null {
        if (!name) return null;
        const exact = this.equipment[name];
        if (exact) return exact;
        const key = normalizeEquipmentLookupKey(name);
        const internalName = this.#internalNames.get(key);
        if (internalName) return internalName;
        const variants = this.#variants.get(key) ?? [];
        return variants.find(item => item.techBase === techBase)
            ?? variants.find(item => item.techBase === 'All')
            ?? this.findEquipment(name);
    }

    /** Returns catalog ammo matching a weapon's ammo type, rack size, and BA class. */
    getAmmoForWeapon(weapon: WeaponEquipment): readonly AmmoEquipment[] {
        if (weapon.ammoType === 'NA') return [];
        const battleArmor = weapon.hasWeaponTrait('battle-armor-weapon');
        if (weapon.rackSize <= 0) return this.#ammoByType.get(ammoTypeKey(weapon.ammoType, battleArmor)) ?? [];
        return this.#ammoByWeapon.get(ammoWeaponKey(weapon.ammoType, weapon.rackSize, battleArmor)) ?? [];
    }

    /** Returns catalog ammo in the same type and Battle Armor class for loadout selection. */
    getAmmoForAmmo(ammo: AmmoEquipment): readonly AmmoEquipment[] {
        return this.#ammoByType.get(ammoTypeKey(ammo.ammoType, isBattleArmorAmmo(ammo))) ?? [];
    }

    private addVariant(key: string, item: Equipment): void {
        const variants = this.#variants.get(key) ?? [];
        if (!variants.includes(item)) this.#variants.set(key, [...variants, item]);
    }

    private indexAmmo(): void {
        const byType = new Map<string, AmmoEquipment[]>();
        const byWeapon = new Map<string, AmmoEquipment[]>();
        const indexed = new Set<AmmoEquipment>();

        for (const item of Object.values(this.equipment)) {
            if (!(item instanceof AmmoEquipment) || indexed.has(item)) continue;
            indexed.add(item);
            const battleArmor = isBattleArmorAmmo(item);
            addIndexedAmmo(byType, ammoTypeKey(item.ammoType, battleArmor), item);
            addIndexedAmmo(byWeapon, ammoWeaponKey(item.ammoType, item.rackSize, battleArmor), item);
        }

        byType.forEach((ammo, key) => this.#ammoByType.set(key, Object.freeze(ammo)));
        byWeapon.forEach((ammo, key) => this.#ammoByWeapon.set(key, Object.freeze(ammo)));
    }
}

function ammoTypeKey(ammoType: string, battleArmor: boolean): string {
    return `${ammoType}:${battleArmor ? 'ba' : 'standard'}`;
}

function ammoWeaponKey(ammoType: string, rackSize: number, battleArmor: boolean): string {
    return `${ammoTypeKey(ammoType, battleArmor)}:${rackSize}`;
}

function addIndexedAmmo(index: Map<string, AmmoEquipment[]>, key: string, ammo: AmmoEquipment): void {
    const entries = index.get(key) ?? [];
    entries.push(ammo);
    index.set(key, entries);
}

export const EMPTY_EQUIPMENT_REGISTRY = new EquipmentRegistry({});
