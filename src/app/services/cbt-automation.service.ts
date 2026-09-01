// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTAutomationKey } from '../models/options.model';
import { AutomationReviewService, type AutomationReviewOptions } from './automation-review.service';
import { OptionsService } from './options.service';

@Injectable({ providedIn: 'root' })
export class CBTAutomationService {
    private readonly optionsService = inject(OptionsService);
    private readonly automationReview = inject(AutomationReviewService);

    /**
     * Resolves one automation's configured policy. `yes` accepts every event,
     * `no` accepts none, and `ask` delegates the choice to the shared review UI.
     * A null result means the user cancelled the triggering action.
     */
    async resolve(
        key: CBTAutomationKey,
        events: readonly AutomationReviewEvent[],
        options: AutomationReviewOptions = {},
    ): Promise<ReadonlySet<string> | null> {
        if (events.length === 0) return new Set<string>();

        switch (this.optionsService.cbtAutomationMode(key)) {
            case 'yes':
                return new Set(events.map(event => event.id));
            case 'no':
                return new Set<string>();
            case 'ask':
                return this.automationReview.review(events, options);
        }
    }
}
