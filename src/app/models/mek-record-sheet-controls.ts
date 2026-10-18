// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from './cbt-ruleset.model';
import { gameRulesFor } from './rules/game-rules';
import {
    crewStateDefinitions,
    unitConditionControls,
    type CrewStateControlDefinition,
    type CrewStateDefinition,
    type LocationConditionControl,
    type UnitConditionControl,
} from './unit-status-presentation';

/** A Mek's condition controls under its ruleset: Core has no skidding. */
export function mekUnitConditionControls(ruleset: CBTRuleset): readonly UnitConditionControl[] {
    const skidding = gameRulesFor(ruleset).supportsSkidding;
    return unitConditionControls(['shutdown', 'prone', 'swarmed', 'tagged', 'ecm-shielded', ...(skidding ? ['skidding' as const] : []), 'jammed']);
}

export const MEK_CREW_STATE_CONTROLS: readonly CrewStateControlDefinition[] =
    crewStateDefinitions(['unconscious', 'ejected']) as readonly CrewStateControlDefinition[];

export const MEK_CREW_STATE_DISPLAYS: readonly CrewStateDefinition[] =
    crewStateDefinitions(['unconscious', 'ejected', 'dead']);

export const MEK_LOCATION_CONDITION_CONTROLS: readonly LocationConditionControl[] = Object.freeze([
    Object.freeze({ key: 'flooded', label: 'Flooded', color: '#66f' }),
    Object.freeze({ key: 'blown-off', label: 'Blown Off', color: '#808080' }),
    Object.freeze({ key: 'narc', label: 'NARC', color: '#f00', counted: true }),
]);
