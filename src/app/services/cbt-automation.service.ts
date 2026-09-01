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

interface PendingAutomationReview {
    readonly events: AutomationReviewEvent[];
    readonly callers: Array<Readonly<{
        eventIds: ReadonlySet<string>;
        resolve: (result: ReadonlySet<string> | null) => void;
        reject: (reason?: unknown) => void;
    }>>;
    readonly options: AutomationReviewOptions;
}

@Injectable({ providedIn: 'root' })
export class CBTAutomationService {
    private readonly options = inject(OptionsService);
    private readonly review = inject(AutomationReviewService);
    /** Same-boundary family requests share the one origin/next review dialog. */
    private readonly pendingReviews = new Map<string, PendingAutomationReview>();

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
            case 'ask': return this.enqueueReview(key, events, options);
        }
    }

    private enqueueReview(
        key: CBTAutomationKey,
        events: readonly AutomationReviewEvent[],
        options: AutomationReviewOptions,
    ): Promise<ReadonlySet<string> | null> {
        const batchKey = automationReviewBatchKey(key, options);
        return new Promise((resolve, reject) => {
            const caller = Object.freeze({
                eventIds: new Set(events.map(event => event.id)),
                resolve,
                reject,
            });
            const pending = this.pendingReviews.get(batchKey);
            if (pending) {
                for (const event of events) {
                    if (!pending.events.some(candidate => candidate.id === event.id)) {
                        pending.events.push(event);
                    }
                }
                pending.callers.push(caller);
                return;
            }
            this.pendingReviews.set(batchKey, {
                events: [...events],
                callers: [caller],
                options,
            });
            queueMicrotask(() => void this.flushReview(batchKey));
        });
    }

    private async flushReview(batchKey: string): Promise<void> {
        const pending = this.pendingReviews.get(batchKey);
        if (!pending) return;
        this.pendingReviews.delete(batchKey);
        let accepted: ReadonlySet<string> | null;
        try {
            accepted = await this.review.review(Object.freeze(pending.events), pending.options);
        } catch (error) {
            pending.callers.forEach(caller => caller.reject(error));
            return;
        }
        for (const caller of pending.callers) {
            caller.resolve(accepted === null
                ? null
                : new Set([...accepted].filter(id => caller.eventIds.has(id))));
        }
    }
}

function automationReviewBatchKey(
    key: CBTAutomationKey,
    options: AutomationReviewOptions,
): string {
    return JSON.stringify([
        key,
        options.title ?? '',
        options.message ?? '',
        options.allowCancel ?? false,
    ]);
}
