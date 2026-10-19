// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { TestTankEntity } from '../models/entity/testing/test-entities';
import type { MotiveModes } from '../models/motiveModes.model';
import { createNonMekRuntimeForTest } from '../models/runtime/testing/unit-runtime-owner-fixture';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import {
    getTurnMovementIndicator,
    nonMekTurnMovementIndicator,
    type TurnMovementColor,
} from './turn-movement-indicator.util';

describe('getTurnMovementIndicator', () => {
    it('returns no badge before movement is assigned', () => {
        expect(getTurnMovementIndicator(null, 1)).toBeNull();
        expect(getTurnMovementIndicator(undefined, 1)).toBeNull();
    });

    it('shows movement mode and the complete defender modifier', () => {
        const cases: ReadonlyArray<readonly [MotiveModes, TurnMovementColor, string]> = [
            ['stationary', 'stationary', 'St'],
            ['walk', 'walk', 'W1'],
            ['run', 'run', 'R1'],
            ['sprint', 'sprint', 'S1'],
            ['jump', 'jump', 'J1'],
            ['UMU', 'jump', 'U1'],
            ['VTOL', 'jump', 'V1'],
        ];

        for (const [mode, color, letter] of cases) {
            expect(getTurnMovementIndicator(mode, 1)).withContext(mode).toEqual({ color, letter });
        }
        expect(getTurnMovementIndicator('walk', 0)).toEqual({ color: 'walk', letter: 'W0' });
        expect(getTurnMovementIndicator('sprint', -1)).toEqual({ color: 'sprint', letter: 'S-1' });
    });
});

describe('nonMekTurnMovementIndicator', () => {
    it('badges a vehicle movement with the defender modifier, as for a Mek', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'));
        entity.originalWalkMP.set(8);
        const runtime = createNonMekRuntimeForTest('unit:tank-movement-badge', {
            entity: entity.uuid(),
            ruleset: CORE_2026_RULESET,
            initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
        }, entity, CORE_2026_RULESET);
        const unit = () => ({
            entity, index: runtime.getIndex(), state: runtime.snapshot(), ruleset: CORE_2026_RULESET,
        }) as unknown as CBTUnitSnapshot;
        expect(nonMekTurnMovementIndicator(unit())).toBeNull();

        expect(runtime.dispatch({
            type: 'set-movement', movement: { mode: 'run', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        // Five hexes is the 5-6 bracket, +2.
        expect(nonMekTurnMovementIndicator(unit())).toEqual({ color: 'run', letter: 'R2' });
    });
});
