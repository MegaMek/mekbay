// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('FrankenMek donor leg runtime modifiers', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`applies donor identity and mass penalties in ${ruleset}`, () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            fixture.entity.enableHybridStructure();
            fixture.entity.setStructureDonor('LL', { name: 'Donor A', unitType: 'BattleMek' });
            fixture.entity.setStructureDonor('RL', { name: 'Donor B', unitType: 'BattleMek' });
            const identity = fixture.createInstance('donor-identity').query().mekMovementPsr();
            expect(identity.kind).toBe('supported');
            if (identity.kind !== 'supported') return;
            expect(identity.permanentPsrModifiers).toContain({ modifier: 1, reason: 'Mismatched Legs from different Meks' });
            fixture.entity.setStructureAt('LL', fixture.entity.structureAt('LL').withTonnage(55));
            const mass = fixture.createInstance('donor-mass').query().mekMovementPsr();
            expect(mass.kind).toBe('supported');
            if (mass.kind !== 'supported') return;
            expect(mass.permanentPsrModifiers).toContain({ modifier: 2, reason: 'Mismatched Legs with different tonnages' });
            expect(mass.pilotingTargetNumber).toBe(identity.pilotingTargetNumber + 1);
        });
    }
});
