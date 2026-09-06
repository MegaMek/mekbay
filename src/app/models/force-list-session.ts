// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LoadForceEntry } from './load-force-entry.model';

export interface ForceListCursor {
    readonly timestamp: number;
    readonly instanceId: string;
}

export interface ForceListPage {
    readonly entries: readonly LoadForceEntry[];
    readonly next?: ForceListCursor;
}

function timestamp(entry: LoadForceEntry): number {
    return Date.parse(entry.timestamp) || 0;
}

function compareId(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** One dialog's summaries and cursor. Concurrent scroll/search requests share the same page. */
export class ForceListSession {
    private readonly forces = new Map<string, LoadForceEntry>();
    private readonly removed = new Set<string>();
    private cursor?: ForceListCursor;
    private pending?: Promise<void>;
    private started = false;
    private disposed = false;
    complete = false;

    constructor(
        local: readonly LoadForceEntry[],
        private readonly fetchPage: (cursor: ForceListCursor | undefined, pageSize: number) => Promise<ForceListPage>,
        private readonly acceptEntries: (entries: readonly LoadForceEntry[], complete: boolean) => void,
    ) {
        for (const entry of local) this.forces.set(entry.instanceId, entry);
    }

    getEntries(): LoadForceEntry[] {
        if (!this.started || this.disposed) return [];
        const cursor = this.cursor;
        // Older local entries must wait: an unseen newer cloud copy can replace them,
        // and unseen cloud rows belong ahead of them in the default Date view.
        return Array.from(this.forces.values())
            .filter(entry => !cursor || timestamp(entry) > cursor.timestamp
                || (timestamp(entry) === cursor.timestamp && compareId(entry.instanceId, cursor.instanceId) >= 0))
            .sort((a, b) => timestamp(b) - timestamp(a) || compareId(b.instanceId, a.instanceId));
    }

    loadNext(pageSize = 100): Promise<void> {
        if (this.pending) return this.pending;
        if (this.complete || this.disposed) return Promise.resolve();
        this.pending = this.fetchPage(this.cursor, pageSize).then(page => {
            if (this.disposed) return;
            if (page.next && this.cursor && (page.next.timestamp > this.cursor.timestamp
                || (page.next.timestamp === this.cursor.timestamp
                    && compareId(page.next.instanceId, this.cursor.instanceId) >= 0))) {
                throw new Error('Cloud force list did not advance.');
            }
            for (const entry of page.entries) {
                if (this.removed.has(entry.instanceId)) continue;
                const existing = this.forces.get(entry.instanceId);
                if (!existing || timestamp(entry) >= timestamp(existing)) {
                    if (existing?.local) entry.local = true;
                    this.forces.set(entry.instanceId, entry);
                }
            }
            this.started = true;
            this.cursor = page.next;
            this.complete = !page.next;
            // Cache only accepted winners. A partial list must not erase unseen tags.
            this.acceptEntries(this.complete ? Array.from(this.forces.values())
                : page.entries.flatMap(entry => this.forces.get(entry.instanceId) ?? []), this.complete);
        }).catch(error => {
            // A failed first cloud page must not conceal existing local saves.
            // The caller labels this fallback incomplete and offers a retry.
            if (!this.disposed) this.started = true;
            throw error;
        }).finally(() => { this.pending = undefined; });
        return this.pending;
    }

    async loadAll(shouldContinue: () => boolean = () => true): Promise<void> {
        while (!this.complete && !this.disposed && shouldContinue()) await this.loadNext();
    }

    remove(instanceId: string): void {
        this.removed.add(instanceId);
        this.forces.delete(instanceId);
    }

    dispose(): void {
        this.disposed = true;
        this.forces.clear();
        this.removed.clear();
    }
}
