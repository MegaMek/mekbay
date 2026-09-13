// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

// Physical printer points (72 per inch): 1.25 inches across the flats.
export const TABLETOP_HEX_FLAT_TO_FLAT = 90;
export const TABLETOP_HEX_RADIUS = TABLETOP_HEX_FLAT_TO_FLAT / Math.sqrt(3);
export const TABLETOP_HEX_CORNERS = [
    [TABLETOP_HEX_RADIUS, 0], [TABLETOP_HEX_RADIUS / 2, TABLETOP_HEX_FLAT_TO_FLAT / 2],
    [-TABLETOP_HEX_RADIUS / 2, TABLETOP_HEX_FLAT_TO_FLAT / 2], [-TABLETOP_HEX_RADIUS, 0],
    [-TABLETOP_HEX_RADIUS / 2, -TABLETOP_HEX_FLAT_TO_FLAT / 2], [TABLETOP_HEX_RADIUS / 2, -TABLETOP_HEX_FLAT_TO_FLAT / 2],
] as const;
