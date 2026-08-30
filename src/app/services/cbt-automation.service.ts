// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTAutomationKey } from '../models/options.model';
import {
    AutomationReviewService,
    type AutomationReviewOptions,
} from './automation-review.service';
import { OptionsService } from './options.service';

@Injectable({ providedIn: 'root' })
export class CBTAutomationService {
    private readonly options = inject(OptionsService);
    private readonly review = inject(AutomationReviewService);

    /** `yes` accepts all, `no` accepts none, and `ask` opens one shared review. */
    async resolve(
        key: CBTAutomationKey,
        events: readonly AutomationReviewEvent[],
        options: AutomationReviewOptions = {},
    ): Promise<ReadonlySet<string> | null> {
        if (events.length === 0) return new Set<string>();
        switch (this.options.cbtAutomationMode(key)) {
            case 'yes': return new Set(events.map(event => event.id));
            case 'no': return new Set<string>();
            case 'ask': return this.review.review(events, options);
        }
    }
}
