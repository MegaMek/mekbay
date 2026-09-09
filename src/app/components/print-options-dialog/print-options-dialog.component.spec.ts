// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { PrintAllOptions } from '../../models/print-options.model';
import { DbService } from '../../services/db.service';
import { OptionsService } from '../../services/options.service';
import { PrintOptionsDialogComponent } from './print-options-dialog.component';

describe('PrintOptionsDialogComponent', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('shows the CBT sheet options and restores the last paper size', async () => {
        const { fixture } = await createComponent(GameSystem.CBT, { paperSize: 'a4' });
        fixture.detectChanges();

        expect((fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement).value).toBe('true');
        expect((fixture.nativeElement.querySelector('#printPaperSize') as HTMLSelectElement).value).toBe('a4');
        expect(fixture.nativeElement.querySelector('#ASPrintCardSize')).toBeNull();
        expect(actionLabels(fixture.nativeElement)).toEqual(['SHEETS', 'SUMMARY', 'DISMISS']);
    });

    it('shows Alpha Strike card options without CBT-only controls', async () => {
        const { fixture } = await createComponent(GameSystem.AS);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#printPilotData')).toBeNull();
        expect(fixture.nativeElement.querySelector('#printPaperSize')).toBeNull();
        expect((fixture.nativeElement.querySelector('#ASPrintCardSize') as HTMLSelectElement).value).toBe('standard');
        expect(actionLabels(fixture.nativeElement)).toEqual(['CARDS', 'SUMMARY', 'DISMISS']);
    });

    it('saves changes immediately and returns the shared options for sheet/card printing', async () => {
        const { fixture, dialogRef, optionsService, dbService } = await createComponent(GameSystem.CBT);
        fixture.detectChanges();
        const pilotData = fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement;
        pilotData.value = 'false';
        pilotData.dispatchEvent(new Event('change'));
        expect(optionsService.options().printAllOptions.printPilotData).toBeFalse();
        (fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement).click();
        await fixture.whenStable();

        const expected = jasmine.objectContaining({ printPilotData: false, paperSize: 'letter' });
        expect(dbService.saveOptions).toHaveBeenCalledOnceWith(jasmine.objectContaining({ printAllOptions: expected }));
        expect(dialogRef.close).toHaveBeenCalledOnceWith(expected);
        expect(dialogRef.close.calls.mostRecent().args[0]).toBe(optionsService.options().printAllOptions);
    });

    it('changes global paper size before printing and retains it when dismissed', async () => {
        const { fixture, dialogRef, optionsService, dbService } = await createComponent(GameSystem.CBT);
        fixture.detectChanges();
        const paperSize = fixture.nativeElement.querySelector('#printPaperSize') as HTMLSelectElement;
        paperSize.value = 'a4';
        paperSize.dispatchEvent(new Event('change'));

        expect(optionsService.options().printAllOptions.paperSize).toBe('a4');
        expect(dialogRef.close).not.toHaveBeenCalled();
        actionButtons(fixture.nativeElement)[2].click();
        await fixture.whenStable();

        expect(dialogRef.close).toHaveBeenCalledOnceWith(null);
        expect(optionsService.options().printAllOptions.paperSize).toBe('a4');
        expect(dbService.saveOptions).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            printAllOptions: jasmine.objectContaining({ paperSize: 'a4' }),
        }));
    });

    it('reflects external format changes while open and keeps them when another control changes', async () => {
        const { fixture, optionsService } = await createComponent(GameSystem.CBT);
        fixture.detectChanges();
        for (const paperSize of ['a4', 'letter'] as const) {
            await optionsService.setPrintOption('paperSize', paperSize);
            fixture.detectChanges();
            expect((fixture.nativeElement.querySelector('#printPaperSize') as HTMLSelectElement).value).toBe(paperSize);
        }
        await optionsService.setPrintOption('paperSize', 'a4');
        const pilotData = fixture.nativeElement.querySelector('#printPilotData') as HTMLSelectElement;
        pilotData.value = 'false';
        pilotData.dispatchEvent(new Event('change'));
        expect(optionsService.options().printAllOptions).toEqual(jasmine.objectContaining({
            paperSize: 'a4', printPilotData: false,
        }));
    });

    it('prints a standalone summary without closing the options dialog', async () => {
        const { fixture, dialogRef, printSummary, optionsService, dbService } = await createComponent(GameSystem.AS);
        fixture.detectChanges();
        actionButtons(fixture.nativeElement)[1].click();
        await fixture.whenStable();

        expect(dbService.saveOptions).not.toHaveBeenCalled();
        expect(printSummary).toHaveBeenCalledOnceWith(optionsService.options().printAllOptions);
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('ignores duplicate summary requests while printing is in progress', async () => {
        const { fixture, printSummary } = await createComponent(GameSystem.AS);
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

async function createComponent(gameSystem: GameSystem, overrides: Partial<PrintAllOptions> = {}) {
    const dialogRef = { close: jasmine.createSpy('close') };
    const printSummary = jasmine.createSpy('printSummary').and.resolveTo();
    const dbService = {
        getOptions: jasmine.createSpy('getOptions').and.resolveTo({
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
        saveOptions: jasmine.createSpy('saveOptions').and.resolveTo(),
    };

    TestBed.configureTestingModule({
        imports: [PrintOptionsDialogComponent],
        providers: [
            { provide: DialogRef, useValue: dialogRef },
            { provide: DIALOG_DATA, useValue: { gameSystem, printSummary } },
            OptionsService,
            { provide: DbService, useValue: dbService },
        ],
    });

    const optionsService = TestBed.inject(OptionsService);
    await Promise.resolve();
    expect(optionsService.initialized()).toBeTrue();
    return {
        fixture: TestBed.createComponent(PrintOptionsDialogComponent),
        dialogRef,
        printSummary,
        optionsService,
        dbService,
    };
}

function actionButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.wide-dialog-actions .bt-button'));
}

function actionLabels(root: HTMLElement): string[] {
    return actionButtons(root).map(button => button.textContent?.trim() ?? '');
}
