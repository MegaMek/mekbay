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

import type { BaseEntity } from './entity/base-entity';
import {
    ComponentTechLevel,
    CompoundTechLevel,
    EntityTechBase,
    EquipmentTechBase,
    TechData,
    calculateCompoundTechLevel,
    calculateTechLevel,
    isTechnologyAvailable,
} from './entity/types/tech';
import {
    decodeEquipmentTechData,
    type WireEquipmentTechData,
} from './equipment-tech-codec';
import { getNumCriticalSlots } from './entity/utils/equipment-helpers';
import type { MountedEquipment } from './mounted-equipment.model';
import type { Unit } from './units.model';
import type { CBTGameRules } from './rules/game-rules';
import { AmmoValidityUtil } from '../utils/ammo-validity.util';
import { resolveAmmoWeaponProfile, type AmmoWeaponProfile } from './ammo-weapon-profile.model';

/*
 * Author: Drake
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type EquipmentType = 'weapon' | 'ammo' | 'misc' | 'armor' | 'structure';
export type TechLevel = 'Introductory' | 'Standard' | 'Advanced' | 'Experimental' | 'Unofficial';
export type RangeBrackets = 'short' | 'medium' | 'long' | 'extreme';
export type WeaponCategory = 'energy' | 'missile' | 'ballistic' | 'artillery' | 'other';

export type WeaponDamageProfile =
    | { kind: 'fixed'; damage: number; maximum: number; perShot: boolean }
    | { kind: 'missile-cluster'; damagePerMissile: number; maximum: number }
    | { kind: 'cluster'; damage: number | 'Cluster' | 'Special'; maximum: number }
    | { kind: 'artillery'; damage: number; maximum: number }
    | { kind: 'range'; damage: readonly number[]; maximum: number }
    | { kind: 'variable'; maximum: number }
    | { kind: 'special'; maximum: 0 };

export interface WeaponCharacteristics {
    readonly name: string;
    readonly heat: number;
    readonly category: WeaponCategory;
    readonly ranges: readonly number[];
    readonly minimumRange: number;
    readonly damage: WeaponDamageProfile;
    readonly hitModifiers: readonly number[];
    readonly oneShotCount?: 1 | 2;
}
export const WEAPON_TYPES = ['AE', 'AI', 'C', 'DB', 'DE', 'E', 'F', 'H', 'M', 'OS', 'P', 'PB', 'R', 'S', 'V', 'X'] as const;
export type WeaponType = typeof WEAPON_TYPES[number];

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
    NARC: 'Missile',
    AMS: 'Ballistic',
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
    INARC: 'Missile',
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
    TASER: 'Ballistic',
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

export interface EquipmentStats {
    tonnage: number | "variable";
    cost: number | "variable";
    bv: number | "variable";
    criticalSlots: number | "variable";
    tankSlots: number;
    svSlots: number; // if 
    hittable: boolean;
    spreadable: boolean;
    explosive: boolean;
    omniFixedOnly: boolean;
    instantModeSwitch: boolean;
    toHitModifier: number | number[];
}

export interface WeaponData {
    heat: number;
    damage: string | number | Array<number>;
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

export interface StructureData {
    typeId: number;
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
    tech?: Partial<WireEquipmentTechData>;
    type: EquipmentType;
    flags?: string[];
    modes?: string[];
    weapon?: Partial<WeaponData>;
    infantry?: Partial<InfantryData>;
    ammo?: Partial<AmmoData>;
    misc?: Partial<MiscData>;
    structure?: Partial<StructureData>;
    armor?: Partial<ArmorData>;
}

/** Equipment indexed by internal name */
export type EquipmentMap = Record<string, Equipment>;

