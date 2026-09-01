// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CRIPPLED_CREW_HIT_THRESHOLD, type CrewMemberState } from '../crew.model';
import type { LocationId } from '../entity/entity-identifiers';
import type { ProtoMekEntity } from '../entity/entities/protomek/protomek-entity';
import type { MotiveModes } from '../motiveModes.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import type { NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import type {
    NonMekCrewRuntimeState,
    NonMekUnitRuntimeState,
} from '../runtime/non-mek-unit-instance';
import { gameRulesFor } from './game-rules';
import type { UnitConditionKey } from '../unit-condition.model';
import { isCrewDeathCommitted } from '../runtime/classic-unit-runtime';

export interface ProtoMekRuntimeRulesProjection {
    readonly destroyed: boolean;
    readonly computedConditions: readonly UnitConditionKey[];
    readonly conditionControlKeys: readonly UnitConditionKey[];
    readonly crewStateControlKeys: readonly CrewMemberState[];
    readonly crewStateDisplayKeys: readonly CrewMemberState[];
    readonly attackMovementModifier: number;
}

/** Effective ProtoMek rules derived only from its Entity and sparse runtime. */
export function projectProtoMekRuntimeRules(
    _entity: ProtoMekEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): ProtoMekRuntimeRulesProjection {
    const crew = [...index.crewPositions.keys()]
        .map(positionId => state.crew.get(positionId));
    const crewStates = crew.map(protoMekCrewState);
    const abandoned = crewStates.length > 0
        && crewStates.every(crewState => crewState === 'dead');
    const functionalCrew = crewStates.some(crewState => crewState === 'healthy');
    const crippled = crew.length > 0
        && crew.every(crewState => (crewState?.wounds ?? 0) >= CRIPPLED_CREW_HIT_THRESHOLD);
    const allLimbsDestroyed = ['Left Arm', 'Right Arm', 'Legs'].every(code => {
        const location = [...index.locations.values()].find(row => row.code === code);
        return location === undefined || locationDestroyed(location.id, location.internalPoints, state);
    });
    const torso = [...index.locations.values()].find(location => location.code === 'Torso');
    const torsoDestroyed = torso !== undefined
        && locationDestroyed(torso.id, torso.internalPoints, state);
    const torsoDamage = [...index.damageTracks.values()].some(track =>
        track.sheetId === 'torso_hit_3'
        && (state.damageTracks.get(track.id)?.hits ?? 0) > 0);
    const computedConditions: UnitConditionKey[] = [];
    if (abandoned) computedConditions.push('abandoned');
    if (allLimbsDestroyed || !functionalCrew) computedConditions.push('immobile');
    if (crippled) computedConditions.push('crippled');

    const conditionControlKeys: UnitConditionKey[] = ['swarmed', 'tagged', 'ecm-shielded'];
    if (gameRulesFor(ruleset).supportsSkidding) conditionControlKeys.push('skidding');
    conditionControlKeys.push('jammed');

    return Object.freeze({
        destroyed: state.explicitlyDestroyed || torsoDestroyed || torsoDamage,
        computedConditions: Object.freeze(computedConditions),
        conditionControlKeys: Object.freeze(conditionControlKeys),
        crewStateControlKeys: Object.freeze(['unconscious'] as const),
        crewStateDisplayKeys: Object.freeze(['unconscious', 'dead'] as const),
        attackMovementModifier: getDefaultAttackerMovementModifier(state.turn.movement?.mode),
    });
}

function locationDestroyed(
    locationId: LocationId,
    maximum: number,
    state: NonMekUnitRuntimeState,
): boolean {
    return maximum > 0
        && (state.locations.get(locationId)?.internalDamage ?? 0) >= maximum;
}

function protoMekCrewState(state: NonMekCrewRuntimeState | undefined): CrewMemberState {
    if (state !== undefined && isCrewDeathCommitted(state)) return 'dead';
    if (state?.ejected) return 'ejected';
    return state?.unconscious ? 'unconscious' : 'healthy';
}
