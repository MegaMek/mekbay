// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import type { ConstructionBreakdownData } from '../domain/construction-breakdowns';
import { ConstructionBreakdownComponent } from './construction-breakdown.component';

@Component({
    selector: 'construction-breakdown-dialog',
    imports: [ConstructionBreakdownComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<construction-breakdown [data]="data" (closed)="dialog.close()" />`,
    styles: [`
        :host { display:flex; flex-direction:column; width:min(860px, 94vw); max-height:72dvh; border:1px solid var(--border-color); }
    `],
})
export class ConstructionBreakdownDialogComponent {
    readonly data = inject<ConstructionBreakdownData>(DIALOG_DATA);
    readonly dialog = inject(DialogRef);
}
