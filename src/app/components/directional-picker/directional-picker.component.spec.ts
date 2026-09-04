// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import type { PickerChoice } from '../picker/picker.interface';
import { DirectionalPickerComponent } from './directional-picker.component';

describe('DirectionalPickerComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [DirectionalPickerComponent] }).compileComponents();
    });

    it('renders four cardinal sectors around a transparent center', () => {
        const fixture = TestBed.createComponent(DirectionalPickerComponent);
        fixture.detectChanges();

        const sectors = fixture.nativeElement.querySelectorAll('.directional-sector') as NodeListOf<SVGPathElement>;
        expect(Array.from(sectors, sector => sector.getAttribute('aria-label')))
            .toEqual(['Front', 'Right', 'Rear', 'Left']);
        expect(fixture.nativeElement.querySelector('.directional-center')).not.toBeNull();
    });

    it('selects a sector with click-to-open, click-to-select', async () => {
        const fixture = TestBed.createComponent(DirectionalPickerComponent);
        const picked = jasmine.createSpy<(choice: PickerChoice) => void>('picked');
        fixture.componentInstance.picked.subscribe(picked);
        fixture.componentInstance.initialEvent.set(pointerEvent('pointerdown'));
        fixture.detectChanges();
        await fixture.whenStable();

        window.dispatchEvent(pointerEvent('pointerup'));
        await delay(310);
        expect(picked).not.toHaveBeenCalled();

        const leftSector = fixture.nativeElement.querySelector('[aria-label="Left"]') as SVGPathElement;
        leftSector.dispatchEvent(pointerEvent('pointerdown'));
        leftSector.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(picked).toHaveBeenCalledOnceWith(jasmine.objectContaining({ value: 'left' }));
        fixture.destroy();
    });

    it('selects the hovered sector when a held pointer is released', async () => {
        const fixture = TestBed.createComponent(DirectionalPickerComponent);
        const picked = jasmine.createSpy<(choice: PickerChoice) => void>('picked');
        fixture.componentInstance.picked.subscribe(picked);
        fixture.componentInstance.initialEvent.set(pointerEvent('pointerdown'));
        fixture.detectChanges();
        await fixture.whenStable();

        const frontSector = fixture.nativeElement.querySelector('[aria-label="Front"]') as SVGPathElement;
        spyOn(document, 'elementFromPoint').and.returnValue(frontSector);
        window.dispatchEvent(pointerEvent('pointermove', { clientX: 80, clientY: 10 }));
        await delay(310);
        window.dispatchEvent(pointerEvent('pointerup', { clientX: 80, clientY: 10 }));

        expect(picked).toHaveBeenCalledOnceWith(jasmine.objectContaining({ value: 'front' }));
        fixture.destroy();
    });
});

function pointerEvent(type: string, init: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        ...init,
    });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}