// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { compareText } from './string.util';
import type { EntityType } from '../models/entity/types';
import type { UnitSummary } from '../models/unit-summary.model';

declare const fluffImagePathBrand: unique symbol;
export type FluffImagePath = string & { readonly [fluffImagePathBrand]: 'FluffImagePath' };

export const FLUFF_IMAGE_FOLDERS = [
  'Asset',
  'BattleArmor',
  'ConvFighter',
  'DropShip',
  'Fighter',
  'Infantry',
  'JumpShip',
  'Mek',
  'ProtoMek',
  'Small Craft',
  'Space Station',
  'Vehicle',
  'WarShip',
] as const;

export type FluffImageFolder = typeof FLUFF_IMAGE_FOLDERS[number];
export type BattlefieldSupportAssetType =
  | 'vehicle'
  | 'conventional-infantry'
  | 'battle-armor'
  | 'emplacement';

export interface FluffImageFacts {
  readonly entityType: EntityType | 'BattlefieldSupportAsset';
  readonly baseChassis: string;
  readonly model: string;
  readonly clanName?: string;
  readonly assetType?: BattlefieldSupportAssetType;
}

export interface FluffImageMatch {
  readonly path: FluffImagePath;
  readonly folder: FluffImageFolder;
  readonly candidateKind:
    | 'chassis-model'
    | 'clan-full-model'
    | 'clan-model'
    | 'clan-full'
    | 'clan'
    | 'chassis';
}

export interface FluffImageCatalogValidationOptions {
  readonly minimumEntryCount?: number;
  readonly maximumEntryCount?: number;
  readonly maximumPathLength?: number;
}

export interface FluffImageIndex {
  readonly paths: readonly FluffImagePath[];
  /** Exact Java-equalsIgnoreCase path lookup; returns catalog spelling. */
  find(path: string): FluffImagePath | undefined;
}

const FOLDER_SET = new Set<string>(FLUFF_IMAGE_FOLDERS);
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'] as const;
const DEFAULT_MAXIMUM_ENTRY_COUNT = 100_000;
const DEFAULT_MAXIMUM_PATH_LENGTH = 512;

/** Validate the bare images.json wire value and return a canonical sorted snapshot. */
export function parseFluffImageCatalog(
  value: unknown,
  options: FluffImageCatalogValidationOptions = {},
): readonly FluffImagePath[] {
  if (!Array.isArray(value)) throw new Error('Fluff image catalog must be an array');

  const minimum = options.minimumEntryCount ?? 1;
  const maximum = options.maximumEntryCount ?? DEFAULT_MAXIMUM_ENTRY_COUNT;
  if (!Number.isSafeInteger(minimum) || minimum < 0 || !Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new Error('Invalid fluff image catalog count policy');
  }
  if (value.length < minimum || value.length > maximum) {
    throw new Error(`Fluff image catalog has ${value.length} entries; expected ${minimum}..${maximum}`);
  }

  const maximumPathLength = options.maximumPathLength ?? DEFAULT_MAXIMUM_PATH_LENGTH;
  const foldedPaths = new Map<string, string>();
  const paths = value.map((entry, index) => {
    const path = validateFluffImagePath(entry, index, maximumPathLength);
    const folded = path.toLowerCase();
    const collision = foldedPaths.get(folded);
    if (collision !== undefined) {
      throw new Error(`Fluff image path collision: "${collision}" and "${path}"`);
    }
    foldedPaths.set(folded, path);
    return path;
  });

  return Object.freeze(paths.sort(compareText));
}

export function buildFluffImageIndex(paths: readonly FluffImagePath[]): FluffImageIndex {
  const exact = new Map<string, FluffImagePath>();
  for (const path of paths) {
    const validated = validateFluffImagePath(path, exact.size, DEFAULT_MAXIMUM_PATH_LENGTH);
    const folded = validated.toLowerCase();
    if (exact.has(folded)) throw new Error(`Duplicate/colliding fluff image path: ${path}`);
    exact.set(folded, validated);
  }
  const canonicalPaths = Object.freeze([...exact.values()].sort(compareText));
  return Object.freeze({
    paths: canonicalPaths,
    find: (path: string): FluffImagePath | undefined => exact.get(path.toLowerCase()),
  });
}

export function resolveFluffImage(
  facts: FluffImageFacts,
  index: FluffImageIndex,
): FluffImageMatch | undefined {
  const candidates = buildNameCandidates(facts);
  if (candidates.length === 0) return undefined;

  for (const folder of foldersForFacts(facts)) {
    for (const candidate of candidates) {
      // HUD is an explicit record-sheet fallback, never a summary/card image.
      if (candidate.name.toLowerCase() === 'hud') continue;
      for (const extension of EXTENSIONS) {
        const path = index.find(`${folder}/${candidate.name}${extension}`);
        if (path) return { path, folder, candidateKind: candidate.kind };
      }
    }
  }
  return undefined;
}

