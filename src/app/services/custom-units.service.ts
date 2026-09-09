// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { decodeSavedCustomUnit, type SavedCustomUnit } from '../models/custom-unit.model';
import { MAX_OWNED_CUSTOM_UNITS, CUSTOM_UNIT_LIBRARY_FULL_MESSAGE } from '../models/custom-design-policy';
import type { BaseEntity } from '../models/entity/base-entity';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import { parseEntity } from '../models/entity/parse-entity';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../models/unit-summary.model';
import { sha1Base64Url } from '../utils/sha1.util';
import { uuidv7 } from '../utils/uuid.util';
import { UNIT_SUMMARY_PROJECTION_WORKERS } from '../utils/unit-summary-projection-worker-factory.util';
import { DbService } from './db.service';
import { UnitArtworkService } from './unit-artwork.service';
import { decodeUnitArtwork } from '../utils/unit-artwork.util';
import { assertImageFreeUnitSource } from '../models/entity/native-unit-artwork';
import { LoggerService } from './logger.service';
import type { PreparedApplicationCatalogDependencies } from './unit-catalog/application-catalog-bundle-coordinator.service';
import { validateNativeUnitSource } from './unit-catalog/native-unit-source';
import { SUMMARY_DEPENDENCY_NAMES } from './unit-catalog/application-catalog-dependency-bundle';
import { projectUnitSummaryBatches, type UnitSummaryProjectionOptions } from './unit-catalog/unit-summary-projection';
import type { UnitSummaryProjectionInput } from './unit-catalog/entity-summary-projector';
import { isStoredCustomUnitSummary, type StoredCustomUnitSummary } from './unit-catalog/custom-unit-summary-cache';
import {
    asSourceHash, asUnitUuid, makeUnitFileName, CUSTOM_UNIT_PROVIDER_ID,
    type StoredCoreContent, type UnitUuid,
} from './unit-catalog/unit-catalog.types';

export type { SavedCustomUnit } from '../models/custom-unit.model';
export interface SaveCustomUnitOptions {
    readonly newUuid?: UnitUuid;
    /** Present only when updating an existing custom design. Omit to create a new UUID. */
    readonly uuid?: UnitUuid;
    readonly originalUnitUuid?: UnitUuid;
}

/** Native design storage and an independently derived custom summary collection. */
@Injectable({ providedIn: 'root' })
export class CustomUnitsService {
    private readonly db = inject(DbService);
    private readonly artwork = inject(UnitArtworkService);
    private readonly logger = inject(LoggerService);
    private readonly summaryWorkers = inject(UNIT_SUMMARY_PROJECTION_WORKERS);
    private readonly summaryCache = new Map<string, StoredCustomUnitSummary>();
    private readonly recordsValue = signal<readonly SavedCustomUnit[]>([]);
    readonly accountUuid = signal('');
    private readonly recordsByUuid = computed(() => {
        const recordsByUuid = new Map<UnitUuid, SavedCustomUnit>();
        for (const record of this.recordsValue()) {
            if (record.pending === 'delete' || (record.accountUuid && record.accountUuid !== this.accountUuid())) continue;
            const existing = recordsByUuid.get(record.uuid);
            if (!existing || (existing.owned === false && record.owned !== false)) {
                recordsByUuid.set(record.uuid, record);
            }
        }
        return recordsByUuid;
    });
    readonly records = computed(() => [...this.recordsByUuid().values()]);
    readonly pendingRecords = computed(() => this.recordsValue().filter(r => r.accountUuid === this.accountUuid() && r.pending));
    onLocalChange?: () => void;
    private readonly summariesValue = signal<readonly UnitSummary[]>([]);
    readonly summaries = this.summariesValue.asReadonly();
    private readonly revisionValue = signal(0);
    readonly revision = this.revisionValue.asReadonly();
    private sources = new Map<string, StoredCoreContent>();
    private readonly temporary = new Set<string>();
    private dependencies?: PreparedApplicationCatalogDependencies;
    private initialization?: Promise<void>;
    private changes: Promise<unknown> = Promise.resolve();
    private readonly broadcast = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('mekbay-custom-units');

