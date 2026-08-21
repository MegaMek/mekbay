// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PrintAllOptions } from '../models/print-options.model';
import { ASSummaryPrintUtil } from './as-summary-print.util';

describe('ASSummaryPrintUtil', () => {
    it('prints the summary packet in landscape', () => {
        const styles = getPrintStyles('none');

        expect(styles).toContain('size: landscape');
    });

    it('builds a summary-only print container with its rules reference', async () => {
        const unit = {
            id: 'u1',
            manualPilotAbilities: () => [],
            formationAbilities: () => [],
            adjustedPv: () => 52,
            pilotSkill: () => 4,
            effectiveTmm: () => ({ '': 2 }),
            effectiveMovement: () => ({ '': 8 }),
            movementDisplayValue: (_mode: string, inches: number) => ({ baseInches: inches }),
            getUnit: () => ({
                chassis: 'Atlas',
                model: 'AS7-D',
                role: 'Juggernaut',
                as: {
                    TP: 'BM',
                    SZ: 4,
                    dmg: { dmgS: '4', dmgM: '4', dmgL: '2' },
                    Arm: 10,
                    Str: 4,
                    OV: 0,
                    specials: [],
                },
            }),
        };
        const group = {
            units: () => [unit],
            activeFormation: () => null,
        };
        const force = {
            name: 'Example Force',
            units: () => [unit],
            groups: () => [group],
            faction: () => ({ name: 'Federated Suns', group: 'Inner Sphere' }),
            era: () => ({ name: 'Succession Wars' }),
            instanceId: () => '',
            displayName: () => 'Example Force',
        };
        const abilityLookup = {
            parseAbility: (text: string) => ({ originalText: text, ability: null }),
        };

        await ASSummaryPrintUtil.print(
            force as never,
            abilityLookup as never,
            false,
            { printMargin: 'none' },
            false,
        );

        const overlay = document.getElementById('as-summary-print-container')!;
        expect(overlay.querySelector('.as-roster-summary')).not.toBeNull();
        expect(overlay.querySelector('.as-rules-reference')).not.toBeNull();
        expect(overlay.querySelector('.as-print-page')).toBeNull();
        expect(overlay.querySelector('.as-card-cell')).toBeNull();
        expect(overlay.querySelector('.print-roster-context')?.textContent)
            .toBe('Federated Suns · Inner Sphere · Succession Wars');
        expect(overlay.querySelector('.print-roster-name')?.textContent).toBe('Example Force');
        expect(overlay.querySelector('.print-roster-logo img')).not.toBeNull();

        window.dispatchEvent(new Event('click'));
    });
});

function getPrintStyles(printMargin: PrintAllOptions['printMargin']): string {
    return (ASSummaryPrintUtil as unknown as {
        getPrintStyles(printMargin: PrintAllOptions['printMargin']): string;
    }).getPrintStyles(printMargin);
}