/** Exact resolver facts projected from a persisted summary; no label parsing. */
export function fluffImageFactsFromUnitSummary(
  summary: Pick<UnitSummary, 'entityType' | 'baseChassis' | 'model' | 'clanName'>,
): FluffImageFacts {
  return {
    entityType: summary.entityType,
    baseChassis: summary.baseChassis,
    model: summary.model,
    ...(summary.clanName !== undefined && { clanName: summary.clanName }),
  };
}

/** Blank Clan names are absent; nonblank decoded text is preserved verbatim. */
export function canonicalOptionalClanName(value: string | null | undefined): string | undefined {
  return value == null || value.trim().length === 0 ? undefined : value;
}

function validateFluffImagePath(value: unknown, index: number, maximumPathLength: number): FluffImagePath {
  if (typeof value !== 'string') throw new Error(`Fluff image path ${index} is not a string`);
  if (value.length === 0 || value.length > maximumPathLength) {
    throw new Error(`Fluff image path ${index} has an invalid length`);
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`Fluff image path ${index} is absolute`);
  }
  if (value.includes('\\') || /[\u0000-\u001f\u007f?#]/u.test(value)) {
    throw new Error(`Fluff image path ${index} contains unsafe characters`);
  }

  const parts = value.split('/');
  if (parts.length !== 2 || !FOLDER_SET.has(parts[0])) {
    throw new Error(`Fluff image path ${index} must be a direct child of a known folder`);
  }
  const basename = parts[1];
  if (!basename || basename === '.' || basename === '..') {
    throw new Error(`Fluff image path ${index} has an invalid basename`);
  }
  const foldedBasename = basename.toLowerCase();
  if (!EXTENSIONS.some(extension => foldedBasename.endsWith(extension))) {
    throw new Error(`Fluff image path ${index} has an unsupported extension`);
  }
  const extension = EXTENSIONS.find(candidate => foldedBasename.endsWith(candidate))!;
  if (basename.length === extension.length) {
    throw new Error(`Fluff image path ${index} has an empty filename`);
  }
  return value as FluffImagePath;
}

function foldersForFacts(facts: FluffImageFacts): readonly FluffImageFolder[] {
  if (facts.entityType === 'BattlefieldSupportAsset') {
    switch (facts.assetType) {
      case 'vehicle': return ['Asset', 'Vehicle'];
      case 'conventional-infantry': return ['Asset', 'Infantry'];
      case 'battle-armor': return ['Asset', 'BattleArmor'];
      case 'emplacement': return ['Asset'];
      case undefined: throw new Error('Battlefield support image facts require assetType');
    }
  }

  switch (facts.entityType) {
    case 'WarShip': return ['WarShip'];
    case 'SpaceStation': return ['Space Station'];
    case 'JumpShip': return ['JumpShip'];
    case 'ConvFighter':
    case 'FixedWingSupport': return ['ConvFighter'];
    case 'DropShip': return ['DropShip'];
    case 'SmallCraft': return ['Small Craft'];
    case 'Aero': return ['Fighter'];
    case 'BattleArmor': return ['BattleArmor'];
    case 'Infantry': return ['Infantry'];
    case 'ProtoMek': return ['ProtoMek'];
    case 'Tank':
    case 'Naval':
    case 'VTOL':
    case 'SupportTank':
    case 'SupportNaval':
    case 'SupportVTOL':
    case 'LargeSupportTank': return ['Vehicle'];
    case 'Mek':
    case 'HandheldWeapon': return ['Mek'];
    // These catalog-only families have no legacy image oracle or approved
    // folder mapping. An explicit empty search is safer than defaulting them
    // to Mek art by inheritance.
    case 'GunEmplacement':
    case 'BuildingEntity': return [];
    default: return assertNever(facts.entityType);
  }
}

function buildNameCandidates(facts: FluffImageFacts): readonly NameCandidate[] {
  const chassis = sanitizeName(facts.baseChassis);
  const model = sanitizeName(facts.model);
  if (!chassis || chassis.trim().length === 0) return [];

  const candidates: NameCandidate[] = [];
  if (model.trim().length > 0) {
    candidates.push({ kind: 'chassis-model', name: `${chassis} ${model}`.trim() });
  }

  const clanName = facts.entityType === 'Mek'
    ? canonicalOptionalClanName(facts.clanName)
    : undefined;
  if (clanName !== undefined) {
    const clan = sanitizeName(clanName);
    const full = sanitizeName(`${facts.baseChassis} (${clanName})`);
    if (model.trim().length > 0) {
      candidates.push({ kind: 'clan-full-model', name: `${full} ${model}`.trim() });
      candidates.push({ kind: 'clan-model', name: `${clan} ${model}`.trim() });
    }
    candidates.push({ kind: 'clan-full', name: full });
    candidates.push({ kind: 'clan', name: clan });
  }
  candidates.push({ kind: 'chassis', name: chassis });
  return candidates.filter(candidate => candidate.name.trim().length > 0);
}

interface NameCandidate {
  readonly kind: FluffImageMatch['candidateKind'];
  readonly name: string;
}

function sanitizeName(value: string): string {
  return value.replace(/["/]/gu, '');
}

function assertNever(value: never): never {
  throw new Error(`Unsupported entity type for fluff art: ${String(value)}`);
}
