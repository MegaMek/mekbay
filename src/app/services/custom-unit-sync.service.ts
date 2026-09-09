// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { DestroyRef, Injectable, Injector, effect, inject, signal, untracked } from '@angular/core';
import { CustomUnitsService } from './custom-units.service';
import { WsService } from './ws.service';
import { UserStateService } from './userState.service';
import { ToastService } from './toast.service';
import { DataService } from './data.service';
import { compressCustomDesign, decompressCustomDesign } from '../models/custom-design-policy';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import { asUnitUuid, type UnitUuid } from './unit-catalog/unit-catalog.types';
import { sha1Base64Url } from '../utils/sha1.util';

interface ManifestUnit { uuid: UnitUuid; hash: string | null; owned: boolean; subscribed: boolean; deleted: boolean; subscriberCount?: number }
interface CloudUnit extends Omit<ManifestUnit, 'hash'> { hash: string; format: 'mtf' | 'blk'; data: string; ownerId: string; createdAt: number; updatedAt: number; originalUnitUuid?: UnitUuid }
interface Reply { [key: string]: unknown; action: string; code?: string; message?: string; hash?: string; ownerId?: string; unit?: CloudUnit | null; units?: ManifestUnit[]; nextCursor?: string | null; designs?: CloudUnit[]; missing?: UnitUuid[]; remaining?: UnitUuid[] }

/** Account manifest reconciliation; source bodies are fetched only when their hash changes. */
@Injectable({ providedIn: 'root' })
export class CustomUnitSyncService {
    readonly library = inject(CustomUnitsService);
    private readonly ws = inject(WsService);
    private readonly user = inject(UserStateService);
    private readonly injector = inject(Injector);
    private readonly toast = inject(ToastService);
    readonly subscriberCounts = signal<ReadonlyMap<UnitUuid, number>>(new Map());
    readonly syncing = signal(false);
    readonly error = signal('');
    readonly conflicts = signal<ReadonlySet<UnitUuid>>(new Set());
    private running?: Promise<void>;
    private operations: Promise<unknown> = Promise.resolve();
    private again = false;
    private readonly uploads = new Map<UnitUuid, Promise<void>>();
    private readonly downloads = new Map<string, Promise<SavedCustomUnit | undefined>>();
    private lastRequestAt = 0;
    private readonly changedUnits = new Set<UnitUuid>();
    private notifications?: Promise<void>;

    constructor() {
        this.library.onLocalChange = () => { void this.sync(); };
        const unregister = this.ws.registerMessageHandler('customUnitChanged', message => {
            if (!this.user.uuid() || !this.ws.wsConnected()) return;
            try { this.changedUnits.add(asUnitUuid(String(message['unitUuid']))); }
            catch { return; }
            this.processNotifications();
        });
        inject(DestroyRef).onDestroy(unregister);
        effect(() => {
            const account = this.user.uuid();
            const connected = this.ws.wsConnected();
            untracked(() => {
                if (account !== this.library.accountUuid()) {
                    this.library.setAccount(account);
                    this.subscriberCounts.set(new Map());
                    this.error.set('');
                    this.conflicts.set(new Set());
                    this.changedUnits.clear();
                    void this.injector.get(DataService).refreshCustomUnits().catch(error => this.error.set(String(error)));
                }
                if (account && connected) void this.sync();
            });
        });
    }

    /** Coalesce pushes and serialize them with account reconciliation and membership changes. */
    private processNotifications(): void {
        if (this.notifications) return;
        this.notifications = this.enqueue(async () => {
            const account = this.user.uuid();
            while (this.changedUnits.size) {
                const uuids = [...this.changedUnits];
                this.changedUnits.clear();
                await this.downloadUnits(uuids, account);
                await this.injector.get(DataService).refreshCustomUnits();
            }
        }).catch(error => {
            this.error.set(error instanceof Error ? error.message : String(error));
            // A reconnect or explicit sync also recovers a missed push.
            void this.sync();
        }).finally(() => {
            this.notifications = undefined;
            if (this.changedUnits.size) this.processNotifications();
        });
    }

    sync(): Promise<void> {
        if (!this.ws.wsConnected() || !this.user.uuid()) return Promise.resolve();
        if (this.running) { this.again = true; return this.running; }
        this.running = this.enqueue(() => this.reconcile()).catch(error => {
            this.error.set(error instanceof Error ? error.message : String(error));
        }).finally(() => {
            this.running = undefined; this.syncing.set(false);
            if (this.again) { this.again = false; void this.sync(); }
        });
        return this.running;
    }

