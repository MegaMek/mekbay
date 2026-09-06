// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CrewMember, type CrewMemberRuntimeState } from './crew-member.model';
import { asCrewPositionId, type CrewPositionId } from './entity/entity-identifiers';
import {
    changedForcePersonnelIds,
    forcePersonnelCrewAssignment,
    updateForcePerson,
    type ForcePersonnelSnapshot,
} from './force-personnel';

/** Both ends of a reassignment need replacement; reserve-only edits need none. */
export function affectedPersonnelUnitIds(
    before: ForcePersonnelSnapshot,
    after: ForcePersonnelSnapshot,
): ReadonlySet<string> {
    const beforeBindings = new Map(before.assignments.map(assignment => [assignment.personId, assignment]));
    const afterBindings = new Map(after.assignments.map(assignment => [assignment.personId, assignment]));
    const affected = new Set<string>();
    for (const personId of changedForcePersonnelIds(before, after)) {
        const oldBinding = beforeBindings.get(personId);
        const newBinding = afterBindings.get(personId);
        if (oldBinding) affected.add(oldBinding.unitId);
        if (newBinding) affected.add(newBinding.unitId);
    }
    return affected;
}

/**
 * Health follows each person: departing occupants retain it in reserve, and
 * incoming occupants move it into their new station's runtime state.
 */
export function planPersonnelCrewEdits(
    personnel: ForcePersonnelSnapshot,
    instanceIds: readonly string[],
    healthByPerson: ReadonlyMap<string, CrewMemberRuntimeState>,
) {
    const people = new Map(personnel.people.map(person => [person.id, person]));
    const assigned = new Set(personnel.assignments.map(assignment => assignment.personId));
    let next = personnel;
    for (const [personId, health] of healthByPerson) {
        if (people.has(personId) && !assigned.has(personId)) {
            next = updateForcePerson(next, personId, {
                health: CrewMember.from(health).isPristine() ? undefined : health,
            });
        }
    }
    const edits = instanceIds.map(instanceId => {
        const health = new Map<CrewPositionId, CrewMemberRuntimeState>();
        for (const assignment of personnel.assignments) {
            if (assignment.unitId !== instanceId) continue;
            const person = people.get(assignment.personId)!;
            const state = CrewMember.from(healthByPerson.get(person.id) ?? person.health);
            if (!state.isPristine()) health.set(asCrewPositionId(assignment.positionId), state.toRuntimeState());
            if (person.health !== undefined) next = updateForcePerson(next, person.id, { health: undefined });
        }
        return Object.freeze({ instanceId, assignment: forcePersonnelCrewAssignment(next, instanceId), health });
    });
    return Object.freeze({ personnel: next, edits: Object.freeze(edits) });
}
