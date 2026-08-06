// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Directive, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { DialogRef } from '../services/dialogs.service';

/**
 * Base class for routes that present a fullscreen dialog as an app "page"
 * (e.g. /toe, /forcegenerator, /collection).
 *
 * - On activation it opens the dialog.
 * - When the dialog is closed by the user, it navigates back to '/'
 *   (query params are preserved).
 * - When the route is deactivated (e.g. browser back), it closes the dialog.
 */
@Directive()
export abstract class RoutedDialogPage implements OnInit, OnDestroy {
    protected readonly router = inject(Router);
    protected readonly route = inject(ActivatedRoute);

    private dialogRef: DialogRef | null = null;
    private destroyed = false;

    /**
     * Opens the page's dialog. Return null to abort and navigate back home
     * (e.g. when required data could not be loaded).
     */
    protected abstract openDialog(): Promise<DialogRef | null> | DialogRef | null;

    async ngOnInit(): Promise<void> {
        const ref = await this.openDialog();
        if (this.destroyed) {
            ref?.close();
            return;
        }
        if (!ref) {
            this.navigateHome();
            return;
        }
        this.dialogRef = ref;
        ref.closed.subscribe(() => {
            if (!this.destroyed) {
                this.navigateHome();
            }
        });
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.dialogRef?.close();
    }

    private navigateHome(): void {
        void this.router.navigate(['/'], { queryParamsHandling: 'preserve' });
    }
}
