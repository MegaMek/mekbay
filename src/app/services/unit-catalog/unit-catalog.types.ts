// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Shared identity and persistence contracts for the native-unit catalog. */

declare const catalogBrand: unique symbol;
type Branded<T, TBrand extends string> = T & { readonly [catalogBrand]: TBrand };

export type UnitProviderId = Branded<string, 'UnitProviderId'>;
export type UnitUuid = Branded<string, 'UnitUuid'>;
export type SourceHash = Branded<string, 'SourceHash'>;
export type UnitFileName = Branded<string, 'UnitFileName'>;
export type DesignIdentityKey = Branded<string, 'DesignIdentityKey'>;
export type CatalogActivationId = Branded<string, 'CatalogActivationId'>;

export type NativeUnitFormat = 'mtf' | 'blk';
export type CatalogEntryOrigin = 'megamek' | 'user';
/** Native entries use their supplied SourceHash; user entries use their document revision. */
export type SourceRevision = string;

export const MM_DATA_UNIT_PROVIDER_ID = 'mm-data' as UnitProviderId;

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// A 20-byte SHA-1 encodes to 27 unpadded base64url characters. The final character has
// four data bits, so its two unused bits must be zero; accepting other spellings is non-canonical.
const SHA1_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{26}[AEIMQUYcgkosw048]$/u;
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/u;
const UNIT_FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(mtf|blk)$/u;

export interface DesignIdentity {
    readonly provider: UnitProviderId;
    readonly uuid: UnitUuid;
}

export interface CatalogEntryKey {
    readonly origin: CatalogEntryOrigin;
    readonly design: DesignIdentity;
    readonly sourceRevision: SourceRevision;
}

export interface CoreCatalogEntryKey extends CatalogEntryKey {
    readonly origin: 'megamek';
    readonly sourceRevision: SourceHash;
}

export interface UserCatalogEntryKey extends CatalogEntryKey {
    readonly origin: 'user';
}

/** IndexedDB accepts arrays as compound keys; domain objects are never used as keys. */
export type CatalogEntryDbKey = readonly [
    origin: CatalogEntryOrigin,
    provider: string,
    canonicalUuid: string,
    sourceRevision: string,
];

export interface StoredCoreContent {
    readonly file: UnitFileName;
    readonly hash: SourceHash;
    readonly format: NativeUnitFormat;
    readonly bytes: ArrayBuffer;
}

export function asUnitProviderId(value: string): UnitProviderId {
    if (!PROVIDER_ID_PATTERN.test(value)) {
        throw new Error(`Invalid canonical unit provider ID: ${value}`);
    }
    return value as UnitProviderId;
}

export function asUnitUuid(value: string): UnitUuid {
    if (!UUID_V7_PATTERN.test(value)) {
        throw new Error(`Invalid canonical UUIDv7: ${value}`);
    }
    return value as UnitUuid;
}

export function asSourceHash(value: string): SourceHash {
    if (!SHA1_BASE64URL_PATTERN.test(value)) {
        throw new Error(`Invalid SHA-1 base64url checksum: ${value}`);
    }
    return value as SourceHash;
}

export function asCatalogActivationId(value: string): CatalogActivationId {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || value.includes('\0')) {
        throw new Error('Invalid catalog activation ID');
    }
    return value as CatalogActivationId;
}

export function parseUnitFileName(value: string): {
    readonly file: UnitFileName;
    readonly uuid: UnitUuid;
    readonly format: NativeUnitFormat;
} {
    const match = UNIT_FILE_PATTERN.exec(value);
    if (!match) {
        throw new Error(`Invalid unit filename: ${value}`);
    }
    return {
        file: value as UnitFileName,
        uuid: asUnitUuid(match[1]),
        format: match[2] as NativeUnitFormat,
    };
}

export function makeUnitFileName(uuid: UnitUuid, format: NativeUnitFormat): UnitFileName {
    return parseUnitFileName(`${uuid}.${format}`).file;
}

export function encodeDesignIdentity(identity: DesignIdentity): DesignIdentityKey {
    const provider = asUnitProviderId(identity.provider);
    const uuid = asUnitUuid(identity.uuid);
    return `${provider.length}:${provider}${uuid.length}:${uuid}` as DesignIdentityKey;
}

export function encodeCatalogEntryKey(entryKey: CatalogEntryKey): CatalogEntryDbKey {
    if (entryKey.origin !== 'megamek' && entryKey.origin !== 'user') {
        throw new Error(`Invalid catalog entry origin: ${String(entryKey.origin)}`);
    }
    const provider = asUnitProviderId(entryKey.design.provider);
    const uuid = asUnitUuid(entryKey.design.uuid);
    const sourceRevision = entryKey.origin === 'megamek'
        ? asSourceHash(entryKey.sourceRevision)
        : requireSourceRevision(entryKey.sourceRevision);
    return [entryKey.origin, provider, uuid, sourceRevision];
}

function requireSourceRevision(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) {
        throw new Error('Invalid user source revision');
    }
    return value;
}
