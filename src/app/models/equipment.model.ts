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

import { Unit } from './units.model';

/*
 * Author: Drake
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type TechBase = 'IS' | 'Clan' | 'All';
export type EquipmentType = 'weapon' | 'ammo' | 'misc' | 'armor';
export type TechLevel = 'Introductory' | 'Standard' | 'Advanced' | 'Experimental' | 'Unofficial';
export type RangeBrackets = 'short' | 'medium' | 'long' | 'extreme';

// ============================================================================
// Ammo Types
// ============================================================================

export type AmmoCategory = 'Ballistic' | 'Missile' | 'Energy' | 'Artillery' | 'Bomb' | 'Chemical' | 'Special';

export type AmmoType =
    | 'NA' | 'AC' | 'VEHICLE_FLAMER' | 'MG' | 'MG_HEAVY' | 'MG_LIGHT' | 'GAUSS'
    | 'LRM' | 'LRM_TORPEDO' | 'SRM' | 'SRM_TORPEDO' | 'SRM_STREAK' | 'MRM'
    | 'NARC' | 'AMS' | 'ARROW_IV' | 'LONG_TOM' | 'SNIPER' | 'THUMPER'
    | 'AC_LBX' | 'AC_ULTRA' | 'GAUSS_LIGHT' | 'GAUSS_HEAVY' | 'AC_ROTARY'
    | 'SRM_ADVANCED' | 'BA_MICRO_BOMB' | 'LRM_TORPEDO_COMBO' | 'MINE' | 'ATM'
    | 'ROCKET_LAUNCHER' | 'INARC' | 'LRM_STREAK' | 'AC_LBX_THB' | 'AC_ULTRA_THB'
    | 'LAC' | 'HEAVY_FLAMER' | 'COOLANT_POD' | 'EXLRM' | 'APGAUSS' | 'MAGSHOT'
    | 'MPOD' | 'HAG' | 'MML' | 'PLASMA' | 'SBGAUSS' | 'RAIL_GUN'
    | 'TBOLT_5' | 'TBOLT_10' | 'TBOLT_15' | 'TBOLT_20'
    | 'NAC' | 'LIGHT_NGAUSS' | 'MED_NGAUSS' | 'HEAVY_NGAUSS'
    | 'KILLER_WHALE' | 'WHITE_SHARK' | 'BARRACUDA' | 'KRAKEN_T' | 'AR10'
    | 'SCREEN_LAUNCHER' | 'ALAMO' | 'IGAUSS_HEAVY' | 'CHEMICAL_LASER'
    | 'HYPER_VELOCITY' | 'MEK_MORTAR' | 'CRUISE_MISSILE' | 'BPOD' | 'SCC'
    | 'MANTA_RAY' | 'SWORDFISH' | 'STINGRAY' | 'PIRANHA' | 'TASER' | 'BOMB'
    | 'AAA_MISSILE' | 'AS_MISSILE' | 'ASEW_MISSILE' | 'LAA_MISSILE'
    | 'RL_BOMB' | 'ARROW_IV_BOMB' | 'FLUID_GUN'
    | 'SNIPER_CANNON' | 'THUMPER_CANNON' | 'LONG_TOM_CANNON'
    | 'NAIL_RIVET_GUN' | 'ACi' | 'KRAKENM' | 'PAC' | 'NLRM' | 'RIFLE'
    | 'VGL' | 'C3_REMOTE_SENSOR' | 'AC_PRIMITIVE' | 'LRM_PRIMITIVE' | 'SRM_PRIMITIVE'
    | 'BA_TUBE' | 'IATM' | 'LMASS' | 'MMASS' | 'HMASS' | 'APDS'
    | 'AC_IMP' | 'GAUSS_IMP' | 'SRM_IMP' | 'LRM_IMP'
    | 'LONG_TOM_PRIM' | 'ARROWIV_PROTO'
    | 'KILLER_WHALE_T' | 'WHITE_SHARK_T' | 'BARRACUDA_T' | 'INFANTRY';

export const AMMO_TYPE_CATEGORY: Record<AmmoType, AmmoCategory> = {
    NA: 'Special',
    AC: 'Ballistic',
    VEHICLE_FLAMER: 'Chemical',
    MG: 'Ballistic',
    MG_HEAVY: 'Ballistic',
    MG_LIGHT: 'Ballistic',
    GAUSS: 'Ballistic',
    LRM: 'Missile',
    LRM_TORPEDO: 'Missile',
    SRM: 'Missile',
    SRM_TORPEDO: 'Missile',
    SRM_STREAK: 'Missile',
    MRM: 'Missile',
    NARC: 'Special',
    AMS: 'Special',
    ARROW_IV: 'Artillery',
    LONG_TOM: 'Artillery',
    SNIPER: 'Artillery',
    THUMPER: 'Artillery',
    AC_LBX: 'Ballistic',
    AC_ULTRA: 'Ballistic',
    GAUSS_LIGHT: 'Ballistic',
    GAUSS_HEAVY: 'Ballistic',
    AC_ROTARY: 'Ballistic',
    SRM_ADVANCED: 'Missile',
    BA_MICRO_BOMB: 'Bomb',
    LRM_TORPEDO_COMBO: 'Missile',
    MINE: 'Special',
    ATM: 'Missile',
    ROCKET_LAUNCHER: 'Missile',
    INARC: 'Special',
    LRM_STREAK: 'Missile',
    AC_LBX_THB: 'Ballistic',
    AC_ULTRA_THB: 'Ballistic',
    LAC: 'Ballistic',
    HEAVY_FLAMER: 'Chemical',
    COOLANT_POD: 'Special',
    EXLRM: 'Missile',
    APGAUSS: 'Ballistic',
    MAGSHOT: 'Ballistic',
    MPOD: 'Special',
    HAG: 'Ballistic',
    MML: 'Missile',
    PLASMA: 'Energy',
    SBGAUSS: 'Ballistic',
    RAIL_GUN: 'Ballistic',
    TBOLT_5: 'Missile',
    TBOLT_10: 'Missile',
    TBOLT_15: 'Missile',
    TBOLT_20: 'Missile',
    NAC: 'Ballistic',
    LIGHT_NGAUSS: 'Ballistic',
    MED_NGAUSS: 'Ballistic',
    HEAVY_NGAUSS: 'Ballistic',
    KILLER_WHALE: 'Missile',
    WHITE_SHARK: 'Missile',
    BARRACUDA: 'Missile',
    KRAKEN_T: 'Missile',
    AR10: 'Missile',
    SCREEN_LAUNCHER: 'Special',
    ALAMO: 'Missile',
    IGAUSS_HEAVY: 'Ballistic',
    CHEMICAL_LASER: 'Energy',
    HYPER_VELOCITY: 'Ballistic',
    MEK_MORTAR: 'Artillery',
    CRUISE_MISSILE: 'Missile',
    BPOD: 'Special',
    SCC: 'Ballistic',
    MANTA_RAY: 'Missile',
    SWORDFISH: 'Missile',
    STINGRAY: 'Missile',
    PIRANHA: 'Missile',
    TASER: 'Special',
    BOMB: 'Bomb',
    AAA_MISSILE: 'Missile',
    AS_MISSILE: 'Missile',
    ASEW_MISSILE: 'Missile',
    LAA_MISSILE: 'Missile',
    RL_BOMB: 'Bomb',
    ARROW_IV_BOMB: 'Bomb',
    FLUID_GUN: 'Chemical',
    SNIPER_CANNON: 'Artillery',
    THUMPER_CANNON: 'Artillery',
    LONG_TOM_CANNON: 'Artillery',
    NAIL_RIVET_GUN: 'Ballistic',
    ACi: 'Ballistic',
    KRAKENM: 'Missile',
    PAC: 'Ballistic',
    NLRM: 'Missile',
    RIFLE: 'Ballistic',
    VGL: 'Special',
    C3_REMOTE_SENSOR: 'Special',
    AC_PRIMITIVE: 'Ballistic',
    LRM_PRIMITIVE: 'Missile',
    SRM_PRIMITIVE: 'Missile',
    BA_TUBE: 'Artillery',
    IATM: 'Missile',
    LMASS: 'Ballistic',
    MMASS: 'Ballistic',
    HMASS: 'Ballistic',
    APDS: 'Ballistic',
    AC_IMP: 'Ballistic',
    GAUSS_IMP: 'Ballistic',
    SRM_IMP: 'Missile',
    LRM_IMP: 'Missile',
    LONG_TOM_PRIM: 'Artillery',
    ARROWIV_PROTO: 'Artillery',
    KILLER_WHALE_T: 'Missile',
    WHITE_SHARK_T: 'Missile',
    BARRACUDA_T: 'Missile',
    INFANTRY: 'Special'
};

export function getAmmoCategory(type: AmmoType): AmmoCategory {
    return AMMO_TYPE_CATEGORY[type] ?? 'Special';
}

// ============================================================================
// Interfaces
// ============================================================================

export interface TechAvailability {
    sl?: string;      // Star League
    sw?: string;      // Succession Wars
    clan?: string;    // Clan Invasion
    da?: string;      // Dark Age
}

export interface TechAdvancementDates {
    prototype?: string;
    production?: string;
    common?: string;
    extinct?: string;
    reintroduced?: string;
}

export interface TechAdvancement {
    is?: TechAdvancementDates;
    clan?: TechAdvancementDates;
}

export interface TechData {
    base: TechBase;
    rating: string;
    level: TechLevel;
    availability: TechAvailability;
    advancement: TechAdvancement;
}

export interface EquipmentStats {
    tonnage: number;
    cost: number;
    bv: number;
    criticalSlots: number;
    tankSlots: number;
    svSlots: number; // if 
    hittable: boolean;
    spreadable: boolean;
    explosive: boolean;
    omniFixedOnly: boolean;
    instantModeSwitch: boolean;
    toHitModifier: number;
}

export interface WeaponData {
    heat: number;
    damage: string | number;
    explosionDamage: number;
    rackSize: number;
    ammoType: AmmoType;
    ranges: number[];      // [short, medium, long, extreme]
    wRanges: number[];     // Water ranges [short, medium, long, extreme]
    minRange: number;
    maxRangeBracket: RangeBrackets;
    av: number[];          // Aerospace attack values [short, medium, long, extreme]
    capital: boolean;
    subCapital: boolean;
}

export interface InfantryData {
    damage: number;
    range: number;
    crew: number;
    ammoWeight: number;
    ammoCost: number;
    shots: number;
    bursts: number;
}

export interface AmmoData {
    type: AmmoType;
    rackSize: number;
    shots: number;
    kgPerShot: number;      // only > 0 values are valid
    damagePerShot: number;
    capital: boolean;
    ammoRatio: number;
    subMunition: string;
    munitionType: string[];
    mutatorName?: string;
    baseAmmo?: string;
    category: AmmoCategory;
}

export interface MiscData {
    damageDivisor: number;
    baseDamageAbsorptionRate: number;
    baseDamageCapacity: number;
    industrial: boolean;
}

export interface ArmorData {
    type: string;
    typeId?: number;
    fighterSlots: number;
    patchworkSlotsMekSV: number;
    patchworkSlotsCVFtr: number;
    bar: number;
    pptMultiplier: number;
    weightPerPoint: number;
    pptDropship: number[];
    pptCapital: number[];
    weightPerPointSV: Record<string, number>;
}

/** Raw JSON structure for equipment data */
export interface EquipmentRawData {
    version?: string;
    id: string;
    name: string;
    shortName?: string;
    sortingName?: string;
    rulesRefs?: string;
    aliases?: string[];
    stats?: Partial<EquipmentStats>;
    tech?: Partial<TechData>;
    type: EquipmentType;
    flags?: string[];
    modes?: string[];
    weapon?: Partial<WeaponData>;
    infantry?: Partial<InfantryData>;
    ammo?: Partial<AmmoData>;
    misc?: Partial<MiscData>;
    armor?: Partial<ArmorData>;
}

