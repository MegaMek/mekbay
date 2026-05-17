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
});
