// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { wildcardToRegex } from './string.util';

describe('wildcardToRegex', () => {
    it('reuses active patterns and evicts old query history at the fixed bound', () => {
        const prefix = 'bounded-wildcard-spec';
        const first = wildcardToRegex(`${prefix}-0*`);
        let latest = first;
        for (let index = 1; index <= 256; index += 1) {
            latest = wildcardToRegex(`${prefix}-${index}*`);
        }

        expect(wildcardToRegex(`${prefix}-256*`)).toBe(latest);
        expect(wildcardToRegex(`${prefix}-0*`)).not.toBe(first);
    });
});