/** Equipment indexed by internal name */
export type EquipmentMap = Record<string, Equipment>;

/** Raw equipment indexed by internal name */
export type RawEquipmentMap = Record<string, EquipmentRawData>;

/** Equipment data structure (matches JSON format) */
export interface EquipmentData {
    version: string;
    etag?: string;
    equipment: EquipmentMap;
}

/** Raw equipment data from JSON file */
export interface RawEquipmentData {
    version: string;
    etag?: string;
    equipment: RawEquipmentMap;
}

// ============================================================================
// Defaults (matching Java constructors)
// ============================================================================

const STATS_DEFAULTS: Record<EquipmentType, EquipmentStats> = {
    weapon: {
        tonnage: 0, cost: 0, bv: 0, criticalSlots: 0, tankSlots: 1, svSlots: -1,
        hittable: true, spreadable: false, explosive: false, omniFixedOnly: false,
        instantModeSwitch: true, toHitModifier: 0
    },
    ammo: {
        tonnage: 1.0, cost: 0, bv: 0, criticalSlots: 1, tankSlots: 0, svSlots: -1,
        hittable: true, spreadable: false, explosive: true, omniFixedOnly: false,
        instantModeSwitch: false, toHitModifier: 0
    },
    misc: {
        tonnage: 0, cost: 0, bv: 0, criticalSlots: 0, tankSlots: 1, svSlots: -1,
        hittable: true, spreadable: false, explosive: false, omniFixedOnly: false,
        instantModeSwitch: true, toHitModifier: 0
    },
    armor: {
        tonnage: 0, cost: 0, bv: 0, criticalSlots: 0, tankSlots: 0, svSlots: 0,
        hittable: false, spreadable: true, explosive: false, omniFixedOnly: true,
        instantModeSwitch: true, toHitModifier: 0
    }
};

