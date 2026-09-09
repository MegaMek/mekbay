// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ASSummaryPrintUtil } from './as-summary-print.util';

describe('ASSummaryPrintUtil', () => {
    afterEach(() => window.dispatchEvent(new Event('afterprint')));

    it('builds a summary and rules reference with safe page margins', async () => {
        const unit = {
            id: 'u1',
            manualPilotAbilities: () => [],
            formationAbilities: () => [],
            adjustedPv: () => 52,
            pilotSkill: () => 4,
            effectiveTmm: () => ({ '': 2 }),
            effectiveMovement: () => ({ '': 8 }),
            movementDisplayValue: (_mode: string, inches: number) => ({ baseInches: inches }),
            getSummary: () => ({
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

        const rules = [...overlay.querySelector('style')!.sheet!.cssRules]
            .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === 'print')
            .flatMap(rule => [...rule.cssRules]);
        const defaultPage = rules.find((rule): rule is CSSPageRule =>
            rule instanceof CSSPageRule && rule.selectorText === '')!;
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(defaultPage.style.getPropertyValue(`margin-${side}`)).toBe('0.25in');
            expect(defaultPage.style.getPropertyPriority(`margin-${side}`)).toBe('important');
        }

        window.dispatchEvent(new Event('click'));
    });
});