    constructor() {
        inject(DestroyRef).onDestroy(() => this.broadcast?.close());
        if (this.broadcast) this.broadcast.onmessage = ({ data }) => {
            if (!Array.isArray(data) || !data.every(key => typeof key?.uuid === 'string' && typeof key?.accountUuid === 'string')) return;
            void this.enqueue(async () => {
                await this.initialize();
                await this.updateRecords(data.map(({ uuid, accountUuid }) => ({ uuid, accountUuid, update: (current: SavedCustomUnit | undefined) => current })));
                if (this.pendingRecords().length) this.onLocalChange?.();
            }).catch(error => this.logger.warn(`Cannot refresh custom designs from another tab: ${String(error)}`));
        };
    }

    initialize(): Promise<void> {
        return this.initialization ??= this.hydrate();
    }

    setAccount(account: string): void {
        if (account === this.accountUuid()) return;
        this.accountUuid.set(account);
        this.revisionValue.update(value => value + 1);
    }

    bindLocalDesigns(account: string): Promise<void> {
        return this.enqueue(async () => {
            await this.initialize();
            const unbound = this.recordsValue().filter(r => !r.accountUuid);
            const boundSummaries: StoredCustomUnitSummary[] = [];
            for (const old of unbound) {
                let bound: SavedCustomUnit | undefined;
                const cached = this.summaryCache.get(this.sourceKey(old));
                await this.updateRecords([
                    { uuid: old.uuid, accountUuid: '', update: current => {
                        if (current) bound = { ...current, accountUuid: account, owned: true, pending: current.pending ?? 'save' };
                        return undefined;
                    } },
                    { uuid: old.uuid, accountUuid: account, update: current => {
                        if (bound && current && current.source !== bound.source) throw new Error('This custom unit identity is already in use.');
                        return current ?? bound;
                    } },
                ]);
                if (bound && cached && cached.summary.hash === bound.hash) {
                    const summary = { ...cached, accountUuid: account };
                    this.summaryCache.set(this.sourceKey(bound), summary);
                    boundSummaries.push(summary);
                }
            }
            await this.persistSummaries(boundSummaries);
        });
    }

    async get(uuid: UnitUuid): Promise<SavedCustomUnit | undefined> {
        await this.initialize();
        return this.recordsByUuid().get(uuid);
    }

    async load(uuid: UnitUuid): Promise<BaseEntity> {
        const record = await this.get(uuid);
        if (!record) throw new Error('The custom unit no longer exists');
        return this.parse(record.source, record.uuid, record.format, this.requireDependencies());
    }

    /** A fresh parse prevents editor changes from mutating cached/force-owned entities. */
    detach(entity: BaseEntity): BaseEntity {
        return this.parse(encodeNativeEntity(entity), entity.uuid(),
            entity instanceof MekEntity ? 'mtf' : 'blk', this.requireDependencies());
    }

    /** Import and undo use the same equipment, sourcebook and quirk resolution as saved designs. */
    parseDraft(source: string, format: 'mtf' | 'blk'): BaseEntity {
        const dependencies = this.requireDependencies();
        return parseEntity(source, `construction.${format}`, dependencies.equipment.registry, {
            sourcebookResolver: key => dependencies.sourcebooks.sourcebooksByAbbrev.get(key),
            quirkResolver: key => dependencies.quirks.quirksByKey.get(key),
        }).entity;
    }

