// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MM_DATA_UNIT_PROVIDER_ID } from '../services/unit-catalog/unit-catalog.types';
import { sha1Base64Url } from './sha1.util';
import {
  UNIT_SPRITE_ASSIGNMENT_CONTEXT_SCHEMA_VERSION,
  UNIT_SPRITE_ASSIGNMENT_RESOLVER_VERSION,
  asUnitSpriteManifestDigest,
  createUnitSpriteAssignmentContext,
  createUnitSpriteAssignmentContextFromManifestText,
  createVerifiedUnitSpriteAssignmentContext,
  getDefaultSpriteAssignmentKeyForFacts,
  resolveUnitSpriteAssignmentPath,
} from './unit-sprite-assignment-resolver';

describe('framework-free unit sprite assignment resolver', () => {
  const facts = {
    displayName: 'Atlas AS7-D',
    fullChassis: 'Atlas',
    entityType: 'Mek',
    weightClass: 'Assault',
    motiveType: 'Biped',
    chassisConfig: 'Biped',
  } as const;
  const assignments = {
    exact: {
      'ATLAS AS7-D': 'meks/Atlas_D.png',
      DEFAULT_ASSAULT: 'defaults/default_assault.png',
    },
    chassis: { ATLAS: 'meks/Atlas.png' },
  };

  it('owns exact, chassis, and default precedence without entity dependencies', () => {
    expect(resolveUnitSpriteAssignmentPath(facts, assignments)).toBe('meks/Atlas_D.png');
    expect(resolveUnitSpriteAssignmentPath(
      { ...facts, displayName: 'Atlas AS7-RS' }, assignments,
    )).toBe('meks/Atlas.png');
    expect(resolveUnitSpriteAssignmentPath(
      { ...facts, displayName: 'Banshee BNC-3E', fullChassis: 'Banshee' }, assignments,
    )).toBe('defaults/default_assault.png');
    expect(resolveUnitSpriteAssignmentPath(
      { ...facts, displayName: ' atlas as7-d' }, assignments,
    )).toBe('meks/Atlas.png');
    expect(resolveUnitSpriteAssignmentPath(facts, undefined)).toBeUndefined();
  });

  it('selects Mek configuration defaults before weight defaults', () => {
    expect(getDefaultSpriteAssignmentKeyForFacts({ ...facts, chassisConfig: 'Quad' }))
      .toBe('default_quad');
    expect(getDefaultSpriteAssignmentKeyForFacts({ ...facts, chassisConfig: 'Tripod' }))
      .toBe('default_tripod');
    expect(getDefaultSpriteAssignmentKeyForFacts({ ...facts, chassisConfig: 'LAM' }))
      .toBe('default_lam_mek');
    expect(getDefaultSpriteAssignmentKeyForFacts({ ...facts, chassisConfig: 'QuadVee' }))
      .toBe('default_quadvee');
  });

  it('routes both static-emplacement entity spellings to the generated default', () => {
    const staticFacts = {
      ...facts,
      displayName: 'Assault Bombard Gun Emplacement',
      fullChassis: 'Assault Bombard Gun Emplacement',
      entityType: 'BuildingEntity',
      motiveType: '',
    };
    expect(getDefaultSpriteAssignmentKeyForFacts(staticFacts)).toBe('default_gun_emplacement');
    expect(getDefaultSpriteAssignmentKeyForFacts({ ...staticFacts, entityType: 'GunEmplacement' }))
      .toBe('default_gun_emplacement');
    expect(resolveUnitSpriteAssignmentPath(staticFacts, {
      exact: { DEFAULT_GUN_EMPLACEMENT: 'defaults/default_gun_emplacement.png' },
      chassis: {},
    })).toBe('defaults/default_gun_emplacement.png');
  });

  it('deeply freezes a versioned generated-manifest context', () => {
    const context = createUnitSpriteAssignmentContext({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      manifestDigest: asUnitSpriteManifestDigest('A'.repeat(27)),
      assignments,
    });
    expect(context.schemaVersion).toBe(UNIT_SPRITE_ASSIGNMENT_CONTEXT_SCHEMA_VERSION);
    expect(context.resolverVersion).toBe(UNIT_SPRITE_ASSIGNMENT_RESOLVER_VERSION);
    expect(Object.isFrozen(context)).toBeTrue();
    expect(Object.isFrozen(context.assignments)).toBeTrue();
    expect(Object.isFrozen(context.assignments.exact)).toBeTrue();
    expect(Object.isFrozen(context.assignments.chassis)).toBeTrue();
    expect(() => asUnitSpriteManifestDigest('A'.repeat(64))).toThrow();
    expect(() => createUnitSpriteAssignmentContext({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      manifestDigest: asUnitSpriteManifestDigest('A'.repeat(27)),
      assignments: { exact: { atlas: 'meks/Atlas.png' }, chassis: {} },
    })).toThrowError(/not canonical/u);
  });

  it('hashes exact UTF-8 manifest text before parsing a trusted context', async () => {
    const manifestText = '{"types":{},"icons":{},"assignments":{"exact":{"DEFAULT_HEAVY":"defaults/heavy.png"},"chassis":{}}}';
    const publishedManifestDigest = await sha1Base64Url(new TextEncoder().encode(manifestText));
    const verified = await createVerifiedUnitSpriteAssignmentContext({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      manifestText,
      publishedManifestDigest,
    });
    expect(verified.assignments.exact['DEFAULT_HEAVY']).toBe('defaults/heavy.png');
    expect(verified.manifestDigest)
      .toBe(publishedManifestDigest);
    expect(Object.isFrozen(verified.assignments.exact)).toBeTrue();

    await expectAsync(createVerifiedUnitSpriteAssignmentContext({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      manifestText: `${manifestText} `,
      publishedManifestDigest: verified.manifestDigest,
    })).toBeRejectedWithError(/digest mismatch/u);
  });

  it('derives a manifest context without a separate digest pass', async () => {
    const manifestText = '{"types":{},"icons":{},"assignments":{"exact":{},"chassis":{}}}';
    const context = await createUnitSpriteAssignmentContextFromManifestText({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      manifestText,
    });
    expect(context.manifestDigest)
      .toBe(await sha1Base64Url(new TextEncoder().encode(manifestText)));
  });
});
