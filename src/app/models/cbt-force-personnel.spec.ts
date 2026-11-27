// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { affectedPersonnelUnitIds, planPersonnelCrewEdits } from './cbt-force-personnel';
import type { CrewMemberRuntimeState } from './crew-member.model';
import { asCrewPositionId } from './entity/entity-identifiers';
import { assignForcePerson, canonicalizeForcePersonnel } from './force-personnel';

describe('CBT personnel crew planning', () => {
    const positionId = asCrewPositionId('crew:0');
    const pristine: CrewMemberRuntimeState = Object.freeze({ wounds: 0, unconscious: false, ejected: false });
    const wounded: CrewMemberRuntimeState = Object.freeze({
        wounds: 2, unconscious: true, ejected: false, recoveryReadyTurn: 4,
    });

    it('uses live health during an occupied swap and clears stale personal health', () => {
        const before = canonicalizeForcePersonnel({
            people: [{ id: 'pilot:left', name: 'Left', health: wounded }, { id: 'pilot:right', name: 'Right' }],
            assignments: [
                { personId: 'pilot:left', unitId: 'unit:left', positionId },
                { personId: 'pilot:right', unitId: 'unit:right', positionId },
            ],
        });
        const next = assignForcePerson(before, 'unit:right', positionId, 'pilot:left');
        const affected = [...affectedPersonnelUnitIds(before, next)];
        const plan = planPersonnelCrewEdits(next, affected, new Map([
            ['pilot:left', pristine],
            ['pilot:right', wounded],
        ]));
        const edits = new Map(plan.edits.map(edit => [edit.instanceId, edit]));

        expect(affected).toEqual(['unit:left', 'unit:right']);
        expect(edits.get('unit:left')!.assignment.positions[0].name).toBe('Right');
        expect(edits.get('unit:left')!.health.get(positionId)).toEqual(wounded);
        expect(edits.get('unit:right')!.assignment.positions[0].name).toBe('Left');
        expect(edits.get('unit:right')!.health.size).toBe(0);
        expect(plan.personnel.people.every(person => person.health === undefined)).toBeTrue();
        expect(before.people[0].health).toEqual(wounded);
        expect(next.people[0].health).toEqual(wounded);
    });

    it('retains a displaced occupant health in reserve and consumes incoming reserve health', () => {
        const ejected: CrewMemberRuntimeState = Object.freeze({ wounds: 1, unconscious: false, ejected: true });
        const before = canonicalizeForcePersonnel({
            people: [{ id: 'pilot:occupant' }, { id: 'pilot:reserve', health: wounded }, { id: 'pilot:unrelated' }],
            assignments: [{ personId: 'pilot:occupant', unitId: 'unit:left', positionId }],
        });
        const next = assignForcePerson(before, 'unit:left', positionId, 'pilot:reserve');
        const plan = planPersonnelCrewEdits(next, [...affectedPersonnelUnitIds(before, next)], new Map([
            ['pilot:occupant', ejected],
        ]));

        expect(plan.edits).toHaveSize(1);
        expect(plan.edits[0].health.get(positionId)).toEqual(wounded);
        expect(plan.personnel.people.find(person => person.id === 'pilot:occupant')!.health).toEqual(ejected);
        expect(plan.personnel.people.find(person => person.id === 'pilot:reserve')!.health).toBeUndefined();
        expect(plan.personnel.people.find(person => person.id === 'pilot:unrelated')).toBe(before.people[2]);
        expect(next.people[0].health).toBeUndefined();
        expect(next.people[1].health).toEqual(wounded);
    });
});
