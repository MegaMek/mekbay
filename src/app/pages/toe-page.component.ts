// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ForceBuilderService } from '../services/force-builder.service';
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
    private readonly forceBuilderService = inject(ForceBuilderService);

    protected override openDialog() {
        const organizationId = this.route.snapshot.queryParamMap.get('toe') ?? undefined;
        return this.forceBuilderService.openForceOrgDialog(organizationId);
    }
}
