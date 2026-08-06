// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject, signal, computed } from '@angular/core';
import { DbService, type StoredSavedSearches, type SavedSearchOp } from './db.service';
import type { SerializedSearchFilter } from './unit-search-filters.model';
import { WsService } from './ws.service';
import { UserStateService } from './userState.service';
import { LoggerService } from './logger.service';
import { DialogsService } from './dialogs.service';
import { GameSystem } from '../models/common.model';
import { naturalCompare } from '../utils/sort.util';

/*
 * 
 * Service for managing saved search bookmarks with local storage and cloud sync.
 * Follows the same incremental sync pattern as tags.
 */

const MAX_SAVED_SEARCHES = 100;

@Injectable({
    providedIn: 'root'
})
export class SavedSearchesService {
    private readonly dbService = inject(DbService);
    private readonly wsService = inject(WsService);
    private readonly userStateService = inject(UserStateService);
    private readonly logger = inject(LoggerService);
    private readonly dialogsService = inject(DialogsService);

    /** Cached saved searches for quick access */
    private cachedSearches = signal<StoredSavedSearches>({});
    
    /** Version signal to trigger reactivity on updates */
    public readonly version = signal(0);

    /** All saved searches as a computed signal */
    public readonly savedSearches = computed(() => {
        this.version(); // Subscribe to changes
        return this.cachedSearches();
    });

    /** Get saved searches filtered by game system. Includes game-agnostic searches (no gameSystem). */
    public getSearchesForGameSystem(gameSystem: GameSystem): SerializedSearchFilter[] {
        const all = this.cachedSearches();
        const gsKey = gameSystem === GameSystem.ALPHA_STRIKE ? 'as' : 'cbt';
        return Object.values(all)
            .filter(s => !s.gameSystem || s.gameSystem === gsKey)
            .sort((a, b) => naturalCompare(a.name, b.name));
    }

    /** Get all saved searches without filtering by game system */
    public getAllSearches(): SerializedSearchFilter[] {
        const all = this.cachedSearches();
        return Object.values(all)
            .sort((a, b) => naturalCompare(a.name, b.name));
    }

    /** Initialize and load saved searches from storage */
    public async initialize(): Promise<void> {
        try {
            const stored = await this.dbService.getSavedSearches();
            if (stored) {
                this.cachedSearches.set(stored);
            }
            this.version.update(v => v + 1);
        } catch (err) {
            this.logger.error('Failed to load saved searches: ' + err);
        }
    }

    /** Save a new search bookmark */
    public async saveSearch(filter: SerializedSearchFilter): Promise<void> {
        const searches = { ...this.cachedSearches() };
        
        // Check limit
        if (Object.keys(searches).length >= MAX_SAVED_SEARCHES && !searches[filter.id]) {
            await this.dialogsService.showNotice(
                `Maximum of ${MAX_SAVED_SEARCHES} saved searches reached. Please delete some before adding more.`,
                'Limit Reached'
            );
            return;
        }

        searches[filter.id] = filter;
        
        const op: SavedSearchOp = {
            id: filter.id,
            a: 1, // add/update
            data: filter,
            ts: Date.now()
        };

        await this.dbService.appendSavedSearchOps([op], searches);
        this.cachedSearches.set(searches);
        this.version.update(v => v + 1);

        // Sync to cloud if connected
        this.syncToCloud();
    }

    /** Rename an existing search */
    public async renameSearch(id: string, newName: string): Promise<void> {
        const searches = { ...this.cachedSearches() };
        const existing = searches[id];
        if (!existing) return;

        const updated: SerializedSearchFilter = {
            ...existing,
            name: newName,
            timestamp: Date.now()
        };
        searches[id] = updated;

        const op: SavedSearchOp = {
            id,
            a: 1,
            data: updated,
            ts: Date.now()
        };

        await this.dbService.appendSavedSearchOps([op], searches);
        this.cachedSearches.set(searches);
        this.version.update(v => v + 1);

        this.syncToCloud();
    }

    /** Delete a saved search */
    public async deleteSearch(id: string): Promise<void> {
        const searches = { ...this.cachedSearches() };
        if (!searches[id]) return;

        delete searches[id];

        const op: SavedSearchOp = {
            id,
            a: 0, // delete
            ts: Date.now()
        };

        await this.dbService.appendSavedSearchOps([op], searches);
        this.cachedSearches.set(searches);
        this.version.update(v => v + 1);

        this.syncToCloud();
    }

    /** Get a search by ID */
    public getSearch(id: string): SerializedSearchFilter | undefined {
        return this.cachedSearches()[id];
    }

    // ================== Cloud Sync ==================

