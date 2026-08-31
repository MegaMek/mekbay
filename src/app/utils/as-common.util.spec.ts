// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { isAerospace } from './as-common.util';

describe('isAerospace', () => {
    it('recognizes aerospace combat and large-craft types', () => {
        for (const type of ['AF', 'CF', 'DA', 'DS', 'SC', 'WS', 'SS', 'JS'] as const) {
            expect(isAerospace(type, {})).withContext(type).toBeTrue();
        }
    });

    it('recognizes only support vehicles with aerospace movement', () => {
        expect(isAerospace('SV', { a: 10 })).toBeTrue();
        expect(isAerospace('SV', { p: 10 })).toBeTrue();
        expect(isAerospace('SV', { k: 10 })).toBeTrue();
        expect(isAerospace('SV', { t: 10 })).toBeFalse();
        expect(isAerospace('CV', { a: 10 })).toBeFalse();
    });
});
