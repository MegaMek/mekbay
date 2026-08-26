// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DeferredUnitSource } from '../persisted-unit-state';
import {
    CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2,
    type SerializedUnitRestorationMetadataV2,
} from './persistence-v2';
import type {
    UnitRestorationMetadata,
} from './state-restorer';
import { STATE_RESTORATION_ALGORITHM_VERSION } from './state-restorer';

export const LEGACY_RESTORATION_COORDINATE_PROFILE_VERSION = 1 as const;

/**
 * Keeps only conversion diagnostics after V1 state has been applied. Raw V1
 * records and the transient ID translation never become durable V2 state.
 */
export function encodeLegacyUnitRestorationSidecarV2(
    record: DeferredUnitSource,
    metadata: UnitRestorationMetadata,
): SerializedUnitRestorationMetadataV2 | undefined {
    if (record.identity.kind !== 'resolved') {
        throw new Error('Unresolved legacy identity cannot produce a V2 restoration sidecar');
    }
    const savedIdentity = record.identity.savedIdentity;
    if (savedIdentity.provider !== metadata.savedIdentity.provider
        || savedIdentity.uuid !== metadata.savedIdentity.uuid) {
        throw new Error('V1 restoration metadata does not match the saved identity');
    }
    if (metadata.algorithmVersion !== STATE_RESTORATION_ALGORITHM_VERSION) {
        throw new Error('Legacy restoration sidecar requires the supported legacy restoration algorithm');
    }

    const warnings = Object.freeze([
        ...metadata.warnings.map(warning => Object.freeze({
            code: warning.code,
            message: warning.message,
        })),
        ...metadata.unresolved.map(entry => Object.freeze({
            code: 'LEGACY_STATE_NOT_CONVERTED',
            message: `${entry.kind}: ${entry.reason}`,
        })),
    ]);
    const sourceChanged = metadata.warnings.some(warning =>
        warning.code === 'SOURCE_REVISION_CHANGED'
        || warning.code === 'INITIAL_BASELINE_CHANGED',
    );
    if (!sourceChanged && warnings.length === 0) return undefined;
    return Object.freeze({
        schemaVersion: 1,
        algorithmVersion: CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2,
        fromBaseline: Object.freeze({
            kind: 'legacy-v1',
            coordinateProfileVersion: LEGACY_RESTORATION_COORDINATE_PROFILE_VERSION,
        }),
        sourceChanged,
        warnings: Object.freeze(warnings.map(warning => Object.freeze({
            code: warning.code,
            message: warning.message,
        }))),
        unresolved: Object.freeze([]),
        acceptedAliases: Object.freeze([]),
    });
}
