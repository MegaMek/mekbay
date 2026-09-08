// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogsService } from '../services/dialogs.service';
import { RoutedDialogPage } from './routed-dialog-page';
import type { UnitConstructionComponent } from '../construction/unit-construction.component';

@Component({ selector: 'unit-construction-page', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class UnitConstructionPageComponent extends RoutedDialogPage {
    private readonly dialogs = inject(DialogsService);
    private editor?: UnitConstructionComponent;

    canDeactivate(): Promise<boolean> | boolean {
        return this.editor?.canLeave() ?? true;
    }

    protected override async openDialog() {
        const { UnitConstructionComponent } = await import('../construction/unit-construction.component');
        const ref = this.dialogs.createDialog(UnitConstructionComponent, { disableClose: true });
        this.editor = ref.componentInstance;
        return ref;
    }
}
