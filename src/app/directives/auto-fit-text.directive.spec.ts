// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AUTO_FIT_RESIZE_OBSERVER_FACTORY, AutoFitTextDirective, calculateTextFit, hasTextFitWidthChanged, shouldAutoFitText } from './auto-fit-text.directive';

@Component({
    imports: [AutoFitTextDirective],
    template: `<span
        [mbAutoFitText]="text()"
        [mbAutoFitTextMinCharacters]="minCharacters()"
        [mbAutoFitTextObserveWidth]="observeWidth()"
        [mbAutoFitTextRevision]="revision()">{{ text() }}</span>`,
})
class AutoFitTextHostComponent {
    readonly text = signal('Short');
    readonly minCharacters = signal(12);
    readonly observeWidth = signal(true);
    readonly revision = signal(0);
}

describe('calculateTextFit', () => {
    it('keeps text at its inherited size when it fits', () => {
        expect(calculateTextFit(120, 100)).toEqual({ fontScale: 1, wraps: false });
    });

    it('keeps exact-width text at its inherited size', () => {
        expect(calculateTextFit(120, 120)).toEqual({ fontScale: 1, wraps: false });
    });

    it('reduces overflowing text enough to fit on one line', () => {
        expect(calculateTextFit(120, 150)).toEqual({ fontScale: 0.8, wraps: false });
    });

    it('uses the readable minimum and permits wrapping when scaling is insufficient', () => {
        expect(calculateTextFit(100, 200, 0.55)).toEqual({ fontScale: 0.55, wraps: true });
    });

    it('clamps invalid minimum scales to safe values', () => {
        expect(calculateTextFit(50, 100, 2)).toEqual({ fontScale: 1, wraps: true });
        expect(calculateTextFit(5, 100, 0)).toEqual({ fontScale: 0.1, wraps: true });
        expect(calculateTextFit(80, 100, Number.NaN)).toEqual({ fontScale: 0.8, wraps: false });
    });

    it('does not produce invalid scaling for hidden or invalid geometry', () => {
        expect(calculateTextFit(0, 100)).toEqual({ fontScale: 1, wraps: false });
        expect(calculateTextFit(100, 0)).toEqual({ fontScale: 1, wraps: false });
        expect(calculateTextFit(Number.NaN, 100)).toEqual({ fontScale: 1, wraps: false });
        expect(calculateTextFit(100, Number.POSITIVE_INFINITY)).toEqual({ fontScale: 1, wraps: false });
    });
});

describe('hasTextFitWidthChanged', () => {
    it('detects initial and significant width changes', () => {
        expect(hasTextFitWidthChanged(null, 100)).toBeTrue();
        expect(hasTextFitWidthChanged(100, 100.5)).toBeTrue();
        expect(hasTextFitWidthChanged(100, 99.5)).toBeTrue();
    });

    it('ignores subpixel jitter that could cause layout feedback', () => {
        expect(hasTextFitWidthChanged(100, 100.49)).toBeFalse();
        expect(hasTextFitWidthChanged(100, 99.51)).toBeFalse();
    });

    it('ignores invalid observed widths', () => {
        expect(hasTextFitWidthChanged(100, -1)).toBeFalse();
        expect(hasTextFitWidthChanged(100, Number.NaN)).toBeFalse();
        expect(hasTextFitWidthChanged(100, Number.POSITIVE_INFINITY)).toBeFalse();
    });
});

describe('shouldAutoFitText', () => {
    it('uses twelve trimmed characters as the default boundary', () => {
        expect(shouldAutoFitText('12345678901')).toBeFalse();
        expect(shouldAutoFitText('123456789012')).toBeTrue();
        expect(shouldAutoFitText('  123456789012  ')).toBeTrue();
    });

    it('supports configurable and normalized character thresholds', () => {
        expect(shouldAutoFitText('12345', 5)).toBeTrue();
        expect(shouldAutoFitText('12345', 6)).toBeFalse();
        expect(shouldAutoFitText('', 0)).toBeFalse();
        expect(shouldAutoFitText('   ', 0)).toBeFalse();
        expect(shouldAutoFitText('12345678901', Number.NaN)).toBeFalse();
    });
});

describe('AutoFitTextDirective character bypass', () => {
    let observerCount: number;
    let disconnectCount: number;

    class ResizeObserverStub implements ResizeObserver {
        constructor(_callback: ResizeObserverCallback) {
            observerCount += 1;
        }

        observe(): void { }
        unobserve(): void { }
        disconnect(): void {
            disconnectCount += 1;
        }
    }

    beforeEach(async () => {
        observerCount = 0;
        disconnectCount = 0;
        await TestBed.configureTestingModule({
            imports: [AutoFitTextHostComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: AUTO_FIT_RESIZE_OBSERVER_FACTORY,
                    useValue: (callback: ResizeObserverCallback) => new ResizeObserverStub(callback),
                },
            ],
        }).compileComponents();
    });

    it('does not observe or style text below the threshold', async () => {
        const fixture = TestBed.createComponent(AutoFitTextHostComponent);
        fixture.detectChanges();
        await fixture.whenStable();

        const text = fixture.nativeElement.querySelector('span') as HTMLElement;
        expect(observerCount).toBe(0);
        expect(text.style.fontSize).toBe('');
        expect(text.style.whiteSpace).toBe('');
        fixture.destroy();
    });

    it('stops observing and resets styles when a recycled value becomes short', async () => {
        const fixture = TestBed.createComponent(AutoFitTextHostComponent);
        const component = fixture.componentInstance;
        component.text.set('Motorized Conventional Infantry');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(observerCount).toBe(1);

        component.text.set('Short');
        fixture.detectChanges();
        await fixture.whenStable();

        const text = fixture.nativeElement.querySelector('span') as HTMLElement;
        expect(disconnectCount).toBe(1);
        expect(text.style.fontSize).toBe('');
        expect(text.style.whiteSpace).toBe('');
        fixture.destroy();
    });

    it('fits eligible text without creating an observer when width observation is disabled', async () => {
        const fixture = TestBed.createComponent(AutoFitTextHostComponent);
        const component = fixture.componentInstance;
        component.text.set('Motorized Conventional Infantry');
        component.observeWidth.set(false);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(observerCount).toBe(0);
        fixture.destroy();
    });

    it('disconnects and reconnects when width observation changes at runtime', async () => {
        const fixture = TestBed.createComponent(AutoFitTextHostComponent);
        const component = fixture.componentInstance;
        component.text.set('Motorized Conventional Infantry');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(observerCount).toBe(1);

        component.observeWidth.set(false);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(disconnectCount).toBe(1);

        component.observeWidth.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(observerCount).toBe(2);
        fixture.destroy();
    });

    it('remeasures observer-free text when its external revision changes', async () => {
        const fixture = TestBed.createComponent(AutoFitTextHostComponent);
        const component = fixture.componentInstance;
        component.text.set('Motorized Conventional Infantry');
        component.observeWidth.set(false);
        fixture.detectChanges();
        await fixture.whenStable();

        const directive = fixture.debugElement.children[0].injector.get(AutoFitTextDirective);
        const measure = spyOn<any>(directive, 'measure').and.callThrough();
        component.revision.update(value => value + 1);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(measure).toHaveBeenCalled();
        expect(observerCount).toBe(0);
        fixture.destroy();
    });
});
