// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from '../entity/entity-identifiers';
import {
    compileMekHeatProfile,
    evaluateMekHeatScenarioSupport,
    type MekHeatProfile,
} from './mek-heat-profile';
import {
    projectMekMovementHeatV2,
    type MekMovementHeatFactsV2,
} from './mek-heat-state-v2';
import { asCommandId } from './runtime-state';
import {
    createDirectEngineHeatRuntimeFixture,
    createDirectMekRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

const NO_COMPONENTS = new Set<ReturnType<typeof asComponentId>>();
const NO_CRITICALS = new Set<never>();

function heatProfile(fixture: DirectMekRuntimeFixture): MekHeatProfile {
    const result = compileMekHeatProfile(fixture.entity, fixture.index, 'core-2026');
    expect(result.kind).toBe('supported');
    if (result.kind !== 'supported') throw new Error(JSON.stringify(result.blockers));
    return result.profile;
}

function movementHeat(
    profile: MekHeatProfile,
    mode: NonNullable<MekMovementHeatFactsV2['movement']>['mode'],
    distance = mode === 'stationary' ? 0 : 1,
    options: Partial<Pick<MekMovementHeatFactsV2,
        'airborne' | 'committedUnavailableComponents' | 'committedUnavailableCriticalSlots'>> = {},
): number {
    return projectMekMovementHeatV2(profile, {
        movement: { mode, distance },
        standAttempts: 0,
        airborne: options.airborne ?? false,
        committedUnavailableComponents: options.committedUnavailableComponents ?? NO_COMPONENTS,
        committedUnavailableCriticalSlots: options.committedUnavailableCriticalSlots ?? NO_CRITICALS,
    });
}

function damageOneEngineCritical(fixture: DirectMekRuntimeFixture): void {
    const engine = [...fixture.index.components.entries()].find(([, component]) =>
        component.kind === 'system' && component.systemType === 'Engine');
    if (!engine) throw new Error('Fixture has no Engine system');
    const slot = [...fixture.index.slots.values()].find(candidate =>
        candidate.componentIds.includes(engine[0]));
    if (!slot) throw new Error('Fixture Engine has no critical slot');
    const result = fixture.instance.dispatch({
        type: 'hit-critical',
        commandId: asCommandId(`heat-engine:${fixture.instance.id}`),
        expectedRevision: fixture.instance.query().stateRevision,
        slotId: slot.id,
        hits: 1,
        target: 'committed',
    });
    expect(result.accepted).toBeTrue();
}

function damagedEngineHeat(fixture: DirectMekRuntimeFixture): number | undefined {
    const result = fixture.instance.query().heatProjection('manual');
    expect(result.kind).toBe('supported');
    if (result.kind !== 'supported') return undefined;
    return result.projection.committedSources.find(source => source.id === 'damaged-engine')?.value;
}

describe('origin/next Mek movement and engine heat parity', () => {
    it('keeps heat supported when force-wide mechanics options are synchronized', () => {
        expect(evaluateMekHeatScenarioSupport({
            id: 'megamek',
            options: { forcedWithdrawal: true, sprinting: true },
        })).toEqual({ kind: 'supported' });
    });

    it('still fails closed for malformed or unknown heat scenario options', () => {
        const malformed = evaluateMekHeatScenarioSupport({
            id: 'megamek',
            options: { sprinting: 'yes' },
        });
        const unknown = evaluateMekHeatScenarioSupport({
            id: 'megamek',
            options: { doubleHeat: true },
        });

        expect(malformed.kind).toBe('unsupported');
        expect(unknown.kind).toBe('unsupported');
    });

    it('derives ordinary and Industrial ground heat from the Entity engine descriptor', () => {
        const iceIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'ICE', true, 'core-2026', 'unit:heat:industrial-ice',
        ));
        const fuelIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'Fuel Cell', true, 'core-2026', 'unit:heat:industrial-fuel',
        ));
        const fusionIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'Fusion', true, 'core-2026', 'unit:heat:industrial-fusion',
        ));
        const xxlIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'XXL', true, 'core-2026', 'unit:heat:industrial-xxl',
        ));
        const ordinaryIce = heatProfile(createDirectEngineHeatRuntimeFixture(
            'ICE', false, 'core-2026', 'unit:heat:ordinary-ice',
        ));

        expect([movementHeat(iceIndustrial, 'walk'), movementHeat(iceIndustrial, 'run')])
            .toEqual([0, 0]);
        expect([movementHeat(fuelIndustrial, 'walk'), movementHeat(fuelIndustrial, 'run')])
            .toEqual([0, 0]);
        expect([movementHeat(fusionIndustrial, 'walk'), movementHeat(fusionIndustrial, 'run')])
            .toEqual([1, 2]);
        expect([movementHeat(xxlIndustrial, 'walk'), movementHeat(xxlIndustrial, 'run')])
            .toEqual([4, 6]);
        expect([movementHeat(ordinaryIce, 'walk'), movementHeat(ordinaryIce, 'run')])
            .toEqual([1, 2]);
    });

    it('adds one UMU heat and doubles it only for an XXL engine', () => {
        const fusion = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:umu-fusion',
        ));
        const xxl = heatProfile(createDirectEngineHeatRuntimeFixture(
            'XXL', false, 'core-2026', 'unit:heat:umu-xxl',
        ));

        expect(movementHeat(fusion, 'UMU')).toBe(1);
        expect(movementHeat(xxl, 'UMU')).toBe(2);
    });

    it('uses one-third rounded jump heat for airborne AirMek ground modes', () => {
        const base = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:airmek-base',
        ));
        const airMek = Object.freeze({ ...base, landAirMek: true });

        expect([1, 4, 5].map(distance => movementHeat(
            airMek, 'run', distance, { airborne: true },
        ))).toEqual([1, 1, 2]);
        expect(movementHeat(airMek, 'run', 5)).toBe(2);
    });

    it('uses a working jump booster only when no conventional jet is available', () => {
        const base = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:jump-system-base',
        ));
        const boosterId = asComponentId('component:test-jump-booster');
        const jetId = asComponentId('component:test-jump-jet');
        const boosterOnly = Object.freeze({
            ...base,
            jump: Object.freeze({
                ...base.jump,
                kind: 'none' as const,
                componentIds: Object.freeze([]),
                boosterComponentIds: Object.freeze([boosterId]),
            }),
        });
        const dual = Object.freeze({
            ...boosterOnly,
            jump: Object.freeze({
                ...boosterOnly.jump,
                kind: 'standard' as const,
                componentIds: Object.freeze([jetId]),
            }),
        });

        expect(movementHeat(boosterOnly, 'jump', 5)).toBe(0);
        expect(movementHeat(dual, 'jump', 5)).toBe(5);
        expect(movementHeat(dual, 'jump', 5, {
            committedUnavailableComponents: new Set([jetId]),
        })).toBe(0);
    });

    it('generates damaged-engine heat only for fusion-family Entity engines', () => {
        const fusion = createDirectEngineHeatRuntimeFixture(
            'Fusion', false, 'core-2026', 'unit:heat:engine-fusion',
        );
        const ice = createDirectEngineHeatRuntimeFixture(
            'ICE', true, 'core-2026', 'unit:heat:engine-ice',
        );

        damageOneEngineCritical(fusion);
        damageOneEngineCritical(ice);

        expect(damagedEngineHeat(fusion)).toBe(5);
        expect(damagedEngineHeat(ice)).toBeUndefined();
    });
});
