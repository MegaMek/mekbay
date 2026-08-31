// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitProviderId } from '../services/unit-catalog/unit-catalog.types';
import { sha1Base64Url } from './sha1.util';

declare const spriteAssignmentBrand: unique symbol;

export type UnitSpriteManifestDigest = string & {
  readonly [spriteAssignmentBrand]: 'UnitSpriteManifestDigest';
};

/** Exact UTF-8 evidence needed to independently re-verify assignment semantics. */
export interface UnitSpriteManifestEvidence {
  readonly manifestDigest: UnitSpriteManifestDigest;
  readonly manifestText: string;
}

export const UNIT_SPRITE_ASSIGNMENT_CONTEXT_SCHEMA_VERSION = 1 as const;
export const UNIT_SPRITE_ASSIGNMENT_RESOLVER_VERSION = 1 as const;

/**
 * Framework-free facts consumed by MegaMek's canonical mekset assignment
 * precedence. Callers adapt their own entity representation at the boundary.
 */
export interface UnitSpriteAssignmentFacts {
  readonly displayName: string;
  readonly fullChassis: string;
  readonly entityType: string;
  readonly weightClass: string;
  readonly motiveType: string;
  readonly chassisConfig?: string;
}

/** The assignment-only projection of the generated unit-icons manifest. */
export interface UnitSpriteAssignments {
  readonly exact: Readonly<Record<string, string>>;
  readonly chassis: Readonly<Record<string, string>>;
}

/**
 * Provider-scoped, generated-manifest assignment context. The digest is the
 * SHA-1 base64url hash authored for `unit-icons.json` by assets-manifest.json.
 */
export interface UnitSpriteAssignmentContext {
  readonly schemaVersion: typeof UNIT_SPRITE_ASSIGNMENT_CONTEXT_SCHEMA_VERSION;
  readonly resolverVersion: typeof UNIT_SPRITE_ASSIGNMENT_RESOLVER_VERSION;
  readonly provider: UnitProviderId;
  readonly manifestDigest: UnitSpriteManifestDigest;
  readonly assignments: UnitSpriteAssignments;
}

export function asUnitSpriteManifestDigest(value: string): UnitSpriteManifestDigest {
  if (!/^[A-Za-z0-9_-]{27}$/u.test(value)) {
    throw new Error(`Invalid unit sprite manifest SHA-1 hash: ${value}`);
  }
  return value as UnitSpriteManifestDigest;
}

async function hashUnitSpriteManifestText(
  manifestText: string,
): Promise<UnitSpriteManifestDigest> {
  return asUnitSpriteManifestDigest(await sha1Base64Url(new TextEncoder().encode(manifestText)));
}

/**
 * Parse generated assignment text and derive its publication identity once.
 * Build-time callers use the returned context's manifestDigest; they do not
 * need a separate hash-then-verify round trip.
 */
export async function createUnitSpriteAssignmentContextFromManifestText(input: {
  readonly provider: UnitProviderId;
  readonly manifestText: string;
}): Promise<UnitSpriteAssignmentContext> {
  const manifestDigest = await hashUnitSpriteManifestText(input.manifestText);
  return parseUnitSpriteAssignmentContext({ ...input, manifestDigest });
}

/** Clone and deeply freeze assignment maps at the generated-manifest boundary. */
export function createUnitSpriteAssignmentContext(input: {
  readonly provider: UnitProviderId;
  readonly manifestDigest: UnitSpriteManifestDigest;
  readonly assignments: UnitSpriteAssignments;
}): UnitSpriteAssignmentContext {
  const exact = freezeAssignmentMap(input.assignments.exact, 'exact');
  const chassis = freezeAssignmentMap(input.assignments.chassis, 'chassis');
  return Object.freeze({
    schemaVersion: UNIT_SPRITE_ASSIGNMENT_CONTEXT_SCHEMA_VERSION,
    resolverVersion: UNIT_SPRITE_ASSIGNMENT_RESOLVER_VERSION,
    provider: input.provider,
    manifestDigest: input.manifestDigest,
    assignments: Object.freeze({ exact, chassis }),
  });
}

/**
 * Verify the exact UTF-8 manifest text against its authored hash before any
 * assignment object can become a trusted context. Fetch/cache adapters must
 * persist this returned digest with the verified manifest, never just the
 * parsed assignment object.
 */
export async function createVerifiedUnitSpriteAssignmentContext(input: {
  readonly provider: UnitProviderId;
  readonly manifestText: string;
  readonly publishedManifestDigest: string;
}): Promise<UnitSpriteAssignmentContext> {
  const expectedDigest = asUnitSpriteManifestDigest(input.publishedManifestDigest);
  const actualDigest = await hashUnitSpriteManifestText(input.manifestText);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `Unit sprite manifest digest mismatch: expected ${expectedDigest}, received ${actualDigest}`,
    );
  }

  return parseUnitSpriteAssignmentContext({
    provider: input.provider,
    manifestText: input.manifestText,
    manifestDigest: actualDigest,
  });
}

