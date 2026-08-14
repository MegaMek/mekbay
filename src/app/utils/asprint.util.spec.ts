// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PrintAllOptions } from '../models/print-options.model';
import { ASPrintUtil } from './asprint.util';

interface TestPrintLayout {
    cardScale: number;
    columnsPerPage: number;
    rowsPerPage: number;
    pageSize: 'auto' | 'landscape';
}

describe('ASPrintUtil', () => {
    it('keeps the standard 2 by 4 layout as the default-size preset', () => {
        const layout = getPrintLayout('standard');
        const styles = getFixedPrintStyles('none', 'standard');

        expect(layout.cardScale).toBe(1);
        expect(layout.columnsPerPage * layout.rowsPerPage).toBe(8);
        expect(styles).toContain('width: 88mm;');
        expect(styles).toContain('height: 63mm;');
        expect(styles).toContain('size: auto;');
    });

    it('prints four enlarged cards with twice the standard area on a landscape page', () => {
        const layout = getPrintLayout('enlarged');
        const fixedStyles = getFixedPrintStyles('browserDefined', 'enlarged');
        const flexStyles = getFlexPrintStyles('browserDefined', 'enlarged');

        expect(layout.columnsPerPage).toBe(2);
        expect(layout.rowsPerPage).toBe(2);
        expect(layout.cardScale * layout.cardScale).toBeCloseTo(2, 10);
        expect(fixedStyles).toContain('width: 10.5in;');
        expect(fixedStyles).toContain('height: 8in;');
        expect(fixedStyles).toContain('size: landscape;');
        expect(flexStyles).toContain('size: landscape;');
    });
});

function getPrintLayout(cardSize: PrintAllOptions['ASPrintCardSize']): TestPrintLayout {
    return (ASPrintUtil as unknown as {
        getPrintLayout(cardSize: PrintAllOptions['ASPrintCardSize']): TestPrintLayout;
    }).getPrintLayout(cardSize);
}

function getFixedPrintStyles(
    printMargin: PrintAllOptions['printMargin'],
    cardSize: PrintAllOptions['ASPrintCardSize']
): string {
    return (ASPrintUtil as unknown as {
        getFixedPrintStyles(
            printMargin: PrintAllOptions['printMargin'],
            cardSize: PrintAllOptions['ASPrintCardSize']
        ): string;
    }).getFixedPrintStyles(printMargin, cardSize);
}

function getFlexPrintStyles(
    printMargin: PrintAllOptions['printMargin'],
    cardSize: PrintAllOptions['ASPrintCardSize']
): string {
    return (ASPrintUtil as unknown as {
        getFlexPrintStyles(
            printMargin: PrintAllOptions['printMargin'],
            cardSize: PrintAllOptions['ASPrintCardSize']
        ): string;
    }).getFlexPrintStyles(printMargin, cardSize);
}
