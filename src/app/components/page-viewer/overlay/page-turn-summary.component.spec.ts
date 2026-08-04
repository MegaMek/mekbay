import { composeTurnSummaryHeatRows } from './page-turn-summary.component';

describe('composeTurnSummaryHeatRows', () => {
    it('keeps committed Weapons when no weapon is selected', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'weapons', label: 'Weapons', value: 20 }],
            { hasSelection: false, value: 0, entryIds: new Set() }
        )).toEqual([{ id: 'weapons', label: 'Weapons', value: 20 }]);
    });

    it('shows Selected Weapons when there is no committed Weapons heat', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'engine', label: 'Engine', value: 5 }],
            { hasSelection: true, value: 15, entryIds: new Set(['laser']) }
        )).toEqual([
            { id: 'selected-weapons', label: 'Selected Weapons', value: 15, selectedOnly: true },
            { id: 'engine', label: 'Engine', value: 5 },
        ]);
    });

    it('combines committed and selected Weapons as alternative values', () => {
        expect(composeTurnSummaryHeatRows(
            [
                { id: 'weapons', label: 'Weapons', value: 20 },
                { id: 'engine', label: 'Engine', value: 5 },
            ],
            { hasSelection: true, value: 15, entryIds: new Set(['laser']) }
        )).toEqual([
            { id: 'weapons', label: 'Weapons', value: 20, selectedValue: 15 },
            { id: 'engine', label: 'Engine', value: 5 },
        ]);
    });
});