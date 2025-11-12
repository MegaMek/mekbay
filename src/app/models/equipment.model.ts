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
export interface IEquipment {
    internalName: string;
    name: string;
    shortName: string;
    type: string;
    heat: string;
    damage: string;
    cost: string;
    level: string;
    rating: {
        is: string;
        clan: string;
    };
    dates: {
        is: {
            t: string;
            p: string;
            c: string;
            x: string;
            r: string;
        },
        clan: {
            t: string;
            p: string;
            c: string;
            x: string;
            r: string;
        },
        mixed: {
            t: string;
            p: string;
            c: string;
            x: string;
            r: string;
        },
    }
    range: string;
    weight: string;
    crew: string;
    special: string;
    reference: string;
    divisor: string;
    minr: string;
    bv: number;
    crit: number;
    base: 'IS' | 'Clan' | 'All';
    hittable: boolean;
    spreadable: boolean;
    flags: Set<string>;
}

export interface IWeapon extends IEquipment {
    rackSize: number;
    ammoType: string;
}

export interface IAmmo extends IEquipment {
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
}

export interface EquipmentUnitType {
    [internalName: string]: IEquipment | IWeapon | IAmmo;
}

export interface EquipmentData {
    version: string;
    etag: string;
    equipment: {
        [unitType: string]: EquipmentUnitType;
    };
}

export class Equipment implements IEquipment {
    internalName: string;
    name: string;
    shortName: string;
    type: string;
    heat: string;
    damage: string;
    cost: string;
    level: string;
    rating: {
        is: string;
        clan: string;
    };
    dates: {
        is: {
            t: string;
            p: string;
            c: string;
            x: string;
            r: string;
        },
        clan: {
            t: string;
            p: string;
            c: string;
            x: string;
            r: string;
        },
        mixed: {
            t: string;
            p: string;
            c: string;
            x: string;
            r: string;
        },
    }
    range: string;
    weight: string;
    crew: string;
    special: string;
    reference: string;
    divisor: string;
    minr: string;
    bv: number;
    crit: number;
    base: 'IS' | 'Clan' | 'All';
    hittable: boolean;
    spreadable: boolean;
    flags: Set<string>;
    
    constructor(data: IEquipment) {
        this.internalName = data.internalName;
        this.name = data.name;
        this.shortName = data.shortName;
        this.type = data.type;
        this.heat = data.heat;
        this.damage = data.damage;
        this.cost = data.cost;
        this.level = data.level;
        this.rating = {
            is: data.rating.is,
            clan: data.rating.clan
        };
        this.dates = {
            is: { ...data.dates.is },
            clan: { ...data.dates.clan },
            mixed: { ...data.dates.mixed }
        };
        this.range = data.range;
        this.weight = data.weight;
        this.crew = data.crew;
        this.special = data.special;
        this.reference = data.reference;
        this.divisor = data.divisor;
        this.minr = data.minr;
        this.bv = data.bv;
        this.crit = data.crit;
        this.base = data.base;
        this.hittable = data.hittable;
        this.spreadable = data.spreadable;
        this.flags = new Set(data.flags ? Array.from(data.flags) : []);
    }
}

export class MiscEquipment extends Equipment {
    constructor(data: IEquipment) {
        super(data);
    }
}

export class WeaponEquipment extends Equipment implements IWeapon {
    rackSize: number;
    ammoType: string;

    constructor(data: IWeapon) {
        super(data);
        this.rackSize = data.rackSize;
        this.ammoType = data.ammoType;
    }
}

export class AmmoEquipment extends Equipment implements IAmmo {
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

    constructor(data: IAmmo) {
        super(data);
        this.ammoType = data.ammoType;
        this.category = data.category;
        this.rackSize = data.rackSize;
        this.damagePerShot = data.damagePerShot;
        this.shots = data.shots;
        this.kgPerShot = data.kgPerShot;
        this.baseAmmo = data.baseAmmo;
        this.capital = data.capital;
        this.ammoRatio = data.ammoRatio;
        this.subMunition = data.subMunition;
        this.munitionType = new Set(data.munitionType ? Array.from(data.munitionType) : []);
    }

    // This is straight from MM, it could probably be optimized further
    public equalsAmmoTypeOnly(other: AmmoEquipment): boolean {
        if (!(other instanceof AmmoEquipment)) return false;
        if (this.ammoType === 'Multi-Missile Launcher') {
            if (this.flags.has('F_MML_LRM') !== other.flags.has('F_MML_LRM')) {
                return false;
            }
        } else
        if (this.ammoType === 'AR10') {
            if (this.flags.has('F_AR10_BARRACUDA') !== other.flags.has('F_AR10_BARRACUDA')) {
                return false;
            }
            if (this.flags.has('F_AR10_WHITE_SHARK') !== other.flags.has('F_AR10_WHITE_SHARK')) {
                return false;
            }
            if (this.flags.has('F_AR10_KILLER_WHALE') !== other.flags.has('F_AR10_KILLER_WHALE')) {
                return false;
            }
            if (this.flags.has('F_NUCLEAR') !== other.flags.has('F_NUCLEAR')) {
                return false;
            }
        } 
        return (this.ammoType === other.ammoType);
    }

    public compatibleAmmo(other: AmmoEquipment, unit: Unit): boolean {
        if (this.ammoType !== other.ammoType) {
            return false; // different ammo types cannot mix
        }
        if (this.base !== other.base) {
            if (!unit) {
                if (this.base !== 'All' && other.base !== 'All') {
                    return false; // different base ammo cannot mix (Clan/IS variants)
                }
            } else if (unit.techBase !== 'Mixed') {
                if (unit.techBase === 'Clan' && this.base === 'IS') {
                    return false; // IS ammo cannot mix with Clan unit
                }
                if (unit.techBase === 'Inner Sphere' && this.base === 'Clan') {
                    return false; // Clan ammo cannot mix with IS unit
                }
            }
        }
        if (this.flags.has('M_CASELESS') !== other.flags.has('M_CASELESS')) {
            return false; // caseless ammo cannot mix with cased ammo
        }
        if (this.flags.has('F_BATTLEARMOR') !== other.flags.has('F_BATTLEARMOR')) {
            return false; // battle armor ammo cannot mix with regular ammo
        }
        if (this.ammoType === 'AR10') {
            return true; // all AR10 ammo is compatible
        }
        if (this.rackSize !== other.rackSize) {
            return false; // different rack sizes cannot mix
        }
        if (this.ammoType === 'Multi-Missile Launcher') {
            return true; // all MML ammo of same rack size is compatible
        }
        if (this.ammoType === 'LB-X Autocannon') {
            return true; // all LB-X ammo of same rack size is compatible
        }
        return  this.equalsAmmoTypeOnly(other); // for other types, check the ammo type
    }
}