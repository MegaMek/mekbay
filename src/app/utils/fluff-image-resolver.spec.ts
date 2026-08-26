// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  buildFluffImageIndex,
  fluffImageFactsFromUnitSummary,
  canonicalOptionalClanName,
  parseFluffImageCatalog,
  resolveFluffImage,
} from './fluff-image-resolver';

describe('fluff image resolver', () => {
  function index(paths: readonly string[]) {
    return buildFluffImageIndex(parseFluffImageCatalog(paths));
  }

  it('uses folder, candidate, then PNG/JPG/JPEG/GIF precedence', () => {
    const catalog = index([
      'Mek/Atlas.jpg',
      'Mek/Atlas AS7-D.jpg',
      'Mek/Atlas AS7-D.png',
    ]);
    const match = resolveFluffImage({
      entityType: 'Mek', baseChassis: 'Atlas', model: 'AS7-D',
    }, catalog);
    expect(String(match?.path)).toBe('Mek/Atlas AS7-D.png');
    expect(match?.folder).toBe('Mek');
    expect(match?.candidateKind).toBe('chassis-model');
  });

  it('preserves canonical path case while matching case-insensitively', () => {
    const catalog = index(['Vehicle/Schrek PPC Carrier.JpG']);
    expect(String(resolveFluffImage({
      entityType: 'Tank', baseChassis: 'SCHREK PPC CARRIER', model: '',
    }, catalog)?.path)).toBe('Vehicle/Schrek PPC Carrier.JpG');
  });

  it('uses direct parsed Clan facts in MegaMek order', () => {
    const catalog = index([
      'Mek/Mad Cat Prime.png',
      'Mek/Timber Wolf (Mad Cat) Prime.jpg',
      'Mek/Timber Wolf.png',
    ]);
    const match = resolveFluffImage({
      entityType: 'Mek', baseChassis: 'Timber Wolf', clanName: 'Mad Cat', model: 'Prime',
    }, catalog);
    expect(String(match?.path)).toBe('Mek/Timber Wolf (Mad Cat) Prime.jpg');
    expect(match?.folder).toBe('Mek');
    expect(match?.candidateKind).toBe('clan-full-model');
  });

  it('projects resolver facts from summary fields without display-name inference', () => {
    expect(fluffImageFactsFromUnitSummary({
      entityType: 'Mek',
      baseChassis: 'Timber Wolf',
      clanName: 'Mad Cat',
      model: 'Prime',
    })).toEqual({
      entityType: 'Mek',
      baseChassis: 'Timber Wolf',
      clanName: 'Mad Cat',
      model: 'Prime',
    });
  });

  it('does not apply Clan expansion to non-Meks or parse parentheses', () => {
    const catalog = index(['Vehicle/Alt Name Prime.png', 'Vehicle/Base (Alt Name).png']);
    expect(resolveFluffImage({
      entityType: 'Tank', baseChassis: 'Base', clanName: 'Alt Name', model: 'Prime',
    }, catalog)).toBeUndefined();
    expect(String(resolveFluffImage({
      entityType: 'Tank', baseChassis: 'Base (Alt Name)', model: '',
    }, catalog)?.path)).toBe('Vehicle/Base (Alt Name).png');
  });

  it('searches an asset-specific folder before its TW fallback', () => {
    const catalog = index(['Asset/Mule.png', 'Vehicle/Mule.png']);
    expect(String(resolveFluffImage({
      entityType: 'BattlefieldSupportAsset', assetType: 'vehicle',
      baseChassis: 'Mule', model: '',
    }, catalog)?.path)).toBe('Asset/Mule.png');

    const fallback = index(['Vehicle/Mule.png']);
    expect(String(resolveFluffImage({
      entityType: 'BattlefieldSupportAsset', assetType: 'vehicle',
      baseChassis: 'Mule', model: '',
    }, fallback)?.path)).toBe('Vehicle/Mule.png');
  });

  it('removes only quote and slash from candidate names', () => {
    const catalog = index(["Infantry/Déjà Viu 's-Test.png"]);
    expect(String(resolveFluffImage({
      entityType: 'Infantry', baseChassis: 'Déjà /Vi"u', model: "'s-Test",
    }, catalog)?.path)).toBe("Infantry/Déjà Viu 's-Test.png");
  });

  it('never treats hud.png as a summary image', () => {
    const catalog = index(['Mek/hud.png']);
    expect(resolveFluffImage({
      entityType: 'Mek', baseChassis: 'hud', model: '',
    }, catalog)).toBeUndefined();
  });

  it('rejects unsafe, nested, duplicate, and case-colliding catalogs', () => {
    const invalid = [
      ['https://bad.test/Mek/Atlas.png'],
      ['Mek/sub/Atlas.png'],
      ['Mek\\Atlas.png'],
      ['Unknown/Atlas.png'],
      ['Mek/Atlas.svg'],
      ['Mek/Atlas.png', 'mek/atlas.PNG'],
      ['Mek/Atlas.png', 'Mek/Atlas.png'],
    ];
    for (const paths of invalid) {
      expect(() => parseFluffImageCatalog(paths)).withContext(paths.join(',')).toThrow();
    }
  });

  it('uses ordinary string blank semantics for optional Clan names', () => {
    expect(canonicalOptionalClanName('\t\u2003')).toBeUndefined();
    expect(canonicalOptionalClanName('\u00a0')).toBeUndefined();
    expect(canonicalOptionalClanName(' Mad Cat ')).toBe(' Mad Cat ');
  });
});