    save(entity: BaseEntity, options: SaveCustomUnitOptions = {}): Promise<SavedCustomUnit> {
        // Capture editor state synchronously; later UI edits cannot alter this save.
        const detached = this.detach(entity);
        const embedded = { fluff: detached.fluffImageEncoded(), icon: detached.iconEncoded() };
        detached.fluffImageEncoded.set(''); detached.iconEncoded.set('');
        const account = this.accountUuid();
        return this.enqueue(async () => {
            await this.initialize();
            if (account !== this.accountUuid()) throw new Error('The account changed. Reopen this design before saving.');
            const existing = options.uuid ? await this.get(options.uuid) : undefined;
            if (options.uuid && !existing) throw new Error('Only an existing custom unit can be updated');
            if (existing?.owned === false) throw new Error('This design belongs to another player. Clone it to edit.');
            if (!existing && this.records().filter(record => record.owned !== false).length >= MAX_OWNED_CUSTOM_UNITS) {
                throw new Error(CUSTOM_UNIT_LIBRARY_FULL_MESSAGE);
            }
            const uuid = existing?.uuid ?? options.newUuid ?? asUnitUuid(uuidv7());
            if (!existing && this.recordsValue().some(r => r.uuid === uuid)) throw new Error('This custom unit identity is already in use.');
            const originalUnitUuid = existing ? existing.originalUnitUuid : options.originalUnitUuid;
            if (embedded.fluff || embedded.icon) {
                const extracted = await decodeUnitArtwork(embedded);
                extracted.warnings.forEach(warning => this.logger.warn(warning));
                if (extracted.artwork) await this.artwork.set(uuid, extracted.artwork);
            }
            detached.uuid.set(uuid);
            const now = Date.now();
            const record = decodeSavedCustomUnit({
                schemaVersion: 1, uuid,
                ...(originalUnitUuid ? { originalUnitUuid } : {}),
                createdAt: existing?.createdAt ?? now, updatedAt: now,
                format: detached instanceof MekEntity ? 'mtf' : 'blk',
                source: encodeNativeEntity(detached),
                accountUuid: account, owned: true, pending: 'save',
                ...(existing?.syncedHash ? { syncedHash: existing.syncedHash } : {}),
            });
            const source = await this.sourceFor(record);
            // Project the persisted native form before committing anything to disk.
            const dependencies = this.requireDependencies();
            const summary = await this.project(record, source, dependencies);
            const [hashed] = await this.updateRecords([{ uuid, accountUuid: account, update: current => {
                if (current?.source !== existing?.source || current?.pending === 'delete') {
                    throw new Error('This design changed in another tab. Your draft is still open; save it as a new design.');
                }
                return { ...record, hash: source.hash, ...(current?.syncedHash ? { syncedHash: current.syncedHash } : {}) };
            } }], new Map([[record.source, source]]));
            const cached = { accountUuid: account, uuid, dependencies: this.projectionDependencies(dependencies), summary };
            this.summaryCache.set(this.sourceKey(hashed!), cached);
            await this.persistSummaries([cached]);
            this.onLocalChange?.();
            return hashed!;
        });
    }

    delete(uuid: UnitUuid): Promise<void> {
        const account = this.accountUuid();
        return this.enqueue(async () => {
            await this.initialize();
            if (account !== this.accountUuid()) throw new Error('The account changed. Reopen your custom unit library.');
            const record = await this.get(uuid);
            if (!record) return;
            if (record.owned === false) throw new Error('Unsubscribe to remove a design you do not own.');
            await this.updateRecords([{ uuid, accountUuid: record.accountUuid ?? '', update: current =>
                current ? { ...current, pending: 'delete' } : undefined }]);
            this.onLocalChange?.();
        });
    }

