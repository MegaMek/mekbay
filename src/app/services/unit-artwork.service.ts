// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { asUnitUuid, type UnitUuid } from './unit-catalog/unit-catalog.types';
import { unitArtworkSize, type UnitArtwork } from '../models/unit-artwork.model';
import { extractNativeUnitArtwork } from '../models/entity/native-unit-artwork';
import type { PinnedCustomUnitSource } from '../models/pinned-custom-unit-source';
import { decodeUnitArtwork } from '../utils/unit-artwork.util';

/** Device-local artwork; there is deliberately no account, catalogue or cloud dependency. */
@Injectable({ providedIn: 'root' })
export class UnitArtworkService {
    private readonly db = inject(DbService);
    private readonly logger = inject(LoggerService);
    private readonly rows = signal<ReadonlyMap<UnitUuid, UnitArtwork>>(new Map());
    readonly records = this.rows.asReadonly();
    readonly count = computed(() => [...this.rows().values()].filter(row => row.fluff).length);
    readonly bytes = computed(() => [...this.rows().values()].reduce((sum, row) => sum + unitArtworkSize(row), 0));
    readonly revision = signal(0);
    private readonly urls = new Map<UnitUuid, { blob: Blob; url: string }>();
    private initialization?: Promise<void>;
    private changes: Promise<void> = Promise.resolve();
    private readonly channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('mekbay-unit-artwork');

    constructor() {
        void this.initialize().catch(error => this.logger.warn(`Cannot load local artwork: ${String(error)}`));
        const subscription = this.db.unitArtworkChanges.subscribe(keys => {
            void this.refresh(keys).catch(error => this.logger.warn(`Cannot refresh artwork: ${String(error)}`));
            this.channel?.postMessage(keys);
        });
        if (this.channel) this.channel.onmessage = ({ data }) => {
            try {
                const keys = data === null ? null : (data as unknown[]).map(value => asUnitUuid(String(value)));
                void this.refresh(keys).catch(error => this.logger.warn(`Cannot refresh artwork: ${String(error)}`));
            } catch { /* Ignore malformed local notifications. */ }
        };
        inject(DestroyRef).onDestroy(() => {
            subscription.unsubscribe();
            this.channel?.close();
            for (const entry of this.urls.values()) URL.revokeObjectURL(entry.url);
            this.urls.clear();
        });
    }

    initialize(): Promise<void> {
        return this.initialization ??= this.db.listUnitArtwork().then(rows => { this.rows.set(rows); });
    }

    get(uuid: UnitUuid): UnitArtwork | null { return this.rows().get(uuid) ?? null; }

    url(uuid: UnitUuid): string | null {
        const blob = this.rows().get(uuid)?.fluff;
        const cached = this.urls.get(uuid);
        if (cached && cached.blob === blob) return cached.url;
        if (cached) { URL.revokeObjectURL(cached.url); this.urls.delete(uuid); }
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this.urls.set(uuid, { blob, url });
        return url;
    }

    async set(uuid: UnitUuid, artwork: UnitArtwork | null): Promise<void> {
        await this.initialize();
        await this.db.saveUnitArtwork(uuid, artwork);
        await this.changes;
    }

    async purge(uuids?: readonly UnitUuid[]): Promise<void> {
        await this.initialize();
        await this.db.purgeUnitArtwork(uuids);
        await this.changes;
    }

    /** Sources restored from forces can carry images even though our own saves never do. */
    async extractSource(uuid: UnitUuid, pin: PinnedCustomUnitSource): Promise<PinnedCustomUnitSource> {
        const extracted = extractNativeUnitArtwork(pin.source, pin.format);
        if (extracted.source === pin.source) return pin;
        const { artwork, warnings } = await decodeUnitArtwork(extracted.images);
        warnings.forEach(warning => this.logger.warn(warning));
        if (artwork) {
            await this.db.saveUnitArtwork(uuid, artwork, true);
            await this.changes;
        }
        return { format: pin.format, source: extracted.source };
    }

    private refresh(keys: readonly UnitUuid[] | null): Promise<void> {
        const next = this.changes.catch(() => undefined).then(async () => {
            await this.initialize();
            const rows = keys === null ? new Map(await this.db.listUnitArtwork()) : new Map(this.rows());
            if (keys) for (const uuid of keys) {
                const artwork = await this.db.getUnitArtwork(uuid);
                if (artwork) rows.set(uuid, artwork); else rows.delete(uuid);
            }
            for (const [uuid, cached] of this.urls) {
                if (rows.get(uuid)?.fluff !== cached.blob) { URL.revokeObjectURL(cached.url); this.urls.delete(uuid); }
            }
            this.rows.set(rows);
            this.revision.update(value => value + 1);
        });
        this.changes = next;
        return next;
    }
}
