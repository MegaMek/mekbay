// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { TooltipLine } from '../components/tooltip/tooltip.component';
import { modifierTooltipLines, orderedModifierTooltipLines, orderHitTargetTooltipLines } from './hit-target-tooltip.util';

describe('orderHitTargetTooltipLines', () => {
    it('maps modifier entries with display metadata', () => {
        const lines = modifierTooltipLines([
            { label: 'Damage', modifier: 2, weakened: true },
            { label: 'Heat', modifier: 1, weakened: true, kind: 'heat' },
        ], entry => `+${entry.modifier}`);

        expect(lines).toEqual([
            { label: 'Damage', value: '+2', weakened: true },
            { label: 'Heat', value: '+1', weakened: true, kind: 'heat' },
        ]);
    });

    it('maps and orders modifier entries in one operation', () => {
        const lines = orderedModifierTooltipLines([
            { label: 'Damage', modifier: 2, weakened: true },
            { label: 'Bonus', modifier: -1 },
        ], entry => `${entry.modifier}`);

        expect(lines.map(line => line.label)).toEqual(['Bonus', 'Damage']);
    });

    it('applies priority before the regular, weakened, and heat groups', () => {
        const lines = orderedModifierTooltipLines([
            { label: 'Heat', modifier: 1, weakened: true, kind: 'heat' },
            { label: 'Movement', modifier: 2, priority: -1 },
            { label: 'Bonus', modifier: -1 },
        ], entry => `${entry.modifier}`);

        expect(lines.map(line => line.label)).toEqual(['Movement', 'Bonus', 'Heat']);
    });

    it('keeps regular and weakened lines in insertion order within their groups', () => {
        const lines: TooltipLine[] = [
            { label: 'Damage A', weakened: true },
            { label: 'Regular A' },
            { label: 'Damage B', weakened: true },
            { label: 'Regular B', weakened: false }
        ];

        expect(orderHitTargetTooltipLines(lines).map(line => line.label)).toEqual([
            'Regular A',
            'Regular B',
            'Damage A',
            'Damage B'
        ]);
    });

    it('places heat after all other weakened lines', () => {
        const lines: TooltipLine[] = [
            { label: 'Heat - Fire Modifier', weakened: true, kind: 'heat' },
            { label: 'Damage', weakened: true },
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
        const weakened: TooltipLine = { label: 'Damage', weakened: true };
        const lines = [weakened, regular] as const;

        const ordered = orderHitTargetTooltipLines(lines);

        expect(lines).toEqual([weakened, regular]);
        expect(ordered).toEqual([regular, weakened]);
        expect(ordered[0]).toBe(regular);
        expect(ordered[1]).toBe(weakened);
    });

    it('handles empty input', () => {
        expect(orderHitTargetTooltipLines([])).toEqual([]);
    });
});