/** Raw equipment indexed by internal name */
export type RawEquipmentMap = Record<string, EquipmentRawData>;

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
        hittable: true, spreadable: false, explosive: false, omniFixedOnly: false,
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
    },
    structure: {
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

const STRUCTURE_DEFAULTS: StructureData = {
    typeId: 0
};

const WIRE_TECH_DEFAULTS: WireEquipmentTechData = {
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
    protected readonly stats: EquipmentStats;
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
        this.tech = decodeEquipmentTechData(merge(WIRE_TECH_DEFAULTS, data.tech));
        this.flags = new Set(data.flags ?? []);
    }

    // Convenience accessors for common stats
    get internalName(): string { return this.id; }
    get tonnage(): number | "variable" { return this.stats.tonnage; }
    get cost(): number | "variable" { return this.stats.cost; }
    get bv(): number | "variable" { return this.stats.bv; }
    get critSlots(): number | "variable" { return this.stats.criticalSlots; }
    get svSlots(): number { return this.stats.svSlots; }
    get tankSlots(): number { return this.stats.tankSlots; }
    get techBase(): EquipmentTechBase { return this.tech.base; }
    get level(): ComponentTechLevel { return this.tech.level; }
    get rating(): string { return this.tech.rating; }
    get availability(): String { return [this.tech.availability.sl ?? 'X', this.tech.availability.sw ?? 'X', this.tech.availability.clan ?? 'X', this.tech.availability.da ?? 'X'].join('-'); }
    getTechLevel(year: number, techBase: EntityTechBase, faction?: string): ComponentTechLevel {
        return calculateTechLevel(
            { level: this.level, dates: this.tech.advancement },
            { year, techBase, faction },
        );
    }
    getCompoundTechLevel(year: number, techBase: EntityTechBase, faction?: string): CompoundTechLevel {
        return calculateCompoundTechLevel(
            { level: this.level, dates: this.tech.advancement },
            { year, techBase, faction },
        );
    }
    isAvailableIn(year: number, techBase: EntityTechBase, faction?: string): boolean {
        return isTechnologyAvailable(
            { level: this.level, dates: this.tech.advancement },
            { year, techBase, faction },
        );
    }
    get isSpreadable(): boolean { return this.stats.spreadable; }
    get isInternalRepresentation(): boolean { return this.hasFlag('INTERNAL_REPRESENTATION'); }

    get toHitModifier(): number | readonly number[] { 
        return this.stats.toHitModifier; 
    }

    hasFlag(flag: string): boolean { return this.flags.has(flag); }
    hasAnyFlag(flags: string[]): boolean { return flags.some(f => this.flags.has(f)); }
    hasAllFlags(flags: string[]): boolean { return flags.every(f => this.flags.has(f)); }
    hasMode(mode: string): boolean { return this.modes.includes(mode); }
    isExplosive() { return this.stats.explosive ?? false; }
    getNumCriticalSlots(entity: BaseEntity, size: number = 1): number | undefined {
        return getNumCriticalSlots(entity, this, size);
    }

    canSplit() {
        return this.hasFlag('F_CAN_BE_SPlIT_ACROSS_CRITICAL_SLOTS');
    }

}

// ============================================================================
// Weapon Equipment Class
// ============================================================================

const SWITCHABLE_AMMO = new Set<AmmoType>([
    'AC', 'AC_PRIMITIVE', 'AC_IMP', 'AC_LBX', 'AC_ROTARY',
    'LRM', 'LRM_PRIMITIVE', 'LRM_IMP', 'NLRM',
    'MML',
    'SRM', 'SRM_IMP',
    'ATM', 'IATM',
    'NARC', 'INARC',
    'MEK_MORTAR',
    'BA_TUBE',
    'ARROW_IV', 'ARROWIV_PROTO', 'ARROW_IV_BOMB',
    'THUMPER', 'THUMPER_CANNON',
    'SNIPER', 'SNIPER_CANNON',
    'LONG_TOM', 'LONG_TOM_PRIM', 'LONG_TOM_CANNON',
]);


