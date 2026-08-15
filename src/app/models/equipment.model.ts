// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
import type { EquipmentFlag } from './equipment-flags.type';
import { AmmoMunitionFlag } from './ammo-munition-flags.type';
import type { EquipmentRegistry } from './equipment-lookup';
import { WEAPON_TYPES, type WeaponType } from './weapon-types.model';



// ============================================================================
// Type Definitions
// ============================================================================

export type EquipmentType = 'weapon' | 'ammo' | 'misc' | 'armor' | 'structure';
export type TechLevel = 'Introductory' | 'Standard' | 'Advanced' | 'Experimental' | 'Unofficial';
export type RangeBrackets = 'short' | 'medium' | 'long' | 'extreme';
export type WeaponCategory = 'energy' | 'missile' | 'ballistic' | 'artillery' | 'other';

export type WeaponDamageUnit = 'missile' | 'shot' | 'artillery';

/** Resolved damage values, using zero when the source has no intrinsic numeric damage. */
export interface WeaponDamage {
    readonly values: readonly number[];
    readonly maximum: number;
    readonly unit?: WeaponDamageUnit;
}
// ============================================================================
// Ammo Types
// ============================================================================

export type AmmoCategory = 'Ballistic' | 'Missile' | 'Energy' | 'Artillery' | 'Bomb' | 'Chemical' | 'Special';

export type AmmoType =
    | 'NA' | 'AC' | 'VEHICLE_FLAMER' | 'MG' | 'MG_HEAVY' | 'MG_LIGHT' | 'GAUSS'
    | 'LRM' | 'LRM_TORPEDO' | 'NLRM_TORPEDO' | 'SRM' | 'SRM_TORPEDO' | 'SRM_STREAK' | 'MRM'
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
    NLRM_TORPEDO: 'Missile',
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
    heatAdjustmentForBvCalculation?: number;
    damage: string | number | Array<number>;
    explosionDamage: number;
    rackSize: number;
    ammoType: AmmoType;
    atClass?: string;
    missileArmor?: number;
    ranges: number[];      // [short, medium, long, extreme]
    wRanges: number[];     // Water ranges [short, medium, long, extreme]
    minRange: number;
    maxRangeBracket: RangeBrackets;
    av: number[];          // Aerospace attack values [short, medium, long, extreme]
    capital: boolean;
    subCapital: boolean;
    alphaStrike?: AlphaStrikeWeaponData;
}

export type AlphaStrikeBattleForceClass =
    | 'LRM' | 'SRM' | 'MML' | 'TORPEDO' | 'AC' | 'FLAK' | 'IATM' | 'REL'
    | 'CAPITAL' | 'SUBCAPITAL' | 'CAPITAL_MISSILE';

/** Static Alpha Strike conversion values exported by MegaMek's WeaponType. */
export interface AlphaStrikeWeaponData {
    battleForceClass?: AlphaStrikeBattleForceClass;
    pointDefense?: boolean;
    indirectFire?: boolean;
    damage?: [number, number, number, number];
    heat?: number;
    heatDamage?: [number, number, number, number];
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
    munitionType: AmmoMunitionFlag[];
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
    flags?: EquipmentFlag[];
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
    readonly flags: Set<EquipmentFlag>;
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
    hasFixedTonnage(): this is this & { readonly tonnage: number } { return typeof this.tonnage === 'number'; }
    hasFixedCost(): this is this & { readonly cost: number } { return typeof this.cost === 'number'; }
    hasFixedBV(): this is this & { readonly bv: number } { return typeof this.bv === 'number'; }
    hasFixedCriticalSlots(): this is this & { readonly critSlots: number } {
        return typeof this.critSlots === 'number';
    }
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

    hasFlag(flag: EquipmentFlag): boolean { return this.flags.has(flag); }
    hasAnyFlag(flags: EquipmentFlag[]): boolean { return flags.some(f => this.flags.has(f)); }
    hasAllFlags(flags: EquipmentFlag[]): boolean { return flags.every(f => this.flags.has(f)); }
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
    'THUMPER',
    'SNIPER',
    'LONG_TOM', 'LONG_TOM_PRIM',
]);


function orderedWeaponTypes(types: Iterable<WeaponType>): WeaponType[] {
    const typeSet = new Set(types);
    return WEAPON_TYPES.filter(type => typeSet.has(type));
}

