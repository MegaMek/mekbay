// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CrewAssignment } from '../runtime/crew-assignment';

import type { CBTRuleset } from '../cbt-ruleset.model';
import {
CrewMember,
type CrewMemberState,
} from '../crew-member.model';
import type { ProtoMekEntity } from '../entity/entities/protomek/protomek-entity';
import type { ComponentId, LocationId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import type { NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import type { NonMekUnitRuntimeState } from '../runtime/non-mek-unit-instance';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import type { UnitConditionKey } from '../unit-condition.model';
import { gameRulesFor, type ToHitModifierBreakdownEntry } from './game-rules';
import type { SystemDamageKind } from './system-damage-rules';

/** Critical boxes filled per location; a destroyed arm counts as both boxes. */
export interface ProtoMekCriticalHits {
    readonly head: number;
    readonly torso: number;
    readonly legs: number;
    readonly 'Left Arm': number;
    readonly 'Right Arm': number;
}

export interface ProtoMekRuntimeRulesProjection {
    readonly criticalHits: ProtoMekCriticalHits;
    /** Main gun weapons once both arms are destroyed (TW p.186). */
    readonly fireBlockedComponentIds: ReadonlySet<ComponentId>;
    readonly destroyed: boolean;
    readonly computedConditions: readonly UnitConditionKey[];
    readonly conditionControlKeys: readonly UnitConditionKey[];
    readonly crewStateControlKeys: readonly CrewMemberState[];
    readonly crewStateDisplayKeys: readonly CrewMemberState[];
    readonly attackMovementModifier: number;
}

/** Effective ProtoMek rules derived only from its Entity and sparse runtime. */
export function projectProtoMekRuntimeRules(
    entity: ProtoMekEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
    forcedWithdrawal = true,
    crewAssignment?: CrewAssignment,
): ProtoMekRuntimeRulesProjection {
    const crew = (crewAssignment?.positions.map(position => position.positionId) ?? [...index.crewPositions.keys()])
        .map(positionId => CrewMember.from(state.crew.get(positionId)));
    const crewStates = crew.map(crewMember => crewMember.effectiveState());
    const abandoned = index.crewPositions.size > 0
        && crewStates.every(crewState => crewState === 'dead');
    const functionalCrew = crewStates.some(crewState => crewState === 'healthy');
    const crippled = forcedWithdrawal
        && crew.length > 0
        && crew.every(crewMember => crewMember.isCrippled());
    const allLimbsDestroyed = ['Left Arm', 'Right Arm', 'Legs'].every(code => {
        const location = [...index.locations.values()].find(row => row.code === code);
        return location === undefined || locationDestroyed(location.id, location.internalPoints, state);
    });
    const torso = [...index.locations.values()].find(location => location.code === 'Torso');
    const torsoDestroyed = torso !== undefined
        && locationDestroyed(torso.id, torso.internalPoints, state);
    const torsoDamage = [...index.damageTracks.values()].some(track =>
        track.system === 'torso' && track.stage === 3
        && (state.damageTracks.get(track.id)?.hits ?? 0) > 0);
    const filled = (system: SystemDamageKind): number => [...index.damageTracks.values()].filter(track =>
        track.system === system && (state.damageTracks.get(track.id)?.hits ?? 0) > 0).length;
    const arm = (code: 'Left Arm' | 'Right Arm', system: SystemDamageKind): number => {
        const location = [...index.locations.values()].find(row => row.code === code);
        return location && locationDestroyed(location.id, location.internalPoints, state) ? 2 : filled(system);
    };
    const criticalHits: ProtoMekCriticalHits = Object.freeze({
        head: filled('head'),
        torso: filled('torso'),
        legs: filled('legs'),
        'Left Arm': arm('Left Arm', 'left-arm'),
        'Right Arm': arm('Right Arm', 'right-arm'),
    });
    const armsLost = !entity.isQuad() && criticalHits['Left Arm'] >= 2 && criticalHits['Right Arm'] >= 2;
    const fireBlockedComponentIds = new ImmutableSet(armsLost
        ? [...index.components.values()]
            .filter(component => component.mount.getOccupiedLocations().includes('Main Gun'))
            .map(component => component.id)
        : []);
    const computedConditions: UnitConditionKey[] = [];
    if (abandoned) computedConditions.push('abandoned');
    if (allLimbsDestroyed || !functionalCrew) computedConditions.push('immobile');
    if (crippled) computedConditions.push('crippled');

    const conditionControlKeys: UnitConditionKey[] = ['swarmed', 'tagged', 'ecm-shielded'];
    if (gameRulesFor(ruleset).supportsSkidding) conditionControlKeys.push('skidding');
    conditionControlKeys.push('jammed');

    return Object.freeze({
        criticalHits,
        fireBlockedComponentIds,
        // Pilot death destroys a ProtoMek outright (MegaMek "pilot death"); a destroyed head does not.
        destroyed: state.explicitlyDestroyed || torsoDestroyed || torsoDamage
            || crew.some(crewMember => crewMember.isDeathCommitted()),
        computedConditions: Object.freeze(computedConditions),
        conditionControlKeys: Object.freeze(conditionControlKeys),
        crewStateControlKeys: Object.freeze(['stunned'] as const),
        crewStateDisplayKeys: Object.freeze(['stunned', 'killed'] as const),
        attackMovementModifier: getDefaultAttackerMovementModifier(state.turn.movement?.mode),
    });
}

/** −1 MP, then half the original rounding up; a third hit leaves none (TW p.186). */
function criticalMP(mp: number, hits: number): number {
    return hits <= 0 ? mp : hits === 1 ? Math.max(0, mp - 1) : hits === 2 ? Math.ceil(mp / 2) : 0;
}

/**
 * Movement after critical hits: leg hits cut Walking MP (a glider's torso hits cut its cruise instead) and
 * torso hits cut Jumping MP; legs blown off allow no jumping (TW p.186; MegaMek gliders).
 */
export function protoMekMovement(
    entity: ProtoMekEntity,
    hits: ProtoMekCriticalHits,
    walk: number,
    jump: number,
    ignoreMyomerBooster: boolean,
): Readonly<{ walk: number; run: number; jump: number }> {
    const reducedWalk = criticalMP(walk, entity.isGlider() ? hits.torso : hits.legs);
    return Object.freeze({
        walk: reducedWalk,
        run: entity.runMPFromWalk(reducedWalk, ignoreMyomerBooster),
        jump: hits.legs >= 3 ? 0 : entity.isGlider() ? jump : criticalMP(jump, hits.torso),
    });
}

/** To-hit modifiers critical hits add to a weapon mounted in these locations (TW p.186). */
export function protoMekCriticalModifiers(
    hits: ProtoMekCriticalHits,
    locations: readonly string[],
): readonly ToHitModifierBreakdownEntry[] {
    const rows: ToHitModifierBreakdownEntry[] = [];
    if (hits.head > 0) rows.push({ label: hits.head >= 2 ? 'Head destroyed' : 'Head critical', modifier: Math.min(2, hits.head) });
    for (const arm of ['Left Arm', 'Right Arm'] as const) {
        if (locations.includes(arm) && hits[arm] === 1) rows.push({ label: `${arm} critical`, modifier: 1 });
        if (locations.includes('Main Gun') && hits[arm] > 0) {
            rows.push({ label: `${arm} ${hits[arm] >= 2 ? 'destroyed' : 'critical'}`, modifier: Math.min(2, hits[arm]) });
        }
    }
    return Object.freeze(rows.map(row => Object.freeze(row)));
}

function locationDestroyed(
    locationId: LocationId,
    maximum: number,
    state: NonMekUnitRuntimeState,
): boolean {
    return maximum > 0
        && (state.locations.get(locationId)?.internalDamage ?? 0) >= maximum;
}
