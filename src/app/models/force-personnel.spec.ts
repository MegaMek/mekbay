// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    EMPTY_FORCE_PERSONNEL, addForcePerson, assignForcePerson, assignedForcePerson,
    canonicalizeForcePersonnel, cloneForcePersonnel, createForcePerson,
    detachForcePersonnel, removeUnitPersonnel, forcePersonnelCrewAssignment, transferForcePersonnel, updateForcePerson,
} from './force-personnel';
import { asCrewPositionId } from './entity/entity-identifiers';

describe('force personnel', () => {
    it('preserves people independently of assignments and derives vacant crew explicitly', () => {
        const pilot = createForcePerson({ name: 'Morgan', portrait: 'Doctor_M_8', gunnery: 3, piloting: 4 }, 'person:pilot');
        let snapshot = addForcePerson(EMPTY_FORCE_PERSONNEL, pilot);
        snapshot = assignForcePerson(snapshot, 'unit:first', 'crew:0', pilot.id);
        expect(forcePersonnelCrewAssignment(snapshot, 'unit:first').positions[0]).toEqual({
            positionId: asCrewPositionId('crew:0'), name: 'Morgan', gunnery: 3, piloting: 4,
        });
        const detached = detachForcePersonnel(snapshot, new Set(['unit:first']));
        expect(detached.people).toBe(snapshot.people);
        expect(detached.assignments).toEqual([]);
        expect(forcePersonnelCrewAssignment(detached, 'unit:first').positions).toEqual([]);
        const reassigned = assignForcePerson(detached, 'unit:second', 'crew:1', pilot.id);
        expect(assignedForcePerson(reassigned, 'unit:second', 'crew:1')?.id).toBe(pilot.id);
        expect(assignedForcePerson(reassigned, 'unit:second', 'crew:1')?.portrait).toBe('Doctor_M_8');
        expect(snapshot.assignments[0].unitId).toBe('unit:first');
    });

    it('keeps one person per station and one assignment per person during replacement', () => {
        const first = createForcePerson({}, 'person:first');
        const second = createForcePerson({}, 'person:second');
        let snapshot = addForcePerson(addForcePerson(EMPTY_FORCE_PERSONNEL, first), second);
        snapshot = assignForcePerson(snapshot, 'unit:a', 'pilot', first.id);
        snapshot = assignForcePerson(snapshot, 'unit:b', 'pilot', second.id);
        snapshot = assignForcePerson(snapshot, 'unit:b', 'pilot', first.id);
        expect(snapshot.assignments).toEqual([
            { unitId: 'unit:a', positionId: 'pilot', personId: second.id },
            { unitId: 'unit:b', positionId: 'pilot', personId: first.id },
        ]);
        expect(snapshot.people.length).toBe(2);
    });

    it('omits empty portraits, clears existing choices, and bounds persisted portrait names', () => {
        expect(createForcePerson().portrait).toBeUndefined();
        expect(createForcePerson({ portrait: '' }).portrait).toBeUndefined();
        const person = createForcePerson({ portrait: 'Doctor_M_8' });
        const snapshot = addForcePerson(EMPTY_FORCE_PERSONNEL, person);
        expect(updateForcePerson(snapshot, person.id, { portrait: undefined }).people[0].portrait).toBeUndefined();
        expect(() => createForcePerson({ portrait: 'x'.repeat(257) })).toThrow();
        expect(() => createForcePerson({ portrait: 'bad\0key' })).toThrow();
    });

    it('stores bounded notes verbatim and deletes only occupants of removed units', () => {
        const occupant = createForcePerson({ notes: 'First line\nSecond line' }, 'person:occupant');
        const reserve = createForcePerson({ notes: 'r'.repeat(512) }, 'person:reserve');
        const source = assignForcePerson(addForcePerson(addForcePerson(EMPTY_FORCE_PERSONNEL, occupant), reserve), 'u', 'pilot', occupant.id);
        expect(source.people[0].notes).toBe('First line\nSecond line');
        expect(removeUnitPersonnel(source, new Set(['u']))).toEqual({ people: [reserve], assignments: [] });
        expect(() => createForcePerson({ notes: 'x'.repeat(513) })).toThrow();
        expect(createForcePerson({ notes: '' }).notes).toBeUndefined();
    });

    it('derives profiles in entity occurrence order after arbitrary assignment edits', () => {
        let snapshot = EMPTY_FORCE_PERSONNEL;
        for (const occurrence of [10, 2, 0]) {
            const person = createForcePerson({}, `person:${occurrence}`);
            snapshot = assignForcePerson(addForcePerson(snapshot, person), 'unit:a', `crew:${occurrence}`, person.id);
        }
        expect(forcePersonnelCrewAssignment(snapshot, 'unit:a').positions.map(position => position.positionId as string))
            .toEqual(['crew:0', 'crew:2', 'crew:10']);
    });

    it('owns custom abilities and health without narrowing valid custom ability values', () => {
        const profile = { name: 'Pilot', abilities: [{ name: 'x'.repeat(600), cost: -0.5, summary: 'y'.repeat(5000) }],
            health: { wounds: 2, unconscious: true, ejected: false, recoveryReadyTurn: 3 } };
        const person = createForcePerson(profile, 'person:custom');
        profile.abilities[0].cost = 99;
        profile.health.wounds = 5;
        expect(person.abilities?.[0]).toEqual(jasmine.objectContaining({ cost: -0.5 }));
        expect(person.health?.wounds).toBe(2);
        expect(Object.isFrozen(person.health)).toBeTrue();
        expect(Object.isFrozen(person.abilities)).toBeTrue();
    });

    it('rejects invalid skills, personal health, identities, and assignment references at ingress', () => {
        const person = createForcePerson({}, 'person:first');
        for (const patch of [{ gunnery: 9 }, { gunnery: 1.5 }, { health: { wounds: 7, unconscious: false, ejected: false } }]) {
            expect(() => canonicalizeForcePersonnel({ people: [{ ...person, ...patch }], assignments: [] })).toThrow();
        }
        expect(() => canonicalizeForcePersonnel({ people: [person, person], assignments: [] })).toThrow();
        expect(() => canonicalizeForcePersonnel({ people: [person], assignments: [{ unitId: 'u', positionId: 'pilot', personId: 'missing' }] })).toThrow();
        expect(() => canonicalizeForcePersonnel({ people: [person], assignments: [
            { unitId: 'u', positionId: 'pilot', personId: person.id }, { unitId: 'v', positionId: 'pilot', personId: person.id },
        ] })).toThrow();
    });

    it('moves actual occupants but gives independent force clones new person identities', () => {
        const person = createForcePerson({ name: 'Pilot' }, 'person:pilot');
        const reserve = createForcePerson({ name: 'Reserve' }, 'person:reserve');
        const source = assignForcePerson(addForcePerson(addForcePerson(EMPTY_FORCE_PERSONNEL, person), reserve), 'u', 'pilot', person.id);
        const moved = transferForcePersonnel(source, EMPTY_FORCE_PERSONNEL, new Map([['u', 'v']]));
        expect(moved.source.people).toEqual([reserve]);
        expect(moved.target.people[0].id).toBe(person.id);
        expect(moved.target.assignments[0].unitId).toBe('v');
        const clone = cloneForcePersonnel(source, new Map([['u', 'cloned']]));
        expect(clone.people.every(copy => !source.people.some(original => original.id === copy.id))).toBeTrue();
        expect(clone.assignments[0].unitId).toBe('cloned');
        expect(clone.assignments[0].personId).toBe(clone.people[0].id);
        const edited = updateForcePerson(clone, clone.people[0].id, { name: 'Clone pilot' });
        expect(edited.people[0].name).toBe('Clone pilot');
        expect(source.people[0].name).toBe('Pilot');
    });
});