function orderedWeaponTypes(types: Iterable<WeaponType>): WeaponType[] {
    const typeSet = new Set(types);
    return WEAPON_TYPES.filter(type => typeSet.has(type));
}

const NON_DAMAGING_WEAPON_FLAGS = ['F_TAG', 'F_AMS'] as const;

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
    get damage(): string | number | Array<number> {
        return NON_DAMAGING_WEAPON_FLAGS.some(flag => this.hasFlag(flag)) ? '' : this.weapon.damage;
    }
    get rackSize(): number { return this.weapon.rackSize; }
    get ammoType(): AmmoType { return this.weapon.ammoType; }
    get ranges(): number[] { return this.weapon.ranges; }
    get minRange(): number { return this.weapon.minRange; }
    get minimumRange(): number { return Math.max(0, this.weapon.minRange); }
    get maxRangeBracket(): RangeBrackets { return this.weapon.maxRangeBracket; }
    get capital(): boolean { return this.weapon.capital; }
    get subCapital(): boolean { return this.weapon.subCapital; }

    hasNoRange(): boolean {
        return this.weapon.ranges.every(r => r === 0);
    }

    isInfantryWeapon(): this is this & { readonly infantry: InfantryData } {
        return this.hasFlag('F_INFANTRY') && this.infantry !== undefined;
    }

    getClusterSize(ammo?: AmmoEquipment | null, fallbackProfile?: AmmoWeaponProfile | null): number {
        let clusterSize = 0;
        const ammoProfile = resolveAmmoWeaponProfile(ammo) ?? fallbackProfile;
        if (ammoProfile) {
            clusterSize = ammoProfile.clusterSize;
        } else if (this.hasFlag('F_SRM')) {
            clusterSize = 2;
        } else if (this.hasAnyFlag(['F_LRM', 'F_MRM', 'F_HAG'])) {
            clusterSize = 5;
        } else if (this.hasFlag('F_ATM')) {
            clusterSize = 6;
        } else if (this.hasFlag('F_M_POD') || this.ammoType === 'SBGAUSS') {
            clusterSize = 1;
        }
        return Math.min(clusterSize, this.rackSize);
    }

    getRapidFireCount(): number {
        if (this.ammoType === 'AC_ROTARY') return 6;
        if (this.ammoType === 'AC_ULTRA' || this.ammoType === 'AC_ULTRA_THB') return 2;
        return 0;
    }

    getWeaponTypes(): WeaponType[] {
        const types = new Set<WeaponType>();

        // AE: Area-Effect
        if ((this.hasFlag('F_ARTILLERY') && !this.hasFlag('F_DIRECT_FIRE')) || this.hasFlag('F_VGL')) types.add('AE');

        // AI: Anti-Infantry
        if (this.hasAnyFlag(['F_VSP', 'F_BURST_FIRE', 'F_FLAMER', 'F_MG', 'F_MGA', 'F_B_POD'])) types.add('AI');

        // C: Cluster
        // note: SBGauss has no damage==cluster but the ammo does have M_CLUSTER
        if (this.weapon.damage === 'cluster' || this.hasAnyFlag(['F_HAG', 'F_M_POD'])) {
            types.add('C');
        }

        // DB: Direct-Fire Ballistic
        if (this.ammoType === 'SBGAUSS'
            || (this.hasAllFlags(['F_BALLISTIC', 'F_DIRECT_FIRE']) && !this.hasAnyFlag(['F_M_POD', 'F_PLASMA']))
            || this.hasAnyFlag(['F_MG','F_MGA'])) {
            types.add('DB');
        }

        // DE: Direct-Fire Energy
        if ((this.hasFlag('F_DIRECT_FIRE') && this.hasAnyFlag(['F_ENERGY', 'F_PLASMA']) && !this.hasFlag('F_PULSE'))
            || this.hasAnyFlag(['F_FLAMER'])) {
            types.add('DE');
        }

        // E: Electronics
        if (this.hasAnyFlag(['F_TAG', 'F_C3M', 'F_C3MBS', 'F_BAP']) || this.ammoType === 'C3_REMOTE_SENSOR') types.add('E');

        // F: Flak
        if ((this.hasFlag('F_ARTILLERY') && !this.hasFlag('F_DIRECT_FIRE'))
            || (this.ammoType === 'SBGAUSS')) {
            types.add('F');
        }

        // H: Heat-Causing
        if (this.hasAnyFlag(['F_FLAMER', 'F_PLASMA', 'F_INFERNO', 'F_INCENDIARY_NEEDLES'])) types.add('H');

        // M: Missile
        if (this.hasFlag('F_MISSILE') || getAmmoCategory(this.ammoType) === 'Missile') types.add('M');

        // OS: One-Shot
        if (this.hasAnyFlag(['F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT'])) types.add('OS');

        // P: Pulse
        if (this.hasFlag('F_PULSE')) types.add('P');

        // PB: Point-Blank
        if (this.hasAnyFlag(['F_AMS','F_AP_POD','F_B_POD'])) types.add('PB');

        // R: Rapid-Fire
        if (['AC_ULTRA', 'AC_ULTRA_THB', 'AC_ROTARY'].includes(this.ammoType)) types.add('R');

        // S: Switchable Ammo
        if (SWITCHABLE_AMMO.has(this.ammoType)) types.add('S');
        
        // V: Variable Damage
        if (Array.isArray(this.damage) || this.hasFlag('F_BOMBAST_LASER')) types.add('V');

        // X: Explosive
        // Note: had to put AC and PPC in the filter because they have explosive==true due to the ppc capacitor
        if (this.stats.explosive && !this.hasAnyFlag(['F_AC', 'F_PPC'])) types.add('X');

        return orderedWeaponTypes(types);
    }

    override canSplit(): boolean {
        return (typeof this.stats.criticalSlots === 'number' && this.stats.criticalSlots >= 8) || super.canSplit();
    }

    get oneShotCount(): 1 | 2 | undefined {
        if (this.hasFlag('F_DOUBLE_ONE_SHOT')) return 2;
        if (this.hasFlag('F_ONE_SHOT')) return 1;
        return undefined;
    }

    get characteristics(): WeaponCharacteristics {
        const normalizedToHitModifier = (typeof this.toHitModifier === 'number') ? [this.toHitModifier] : this.toHitModifier.length > 0 ? [...this.toHitModifier] : [0];
        return {
            name: this.shortName,
            heat: this.heat,
            category: this.getWeaponCategory(),
            ranges: this.ranges,
            minimumRange: this.minimumRange,
            damage: this.getDamageProfile(),
            hitModifiers: normalizedToHitModifier,
            oneShotCount: this.oneShotCount,
        };
    }

    getWeaponCategory(): WeaponCategory {
        const ammoCategory = getAmmoCategory(this.ammoType);
        if (this.hasFlag('F_ENERGY') || ammoCategory === 'Energy') return 'energy';
        if (this.hasFlag('F_ARTILLERY') || ammoCategory === 'Artillery') return 'artillery';
        if (this.hasFlag('F_BALLISTIC') || ammoCategory === 'Ballistic') return 'ballistic';
        if (this.hasFlag('F_MISSILE') || ammoCategory === 'Missile') return 'missile';
        return 'other';
    }

    getDamageProfile(): WeaponDamageProfile {
        const damage = this.damage;
        if (damage === 'cluster') {
            if (this.ammoType === 'HAG') {
                return { kind: 'cluster', damage: this.rackSize, maximum: this.rackSize };
            }
            if (this.ammoType === 'MEK_MORTAR') {
                return { kind: 'cluster', damage: 'Special', maximum: this.rackSize };
            }
            const damagePerMissile = DOUBLE_DAMAGE_AMMO_TYPES.has(this.ammoType) ? 2 : 1;
            return {
                kind: 'missile-cluster',
                damagePerMissile,
                maximum: this.rackSize * damagePerMissile,
            };
        }
        if (damage === 'artillery') {
            return { kind: 'artillery', damage: this.rackSize, maximum: this.rackSize };
        }
        if (damage === 'variable') {
            return { kind: 'variable', maximum: 0 };
        }
        if (Array.isArray(damage)) {
            return { kind: 'range', damage, maximum: Math.max(0, ...damage) };
        }
        if (typeof damage !== 'number' || damage < 0) {
            return { kind: 'special', maximum: 0 };
        }

        const perShot = this.ammoType === 'AC_ULTRA' || this.ammoType === 'AC_ULTRA_THB';
        const multiplier = this.ammoType === 'AC_ROTARY' ? 6 : perShot ? 2 : 1;
        return { kind: 'fixed', damage, maximum: damage * multiplier, perShot };
    }
}

