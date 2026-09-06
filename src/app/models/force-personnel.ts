// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ASCustomPilotAbility } from './pilot-abilities.model';
import { MAX_CREW_WOUNDS, type CrewMemberRuntimeState } from './crew-member.model';
import { MAX_CREW_NAME_LENGTH, type CrewAssignment } from './runtime/crew-assignment';
import { asCrewPositionId } from './entity/entity-identifiers';
import { uuidv7 } from '../utils/uuid.util';

export const FORCE_PERSON_NOTES_MAX_LENGTH = 512;

/** Personal facts follow the person through assignment, reserve duty, and transfers. */
export interface ForcePerson {
    readonly id: string;
    readonly name?: string;
    readonly notes?: string;
    /** Portrait filename without its extension; absent means no portrait. */
    readonly portrait?: string;
    readonly commander?: true;
    /** Gunnery in CBT and the pilot's Skill rating in Alpha Strike; default 4. */
    readonly gunnery?: number;
    readonly piloting?: number;
    readonly abilities?: readonly (string | ASCustomPilotAbility)[];
    /** Unassigned health, or ingress health awaiting successful CBT runtime restoration. */
    readonly health?: CrewMemberRuntimeState;
}

export interface ForceCrewAssignment {
    readonly unitId: string;
    readonly positionId: string;
    readonly personId: string;
}

export interface ForcePersonnelSnapshot {
    readonly people: readonly ForcePerson[];
    readonly assignments: readonly ForceCrewAssignment[];
}

export const EMPTY_FORCE_PERSONNEL: ForcePersonnelSnapshot = Object.freeze({
    people: Object.freeze([]), assignments: Object.freeze([]),
});

/** The single parser for persisted personal facts and assignment ownership. */
export function canonicalizeForcePersonnel(value: unknown): ForcePersonnelSnapshot {
    const source = record(value, ['people', 'assignments'], 'personnel');
    if (!Array.isArray(source['people']) || !Array.isArray(source['assignments'])) {
        throw new Error('Personnel requires people and assignments arrays');
    }
    const people = source['people'].map(canonicalPerson);
    const ids = new Set(people.map(person => person.id));
    if (ids.size !== people.length) throw new Error('Personnel has duplicate person identities');
    const assigned = new Set<string>();
    const stations = new Set<string>();
    const assignments = source['assignments'].map((raw, index) => {
        const path = `personnel.assignments[${index}]`;
        const row = record(raw, ['unitId', 'positionId', 'personId'], path);
        const unitId = identity(row['unitId'], `${path}.unitId`);
        const positionId = identity(row['positionId'], `${path}.positionId`);
        const personId = identity(row['personId'], `${path}.personId`);
        if (!ids.has(personId)) throw new Error(`${path} references a missing person`);
        if (assigned.has(personId)) throw new Error(`${path} assigns one person more than once`);
        const station = JSON.stringify([unitId, positionId]);
        if (stations.has(station)) throw new Error(`${path} assigns one station more than once`);
        stations.add(station);
        assigned.add(personId);
        return Object.freeze({ unitId, positionId, personId });
    });
    return Object.freeze({ people: Object.freeze(people), assignments: Object.freeze(assignments) });
}

/** Call during admission/import, never during serialization. */
export function createForcePerson(profile: Omit<ForcePerson, 'id'> = {}, id = uuidv7()): ForcePerson {
    return canonicalPerson({ ...profile, id });
}

export function assignedForcePerson(snapshot: ForcePersonnelSnapshot, unitId: string, positionId: string): ForcePerson | undefined {
    const binding = snapshot.assignments.find(assignment => assignment.unitId === unitId && assignment.positionId === positionId);
    return binding === undefined ? undefined : snapshot.people.find(person => person.id === binding.personId);
}

export function addForcePerson(snapshot: ForcePersonnelSnapshot, person: ForcePerson): ForcePersonnelSnapshot {
    if (snapshot.people.some(current => current.id === person.id)) throw new Error(`Person ${person.id} is already owned`);
    return Object.freeze({ people: Object.freeze([...snapshot.people, person]), assignments: snapshot.assignments });
}

