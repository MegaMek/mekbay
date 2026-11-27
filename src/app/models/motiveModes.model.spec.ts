// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { BipedMekEntity } from './entity/entities/mek/biped-mek-entity';
import { createTestEquipmentRegistry } from './entity/testing/test-equipment-registry';
import {
    getMotiveModeLabel,
    getMotiveModesByUnit,
    motiveModeFactsForEntity,
} from './motiveModes.model';
import type { UnitSummary } from './unit-summary.model';

function createUnit(overrides: Partial<UnitSummary> = {}): UnitSummary {
    return {
        type: 'Mek',
        subtype: 'Biped',
        walk: 5,
        walk2: 0,
        run: 8,
        run2: 0,
        jump: 5,
        umu: 0,
        ...overrides,
    } as UnitSummary;
}

describe('motiveModes', () => {
    it('maps Aero movement to stationary and thrust modes', () => {
        const unit = createUnit({ type: 'Aero', subtype: 'Spheroid DropShip', moveType: 'Spheroid', jump: 5, umu: 2 });

        expect(getMotiveModesByUnit(unit, false)).toEqual(['stationary', 'walk', 'run']);
        expect(getMotiveModesByUnit(unit, true)).toEqual(['stationary', 'walk', 'run']);
        expect(getMotiveModeLabel('walk', unit)).toBe('Safe Thrust');
        expect(getMotiveModeLabel('run', unit)).toBe('Maximum Thrust');
    });

    it('omits stationary for airborne LAMs', () => {
        const unit = createUnit({ subtype: 'Land-Air BattleMek' });

        expect(getMotiveModesByUnit(unit, true)).not.toContain('stationary');
        expect(getMotiveModesByUnit(unit, true)).toContain('walk');
        expect(getMotiveModesByUnit(unit, true)).toContain('run');
        expect(getMotiveModesByUnit(unit, true)).not.toContain('sprint');
    });

    it('offers grounded Meks a Sprint mode with the entity walk-based maximum', () => {
        const unit = createUnit({ walk: 5, walk2: 6 });

        expect(getMotiveModesByUnit(unit, false)).toContain('sprint');
        expect(getMotiveModeLabel('sprint', unit)).toBe('Sprint');
    });

    it('keeps stationary for grounded LAMs and non-LAM airborne units', () => {
        expect(getMotiveModesByUnit(createUnit({ subtype: 'Land-Air BattleMek' }), false)).toContain('stationary');
        expect(getMotiveModesByUnit(createUnit({ moveType: 'VTOL' }), true)).toContain('stationary');
    });

    it('projects loaded movement facts directly from the Entity', () => {
        const entity = new BipedMekEntity(createTestEquipmentRegistry());
        entity.originalWalkMP.set(5);

        const facts = motiveModeFactsForEntity(entity);

        expect(facts.type).toBe('Mek');
        expect(facts.walk).toBe(5);
        expect(facts.jump).toBe(0);
        expect(getMotiveModesByUnit(facts)).toEqual([
            'stationary', 'walk', 'run', 'sprint',
        ]);
    });
});
