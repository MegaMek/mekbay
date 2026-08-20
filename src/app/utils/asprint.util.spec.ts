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
    afterEach(() => {
        window.dispatchEvent(new Event('afterprint'));
        document.getElementById('as-multipage-container')?.remove();
        document.body.classList.remove('as-multipage-container-active');
    });

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

    it('builds a cards-only print container', async () => {
        const createContainer = () => {
            const overlay = document.createElement('div');
            overlay.id = 'as-multipage-container';
            overlay.appendChild(document.createElement('style'));
            const cardPage = document.createElement('div');
            cardPage.className = 'as-print-page';
            overlay.appendChild(cardPage);
            return overlay;
        };
        spyOn<any>(ASPrintUtil, 'createFixedPrintContainer').and.callFake(createContainer);
        spyOn<any>(ASPrintUtil, 'createFlexPrintContainer').and.callFake(createContainer);

        const unit = {
            disabledSaving: false,
            serialize: () => ({ state: 'original' }),
            update: jasmine.createSpy('update'),
            repairAll: jasmine.createSpy('repairAll'),
            getUnit: () => ({
                as: { TP: 'BM' },
            }),
        };
        const group = {
            units: () => [unit],
        };

        await ASPrintUtil.multipagePrint(
            { tick: jasmine.createSpy('tick') } as never,
            {} as never,
            {} as never,
            [group] as never,
            {
                clean: true,
                ASPrintPageBreakOnGroups: false,
                ASPrintCardSize: 'standard',
                printMargin: 'none',
            },
            false,
        );

        const overlay = document.getElementById('as-multipage-container')!;
        expect(overlay.querySelectorAll('.as-print-page').length).toBe(1);
        expect(overlay.querySelector('.as-roster-summary')).toBeNull();
        expect(overlay.querySelector('.as-rules-reference')).toBeNull();
        expect(unit.repairAll).toHaveBeenCalled();

        window.dispatchEvent(new Event('click'));
        expect(unit.update).toHaveBeenCalledWith({ state: 'original' });
        expect(unit.disabledSaving).toBeFalse();
    });

    it('temporarily clears current heat and restores the complete unit state after printing', async () => {
        const createContainer = () => {
            const overlay = document.createElement('div');
            overlay.id = 'as-multipage-container';
            return overlay;
        };
        spyOn<any>(ASPrintUtil, 'createFixedPrintContainer').and.callFake(createContainer);
        spyOn<any>(ASPrintUtil, 'createFlexPrintContainer').and.callFake(createContainer);

        let heat = 2;
        let pendingHeat = 1;
        let renderedHeat: [number, number] | undefined;
        const serialized = { state: 'original' };
        const unit = {
            disabledSaving: false,
            serialize: () => serialized,
            update: jasmine.createSpy('update').and.callFake(() => {
                heat = 2;
                pendingHeat = 1;
            }),
            repairAll: jasmine.createSpy('repairAll'),
            setHeat: (value: number) => { heat = value; },
            setPendingHeat: (value: number) => { pendingHeat = value; },
            getUnit: () => ({ as: { TP: 'BM' } }),
        };
        const group = { units: () => [unit] };

        await ASPrintUtil.multipagePrint(
            { tick: () => { renderedHeat = [heat, pendingHeat]; } } as never,
            {} as never,
            {} as never,
            [group] as never,
            {
                clean: false,
                ASPrintPageBreakOnGroups: false,
                ASPrintCardSize: 'standard',
                printMargin: 'none',
            },
            false,
        );

        expect(renderedHeat).toEqual([0, 0]);
        expect(unit.update).not.toHaveBeenCalled();
        expect(heat).toBe(0);
        expect(pendingHeat).toBe(0);
        expect(unit.disabledSaving).toBeTrue();

        window.dispatchEvent(new Event('afterprint'));

        expect(unit.update).toHaveBeenCalledWith(serialized);
        expect(unit.update).toHaveBeenCalledTimes(1);
        expect(heat).toBe(2);
        expect(pendingHeat).toBe(1);
        expect(unit.disabledSaving).toBeFalse();
    });

    it('keeps dynamically rendered card hosts mounted until print cleanup', async () => {
        const cardHost = document.createElement('alpha-strike-card');
        const hostView = {};
        const destroy = jasmine.createSpy('destroy');
        const createContainer = (options: { componentRefs: unknown[] }) => {
            const overlay = document.createElement('div');
            overlay.id = 'as-multipage-container';
            const cardCell = document.createElement('div');
            cardCell.className = 'as-card-cell';
            cardCell.appendChild(cardHost);
            overlay.appendChild(cardCell);
            options.componentRefs.push({ hostView, destroy });
            return overlay;
        };
        spyOn<any>(ASPrintUtil, 'createFixedPrintContainer').and.callFake(createContainer);
        spyOn<any>(ASPrintUtil, 'createFlexPrintContainer').and.callFake(createContainer);

        const detachView = jasmine.createSpy('detachView').and.callFake(() => cardHost.remove());
        const appRef = {
            tick: jasmine.createSpy('tick'),
            detachView,
        };
        const unit = {
            disabledSaving: false,
            serialize: () => ({ state: 'original' }),
            update: jasmine.createSpy('update'),
            repairAll: jasmine.createSpy('repairAll'),
            getUnit: () => ({ as: { TP: 'BM' } }),
        };
        const group = { units: () => [unit] };

        await ASPrintUtil.multipagePrint(
            appRef as never,
            {} as never,
            {} as never,
            [group] as never,
            {
                clean: true,
                ASPrintPageBreakOnGroups: false,
                ASPrintCardSize: 'standard',
                printMargin: 'none',
            },
            false,
        );

        expect(document.querySelector('#as-multipage-container alpha-strike-card')).toBe(cardHost);
        expect(detachView).not.toHaveBeenCalled();
        expect(destroy).not.toHaveBeenCalled();

        window.dispatchEvent(new Event('afterprint'));

        expect(detachView).toHaveBeenCalledOnceWith(hostView);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(document.getElementById('as-multipage-container')).toBeNull();
    });

    it('restores unit state and removes the overlay when rendering fails', async () => {
        const createContainer = () => {
            const overlay = document.createElement('div');
            overlay.id = 'as-multipage-container';
            return overlay;
        };
        spyOn<any>(ASPrintUtil, 'createFixedPrintContainer').and.callFake(createContainer);
        spyOn<any>(ASPrintUtil, 'createFlexPrintContainer').and.callFake(createContainer);

        const unit = {
            disabledSaving: false,
            serialize: () => ({ state: 'original' }),
            update: jasmine.createSpy('update'),
            repairAll: jasmine.createSpy('repairAll'),
            getUnit: () => ({ as: { TP: 'BM' } }),
        };
        const group = { units: () => [unit] };
        const renderError = new Error('render failed');

        await expectAsync(ASPrintUtil.multipagePrint(
            { tick: () => { throw renderError; } } as never,
            {} as never,
            {} as never,
            [group] as never,
            {
                clean: true,
                ASPrintPageBreakOnGroups: false,
                ASPrintCardSize: 'standard',
                printMargin: 'none',
            },
            false,
        )).toBeRejectedWith(renderError);

        expect(unit.update).toHaveBeenCalledWith({ state: 'original' });
        expect(unit.disabledSaving).toBeFalse();
        expect(document.getElementById('as-multipage-container')).toBeNull();
        expect(document.body.classList).not.toContain('as-multipage-container-active');
    });

    it('attempts to restore every unit when one restoration fails', () => {
        const restoreError = new Error('restore failed');
        const firstUnit = {
            disabledSaving: false,
            serialize: () => ({ state: 'first' }),
            update: jasmine.createSpy('first update').and.throwError(restoreError),
            repairAll: jasmine.createSpy('first repair'),
        };
        const secondUnit = {
            disabledSaving: false,
            serialize: () => ({ state: 'second' }),
            update: jasmine.createSpy('second update'),
            repairAll: jasmine.createSpy('second repair'),
        };
        const restore = prepareUnitsForPrint([firstUnit, secondUnit], true);

        expect(restore).toThrow(restoreError);
        expect(firstUnit.disabledSaving).toBeFalse();
        expect(secondUnit.update).toHaveBeenCalledWith({ state: 'second' });
        expect(secondUnit.disabledSaving).toBeFalse();
    });
});

function prepareUnitsForPrint(units: unknown[], clean: boolean): () => void {
    return (ASPrintUtil as unknown as {
        prepareUnitsForPrint(units: unknown[], clean: boolean): () => void;
    }).prepareUnitsForPrint(units, clean);
}

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
