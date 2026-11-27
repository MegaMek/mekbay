// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';

/** Downloaded catalog art, shared by URL across units and kept independently of custom artwork. */
@Injectable({ providedIn: 'root' })
export class ProvidedFluffImageService {
    private readonly db = inject(DbService);
    private readonly logger = inject(LoggerService);
    private readonly rows = signal<ReadonlyMap<string, Blob>>(new Map());
    readonly count = computed(() => this.rows().size);
    readonly bytes = computed(() => [...this.rows().values()].reduce((sum, blob) => sum + blob.size, 0));
    readonly revision = signal(0);
    private readonly urls = new Map<string, string>();
    private readonly pending = new Map<string, Promise<string | null>>();
    private readonly failed = new Set<string>();
    private initialization?: Promise<void>;
    private generation = 0;
    private downloads = new AbortController();

    constructor() {
        const retryFailed = () => {
            this.failed.clear();
            this.revision.update(value => value + 1);
        };
        window.addEventListener('online', retryFailed);
        inject(DestroyRef).onDestroy(() => {
            window.removeEventListener('online', retryFailed);
            this.generation++;
            this.downloads.abort();
            for (const url of this.urls.values()) URL.revokeObjectURL(url);
            this.urls.clear();
        });
    }

    initialize(): Promise<void> {
        return this.initialization ??= this.db.listProvidedImages().then(rows => {
            this.rows.set(rows);
        }).catch(error => this.logger.warn(`Cannot load provided images: ${String(error)}`));
    }

    resolveUrl(url: string): string | null {
        this.revision();
        const blob = this.rows().get(url);
        if (blob) {
            if (!this.urls.has(url)) this.urls.set(url, URL.createObjectURL(blob));
            return this.urls.get(url)!;
        }
        if (!this.failed.has(url)) void this.loadUrl(url);
        return null;
    }

    loadUrl(url: string): Promise<string | null> {
        const pending = this.pending.get(url);
        if (pending) return pending;
        const generation = this.generation;
        const request = this.load(url, generation).finally(() => {
            if (this.pending.get(url) === request) this.pending.delete(url);
        });
        this.pending.set(url, request);
        return request;
    }

    private async load(url: string, generation: number): Promise<string | null> {
        await this.initialize();
        if (generation !== this.generation) return null;
        if (this.rows().has(url)) return this.resolveUrl(url);
        try {
            const response = await fetch(url, { signal: this.downloads.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Invalid image response');
            if (generation !== this.generation) return null;
            try {
                await this.db.saveProvidedImage(url, blob);
            } catch (error) {
                this.logger.warn(`Cannot store provided image: ${String(error)}`);
            }
            if (generation !== this.generation) return null;
            this.failed.delete(url);
            this.rows.update(rows => new Map(rows).set(url, blob));
            this.revision.update(value => value + 1);
            return this.resolveUrl(url);
        } catch (error) {
            if (generation !== this.generation) return null;
            this.failed.add(url);
            this.logger.warn(`Cannot download provided image ${url}: ${String(error)}`);
            return null;
        }
    }

    async purge(): Promise<void> {
        await this.initialize();
        this.generation++;
        this.downloads.abort();
        this.downloads = new AbortController();
        // Finish writes already in flight before clearing the store.
        await Promise.all(this.pending.values());
        await this.db.purgeProvidedImages();
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
        this.failed.clear();
        this.rows.set(new Map());
        this.revision.update(value => value + 1);
    }
}
