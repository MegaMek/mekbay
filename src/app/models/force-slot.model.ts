// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Subscription } from 'rxjs';
import type { Force } from './force.model';

/**
 * 
 * Represents a loaded force in the multi-force manager.
 */
export type ForceAlignment = 'friendly' | 'enemy';

/**
 * Represents a loaded force in the multi-force manager.
 * Each slot wraps a Force with its per-slot state: alignment and auto-save subscription.
 */
export interface ForceSlot {
    /** The loaded force instance */
    force: Force;
    /** Whether this force is friendly or enemy (visual/filtering) */
    alignment: ForceAlignment;
    /** Per-slot subscription to force.changed for auto-save. Null if not yet subscribed. */
    changeSub: Subscription | null;
}
