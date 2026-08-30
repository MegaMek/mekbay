// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RangeSliderComponent } from './range-slider.component';

describe('RangeSliderComponent', () => {
    function clickThumb(thumb: HTMLElement, container: HTMLElement, pointerId: number): void {
        const eventInit: PointerEventInit = {
            bubbles: true,
            button: 0,
            clientX: 50,
            clientY: 10,
            pointerId,
            pointerType: 'mouse',
        };
        thumb.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        container.dispatchEvent(new PointerEvent('pointerup', eventInit));
    }

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RangeSliderComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();
    });

    it('clamps initial single values above the available range', () => {
        const fixture = TestBed.createComponent(RangeSliderComponent);

        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 100);
        fixture.componentRef.setInput('singleValue', 95);
        fixture.componentRef.setInput('availableRange', [10, 80]);
        fixture.detectChanges();

        expect(fixture.componentInstance.right()).toBe(80);
    });

    it('clamps initial single values below the available range', () => {
        const fixture = TestBed.createComponent(RangeSliderComponent);

        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 100);
        fixture.componentRef.setInput('singleValue', 5);
        fixture.componentRef.setInput('availableRange', [10, 80]);
        fixture.detectChanges();

        expect(fixture.componentInstance.right()).toBe(10);
    });

    it('supports a single special stop without enabling every half step', () => {
        const fixture = TestBed.createComponent(RangeSliderComponent);

        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 4);
        fixture.componentRef.setInput('value', [0.5, 1.5]);
        fixture.componentRef.setInput('availableRange', [0, 4]);
        fixture.componentRef.setInput('stepSize', 1);
        fixture.componentRef.setInput('specialValues', [0.5]);
        fixture.detectChanges();

        expect(fixture.componentInstance.left()).toBe(0.5);
        expect(fixture.componentInstance.right()).not.toBe(1.5);
        expect([1, 2]).toContain(fixture.componentInstance.right());
    });

    it('resets only the minimum boundary when the left thumb is double-clicked', () => {
        const fixture = TestBed.createComponent(RangeSliderComponent);
        const emittedValues: [number, number][] = [];

        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 100);
        fixture.componentRef.setInput('value', [40, 70]);
        fixture.componentRef.setInput('availableRange', [10, 90]);
        fixture.componentInstance.valueChange.subscribe(value => emittedValues.push(value));
        fixture.detectChanges();

        const leftThumb = fixture.nativeElement.querySelector('.thumb-left') as HTMLElement;
        const container = fixture.nativeElement.querySelector('.slider-container') as HTMLElement;
        clickThumb(leftThumb, container, 1);
        clickThumb(leftThumb, container, 1);
        fixture.detectChanges();

        expect(fixture.componentInstance.left()).toBe(10);
        expect(fixture.componentInstance.right()).toBe(70);
        expect(emittedValues[emittedValues.length - 1]).toEqual([10, 70]);
    });

    it('resets only the maximum boundary when the right thumb is double-clicked', () => {
        const fixture = TestBed.createComponent(RangeSliderComponent);
        const emittedValues: [number, number][] = [];

        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 100);
        fixture.componentRef.setInput('value', [40, 70]);
        fixture.componentRef.setInput('availableRange', [10, 90]);
        fixture.componentInstance.valueChange.subscribe(value => emittedValues.push(value));
        fixture.detectChanges();

        const rightThumb = fixture.nativeElement.querySelector('.thumb-right') as HTMLElement;
        const container = fixture.nativeElement.querySelector('.slider-container') as HTMLElement;
        clickThumb(rightThumb, container, 1);
        clickThumb(rightThumb, container, 1);
        fixture.detectChanges();

        expect(fixture.componentInstance.left()).toBe(40);
        expect(fixture.componentInstance.right()).toBe(90);
        expect(emittedValues[emittedValues.length - 1]).toEqual([40, 90]);
    });

    it('allows native double-click events and captures the pointer on the thumb', () => {
        const fixture = TestBed.createComponent(RangeSliderComponent);

        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 100);
        fixture.componentRef.setInput('value', [40, 70]);
        fixture.detectChanges();

        const event = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 });
        const preventDefaultSpy = spyOn(event, 'preventDefault').and.callThrough();
        const leftThumb = fixture.nativeElement.querySelector('.thumb-left') as HTMLElement;
        const setPointerCaptureSpy = spyOn(leftThumb, 'setPointerCapture');
        leftThumb.dispatchEvent(event);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
        expect(setPointerCaptureSpy).toHaveBeenCalledOnceWith(1);
    });
});
