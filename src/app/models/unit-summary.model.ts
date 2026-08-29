// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


import type { Equipment } from "./equipment.model";
import type { WeaponType } from './weapon-types.model';
import type { Era } from "./eras.model";
import type { ComponentTechLevel, MoveType, UnitSubtype, UnitType } from "./entity/types";
import type { TechBase, UnitTechBaseDisplay } from "./tech.model";

export type { MoveType, UnitSubtype, UnitType } from "./entity/types";

export const CBT_WEIGHT_CLASSES = [
    'Ultra Light/PA(L)/Exoskeleton',
    'Light',
    'Medium',
    'Heavy',
    'Assault',
    'Colossal/Super-Heavy',
    'Small Craft',
    'Small Dropship',
    'Small Jumpship',
    'Small Space Station',
    'Small Support Vehicle',
    'Small Warship',
    'Medium Dropship',
    'Medium Support Vehicle',
    'Large Dropship',
    'Large Jumpship',
    'Large Space Station',
    'Large Support Vehicle',
    'Large Warship',
] as const;

export type WeightClass = typeof CBT_WEIGHT_CLASSES[number];

/** Engine type names exported by MegaMekLab's SVGMassPrinter. */
export type UnitEngineType =
    | 'ICE'
    | 'Fusion'
    | 'XL (IS)'
    | 'XL (Clan)'
    | 'XXL (IS)'
    | 'XXL (Clan)'
    | 'Fuel Cell'
    | 'Light'
    | 'Compact'
    | 'Fission'
    | 'None'
    | 'MagLev'
    | 'Steam'
    | 'Battery'
    | 'Solar'
    | 'External';

const FUSION_UNIT_ENGINE_TYPES: ReadonlySet<UnitEngineType> = new Set([
    'Fusion',
    'XL (IS)',
    'XL (Clan)',
    'XXL (IS)',
    'XXL (Clan)',
    'Light',
    'Compact',
]);

/** Whether exported unit metadata describes a fusion-family engine. */
export function isFusionUnitEngine(
    engine: UnitEngineType | null | undefined,
): engine is UnitEngineType {
    return engine !== null && engine !== undefined && FUSION_UNIT_ENGINE_TYPES.has(engine);
}

export const CBT_WEIGHT_CLASS_ORDINALS = new Map<WeightClass, number>(
    CBT_WEIGHT_CLASSES.map((weightClass, index) => [weightClass, index] as const)
);

// Weapon/component info for comp.w
export interface UnitComponent {
    id: string;     // Internal Name
    q: number;      // quantity
    q2?: number;     // used for ammo count (as q is used for the tons)
    n: string;      // Display Name
    /**
     * type:
     * E: Energy
     * M: Missile
     * B: Ballistic
     * A: Artillery
     * P: Physical
     * O: Other
     * X: Ammo
     * C: Components (these are the non-weapon components, the usual MiscType like CASE, JJ, HeatSink, etc...)
     * S: Structural (armor/structure related)
     * HIDDEN: used for fake components for the search index, not actually rendered
     */
    t: 'E' | 'M' | 'B' | 'A' | 'X' | 'P' | 'O' | 'C' | 'S' | 'HIDDEN'; // type
    p: number; // the location id 
    l: string;      // location (RA, LT, LA, etc. Can contain multiple locations if component is split: LA/LT)
    rear?: boolean  // rear-mounted
    r?: string;      // range (e.g. "6/12/18")
    m?: string;      // minimum range or other info
    d?: string;      // damage per shot
    md?: string;     // max damage
    c?: string;      // slots/criticals
    os?: number;     // oneshot (0 = no, 1 = oneshot, 2 = double oneshot)
    cw?: number;     // for field guns: CREW size required to operate the weapon
    bay?: UnitComponent[];
    eq?: Equipment; // linked equipment data
}

/** Canonical MegaMek material code and technology base at one unit location. */
export interface UnitMaterialLayoutEntry {
    readonly type: number;
    readonly clan: boolean;
}

export type UnitMaterialLayout = Readonly<Record<string, UnitMaterialLayoutEntry>>;

export interface UnitTagEntry {
    /** Tag display label */
    tag: string;
    /** Quantity for this tag assignment, defaults to 1 */
    quantity: number;
}

export interface UnitFluffSystem {
    label?: string;
    manufacturer?: string;
    model?: string;
}

export interface UnitImageFluff {
    img?: string;
}

export interface UnitFluffCatalogEntry extends UnitImageFluff {
    manufacturer?: string;
    primaryFactory?: string;
    capabilities?: string;
    overview?: string;
    deployment?: string;
    history?: string;
    notes?: string;
    systems?: UnitFluffSystem[];
}

export interface UnitFluffCatalogMetadata {
    version: string | number;
    etag: string;
    count: number;
}

export interface UnitFluffCatalog {
    version: string | number;
    etag: string;
    fluff: Record<string, UnitFluffCatalogEntry>;
}