const WEAPON_DEFAULTS: WeaponData = {
    heat: 0, damage: 0, explosionDamage: 0, rackSize: 0, ammoType: 'NA', minRange: 0, maxRangeBracket: 'short',
    ranges: [0, 0, 0, 0], wRanges: [0, 0, 0, 0], av: [0, 0, 0, 0],
    capital: false, subCapital: false
};

const INFANTRY_DEFAULTS: InfantryData = {
    damage: 0, range: 0, crew: 1, ammoWeight: 0, ammoCost: 0, shots: 0, bursts: 0
};

const AMMO_DEFAULTS: AmmoData = {
    type: 'NA', rackSize: 0, shots: 0, kgPerShot: -1, damagePerShot: 0,
    capital: false, ammoRatio: 0, subMunition: '', munitionType: [], category: 'Special'
};

const MISC_DEFAULTS: MiscData = {
    damageDivisor: 1.0, baseDamageAbsorptionRate: 0, baseDamageCapacity: 0, industrial: false
};

const ARMOR_DEFAULTS: ArmorData = {
    type: '', fighterSlots: 0, patchworkSlotsMekSV: 0, patchworkSlotsCVFtr: 0,
    bar: 10, pptMultiplier: 1.0, weightPerPoint: 0, pptDropship: [], pptCapital: [],
    weightPerPointSV: {}
};

