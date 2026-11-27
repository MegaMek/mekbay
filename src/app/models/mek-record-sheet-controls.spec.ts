// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { mekUnitConditionControls } from './mek-record-sheet-controls';

describe('mekUnitConditionControls', () => {
    it('offers skidding under Total Warfare only: Core has no skidding', () => {
        const keys = (ruleset: 'total-warfare' | 'core-2026') => mekUnitConditionControls(ruleset).map(control => control.key);

        expect(keys('total-warfare')).toContain('skidding');
        expect(keys('core-2026')).not.toContain('skidding');
        expect(keys('core-2026')).toContain('prone');
    });
});
