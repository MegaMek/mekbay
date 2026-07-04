import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HexSliderComponent } from './hex-slider.component';

describe('HexSliderComponent', () => {
    let fixture: ComponentFixture<HexSliderComponent>;
    let component: HexSliderComponent;
    let valueChanges: number[];
    let valueCommits: number[];

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HexSliderComponent],
        });
        fixture = TestBed.createComponent(HexSliderComponent);
        component = fixture.componentInstance;
        valueChanges = [];
        valueCommits = [];
        component.valueChange.subscribe(value => {
            valueChanges.push(value);
            fixture.componentRef.setInput('value', value);
            fixture.detectChanges();
        });
        component.valueCommit.subscribe(value => valueCommits.push(value));
        fixture.componentRef.setInput('min', 0);
        fixture.componentRef.setInput('max', 10);
        fixture.componentRef.setInput('step', 1);
        fixture.componentRef.setInput('value', 0);
        fixture.detectChanges();
        const scale = fixture.nativeElement.querySelector('.slider-scale') as HTMLDivElement;
        spyOn(scale, 'getBoundingClientRect').and.returnValue({
            left: 0,
            top: 0,
            right: 100,
            bottom: 20,
            width: 100,
            height: 20,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
    });

    afterEach(() => {
        window.dispatchEvent(pointerEvent('pointercancel', 1, 0));
    });

    it('emits drag value changes continuously but commits once on release', () => {
        const slider = fixture.nativeElement.querySelector('.hex-slider') as HTMLDivElement;

        slider.dispatchEvent(pointerEvent('pointerdown', 1, 20));
        window.dispatchEvent(pointerEvent('pointermove', 1, 50));
        window.dispatchEvent(pointerEvent('pointerup', 1, 50));

        expect(valueChanges).toEqual([2, 5]);
        expect(valueCommits).toEqual([5]);
    });

    it('does not commit a drag that ends on its starting value', () => {
        fixture.componentRef.setInput('value', 2);
        fixture.detectChanges();
        const slider = fixture.nativeElement.querySelector('.hex-slider') as HTMLDivElement;

        slider.dispatchEvent(pointerEvent('pointerdown', 1, 50));
        window.dispatchEvent(pointerEvent('pointermove', 1, 20));
        window.dispatchEvent(pointerEvent('pointerup', 1, 20));

        expect(valueChanges).toEqual([5, 2]);
        expect(valueCommits).toEqual([]);
    });

    it('commits keyboard value changes immediately', () => {
        const slider = fixture.nativeElement.querySelector('.hex-slider') as HTMLDivElement;

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

        expect(valueChanges).toEqual([1]);
        expect(valueCommits).toEqual([1]);
    });

    it('uses tick label overrides without replacing other generated tick labels', () => {
        fixture.componentRef.setInput('tickLabelOverrides', { 8: 'RUN', 10: 'MASC' });
        fixture.detectChanges();

        const labels = Array.from(fixture.nativeElement.querySelectorAll('.tick-label'))
            .map(label => (label as HTMLElement).textContent);

        expect(labels[0]).toBe('0');
        expect(labels[8]).toBe('RUN');
        expect(labels[10]).toBe('MASC');
    });
});

function pointerEvent(type: string, pointerId: number, clientX: number): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        pointerId,
        clientX,
        clientY: 0,
    });
}