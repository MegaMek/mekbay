/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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