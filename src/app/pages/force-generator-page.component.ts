// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ForceBuilderService } from '../services/force-builder.service';
import { RoutedDialogPage } from './routed-dialog-page';

/**
 * Routed page for the force generator dialog (/forcegenerator).
 * The optional `importCurrentForce` flag is passed via navigation state.
 */
@Component({
    selector: 'force-generator-page',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForceGeneratorPageComponent extends RoutedDialogPage {
    private readonly forceBuilderService = inject(ForceBuilderService);

    /** Navigation state must be read during construction (while the navigation is running). */
    private readonly importCurrentForce =
        (this.router.currentNavigation()?.extras?.state ?? history.state)?.importCurrentForce === true;

    protected override openDialog() {
        return this.forceBuilderService.openSearchForceGeneratorDialog({
            importCurrentForce: this.importCurrentForce,
        });
    }
}
