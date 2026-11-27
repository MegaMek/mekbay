// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ForceDialogsService } from '../services/force-dialogs.service';
import { RoutedDialogPage } from './routed-dialog-page';

/**
 * Routed page for the TO&E organization dialog (/toe).
 * The organization to open is taken from the `toe` query parameter.
 */
@Component({
    selector: 'toe-page',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToePageComponent extends RoutedDialogPage {
    private readonly forceDialogs = inject(ForceDialogsService);

    protected override openDialog() {
        const organizationId = this.route.snapshot.queryParamMap.get('toe') ?? undefined;
        return this.forceDialogs.openForceOrgDialog(organizationId);
    }
}