const TECH_DEFAULTS: TechData = {
    base: 'IS', rating: 'C', level: 'Standard', availability: {}, advancement: {}
};

// ============================================================================
// Utility Functions
// ============================================================================

/** Pads/truncates array to fixed length, filling with zeros */
function normalizeArray(arr: number[] | undefined, length: number): number[] {
    if (!arr) return new Array(length).fill(0);
    if (arr.length >= length) return arr.slice(0, length);
    return [...arr, ...new Array(length - arr.length).fill(0)];
}

/** Merges partial data with defaults */
function merge<T extends object>(defaults: T, partial?: Partial<T>): T {
    if (!partial) return { ...defaults };
    const result = { ...defaults } as T;
    for (const key of Object.keys(partial) as (keyof T)[]) {
        if (partial[key] !== undefined) {
            result[key] = partial[key] as T[keyof T];
        }
    }
    return result;
}

// ============================================================================
// Base Equipment Class
// ============================================================================

export class Equipment {
    readonly version: string;
    readonly id: string;
    readonly name: string;
    readonly shortName: string;
    readonly sortingName: string;
    readonly rulesRefs: string;
    readonly aliases: string[];
    readonly stats: EquipmentStats;
    readonly tech: TechData;
    readonly type: EquipmentType;
    readonly flags: Set<string>;
    readonly modes: string[];

    constructor(data: EquipmentRawData) {
        this.version = data.version ?? '1.0';
        this.id = data.id;
        this.name = data.name;
        this.shortName = data.shortName ?? data.name;
        this.sortingName = data.sortingName ?? data.name;
        this.rulesRefs = data.rulesRefs ?? '';
        this.aliases = data.aliases ?? [];
        this.type = data.type;
        this.modes = data.modes ?? [];
        this.stats = merge(STATS_DEFAULTS[data.type], data.stats);
        this.tech = merge(TECH_DEFAULTS, data.tech);
        this.flags = new Set(data.flags ?? []);
    }