const NON_DAMAGING_WEAPON_FLAGS = ['F_TAG', 'F_AMS', 'F_NARC'] as const;

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
    get alphaStrike(): AlphaStrikeWeaponData | undefined { return this.weapon.alphaStrike; }
    /** Resolves the sparse Alpha Strike exception over the general indirect-fire flag. */
    get alphaStrikeIndirectFire(): boolean {
        return this.alphaStrike?.indirectFire ?? this.hasFlag('F_INDIRECT_FIRE');
    }

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

    get supportsSwitchableAmmo(): boolean {
        return SWITCHABLE_AMMO.has(this.ammoType);
    }

    getWeaponTypes(): WeaponType[] {
        const types = new Set<WeaponType>();

        // AE: Area-Effect
        if ((this.hasFlag('F_ARTILLERY') && !this.hasFlag('F_DIRECT_FIRE')) || this.hasFlag('F_VGL')) types.add('AE');

        // AI: Anti-Infantry
        if (this.hasAnyFlag(['F_VSP', 'F_BURST_FIRE', 'F_FLAMER', 'F_MG', 'F_MGA'])) types.add('AI');

        // C: Cluster
        // note: SBGauss has no damage==cluster but the ammo does have M_CLUSTER
        if ((this.weapon.damage === 'cluster' && !this.hasAnyFlag(['F_LARGE_MISSILE', 'F_NARC'])) 
            || this.hasAnyFlag(['F_HAG', 'F_M_POD'])) {
            types.add('C');
        }

        // DB: Direct-Fire Ballistic
        if (this.ammoType === 'SBGAUSS' 
            || this.ammoType === 'SNIPER_CANNON'
            || this.ammoType === 'THUMPER_CANNON'
            || this.ammoType === 'LONG_TOM_CANNON'
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
            || this.ammoType === 'SBGAUSS'
            || this.ammoType === 'SNIPER_CANNON'
            || this.ammoType === 'THUMPER_CANNON'
            || this.ammoType === 'LONG_TOM_CANNON') {
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
        if (this.supportsSwitchableAmmo) types.add('S');
        
        // V: Variable Damage
        if (Array.isArray(this.damage) || this.hasAnyFlag(['F_BOMBAST_LASER','F_M_POD'])) types.add('V');

        // X: Explosive
        // Note: had to put AC and PPC in the filter because they have explosive==true and that's an optional rule (they still get clan case thou!)
        if (this.stats.explosive && !this.hasAnyFlag(['F_AC', 'F_PPC', 'F_B_POD', 'F_M_POD'])) types.add('X');

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

    getWeaponCategory(): WeaponCategory {
        const ammoCategory = getAmmoCategory(this.ammoType);
        if (this.hasFlag('F_ENERGY') || ammoCategory === 'Energy') return 'energy';
        if (this.hasFlag('F_ARTILLERY') || ammoCategory === 'Artillery') return 'artillery';
        if (this.hasFlag('F_BALLISTIC') || ammoCategory === 'Ballistic') return 'ballistic';
        if (this.hasFlag('F_MISSILE') || ammoCategory === 'Missile') return 'missile';
        return 'other';
    }

}

export interface WeaponDamageOptions {
    readonly ammo?: AmmoEquipment | null;
    readonly ammoProfile?: AmmoWeaponProfile | null;
    readonly range?: 'short' | 'medium' | 'long' | 'extreme' | null;
}

const DAMAGE_RANGE_INDEX = { short: 0, medium: 1, long: 2, extreme: 2 } as const;

/** Uses compatible selected ammo, falling back to the canonical catalog ammo. */
export function resolveWeaponDamage(
    weapon: WeaponEquipment,
    equipmentRegistry: EquipmentRegistry,
    options: WeaponDamageOptions = {},
): WeaponDamage {
    const ammo = resolveWeaponAmmo(weapon, equipmentRegistry, options);
    const damage = resolveWeaponDamageWithAmmo(weapon, ammo);
    if (!options.range || damage.values.length < 2) return damage;
    return { ...damage, values: [damage.values[DAMAGE_RANGE_INDEX[options.range]] ?? 0] };
}

/** Resolves compatible mounted ammo or the canonical catalog fallback. */
export function resolveWeaponAmmo(
    weapon: WeaponEquipment,
    equipmentRegistry: EquipmentRegistry,
    options: Pick<WeaponDamageOptions, 'ammo' | 'ammoProfile'> = {},
): AmmoEquipment | null {
    return ammoMatchesWeapon(weapon, options.ammo)
        ? options.ammo
        : findStandardAmmoForWeapon(weapon, equipmentRegistry, options.ammoProfile);
}

function resolveWeaponDamageWithAmmo(weapon: WeaponEquipment, ammo: AmmoEquipment | null): WeaponDamage {
    const damage = weapon.weapon.damage;
    if (damage === '') return fixedDamage(0);
    if (damage === 'special' && weapon.oneShotCount && ammo) return fixedDamage(ammo.damagePerShot);
    if (damage === 'cluster') return resolveClusterDamage(weapon, ammo);
    if (damage === 'artillery') return fixedDamage(weapon.rackSize, 'artillery');
    if (damage === 'variable') return resolveVariableDamage(weapon);
    if (Array.isArray(damage)) return { values: damage, maximum: Math.max(0, ...damage) };
    if (typeof damage !== 'number' || damage < 0) return fixedDamage(weapon.rackSize);

    const shots = weapon.getRapidFireCount();
    return {
        values: [damage],
        maximum: damage * Math.max(1, shots),
        ...(shots > 0 && { unit: 'shot' as const }),
    };
}

function resolveClusterDamage(weapon: WeaponEquipment, ammo: AmmoEquipment | null): WeaponDamage {
    if (weapon.hasFlag('F_LARGE_MISSILE')) return fixedDamage(ammo?.damagePerShot ?? 0);
    if (weapon.ammoType === 'HAG') return fixedDamage(weapon.rackSize);
    if (weapon.ammoType === 'MEK_MORTAR') {
        const damagePerMissile = ammo?.damagePerShot ?? 2;
        return { values: [damagePerMissile], maximum: weapon.rackSize * damagePerMissile, unit: 'missile' };
    }
    if (weapon.ammoType === 'BA_TUBE' || !weapon.hasFlag('F_MISSILE')) {
        return fixedDamage(weapon.rackSize);
    }
    return {
        values: [ammo?.damagePerShot ?? 0],
        maximum: ammo ? weapon.rackSize * ammo.damagePerShot : 0,
        unit: 'missile',
    };
}

function fixedDamage(value: number, unit?: WeaponDamageUnit): WeaponDamage {
    return { values: [value], maximum: value, ...(unit && { unit }) };
}

function resolveVariableDamage(weapon: WeaponEquipment): WeaponDamage {
    // MegaMek's record-sheet formatter explicitly leaves the Clan Plasma Cannon
    // numeric damage blank; other unresolved variable weapons use their rack size.
    return fixedDamage(weapon.internalName === 'CLPlasmaCannon' ? 0 : weapon.rackSize);
}

/** Finds the canonical damage-bearing ammo definition; it does not imply carried ammo. */
export function findStandardAmmoForWeapon(
    weapon: WeaponEquipment,
    equipmentRegistry: EquipmentRegistry,
    ammoProfile?: AmmoWeaponProfile | null,
): AmmoEquipment | null {
    if (weapon.ammoType === 'NA') return null;

    let compatibleAmmo = getAmmoForWeapon(weapon, equipmentRegistry);

    if (ammoProfile) {
        compatibleAmmo = compatibleAmmo.filter(ammo => ammoMatchesProfile(ammo, ammoProfile));
    } else if (weapon.ammoType === 'MML') {
        compatibleAmmo = compatibleAmmo.filter(ammo => resolveAmmoWeaponProfile(ammo)?.id === 'mml-lrm');
    } else {
        compatibleAmmo = compatibleAmmo.filter(ammo =>
            ammo.hasMunitionType('M_STANDARD') || ammo.munitionType.size === 0);
    }

    return compatibleAmmo.sort(compareStandardAmmo)[0] ?? null;
}

function ammoMatchesProfile(ammo: AmmoEquipment, profile?: AmmoWeaponProfile | null): boolean {
    return !profile || resolveAmmoWeaponProfile(ammo)?.id === profile.id;
}

function compareStandardAmmo(left: AmmoEquipment, right: AmmoEquipment): number {
    const rank = (ammo: AmmoEquipment): number =>
        ammo.munitionType.size === 1 && ammo.hasMunitionType('M_STANDARD') ? 0
            : ammo.hasMunitionType('M_STANDARD') ? 1
                : ammo.munitionType.size === 0 ? 2 : 3;
    return rank(left) - rank(right) || left.id.localeCompare(right.id);
}

/** Finds the standard ammunition definition carried intrinsically by a one-shot weapon. */
export function findIntrinsicAmmoForWeapon(
    weapon: WeaponEquipment,
    equipmentRegistry: EquipmentRegistry,
): AmmoEquipment | null {
    if ((!weapon.oneShotCount && !weapon.hasFlag('F_LARGE_MISSILE')) || weapon.ammoType === 'NA') return null;

    return getAmmoForWeapon(weapon, equipmentRegistry)
        .sort(compareStandardAmmo)[0] ?? null;
}

function getAmmoForWeapon(
    weapon: WeaponEquipment,
    equipmentRegistry: EquipmentRegistry,
): AmmoEquipment[] {
    return [...equipmentRegistry.getAmmoForWeapon(weapon)];
}

export function ammoMatchesWeapon(weapon: WeaponEquipment, ammo?: AmmoEquipment | null): ammo is AmmoEquipment {
    if (!ammo || ammo.ammoType !== weapon.ammoType) return false;
    if (weapon.hasFlag('F_BA_WEAPON') !== ammo.hasFlag('F_BATTLEARMOR')) return false;
    return weapon.rackSize <= 0 || ammo.rackSize === weapon.rackSize;
}

/** A weapon definition validated as a conventional infantry weapon. */
export type InfantryWeaponEquipment = WeaponEquipment & { readonly infantry: InfantryData };

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

    getShots(gameRules: CBTGameRules, equipmentRegistry?: EquipmentRegistry): number {
        return gameRules.getAmmoShots(this, equipmentRegistry);
    }

    getEffectiveKgPerShot(gameRules: CBTGameRules, equipmentRegistry?: EquipmentRegistry): number {
        return gameRules.getAmmoKgPerShot(this, equipmentRegistry);
    }

    /** Returns true if kgPerShot was explicitly set (> 0) */
    get hasCustomKgPerShot(): boolean { return this.ammo.kgPerShot > 0; }

    /** Gets kg per shot - uses explicit value if set, otherwise calculates from shots */
    get kgPerShot(): number {
        return this.ammo.kgPerShot > 0 ? this.ammo.kgPerShot : (this.shots > 0 ? 1000 / this.shots : 0);
    }

    hasMunitionType(type: AmmoMunitionFlag): boolean {
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
        if (this.hasAnyMunitionType(['M_INFERNO', 'M_INFERNO_IV', 'M_THUNDER_INFERNO', 'M_INCENDIARY', 'M_INCENDIARY_LRM'])) types.add('H');
        if (this.hasAnyMunitionType(['M_EXPLOSIVE', 'M_NARC_EX', 'M_DAVY_CROCKETT_M'])) types.add('X');
        return orderedWeaponTypes(types);
    }

    getRemovedDamageTypes(): WeaponType[] {
        if (this.ammoType !== 'SBGAUSS') {
            if (this.hasMunitionType('M_CLUSTER')) { return ['DB', 'DE']; }
        }
        return [];
    }

    private hasAnyMunitionType(types: readonly AmmoMunitionFlag[]): boolean {
        return types.some(type => this.hasMunitionType(type));
    }

    compatibleAmmo(other: AmmoEquipment, unit?: Unit, inventory: readonly MountedEquipment[] = []): boolean {
        return AmmoValidityUtil.isAmmoCompatible(this, other, unit, inventory);
    }
}

