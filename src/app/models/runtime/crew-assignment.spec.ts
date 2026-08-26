// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asCrewPositionId } from '../entity/entity-identifiers';
import {
    MAX_CREW_NAME_LENGTH,
    assertCanonicalCrewAssignment,
    canonicalizeCrewAssignment,
    createDefaultCrewAssignment,
    type CrewTopology,
} from './crew-assignment';

describe('CrewAssignment', () => {
    it('canonicalizes an exhaustive multi-position crew and freezes the result', () => {
        const source = topology(3);
        const assignment = canonicalizeCrewAssignment(source, assignmentFor([2, 0, 1]));

        expect(assignment.positions.map(position => position.positionId))
            .toEqual([
                asCrewPositionId('crew:0'),
                asCrewPositionId('crew:1'),
                asCrewPositionId('crew:2'),
            ]);
        expect(assignment.positions.map(position => position.name)).toEqual(['Crew 0', 'Crew 1', 'Crew 2']);
        expect(Object.isFrozen(assignment)).toBeTrue();
        expect(Object.isFrozen(assignment.positions)).toBeTrue();
        expect(Object.isFrozen(assignment.positions[0])).toBeTrue();
        expect(() => assertCanonicalCrewAssignment(source, assignmentFor([2, 0, 1])))
            .toThrowError(/canonical entity-position order/u);
        expect(assertCanonicalCrewAssignment(source, assignment)).toEqual(assignment);
    });

    it('rejects duplicate, missing, and unknown crew positions', () => {
        const source = topology(2);
        expect(() => canonicalizeCrewAssignment(source, assignmentFor([0, 0])))
            .toThrowError(/duplicated/u);
        expect(() => canonicalizeCrewAssignment(source, assignmentFor([0])))
            .toThrowError(/must exhaust/u);
        expect(() => canonicalizeCrewAssignment(source, assignmentFor([0, 2])))
            .toThrowError(/not in the entity crew topology/u);
    });

    it('bounds names, roles, skills, and object shape', () => {
        const source = topology(1);
        const longName = assignmentFor([0]);
        longName.positions[0].name = 'x'.repeat(MAX_CREW_NAME_LENGTH + 1);
        expect(() => canonicalizeCrewAssignment(source, longName)).toThrowError(/at most/u);

        const lowSkill = assignmentFor([0]);
        lowSkill.positions[0].gunnery = -1;
        expect(() => canonicalizeCrewAssignment(source, lowSkill)).toThrowError(/integer from 0 to 8/u);

        const fractional = assignmentFor([0]);
        fractional.positions[0].piloting = 3.5;
        expect(() => canonicalizeCrewAssignment(source, fractional)).toThrowError(/integer from 0 to 8/u);

        const future = assignmentFor([0]) as unknown as { positions: Record<string, unknown>[] };
        future.positions[0]['future'] = true;
        expect(() => canonicalizeCrewAssignment(source, future)).toThrowError(/must contain exactly/u);
    });

    it('fails closed when a profile crosses crew-topology drift in either direction', () => {
        const standard = topology(1);
        const commandConsole = topology(2);
        const standardAssignment = canonicalizeCrewAssignment(standard, assignmentFor([0]));
        const commandAssignment = canonicalizeCrewAssignment(commandConsole, assignmentFor([0, 1]));

        expect(() => canonicalizeCrewAssignment(commandConsole, standardAssignment))
            .toThrowError(/must exhaust/u);
        expect(() => canonicalizeCrewAssignment(standard, commandAssignment))
            .toThrowError(/not in the entity crew topology/u);
    });

    it('creates the neutral assignment directly from the entity topology', () => {
        const source = topology(2);
        expect(createDefaultCrewAssignment(source).positions.map(position => [position.gunnery, position.piloting]))
            .toEqual([[4, 5], [4, 5]]);
    });
});

function topology(count: number): CrewTopology {
    const positions = Array.from({ length: count }, (_, occurrence) => {
        const id = asCrewPositionId(`crew:${occurrence}`);
        return [id, Object.freeze({ id, occurrence })] as const;
    });
    return new Map(positions);
}

function assignmentFor(order: readonly number[]): {
    schemaVersion: 1;
    positions: Array<{
        positionId: ReturnType<typeof asCrewPositionId>;
        name: string;
        role: string;
        gunnery: number;
        piloting: number;
    }>;
} {
    return {
        schemaVersion: 1,
        positions: order.map(occurrence => ({
            positionId: asCrewPositionId(`crew:${occurrence}`),
            name: `Crew ${occurrence}`,
            role: `role:${occurrence}`,
            gunnery: 4,
            piloting: 5,
        })),
    };
}
