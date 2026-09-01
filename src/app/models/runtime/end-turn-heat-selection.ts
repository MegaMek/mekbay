// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AutomationMode } from '../options.model';

/**
 * A pending sheet arrow is authoritative only when automatic heat resolution
 * is disabled. In ask/yes mode, rejecting the automation keeps current heat;
 * APPLY HEAT is the explicit path that commits the arrow earlier.
 */
export function selectedManualEndTurnHeat(
    mode: AutomationMode,
    current: number,
    pendingOverride: number | undefined,
): number {
    return mode === 'no' ? pendingOverride ?? current : current;
}
