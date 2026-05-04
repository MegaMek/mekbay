/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/**
 * Author: Drake
 * 
 * Service for managing keyboard shortcuts. 
 * Scopes can be registered with the service, and they will be invoked in order of priority when a key event occurs. 
 * Scopes can optionally specify that they should only be active when a specific dialog is open, and that they should be allowed to receive events from text entry elements.
 */
import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';

export interface KeyboardShortcutScope {
    id: string;
    priority?: number;
    allowInTextEntry?: boolean;
    dialogRef?: DialogRef<any, any>;
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

    private getTopDialogRef(): DialogRef<any, any> | null {
        const openDialogs = this.dialog?.openDialogs ?? [];
        return openDialogs.length > 0
            ? openDialogs[openDialogs.length - 1] as DialogRef<any, any>
            : null;
    }

    private isScopeEligible(scope: RegisteredKeyboardShortcutScope, topDialogRef: DialogRef<any, any> | null): boolean {
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