// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Point sizes shared by generated record sheets; page scaling is applied by the owner. */
export const RECORD_SHEET_FONT = Object.freeze({ caption: 10.6, section: 8.6, body: 7.7, inventory: 6.76, small: 6.2 });
export const INVENTORY_LINE_HEIGHT = RECORD_SHEET_FONT.inventory * 1.35;
export const INVENTORY_BADGE = Object.freeze({ width: 10, height: 9, minimumHeight: 6.5, fontSize: RECORD_SHEET_FONT.inventory * 1.1 });