export interface UnitSummary {
    uuid: string; // Unique identifier of the unit
    name: string; // Internal unique name
    id: number; // MUL id
    chassis: string;
    model: string;
    year: number;
    weightClass: WeightClass;
    tons: number;
    loadoutTons: number;
    offSpeedFactor: number;
    bv: number;
    cost: number;
    level: ComponentTechLevel;
    techBase: TechBase;
    mixed: boolean;
    techRating: string;
    type: UnitType;
    subtype: UnitSubtype;
    omni: number;
    engine: UnitEngineType | null;
    engineRating: number;
    engineHS: number; // Number of HeatSinks on the engine
    engineHSType: string | null; // Type of HeatSinks on the engine: "Heat Sink", "Double Heat Sink", "Laser Heat Sink", etc...
    source: string[]; // Sourcebook abbreviations exported from units.json.
    published: string[]; // Record sheet source(s), e.g. "RS:AS".
    rulesRefs: string[][]; // Alternative rulebook combinations that fully cover the unit, e.g. [["Core"], ["TW", "IO:AUE"]].
    canon: boolean; // True if the unit is canon, false if is not (e.g. alt-universe or april fools units)
    canAntiMech: boolean; // Whether the unit's Anti-Mech skill can be assigned below its restricted default
    role: string;
    armorType: string;
    structureType: string | null;
    patchworkLayout?: UnitMaterialLayout;
    hybridLayout?: UnitMaterialLayout;
    armor: number;
    armorPer: number; // Armor %
    internal: number;
    squads?: number;
    squadSize?: number;
    heat: number;
    dissipation: number;
    diss?: number[]; // Mix/Max dissipation
    moveType: MoveType;
    walk: number;
    walk2: number; // Max possible
    run: number; // Without MASC systems
    run2: number; // Max possible
    jump: number;
    jump2: number; // Max possible
    umu: number; // UMU movement points
    c3: string;
    dpt: number; // Damage per Turn, weighted on heat
    comp: UnitComponent[];
    su: number;
    crewSize: number;
    quirks: string[];
    features: string[];
    icon: string;
    fluff?: UnitImageFluff;
    cargo?: {
        n: number; // number of the cargo bay
        type: string; // type of cargo bay
        capacity: string; // capacity of the cargo bay
        doors: number; // number of doors
    }[];
    capital?: {
        dropshipCapacity: number;
        escapePods: number;
        lifeBoats: number;
        gravDecks: number[];
        sailIntegrity: number;
        kfIntegrity: number;
    },
    sheets: string[];
    as: AlphaStrikeUnitStats;
    unitFile?: string;
    serverHost?: string; // Base URL of the additional unit server this unit was loaded from; undefined means the primary db.mekbay.com host.
    _searchKey: string; // Pre-compiled lowercase search key: "chassis model"
    _displayType: string;
    _techBaseDisplay: UnitTechBaseDisplay; // Mixed-aware tech base used by display, search, and sorting.
    _maxRange: number; // Max range of any weapon on this unit
    _weightedMaxRange: number; // Damage-weighted average of weapon max ranges
    _dissipationEfficiency: number; // Dissipation - Heat
    _mdSumNoPhysical: number; // Max damage sum for all weapons except physical
    _mdSumNoPhysicalNoOneshots: number; // Max damage sum for all weapons except physical, ignoring oneshots
    _weaponTypes?: WeaponType[]; // Intrinsic types present on mounted weapons
    _weaponTypeCounts?: Partial<Record<WeaponType, number>>; // Mounted quantity by intrinsic weapon type
    _era?: Era; // Cached era for this unit
    _nameTags: UnitTagEntry[]; // Quantity-aware tags assigned to this specific unit name
    _chassisTags: UnitTagEntry[]; // Quantity-aware tags assigned to the chassis (applies to all variants)
    _publicTags?: PublicTagInfo[]; // Tags from other users (temporary or subscribed)
}

export type UnitHeight = 1 | 2 | 3;

export function getUnitHeight(unit: Pick<UnitSummary, 'type' | 'tons'>, prone = false): UnitHeight {
    const standingHeight: UnitHeight = unit.type !== 'Mek' ? 1 : unit.tons > 100 ? 3 : 2;
    return prone && standingHeight > 1
        ? (standingHeight - 1) as UnitHeight
        : standingHeight;
}

/** Information about a public tag from another user */
export interface PublicTagInfo {
    /** The tag name */
    tag: string;
    /** The publicId of the tag owner */
    publicId: string;
    /** Whether this is a permanent subscription */
    subscribed: boolean;
}

export interface Units {
    version: string;
    etag: string;
    units: UnitSummary[];
}

export type ASUnitTypeCode = 'BM' | 'IM' | 'CV' | 'SV' | 'PM' | 'BA' | 'CI' | 'AF' | 'CF' | 'SC' | 'WS' | 'SS' | 'JS' | 'DA' | 'DS' | 'MS' | 'BD' | 'XX';

export interface AlphaStrikeUnitStats {
    TP: ASUnitTypeCode;
    PV: number;
    SZ: number;
    TMM: number | null | undefined;
    usesOV: boolean;
    OV: number;
    MV: string;
    MVm: { [mode: string]: number }; // e.g. { j: 6 }
    MVp: string;
    usesTh: boolean;
    Th: number;
    Arm: number;
    Str: number;
    specials: string[];
    dmg: {
        dmgS: string;
        dmgM: string;
        dmgL: string;
        dmgE: string;
        _dmgS?: number; // Precomputed numeric values for filtering
        _dmgM?: number;
        _dmgL?: number;
        _dmgE?: number;
    };
    usesE: boolean;
    usesArcs: boolean;
    frontArc?: AlphaStrikeArcStats;
    rearArc?: AlphaStrikeArcStats;
    leftArc?: AlphaStrikeArcStats;
    rightArc?: AlphaStrikeArcStats;
}

export interface AlphaStrikeArcStats {
    STD: {
        dmgM: string;
        dmgL: string;
        dmgE: string;
        dmgS: string;
    };
    CAP: {
        dmgM: string;
        dmgL: string;
        dmgE: string;
        dmgS: string;
    };
    MSL: {
        dmgM: string;
        dmgL: string;
        dmgE: string;
        dmgS: string;
    };
    SCAP: {
        dmgM: string;
        dmgL: string;
        dmgE: string;
        dmgS: string;
    };
    specials: string[];
}