    /** Called with the exact candidate dependency bundle before search publication. */
    async prepareSummaries(dependencies: PreparedApplicationCatalogDependencies,
        options: UnitSummaryProjectionOptions & { readonly cachedOnly?: boolean } = { signal: new AbortController().signal }): Promise<readonly UnitSummary[]> {
        options.signal.throwIfAborted();
        const records = this.records();
        const keys = new Set(this.recordsValue().filter(record => record.pending !== 'delete').map(record => this.sourceKey(record)));
        for (const key of this.summaryCache.keys()) if (!keys.has(key)) this.summaryCache.delete(key);
        const dependencyKey = this.projectionDependencies(dependencies);
        const prepared = new Map<string, UnitSummary>();
        const rebuilds: { record: SavedCustomUnit; source: StoredCoreContent; key: string }[] = [];
        for (const record of records) {
            const key = this.sourceKey(record);
            const source = this.sources.get(key);
            if (!source) {
                this.logger.warn(`Cannot project custom unit ${record.uuid}: native source is unavailable`);
                continue;
            }
            const cached = this.summaryCache.get(key);
            if (cached && cached.dependencies === dependencyKey && cached.summary.hash === source.hash
                && cached.summary.summaryVersion === UNIT_SUMMARY_VERSION) prepared.set(key, cached.summary);
            else rebuilds.push({ record, source, key });
        }
        if (rebuilds.length && !options.cachedOnly) {
            const outcomes = await projectUnitSummaryBatches(rebuilds.map(({ record, source }) =>
                async () => this.projectionInput(record, source)), {
                projector: await dependencies.getProjector(), dependencies: dependencies.bundle, workers: this.summaryWorkers,
            }, options);
            options.signal.throwIfAborted();
            const generated: StoredCustomUnitSummary[] = [];
            outcomes.forEach((outcome, index) => {
                const { key, record } = rebuilds[index];
                if (outcome.status === 'error') {
                    this.summaryCache.delete(key);
                    this.logger.warn(`Cannot project custom unit ${record.uuid}: ${outcome.message}`);
                } else {
                    prepared.set(key, outcome.value.summary);
                    const cached = { accountUuid: record.accountUuid ?? '', uuid: record.uuid,
                        dependencies: dependencyKey, summary: outcome.value.summary };
                    this.summaryCache.set(key, cached);
                    if (!this.temporary.has(key)) generated.push(cached);
                }
            });
            await this.persistSummaries(generated);
            options.signal.throwIfAborted();
        }
        const summaries: UnitSummary[] = [];
        for (const record of records) {
            const base = prepared.get(this.sourceKey(record));
            if (!base) continue;
            // Search preparation mutates presentation branches. Keep cached projections detached.
            const summary = structuredClone(base);
            summaries.push({ ...summary, isCustom: true, canon: false,
                ...(record.originalUnitUuid ? { originalUnitUuid: record.originalUnitUuid } : {}) });
        }
        return summaries;
    }

    commitSummaries(dependencies: PreparedApplicationCatalogDependencies, summaries: readonly UnitSummary[]): void {
        this.dependencies = dependencies;
        this.summariesValue.set(summaries);
    }

    captureSources(): ReadonlyMap<UnitUuid, StoredCoreContent> {
        return new Map(this.records().flatMap(r => { const source = this.sources.get(this.sourceKey(r)); return source ? [[r.uuid, source] as const] : []; }));
    }

    isOwned(uuid: UnitUuid): boolean { const record = this.recordsByUuid().get(uuid); return !!record && record.owned !== false; }

    isTemporary(uuid: UnitUuid): boolean {
        const record = this.recordsByUuid().get(uuid);
        return !!record && this.temporary.has(this.sourceKey(record));
    }

    /** One local commit for a verified cloud revision or sync acknowledgement. */
    acceptRemote(value: SavedCustomUnit, persist = true): Promise<void> {
        return this.acceptRemoteBatch([value], persist);
    }

    /** Publish one catalog revision for a sync batch, including a new device's entire library. */
    async acceptRemoteBatch(values: readonly SavedCustomUnit[], persist = true): Promise<void> {
        await this.enqueue(async () => {
            await this.initialize();
            const pending = new Set(this.recordsValue().filter(r => r.pending).map(r => this.sourceKey(r)));
            const recordsByKey = new Map<string, SavedCustomUnit>();
            const existingByKey = new Map(this.recordsValue().map(record => [this.sourceKey(record), record]));
            for (const value of values) {
                const record = decodeSavedCustomUnit(value);
                const key = this.sourceKey(record);
                if (pending.has(key)) continue;
                const existing = recordsByKey.get(key) ?? existingByKey.get(key);
                if (existing && existing.owned !== false && record.owned === false) continue;
                recordsByKey.set(key, record);
            }
            const records = [...recordsByKey.values()];
            if (!records.length) return;
            const sources = await Promise.all(records.map(async record => {
                const source = await this.sourceFor(record);
                if (record.hash && source.hash !== record.hash) throw new Error('Custom unit checksum does not match');
                return source;
            }));
            if (persist) {
                await this.updateRecords(records.map(record => ({ uuid: record.uuid, accountUuid: record.accountUuid ?? '', update: current => {
                    if (current?.pending || (current && current.owned !== false && record.owned === false)
                        || (current && current.updatedAt > record.updatedAt)) return current;
                    if (current?.source === record.source && current?.owned === record.owned
                        && current?.subscribed === record.subscribed && current?.ownerId === record.ownerId
                        && current?.originalUnitUuid === record.originalUnitUuid) return current;
                    return record;
                } })), new Map(records.map((record, index) => [record.source, sources[index]])));
                return;
            }
            const keys = new Set(records.map(r => this.sourceKey(r)));
            for (const key of keys) { if (persist) this.temporary.delete(key); else this.temporary.add(key); }
            records.forEach((record, index) => this.sources.set(this.sourceKey(record), sources[index]));
            this.recordsValue.update(rows => [...records, ...rows.filter(r => !keys.has(this.sourceKey(r)))]);
            this.revisionValue.update(v => v + 1);
        });
    }

