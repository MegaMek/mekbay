/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Unit } from "./units.model";

/*
 * Author: Drake
 */

export type TechBase = 'IS' | 'Clan' | 'All';
export type EquipmentType = 'weapon' | 'ammo' | 'misc';

export interface TechDates {
    t?: string;  // Prototype
    p?: string;  // Production
    c?: string;  // Common
    x?: string;  // Extinct
    r?: string;  // Reintroduced
}

export interface EquipmentDates {
    is: TechDates;
    clan: TechDates;
    mixed: TechDates;
}

export interface EquipmentRating {
    is?: string;
    clan?: string;
}


export class Equipment {
    internalName: string;
    name: string;
    shortName: string;
    type: EquipmentType;
    cost: string;
    level: string;
    rating: EquipmentRating;
    dates: EquipmentDates;
    tonnage: string;
    rulesRefs: string;
    bv: number | string;
    critSlots: number | string;
    svSlots: number;
    tankSlots: number;
    techBase: TechBase;
    hittable: boolean;
    spreadable: boolean;
    flags: Set<string>;
    
    constructor(data: Partial<Equipment> & { internalName: string; name: string; type: EquipmentType }) {
        // Required fields
        this.internalName = data.internalName;
        this.name = data.name;
        this.type = data.type;
        
        // Simple fields with defaults
        this.shortName = data.shortName ?? data.name;
        this.cost = data.cost ?? '0';
        this.level = data.level ?? 'Standard';
        this.tonnage = data.tonnage ?? '0';
        this.rulesRefs = data.rulesRefs ?? '';
        this.bv = data.bv ?? 0;
        this.critSlots = data.critSlots ?? 0;
        this.svSlots = data.svSlots ?? -1;
        this.tankSlots = data.tankSlots ?? -1;
        this.techBase = data.techBase ?? 'IS';
        this.hittable = data.hittable ?? true;
        this.spreadable = data.spreadable ?? false;
        
        // Complex fields
        this.rating = data.rating ?? {};
        this.dates = data.dates ?? {
            is: {},
            clan: {},
            mixed: {}
        };
        
        // Convert flags array to Set
        this.flags = data.flags instanceof Set 
            ? data.flags 
            : new Set(Array.isArray(data.flags) ? data.flags : []);
    }

    hasFlag(flag: string): boolean {
        return this.flags.has(flag);
    }
}

export class MiscEquipment extends Equipment {
    damageDivisor: number;

    constructor(data: Partial<MiscEquipment> & { internalName: string; name: string }) {
        super({ ...data, type: 'misc' });
        this.damageDivisor = data.damageDivisor ?? 0;
    }
}

export class WeaponEquipment extends Equipment {
    heat: number;
    damage: string;
    rackSize: number;
    ammoType: string;
    ranges: number[];
    wRanges: number[];
    maxRange: number;
    av: number[];
    capital: boolean;
    subCapital: boolean;

    constructor(data: Partial<WeaponEquipment> & { internalName: string; name: string }) {
        super({ ...data, type: 'weapon' });
        this.heat = data.heat ?? 0;
        this.damage = data.damage ?? '-';
        this.rackSize = data.rackSize ?? 0;
        this.ammoType = data.ammoType ?? '';
        this.ranges = WeaponEquipment.normalizeArray(data.ranges, 5);
        this.wRanges = WeaponEquipment.normalizeArray(data.wRanges, 5);
        this.maxRange = data.maxRange ?? 0;
        this.av = WeaponEquipment.normalizeArray(data.av, 4);
        this.capital = data.capital ?? false;
        this.subCapital = data.subCapital ?? false;
    }

    private static normalizeArray(arr: number[] | undefined, length: number): number[] {
        const source = Array.isArray(arr) ? arr : [];
        const result = new Array<number>(length).fill(0);
        for (let i = 0; i < Math.min(source.length, length); i++) {
            result[i] = source[i];
        }
        return result;
    }

    hasNoRange(): boolean {
        return this.ranges.every(range => range === 0);
    }
}

export class AmmoEquipment extends Equipment {
    ammoType: string;
    category: string;
    rackSize: number;
    damagePerShot: number;
    shots: number;
    kgPerShot: number;
    baseAmmo?: string;
    capital: boolean;
    ammoRatio: number;
    subMunition: string;
    munitionType: Set<string>;

    constructor(data: Partial<AmmoEquipment> & { internalName: string; name: string }) {
        super({ ...data, type: 'ammo' });
        this.ammoType = data.ammoType ?? '';
        this.category = data.category ?? '';
        this.rackSize = data.rackSize ?? 0;
        this.damagePerShot = data.damagePerShot ?? 0;
        this.shots = typeof data.shots === 'string' ? parseInt(data.shots, 10) || 0 : data.shots ?? 0;
        this.kgPerShot = data.kgPerShot ?? 0;
        this.baseAmmo = data.baseAmmo;
        this.capital = data.capital ?? false;
        this.ammoRatio = data.ammoRatio ?? 0;
        this.subMunition = data.subMunition ?? '';
        
        // Convert munitionType array to Set
        this.munitionType = data.munitionType instanceof Set
            ? data.munitionType
            : new Set(Array.isArray(data.munitionType) ? data.munitionType : []);
    }

    equalsAmmoTypeOnly(other: AmmoEquipment): boolean {
        if (!(other instanceof AmmoEquipment)) return false;
        
        if (this.ammoType === 'Multi-Missile Launcher') {
            if (this.hasFlag('F_MML_LRM') !== other.hasFlag('F_MML_LRM')) {
                return false;
            }
        } else if (this.ammoType === 'AR10') {
            const ar10Flags = ['F_AR10_BARRACUDA', 'F_AR10_WHITE_SHARK', 'F_AR10_KILLER_WHALE', 'F_NUCLEAR'];
            if (ar10Flags.some(flag => this.hasFlag(flag) !== other.hasFlag(flag))) {
                return false;
            }
        }
        
        return this.ammoType === other.ammoType;
    }

    compatibleAmmo(other: AmmoEquipment, unit: Unit): boolean {
        if (this.ammoType !== other.ammoType) return false;
        
        // Check base compatibility
        if (this.techBase !== other.techBase) {
            if (!unit) {
                if (this.techBase !== 'All' && other.techBase !== 'All') return false;
            } else if (unit.techBase !== 'Mixed') {
                if (unit.techBase === 'Clan' && this.techBase === 'IS') return false;
                if (unit.techBase === 'Inner Sphere' && this.techBase === 'Clan') return false;
            }
        }
        
        // Check flag incompatibilities
        if (this.hasFlag('M_CASELESS') !== other.hasFlag('M_CASELESS')) return false;
        if (this.hasFlag('F_BATTLEARMOR') !== other.hasFlag('F_BATTLEARMOR')) return false;
        
        // Special ammo types
        if (this.ammoType === 'AR10') return true;
        
        // Rack size check
        if (this.rackSize !== other.rackSize) return false;
        
        // Special ammo types that allow mixing
        if (this.ammoType === 'Multi-Missile Launcher' || this.ammoType === 'LB-X Autocannon') {
            return true;
        }
        
        return this.equalsAmmoTypeOnly(other);
    }

    hasMunitionType(type: string): boolean {
        return this.munitionType.has(type);
    }
}

export interface EquipmentUnitType {
    [internalName: string]: Equipment;
}

export interface EquipmentData {
    version: string;
    etag: string;
    equipment: {
        [unitType: string]: EquipmentUnitType;
    };
}