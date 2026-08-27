// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { CriticalSlot } from '../models/force-serialization';
import { AeroRules } from '../models/rules/aero-rules';
import { MekRules } from '../models/rules/mek-rules';
import { getHeatEffectDescriptors, getPreferredHeatAmmoExplosionCandidates } from './heat-effects.util';

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
        critSlots?: CriticalSlot[];
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
            getCritSlots: () => options.critSlots ?? [],
            isInternalLocDestroyed: () => false,
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
                result: { kind: 'automatic', outcome: 'failed' },
            }),
        ]);
    });

    it('automatically fails every shutdown Avoid check without a conscious pilot', () => {
        for (const heat of [14, 18, 22, 26]) {
            const [shutdown] = getHeatEffectDescriptors(createUnit({ activePilotCrewId: null }), heat);
            expect(shutdown).withContext(`heat ${heat}`).toEqual(jasmine.objectContaining({
                kind: 'heat-shutdown',
                result: { kind: 'automatic', outcome: 'failed' },
            }));
            expect(shutdown.target).withContext(`heat ${heat}`).toBeUndefined();
        }
    });

    it('uses a separate recovery roll for a conscious shutdown unit', () => {
        expect(getHeatEffectDescriptors(createUnit({ shutdown: true }), 29)).toEqual([
            jasmine.objectContaining({ kind: 'shutdown-recovery', target: 10 }),
        ]);
        expect(getHeatEffectDescriptors(createUnit({ shutdown: true }), 30)).toEqual([]);
    });

    it('does not offer a restart roll above heat 13 without a conscious pilot', () => {
        expect(getHeatEffectDescriptors(createUnit({
            shutdown: true,
            activePilotCrewId: null,
        }), 26)).toEqual([]);
    });

    it('automatically restarts below heat 14 even without a conscious pilot', () => {
        expect(getHeatEffectDescriptors(createUnit({
            shutdown: true,
            activePilotCrewId: null,
        }), 13)).toEqual([
            jasmine.objectContaining({
                kind: 'shutdown-recovery',
                result: { kind: 'automatic', outcome: 'success' },
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

    it('keeps independent automatic recovery effects together', () => {
        expect(getHeatEffectDescriptors(createUnit({
            type: 'Aero',
            shutdown: true,
            heatControlRecovery: true,
        }), 4)).toEqual([
            jasmine.objectContaining({
                kind: 'shutdown-recovery',
                result: { kind: 'automatic', outcome: 'success' },
            }),
            jasmine.objectContaining({
                kind: 'heat-random-movement',
                result: { kind: 'automatic', outcome: 'success' },
            }),
        ]);
    });

    it('selects heat-explosion ammo by damage per shot, then remaining shots, preserving exact ties', () => {
        const critSlots = [
            ammoSlot('srm-many', 'SRM 6 Ammo', 6, 2, 100),
            ammoSlot('lrm-fewer', 'LRM 15 Ammo', 15, 1, 4),
            ammoSlot('lrm-tied-a', 'LRM 15 Ammo A', 15, 1, 8),
            ammoSlot('lrm-tied-b', 'LRM 15 Ammo B', 15, 1, 8),
        ];

        expect(getPreferredHeatAmmoExplosionCandidates(createUnit({ critSlots })).map(candidate => candidate.id))
            .toEqual(['lrm-tied-a', 'lrm-tied-b']);
    });

    it('does not clear random movement from a non-heat source when heat drops below 5', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero', randomMovement: true }), 4)).toEqual([]);
    });

    it('does not mistake an unrelated out-of-control condition for random movement', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero', outOfControl: true }), 4)).toEqual([]);
    });

    it('ends a persisted heat-control recovery when heat drops below 5', () => {
        expect(getHeatEffectDescriptors(createUnit({ type: 'Aero', heatControlRecovery: true }), 4)).toEqual([
            jasmine.objectContaining({
                kind: 'heat-random-movement',
                result: { kind: 'automatic', outcome: 'success' },
            }),
        ]);
    });

    it('captures deterministic Life Support damage in the generated effect', () => {
        expect(getHeatEffectDescriptors(createUnit({ lifeSupportHits: 2 }), 20)).toContain(
            jasmine.objectContaining({
                kind: 'heat-life-support',
                result: { kind: 'automatic', outcome: 'failed' },
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
                result: { kind: 'automatic', outcome: 'failed' },
                hits: 1,
            }),
        ]);
    });

    function ammoSlot(
        id: string,
        name: string,
        rackSize: number,
        damagePerShot: number,
        shots: number,
    ): CriticalSlot {
        const ammo = new AmmoEquipment({
            id,
            name,
            type: 'ammo',
            stats: { explosive: true },
            ammo: { type: 'LRM', rackSize, damagePerShot, shots },
        });
        return {
            id,
            name,
            loc: 'LT',
            slot: 0,
            totalAmmo: shots,
            consumed: 0,
            eq: ammo,
        };
    }
});
