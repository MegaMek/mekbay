import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnitStateDropdownComponent } from './unit-state-dropdown.component';

describe('UnitStateDropdownComponent', () => {
    let fixture: ComponentFixture<UnitStateDropdownComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [UnitStateDropdownComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(UnitStateDropdownComponent);
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('selects the hovered state when a held opening pointer is released over an option', () => {
        const selected: string[] = [];
        fixture.componentInstance.selected.subscribe(key => selected.push(key));
        fixture.componentRef.setInput('choices', [{ key: 'prone', label: 'Prone', color: '#c00', active: false }]);
        fixture.componentRef.setInput('initialEvent', createPointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', buttons: 1 }));
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector('[data-unit-state-key="prone"]') as HTMLElement;
        spyOn(document, 'elementFromPoint').and.returnValue(button);

        window.dispatchEvent(createPointerEvent('pointermove', { pointerId: 7, pointerType: 'touch', buttons: 1, clientX: 30, clientY: 40 }));
        expect(fixture.componentInstance.hoveredTarget()).toEqual({ key: 'prone', action: 'selected' });

        window.dispatchEvent(createPointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 40 }));

        expect(selected).toEqual(['prone']);
    });

    it('increments counted states when a held opening pointer is released over the plus button', () => {
        const incremented: string[] = [];
        let holdSelectionCompleted = 0;
        fixture.componentInstance.incremented.subscribe(key => incremented.push(key));
        fixture.componentInstance.holdSelectionCompleted.subscribe(() => holdSelectionCompleted++);
        fixture.componentRef.setInput('choices', [{ key: 'flooded', label: 'Flooded', color: '#66f', active: true, counted: true, value: 1 }]);
        fixture.componentRef.setInput('initialEvent', createPointerEvent('pointerdown', { pointerId: 11, pointerType: 'touch', buttons: 1 }));
        fixture.detectChanges();

        const plusButton = fixture.nativeElement.querySelector('[data-unit-state-key="flooded"][data-unit-state-action="incremented"]') as HTMLElement;
        spyOn(document, 'elementFromPoint').and.returnValue(plusButton);

        window.dispatchEvent(createPointerEvent('pointermove', { pointerId: 11, pointerType: 'touch', buttons: 1, clientX: 45, clientY: 55 }));
        window.dispatchEvent(createPointerEvent('pointerup', { pointerId: 11, pointerType: 'touch', clientX: 45, clientY: 55 }));

        expect(incremented).toEqual(['flooded']);
        expect(holdSelectionCompleted).toBe(1);
    });

    it('cancels when a held opening pointer is released away from dropdown items', () => {
        let cancelled = 0;
        fixture.componentInstance.cancelled.subscribe(() => cancelled++);
        fixture.componentRef.setInput('choices', [{ key: 'shutdown', label: 'Shutdown', color: '#999', active: false }]);
        fixture.componentRef.setInput('initialEvent', createPointerEvent('pointerdown', { pointerId: 13, pointerType: 'touch', buttons: 1 }));
        fixture.detectChanges();
        spyOn(document, 'elementFromPoint').and.returnValue(null);

        window.dispatchEvent(createPointerEvent('pointerup', { pointerId: 13, pointerType: 'touch', clientX: 90, clientY: 90 }));

        expect(cancelled).toBe(1);
    });
});

function createPointerEvent(type: string, init: PointerEventInit): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        ...init
    });
}