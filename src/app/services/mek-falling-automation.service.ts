// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
    FallingDamageDialogComponent,
    resolveAutomaticFallingDamage,
    type FallingDamageDialogData,
    type FallingDamageDialogResult,
} from '../components/falling-damage-dialog/falling-damage-dialog.component';
import {
    FallingNoticeDialogComponent,
    type FallingNoticeDialogData,
} from '../components/falling-notice-dialog/falling-notice-dialog.component';
import { DialogsService } from './dialogs.service';
import { OptionsService } from './options.service';

/** Presents the origin/next falling workflow while keeping runtime data neutral. */
@Injectable({ providedIn: 'root' })
export class MekFallingAutomationService {
    private readonly dialogs = inject(DialogsService);
    private readonly options = inject(OptionsService);

    async resolve(data: FallingDamageDialogData): Promise<FallingDamageDialogResult | null> {
        switch (this.options.cbtAutomationMode('fallingCheck')) {
            case 'no':
                return Object.freeze({ action: 'skip' });
            case 'yes': {
                const result = resolveAutomaticFallingDamage(data);
                const notice = this.dialogs.createDialog<void, FallingNoticeDialogComponent, FallingNoticeDialogData>(
                    FallingNoticeDialogComponent,
                    {
                        disableClose: true,
                        data: { unitName: data.unitName, orientation: result.orientation },
                    },
                );
                await firstValueFrom(notice.closed);
                return result;
            }
            case 'ask': {
                const ref = this.dialogs.createDialog<FallingDamageDialogResult>(
                    FallingDamageDialogComponent,
                    { disableClose: false, data },
                );
                return (await firstValueFrom(ref.closed)) ?? null;
            }
        }
    }
}