const NATIVE_TORPEDO_AMMO_TYPES = new Set<AmmoType>([
    'LRM_TORPEDO',
    'SRM_TORPEDO',
    'NLRM_TORPEDO',
]);

/** MegaMek's native SRT/LRT/NLRT ammo types plus torpedo-converted missile ammo. */
export function isTorpedoAmmo(ammo: AmmoEquipment | null | undefined): boolean {
    return ammo !== null && ammo !== undefined
        && (NATIVE_TORPEDO_AMMO_TYPES.has(ammo.ammoType) || ammo.hasMunitionType('M_TORPEDO'));
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
    /** Whether this is a physical shield, equivalent to MegaMek's MiscType.isShield(). */
    get isShield(): boolean { return this.hasFlag('F_SHIELD'); }
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
        return this.hasAnyFlag(['F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE', 'F_LASER_HEAT_SINK']);
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

const BOMB_AMMO_FLAGS: EquipmentFlag[] = [
    'F_ALT_BOMB', 'F_DIVE_BOMB', 'F_GROUND_BOMB', 'F_OTHER_BOMB', 'F_SPACE_BOMB',
];

/** Whether equipment is a bomb payload excluded from aerospace construction mass. */
export function isBombEquipment(equipment: Equipment): boolean {
    if (equipment instanceof AmmoEquipment) return equipment.hasAnyFlag(BOMB_AMMO_FLAGS);
    return equipment instanceof WeaponEquipment && equipment.hasFlag('F_BOMB_WEAPON');
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
