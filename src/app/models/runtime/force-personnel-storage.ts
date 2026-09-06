// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { CrewMemberRuntimeState } from '../crew-member.model';
import { canonicalizeForcePersonnel, type ForcePerson, type ForcePersonnelSnapshot } from '../force-personnel';
import type { SerializedForce } from '../force-serialization';
import { packOpaqueId, unpackOpaqueId } from './compact-uuid';
import { isSerializedNonMekUnit } from './non-mek-unit-persistence';
import { createSavedTargetRef } from './persistence-v2';
import type { StoredForceCrew, StoredForcePerson } from './force-storage.model';

export interface AssignedForcePerson {
    readonly positionId: string;
    readonly person: ForcePerson;
}

export interface DecodedForcePersonnel {
    readonly snapshot: ForcePersonnelSnapshot;
    readonly membersByUnit: ReadonlyMap<string, readonly AssignedForcePerson[]>;
}

/** Each person is stored once: in their occupied station, or in the reserve list. */
export function packForcePersonnel(force: SerializedForce): {
    readonly personnel: readonly StoredForcePerson[];
    readonly crewByUnit: ReadonlyMap<string, StoredForceCrew>;
} {
    const snapshot = force.personnel;
    if (!snapshot) throw new Error('Current force persistence requires a personnel roster');
    const people = new Map(snapshot.people.map(person => [person.id, person]));
    const units = new Map(force.cbt?.units.map(entry => [entry.instanceId, entry.unit]) ?? []);
    const assigned = new Set<string>();
    const crewByUnit = new Map<string, (StoredForcePerson | null)[]>();
    for (const assignment of snapshot.assignments) {
        const person = people.get(assignment.personId);
        if (!person) throw new Error('Crew assignment references a missing person');
        const unit = units.get(assignment.unitId);
        let health = person.health;
        if (unit) {
            const runtimeHealth = isSerializedNonMekUnit(unit)
                ? unit.crewState?.find(row => row.positionId === assignment.positionId)
                : unit.crew.positions.find(row => row.target === savedCrewHealthTarget(assignment.positionId));
            // Assigned CBT health belongs to the runtime, including a pristine reset.
            health = runtimeHealth && { ...runtimeHealth, ejected: runtimeHealth.ejected === true };
        }
        const crew = crewByUnit.get(assignment.unitId) ?? [];
        const station = crewStationIndex(assignment.positionId, force.type);
        while (crew.length <= station) crew.push(null);
        crew[station] = packPerson(person, health);
        crewByUnit.set(assignment.unitId, crew);
        assigned.add(person.id);
    }
    return {
        personnel: snapshot.people.filter(person => !assigned.has(person.id)).map(person => packPerson(person, person.health)),
        crewByUnit,
    };
}

function packPerson(person: ForcePerson, health: CrewMemberRuntimeState | undefined): StoredForcePerson {
    const storedHealth = packHealth(health);
    return {
        id: packOpaqueId(person.id),
        ...(person.name ? { name: person.name } : {}),
        ...(person.notes ? { notes: person.notes } : {}),
        ...(person.portrait ? { portrait: person.portrait } : {}),
        ...(person.gunnery === undefined || person.gunnery === 4 ? {} : { g: person.gunnery }),
        ...(person.piloting === undefined || person.piloting === 5 ? {} : { p: person.piloting }),
        ...(person.commander ? { commander: true } : {}),
        ...(person.abilities?.length ? { abilities: structuredClone(person.abilities) } : {}),
        ...(storedHealth ? { health: storedHealth } : {}),
    };
}

