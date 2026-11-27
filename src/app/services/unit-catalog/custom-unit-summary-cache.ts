// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitSummary } from '../../models/unit-summary.model';
import { isRecord } from '../../utils/json-value.util';
import { isUnitSummaryArray } from './core-catalog-generation';
import { CUSTOM_UNIT_PROVIDER_ID, type UnitUuid } from './unit-catalog.types';

/** Disposable projection, stored independently of the authoritative native design. */
export interface StoredCustomUnitSummary {
    readonly accountUuid: string;
    readonly uuid: UnitUuid;
    readonly dependencies: string;
    readonly summary: UnitSummary;
}

export function isStoredCustomUnitSummary(value: unknown): value is StoredCustomUnitSummary {
    if (!isRecord(value) || typeof value['accountUuid'] !== 'string'
        || typeof value['dependencies'] !== 'string' || !isUnitSummaryArray([value['summary']])) return false;
    const summary = value['summary'] as UnitSummary;
    return value['uuid'] === summary.uuid && summary.origin === 'user'
        && summary.provider === CUSTOM_UNIT_PROVIDER_ID
        && isRecord(summary.as) && isRecord(summary.as.dmg) && isRecord(summary.as.MVm)
        && Array.isArray(summary.comp) && Array.isArray(summary.loadIssues);
}
