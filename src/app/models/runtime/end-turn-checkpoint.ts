// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Durable progress through the current unit's End Turn workflow. */
export type EndTurnCheckpoint = 'phase-ended' | 'heat-staged';

export function isEndTurnCheckpoint(value: unknown): value is EndTurnCheckpoint {
    return value === 'phase-ended' || value === 'heat-staged';
}
