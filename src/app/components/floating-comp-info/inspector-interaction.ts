// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal } from '@angular/core';

export const INSPECTOR_HOVER_DELAY_MS = 300;

/** Shared trigger/panel timing and click pinning for component inspectors. */
export class InspectorInteraction {
    private readonly mode = signal<'closed' | 'hover' | 'click'>('closed');
    readonly isOpen = computed(() => this.mode() !== 'closed');
    readonly isPinned = computed(() => this.mode() === 'click');
    private readonly anchor = signal<HTMLElement | null>(null);
    private pendingAnchor: HTMLElement | null = null;
    private showTimeout: ReturnType<typeof setTimeout> | null = null;
    private hideTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly onClose: () => void = () => {}) {}

    get trigger(): HTMLElement | null {
        return this.anchor();
    }

    hover(anchor: HTMLElement, show: () => void): void {
        this.enter();
        this.cancelHover();
        if (this.isPinned() || (this.isOpen() && this.anchor() === anchor)) return;
        this.pendingAnchor = anchor;
        this.showTimeout = setTimeout(() => {
            this.showTimeout = null;
            this.pendingAnchor = null;
            show();
        }, INSPECTOR_HOVER_DELAY_MS);
    }

    open(anchor: HTMLElement, byHover = false): boolean {
        if (byHover && this.isPinned()) return false;
        this.cancelHover();
        this.enter();
        this.anchor.set(anchor);
        this.mode.set(byHover ? 'hover' : 'click');
        return true;
    }

    cancelHover(anchor?: HTMLElement): void {
        if (anchor && this.pendingAnchor !== anchor) return;
        if (this.showTimeout !== null) clearTimeout(this.showTimeout);
        this.showTimeout = null;
        this.pendingAnchor = null;
    }

    enter(): void {
        if (this.hideTimeout !== null) clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
    }

    leave(anchor?: HTMLElement): void {
        this.cancelHover(anchor);
        if (this.mode() !== 'hover') return;
        this.enter();
        this.hideTimeout = setTimeout(() => this.close(), INSPECTOR_HOVER_DELAY_MS);
    }

    closeForTrigger(anchor: HTMLElement, hoverOnly = false): void {
        this.cancelHover(anchor);
        if (this.anchor() === anchor && (!hoverOnly || !this.isPinned())) this.close();
    }

    closeOutside(target: EventTarget | null, panel: HTMLElement): void {
        if (target instanceof Node && !panel.contains(target) && !this.anchor()?.contains(target)) this.close();
    }

    close(): void {
        this.cancelHover();
        this.enter();
        this.anchor.set(null);
        if (!this.isOpen()) return;
        this.mode.set('closed');
        this.onClose();
    }
}
