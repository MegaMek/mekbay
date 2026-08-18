// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { mountPrintOverlay, printInOverlay, waitForPrintImages } from './print-overlay.util';

describe('print overlay utilities', () => {
    afterEach(() => {
        window.dispatchEvent(new Event('click'));
        document.getElementById('test-print-overlay')?.remove();
        document.body.classList.remove('test-print-active');
    });

    it('removes print-only state when the browser finishes printing', async () => {
        await printInOverlay({
            containerId: 'test-print-overlay',
            bodyClass: 'test-print-active',
            content: '<main>Printable content</main>',
            styles: '',
            triggerPrint: false,
        });

        expect(document.getElementById('test-print-overlay')).not.toBeNull();
        expect(document.body.classList).toContain('test-print-active');

        window.dispatchEvent(new Event('afterprint'));

        expect(document.getElementById('test-print-overlay')).toBeNull();
        expect(document.body.classList).not.toContain('test-print-active');
    });

    it('cleans up the overlay when mounted content cannot be prepared', async () => {
        const overlay = document.createElement('div');
        overlay.id = 'test-print-overlay';
        const renderError = new Error('render failed');

        await expectAsync(mountPrintOverlay({
            overlay,
            bodyClass: 'test-print-active',
            triggerPrint: false,
            onMount: () => { throw renderError; },
        })).toBeRejectedWith(renderError);

        expect(document.getElementById('test-print-overlay')).toBeNull();
        expect(document.body.classList).not.toContain('test-print-active');
    });

    it('rejects instead of hanging when image fallback handling fails', async () => {
        const root = document.createElement('div');
        root.appendChild(document.createElement('img'));
        const fallbackError = new Error('fallback failed');

        await expectAsync(waitForPrintImages(root, () => {
            throw fallbackError;
        })).toBeRejectedWith(fallbackError);
    });
});
