import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SimpleSliderComponent } from './simple-slider.component';

describe('SimpleSliderComponent', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [SimpleSliderComponent],
            providers: [provideZonelessChangeDetection()],
        });
    });

    function createComponent(value = 50) {
        const fixture = TestBed.createComponent(SimpleSliderComponent);
        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 100);
        fixture.componentRef.setInput('step', 5);
        fixture.componentRef.setInput('value', value);
        fixture.detectChanges();
        return fixture;
    }

    it('positions the styled thumb and fill from the current value', () => {
        const fixture = createComponent(25);
        const container = fixture.nativeElement.querySelector('.simple-slider-container') as HTMLElement;
        const fill = fixture.nativeElement.querySelector('.simple-slider-fill') as HTMLElement;

        expect(container.style.getPropertyValue('--simple-slider-thumb-left')).toBe('25%');
        expect(fill.style.width).toBe('25%');
    });

    it('keeps the visual track on the same min/max bounds as the thumb', () => {
        const fixture = createComponent();
        const track = fixture.nativeElement.querySelector('.simple-slider-track') as HTMLElement;
        const style = getComputedStyle(track);

        expect(style.marginLeft).toBe('0px');
        expect(style.width).not.toContain('calc');
    });

    it('emits value changes from the native range input', () => {
        const fixture = createComponent();
        const emitted: number[] = [];
        fixture.componentInstance.valueChange.subscribe(value => emitted.push(value));
        const input = fixture.nativeElement.querySelector('.simple-slider-input') as HTMLInputElement;

        input.value = '75';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        expect(emitted).toEqual([75]);
    });

    it('clamps the displayed percent to the slider range', () => {
        const fixture = createComponent(150);
        const container = fixture.nativeElement.querySelector('.simple-slider-container') as HTMLElement;

        expect(container.style.getPropertyValue('--simple-slider-thumb-left')).toBe('100%');
    });
});
