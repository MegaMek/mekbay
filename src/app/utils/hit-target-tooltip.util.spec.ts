import type { TooltipLine } from '../components/tooltip/tooltip.component';
import { orderHitTargetTooltipLines } from './hit-target-tooltip.util';

describe('orderHitTargetTooltipLines', () => {
    it('keeps regular and negative lines in insertion order within their groups', () => {
        const lines: TooltipLine[] = [
            { label: 'Damage A', negative: true },
            { label: 'Regular A' },
            { label: 'Damage B', negative: true },
            { label: 'Regular B', negative: false }
        ];

        expect(orderHitTargetTooltipLines(lines).map(line => line.label)).toEqual([
            'Regular A',
            'Regular B',
            'Damage A',
            'Damage B'
        ]);
    });

    it('places heat after all other negative lines', () => {
        const lines: TooltipLine[] = [
            { label: 'Heat - Fire Modifier', negative: true, kind: 'heat' },
            { label: 'Damage', negative: true },
            { label: 'Targeting Computer' }
        ];

        expect(orderHitTargetTooltipLines(lines).map(line => line.label)).toEqual([
            'Targeting Computer',
            'Damage',
            'Heat - Fire Modifier'
        ]);
    });

    it('does not mutate the input array or entries', () => {
        const regular: TooltipLine = { label: 'Regular' };
        const negative: TooltipLine = { label: 'Damage', negative: true };
        const lines = [negative, regular] as const;

        const ordered = orderHitTargetTooltipLines(lines);

        expect(lines).toEqual([negative, regular]);
        expect(ordered).toEqual([regular, negative]);
        expect(ordered[0]).toBe(regular);
        expect(ordered[1]).toBe(negative);
    });

    it('handles empty input', () => {
        expect(orderHitTargetTooltipLines([])).toEqual([]);
    });
});