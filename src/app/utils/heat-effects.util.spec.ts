// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { AeroRules } from '../models/rules/aero-rules';
import { MekRules } from '../models/rules/mek-rules';
import { getHeatEffectDescriptors } from './heat-effects.util';

describe('heat effects', () => {
    function createUnit(options: {
        type?: 'Mek' | 'Aero';
        shutdown?: boolean;
        randomMovement?: boolean;
        outOfControl?: boolean;
        heatControlRecovery?: boolean;
        pilotState?: string;
        activePilotCrewId?: number | null;
        lifeSupportDamaged?: boolean;
        lifeSupportHits?: number;
        drowningHits?: number;
    } = {}): CBTForceUnit {
        const type = options.type ?? 'Mek';
        const lifeSupportDamaged = options.lifeSupportDamaged ?? (options.lifeSupportHits ?? 0) > 0;
        return {
            rules: {
                heatScale: type === 'Aero' ? AeroRules.HEAT_SCALE : MekRules.HEAT_SCALE,
                hasDamagedLifeSupport: () => lifeSupportDamaged,
                heatLifeSupportPilotHits: () => lifeSupportDamaged ? options.lifeSupportHits ?? 0 : 0,
                submergedLifeSupportPilotHits: () => options.drowningHits ?? 0,
                getActivePilotCrewId: () => options.activePilotCrewId !== undefined
                    ? options.activePilotCrewId
                    : options.pilotState === 'unconscious' ? null : 0,
            },
            getCrewMember: () => ({ getState: () => options.pilotState ?? 'healthy' }),
            getCondition: (condition: string) => condition === 'shutdown'
                ? options.shutdown ?? false
                : condition === 'random-movement'
                    ? options.randomMovement ?? false
                    : condition === 'out-of-control' ? options.outOfControl ?? false : false,
            turnState: () => ({
                getPendingUnitChecks: () => options.heatControlRecovery
                    ? [{ kind: 'aero-control-recovery', cause: 'heat-random-movement' }]
                    : [],
            }),
            getUnit: () => ({ type }),
            getCritSlots: () => [],
            getInventory: () => [],
        } as unknown as CBTForceUnit;
    }

    it('does not turn movement or fire modifiers into queued checks', () => {
        expect(getHeatEffectDescriptors(createUnit(), 13)).toEqual([]);
    });

    it('uses only the highest applicable Mek shutdown threshold', () => {
        expect(getHeatEffectDescriptors(createUnit(), 26)).toEqual([
            jasmine.objectContaining({ kind: 'heat-shutdown', target: 10 }),
        ]);
    });

    it('represents heat-30 shutdown as an automatic failure', () => {
        expect(getHeatEffectDescriptors(createUnit(), 30)).toEqual([
            jasmine.objectContaining({
                kind: 'heat-shutdown',
                automaticOutcome: 'failed',
            }),
        ]);
    });

    it('allows a heat shutdown roll when an alternate crew member is piloting', () => {
        expect(getHeatEffectDescriptors(createUnit({
            pilotState: 'unconscious',
            activePilotCrewId: 2,
        }), 18)).toEqual([
            jasmine.objectContaining({ kind: 'heat-shutdown', target: 6 }),
        ]);
    });

    it('uses the independent aerospace random-movement and pilot-damage thresholds', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero' }), 27)).toEqual([
            jasmine.objectContaining({ kind: 'heat-shutdown', target: 10 }),
            jasmine.objectContaining({ kind: 'heat-random-movement', target: 10 }),
            jasmine.objectContaining({ kind: 'heat-pilot-damage', target: 9, hits: 1 }),
        ]);
    });

    it('automatically clears heat shutdown and heat-sourced random movement below their lowest thresholds', () => {
        expect(getHeatEffectDescriptors(createUnit({
            type: 'Aero',
            shutdown: true,
            heatControlRecovery: true,
        }), 4)).toEqual([
            jasmine.objectContaining({ kind: 'heat-shutdown', automaticOutcome: 'success' }),
            jasmine.objectContaining({ kind: 'heat-random-movement', automaticOutcome: 'success' }),
        ]);
    });

    it('does not clear random movement from a non-heat source when heat drops below 5', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero', randomMovement: true }), 4)).toEqual([]);
    });

    it('does not mistake an unrelated out-of-control condition for random movement', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero', outOfControl: true }), 4)).toEqual([]);
    });

    it('ends a persisted heat-control recovery when heat drops below 5', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero', heatControlRecovery: true }), 4)).toEqual([
            jasmine.objectContaining({ kind: 'heat-random-movement', automaticOutcome: 'success' }),
        ]);
    });

    it('captures deterministic Life Support damage in the generated effect', () => {
        expect(getHeatEffectDescriptors(createUnit({ lifeSupportHits: 2 }), 20)).toContain(
            jasmine.objectContaining({
                kind: 'heat-life-support',
                automaticOutcome: 'failed',
                hits: 2,
            }),
        );
    });

    it('does not apply potential Life Support heat hits while Life Support is operational', () => {
        expect(getHeatEffectDescriptors(createUnit({
            lifeSupportDamaged: false,
            lifeSupportHits: 2,
        }), 20).some(effect => effect.kind === 'heat-life-support')).toBeFalse();
    });

    it('keeps submerged Life Support damage as its own deterministic End Phase effect', () => {
        expect(getHeatEffectDescriptors(createUnit({ drowningHits: 1 }), 0)).toEqual([
            jasmine.objectContaining({
                kind: 'life-support-drowning',
                automaticOutcome: 'failed',
                hits: 1,
            }),
        ]);
    });
});