export function unpackForcePersonnel(
    value: unknown,
    unitRows: readonly unknown[],
    unitIds: readonly string[],
    system: GameSystem,
): DecodedForcePersonnel {
    if (value !== undefined && !Array.isArray(value)) throw new Error('force.personnel must be an array');
    const people: ReturnType<typeof unpackPerson>[] = [];
    const assignments = unitRows.flatMap((raw, index) => {
        const crew = (raw as Record<string, unknown>)['crew'];
        if (crew === undefined) return [];
        if (!Array.isArray(crew)) throw new Error(`force.units[${index}].crew must be an array`);
        if (system === GameSystem.AS && crew.length > 1) throw new Error('Alpha Strike has one pilot station');
        return crew.flatMap((rawPerson, stationIndex) => {
            if (rawPerson === null) return [];
            const person = unpackPerson(rawPerson, `force.units[${index}].crew[${stationIndex}]`);
            people.push(person);
            return [{ unitId: unitIds[index]!, positionId: system === GameSystem.AS ? 'pilot' : `crew:${stationIndex}`,
                personId: person.id }];
        });
    });
    for (const [index, raw] of ((value ?? []) as unknown[]).entries()) {
        people.push(unpackPerson(raw, `force.personnel[${index}]`));
    }
    const canonical = canonicalizeForcePersonnel({ people, assignments });
    const peopleById = new Map(canonical.people.map(person => [person.id, person]));
    const membersByUnit = new Map<string, AssignedForcePerson[]>();
    for (const assignment of canonical.assignments) {
        const members = membersByUnit.get(assignment.unitId) ?? [];
        members.push({ positionId: assignment.positionId, person: peopleById.get(assignment.personId)! });
        membersByUnit.set(assignment.unitId, members);
    }
    // Keep personal health until unit restoration succeeds. A missing unit
    // leaves its people unassigned, with their health intact.
    return { snapshot: canonical, membersByUnit };
}

function unpackPerson(raw: unknown, path: string) {
    const row = exactRecord(raw, ['id', 'name', 'notes', 'portrait', 'g', 'p', 'commander', 'abilities', 'health'], path);
    if (typeof row['id'] !== 'string') throw new Error(`${path}.id must be a string`);
    const health = row['health'] === undefined ? undefined : exactRecord(row['health'],
        ['wounds', 'unconscious', 'ejected', 'dead', 'recoveryReadyTurn'], `${path}.health`);
    return {
        id: unpackOpaqueId(row['id'], `${path}.id`),
        ...(row['name'] === undefined ? {} : { name: row['name'] }),
        ...(row['notes'] === undefined ? {} : { notes: row['notes'] }),
        ...(row['portrait'] === undefined ? {} : { portrait: row['portrait'] }),
        ...(row['g'] === undefined ? {} : { gunnery: row['g'] }),
        ...(row['p'] === undefined ? {} : { piloting: row['p'] }),
        ...(row['commander'] === undefined ? {} : { commander: row['commander'] }),
        ...(row['abilities'] === undefined ? {} : { abilities: row['abilities'] }),
        ...(health === undefined ? {} : { health: {
            wounds: health['wounds'] ?? 0,
            unconscious: health['unconscious'] ?? false,
            ejected: health['ejected'] ?? false,
            ...(health['dead'] === undefined ? {} : { dead: health['dead'] }),
            ...(health['recoveryReadyTurn'] === undefined ? {} : { recoveryReadyTurn: health['recoveryReadyTurn'] }),
        } }),
    };
}

function crewStationIndex(positionId: string, system: GameSystem): number {
    if (system === GameSystem.AS) {
        if (positionId !== 'pilot') throw new Error('Alpha Strike has one pilot station');
        return 0;
    }
    if (!/^crew:\d+$/u.test(positionId)) throw new Error('Invalid canonical CBT crew station');
    return Number(positionId.slice('crew:'.length));
}

/** Mek health targets use the occurrence from the canonical crew station ID. */
export function savedCrewHealthTarget(positionId: string) {
    return createSavedTargetRef('crew', String(crewStationIndex(positionId, GameSystem.CBT)));
}

function packHealth(health: CrewMemberRuntimeState | undefined): StoredForcePerson['health'] {
    if (!health || (!health.wounds && !health.unconscious && !health.ejected && !health.dead
        && health.recoveryReadyTurn === undefined)) return undefined;
    return {
        ...(health.wounds ? { wounds: health.wounds } : {}),
        ...(health.unconscious ? { unconscious: true } : {}),
        ...(health.ejected ? { ejected: true } : {}),
        ...(health.dead ? { dead: true } : {}),
        ...(health.recoveryReadyTurn === undefined ? {} : { recoveryReadyTurn: health.recoveryReadyTurn }),
    };
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !keys.includes(key))) throw new Error(`${path} contains an unknown field`);
    return row;
}
