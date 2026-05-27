import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RangeSliderComponent } from './range-slider.component';

describe('RangeSliderComponent', () => {
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
});
