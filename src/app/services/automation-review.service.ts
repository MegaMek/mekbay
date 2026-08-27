// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AutomationReviewDialogComponent } from '../components/automation-review-dialog/automation-review-dialog.component';
import type { AutomationReviewDialogData, AutomationReviewEvent, AutomationReviewResult } from '../models/automation-review.model';
import { DialogsService } from './dialogs.service';

export interface AutomationReviewOptions {
    title?: string;
    message?: string;
    allowCancel?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AutomationReviewService {
    private readonly dialogsService = inject(DialogsService);

    /** Returns accepted event IDs, or null when the whole triggering action was cancelled. */
    async review(
        events: readonly AutomationReviewEvent[],
        options: AutomationReviewOptions = {},
    ): Promise<ReadonlySet<string> | null> {
        if (events.length === 0) return new Set<string>();

        const ref = this.dialogsService.createDialog<AutomationReviewResult | undefined>(
            AutomationReviewDialogComponent,
            {
                disableClose: true,
                data: <AutomationReviewDialogData>{
                    title: options.title ?? 'Review Automations',
                    message: options.message
                        ?? 'Accept or skip each event.',
                    events,
                    allowCancel: options.allowCancel ?? false,
                },
            },
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return null;

        const knownEventIds = new Set(events.map(event => event.id));
        return new Set(result.acceptedEventIds.filter(id => knownEventIds.has(id)));
    }
}
