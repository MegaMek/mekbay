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
    afterEach(() => TestBed.resetTestingModule());

    it('shows the CBT sheet options and restores the last paper size', () => {
        const { fixture } = createComponent(GameSystem.CBT, { paperSize: 'a4' });
        fixture.detectChanges();

        expect((fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement).value).toBe('true');
        expect((fixture.nativeElement.querySelector('#printPaperSize') as HTMLSelectElement).value).toBe('a4');
        expect(fixture.nativeElement.querySelector('#ASPrintCardSize')).toBeNull();
        expect(actionLabels(fixture.nativeElement)).toEqual(['SHEETS', 'SUMMARY', 'DISMISS']);
    });

    it('shows Alpha Strike card options without CBT-only controls', () => {
        const { fixture } = createComponent(GameSystem.AS);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#printPilotData')).toBeNull();
        expect(fixture.nativeElement.querySelector('#printPaperSize')).toBeNull();
        expect((fixture.nativeElement.querySelector('#ASPrintCardSize') as HTMLSelectElement).value).toBe('standard');
        expect(actionLabels(fixture.nativeElement)).toEqual(['CARDS', 'SUMMARY', 'DISMISS']);
    });

    it('saves one complete options object and returns it for sheet/card printing', async () => {
        const { fixture, dialogRef, optionsService } = createComponent(GameSystem.CBT);
        fixture.detectChanges();
        const pilotData = fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement;
        pilotData.value = 'false';
        pilotData.dispatchEvent(new Event('change'));
        (fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement).click();
        await fixture.whenStable();

        const expected = jasmine.objectContaining({ printPilotData: false, paperSize: 'letter' });
        expect(optionsService.setOption).toHaveBeenCalledOnceWith('printAllOptions', expected);
        expect(dialogRef.close).toHaveBeenCalledOnceWith(expected);
    });

    it('prints a standalone summary without closing the options dialog', async () => {
        const { fixture, dialogRef, printSummary, optionsService } = createComponent(GameSystem.AS);
        fixture.detectChanges();
        actionButtons(fixture.nativeElement)[1].click();
        await fixture.whenStable();

        expect(optionsService.setOption).toHaveBeenCalledTimes(1);
        expect(printSummary).toHaveBeenCalledOnceWith(jasmine.any(Object));
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('ignores duplicate summary requests while printing is in progress', async () => {
        const { fixture, printSummary } = createComponent(GameSystem.AS);
        let finish!: () => void;
        printSummary.and.returnValue(new Promise<void>(resolve => { finish = resolve; }));
        fixture.detectChanges();
        const component = fixture.componentInstance as unknown as { onPrintSummary(): Promise<void> };

        const first = component.onPrintSummary();
        const duplicate = component.onPrintSummary();
        await Promise.resolve();
        expect(printSummary).toHaveBeenCalledTimes(1);

        finish();
        await Promise.all([first, duplicate]);
    });
});

function createComponent(gameSystem: GameSystem, overrides: Partial<PrintAllOptions> = {}) {
    const dialogRef = { close: jasmine.createSpy('close') };
    const printSummary = jasmine.createSpy('printSummary').and.resolveTo();
    const optionsService = {
        options: () => ({
            printAllOptions: {
                clean: false,
                printPilotData: true,
                paperSize: 'letter',
                recordSheetCenterPanelContent: 'clusterTable',
                ASPrintPageBreakOnGroups: true,
                ASPrintCardSize: 'standard',
                printMargin: 'browserDefined',
                ...overrides,
            } satisfies PrintAllOptions,
        }),
        setOption: jasmine.createSpy('setOption').and.resolveTo(),
    };

    TestBed.configureTestingModule({
        imports: [PrintOptionsDialogComponent],
        providers: [
            { provide: DialogRef, useValue: dialogRef },
            { provide: DIALOG_DATA, useValue: { gameSystem, printSummary } },
            { provide: OptionsService, useValue: optionsService },
        ],
    });

    return {
        fixture: TestBed.createComponent(PrintOptionsDialogComponent),
        dialogRef,
        printSummary,
        optionsService,
    };
}

function actionButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.wide-dialog-actions .bt-button'));
}

function actionLabels(root: HTMLElement): string[] {
    return actionButtons(root).map(button => button.textContent?.trim() ?? '');
}