function parseUnitSpriteAssignmentContext(input: {
  readonly provider: UnitProviderId;
  readonly manifestText: string;
  readonly manifestDigest: UnitSpriteManifestDigest;
}): UnitSpriteAssignmentContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.manifestText);
  } catch (error) {
    throw new Error(
      `Invalid unit sprite manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed['assignments'])) {
    throw new Error('Unit sprite manifest has no assignments object');
  }
  return createUnitSpriteAssignmentContext({
    provider: input.provider,
    manifestDigest: input.manifestDigest,
    assignments: {
      exact: assignmentMapFromUnknown(parsed['assignments']['exact'], 'exact'),
      chassis: assignmentMapFromUnknown(parsed['assignments']['chassis'], 'chassis'),
    },
  });
}

function assignmentMapFromUnknown(
  value: unknown,
  label: string,
): Readonly<Record<string, string>> {
  if (!isPlainRecord(value)) throw new Error(`Unit sprite ${label} assignments are not an object`);
  const output: Record<string, string> = {};
  for (const [key, path] of Object.entries(value)) {
    if (typeof path !== 'string') {
      throw new Error(`Unit sprite ${label} assignment ${key} is not a path`);
    }
    output[key] = path;
  }
  return output;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeAssignmentMap(
  input: Readonly<Record<string, string>>,
  label: string,
): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const [key, path] of Object.entries(input)) {
    if (key.length === 0 || key !== key.toUpperCase()) {
      throw new Error(`Unit sprite ${label} assignment key is not canonical: ${key}`);
    }
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`Unit sprite ${label} assignment ${key} has no path`);
    }
    output[key] = path;
  }
  return Object.freeze(output);
}

function normalizeAssignmentKey(value: string): string {
  return value.toUpperCase();
}

function defaultMekKey(facts: UnitSpriteAssignmentFacts): string {
  if (facts.chassisConfig === 'Tripod') return 'default_tripod';
  if (facts.chassisConfig === 'QuadVee') return 'default_quadvee';
  if (facts.chassisConfig === 'LAM') return 'default_lam_mek';
  if (facts.chassisConfig === 'Quad') return 'default_quad';

  switch (facts.weightClass) {
    case 'Ultra Light': return 'default_ultra_light';
    case 'Light': return 'default_light';
    case 'Medium': return 'default_medium';
    case 'Heavy': return 'default_heavy';
    case 'Super Heavy': return 'default_super_heavy_mek';
    default: return 'default_assault';
  }
}

function defaultVehicleKey(facts: UnitSpriteAssignmentFacts): string {
  switch (facts.motiveType) {
    case 'Wheeled':
      return facts.weightClass === 'Heavy' ? 'default_wheeled_heavy' : 'default_wheeled';
    case 'Hover': return 'default_hover';
    case 'VTOL': return 'default_vtol';
    case 'WiGE': return 'default_wige';
    default:
      if (facts.weightClass === 'Heavy') return 'default_tracked_heavy';
      if (facts.weightClass === 'Assault') return 'default_tracked_assault';
      return 'default_tracked';
  }
}

/** Mirrors MegaMek's `MekTileset.genericFor` selection for supported facts. */
export function getDefaultSpriteAssignmentKeyForFacts(
  facts: UnitSpriteAssignmentFacts,
): string {
  if (facts.entityType === 'BattleArmor') return 'default_ba';
  if (facts.entityType === 'Infantry') return 'default_infantry';
  if (facts.entityType === 'ProtoMek') return 'default_proto';
  if (facts.entityType === 'GunEmplacement' || facts.entityType === 'BuildingEntity') {
    return 'default_gun_emplacement';
  }
  if (facts.entityType === 'Mek') return defaultMekKey(facts);

  switch (facts.motiveType) {
    case 'Naval': return 'default_naval';
    case 'Submarine': return 'default_submarine';
    case 'Hydrofoil': return 'default_hydrofoil';
  }

  if (['Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank']
    .includes(facts.entityType)) {
    return defaultVehicleKey(facts);
  }

  switch (facts.entityType) {
    case 'SpaceStation': return 'default_space_station';
    case 'WarShip': return 'default_warship';
    case 'JumpShip': return 'default_jumpship';
    case 'DropShip':
      return facts.motiveType === 'Spheroid' ? 'default_dropship_sphere' : 'default_dropship_aero';
    case 'SmallCraft':
      return facts.motiveType === 'Spheroid' ? 'default_small_craft_sphere' : 'default_small_craft_aero';
    case 'Aero':
    case 'ConvFighter':
    case 'FixedWingSupport':
      return 'default_aero';
    case 'HandheldWeapon': return 'default_hhw';
    default: return 'default_unknown';
  }
}

/**
 * Exact unit mappings precede full-chassis mappings and family defaults.
 * Key normalization intentionally matches Java's case-insensitive lookup
 * without trimming or otherwise changing punctuation/whitespace.
 */
export function resolveUnitSpriteAssignmentPath(
  facts: UnitSpriteAssignmentFacts,
  assignments: UnitSpriteAssignments | undefined,
): string | undefined {
  if (!assignments) return undefined;

  const exactPath = assignments.exact[normalizeAssignmentKey(facts.displayName)];
  if (exactPath) return exactPath;

  const chassisPath = assignments.chassis[normalizeAssignmentKey(facts.fullChassis)];
  if (chassisPath) return chassisPath;

  const defaultKey = normalizeAssignmentKey(getDefaultSpriteAssignmentKeyForFacts(facts));
  return assignments.exact[defaultKey];
}
