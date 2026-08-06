// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogsService } from '../services/dialogs.service';
import { RoutedDialogPage } from './routed-dialog-page';

/**
 * Routed page for the collection dialog (/collection).
 */
@Component({
    selector: 'collection-page',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionPageComponent extends RoutedDialogPage {
    private readonly dialogsService = inject(DialogsService);

    protected override async openDialog() {
        const { CollectionDialogComponent } = await import('../components/collection-dialog/collection-dialog.component');
        return this.dialogsService.createDialog(CollectionDialogComponent);
    }
}