export function updateForcePerson(snapshot: ForcePersonnelSnapshot, personId: string, patch: Partial<Omit<ForcePerson, 'id'>>): ForcePersonnelSnapshot {
    const index = snapshot.people.findIndex(person => person.id === personId);
    if (index === -1) throw new Error(`Person ${personId} is not owned`);
    const person = canonicalPerson({ ...snapshot.people[index], ...patch, id: personId });
    const people = [...snapshot.people];
    people[index] = person;
    return Object.freeze({ people: Object.freeze(people), assignments: snapshot.assignments });
}

/** Assigned people swap stations; a reserve replaces an occupant into reserve. */
export function assignForcePerson(snapshot: ForcePersonnelSnapshot, unitId: string, positionId: string, personId: string): ForcePersonnelSnapshot {
    if (!snapshot.people.some(person => person.id === personId)) throw new Error(`Person ${personId} is not owned`);
    const previous = snapshot.assignments.find(assignment => assignment.personId === personId);
    if (previous?.unitId === unitId && previous.positionId === positionId) return snapshot;
    const displaced = snapshot.assignments.find(assignment => assignment.unitId === unitId && assignment.positionId === positionId);
    const assignments = snapshot.assignments.filter(assignment => assignment.personId !== personId
        && (assignment.unitId !== unitId || assignment.positionId !== positionId));
    if (previous && displaced) assignments.push(Object.freeze({ ...previous, personId: displaced.personId }));
    assignments.push(Object.freeze({ unitId, positionId, personId }));
    return Object.freeze({ people: snapshot.people, assignments: Object.freeze(assignments) });
}

/** Explicit unassignment and failed unit restoration retain people. Capture live health first. */
export function detachForcePersonnel(snapshot: ForcePersonnelSnapshot, unitIds: ReadonlySet<string>): ForcePersonnelSnapshot {
    const assignments = snapshot.assignments.filter(assignment => !unitIds.has(assignment.unitId));
    return assignments.length === snapshot.assignments.length ? snapshot
        : Object.freeze({ people: snapshot.people, assignments: Object.freeze(assignments) });
}

/** Deleting a unit deletes its assigned people; independent reserves are unaffected. */
export function removeUnitPersonnel(snapshot: ForcePersonnelSnapshot, unitIds: ReadonlySet<string>): ForcePersonnelSnapshot {
    const removed = new Set(snapshot.assignments.filter(assignment => unitIds.has(assignment.unitId)).map(assignment => assignment.personId));
    if (!removed.size) return snapshot;
    return Object.freeze({ people: Object.freeze(snapshot.people.filter(person => !removed.has(person.id))),
        assignments: Object.freeze(snapshot.assignments.filter(assignment => !removed.has(assignment.personId))) });
}

export function removeForcePerson(snapshot: ForcePersonnelSnapshot, personId: string): ForcePersonnelSnapshot {
    return Object.freeze({ people: Object.freeze(snapshot.people.filter(person => person.id !== personId)),
        assignments: Object.freeze(snapshot.assignments.filter(assignment => assignment.personId !== personId)) });
}

export function remapForcePersonnelUnits(snapshot: ForcePersonnelSnapshot, unitIds: ReadonlyMap<string, string>): ForcePersonnelSnapshot {
    return Object.freeze({ people: snapshot.people, assignments: Object.freeze(snapshot.assignments.map(assignment => Object.freeze({
        ...assignment, unitId: unitIds.get(assignment.unitId) ?? assignment.unitId,
    }))) });
}

/** A force clone owns new people; ordinary reassignment preserves their identities. */
export function cloneForcePersonnel(snapshot: ForcePersonnelSnapshot, unitIds: ReadonlyMap<string, string>): ForcePersonnelSnapshot {
    const personIds = new Map(snapshot.people.map(person => [person.id, uuidv7()] as const));
    return Object.freeze({
        people: Object.freeze(snapshot.people.map(person => canonicalPerson({ ...person, id: personIds.get(person.id)! }))),
        assignments: Object.freeze(snapshot.assignments.map(assignment => Object.freeze({
            ...assignment, unitId: unitIds.get(assignment.unitId) ?? assignment.unitId, personId: personIds.get(assignment.personId)!,
        }))),
    });
}

