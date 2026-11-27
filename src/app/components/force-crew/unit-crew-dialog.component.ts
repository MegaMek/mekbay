// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import type { Force } from '../../models/force.model';
import { ForceUnitCrewComponent } from './force-unit-crew.component';

export interface UnitCrewDialogData { readonly force: Force; readonly unitId: string; }

/** A unit's actual stations remain available when every station is vacant. */
@Component({
    selector: 'unit-crew-dialog',
    imports: [ForceUnitCrewComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <div class="wide-dialog">
            <h2 class="wide-dialog-title">Crew</h2>
            <div class="wide-dialog-body"><force-unit-crew [force]="data.force" [unitId]="data.unitId" layout="rows" /></div>
            <div class="wide-dialog-actions"><button type="button" class="bt-button" (click)="dialog.close()">DISMISS</button></div>
        </div>
    `,
})
export class UnitCrewDialogComponent {
    readonly data = inject<UnitCrewDialogData>(DIALOG_DATA);
    readonly dialog = inject(DialogRef);
}
