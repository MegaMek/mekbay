import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment } from '../../models/equipment.model';
import { DialogsService } from '../../services/dialogs.service';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from './set-ammo.dialog.component';

function createAmmo(id: string, kgPerShot = 100): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        ammo: { type: 'AC_ULTRA', rackSize: 20, shots: 5, kgPerShot }
    });
}

describe('SetAmmoDialogComponent', () => {
    let overlayContainerElement: HTMLElement;

    function configureDialog(data: SetAmmoDialogData) {
        TestBed.configureTestingModule({
            imports: [SetAmmoDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                { provide: DialogsService, useValue: { requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(false) } },
            ],
        });

        overlayContainerElement = TestBed.inject(OverlayContainer).getContainerElement();
        overlayContainerElement.innerHTML = '';

        const fixture = TestBed.createComponent(SetAmmoDialogComponent);
        fixture.detectChanges();
        return fixture;
    }

    it('adjusts quantity with square buttons and clamps to valid range', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const fixture = configureDialog({
            currentAmmo: standardAmmo,
            originalAmmo: standardAmmo,
            originalTotalAmmo: 5,
            ammoOptions: [standardAmmo],
            quantity: 3,
            maxQuantity: 5,
        });
        const input: HTMLInputElement = fixture.nativeElement.querySelector('#inputQuantity');
        const buttons = Array.from(fixture.nativeElement.querySelectorAll('.quantity-adjust')) as HTMLButtonElement[];

        buttons[0].click();
        expect(input.value).toBe('2');

        buttons[1].click();
        expect(input.value).toBe('3');

        input.value = '5';
        buttons[1].click();
        expect(input.value).toBe('5');

        input.value = '0';
        buttons[0].click();
        expect(input.value).toBe('0');
    });

    it('renders ammo options in rows that can wrap long names', () => {
        const standardAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const longAmmo = createAmmo('Clan Ultra AC/20 Extremely Long Prototype Specialty Ammunition With Guidance Package Ammo');
        const fixture = configureDialog({
            currentAmmo: standardAmmo,
            originalAmmo: standardAmmo,
            originalTotalAmmo: 5,
            ammoOptions: [standardAmmo, longAmmo],
            quantity: 3,
            maxQuantity: 5,
        });
        const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('#inputName');

        trigger.click();
        fixture.detectChanges();

        const optionLabels = overlayContainerElement.querySelectorAll('.multiline-dropdown-option-label') as NodeListOf<HTMLElement>;
        const longOptionLabel = Array.from(optionLabels)
            .find(element => element.textContent?.includes('Extremely Long Prototype Specialty Ammunition'));

        expect(longOptionLabel).toBeTruthy();
        expect(getComputedStyle(longOptionLabel as HTMLElement).whiteSpace).toBe('normal');
    });
});