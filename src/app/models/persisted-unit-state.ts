// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asSourceHash,
    asUnitProviderId,
    asUnitUuid,
    type CatalogEntryOrigin,
    type DesignIdentity,
    type NativeUnitFormat,
    type SourceHash,
    type UnitProviderId,
    type UnitUuid,
} from '../services/unit-catalog/unit-catalog.types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export interface SavedEntityIdentity {
    readonly origin: CatalogEntryOrigin;
    readonly provider: UnitProviderId;
    readonly uuid: UnitUuid;
    readonly sourceHashAtSave?: SourceHash;
    readonly sourceFormat?: NativeUnitFormat;
}

export type PersistedUnitIdentity =
    | { readonly kind: 'resolved'; readonly savedIdentity: SavedEntityIdentity }
    | {
        readonly kind: 'unresolved';
        readonly rawLegacyName: string;
        readonly rawChassis?: string;
        readonly rawModel?: string;
        readonly rawEntityType?: string;
        readonly candidates: readonly DesignIdentity[];
        readonly reason: 'not-found' | 'ambiguous' | 'catalog-not-ready';
    };

export interface UnitRecoveryEvidence {
    readonly rawCriticalRecords: readonly JsonValue[];
    readonly rawInventoryRecords: readonly JsonValue[];
    readonly rawUnitAndFamilyState: JsonValue;
}

export interface ForceRecoveryEvidence {
    readonly schemaVersion: 1;
    /** V1 C3 component-index networks retained until a typed conversion is available. */
    readonly c3Networks: readonly JsonValue[];
}

/** Raw saved state retained until this unit can be materialized as a ready V2 runtime. */
export interface DeferredUnitSource {
    readonly payload: JsonValue;
    readonly identity: PersistedUnitIdentity;
}

/** Derives the V1 conversion views from the one retained raw payload. */
export function extractDeferredUnitRecovery(source: Pick<DeferredUnitSource, 'payload'>): UnitRecoveryEvidence {
    const unit = isRecord(source.payload) ? source.payload : {};
    const state = isRecord(unit['state']) ? unit['state'] : {};
    return Object.freeze({
        rawCriticalRecords: Array.isArray(state['crits']) ? state['crits'] : Object.freeze([]),
        rawInventoryRecords: Array.isArray(state['inventory']) ? state['inventory'] : Object.freeze([]),
        rawUnitAndFamilyState: state,
    });
}

export interface DeferredUnitDescriptor {
    readonly instanceId?: string;
    readonly rawLegacyName: string;
    readonly rawChassis?: string;
    readonly rawModel?: string;
    readonly rawEntityType?: string;
    readonly requestedIdentity?: SavedEntityIdentity;
    readonly candidates: readonly DesignIdentity[];
    readonly reason: 'not-found' | 'ambiguous' | 'catalog-not-ready';
    readonly gameplayAdmission?: {
        readonly gameSystem: 'CBT';
        readonly code: 'CATALOG_ONLY' | 'NO_RUNTIME_AUTHORITY';
        readonly message: string;
    };
    readonly sourcePayload?: JsonValue;
}

export interface UnitDefinitionResolutionWitness {
    readonly savedIdentity?: SavedEntityIdentity;
    readonly currentIdentity?: SavedEntityIdentity;
    readonly usedLegacyNameFallback: boolean;
    readonly sourceChanged: boolean;
    readonly formatChanged: boolean;
}

export type UnitIdentityResolver = (
    rawUnit: Readonly<Record<string, unknown>>,
) => PersistedUnitIdentity;

export class DeferredUnitResolutionError extends Error {
    readonly code = 'DEFERRED_UNIT_RESOLUTION' as const;

    constructor(readonly descriptor: DeferredUnitDescriptor) {
        super(describeDeferredUnit(descriptor));
        this.name = 'DeferredUnitResolutionError';
    }
}

/** Clone through the actual JSON wire semantics used by persisted force data. */
export function cloneAsJson(value: unknown): JsonValue {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('Value cannot be represented as JSON');
    return JSON.parse(json) as JsonValue;
}

export function sanitizeSavedEntityIdentity(value: unknown): SavedEntityIdentity | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw new Error('entityIdentity must be an object');
    if (value['origin'] !== 'megamek' && value['origin'] !== 'user') {
        throw new Error('entityIdentity.origin must be megamek or user');
    }

    const provider = asUnitProviderId(String(value['provider'] ?? ''));
    const uuid = asUnitUuid(String(value['uuid'] ?? ''));
    const sourceHashAtSave = value['sourceHashAtSave'] === undefined
        ? undefined
        : asSourceHash(String(value['sourceHashAtSave']));
    const sourceFormat = value['sourceFormat'];
    if (sourceFormat !== undefined && sourceFormat !== 'mtf' && sourceFormat !== 'blk') {
        throw new Error('entityIdentity.sourceFormat must be mtf or blk');
    }
    return {
        origin: value['origin'],
        provider,
        uuid,
        ...(sourceHashAtSave === undefined ? {} : { sourceHashAtSave }),
        ...(sourceFormat === undefined ? {} : { sourceFormat }),
    };
}

function describeDeferredUnit(descriptor: DeferredUnitDescriptor): string {
    if (descriptor.gameplayAdmission) {
        return `${descriptor.gameplayAdmission.message} Its saved state was retained as deferred state.`;
    }
    const identity = descriptor.requestedIdentity
        ? `${descriptor.requestedIdentity.provider}/${descriptor.requestedIdentity.uuid}`
        : `legacy name "${descriptor.rawLegacyName}"`;
    if (descriptor.reason === 'ambiguous') {
        return `Unit reference ${identity} is ambiguous and was retained as deferred state`;
    }
    if (descriptor.reason === 'catalog-not-ready') {
        return `Unit reference ${identity} cannot be resolved until the catalog is ready; its state was retained`;
    }
    return `Unit reference ${identity} is not installed and was retained as deferred state`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
