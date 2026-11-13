// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTOptionalRules } from '../options.model';
import { BOUND_OPTIONAL_RULE_DEFAULTS, boundOptionalRulesFromOptions, readBoundOptionalRules } from './bound-optional-rules';

describe('bound optional rules', () => {
    it('binds only the listed rules from the options, and plays the defaults for those a scenario leaves out', () => {
        const options: CBTOptionalRules = {
            quirks: true, floatingCriticals: true, forcedWithdrawal: false, extremeRange: true, sprinting: true,
            hotLoadedAmmo: true, allowMixedTechBaseAmmo: true, enhancedFlamers: true,
        };
        expect(boundOptionalRulesFromOptions(options))
            .toEqual({ forcedWithdrawal: false, sprinting: true, hotLoadedAmmo: true });
        expect(boundOptionalRulesFromOptions({ sprinting: true }))
            .toEqual({ forcedWithdrawal: true, sprinting: true, hotLoadedAmmo: false });
        expect(readBoundOptionalRules(undefined)).toEqual({ kind: 'supported', rules: BOUND_OPTIONAL_RULE_DEFAULTS });
        expect(readBoundOptionalRules({ sprinting: true })).toEqual({
            kind: 'supported', rules: { forcedWithdrawal: true, sprinting: true, hotLoadedAmmo: false },
        });
    });

    it('fails closed on an unknown or malformed option', () => {
        const keys = (options: unknown) => {
            const result = readBoundOptionalRules(options);
            return result.kind === 'unsupported' ? result.problems.map(problem => problem.key) : [];
        };
        expect(keys({ enhancedFlamers: true, sprinting: 'yes' })).toEqual(['enhancedFlamers', 'sprinting']);
        expect(keys(['sprinting'])).toEqual(['<invalid-options>']);
    });
});
