// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export function recordSheetAmmoName(value: string): string {
    return value
        .replace(/\s*\(Clan\)\s*/gu, ' ')
        .replace(/\s+Ammo$/u, '')
        .trim();
}
