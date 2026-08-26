// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Eras } from '../../models/eras.model';
import type { RawEquipmentData } from '../../models/equipment.model';
import type { RawMULFactions } from '../../models/mulfactions.model';
import type { Quirks } from '../../models/quirks.model';
import type { Sourcebooks } from '../../models/sourcebook.model';
import type { UnitSpriteManifestEvidence } from '../../utils/unit-sprite-assignment-resolver';

export const MAX_APPLICATION_CATALOG_DEPENDENCY_BUNDLE_BYTES = 128 * 1024 * 1024;
export const SUMMARY_DEPENDENCY_NAMES = Object.freeze([
    'equipment', 'quirks', 'sourcebooks', 'sprites',
] as const);
export type SummaryDependencyName = typeof SUMMARY_DEPENDENCY_NAMES[number];

/** First-install seed copied into units.zip. Each owning catalog validates its own data. */
export interface ApplicationCatalogDependencyBundle {
    readonly equipment: RawEquipmentData;
    readonly quirks: Quirks;
    readonly sourcebooks: Sourcebooks;
    readonly eras: Eras;
    readonly factions: RawMULFactions;
    readonly spriteManifest: UnitSpriteManifestEvidence;
}

export interface SerializedApplicationCatalogDependencyBundle {
    readonly json: string;
    readonly bytes: Uint8Array;
    readonly byteLength: number;
    readonly bundle: ApplicationCatalogDependencyBundle;
}

export function buildApplicationCatalogDependencyBundle(
    input: ApplicationCatalogDependencyBundle,
): ApplicationCatalogDependencyBundle {
    if (!isApplicationCatalogDependencyBundle(input)) {
        throw new Error('Application catalog dependency bundle is invalid');
    }
    return input;
}

export function verifyApplicationCatalogDependencyBundle(candidate: unknown): boolean {
    return isApplicationCatalogDependencyBundle(candidate);
}

export function verifyAndNormalizeApplicationCatalogDependencyBundle(
    candidate: unknown,
): ApplicationCatalogDependencyBundle | undefined {
    return isApplicationCatalogDependencyBundle(candidate) ? candidate : undefined;
}

export function serializeApplicationCatalogDependencyBundle(
    candidate: unknown,
): SerializedApplicationCatalogDependencyBundle {
    const bundle = verifyAndNormalizeApplicationCatalogDependencyBundle(candidate);
    if (!bundle) throw new Error('Application catalog dependency bundle is invalid');
    const json = JSON.stringify(bundle);
    const bytes = new TextEncoder().encode(json);
    if (bytes.byteLength > MAX_APPLICATION_CATALOG_DEPENDENCY_BUNDLE_BYTES) {
        throw new Error('Application catalog dependency bundle is too large');
    }
    return { json, bytes, byteLength: bytes.byteLength, bundle };
}

export function parseApplicationCatalogDependencyBundle(
    input: string | ArrayBuffer | Uint8Array,
): ApplicationCatalogDependencyBundle {
    const bytes = typeof input === 'string'
        ? new TextEncoder().encode(input)
        : input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_APPLICATION_CATALOG_DEPENDENCY_BUNDLE_BYTES) {
        throw new Error('Application catalog dependency bundle has an invalid size');
    }
    let parsed: unknown;
    try {
        const json = typeof input === 'string'
            ? input
            : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        parsed = JSON.parse(json) as unknown;
    } catch (error) {
        throw new Error('Application catalog dependency bundle is invalid JSON', { cause: error });
    }
    const bundle = verifyAndNormalizeApplicationCatalogDependencyBundle(parsed);
    if (!bundle) throw new Error('Application catalog dependency bundle is invalid');
    return bundle;
}

export function isApplicationCatalogDependencyBundle(
    value: unknown,
): value is ApplicationCatalogDependencyBundle {
    if (!isPlainObject(value)) return false;
    const sprites = value['spriteManifest'];
    return isPlainObject(value['equipment'])
        && isPlainObject(value['quirks'])
        && isPlainObject(value['sourcebooks'])
        && isPlainObject(value['eras'])
        && isPlainObject(value['factions'])
        && isPlainObject(sprites)
        && typeof sprites['manifestDigest'] === 'string'
        && typeof sprites['manifestText'] === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