    acknowledgeUpload(uploaded: SavedCustomUnit, hash: string, ownerId: string): Promise<void> {
        return this.enqueue(async () => {
            await this.updateRecords([{ uuid: uploaded.uuid, accountUuid: uploaded.accountUuid ?? '', update: current => {
                if (!current) return undefined;
                // A delayed acknowledgement must not move the cloud base backwards.
                if (current.syncedHash !== uploaded.syncedHash && current.syncedHash !== hash) return current;
                const unchanged = current.source === uploaded.source;
                return { ...current, hash: unchanged ? hash : current.hash, syncedHash: hash, ownerId,
                    pending: current.pending === 'delete' ? 'delete' : unchanged ? undefined : current.pending };
            } }]);
        });
    }

    async removeRemote(uuid: UnitUuid, account = this.accountUuid(), deletionAcknowledged = false): Promise<void> {
        await this.enqueue(async () => {
            await this.updateRecords([{ uuid, accountUuid: account, update: current =>
                current?.pending && !(deletionAcknowledged && current.pending === 'delete') ? current : undefined }]);
        });
    }

    /** Explicit conflict resolution is conditional on the draft the user reviewed. */
    replaceConflicted(local: SavedCustomUnit, remote: SavedCustomUnit | undefined): Promise<void> {
        return this.enqueue(async () => {
            await this.updateRecords([{ uuid: local.uuid, accountUuid: local.accountUuid ?? '', update: current => {
                if (current?.source !== local.source || current?.pending !== local.pending) {
                    throw new Error('This design changed while resolving the conflict. Review it again.');
                }
                return remote;
            } }]);
        });
    }

    private async updateRecords(changes: Parameters<DbService['updateCustomUnits']>[0],
        verifiedSources?: ReadonlyMap<string, StoredCoreContent>): Promise<readonly (SavedCustomUnit | undefined)[]> {
        let changed = false;
        const records = await this.db.updateCustomUnits(changes.map(change => ({ ...change, update: current => {
            const next = change.update(current);
            changed ||= next !== current;
            return next;
        } })));
        const previous = new Map(this.recordsValue().map(record => [this.sourceKey(record), record]));
        let catalogChanged = false;
        const updatedKeys = new Set<string>();
        for (const [index, value] of records.entries()) {
            const key = `${changes[index].accountUuid}:${changes[index].uuid}`;
            const old = previous.get(key);
            const record = value ? decodeSavedCustomUnit(value) : undefined;
            const affectsCatalog = record?.source !== old?.source || record?.originalUnitUuid !== old?.originalUnitUuid
                || (record?.pending === 'delete') !== (old?.pending === 'delete') || record?.owned !== old?.owned
                || record?.subscribed !== old?.subscribed;
            catalogChanged ||= affectsCatalog;
            if (affectsCatalog && record) updatedKeys.add(key);
            if (record) {
                if (record.source !== old?.source || !this.sources.has(key)) {
                    this.sources.set(key, verifiedSources?.get(record.source) ?? await this.sourceFor(record));
                }
                previous.set(key, record);
            } else {
                previous.delete(key);
                this.sources.delete(key);
                this.summaryCache.delete(key);
            }
            this.temporary.delete(key);
        }
        this.recordsValue.set([...updatedKeys].map(key => previous.get(key)!)
            .concat([...previous.values()].filter(record => !updatedKeys.has(this.sourceKey(record)))));
        if (catalogChanged) this.revisionValue.update(value => value + 1);
        if (changed) {
            try { this.broadcast?.postMessage(changes.map(({ uuid, accountUuid }) => ({ uuid, accountUuid }))); } catch { /* Closing a tab cannot undo its saved edits. */ }
        }
        return records;
    }

