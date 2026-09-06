// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEveryRender, DestroyRef, Directive, ElementRef, inject, input, output, untracked } from '@angular/core';

/** Page against rendered content, after filtering/placement exclusion and virtual-scroll sizing. */
@Directive({
    selector: '[forceListPaging]',
    host: { '(scroll)': 'checkForMore()' },
})
export class ForceListPagingDirective {
    readonly forceListPaging = input.required<boolean>();
    readonly forceListLoadMore = output<void>();
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private requestedSinceRender = false;

    constructor() {
        // Read after each render: a page, placement change or measured virtual row size
        // can change the scroll extent without resizing the viewport itself.
        afterEveryRender({ read: () => {
            this.requestedSinceRender = false;
            this.checkForMore();
        } });
        const observer = new ResizeObserver(() => this.checkForMore());
        observer.observe(this.element);
        inject(DestroyRef).onDestroy(() => observer.disconnect());
    }

    checkForMore(): void {
        if (!this.forceListPaging() || this.requestedSinceRender) return;
        const { clientHeight, scrollHeight, scrollTop } = this.element;
        if (clientHeight > 0 && scrollHeight - scrollTop - clientHeight <= 200) {
            // Scroll/resize can fire before Angular renders the owner's pending/error
            // state. Request at most once against each rendered view of that state.
            this.requestedSinceRender = true;
            // The owner synchronously marks the request pending and disables this trigger.
            untracked(() => this.forceListLoadMore.emit());
        }
    }
}
