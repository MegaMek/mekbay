import { Component, viewChild } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SwipeDirective } from './swipe.directive';

@Component({
    standalone: true,
    imports: [SwipeDirective],
    template: `
        <div class="host" swipe [direction]="'horizontal'" [threshold]="1" [successRatio]="0.1">
            <button class="child" type="button">child</button>
        </div>
    `,
})
class SwipeHostComponent {
    swipe = viewChild.required<SwipeDirective>(SwipeDirective);
}

describe('SwipeDirective', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [SwipeHostComponent],
            providers: [provideZonelessChangeDetection()],
        });
    });

    function pointer(type: string, init: PointerEventInit): PointerEvent | MouseEvent {
        if (typeof PointerEvent === 'undefined') {
            return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY });
        }
        return new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, ...init });
    }

    it('cleans up when a child stops pointerup propagation', () => {
        const fixture = TestBed.createComponent(SwipeHostComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);

        try {
            const host = fixture.nativeElement.querySelector('.host') as HTMLElement;
            const child = fixture.nativeElement.querySelector('.child') as HTMLElement;
            child.addEventListener('pointerup', event => event.stopPropagation());

            host.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
            window.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 30, clientY: 0 }));
            child.dispatchEvent(pointer('pointerup', { pointerId: 1, clientX: 30, clientY: 0 }));

            expect(fixture.componentInstance.swipe().swiping()).toBeFalse();
            expect(fixture.componentInstance.swipe().startSwipe(pointer('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 }) as PointerEvent)).toBeTrue();
        } finally {
            fixture.nativeElement.remove();
        }
    });
});
