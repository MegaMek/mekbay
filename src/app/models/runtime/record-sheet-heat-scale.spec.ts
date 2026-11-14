// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { recordSheetHeatScale } from './record-sheet-heat-scale';
import type { MekRecordSheetSnapshot } from './mek-record-sheet';
import type { MekHeatProjectionV2 } from './mek-heat-state-v2';
import type { ComponentId } from '../entity/entity-identifiers';
import { PRISTINE_TURN_HEAT_LEDGER } from './turn-heat-ledger';

function snapshot(policy: 'manual' | 'automatic' = 'automatic') {
    const projection: MekHeatProjectionV2 = {
        current: 10, sources: [], committedSources: [], capacity: 10, underwaterBonus: 0,
        ledger: PRISTINE_TURN_HEAT_LEDGER, dissipationBalance: 10, remainingDissipation: 10, generated: 0,
        dissipated: 10, projected: 0, delta: -10, hasPendingResolution: true, hasPendingSettlement: true,
    };
    return {
        heat: { current: 10, previous: 4, heatsinksOff: 0 }, endTurnCalculatesHeat: policy === 'automatic',
        heatProjection: { kind: 'supported', projection }, equipment: [],
    } satisfies Parameters<typeof recordSheetHeatScale>[0];
}

describe('recordSheetHeatScale', () => {
    it('ends the bar on the calculated heat when End Turn calculates it', () => {
        expect(recordSheetHeatScale(snapshot())).toEqual({
            current: 10, pending: undefined, previous: 4, projection: 0,
            selectedWeapons: undefined, outcome: 0,
        });
    });

    it('ends the bar on NEXT, keeps the calculated projection beside it, and hides a coincident previous', () => {
        const source = snapshot();
        expect(recordSheetHeatScale({ ...source, heat: { ...source.heat, pendingOverride: 4 } })).toEqual({
            current: 10, pending: 4, previous: undefined, projection: 0,
            selectedWeapons: undefined, outcome: 4,
        });
    });

    it('draws no bar with heat resolution off until NEXT is set', () => {
        const source = { ...snapshot('manual'), endTurnCalculatesHeat: false };
        expect(recordSheetHeatScale(source).outcome).toBeUndefined();
        expect(recordSheetHeatScale(source).projection).toBe(0);
        expect(recordSheetHeatScale({ ...source, heat: { ...source.heat, pendingOverride: 6 } }).outcome).toBe(6);
    });

    it('ends the bar on the calculated heat under Ask as under Yes', () => {
        // Ask resolves heat through a review, so its End Turn policy is manual; End Turn still applies the calculation.
        expect(recordSheetHeatScale({ ...snapshot('manual'), endTurnCalculatesHeat: true }).outcome).toBe(0);
    });

    it('keeps manual projected and selected weapon markers distinct without double counting heat', () => {
        const source = snapshot('manual');
        const id = 'weapon-a' as ComponentId;
        const sources = [{ id: 'movement', label: 'Movement', value: 2 },
            { id: 'weapons', label: 'Weapons', value: 4 },
            { id: 'mode', label: 'Mode', value: 3, replacedByFiringEntryId: id }];
        const scale = recordSheetHeatScale({
            ...source,
            heatProjection: { kind: 'supported', projection: {
                ...source.heatProjection.projection,
                sources,
                committedSources: sources,
                projected: 9,
            } },
            equipment: [{ componentId: id, status: 'available',
                weapon: { selectable: true, selection: 'selected', firingHeat: 8 },
            } as unknown as MekRecordSheetSnapshot['equipment'][number]],
        });
        expect(scale.projection).toBe(9);
        // The selected weapon's 8 adds to the 4 already fired and takes over the mode it replaces: 10 + 2 + 12 - 10.
        expect(scale.selectedWeapons).toBe(14);
        expect(scale.outcome).toBeUndefined();
        // The selection marker does not depend on how End Turn resolves heat.
        expect(recordSheetHeatScale({ ...snapshot('automatic'), heatProjection: { kind: 'supported', projection: {
            ...source.heatProjection.projection, sources, committedSources: sources, projected: 9 } },
        equipment: [{ componentId: id, status: 'available',
            weapon: { selectable: true, selection: 'selected', firingHeat: 8 },
        } as unknown as MekRecordSheetSnapshot['equipment'][number]] }).selectedWeapons).toBe(14);
    });

    it('adds the selected weapons to the weapons already fired, as FIRED fires what is selected again', () => {
        const source = snapshot('manual');
        const id = 'laser' as ComponentId;
        // The laser fired for 6 heat and is still selected.
        const weapons = [{ id: 'weapons', label: 'Weapons', value: 6 }];
        const scale = recordSheetHeatScale({
            ...source,
            heat: { current: 0, previous: 0, heatsinksOff: 0 },
            heatProjection: { kind: 'supported', projection: {
                ...source.heatProjection.projection, current: 0, sources: weapons, committedSources: weapons,
                capacity: 2, projected: 4,
            } },
            equipment: [{ componentId: id, status: 'available',
                weapon: { selectable: true, selection: 'selected', firingHeat: 6 },
            } as unknown as MekRecordSheetSnapshot['equipment'][number]],
        });
        expect(scale.selectedWeapons).toBe(10);
        // A weapon fired and since jammed is no longer selected, but its heat is still the turn's.
        const fewer = recordSheetHeatScale({
            ...source,
            heat: { current: 0, previous: 0, heatsinksOff: 0 },
            heatProjection: { kind: 'supported', projection: {
                ...source.heatProjection.projection, current: 0, sources: [{ id: 'weapons', label: 'Weapons', value: 9 }],
                committedSources: [{ id: 'weapons', label: 'Weapons', value: 9 }], capacity: 2, projected: 7,
            } },
            equipment: [{ componentId: id, status: 'available',
                weapon: { selectable: true, selection: 'selected', firingHeat: 6 },
            } as unknown as MekRecordSheetSnapshot['equipment'][number]],
        });
        expect(fewer.selectedWeapons).toBe(13);
    });

    it('shows how far a following NEXT stands from the calculated heat, and nothing when it sits on it', () => {
        const source = snapshot();
        // The stored heat holds NEXT where it stands (`followCalculatedHeat`).
        const scale = (projected: number, next: number, pendingOffset: number) => recordSheetHeatScale({
            ...source,
            heat: { ...source.heat, pendingOverride: next, pendingOffset },
            heatProjection: { kind: 'supported', projection: { ...source.heatProjection.projection, projected } },
        });
        expect(scale(5, 8, 3).adjustment).toBe(3);
        expect(scale(5, 3, -2).adjustment).toBe(-2);
        expect(scale(5, 5, 0).adjustment).toBeUndefined();
        // NEXT held at 0 shows the adjustment it makes, not the offset it was set with.
        expect(scale(2, 0, -5).adjustment).toBe(-2);
        // A selected weapon's coolant heat moves the projection, not the offset NEXT keeps from the saved facts.
        expect(scale(6, 8, 3).adjustment).toBe(3);
    });

    it('previews selected weapons after APPLY HEAT without cooling the settled heat again', () => {
        const source = snapshot('manual');
        const id = 'laser' as ComponentId;
        // A 3-heat laser and an arrow of 5 were applied against 10 sinks, booking 3 of them.
        const weapons = [{ id: 'weapons', label: 'Weapons', value: 3 }];
        const scale = recordSheetHeatScale({
            ...source,
            heat: { current: 5, previous: 0, heatsinksOff: 0 },
            heatProjection: { kind: 'supported', projection: {
                ...source.heatProjection.projection,
                current: 5, sources: [], committedSources: weapons, projected: 5,
                ledger: { settledHeat: new Map([['weapons', 3]]), heatDissipationConsumed: 3 },
            } },
            equipment: [{ componentId: id, status: 'available',
                weapon: { selectable: true, selection: 'selected', firingHeat: 6 },
            } as unknown as MekRecordSheetSnapshot['equipment'][number]],
        });
        // Firing 6 more adds 6, which the 7 sinks left cool: the heat stays 5.
        expect(scale.selectedWeapons).toBe(5);
    });

    it('retains overflow values and omits unavailable projections', () => {
        const source = snapshot();
        const scale = recordSheetHeatScale({ ...source, heat: { ...source.heat, current: 44, pendingOverride: 52 },
            heatProjection: { kind: 'unsupported', blockers: ['Unsupported heat source'] } });
        expect(scale.current).toBe(44);
        expect(scale.pending).toBe(52);
        expect(scale.projection).toBeUndefined();
        expect(scale.outcome).toBe(52);
    });
});