    private async canUseCloud(): Promise<boolean> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return false;
        try {
            await this.wsService.waitForWebSocket();
            return this.wsService.wsConnected();
        } catch {
            return false;
        }
    }

    /** Sync pending operations to cloud */
    private async syncToCloud(): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        try {
            const syncState = await this.dbService.getSavedSearchSyncState();
            if (syncState.pendingOps.length === 0) return;

            const response = await this.wsService.sendAndWaitForResponse({
                action: 'savedSearchOps',
                uuid,
                ops: syncState.pendingOps
            });

            if (response && response.action !== 'error') {
                await this.dbService.clearPendingSavedSearchOps(response.serverTs || Date.now());
            }
        } catch (err) {
            this.logger.error('Failed to sync saved searches to cloud: ' + err);
        }
    }

    /** Fetch saved searches from cloud and merge with local */
    public async syncFromCloud(): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        try {
            const { searches, pendingOps, lastSyncTs } = await this.dbService.getAllSavedSearchData();
            const hasPending = pendingOps.length > 0;
            const hasLocal = Object.keys(searches).length > 0;

            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getSavedSearches',
                uuid,
                since: lastSyncTs
            });

            if (!response || response.action === 'error') return;

            const serverTs: number = response.serverTs ?? 0;

            // Migration: local has data but server is empty
            if (hasLocal && serverTs === 0 && !response.searches && (!response.ops || response.ops.length === 0)) {
                this.logger.info('Migrating local saved searches to cloud');
                await this.pushFullStateToCloud();
                return;
            }

            // Conflict: pending ops and server changed
            if (hasPending && serverTs > 0 && lastSyncTs !== serverTs) {
                const resolution = await this.showConflictDialog();
                switch (resolution) {
                    case 'cloud':
                        await this.applyCloudState(response, serverTs);
                        break;
                    case 'merge':
                        await this.mergeCloudAndLocal(response, pendingOps, serverTs);
                        break;
                    case 'local':
                        await this.pushFullStateToCloud();
                        break;
                }
                return;
            }

            // No conflict
            if (hasPending) {
                await this.syncToCloud();
            } else {
                await this.applyCloudState(response, serverTs);
            }
        } catch (err) {
            this.logger.error('Failed to sync saved searches from cloud: ' + err);
        }
    }

    private async applyCloudState(response: any, serverTs: number): Promise<void> {
        if (response.searches) {
            // Full state from server
            const cloudSearches = response.searches as StoredSavedSearches;
            await this.dbService.saveAllSavedSearchData(cloudSearches, serverTs);
            this.cachedSearches.set(cloudSearches);
            this.version.update(v => v + 1);
        } else if (response.ops && response.ops.length > 0) {
            // Incremental ops
            const searches = { ...this.cachedSearches() };
            this.applyOps(searches, response.ops);
            await this.dbService.saveAllSavedSearchData(searches, serverTs);
            this.cachedSearches.set(searches);
            this.version.update(v => v + 1);
        } else {
            await this.dbService.clearPendingSavedSearchOps(serverTs);
        }
    }

    private async mergeCloudAndLocal(response: any, pendingOps: SavedSearchOp[], serverTs: number): Promise<void> {
        const searches = { ...this.cachedSearches() };

        // Apply cloud changes first
        if (response.searches) {
            const cloudSearches = response.searches as StoredSavedSearches;
            for (const [id, search] of Object.entries(cloudSearches)) {
                if (!searches[id] || (searches[id].timestamp ?? 0) < (search.timestamp ?? 0)) {
                    searches[id] = search;
                }
            }
        } else if (response.ops) {
            this.applyOps(searches, response.ops);
        }

        // Apply pending ops on top
        this.applyOps(searches, pendingOps);

        await this.dbService.saveAllSavedSearchData(searches, Date.now());
        this.cachedSearches.set(searches);
        this.version.update(v => v + 1);

        await this.pushFullStateToCloud();
    }

    private applyOps(searches: StoredSavedSearches, ops: SavedSearchOp[]): void {
        for (const op of ops) {
            if (op.a === 1 && op.data) {
                searches[op.id] = op.data;
            } else if (op.a === 0) {
                delete searches[op.id];
            }
        }
    }

    private async pushFullStateToCloud(): Promise<void> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        const searches = this.cachedSearches();
        const response = await this.wsService.sendAndWaitForResponse({
            action: 'setSavedSearches',
            uuid,
            searches
        });

        if (response && response.action !== 'error') {
            await this.dbService.clearPendingSavedSearchOps(response.serverTs || Date.now());
        }
    }

    private showConflictDialog(): Promise<'cloud' | 'merge' | 'local'> {
        return this.dialogsService.choose(
            'Saved Searches Sync Conflict',
            'Your local saved searches conflict with changes made on another device. How would you like to resolve this?',
            [
                { label: 'USE CLOUD', value: 'cloud' as const },
                { label: 'MERGE (KEEP BOTH)', value: 'merge' as const },
                { label: 'USE LOCAL', value: 'local' as const }
            ],
            'merge'
        );
    }

    /** Register WebSocket handlers for real-time updates from other sessions */
    public registerWsHandlers(): void {
        // Handle remote saved search operations from other sessions
        this.wsService.registerMessageHandler('savedSearchOpsUpdate', async (msg) => {
            if (!msg.ops || !Array.isArray(msg.ops)) return;
            
            const searches = { ...this.cachedSearches() };
            this.applyOps(searches, msg.ops);
            
            await this.dbService.saveSavedSearches(searches);
            this.cachedSearches.set(searches);
            this.version.update(v => v + 1);
        });

        // Handle state reset notification - another session did a full state replacement
        this.wsService.registerMessageHandler('savedSearchStateReset', async () => {
            await this.dbService.clearPendingSavedSearchOps(0);
            await this.syncFromCloud();
        });

        // Sync saved searches after user login/registration
        this.wsService.registerMessageHandler('userState', async () => {
            const uuid = this.userStateService.uuid();
            if (uuid) {
                await this.syncFromCloud();
            }
        });
    }
}
