// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const MAX_DISPLAY_NAME_LENGTH = 16;

export function normalizeDisplayName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > MAX_DISPLAY_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
        return null;
    }
    return normalized;
}
