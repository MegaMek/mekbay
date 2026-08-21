// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { PrintAllOptions } from '../../models/print-options.model';
import { OptionsService } from '../../services/options.service';
import { PrintOptionsDialogComponent } from './print-options-dialog.component';

describe('PrintOptionsDialogComponent', () => {
    it('defaults Pilot data to enabled for Classic print jobs', () => {
        const { fixture } = createComponent(GameSystem.CLASSIC);
        fixture.detectChanges();

        const select = fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.value).toBe('true');
        expect(select.previousElementSibling?.textContent?.trim()).toBe('Pilot data:');
    });

    it('allows Pilot data to be disabled and returns it with the print options', async () => {
        const { fixture, dialogRef } = createComponent(GameSystem.CLASSIC);
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement;

        select.value = 'false';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        (fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement).click();
        await fixture.whenStable();

        expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ printPilotData: false }));
    });

    it('shows Classic actions and prints the summary without closing', async () => {
        const { fixture, dialogRef, optionsService, printSummary } = createComponent(GameSystem.CLASSIC);
        fixture.detectChanges();

        const buttons = getActionButtons(fixture.nativeElement);
        expect(buttons.map(button => button.textContent?.trim())).toEqual(['SHEETS', 'SUMMARY', 'DISMISS']);
        expect(buttons[0].classList).toContain('primary');
        expect(buttons[1].classList).not.toContain('primary');

        buttons[1].click();
        await fixture.whenStable();

        expect(optionsService.setOption).toHaveBeenCalledWith('printAllOptions', jasmine.any(Object));
        expect(printSummary).toHaveBeenCalledWith(jasmine.any(Object));
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('does not show the CBT-only Pilot data option for Alpha Strike', () => {
        const { fixture } = createComponent(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#printPilotData')).toBeNull();
    });

    it('defaults Alpha Strike card printing to the standard eight-card layout', () => {
        const { fixture } = createComponent(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();

        const select = fixture.nativeElement.querySelector('#ASPrintCardSize') as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.value).toBe('standard');
        expect(Array.from(select.options).map(option => option.text)).toEqual([
            'Standard (8 per page)',
            'Enlarged (4 per page)'
        ]);
    });

    it('shows Alpha Strike actions and prints the summary without closing', async () => {
        const { fixture, dialogRef, printSummary } = createComponent(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();

        const buttons = getActionButtons(fixture.nativeElement);
        expect(buttons.map(button => button.textContent?.trim())).toEqual(['CARDS', 'SUMMARY', 'DISMISS']);
        expect(buttons[0].classList).toContain('primary');
        expect(buttons[1].classList).not.toContain('primary');

        buttons[1].click();
        await fixture.whenStable();

        expect(printSummary).toHaveBeenCalledWith(jasmine.any(Object));
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('ignores repeated print requests while a summary is being prepared', async () => {
        const { fixture, printSummary } = createComponent(GameSystem.ALPHA_STRIKE);
        let finishPrinting!: () => void;
        printSummary.and.returnValue(new Promise<void>(resolve => {
            finishPrinting = resolve;
        }));
        fixture.detectChanges();
        const summaryButton = getActionButtons(fixture.nativeElement)[1];
        const component = fixture.componentInstance as unknown as {
            onPrintSummary(): Promise<void>;
        };

        const firstPrint = component.onPrintSummary();
        const repeatedPrint = component.onPrintSummary();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(printSummary).toHaveBeenCalledTimes(1);
        fixture.detectChanges();
        expect(summaryButton.disabled).toBeTrue();

        finishPrinting();
        await Promise.all([firstPrint, repeatedPrint]);
        fixture.detectChanges();
        expect(summaryButton.disabled).toBeFalse();
    });

    it('returns the enlarged Alpha Strike card size with the print options', async () => {
        const { fixture, dialogRef, optionsService } = createComponent(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('#ASPrintCardSize') as HTMLSelectElement;

        select.value = 'enlarged';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        (fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement).click();
        await fixture.whenStable();

        expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ ASPrintCardSize: 'enlarged' }));
        expect(optionsService.setOption).toHaveBeenCalledWith('printAllOptions', jasmine.objectContaining({
            ASPrintCardSize: 'enlarged',
        }));
    });

    it('restores the last Alpha Strike card size from the saved options', () => {
        const { fixture } = createComponent(GameSystem.ALPHA_STRIKE, {
            printAllOptions: { ASPrintCardSize: 'enlarged' },
        });
        fixture.detectChanges();

        const select = fixture.nativeElement.querySelector('#ASPrintCardSize') as HTMLSelectElement;
        expect(select.value).toBe('enlarged');
    });

    it('does not show the Alpha Strike card-size option for Classic printing', () => {
        const { fixture } = createComponent(GameSystem.CLASSIC);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#ASPrintCardSize')).toBeNull();
    });

    it('saves the complete print options object in one update', async () => {
        const { fixture, dialogRef, optionsService } = createComponent(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();

        (fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement).click();
        await fixture.whenStable();

        const expected: PrintAllOptions = {
            clean: false,
            printPilotData: true,
            recordSheetCenterPanelContent: 'clusterTable',
            ASPrintPageBreakOnGroups: true,
            ASPrintCardSize: 'standard',
            printMargin: 'browserDefined',
        };

        expect(optionsService.setOption).toHaveBeenCalledTimes(1);
        expect(optionsService.setOption).toHaveBeenCalledWith('printAllOptions', expected);
        expect(dialogRef.close).toHaveBeenCalledWith(expected);
    });
});

function createComponent(
    gameSystem: GameSystem,
    optionOverrides: { printAllOptions?: Partial<PrintAllOptions> } = {},
) {
    const dialogRef = { close: jasmine.createSpy('close') };
    const printSummary = jasmine.createSpy('printSummary').and.resolveTo();
    const optionsService = {
        options: () => ({
            printAllOptions: {
                clean: false,
                printPilotData: true,
                recordSheetCenterPanelContent: 'clusterTable',
                ASPrintPageBreakOnGroups: true,
                ASPrintCardSize: 'standard',
                printMargin: 'browserDefined',
                ...optionOverrides.printAllOptions,
            },
        }),
        setOption: jasmine.createSpy('setOption').and.resolveTo()
    };

    TestBed.configureTestingModule({
        imports: [PrintOptionsDialogComponent],
        providers: [
            { provide: DialogRef, useValue: dialogRef },
            { provide: DIALOG_DATA, useValue: { gameSystem, printSummary } },
            { provide: OptionsService, useValue: optionsService }
        ]
    });

    return {
        fixture: TestBed.createComponent(PrintOptionsDialogComponent),
        dialogRef,
        optionsService,
        printSummary,
    };
}

function getActionButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.wide-dialog-actions .bt-button'));
}
