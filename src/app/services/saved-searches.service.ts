/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { DbService, StoredSavedSearches, SavedSearchOp } from './db.service';
import { SerializedSearchFilter } from './unit-search-filters.service';
import { WsService, generateUUID } from './ws.service';
import { UserStateService } from './userState.service';
import { LoggerService } from './logger.service';
import { DialogsService } from './dialogs.service';
import { GameSystem } from '../models/common.model';

/*
 * Author: Drake
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

    /** Get saved searches filtered by game system */
    public getSearchesForGameSystem(gameSystem: GameSystem): SerializedSearchFilter[] {
        const all = this.cachedSearches();
        const gsKey = gameSystem === GameSystem.ALPHA_STRIKE ? 'as' : 'cbt';
        return Object.values(all)
            .filter(s => s.gameSystem === gsKey)
            .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
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
