import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
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

    it('does not show the CBT-only Pilot data option for Alpha Strike', () => {
        const { fixture } = createComponent(GameSystem.ALPHA_STRIKE);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#printPilotData')).toBeNull();
    });
});

function createComponent(gameSystem: GameSystem) {
    const dialogRef = { close: jasmine.createSpy('close') };
    const optionsService = {
        options: () => ({
            printRosterSummary: false,
            recordSheetCenterPanelContent: 'clusterTable',
            ASPrintPageBreakOnGroups: true,
            printMargin: 'browserDefined'
        }),
        setOption: jasmine.createSpy('setOption').and.resolveTo()
    };

    TestBed.configureTestingModule({
        imports: [PrintOptionsDialogComponent],
        providers: [
            { provide: DialogRef, useValue: dialogRef },
            { provide: DIALOG_DATA, useValue: { gameSystem } },
            { provide: OptionsService, useValue: optionsService }
        ]
    });

    return {
        fixture: TestBed.createComponent(PrintOptionsDialogComponent),
        dialogRef,
        optionsService
    };
}
