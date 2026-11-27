// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { withServiceWorkerBypass } from './service-worker-bypass.util';

describe('withServiceWorkerBypass', () => {
    it('adds the Angular service-worker bypass to an absolute remote URL', () => {
        expect(withServiceWorkerBypass('https://assets.example.test/catalog.json'))
            .toBe('https://assets.example.test/catalog.json?ngsw-bypass=true');
    });

    it('appends the bypass after existing query parameters', () => {
        expect(withServiceWorkerBypass('https://assets.example.test/catalog.json?version=2'))
            .toBe('https://assets.example.test/catalog.json?version=2&ngsw-bypass=true');
    });

    it('leaves same-origin relative assets unchanged', () => {
        expect(withServiceWorkerBypass('assets/sourcebooks.json'))
            .toBe('assets/sourcebooks.json');
        expect(withServiceWorkerBypass('/assets/sourcebooks.json'))
            .toBe('/assets/sourcebooks.json');
    });
});
