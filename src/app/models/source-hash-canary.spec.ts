// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asSourceHashCanary,
    sourceHashCanary,
    sourceHashCanaryChanged,
} from './source-hash-canary';

describe('source hash canary', () => {
    it('uses four leading base64url characters', () => {
        expect(sourceHashCanary('k8zQ01234567890123456789012')).toBe(asSourceHashCanary('k8zQ'));
    });

    it('reports only an actual canary mismatch', () => {
        expect(sourceHashCanaryChanged(
            asSourceHashCanary('k8zQ'),
            'k8zQchanged-but-same-canary',
        )).toBeFalse();
        expect(sourceHashCanaryChanged(
            asSourceHashCanary('k8zQ'),
            'AbCdchanged-source',
        )).toBeTrue();
        expect(sourceHashCanaryChanged(undefined, 'AbCdchanged-source')).toBeFalse();
    });
});
