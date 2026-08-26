// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ComponentTechLevel, EntityType, MoveType, UnitSubtype, UnitType } from './entity/types';
import type { EntityLoadIssue } from './entity/parsers/parse-context';
import type { Equipment } from './equipment.model';
import type { Era } from './eras.model';
import type { TechBase, UnitTechBaseDisplay } from './tech.model';
import type { WeaponType } from './weapon-types.model';
import type {
  CatalogEntryOrigin,
  UnitProviderId,
  UnitUuid,
} from '../services/unit-catalog/unit-catalog.types';

/** Bump when generated UnitSummary fields or their meaning change. */
export const UNIT_SUMMARY_VERSION = 8 as const;

export type { MoveType, UnitSubtype, UnitType } from './entity/types';

export const CBT_WEIGHT_CLASSES = [
  'Ultra Light/PA(L)/Exoskeleton', 'Light', 'Medium', 'Heavy', 'Assault',
  'Colossal/Super-Heavy', 'Small Craft', 'Small DropShip', 'Small JumpShip',
  'Small Space Station', 'Small Support Vehicle', 'Small WarShip',
  'Medium DropShip', 'Medium Support Vehicle', 'Large DropShip',
  'Large JumpShip', 'Large Space Station', 'Large Support Vehicle', 'Large WarShip',
] as const;

export type WeightClass = typeof CBT_WEIGHT_CLASSES[number];

export const CBT_WEIGHT_CLASS_ORDINALS = new Map<WeightClass, number>(
  CBT_WEIGHT_CLASSES.map((weightClass, index) => [weightClass, index] as const),
);

export interface UnitComponent {
  id: string;
  q: number;
  q2?: number;
  n: string;
  t: 'E' | 'M' | 'B' | 'A' | 'X' | 'P' | 'O' | 'C' | 'S' | 'HIDDEN';
  p: number;
  l: string;
  rear?: boolean;
  r?: string;
  m?: string;
  d?: string;
  md?: string;
  c?: string;
  os?: number;
  cw?: number;
  bay?: UnitComponent[];
  /** Runtime-only linked equipment. Persisted summary validators reject it. */
  eq?: Equipment;
}

export interface UnitTagEntry {
  tag: string;
  quantity: number;
}

export interface PublicTagInfo {
  tag: string;
  publicId: string;
  subscribed: boolean;
}

export type ASUnitTypeCode = 'BM' | 'IM' | 'CV' | 'SV' | 'PM' | 'BA' | 'CI' | 'AF' | 'CF' | 'SC' | 'WS' | 'SS' | 'JS' | 'DA' | 'DS' | 'MS' | 'BD' | 'XX';

export interface AlphaStrikeArcStats {
  STD: { dmgM: string; dmgL: string; dmgE: string; dmgS: string };
  CAP: { dmgM: string; dmgL: string; dmgE: string; dmgS: string };
  MSL: { dmgM: string; dmgL: string; dmgE: string; dmgS: string };
  SCAP: { dmgM: string; dmgL: string; dmgE: string; dmgS: string };
  specials: string[];
}

export interface AlphaStrikeUnitStats {
  TP: ASUnitTypeCode;
  PV: number;
  SZ: number;
  TMM: number | null | undefined;
  usesOV: boolean;
  OV: number;
  MV: string;
  MVm: Record<string, number>;
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
    _dmgS?: number;
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

/** Serialized component projection: database Equipment objects never leak in. */
export type UnitSummaryComponent = Omit<UnitComponent, 'bay'> & {
  bay?: UnitSummaryComponent[];
};

/**
 * The complete lightweight, serializable projection used by catalog/search UI.
 * Runtime indexes, linked Equipment objects, and native-source prose/system
 * fluff are deliberately absent. Consumers that need fluff must load the
 * referenced MTF/BLK or blueprint on demand.
 */
export interface UnitSummary {
  uuid: UnitUuid;
  provider: UnitProviderId;
  origin: CatalogEntryOrigin;
  /** Supplier-provided source revision; native core rows use the MTF/BLK SHA-1. */
  hash: string;
  /** Projection revision used to decide whether this row must be regenerated. */
  summaryVersion: number;
  /** Recoverable problems found while loading the source entity. */
  loadIssues: readonly EntityLoadIssue[];

  name: string;
  /** MegaMek Unit List (MUL) database reference. Not unique; -1 means absent. */
  id: number;
  chassis: string;
  baseChassis: string;
  clanName?: string;
  model: string;
  year: number;
  weightClass: WeightClass;
  tons: number;
  loadoutTons: number;
  offSpeedFactor: number;
  bv: number;
  pv: number;
  cost: number;
  level: ComponentTechLevel;
  techBase: TechBase;
  mixed: boolean;
  techRating: string;
  type: UnitType;
  subtype: UnitSubtype;
  /** Exact parsed family discriminant; presentation code must not infer it from labels. */
  entityType: EntityType;
  omni: number;
  engine: string | null;
  engineRating: number;
  engineHS: number;
  engineHSType: string | null;
  source: string[];
  published: string[];
  /** Inclusion-minimal sourcebook combinations covering the unit's referenced rules. */
  rulesRefs: string[][];
  canon: boolean;
  canAntiMech: boolean;
  role: string;
  armorType: string;
  structureType: string | null;
  armor: number;
  armorPer: number;
  internal: number;
  squads: number;
  squadSize: number;
  heat: number;
  dissipation: number;
  diss?: number[];
  moveType: MoveType;
  walk: number;
  walk2: number;
  run: number;
  run2: number;
  jump: number;
  jump2: number;
  umu: number;
  c3: string;
  dpt: number;
  comp: UnitSummaryComponent[];
  su: number;
  crewSize: number;
  quirks: string[];
  features: string[];
  icon: string;
  cargo?: {
    n: number;
    type: string;
    capacity: string;
    doors: number;
  }[];
  capital?: {
    dropshipCapacity: number;
    escapePods: number;
    lifeBoats: number;
    gravDecks: number[];
    sailIntegrity: number;
    kfIntegrity: number;
  };
  as: AlphaStrikeUnitStats;

  /** Transient presentation/search overlay; never serialized in summary stores. */
  unitFile?: string;
  serverHost?: string;
  _searchKey?: string;
  _searchKeyAlphanumeric?: string;
  _displayType?: string;
  _techBaseDisplay?: UnitTechBaseDisplay;
  _maxRange?: number;
  _weightedMaxRange?: number;
  _dissipationEfficiency?: number;
  _mdSumNoPhysical?: number;
  _mdSumNoPhysicalNoOneshots?: number;
  _weaponTypes?: WeaponType[];
  _weaponTypeCounts?: Partial<Record<WeaponType, number>>;
  _era?: Era;
  _nameTags?: UnitTagEntry[];
  _chassisTags?: UnitTagEntry[];
  _publicTags?: PublicTagInfo[];
}

/** Untrusted additional-provider transport; converted to validated UnitSummary rows at ingress. */
export interface Units {
  version: string;
  assetHash: string;
  units: UnitSummary[];
}
