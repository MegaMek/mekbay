/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Directive, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { DialogRef } from '../services/dialogs.service';

/*
 * Author: Drake
 */

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
