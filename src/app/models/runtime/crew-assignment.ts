// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CrewPositionId } from '../entity/entity-identifiers';

export const CREW_ASSIGNMENT_SCHEMA_VERSION = 1 as const;
export const MAX_CREW_NAME_LENGTH = 160;
export const MAX_CREW_ROLE_LENGTH = 80;
export const MIN_CREW_SKILL = 0;
export const MAX_CREW_SKILL = 8;

export interface CrewAssignmentPosition {
    readonly positionId: CrewPositionId;
    readonly name: string;
    readonly role: string;
    readonly gunnery: number;
    readonly piloting: number;
}

/** Immutable deployment facts; combat wounds and consciousness remain sparse runtime state. */
export interface CrewAssignment {
    readonly schemaVersion: typeof CREW_ASSIGNMENT_SCHEMA_VERSION;
    readonly positions: readonly CrewAssignmentPosition[];
}

export interface CrewPositionDefinition {
    readonly id: CrewPositionId;
    readonly occurrence: number;
}

export type CrewTopology = ReadonlyMap<CrewPositionId, CrewPositionDefinition>;

export function createDefaultCrewAssignment(crewPositions: CrewTopology): CrewAssignment {
    return freezeAssignment(canonicalCrewPositions(crewPositions).map(position => ({
        positionId: position.id,
        name: '',
        role: '',
        gunnery: 4,
        piloting: 5,
    })));
}

export function canonicalizeCrewAssignment(
    crewPositions: CrewTopology,
    value: unknown,
): CrewAssignment {
    const record = requireExactRecord(value, ['schemaVersion', 'positions'], 'crewAssignment');
    if (record['schemaVersion'] !== CREW_ASSIGNMENT_SCHEMA_VERSION) {
        throw new Error(`crewAssignment.schemaVersion must be ${CREW_ASSIGNMENT_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(record['positions'])) throw new Error('crewAssignment.positions must be an array');

    const expected = canonicalCrewPositions(crewPositions);
    const expectedById = new Map(expected.map(position => [position.id, position] as const));
    const seen = new Set<CrewPositionId>();
    const parsed = new Map<CrewPositionId, CrewAssignmentPosition>();
    for (let index = 0; index < record['positions'].length; index += 1) {
        const path = `crewAssignment.positions[${index}]`;
        const item = requireExactRecord(
            record['positions'][index],
            ['positionId', 'name', 'role', 'gunnery', 'piloting'],
            path,
        );
        const positionId = boundedPositionId(item['positionId'], `${path}.positionId`);
        if (!expectedById.has(positionId)) throw new Error(`${path}.positionId is not in the entity crew topology`);
        if (seen.has(positionId)) throw new Error(`${path}.positionId is duplicated`);
        seen.add(positionId);
        parsed.set(positionId, Object.freeze({
            positionId,
            name: boundedText(item['name'], MAX_CREW_NAME_LENGTH, `${path}.name`),
            role: boundedText(item['role'], MAX_CREW_ROLE_LENGTH, `${path}.role`),
            gunnery: boundedSkill(item['gunnery'], `${path}.gunnery`),
            piloting: boundedSkill(item['piloting'], `${path}.piloting`),
        }));
    }
    if (parsed.size !== expected.length) {
        const missing = expected.filter(position => !parsed.has(position.id)).map(position => position.id);
        throw new Error(`crewAssignment.positions must exhaust the entity crew topology; missing: ${missing.join(', ')}`);
    }
    return freezeAssignment(expected.map(position => parsed.get(position.id)!));
}

/** Persistence must already use canonical entity-position order. */
export function assertCanonicalCrewAssignment(
    crewPositions: CrewTopology,
    value: unknown,
): CrewAssignment {
    const input = value as { readonly positions?: readonly { readonly positionId?: unknown }[] };
    const originalOrder = Array.isArray(input?.positions)
        ? input.positions.map(position => position?.positionId)
        : [];
    const canonical = canonicalizeCrewAssignment(crewPositions, value);
    if (originalOrder.length !== canonical.positions.length
        || canonical.positions.some((position, index) => originalOrder[index] !== position.positionId)) {
        throw new Error('crewAssignment.positions must use canonical entity-position order');
    }
    return canonical;
}

function canonicalCrewPositions(crewPositions: CrewTopology): readonly CrewPositionDefinition[] {
    return [...crewPositions.values()].sort((left, right) =>
        left.occurrence - right.occurrence || compareText(left.id, right.id));
}

function freezeAssignment(positions: readonly CrewAssignmentPosition[]): CrewAssignment {
    return Object.freeze({
        schemaVersion: CREW_ASSIGNMENT_SCHEMA_VERSION,
        positions: Object.freeze(positions.map(position => Object.freeze({ ...position }))),
    });
}

function requireExactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${path} must be a plain object`);
    }
    const record = value as Record<string, unknown>;
    const actual = Object.keys(record).sort(compareText);
    const expected = [...keys].sort(compareText);
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${path} must contain exactly: ${expected.join(', ')}`);
    }
    return record;
}

function boundedPositionId(value: unknown, path: string): CrewPositionId {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) {
        throw new Error(`${path} must be a bounded non-empty string`);
    }
    return value as CrewPositionId;
}

function boundedText(value: unknown, maximum: number, path: string): string {
    if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
        throw new Error(`${path} must be a string of at most ${maximum} characters`);
    }
    return value;
}

function boundedSkill(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < MIN_CREW_SKILL
        || (value as number) > MAX_CREW_SKILL) {
        throw new Error(`${path} must be an integer from ${MIN_CREW_SKILL} to ${MAX_CREW_SKILL}`);
    }
    return value as number;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
