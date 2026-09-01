// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { directAutomationSubject } from './direct-automation-subject';

describe('directAutomationSubject', () => {
    it('matches the origin/next unit and pilot notification label', () => {
        const fixture = createDirectMekRuntimeFixture();
        const assignment = fixture.instance.query().crewAssignment();
        const snapshot = Object.freeze({
            instanceId: fixture.instance.id,
            entity: fixture.entity,
            index: fixture.index,
            uuid: fixture.identity,
            ruleset: fixture.instance.ruleset(),
            crewAssignment: Object.freeze({
                ...assignment,
                positions: Object.freeze(assignment.positions.map((position, index) => Object.freeze({
                    ...position,
                    name: index === 0 ? '  Morgan Kell  ' : position.name,
                }))),
            }),
            state: fixture.instance.snapshot(),
            query: fixture.instance.query(),
        }) satisfies CBTUnitSnapshot;

        expect(directAutomationSubject(snapshot))
            .toBe(`${fixture.entity.displayName()} (Morgan Kell)`);
    });
});