    // Convenience accessors for common stats
    get internalName(): string { return this.id; }
    get tonnage(): number { return this.stats.tonnage; }
    get cost(): number { return this.stats.cost; }
    get bv(): number { return this.stats.bv; }
    get critSlots(): number { return this.stats.criticalSlots; }
    get svSlots(): number { return this.stats.svSlots; }
    get tankSlots(): number { return this.stats.tankSlots; }
    get techBase(): TechBase { return this.tech.base; }
    get level(): TechLevel { return this.tech.level; }
    get rating(): string { return this.tech.rating; }
    get availability(): String { return [this.tech.availability.sl??'X', this.tech.availability.sw??'X', this.tech.availability.clan??'X', this.tech.availability.da??'X'].join('-'); }

    hasFlag(flag: string): boolean { return this.flags.has(flag); }
    hasAnyFlag(flags: string[]): boolean { return flags.some(f => this.flags.has(f)); }
    hasAllFlags(flags: string[]): boolean { return flags.every(f => this.flags.has(f)); }
    hasMode(mode: string): boolean { return this.modes.includes(mode); }
}

// ============================================================================
// Weapon Equipment Class
// ============================================================================

export class WeaponEquipment extends Equipment {
    readonly weapon: WeaponData;
    readonly infantry?: InfantryData;

    constructor(data: EquipmentRawData) {
        super({ ...data, type: 'weapon' });

        const w = data.weapon;
        this.weapon = {
            ...merge(WEAPON_DEFAULTS, w),
            ranges: normalizeArray(w?.ranges, 4),
            wRanges: normalizeArray(w?.wRanges, 4),
            av: normalizeArray(w?.av, 4)
        };

        if (data.infantry) {
            this.infantry = merge(INFANTRY_DEFAULTS, data.infantry);
        }
    }

    get heat(): number { return this.weapon.heat; }
    get damage(): string | number { return this.weapon.damage; }
    get rackSize(): number { return this.weapon.rackSize; }
    get ammoType(): AmmoType { return this.weapon.ammoType; }
    get ranges(): number[] { return this.weapon.ranges; }
    get minRange(): number { return this.weapon.minRange; }
    get maxRangeBracket(): RangeBrackets { return this.weapon.maxRangeBracket; }
    get capital(): boolean { return this.weapon.capital; }
    get subCapital(): boolean { return this.weapon.subCapital; }

    hasNoRange(): boolean {
        return this.weapon.ranges.every(r => r === 0);
    }

    isInfantryWeapon(): boolean {
        return this.hasFlag('F_INFANTRY') && this.infantry !== undefined;
    }
}

// ============================================================================
// Ammo Equipment Class
// ============================================================================

export class AmmoEquipment extends Equipment {
    readonly ammo: AmmoData;

    constructor(data: EquipmentRawData) {
        super({ ...data, type: 'ammo' });
        this.ammo = merge(AMMO_DEFAULTS, data.ammo);
    }

    get ammoType(): AmmoType { return this.ammo.type; }
    get rackSize(): number { return this.ammo.rackSize; }
    get shots(): number { return this.ammo.shots; }
    get damagePerShot(): number { return this.ammo.damagePerShot; }
    get capital(): boolean { return this.ammo.capital; }
    get category(): AmmoCategory { return this.ammo.category; }
    get baseAmmo(): string | undefined { return this.ammo.baseAmmo; }
    get munitionType(): string[] { return this.ammo.munitionType; }
    get mutatorName(): string | undefined { return this.ammo.mutatorName; }

    /** Returns true if kgPerShot was explicitly set (> 0) */
    get hasCustomKgPerShot(): boolean { return this.ammo.kgPerShot > 0; }

    /** Gets kg per shot - uses explicit value if set, otherwise calculates from shots */
    get kgPerShot(): number {
        return this.ammo.kgPerShot > 0 ? this.ammo.kgPerShot : (this.shots > 0 ? 1000 / this.shots : 0);
    }

    hasMunitionType(type: string): boolean {
        return this.ammo.munitionType.includes(type);
    }

