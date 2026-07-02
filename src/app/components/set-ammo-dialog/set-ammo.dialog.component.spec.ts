import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment } from '../../models/equipment.model';
import type { Era } from '../../models/eras.model';
import { DialogsService } from '../../services/dialogs.service';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from './set-ammo.dialog.component';

function createEra(from: number | undefined, to: number | undefined): Era {
    return {
        id: 1,
        name: 'Test Era',
        years: { from, to },
        factions: [],
        units: [],
    };
}

function createAmmo(id: string, kgPerShot = 100): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        rulesRefs: '207, TM',
        tech: {
            base: 'Clan',
            rating: 'E',
            availability: { sl: 'X', sw: 'D', clan: 'C', da: 'B' },
            advancement: { clan: { prototype: '~2824', production: '~2826', common: '2828' } },
        },
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

        const optionLabels = overlayContainerElement.querySelectorAll('.ammo-dropdown-option-name') as NodeListOf<HTMLElement>;
        const longOptionLabel = Array.from(optionLabels)
            .find(element => element.textContent?.includes('Extremely Long Prototype Specialty Ammunition'));

        expect(longOptionLabel).toBeTruthy();
        expect(getComputedStyle(longOptionLabel as HTMLElement).whiteSpace).toBe('normal');
    });

    it('ignores stale pointer hover after keyboard navigation scrolls the dropdown', () => {
        const firstAmmo = createAmmo('Clan Ultra AC/20 Ammo');
        const secondAmmo = createAmmo('Clan Ultra AC/20 Precision Ammo');
        const thirdAmmo = createAmmo('Clan Ultra AC/20 Cluster Ammo');
        const fixture = configureDialog({
            currentAmmo: firstAmmo,
            originalAmmo: firstAmmo,
            originalTotalAmmo: 5,
            ammoOptions: [firstAmmo, secondAmmo, thirdAmmo],
            quantity: 3,
            maxQuantity: 5,
        });
        const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('#inputName');
        const dispatchPointer = (element: Element, type: string, clientX: number, clientY: number) => {
            element.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY }));
            fixture.detectChanges();
        };
        const optionButtons = () => Array.from(overlayContainerElement.querySelectorAll('.ammo-dropdown-option')) as HTMLButtonElement[];

        trigger.click();
        fixture.detectChanges();

        dispatchPointer(optionButtons()[2], 'pointerenter', 10, 10);
        dispatchPointer(optionButtons()[2], 'pointermove', 20, 10);
        expect(optionButtons()[2].classList).toContain('keyboard-active');

        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();
        expect(optionButtons()[0].classList).toContain('keyboard-active');

        dispatchPointer(optionButtons()[2], 'pointerenter', 20, 10);
        expect(optionButtons()[0].classList).toContain('keyboard-active');

        dispatchPointer(optionButtons()[2], 'pointermove', 30, 10);
        expect(optionButtons()[2].classList).toContain('keyboard-active');
    });

    it('shows selection issue reasons in the dialog and expanded dropdown details', () => {
        const futureAmmo = createAmmo('Clan Ultra AC/20 Future Ammo');
        const fixture = configureDialog({
            currentAmmo: futureAmmo,
            originalAmmo: futureAmmo,
            originalTotalAmmo: 5,
            ammoOptions: [futureAmmo],
            quantity: 3,
            maxQuantity: 5,
            era: createEra(2500, 2600),
        });
        const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('#inputName');

        expect(fixture.nativeElement.querySelector('.ammo-selection-issue')?.textContent?.trim()).toBe('Not yet existing in this era');

        trigger.click();
        fixture.detectChanges();
        const expandButton = overlayContainerElement.querySelector('.ammo-dropdown-option .expand-btn') as HTMLButtonElement;

        expandButton.click();
        fixture.detectChanges();

        expect(overlayContainerElement.querySelector('.ammo-selection-issue')?.textContent?.trim()).toBe('Not yet existing in this era');
    });
});