/** A weapon definition validated as a conventional infantry weapon. */
export type InfantryWeaponEquipment = WeaponEquipment & { readonly infantry: InfantryData };

const DOUBLE_DAMAGE_AMMO_TYPES = new Set<AmmoType>([
    'SRM', 'SRM_TORPEDO', 'SRM_STREAK', 'SRM_ADVANCED', 'SRM_IMP', 'MML',
]);

// ============================================================================
// Ammo Equipment Class
// ============================================================================

export class AmmoEquipment extends Equipment {
    readonly ammo: AmmoData;
    readonly munitionType: Set<string>;

    constructor(data: EquipmentRawData) {
        super({ ...data, type: 'ammo' });
        const ammo = merge(AMMO_DEFAULTS, data.ammo);
        this.ammo = {
            ...ammo,
            category: getAmmoCategory(ammo.type) // data.ammo?.category ?? 
        };
        this.munitionType = new Set(this.ammo.munitionType);
    }

    get ammoType(): AmmoType { return this.ammo.type; }
    get rackSize(): number { return this.ammo.rackSize; }
    get shots(): number { return this.ammo.shots; }
    get damagePerShot(): number { return this.ammo.damagePerShot; }
    get capital(): boolean { return this.ammo.capital; }
    get category(): AmmoCategory { return this.ammo.category; }
    get baseAmmo(): string | undefined { return this.ammo.baseAmmo; }
    get mutatorName(): string | undefined { return this.ammo.mutatorName; }
    