    equalsAmmoTypeOnly(other: AmmoEquipment): boolean {
        if (!(other instanceof AmmoEquipment)) return false;

        if (this.ammoType === 'MML') {
            if (this.hasFlag('F_MML_LRM') !== other.hasFlag('F_MML_LRM')) return false;
        } else if (this.ammoType === 'AR10') {
            const ar10Flags = ['F_AR10_BARRACUDA', 'F_AR10_WHITE_SHARK', 'F_AR10_KILLER_WHALE', 'F_NUCLEAR'];
            if (ar10Flags.some(f => this.hasFlag(f) !== other.hasFlag(f))) return false;
        }

        return this.ammoType === other.ammoType;
    }

    compatibleAmmo(other: AmmoEquipment, unit?: Unit): boolean {
        if (this.ammoType !== other.ammoType) return false;
        // Tech base compatibility
        if (this.techBase !== other.techBase) {
            if (!unit) {
                if (this.techBase !== 'All' && other.techBase !== 'All') return false;
            } else if (unit.techBase !== 'Mixed') {
                if (unit.techBase === 'Clan' && this.techBase === 'IS') return false;
                if (unit.techBase === 'Inner Sphere' && this.techBase === 'Clan') return false;
            }
        }

        // Flag incompatibilities
        if (this.hasFlag('M_CASELESS') !== other.hasFlag('M_CASELESS')) return false;
        if (this.hasFlag('F_BATTLEARMOR') !== other.hasFlag('F_BATTLEARMOR')) return false;

        if (this.ammoType === 'AR10') return true;
        if (this.rackSize !== other.rackSize) return false;
        if (this.ammoType === 'MML' || this.ammoType === 'AC_LBX') return true;

        return this.equalsAmmoTypeOnly(other);
    }
}

// ============================================================================
// Misc Equipment Class
// ============================================================================

export class MiscEquipment extends Equipment {
    readonly misc: MiscData;

    constructor(data: EquipmentRawData) {
        super({ ...data, type: 'misc' });
        this.misc = merge(MISC_DEFAULTS, data.misc);
    }

    get damageDivisor(): number { return this.misc.damageDivisor; }
    get baseDamageAbsorptionRate(): number { return this.misc.baseDamageAbsorptionRate; }
    get baseDamageCapacity(): number { return this.misc.baseDamageCapacity; }
    get industrial(): boolean { return this.misc.industrial; }
}

// ============================================================================
// Armor Equipment Class
// ============================================================================

export class ArmorEquipment extends Equipment {
    readonly armor: ArmorData;

    constructor(data: EquipmentRawData) {
        super({ ...data, type: 'armor' });
        this.armor = merge(ARMOR_DEFAULTS, data.armor);
    }

    get armorType(): string { return this.armor.type; }
    get armorTypeId(): number | undefined { return this.armor.typeId; }
    get fighterSlots(): number { return this.armor.fighterSlots; }
    get patchworkSlotsMekSV(): number { return this.armor.patchworkSlotsMekSV; }
    get patchworkSlotsCVFtr(): number { return this.armor.patchworkSlotsCVFtr; }
    get bar(): number { return this.armor.bar; }
    get pptMultiplier(): number { return this.armor.pptMultiplier; }
    get weightPerPoint(): number { return this.armor.weightPerPoint; }
    get pptDropship(): number[] { return this.armor.pptDropship; }
    get pptCapital(): number[] { return this.armor.pptCapital; }
    get weightPerPointSV(): Record<string, number> { return this.armor.weightPerPointSV; }
}

// ============================================================================
// Factory Functions
// ============================================================================

const EQUIPMENT_CONSTRUCTORS: Record<EquipmentType, new (data: EquipmentRawData) => Equipment> = {
    weapon: WeaponEquipment,
    ammo: AmmoEquipment,
    misc: MiscEquipment,
    armor: ArmorEquipment
};

/** Creates the appropriate Equipment subclass based on type */
export function createEquipment(data: EquipmentRawData): Equipment {
    const Constructor = EQUIPMENT_CONSTRUCTORS[data.type] ?? Equipment;
    return new Constructor(data);
}

/** Parse raw equipment JSON data into EquipmentData with instantiated classes */
export function parseEquipmentData(rawData: RawEquipmentData): EquipmentData {
    const result: EquipmentData = {
        version: rawData.version,
        etag: rawData.etag,
        equipment: {}
    };
    for (const [unitType, equipmentForType] of Object.entries(rawData.equipment)) {
        for (const [id, raw] of Object.entries(equipmentForType)) {
            result.equipment[id] = createEquipment(raw);
        }
    }
    return result;
}
