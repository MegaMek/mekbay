// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { jsonValuesEqual } from './json-value.util';

describe('jsonValuesEqual', () => {
    it('compares object fields independent of insertion order', () => {
        expect(jsonValuesEqual({ first: 1, nested: { left: true, right: false } }, {
            nested: { right: false, left: true },
            first: 1,
        })).toBeTrue();
    });

    it('keeps array order significant', () => {
        expect(jsonValuesEqual([1, 2], [2, 1])).toBeFalse();
    });
});
