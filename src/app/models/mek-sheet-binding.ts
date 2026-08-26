// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    MM_DATA_UNIT_PROVIDER_ID,
    type UnitProviderId,
} from '../services/unit-catalog/unit-catalog.types';

export const PUBLISHED_MEK_SHEET_BINDING_SCHEMA_VERSION = 1 as const;
export const MM_DATA_MEK_SHEET_BINDING_ID = 'mm-data-mek-sheet-v1' as const;

export type MekSheetBindingManifestId = typeof MM_DATA_MEK_SHEET_BINDING_ID;

/**
 * Reviewed layout vocabulary for one supplied SVG dialect. Selectors identify
 * authored layout anchors only. They never contribute unit values, counts,
 * identities, component relationships, or runtime state.
 */
export interface MekSheetBindingManifestV1 {
    readonly schemaVersion: typeof PUBLISHED_MEK_SHEET_BINDING_SCHEMA_VERSION;
    readonly id: MekSheetBindingManifestId;
    readonly provider: UnitProviderId;
    readonly entityKind: 'mek';
    readonly nativeFormat: 'mtf';
    readonly layoutDialect: 'megameklab-record-sheet-svg-v1';
    readonly selectors: Readonly<{
        readonly armorPip: '.armor.pip';
        readonly structurePip: '.structure.pip';
        readonly criticalSlot: '.critSlot';
        readonly inventoryRow: '.inventoryEntry';
        readonly crewHit: '.crewHit';
        readonly heatCell: '#heatScale .heat';
        readonly heatSinkPip: '.hsPips .pip, .pip.hsPip';
        readonly conditionButton: '.unitConditionButton[condition]';
        readonly conditionBanner: '.unitConditionBanner[condition]';
    }>;
}

export const MM_DATA_MEK_SHEET_BINDING_MANIFEST: MekSheetBindingManifestV1 =
    deepFreeze({
        schemaVersion: PUBLISHED_MEK_SHEET_BINDING_SCHEMA_VERSION,
        id: MM_DATA_MEK_SHEET_BINDING_ID,
        provider: MM_DATA_UNIT_PROVIDER_ID,
        entityKind: 'mek',
        nativeFormat: 'mtf',
        layoutDialect: 'megameklab-record-sheet-svg-v1',
        selectors: {
            armorPip: '.armor.pip',
            structurePip: '.structure.pip',
            criticalSlot: '.critSlot',
            inventoryRow: '.inventoryEntry',
            crewHit: '.crewHit',
            heatCell: '#heatScale .heat',
            heatSinkPip: '.hsPips .pip, .pip.hsPip',
            conditionButton: '.unitConditionButton[condition]',
            conditionBanner: '.unitConditionBanner[condition]',
        },
    });

export function reviewedMekSheetBinding(
    provider: UnitProviderId,
): MekSheetBindingManifestV1 | undefined {
    return provider === MM_DATA_UNIT_PROVIDER_ID
        ? MM_DATA_MEK_SHEET_BINDING_MANIFEST
        : undefined;
}

function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return Object.freeze(value);
}