    override get toHitModifier(): number | readonly number[] {
        return this.ammoType === 'AC_LBX' && this.hasMunitionType('M_CLUSTER')
            ? -1
            : super.toHitModifier;
    }

    getShots(gameRules: CBTGameRules): number {
        return gameRules.getAmmoShots(this);
    }

    getEffectiveKgPerShot(gameRules: CBTGameRules): number {
        return gameRules.getAmmoKgPerShot(this);
    }

    /** Returns true if kgPerShot was explicitly set (> 0) */
    get hasCustomKgPerShot(): boolean { return this.ammo.kgPerShot > 0; }

    /** Gets kg per shot - uses explicit value if set, otherwise calculates from shots */
    get kgPerShot(): number {
        return this.ammo.kgPerShot > 0 ? this.ammo.kgPerShot : (this.shots > 0 ? 1000 / this.shots : 0);
    }

    hasMunitionType(type: string): boolean {
        return this.munitionType.has(type);
    }

    getWeaponTypes(): WeaponType[] {
        const types = new Set<WeaponType>();
        if (this.category === 'Artillery') types.add('AE');
        if (this.hasMunitionType('M_CLUSTER')) {
            types.add('C');
            if (this.ammoType === 'AC_LBX') {
                types.add('F');
            }
        }
        if (this.hasAnyMunitionType(['M_FRAGMENTATION', 'M_FLECHETTE'])) types.add('AI');
        if (this.hasAnyMunitionType(['M_ECM', 'M_HAYWIRE', 'M_NEMESIS'])) types.add('E');
        if (this.hasMunitionType('M_FLAK')) types.add('F');
        if (this.hasAnyMunitionType(['M_INFERNO', 'M_INFERNO_IV', 'M_THUNDER_INFERNO', 'M_INCENDIARY_AC', 'M_INCENDIARY_LRM'])) types.add('H');
        if (this.hasAnyMunitionType(['M_EXPLOSIVE', 'M_NARC_EX', 'M_DAVY_CROCKETT_M'])) types.add('X');
        return orderedWeaponTypes(types);
    }