    /** Membership changes must finish after earlier downloads, so unsubscribe cannot be undone by a stale batch. */
    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const account = this.user.uuid();
        const next = this.operations.then(() => {
            if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
            return operation();
        });
        this.operations = next.catch(() => undefined);
        return next;
    }

    private async request(payload: object): Promise<Reply> {
        const account = this.user.uuid();
        // Leave room for force/tag traffic under the socket's 60-message/second limit.
        const sendAt = Math.max(Date.now(), this.lastRequestAt + 40);
        this.lastRequestAt = sendAt;
        if (sendAt > Date.now()) await new Promise(resolve => setTimeout(resolve, sendAt - Date.now()));
        if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
        const response = await this.ws.sendAndWaitForResponse<Reply>({ ...payload, accountUuid: account }, { timeout: 15000, suppressGlobalError: true });
        if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
        if (!response || response.action === 'error') throw Object.assign(new Error(response?.message ?? 'Custom units are saved on this device. Cloud sync will retry when connected.'), { code: response?.code });
        return response;
    }

    private async reconcile(): Promise<void> {
        this.syncing.set(true); this.error.set('');
        await this.library.initialize();
        const account = this.user.uuid();
        // Bind pre-sync local designs once, so changing accounts cannot publish them to another owner.
        await this.library.bindLocalDesigns(account);
        for (const pending of this.library.pendingRecords()) {
            if (account !== this.user.uuid()) return;
            try {
                if (pending.pending === 'delete') {
                    await this.request({ action: 'deleteCustomUnit', unitUuid: pending.uuid });
                    await this.library.removeRemote(pending.uuid, account, true);
                    this.conflicts.update(values => { const next = new Set(values); next.delete(pending.uuid); return next; });
                } else if (!this.conflicts().has(pending.uuid)) await this.upload(pending.uuid);
            } catch (error) {
                this.error.set(error instanceof Error ? error.message : String(error));
            }
        }
        const manifest: ManifestUnit[] = [];
        let cursor: string | null = null;
        do {
            const reply = await this.request({ action: 'listCustomUnits', ...(cursor ? { cursor } : {}) });
            manifest.push(...reply.units ?? []); cursor = reply.nextCursor ?? null;
        } while (cursor);
        const counts = new Map<UnitUuid, number>();
        let deletedSubscriptions = 0;
        const known = new Set(manifest.map(r => r.uuid));
        const downloads: UnitUuid[] = [];
        for (const local of this.library.records()) {
            if (local.subscribed && !local.owned && !known.has(local.uuid)) {
                await this.library.removeRemote(local.uuid, account);
                deletedSubscriptions++;
            }
        }
        for (const remote of manifest) {
            if (account !== this.user.uuid()) return;
            if (remote.owned) counts.set(remote.uuid, remote.subscriberCount ?? 0);
            const local = await this.library.get(remote.uuid);
            if (local?.pending) continue;
            if (remote.deleted) {
                if (local) {
                    await this.library.removeRemote(remote.uuid, account);
                    if (local.subscribed) deletedSubscriptions++;
                }
                continue;
            }
            if (local?.hash === remote.hash && !!local.subscribed === remote.subscribed && !this.library.isTemporary(remote.uuid)) continue;
            downloads.push(remote.uuid);
        }
        await this.downloadUnits(downloads, account);
        this.subscriberCounts.set(counts);
        if (deletedSubscriptions) this.toast.showToast(`${deletedSubscriptions} subscribed custom design${deletedSubscriptions === 1 ? ' was' : 's were'} removed from your library.`, 'info');
        await this.injector.get(DataService).refreshCustomUnits();
    }

    /** Both full reconciliation and live updates use the same download, validation and local commit. */
    private async downloadUnits(downloads: readonly UnitUuid[], account: string): Promise<void> {
        let updatedSubscriptions = 0, deletedSubscriptions = 0;
        const received: SavedCustomUnit[] = [];
        for (let offset = 0; offset < downloads.length; offset += 20) {
            if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
            let remaining = downloads.slice(offset, offset + 20);
            while (remaining.length) {
                const reply = await this.request({ action: 'getCustomUnits', unitUuids: remaining });
                for (const remote of reply.designs ?? []) {
                    const local = await this.library.get(remote.uuid);
                    const fetched = await this.decodeCloudUnit(remote, remote.uuid);
                    if (!fetched.owned && !fetched.subscribed) {
                        // An unsubscribe in another tab must not become a persisted preview.
                        if (local?.subscribed) await this.library.removeRemote(remote.uuid, account);
                        continue;
                    }
                    received.push(fetched);
                    if (local?.subscribed && !local.pending && local.hash !== fetched.hash) updatedSubscriptions++;
                }
                for (const uuid of reply.missing ?? []) {
                    if ((await this.library.get(uuid))?.subscribed) deletedSubscriptions++;
                    await this.library.removeRemote(uuid, account);
                }
                if (reply.remaining?.length === remaining.length) throw new Error('The server could not fit a custom design in its download response.');
                remaining = reply.remaining ?? [];
            }
        }
        await this.library.acceptRemoteBatch(received);
        if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
        if (updatedSubscriptions) this.toast.showToast(`${updatedSubscriptions} subscribed custom design${updatedSubscriptions === 1 ? '' : 's'} updated. Units already in your forces keep their saved design.`, 'info');
        if (deletedSubscriptions) this.toast.showToast(`${deletedSubscriptions} subscribed custom design${deletedSubscriptions === 1 ? ' was' : 's were'} removed by the owner.`, 'info');
    }

    private upload(uuid: UnitUuid): Promise<void> {
        const existing = this.uploads.get(uuid);
        if (existing) return existing;
        const uploading = (async () => {
            const account = this.user.uuid();
            while (account === this.user.uuid()) {
                const record = await this.library.get(uuid);
                if (!record || record.pending !== 'save') return;
                if (record.owned === false) throw new Error('Only the owner can upload a custom unit.');
                const reply = await this.request({ action: 'saveCustomUnit', design: compressCustomDesign(record.uuid, record),
                    expectedHash: record.syncedHash ?? null, ...(record.originalUnitUuid ? { originalUnitUuid: record.originalUnitUuid } : {}) });
                await this.library.acknowledgeUpload(record, reply.hash!, reply.ownerId!);
            }
        })().catch(error => {
            if (error?.code === 'conflict' || error?.code === 'deleted') {
                this.conflicts.update(values => new Set([...values, uuid]));
            }
            throw error;
        }).finally(() => { this.uploads.delete(uuid); });
        this.uploads.set(uuid, uploading);
        return uploading;
    }

    fetch(uuid: UnitUuid, hash?: string): Promise<SavedCustomUnit | undefined> {
        const account = this.user.uuid(), key = `${account}:${uuid}:${hash ?? ''}`;
        const existing = this.downloads.get(key);
        if (existing) return existing;
        // Several force instances can need the same saved revision at once.
        const downloading = (async () => {
            await this.ws.waitForWebSocket();
            if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
            const remote = (await this.request({ action: 'getCustomUnit', unitUuid: uuid, ...(hash ? { hash } : {}) })).unit;
            if (!remote) return undefined;
            return this.decodeCloudUnit(remote, uuid, hash);
        })().finally(() => this.downloads.delete(key));
        this.downloads.set(key, downloading);
        return downloading;
    }

    private async decodeCloudUnit(remote: CloudUnit, uuid: UnitUuid, hash?: string): Promise<SavedCustomUnit> {
        const account = this.user.uuid();
        const decoded = decompressCustomDesign({ uuid: remote.uuid, format: remote.format, data: remote.data });
        const actualHash = await sha1Base64Url(new TextEncoder().encode(decoded.source.source).buffer);
        if (account !== this.user.uuid()) throw new Error('The account changed during custom unit sync.');
        if (decoded.uuid !== uuid || actualHash !== remote.hash || (hash && hash !== actualHash)) throw new Error('The downloaded custom unit failed its checksum check.');
        return { schemaVersion: 1, uuid, ...decoded.source, hash: actualHash, syncedHash: actualHash,
            ownerId: remote.ownerId, owned: remote.owned, subscribed: remote.subscribed, accountUuid: account,
            createdAt: remote.createdAt, updatedAt: remote.updatedAt,
            ...(remote.originalUnitUuid ? { originalUnitUuid: remote.originalUnitUuid } : {}) };
    }

    openShared(uuid: UnitUuid): Promise<void> {
        return this.enqueue(async () => {
            const record = await this.fetch(uuid);
            if (!record) throw new Error('This custom unit is no longer available.');
            await this.library.acceptRemote(record, false);
            await this.injector.get(DataService).refreshCustomUnits();
        });
    }

    subscribe(uuid: UnitUuid): Promise<void> {
        return this.enqueue(async () => {
            const account = this.user.uuid();
            await this.request({ action: 'subscribeCustomUnit', unitUuid: uuid });
            const record = await this.fetch(uuid);
            if (account !== this.user.uuid()) throw new Error('The account changed. Subscribe again from the current account.');
            if (!record) throw new Error('This custom unit is no longer available.');
            await this.library.acceptRemote({ ...record, subscribed: true });
            await this.injector.get(DataService).refreshCustomUnits();
        });
    }

    unsubscribe(uuid: UnitUuid): Promise<void> {
        return this.enqueue(async () => {
            const account = this.user.uuid();
            await this.request({ action: 'unsubscribeCustomUnit', unitUuid: uuid });
            await this.library.removeRemote(uuid, account);
            await this.injector.get(DataService).refreshCustomUnits();
        });
    }

    resolveConflict(local: SavedCustomUnit, keepLocalCopy: boolean): Promise<void> {
        return this.enqueue(async () => {
            if (local.accountUuid !== this.user.uuid()) throw new Error('The account changed. Review this design again.');
            const remote = await this.fetch(local.uuid);
            if (keepLocalCopy) {
                const draft = this.library.parseDraft(local.source, local.format);
                await this.library.save(draft, { originalUnitUuid: local.originalUnitUuid ?? local.uuid });
            }
            await this.library.replaceConflicted(local, remote);
            this.conflicts.update(values => { const next = new Set(values); next.delete(local.uuid); return next; });
            this.error.set('');
            await this.injector.get(DataService).refreshCustomUnits();
        });
    }


}
