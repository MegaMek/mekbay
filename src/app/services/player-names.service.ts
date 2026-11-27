// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject, signal } from '@angular/core';
import { WsService, type WsMessage } from './ws.service';
import { LoggerService } from './logger.service';

/** The server's per-request lookup limit. */
const MAX_LOOKUP = 100;

type DisplayNamesResponse = WsMessage & { readonly names?: Readonly<Record<string, string>> };

/**
 * Other players' display names, e.g. the creators of public tags and shared units.
 * Looked up by publicId on first display and refreshed on every connection.
 * Names are mutable and not unique, so they are presentation only: the publicId
 * stays the identity and is never derived from a name.
 */
@Injectable({ providedIn: 'root' })
export class PlayerNamesService {
    private readonly ws = inject(WsService);
    private readonly logger = inject(LoggerService);
    /** Resolved lookups; null means the player has no display name. */
    private readonly names = signal<ReadonlyMap<string, string | null>>(new Map());
    private readonly queued = new Set<string>();
    private flushing = false;

    constructor() {
        // Names can change between sessions; also retries lookups queued while offline.
        this.ws.registerMessageHandler('userState', () => {
            for (const publicId of this.names().keys()) this.queued.add(publicId);
            void this.flush();
        });
    }

    /** `@name`, or `@` and the short publicId while the player is nameless or not resolved yet. */
    label(publicId: string): string {
        const names = this.names();
        if (!names.has(publicId)) this.request(publicId);
        return '@' + (names.get(publicId) ?? publicId.slice(0, 8));
    }

    private request(publicId: string): void {
        if (this.queued.has(publicId)) return;
        this.queued.add(publicId);
        // label() runs in templates and computeds, which must not write signals.
        queueMicrotask(() => void this.flush());
    }

    private async flush(): Promise<void> {
        if (this.flushing || !this.ws.wsConnected()) return;
        this.flushing = true;
        try {
            while (this.queued.size > 0) {
                const batch = [...this.queued].slice(0, MAX_LOOKUP);
                const response = await this.ws.sendAndWaitForResponse<DisplayNamesResponse>(
                    { action: 'getDisplayNames', publicIds: batch },
                    { suppressGlobalError: true },
                );
                const names = response?.names;
                // Offline or failed: keep them queued for the next connection.
                if (!names) return;
                for (const publicId of batch) this.queued.delete(publicId);
                this.names.update(current => {
                    const next = new Map(current);
                    for (const publicId of batch) next.set(publicId, names[publicId] ?? null);
                    return next;
                });
            }
        } catch (err) {
            this.logger.error('Failed to resolve player names: ' + err);
        } finally {
            this.flushing = false;
        }
    }
}
