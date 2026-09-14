// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { recordSheetHeatScale } from './record-sheet-heat-scale';
import type { MekRecordSheetSnapshot } from './mek-record-sheet';
import type { MekHeatProjectionV2 } from './mek-heat-state-v2';
import type { ComponentId } from '../entity/entity-identifiers';

function snapshot(policy: 'manual' | 'automatic' = 'automatic') {
    const projection: MekHeatProjectionV2 = {
        current: 10, sources: [], committedSources: [], capacity: 10, underwaterBonus: 0,
        previouslyConsumedDissipation: 0, remainingDissipation: 10, generated: 0,
        dissipated: 10, projected: 0, delta: -10, hasPendingResolution: true, hasPendingSettlement: true,
    };
    return {
        heat: { current: 10, previous: 4, heatsinksOff: 0 }, heatPolicy: policy,
        heatProjection: { kind: 'supported', projection }, equipment: [],
    } satisfies Parameters<typeof recordSheetHeatScale>[0];
}

describe('recordSheetHeatScale', () => {
    it('shows current, previous and automatic cooling projection', () => {
        expect(recordSheetHeatScale(snapshot())).toEqual({
            current: 10, pending: undefined, previous: 4, projection: 0,
            selectedWeapons: undefined, automaticProjection: true,
        });
    });

    it('gives a pending override priority and hides a coincident previous marker', () => {
        const source = snapshot();
        expect(recordSheetHeatScale({ ...source, heat: { ...source.heat, pendingOverride: 4 } })).toEqual({
            current: 10, pending: 4, previous: undefined, projection: undefined,
            selectedWeapons: undefined, automaticProjection: false,
        });
    });

    it('keeps manual projected and selected weapon markers distinct without double counting heat', () => {
        const source = snapshot('manual');
        const id = 'weapon-a' as ComponentId;
        const scale = recordSheetHeatScale({
            ...source,
            heatProjection: { kind: 'supported', projection: {
                ...source.heatProjection.projection,
                sources: [{ id: 'movement', label: 'Movement', value: 2 },
                    { id: 'weapons', label: 'Weapons', value: 4 },
                    { id: 'mode', label: 'Mode', value: 3, replacedByFiringEntryId: id }],
                projected: 9,
            } },
            equipment: [{ componentId: id, status: 'available',
                weapon: { selectable: true, selection: 'selected', firingHeat: 8 },
            } as unknown as MekRecordSheetSnapshot['equipment'][number]],
        });
        expect(scale.projection).toBe(9);
        expect(scale.selectedWeapons).toBe(10);
        expect(scale.automaticProjection).toBeFalse();
    });

    it('retains overflow values and omits unavailable projections', () => {
        const source = snapshot();
        const scale = recordSheetHeatScale({ ...source, heat: { ...source.heat, current: 44, pendingOverride: 52 },
            heatProjection: { kind: 'unsupported', blockers: ['Unsupported heat source'] } });
        expect(scale.current).toBe(44);
        expect(scale.pending).toBe(52);
        expect(scale.projection).toBeUndefined();
        expect(scale.automaticProjection).toBeFalse();
    });
});
