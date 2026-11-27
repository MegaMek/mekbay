// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * 
 * Service for managing keyboard shortcuts. 
 * Scopes can be registered with the service, and they will be invoked in order of priority when a key event occurs. 
 * Scopes can optionally specify that they should only be active when a specific dialog is open, and that they should be allowed to receive events from text entry elements.
 */
import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';

export interface KeyboardShortcutScope {
    id: string;
    priority?: number;
    allowInTextEntry?: boolean;
    dialogRef?: object;
    active?: () => boolean;
    handle: (event: KeyboardEvent) => boolean | void;
}

interface RegisteredKeyboardShortcutScope extends KeyboardShortcutScope {
    order: number;
}

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
    private document = inject(DOCUMENT);
    private dialog = inject(Dialog, { optional: true });
    private destroyRef = inject(DestroyRef);

    private scopes: RegisteredKeyboardShortcutScope[] = [];
    private nextOrder = 0;

    private readonly onKeyDown = (event: KeyboardEvent) => {
        this.dispatch(event);
    };

    constructor() {
        const view = this.document.defaultView;
        view?.addEventListener('keydown', this.onKeyDown);
        this.destroyRef.onDestroy(() => view?.removeEventListener('keydown', this.onKeyDown));
    }

    register(scope: KeyboardShortcutScope, destroyRef?: DestroyRef): () => void {
        const entry: RegisteredKeyboardShortcutScope = {
            ...scope,
            order: this.nextOrder++,
        };
        this.scopes = [...this.scopes, entry];

        const unregister = () => {
            this.scopes = this.scopes.filter((candidate) => candidate !== entry);
        };

        destroyRef?.onDestroy(unregister);
        return unregister;
    }

    private dispatch(event: KeyboardEvent): void {
        if (event.defaultPrevented) return;

        const topDialogRef = this.getTopDialogRef();
        const scopes = this.scopes
            .filter((scope) => this.isScopeEligible(scope, topDialogRef))
            .sort((left, right) => {
                const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
                return priorityDelta !== 0 ? priorityDelta : right.order - left.order;
            });

        for (const scope of scopes) {
            if (this.shouldSkipForTextEntry(scope, event)) continue;

            if (scope.handle(event) === true) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
        }
    }

    private getTopDialogRef(): object | null {
        const openDialogs = this.dialog?.openDialogs ?? [];
        return openDialogs.length > 0
            ? openDialogs[openDialogs.length - 1]
            : null;
    }

    private isScopeEligible(scope: RegisteredKeyboardShortcutScope, topDialogRef: object | null): boolean {
        if (topDialogRef) {
            return scope.dialogRef === topDialogRef && scope.active?.() !== false;
        }

        return !scope.dialogRef && scope.active?.() !== false;
    }

    private shouldSkipForTextEntry(scope: RegisteredKeyboardShortcutScope, event: KeyboardEvent): boolean {
        if (scope.allowInTextEntry) return false;

        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;

        return Boolean(target.closest('input, textarea, select, [contenteditable]'));
    }
}
