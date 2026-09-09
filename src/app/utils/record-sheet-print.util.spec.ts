// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { printRecordSheetPages } from './record-sheet-print.util';

describe('printing displayed record sheet pages', () => {
    afterEach(() => window.dispatchEvent(new Event('afterprint')));

    function page(role: string): SVGSVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 595 842');
        svg.dataset['mekbayPageRole'] = role;
        svg.style.width = '100%';
        svg.style.height = 'auto';
        const name = document.createElementNS(svg.namespaceURI, 'text');
        name.textContent = 'Unsaved draft <name>';
        svg.append(name);
        return svg;
    }

    it('prints every displayed page at A4 without moving or changing the original SVGs', async () => {
        const sheets = [page('primary'), page('supplemental')];
        const previous = sheets.map(svg => svg.outerHTML);
        const print = spyOn(window, 'print').and.stub();
        await printRecordSheetPages(sheets, { paperSize: 'a4', printMargin: 'none' });
        const overlay = document.getElementById('record-sheet-print-container')!;
        const printed = [...overlay.querySelectorAll<SVGSVGElement>('svg')];
        expect(print).toHaveBeenCalledOnceWith();
        expect(printed.map(svg => svg.dataset['mekbayPageRole'])).toEqual(['primary', 'supplemental']);
        expect(printed[0]).not.toBe(sheets[0]);
        expect(printed[0].textContent).toBe('Unsaved draft <name>');
        expect(printed[0].style.height).toBe('');
        expect(sheets.map(svg => svg.outerHTML)).toEqual(previous);
        expect(overlay.querySelector('style')!.textContent).toContain('size: A4 portrait');
        expect(overlay.querySelector('style')!.textContent).toContain('margin: 0 !important');
        window.dispatchEvent(new Event('afterprint'));
        expect(document.getElementById('record-sheet-print-container')).toBeNull();
        expect(document.body.classList.contains('record-sheet-print-active')).toBeFalse();
    });

    it('uses Letter and browser margins without invoking print for a prepared job', async () => {
        const print = spyOn(window, 'print').and.stub();
        await printRecordSheetPages([page('primary')], { paperSize: 'letter', printMargin: 'browserDefined' }, false);
        const styles = document.querySelector('#record-sheet-print-container style')!.textContent;
        expect(styles).toContain('size: Letter portrait');
        expect(styles).toContain('margin: 0.25in !important');
        expect(print).not.toHaveBeenCalled();
    });

    it('replaces the page size for Letter → A4 → Letter jobs after cancelling each preview', async () => {
        const sizes: string[] = [];
        const overlays: HTMLElement[] = [];
        spyOn(window, 'print').and.callFake(() => {
            const activeOverlays = document.querySelectorAll<HTMLElement>('#record-sheet-print-container');
            expect(activeOverlays.length).toBe(1);
            const overlay = activeOverlays[0];
            overlays.push(overlay);
            const stylesheet = overlay.querySelector('style')!.sheet!;
            const printRules = [...stylesheet.cssRules].find(rule =>
                rule instanceof CSSMediaRule && rule.conditionText === 'print') as CSSMediaRule;
            const pageRule = [...printRules.cssRules].find(rule => rule instanceof CSSPageRule) as CSSPageRule;
            sizes.push(pageRule.style.getPropertyValue('size').toLowerCase().split(/\s+/)[0]);
            // Closing native preview, including Cancel, releases this job's CSS.
            window.dispatchEvent(new Event('afterprint'));
        });

        for (const paperSize of ['letter', 'a4', 'letter'] as const) {
            await printRecordSheetPages([page('primary')], { paperSize, printMargin: 'none' });
            expect(document.getElementById('record-sheet-print-container')).toBeNull();
            expect(document.body.classList.contains('record-sheet-print-active')).toBeFalse();
        }

        expect(sizes).toEqual(['letter', 'a4', 'letter']);
        expect(new Set(overlays).size).toBe(3);
        expect(overlays.every(overlay => !overlay.isConnected)).toBeTrue();
    });

    it('rejects an empty sheet list without creating an empty print job', async () => {
        await expectAsync(printRecordSheetPages([], { paperSize: 'letter', printMargin: 'none' }))
            .toBeRejectedWithError('No record sheet pages are available to print.');
        expect(document.getElementById('record-sheet-print-container')).toBeNull();
    });
});
