// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { uuidv7 } from './uuid.util';

const PHASE_CLOSED_PREFIX = 'phase-closed:';
const TURN_CLOSED_PREFIX = 'turn-closed:';
const COMBAT_PREFIX = 'combat:';
const HEAT_PREFIX = 'heat:';
const IMMEDIATE_PREFIX = 'immediate:';

/** One rules event whose pilot damage shares consciousness-roll timing. */
export function createPilotDamageGroup(
    timing: 'combat' | 'heat' | 'immediate',
    scope = uuidv7(),
): string {
    return `${timing}:${scope}`;
}

/** Makes a Core combat-phase consciousness roll actionable. */
export function closePilotDamagePhase(group: string): string {
    return group.startsWith(PHASE_CLOSED_PREFIX) || group.startsWith(TURN_CLOSED_PREFIX)
        ? group
        : `${PHASE_CLOSED_PREFIX}${group}`;
}

/** Records that the End Phase containing this damage has already completed. */
export function closePilotDamageTurn(group: string): string {
    return group.startsWith(TURN_CLOSED_PREFIX)
        ? group
        : `${TURN_CLOSED_PREFIX}${stripCommitPrefix(group)}`;
}

export function isOpenCombatPilotDamageGroup(group: string | undefined): boolean {
    return !!group && group.startsWith(COMBAT_PREFIX);
}

export function isPilotDamageGroup(group: string | undefined): boolean {
    const unwrapped = stripCommitPrefix(group);
    return unwrapped.startsWith(COMBAT_PREFIX)
        || unwrapped.startsWith(HEAT_PREFIX)
        || unwrapped.startsWith(IMMEDIATE_PREFIX);
}

export function isCombatPilotDamageGroup(group: string | undefined): boolean {
    return stripCommitPrefix(group).startsWith(COMBAT_PREFIX);
}

export function isHeatPilotDamageGroup(group: string | undefined): boolean {
    return stripCommitPrefix(group).startsWith(HEAT_PREFIX);
}

export function isImmediatePilotDamageGroup(group: string | undefined): boolean {
    return stripCommitPrefix(group).startsWith(IMMEDIATE_PREFIX);
}

export function isTurnClosedPilotDamageGroup(group: string | undefined): boolean {
    return !!group && group.startsWith(TURN_CLOSED_PREFIX);
}

function stripCommitPrefix(group: string | undefined): string {
    if (!group) return '';
    if (group.startsWith(TURN_CLOSED_PREFIX)) return group.slice(TURN_CLOSED_PREFIX.length);
    if (group.startsWith(PHASE_CLOSED_PREFIX)) return group.slice(PHASE_CLOSED_PREFIX.length);
    return group;
}
