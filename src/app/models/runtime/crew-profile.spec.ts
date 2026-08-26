// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asCrewPositionId } from '../entity/entity-identifiers';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import {
    createCrewProfileSnapshot,
    prepareCrewProfileReplacement,
} from './crew-profile';

describe('crew profile', () => {
    it('prepares a validated replacement without mutating the runtime', () => {
        const fixture = createDirectMekRuntimeFixture();
        const runtime = fixture.instance;
        const assignment = runtime.query().crewAssignment();
        const current = createCrewProfileSnapshot(assignment, 4);
        const positions = current.positions.map(position => ({
            ...position,
            name: 'New Pilot',
            gunnery: 3,
        }));

        const prepared = prepareCrewProfileReplacement(
            runtime.getIndex().crewPositions,
            assignment,
            runtime.revision(),
            4,
            { expectedRevision: 4, positions },
        );

        expect(prepared.accepted).toBeTrue();
        if (!prepared.accepted) return;
        expect(prepared.snapshot.revision).toBe(5);
        expect(prepared.snapshot.positions[0]).toEqual(jasmine.objectContaining({
            name: 'New Pilot',
            gunnery: 3,
        }));
        expect(Number(runtime.revision())).toBe(0);
        expect(runtime.query().crewAssignment().positions[0]?.name).not.toBe('New Pilot');
    });

    it('rejects stale and invalid replacements with the current snapshot', () => {
        const fixture = createDirectMekRuntimeFixture();
        const runtime = fixture.instance;
        const assignment = runtime.query().crewAssignment();
        const topology = runtime.getIndex().crewPositions;
        const current = createCrewProfileSnapshot(assignment, 2);

        expect(prepareCrewProfileReplacement(topology, assignment, runtime.revision(), 2, {
            expectedRevision: 1,
            positions: current.positions,
        })).toEqual(jasmine.objectContaining({
            accepted: false,
            reason: 'REVISION_CONFLICT',
            snapshot: current,
        }));

        expect(prepareCrewProfileReplacement(topology, assignment, runtime.revision(), 2, {
            expectedRevision: 2,
            positions: [{
                ...current.positions[0]!,
                positionId: asCrewPositionId('crew:unknown'),
            }],
        })).toEqual(jasmine.objectContaining({
            accepted: false,
            reason: 'INVALID_PROFILE',
            snapshot: current,
        }));
    });
});
