// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, Directive, ElementRef, computed, effect, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { InspectorInteraction } from '../components/floating-comp-info/inspector-interaction';

@Directive({
    selector: '[inspectorHover]',
    host: {
        '[class.inspector-active]': 'active()',
        '(pointerenter)': 'onPointerEnter($event)',
        '(pointerleave)': 'onPointerLeave($event)',
        '(pointerdown)': 'cancelHover()',
        '(pointercancel)': 'cancelHover()',
        '(click)': 'cancelHover()',
        '(keydown)': 'cancelHover()',
        '(dragstart)': 'onDragStart()',
    },
})
export class InspectorHoverDirective {
    readonly inspectorHover = input.required<InspectorInteraction>();
    readonly inspectorHoverDisabled = input(false);
    readonly inspect = output<HTMLElement>();
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
    protected readonly active = computed(() => this.inspectorHover().isOpen()
        && this.inspectorHover().trigger === this.element.nativeElement);

    constructor() {
        inject(DestroyRef).onDestroy(() => this.inspectorHover().closeForTrigger(this.element.nativeElement, true));
        inject(CdkDrag, { optional: true })?.started.pipe(takeUntilDestroyed()).subscribe(() => this.onDragStart());
        effect(() => {
            if (this.inspectorHoverDisabled()) this.inspectorHover().closeForTrigger(this.element.nativeElement, true);
        });
    }

    onPointerEnter(event: PointerEvent): void {
        this.cancelHover();
        if (event.pointerType !== 'mouse' || event.buttons !== 0 || this.inspectorHoverDisabled()) return;
        this.inspectorHover().hover(this.element.nativeElement, () => {
            if (!this.inspectorHoverDisabled()) this.inspect.emit(this.element.nativeElement);
        });
    }

    onPointerLeave(event: PointerEvent): void {
        if (event.pointerType === 'mouse') this.inspectorHover().leave(this.element.nativeElement);
    }

    onDragStart(): void {
        this.inspectorHover().closeForTrigger(this.element.nativeElement);
    }

    cancelHover(): void {
        this.inspectorHover().cancelHover(this.element.nativeElement);
    }
}