/** Move the occupants of actual units between owners; independent reserves stay with their force. */
export function transferForcePersonnel(source: ForcePersonnelSnapshot, target: ForcePersonnelSnapshot, unitIds: ReadonlyMap<string, string>): {
    readonly source: ForcePersonnelSnapshot; readonly target: ForcePersonnelSnapshot;
} {
    const moving = source.assignments.filter(assignment => unitIds.has(assignment.unitId));
    const personIds = new Set(moving.map(assignment => assignment.personId));
    if (target.people.some(person => personIds.has(person.id))) throw new Error('Target force already owns a transferred person');
    const targetStations = new Set(target.assignments.map(assignment => JSON.stringify([assignment.unitId, assignment.positionId])));
    const assignments = moving.map(assignment => Object.freeze({ ...assignment, unitId: unitIds.get(assignment.unitId)! }));
    if (assignments.some(assignment => targetStations.has(JSON.stringify([assignment.unitId, assignment.positionId])))) {
        throw new Error('Target force already occupies a transferred station');
    }
    return Object.freeze({
        source: Object.freeze({ people: Object.freeze(source.people.filter(person => !personIds.has(person.id))),
            assignments: Object.freeze(source.assignments.filter(assignment => !personIds.has(assignment.personId))) }),
        target: Object.freeze({ people: Object.freeze([...target.people, ...source.people.filter(person => personIds.has(person.id))]),
            assignments: Object.freeze([...target.assignments, ...assignments]) }),
    });
}

/** Restore one crew edit while retaining later, unrelated changes to the reserve roster. */
export function restoreForcePersonnelEdit(
    current: ForcePersonnelSnapshot,
    before: ForcePersonnelSnapshot,
    after: ForcePersonnelSnapshot,
    selected: ForcePersonnelSnapshot,
): ForcePersonnelSnapshot {
    const beforePeople = new Map(before.people.map(person => [person.id, person] as const));
    const afterPeople = new Map(after.people.map(person => [person.id, person] as const));
    const beforeAssignments = new Map(before.assignments.map(assignment => [assignment.personId, assignment] as const));
    const afterAssignments = new Map(after.assignments.map(assignment => [assignment.personId, assignment] as const));
    const changed = new Set([...beforePeople.keys(), ...afterPeople.keys()].filter(id => {
        const oldAssignment = beforeAssignments.get(id);
        const newAssignment = afterAssignments.get(id);
        return beforePeople.get(id) !== afterPeople.get(id)
            || oldAssignment?.unitId !== newAssignment?.unitId
            || oldAssignment?.positionId !== newAssignment?.positionId;
    }));
    const selectedPeople = new Map(selected.people.map(person => [person.id, person] as const));
    const retained = new Set(current.people.map(person => person.id));
    return Object.freeze({
        people: Object.freeze([
            ...current.people.flatMap(person => !changed.has(person.id) ? [person] : selectedPeople.has(person.id) ? [selectedPeople.get(person.id)!] : []),
            ...selected.people.filter(person => changed.has(person.id) && !retained.has(person.id)),
        ]),
        assignments: Object.freeze([
            ...current.assignments.filter(assignment => !changed.has(assignment.personId)),
            ...selected.assignments.filter(assignment => changed.has(assignment.personId)),
        ]),
    });
}

/** Derived immutable CBT input; absent bindings are vacant stations. */
export function forcePersonnelCrewAssignment(snapshot: ForcePersonnelSnapshot, unitId: string): CrewAssignment {
    const people = new Map(snapshot.people.map(person => [person.id, person] as const));
    // Mek and non-Mek indexes identify their stations as crew:<occurrence>.
    const assignments = snapshot.assignments.filter(assignment => assignment.unitId === unitId)
        .sort((left, right) => compareCrewPositionIds(left.positionId, right.positionId));
    return Object.freeze({ schemaVersion: 1, positions: Object.freeze(assignments.map(assignment => {
        const person = people.get(assignment.personId)!;
        return Object.freeze({ positionId: asCrewPositionId(assignment.positionId), name: person.name ?? '',
            gunnery: person.gunnery ?? 4, piloting: person.piloting ?? 5 });
    })) });
}