    private async hydrate(): Promise<void> {
        const records = new Map<string, SavedCustomUnit>();
        const [nativeRecords, cachedSummaries] = await Promise.all([
            this.db.listCustomUnits(),
            this.db.listCustomUnitSummaries().catch(error => {
                this.logger.warn(`Custom summaries will be regenerated: ${String(error)}`);
                return [];
            }),
        ]);
        for (const value of nativeRecords) {
            try {
                const record = decodeSavedCustomUnit(value);
                const key = this.sourceKey(record);
                const existing = records.get(key);
                if (existing && ((existing.owned !== false && record.owned === false)
                    || ((existing.owned !== false) === (record.owned !== false) && existing.updatedAt >= record.updatedAt))) continue;
                const source = await this.sourceFor(record);
                records.set(key, record);
                this.sources.set(key, source);
            } catch (error) {
                this.logger.warn(`Skipping unreadable custom unit: ${String(error)}`);
            }
        }
        for (const cached of cachedSummaries) {
            if (!isStoredCustomUnitSummary(cached)) continue;
            const key = this.sourceKey(cached);
            if (records.has(key) && this.sources.get(key)?.hash === cached.summary.hash) this.summaryCache.set(key, cached);
        }
        this.recordsValue.set([...records.values()].sort((a, b) => b.updatedAt - a.updatedAt));
        this.revisionValue.update(value => value + 1);
    }

    private async persistSummaries(rows: readonly StoredCustomUnitSummary[]): Promise<void> {
        if (!rows.length) return;
        try {
            await this.db.saveCustomUnitSummaries(rows);
        } catch (error) {
            this.logger.warn(`Custom summaries could not be cached; native designs are saved: ${String(error)}`);
        }
    }

    private async sourceFor(record: SavedCustomUnit): Promise<StoredCoreContent> {
        assertImageFreeUnitSource(record.source, record.format);
        const bytes = new TextEncoder().encode(record.source).buffer;
        await validateNativeUnitSource(record.uuid, record.format, bytes);
        return Object.freeze({
            file: makeUnitFileName(record.uuid, record.format), format: record.format,
            hash: asSourceHash(await sha1Base64Url(bytes)), bytes,
        });
    }

    private sourceKey(record: Pick<SavedCustomUnit, 'uuid' | 'accountUuid'>): string {
        return `${record.accountUuid ?? ''}:${record.uuid}`;
    }

    private projectionDependencies(dependencies: PreparedApplicationCatalogDependencies): string {
        return SUMMARY_DEPENDENCY_NAMES.map(name => dependencies.assetHashes[name]).join(':');
    }

    private projectionInput(record: SavedCustomUnit, source: StoredCoreContent): UnitSummaryProjectionInput {
        return {
            entryKey: {
                origin: 'user', design: { provider: CUSTOM_UNIT_PROVIDER_ID, uuid: record.uuid },
                sourceRevision: source.hash,
            }, format: record.format, file: source.file, bytes: source.bytes,
        };
    }

    private async project(record: SavedCustomUnit, source: StoredCoreContent,
        dependencies: PreparedApplicationCatalogDependencies): Promise<UnitSummary> {
        return (await (await dependencies.getProjector()).project(this.projectionInput(record, source))).summary;
    }

    private parse(source: string, uuid: UnitUuid, format: 'mtf' | 'blk',
        dependencies: PreparedApplicationCatalogDependencies): BaseEntity {
        const parsed = parseEntity(source, makeUnitFileName(uuid, format), dependencies.equipment.registry, {
            sourcebookResolver: key => dependencies.sourcebooks.sourcebooksByAbbrev.get(key),
            quirkResolver: key => dependencies.quirks.quirksByKey.get(key),
        });
        if (parsed.entity.uuid() !== uuid) throw new Error('Custom unit source UUID does not match its record');
        return parsed.entity;
    }

    private requireDependencies(): PreparedApplicationCatalogDependencies {
        if (!this.dependencies) throw new Error('The application catalog must be ready before editing custom units');
        return this.dependencies;
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.changes.then(operation);
        this.changes = next.catch(() => undefined);
        return next;
    }
}
