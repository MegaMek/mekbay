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

    it('adds the dedicated rules-reference page only when the roster summary is enabled', async () => {
        const createContainer = async () => {
            const overlay = document.createElement('div');
            overlay.id = 'as-multipage-container';
            overlay.appendChild(document.createElement('style'));
            const cardPage = document.createElement('div');
            cardPage.className = 'as-print-page';
            overlay.appendChild(cardPage);
            document.body.appendChild(overlay);
            document.body.classList.add('as-multipage-container-active');
            return { overlay, cardComponentRefs: [] };
        };
        spyOn<any>(ASPrintUtil, 'createFixedPrintContainer').and.callFake(createContainer);
        spyOn<any>(ASPrintUtil, 'createFlexPrintContainer').and.callFake(createContainer);
        const rosterPage = document.createElement('div');
        rosterPage.className = 'as-roster-summary';
        spyOn<any>(ASPrintUtil, 'createRosterSummaryPage').and.resolveTo(rosterPage);

        const unit = {
            id: 'u1',
            alias: () => undefined,
            manualPilotAbilities: () => [],
            formationAbilities: () => [],
            getUnit: () => ({
                name: 'Atlas AS7-D',
                chassis: 'Atlas',
                model: 'AS7-D',
                as: { TP: 'BM', specials: [] },
            }),
        };
        const group = {
            units: () => [unit],
            activeFormation: () => null,
            groupDisplayName: () => 'First Lance',
            formationDisplayName: () => null,
            hasValidFormation: () => true,
        };
        const optionsService = { options: () => ({ ASUseHex: false }) };
        const injector = {
            get: () => ({
                parseAbility: (text: string) => ({ originalText: text, ability: null }),
            }),
        };
        const force = { name: 'Example Force' };

        const withSummary = await printWithSummarySetting(true);
        expect(withSummary.querySelector('.as-roster-summary')).not.toBeNull();
        expect(withSummary.querySelector('.as-rules-reference')).not.toBeNull();
        window.dispatchEvent(new Event('click'));

        const withoutSummary = await printWithSummarySetting(false);
        expect(withoutSummary.querySelector('.as-roster-summary')).toBeNull();
        expect(withoutSummary.querySelector('.as-rules-reference')).toBeNull();
        window.dispatchEvent(new Event('click'));

        async function printWithSummarySetting(printRosterSummary: boolean): Promise<HTMLElement> {
            await ASPrintUtil.multipagePrint(
                {} as never,
                injector as never,
                optionsService as never,
                [group] as never,
                {
                    clean: true,
                    printPilotData: true,
                    printRosterSummary,
                    recordSheetCenterPanelContent: 'clusterTable',
                    ASPrintPageBreakOnGroups: false,
                    ASPrintCardSize: 'standard',
                    printMargin: 'none',
                },
                false,
                force as never,
            );
            return document.getElementById('as-multipage-container')!;
        }
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
