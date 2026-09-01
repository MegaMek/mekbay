// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    type DesignIdentity,
    type UnitUuid,
} from '../services/unit-catalog/unit-catalog.types';
import { isRecord } from '../utils/json-value.util';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export type PersistedUnitIdentity =
    | { readonly kind: 'resolved'; readonly uuid: UnitUuid }
    | {
        readonly kind: 'unresolved';
        readonly rawLegacyName: string;
        readonly rawChassis?: string;
        readonly rawModel?: string;
        readonly rawEntityType?: string;
        readonly candidates: readonly DesignIdentity[];
        readonly reason: 'not-found' | 'ambiguous' | 'catalog-not-ready';
    };

export interface LegacyUnitStateV1 {
    readonly rawCriticalRecords: readonly JsonValue[];
    readonly rawInventoryRecords: readonly JsonValue[];
    readonly rawUnitAndFamilyState: JsonValue;
}

/** Transient V1 input used only while converting one legacy unit to V2. */
export interface LegacyUnitSourceV1 {
    readonly payload: JsonValue;
    readonly identity: PersistedUnitIdentity;
}

export function readLegacyUnitStateV1(source: Pick<LegacyUnitSourceV1, 'payload'>): LegacyUnitStateV1 {
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
    readonly requestedUuid?: UnitUuid;
    readonly candidates: readonly DesignIdentity[];
    readonly reason: 'not-found' | 'ambiguous' | 'catalog-not-ready';
    readonly gameplayAdmission?: {
        readonly gameSystem: 'CBT';
        readonly code: 'CATALOG_ONLY' | 'NO_RUNTIME_AUTHORITY';
        readonly message: string;
    };
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

function describeDeferredUnit(descriptor: DeferredUnitDescriptor): string {
    if (descriptor.gameplayAdmission) {
        return `${descriptor.gameplayAdmission.message} Its saved state was retained as deferred state.`;
    }
    const identity = descriptor.requestedUuid
        ? descriptor.requestedUuid
        : `legacy name "${descriptor.rawLegacyName}"`;
    if (descriptor.reason === 'ambiguous') {
        return `Unit reference ${identity} is ambiguous and was retained as deferred state`;
    }
    if (descriptor.reason === 'catalog-not-ready') {
        return `Unit reference ${identity} cannot be resolved until the catalog is ready; its state was retained`;
    }
    return `Unit reference ${identity} is not installed and was retained as deferred state`;
}
