// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { SwipeDirective } from '../../directives/swipe.directive';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { DialogsService } from '../../services/dialogs.service';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent gestures', () => {
    let layout: {
        isPhone: WritableSignal<boolean>;
        isTablet: WritableSignal<boolean>;
        isDesktop: WritableSignal<boolean>;
        windowWidth: WritableSignal<number>;
        windowHeight: WritableSignal<number>;
        menuOpenRatio: WritableSignal<number>;
        isMenuOpen: WritableSignal<boolean>;
        isMenuDragging: WritableSignal<boolean>;
    };
    let options: {
        options: WritableSignal<{ sidebarLipPosition?: string }>;
        setOption: jasmine.Spy;
    };

    beforeEach(() => {
        layout = {
            isPhone: signal(true),
            isTablet: signal(false),
            isDesktop: signal(false),
            windowWidth: signal(390),
            windowHeight: signal(844),
            menuOpenRatio: signal(0),
            isMenuOpen: signal(false),
            isMenuDragging: signal(false),
        };
        options = {
            options: signal({}),
            setOption: jasmine.createSpy('setOption'),
        };

        TestBed.configureTestingModule({
            imports: [SidebarComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LayoutService, useValue: layout },
                { provide: OptionsService, useValue: options },
                { provide: DialogsService, useValue: { showNextDialog: jasmine.createSpy('showNextDialog') } },
            ],
        });
        TestBed.overrideComponent(SidebarComponent, {
            set: {
                imports: [SwipeDirective],
                template: `
                    <button class="under-edge">Underlying control</button>
                    <div class="drawer"
                        swipe
                        [direction]="'horizontal'"
                        [threshold]="1"
                        [dragDimensions]="getDragDimension"
                        (swipestart)="onSwipeStart($event)"
                        (swiperatio)="onSwipeRatio($event)"
                        (swipeend)="onSwipeEnd($event)"
                        (swipecancel)="onSwipeCancel()">
                        <button #burgerLipBtn class="burger-lip-btn glass"
                            (pointerdown)="onLipPointerDown($event)"
                            (click)="onLipButtonClick()">
                            Toggle
                        </button>
                    </div>
                `,
            },
        });
    });

    function pointer(type: string, init: PointerEventInit): PointerEvent {
        return new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: 'touch',
            isPrimary: true,
            ...init,
        });
    }

    it('observes an edge tap without consuming the underlying control event', () => {
        const fixture = TestBed.createComponent(SidebarComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);

        try {
            const swipe = fixture.debugElement.query(By.directive(SwipeDirective)).injector.get(SwipeDirective);
            const startSwipe = spyOn(swipe, 'startSwipe').and.callThrough();
            const control = fixture.nativeElement.querySelector('.under-edge') as HTMLButtonElement;
            const clickSpy = jasmine.createSpy('click');
            control.addEventListener('click', clickSpy);
            const down = pointer('pointerdown', { pointerId: 1, clientX: 12, clientY: 100 });
            const up = pointer('pointerup', { pointerId: 1, clientX: 12, clientY: 100 });

            control.dispatchEvent(down);
            control.dispatchEvent(up);
            control.click();

            expect(startSwipe).toHaveBeenCalledOnceWith(down);
            expect(down.defaultPrevented).toBeFalse();
            expect(up.defaultPrevented).toBeFalse();
            expect(clickSpy).toHaveBeenCalledTimes(1);
        } finally {
            fixture.nativeElement.remove();
            fixture.destroy();
        }
    });

    it('keeps a lip tap clickable', () => {
        const fixture = TestBed.createComponent(SidebarComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);

        try {
            const lip = fixture.nativeElement.querySelector('.burger-lip-btn') as HTMLButtonElement;
            const down = pointer('pointerdown', { pointerId: 1, clientX: 12, clientY: 100 });
            const up = pointer('pointerup', { pointerId: 1, clientX: 12, clientY: 100 });

            lip.dispatchEvent(down);
            lip.dispatchEvent(up);
            lip.click();

            expect(down.defaultPrevented).toBeFalse();
            expect(up.defaultPrevented).toBeFalse();
            expect(layout.isMenuOpen()).toBeTrue();
        } finally {
            fixture.nativeElement.remove();
            fixture.destroy();
        }
    });

    it('does not turn a horizontal lip swipe into a second click action', () => {
        const fixture = TestBed.createComponent(SidebarComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);

        try {
            const lip = fixture.nativeElement.querySelector('.burger-lip-btn') as HTMLButtonElement;
            lip.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 12, clientY: 100 }));
            window.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 80, clientY: 100 }));
            window.dispatchEvent(pointer('pointerup', { pointerId: 1, clientX: 80, clientY: 100 }));

            expect(layout.isMenuOpen()).toBeTrue();
            lip.click();
            expect(layout.isMenuOpen()).toBeTrue();
        } finally {
            fixture.nativeElement.remove();
            fixture.destroy();
        }
    });

    it('keeps vertical lip repositioning separate from click and sidebar swipe', () => {
        const fixture = TestBed.createComponent(SidebarComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);

        try {
            const lip = fixture.nativeElement.querySelector('.burger-lip-btn') as HTMLButtonElement;
            lip.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 12, clientY: 100 }));
            window.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 12, clientY: 130 }));
            window.dispatchEvent(pointer('pointerup', { pointerId: 1, clientX: 12, clientY: 130 }));
            lip.click();

            expect(options.setOption).toHaveBeenCalledOnceWith(
                'sidebarLipPosition',
                jasmine.stringMatching(/^\d+$/u),
            );
            expect(layout.isMenuOpen()).toBeFalse();
        } finally {
            fixture.nativeElement.remove();
            fixture.destroy();
        }
    });
});