/** Canonical station order shared by force ownership and persisted crew reconstruction. */
export function compareCrewPositionIds(left: string, right: string): number {
    return Number(left.slice(5)) - Number(right.slice(5));
}

function canonicalPerson(value: unknown): ForcePerson {
    const row = record(value, ['id', 'name', 'notes', 'portrait', 'commander', 'gunnery', 'piloting', 'abilities', 'health'], 'person');
    const person: Record<string, unknown> = { id: identity(row['id'], 'person.id') };
    if (row['name'] !== undefined) {
        const name = boundedText(row['name'], MAX_CREW_NAME_LENGTH, 'person.name');
        if (name) person['name'] = name;
    }
    if (row['notes'] !== undefined) {
        const notes = boundedText(row['notes'], FORCE_PERSON_NOTES_MAX_LENGTH, 'person.notes');
        if (notes) person['notes'] = notes;
    }
    if (row['portrait'] !== undefined) {
        const portrait = boundedText(row['portrait'], 256, 'person.portrait');
        if (portrait) person['portrait'] = portrait;
    }
    if (row['commander'] !== undefined && row['commander'] !== false) {
        if (row['commander'] !== true) throw new Error('Person commander must be a boolean');
        person['commander'] = true;
    }
    for (const [key, standard] of [['gunnery', 4], ['piloting', 5]] as const) {
        if (row[key] !== undefined) {
            const skill = integer(row[key], 0, 8, `person.${key}`);
            if (skill !== standard) person[key] = skill;
        }
    }
    if (row['abilities'] !== undefined) {
        if (!Array.isArray(row['abilities'])) throw new Error('Person abilities must be an array');
        const abilities = row['abilities'].map((value): string | ASCustomPilotAbility => {
            if (typeof value === 'string') return value;
            const ability = record(value, ['name', 'cost', 'summary'], 'ability');
            return Object.freeze({ name: text(ability['name'], 'ability.name'),
                cost: finite(ability['cost'], 'ability.cost'), summary: text(ability['summary'], 'ability.summary') });
        });
        if (abilities.length) person['abilities'] = Object.freeze(abilities);
    }
    if (row['health'] !== undefined) {
        const health = record(row['health'], ['wounds', 'unconscious', 'ejected', 'dead', 'recoveryReadyTurn'], 'person.health');
        const wounds = integer(health['wounds'], 0, MAX_CREW_WOUNDS, 'person.health.wounds');
        if (typeof health['unconscious'] !== 'boolean' || typeof health['ejected'] !== 'boolean'
            || (health['dead'] !== undefined && health['dead'] !== true)) throw new Error('Person health flags are invalid');
        const recovery = health['recoveryReadyTurn'];
        if (recovery !== undefined && recovery !== null) integer(recovery, 0, Number.MAX_SAFE_INTEGER, 'person.health.recoveryReadyTurn');
        if (recovery !== undefined && !health['unconscious']) throw new Error('Conscious personnel cannot have pending recovery');
        person['health'] = Object.freeze({ wounds, unconscious: health['unconscious'], ejected: health['ejected'],
            ...(health['dead'] ? { dead: true } : {}), ...(recovery === undefined ? {} : { recoveryReadyTurn: recovery }) });
    }
    return Object.freeze(person) as unknown as ForcePerson;
}

function record(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    const row = value as Record<string, unknown>;
    for (const key of Object.keys(row)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is not supported`);
    return row;
}

function identity(value: unknown, path: string): string {
    const text = boundedText(value, 512, path);
    if (!text.trim()) throw new Error(`${path} must not be empty`);
    return text;
}

function boundedText(value: unknown, maximum: number, path: string): string {
    if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw new Error(`${path} is invalid`);
    return value;
}

function integer(value: unknown, minimum: number, maximum: number, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${path} is out of range`);
    return value as number;
}

function finite(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(path + ' must be finite');
    return value;
}

function text(value: unknown, path: string): string {
    if (typeof value !== 'string') throw new Error(path + ' must be a string');
    return value;
}
