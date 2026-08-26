// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asSourceHash,
    parseUnitFileName,
    type NativeUnitFormat,
    type SourceHash,
    type UnitFileName,
    type UnitUuid,
} from './unit-catalog.types';

export const CORE_UNITS_MANIFEST_PATH = 'online-assets/generated/units-manifest.json' as const;
export const CORE_UNITS_ARCHIVE_PATH = 'online-assets/generated/units.zip' as const;
export const CORE_UNIT_ARCHIVE_SUMMARY_PATH = 'unit-summaries.json' as const;
export const CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH = 'application-catalog-dependencies.json' as const;

export const MAX_INCREMENTAL_UNIT_REQUESTS = 30;
export const MAX_INCREMENTAL_SUMMARY_REBUILDS = 400;
export const MAX_PARALLEL_UNIT_FETCHES = 6;
export const MAX_UNIT_FETCH_RETRIES = 2;
export const MAX_UNIT_SOURCE_BYTES = 256 * 1_024;
export const MAX_CORE_UNITS_MANIFEST_BYTES = 4 * 1_024 * 1_024;
export const MAX_CORE_UNIT_COUNT = 100_000;
export const MAX_ARCHIVE_BYTES = 128 * 1_024 * 1_024;

export interface CoreUnitManifestEntry {
    readonly file: UnitFileName;
    readonly hash: SourceHash;
    readonly format: NativeUnitFormat;
}

/** Runtime index normalized from the direct filename-to-hash JSON object. */
export interface CoreUnitsManifest {
    readonly units: Readonly<Record<UnitUuid, CoreUnitManifestEntry>>;
}

export interface StoredCoreUnitsManifest {
    readonly manifest: CoreUnitsManifest;
    readonly json: string;
    /** SHA-1 supplied by assets-manifest.json; this is the update/completion identity. */
    readonly hash: SourceHash;
}

export interface CoreCatalogDiffPlan {
    readonly addedUuids: readonly UnitUuid[];
    readonly changedUuids: readonly UnitUuid[];
    readonly removedUuids: readonly UnitUuid[];
    readonly unchangedUuids: readonly UnitUuid[];
    readonly missingFiles: readonly UnitFileName[];
    readonly strategy: 'none' | 'individual' | 'archive';
}

export class CoreUnitsManifestError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'CoreUnitsManifestError';
    }
}

export function parseCoreUnitsManifest(rawJson: string, suppliedHash: string): StoredCoreUnitsManifest {
    if (new TextEncoder().encode(rawJson).byteLength > MAX_CORE_UNITS_MANIFEST_BYTES) {
        throw new CoreUnitsManifestError('Units manifest exceeds its byte ceiling');
    }
    let raw: unknown;
    try {
        raw = JSON.parse(rawJson);
    } catch (error) {
        throw new CoreUnitsManifestError('Units manifest is not valid JSON', { cause: error });
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new CoreUnitsManifestError('Units manifest must be a filename-to-hash object');
    }

    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0 || entries.length > MAX_CORE_UNIT_COUNT) {
        throw new CoreUnitsManifestError('Units manifest has an invalid population');
    }
    const units: Record<UnitUuid, CoreUnitManifestEntry> = {} as Record<UnitUuid, CoreUnitManifestEntry>;
    for (const [fileValue, hashValue] of entries) {
        let parsed: ReturnType<typeof parseUnitFileName>;
        let hash: SourceHash;
        try {
            parsed = parseUnitFileName(fileValue);
            hash = asSourceHash(String(hashValue));
        } catch (error) {
            throw new CoreUnitsManifestError(`Invalid units manifest entry: ${fileValue}`, { cause: error });
        }
        if (typeof hashValue !== 'string' || units[parsed.uuid]) {
            throw new CoreUnitsManifestError(`Duplicate or invalid unit entry: ${fileValue}`);
        }
        units[parsed.uuid] = Object.freeze({ file: parsed.file, hash, format: parsed.format });
    }

    return Object.freeze({
        manifest: Object.freeze({ units: Object.freeze(units) }),
        json: rawJson,
        hash: asSourceHash(suppliedHash),
    });
}

export function planCoreCatalogDiff(
    desired: CoreUnitsManifest,
    active: CoreUnitsManifest | undefined,
    locallyStoredFiles: ReadonlySet<string>,
    incrementalRequestThreshold = MAX_INCREMENTAL_UNIT_REQUESTS,
): CoreCatalogDiffPlan {
    if (!Number.isSafeInteger(incrementalRequestThreshold)
        || incrementalRequestThreshold < 0
        || incrementalRequestThreshold > MAX_INCREMENTAL_UNIT_REQUESTS) {
        throw new Error(`Incremental request threshold must be an integer from 0 to ${MAX_INCREMENTAL_UNIT_REQUESTS}`);
    }

    const activeUnits = active?.units ?? {};
    const addedUuids: UnitUuid[] = [];
    const changedUuids: UnitUuid[] = [];
    const unchangedUuids: UnitUuid[] = [];
    const missingFiles = new Set<UnitFileName>();
    for (const uuid of Object.keys(desired.units).sort() as UnitUuid[]) {
        const next = desired.units[uuid];
        const previous = activeUnits[uuid];
        if (!previous) {
            addedUuids.push(uuid);
            missingFiles.add(next.file);
        } else if (previous.file !== next.file || previous.hash !== next.hash) {
            changedUuids.push(uuid);
            missingFiles.add(next.file);
        } else {
            unchangedUuids.push(uuid);
            if (!locallyStoredFiles.has(next.file)) missingFiles.add(next.file);
        }
    }
    const removedUuids = Object.keys(activeUnits)
        .filter(uuid => !(uuid in desired.units))
        .sort() as UnitUuid[];
    const files = [...missingFiles].sort();
    return Object.freeze({
        addedUuids: Object.freeze(addedUuids),
        changedUuids: Object.freeze(changedUuids),
        removedUuids: Object.freeze(removedUuids),
        unchangedUuids: Object.freeze(unchangedUuids),
        missingFiles: Object.freeze(files),
        strategy: files.length === 0
            ? 'none'
            : files.length <= incrementalRequestThreshold ? 'individual' : 'archive',
    });
}

export function unitCount(manifest: CoreUnitsManifest): number {
    return Object.keys(manifest.units).length;
}