    getRemovedDamageTypes(): WeaponType[] {
        if (this.ammoType !== 'SBGAUSS') {
            if (this.hasMunitionType('M_CLUSTER')) { return ['DB', 'DE']; }
        }
        return [];
    }

    private hasAnyMunitionType(types: readonly string[]): boolean {
        return types.some(type => this.hasMunitionType(type));
    }

    compatibleAmmo(other: AmmoEquipment, unit?: Unit, inventory: readonly MountedEquipment[] = []): boolean {
        return AmmoValidityUtil.isAmmoCompatible(this, other, unit, inventory);
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
    /** Heat generated while operating, equivalent to MegaMek's MiscType.getHeat(). */
    get operatingHeat(): number {
        if (this.hasAnyFlag(['F_NULL_SIG', 'F_VOID_SIG'])) return 10;
        if (this.hasFlag('F_MOBILE_HPG')) return this.hasFlag('F_MEK_EQUIPMENT') ? 20 : 40;
        if (this.hasFlag('F_CHAMELEON_SHIELD')) return 6;
        if (this.hasAnyFlag(['F_VIRAL_JAMMER_DECOY', 'F_VIRAL_JAMMER_HOMING'])) return 12;
        if (this.hasFlag('F_RISC_LASER_PULSE_MODULE')
            || this.hasFlag('F_NOVA')
            || this.hasAllFlags(['F_CLUB', 'S_SPOT_WELDER'])) return 2;
        if (this.hasFlag('F_CLUB')) {
            if (this.hasFlag('S_VIBRO_SMALL')) return 3;
            if (this.hasFlag('S_VIBRO_MEDIUM')) return 5;
            if (this.hasFlag('S_VIBRO_LARGE')) return 7;
        }
        return 0;
    }
    get isArmorKit(): boolean { return this.hasFlag('F_ARMOR_KIT'); }
    get isHeatSink(): boolean {
        return this.hasAnyFlag(['F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE']);
    }
    get isCompactHeatSink(): boolean { return this.hasFlag('F_COMPACT_HEAT_SINK'); }
    get heatSinkUnitsPerMount(): number {
        if (!this.isHeatSink) return 0;
        return this.isCompactHeatSink && this.hasFlag('F_DOUBLE_HEAT_SINK') ? 2 : 1;
    }
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

    override get isSpreadable(): boolean {
        return true;
    }
}

// ============================================================================
// Structure Equipment Class
// ============================================================================

export class StructureEquipment extends Equipment {
    readonly structure: StructureData;

    constructor(data: EquipmentRawData) {
        super({ ...data, type: 'structure' });
        this.structure = merge(STRUCTURE_DEFAULTS, data.structure);
    }

    get structureTypeId(): number { return this.structure.typeId; }
}

// ============================================================================
// Factory Functions
// ============================================================================

const EQUIPMENT_CONSTRUCTORS: Record<EquipmentType, new (data: EquipmentRawData) => Equipment> = {
    weapon: WeaponEquipment,
    ammo: AmmoEquipment,
    misc: MiscEquipment,
    armor: ArmorEquipment,
    structure: StructureEquipment
};

/** Creates the appropriate Equipment subclass based on type */
export function createEquipment(data: EquipmentRawData): Equipment {
    const Constructor = EQUIPMENT_CONSTRUCTORS[data.type] ?? Equipment;
    return new Constructor(data);
}
