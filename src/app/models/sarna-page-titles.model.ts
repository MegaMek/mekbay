// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit, UnitType } from './units.model';

export const SARNA_PAGE_TITLE_LOOKUP_TYPES = [
    'Mek',
    'Aero',
    'Tank',
    'Infantry',
    'ProtoMek',
    'Handheld Weapon',
] as const;

export type SarnaPageTitleLookupType = typeof SARNA_PAGE_TITLE_LOOKUP_TYPES[number];
export type SarnaPageTitlesByType = Partial<Record<SarnaPageTitleLookupType, string[]>>;

export interface SarnaPageTitlesData {
    etag: string;
    titlesByType: SarnaPageTitlesByType;
}

export type SarnaLookupUnit = Pick<Unit, 'chassis' | 'type'> & Partial<Pick<Unit, 'subtype' | 'omni'>>;

export const SARNA_PAGE_TITLE_LOOKUP_TYPE_BY_UNIT_TYPE: Record<UnitType, SarnaPageTitleLookupType> = {
    Aero: 'Aero',
    'Handheld Weapon': 'Handheld Weapon',
    Infantry: 'Infantry',
    Mek: 'Mek',
    Naval: 'Tank',
    ProtoMek: 'ProtoMek',
    Tank: 'Tank',
    VTOL: 'Tank',
};