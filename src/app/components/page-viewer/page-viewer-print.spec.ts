// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

@Component({
    template: '',
    styleUrl: './page-viewer.component.scss',
})
class ViewerPrintStylesHost {}

describe('page viewer print styles', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('gives the unnamed page zero margins so browser headers and footers default to off', () => {
        const existing = new Set(document.styleSheets);
        TestBed.createComponent(ViewerPrintStylesHost);
        const printRules = [...document.styleSheets]
            .filter(sheet => !existing.has(sheet))
            .flatMap(sheet => [...sheet.cssRules])
            .filter((rule): rule is CSSMediaRule =>
                rule instanceof CSSMediaRule && rule.conditionText === 'print')
            .flatMap(rule => [...rule.cssRules]);
        const defaultPage = printRules.find((rule): rule is CSSPageRule =>
            rule instanceof CSSPageRule && rule.selectorText === '');

        // Chromium uses this default layout to enable its automatic headers and
        // footers, even when the actual sheet uses a named Letter/A4 page.
        expect(defaultPage).withContext('An unnamed @page rule is required').toBeDefined();
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(parseFloat(defaultPage!.style.getPropertyValue(`margin-${side}`)))
                .withContext(`Default page margin-${side}`).toBe(0);
        }
    });
});
