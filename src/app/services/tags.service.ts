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

import { Injectable, inject, signal } from '@angular/core';
import { DbService, TagData, TagOp, StoredTags, StoredChassisTags } from './db.service';
import { WsService } from './ws.service';
import { UserStateService } from './userState.service';
import { LoggerService } from './logger.service';
import { DialogsService } from './dialogs.service';
import { Unit } from '../models/units.model';

/*
 * Author: Drake
 * 
 * Service for managing unit tags with local storage and cloud sync.
 * Supports both unit-specific (name) tags and chassis-wide tags.
 * Uses incremental sync with operations log for efficient cloud synchronization.
 */

/** Chunk size for large batch operations to stay within server limits */
const TAG_OPS_CHUNK_SIZE = 1000;

@Injectable({
    providedIn: 'root'
})
export class TagsService {
    private readonly dbService = inject(DbService);
    private readonly wsService = inject(WsService);
    private readonly userStateService = inject(UserStateService);
    private readonly logger = inject(LoggerService);
    private readonly dialogsService = inject(DialogsService);

    /** Cached tag data for quick access */
    private cachedTagData: TagData | null = null;
    
    /** Version signal to trigger reactivity on updates */
    public readonly version = signal(0);

    /** Callback to refresh unit tags on units - set by DataService */
    private refreshUnitsCallback: ((tagData: TagData | null) => void) | null = null;

    /** Callback to notify other tabs - set by DataService */
    private notifyStoreUpdatedCallback: (() => void) | null = null;

    /**
     * Set the callback to refresh unit tags on units.
     * This is called by DataService to wire up the connection.
     */
    public setRefreshUnitsCallback(callback: (tagData: TagData | null) => void): void {
        this.refreshUnitsCallback = callback;
    }

    /**
     * Set the callback to notify other tabs of changes.
     * This is called by DataService to wire up the connection.
     */
    public setNotifyStoreUpdatedCallback(callback: () => void): void {
        this.notifyStoreUpdatedCallback = callback;
    }

    /**
     * Generates the chassis tag key for a unit.
     * Format: `${chassis}|${type}` to uniquely identify a chassis across types.
     */
    public static getChassisTagKey(unit: Unit): string {
        return `${unit.chassis}|${unit.type}`;
    }

    // ================== Initialization ==================

    /** Initialize and load tags from storage */
    public async initialize(): Promise<void> {
        try {
            this.cachedTagData = await this.dbService.getAllTagData();
            this.version.update(v => v + 1);
        } catch (err) {
            this.logger.error('Failed to load tags: ' + err);
        }
    }

    /** Get cached tag data (or load from storage if not cached) */
    public async getTagData(): Promise<TagData> {
        if (!this.cachedTagData) {
            this.cachedTagData = await this.dbService.getAllTagData() ?? {
                nameTags: {},
                chassisTags: {},
                timestamp: 0
            };
        }
        return this.cachedTagData;
    }

    /** Get all name tags */
    public getNameTags(): StoredTags {
        return this.cachedTagData?.nameTags ?? {};
    }

    /** Get all chassis tags */
    public getChassisTags(): StoredChassisTags {
        return this.cachedTagData?.chassisTags ?? {};
    }

    // ================== Tag Modification ==================

    /**
     * Add or remove a tag from units, with support for chassis-wide tagging.
     * @param units The units to tag
     * @param tag The tag to add/remove
     * @param tagType 'name' for unit-specific or 'chassis' for chassis-wide
     * @param action 'add' to add the tag, 'remove' to remove it
     */
    public async modifyTag(
        units: Unit[], 
        tag: string, 
        tagType: 'name' | 'chassis',
        action: 'add' | 'remove'
    ): Promise<void> {
        const tagData = await this.getTagData();

        const trimmedTag = tag.trim();
        const lowerTag = trimmedTag.toLowerCase();
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedKeys = new Set<string>();

        for (const unit of units) {
            if (tagType === 'chassis') {
                const chassisKey = TagsService.getChassisTagKey(unit);

                // Skip if already processed this chassis
                if (processedKeys.has(`c:${chassisKey}`)) continue;
                processedKeys.add(`c:${chassisKey}`);

                if (action === 'add') {
                    // When adding a chassis tag, remove any existing name tag with the same value
                    // This "expands" the tag from unit-specific to chassis-wide
                    if (tagData.nameTags[unit.name]?.some(t => t.toLowerCase() === lowerTag)) {
                        tagData.nameTags[unit.name] = tagData.nameTags[unit.name]
                            .filter(t => t.toLowerCase() !== lowerTag);
                        if (tagData.nameTags[unit.name].length === 0) {
                            delete tagData.nameTags[unit.name];
                        }
                        ops.push({ k: unit.name, t: trimmedTag, c: 0, a: 0, ts: now });
                    }

                    // Add to chassis tags if not already present
                    if (!tagData.chassisTags[chassisKey]) {
                        tagData.chassisTags[chassisKey] = [];
                    }
                    if (!tagData.chassisTags[chassisKey].some(t => t.toLowerCase() === lowerTag)) {
                        tagData.chassisTags[chassisKey].push(trimmedTag);
                        ops.push({ k: chassisKey, t: trimmedTag, c: 1, a: 1, ts: now });
                    }
                } else {
                    // Remove from chassis tags
                    if (tagData.chassisTags[chassisKey]?.some(t => t.toLowerCase() === lowerTag)) {
                        tagData.chassisTags[chassisKey] = tagData.chassisTags[chassisKey]
                            .filter(t => t.toLowerCase() !== lowerTag);
                        if (tagData.chassisTags[chassisKey].length === 0) {
                            delete tagData.chassisTags[chassisKey];
                        }
                        ops.push({ k: chassisKey, t: trimmedTag, c: 1, a: 0, ts: now });
                    }
                }
            } else {
                // Name-based tagging - skip if already processed
                if (processedKeys.has(`n:${unit.name}`)) continue;
                processedKeys.add(`n:${unit.name}`);

                if (action === 'add') {
                    if (!tagData.nameTags[unit.name]) {
                        tagData.nameTags[unit.name] = [];
                    }
                    if (!tagData.nameTags[unit.name].some(t => t.toLowerCase() === lowerTag)) {
                        tagData.nameTags[unit.name].push(trimmedTag);
                        ops.push({ k: unit.name, t: trimmedTag, c: 0, a: 1, ts: now });
                    }
                } else {
                    if (tagData.nameTags[unit.name]?.some(t => t.toLowerCase() === lowerTag)) {
                        tagData.nameTags[unit.name] = tagData.nameTags[unit.name]
                            .filter(t => t.toLowerCase() !== lowerTag);
                        if (tagData.nameTags[unit.name].length === 0) {
                            delete tagData.nameTags[unit.name];
                        }
                        ops.push({ k: unit.name, t: trimmedTag, c: 0, a: 0, ts: now });
                    }
                }
            }
        }

        // No actual changes made
        if (ops.length === 0) return;

        // Update timestamp
        tagData.timestamp = now;

        // Save state and operations atomically
        await this.dbService.appendTagOps(ops, tagData);

        // Update cached data and notify
        this.cachedTagData = tagData;
        this.refreshUnitsCallback?.(tagData);
        this.notifyStoreUpdatedCallback?.();
        this.version.update(v => v + 1);

        // Sync operations to cloud (incremental, fire-and-forget)
        void this.syncToCloud(ops);
    }

    /**
     * Remove a tag from units. Removes from both name and chassis tags.
     */
    public async removeTagFromUnits(units: Unit[], tag: string): Promise<void> {
        const tagData = await this.getTagData();

        const lowerTag = tag.toLowerCase();
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedNameKeys = new Set<string>();
        const processedChassisKeys = new Set<string>();

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);

            // Remove from name tags
            if (!processedNameKeys.has(unit.name) && tagData.nameTags[unit.name]?.some(t => t.toLowerCase() === lowerTag)) {
                processedNameKeys.add(unit.name);
                const originalTag = tagData.nameTags[unit.name].find(t => t.toLowerCase() === lowerTag) || tag;
                tagData.nameTags[unit.name] = tagData.nameTags[unit.name]
                    .filter(t => t.toLowerCase() !== lowerTag);
                if (tagData.nameTags[unit.name].length === 0) {
                    delete tagData.nameTags[unit.name];
                }
                ops.push({ k: unit.name, t: originalTag, c: 0, a: 0, ts: now });
            }

            // Remove from chassis tags
            if (!processedChassisKeys.has(chassisKey) && tagData.chassisTags[chassisKey]?.some(t => t.toLowerCase() === lowerTag)) {
                processedChassisKeys.add(chassisKey);
                const originalTag = tagData.chassisTags[chassisKey].find(t => t.toLowerCase() === lowerTag) || tag;
                tagData.chassisTags[chassisKey] = tagData.chassisTags[chassisKey]
                    .filter(t => t.toLowerCase() !== lowerTag);
                if (tagData.chassisTags[chassisKey].length === 0) {
                    delete tagData.chassisTags[chassisKey];
                }
                ops.push({ k: chassisKey, t: originalTag, c: 1, a: 0, ts: now });
            }
        }

        // No actual changes made
        if (ops.length === 0) return;

        // Update timestamp
        tagData.timestamp = now;

        // Save state and operations atomically
        await this.dbService.appendTagOps(ops, tagData);

        // Update cached data and notify
        this.cachedTagData = tagData;
        this.refreshUnitsCallback?.(tagData);
        this.notifyStoreUpdatedCallback?.();
        this.version.update(v => v + 1);

        // Sync operations to cloud (incremental, fire-and-forget)
        void this.syncToCloud(ops);
    }

    /**
     * Check if a tag is assigned at the chassis level for any of the given units.
     */
    public async isChassisTag(units: Unit[], tag: string): Promise<boolean> {
        const tagData = await this.getTagData();
        const lowerTag = tag.toLowerCase();

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);
            const chassisTags = tagData.chassisTags[chassisKey] ?? [];
            if (chassisTags.some(t => t.toLowerCase() === lowerTag)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the tag type for a specific tag on a unit.
     * Returns 'chassis' if it's a chassis-wide tag, 'name' if unit-specific, or null if not found.
     */
    public async getTagType(unit: Unit, tag: string): Promise<'chassis' | 'name' | null> {
        const tagData = await this.getTagData();
        const lowerTag = tag.toLowerCase();
        const chassisKey = TagsService.getChassisTagKey(unit);

        // Check chassis tags first
        const chassisTags = tagData.chassisTags[chassisKey] ?? [];
        if (chassisTags.some(t => t.toLowerCase() === lowerTag)) {
            return 'chassis';
        }

        // Check name tags
        const nameTags = tagData.nameTags[unit.name] ?? [];
        if (nameTags.some(t => t.toLowerCase() === lowerTag)) {
            return 'name';
        }

        return null;
    }

    // ================== Cloud Sync ==================

    private async canUseCloud(): Promise<boolean> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return false;
        try {
            const ws = this.wsService.getWebSocket();
            return ws !== null && ws.readyState === WebSocket.OPEN;
        } catch {
            return false;
        }
    }

    /**
     * Sync tag operations to cloud (incremental).
     * Sends only the operations, not the full state.
     */
    private async syncToCloud(ops?: TagOp[]): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        // If no ops provided, get pending ops from storage
        let opsToSync = ops;
        if (!opsToSync) {
            const syncState = await this.dbService.getTagSyncState();
            opsToSync = syncState.pendingOps;
        }
        if (opsToSync.length === 0) return;

        // Chunk large batches to stay within server limits
        for (let i = 0; i < opsToSync.length; i += TAG_OPS_CHUNK_SIZE) {
            const chunk = opsToSync.slice(i, i + TAG_OPS_CHUNK_SIZE);
            try {
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'tagOps',
                    uuid,
                    ops: chunk
                });
                // Clear pending ops after successful sync
                if (response?.serverTs) {
                    await this.dbService.clearPendingTagOps(response.serverTs);
                }
            } catch (err) {
                this.logger.error('Failed to sync tag ops to cloud: ' + err);
                // Keep pending ops for retry on next sync
            }
        }
    }

    /**
     * Push full local state to cloud, replacing server state.
     */
    private async pushFullStateToCloud(): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        const localData = await this.getTagData();

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'setTagState',
            uuid,
            data: localData
        });

        if (response && response.serverTs) {
            await this.dbService.clearPendingTagOps(response.serverTs);
        }
    }

    /**
     * Fetch tags from cloud and merge with local if needed.
     * Called on login/register and when coming back online.
     * Uses incremental sync with conflict detection.
     */
    public async syncFromCloud(): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        try {
            const syncState = await this.dbService.getTagSyncState();
            const localData = await this.getTagData();
            const hasPendingOps = syncState.pendingOps.length > 0;
            const hasLocalTags = 
                Object.keys(localData.nameTags).length > 0 || 
                Object.keys(localData.chassisTags).length > 0;

            // Request server state info (timestamp) and any ops since our last sync
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getTagOps',
                uuid,
                since: syncState.lastSyncTs
            });

            if (!response || response.action === 'error') return;

            const serverTs: number = response.serverTs ?? 0;

            // Migration case: local has tags but server has no data
            // Push local state to cloud to preserve existing tags
            if (hasLocalTags && serverTs === 0 && !response.fullState && (!response.ops || response.ops.length === 0)) {
                this.logger.info('Migrating local tags to cloud (first sync)');
                await this.pushFullStateToCloud();
                return;
            }

            // Conflict detection: we have pending ops AND server has changed since our last sync
            // (but not if serverTs is 0, meaning server has no data yet)
            if (hasPendingOps && serverTs > 0 && syncState.lastSyncTs !== serverTs) {
                // Potential conflict - ask user how to resolve
                const resolution = await this.showConflictDialog();
                
                switch (resolution) {
                    case 'cloud':
                        // Drop local pending, use cloud state
                        await this.applyCloudState(response, serverTs);
                        break;
                    case 'merge':
                        // Apply cloud changes first, then re-apply our pending ops on top
                        await this.mergeCloudAndLocal(response, syncState.pendingOps, serverTs);
                        break;
                    case 'local':
                        // Push our full local state to cloud
                        await this.pushFullStateToCloud();
                        break;
                }
                return;
            }

            // No conflict: either no pending ops, or timestamps match (safe to sync)
            if (hasPendingOps) {
                // Timestamps match - safe to just upload our pending ops
                await this.syncToCloud(syncState.pendingOps);
            } else {
                // No pending ops - apply any cloud changes
                await this.applyCloudState(response, serverTs);
            }
        } catch (err) {
            this.logger.error('Failed to sync tags from cloud: ' + err);
        }
    }

    /**
     * Apply cloud state (either full state or incremental ops).
     */
    private async applyCloudState(response: any, serverTs: number): Promise<void> {
        if (response.fullState) {
            // Server sent full state (migration or first sync)
            const cloudData = response.fullState as TagData;
            await this.dbService.saveAllTagData(cloudData);
            await this.dbService.clearPendingTagOps(serverTs);
            this.cachedTagData = cloudData;
            this.refreshUnitsCallback?.(cloudData);
            this.notifyStoreUpdatedCallback?.();
            this.version.update(v => v + 1);
        } else if (response.ops && response.ops.length > 0) {
            // Apply incremental operations
            const localData = await this.getTagData();
            this.applyTagOps(localData, response.ops);
            localData.timestamp = serverTs;
            await this.dbService.saveAllTagData(localData);
            await this.dbService.clearPendingTagOps(serverTs);
            this.cachedTagData = localData;
            this.refreshUnitsCallback?.(localData);
            this.notifyStoreUpdatedCallback?.();
            this.version.update(v => v + 1);
        } else {
            // No new ops, just update sync timestamp
            await this.dbService.clearPendingTagOps(serverTs);
        }
    }

    /**
     * Merge cloud state with local pending operations.
     */
    private async mergeCloudAndLocal(response: any, pendingOps: TagOp[], serverTs: number): Promise<void> {
        // Start with current local state
        const tagData = await this.getTagData();

        // Apply cloud changes first (server ops or full state)
        if (response.fullState) {
            // Merge cloud state into local: cloud additions get added, but don't remove local tags
            const cloudData = response.fullState as TagData;
            for (const [key, tags] of Object.entries(cloudData.nameTags || {})) {
                if (!tagData.nameTags[key]) tagData.nameTags[key] = [];
                for (const tag of tags) {
                    if (!tagData.nameTags[key].some(t => t.toLowerCase() === tag.toLowerCase())) {
                        tagData.nameTags[key].push(tag);
                    }
                }
            }
            for (const [key, tags] of Object.entries(cloudData.chassisTags || {})) {
                if (!tagData.chassisTags[key]) tagData.chassisTags[key] = [];
                for (const tag of tags) {
                    if (!tagData.chassisTags[key].some(t => t.toLowerCase() === tag.toLowerCase())) {
                        tagData.chassisTags[key].push(tag);
                    }
                }
            }
        } else if (response.ops && response.ops.length > 0) {
            // Apply server's incremental ops first
            this.applyTagOps(tagData, response.ops);
        }

        // Now apply our pending ops on top (they win in merge)
        this.applyTagOps(tagData, pendingOps);
        tagData.timestamp = Date.now();

        // Save merged state locally
        await this.dbService.saveAllTagData(tagData);
        this.cachedTagData = tagData;
        this.refreshUnitsCallback?.(tagData);

        // Push merged state to cloud
        await this.pushFullStateToCloud();
        
        this.notifyStoreUpdatedCallback?.();
        this.version.update(v => v + 1);
    }

    /**
     * Apply tag operations to tag data.
     */
    private applyTagOps(tagData: TagData, ops: TagOp[]): void {
        for (const op of ops) {
            const { k: key, t: tag, c: category, a: action } = op;
            const lowerTag = tag.toLowerCase();

            if (category === 1) {
                // Chassis tag
                if (action === 1) {
                    // Add
                    if (!tagData.chassisTags[key]) {
                        tagData.chassisTags[key] = [];
                    }
                    if (!tagData.chassisTags[key].some(t => t.toLowerCase() === lowerTag)) {
                        tagData.chassisTags[key].push(tag);
                    }
                } else {
                    // Remove
                    if (tagData.chassisTags[key]) {
                        tagData.chassisTags[key] = tagData.chassisTags[key]
                            .filter(t => t.toLowerCase() !== lowerTag);
                        if (tagData.chassisTags[key].length === 0) {
                            delete tagData.chassisTags[key];
                        }
                    }
                }
            } else {
                // Name tag
                if (action === 1) {
                    // Add
                    if (!tagData.nameTags[key]) {
                        tagData.nameTags[key] = [];
                    }
                    if (!tagData.nameTags[key].some(t => t.toLowerCase() === lowerTag)) {
                        tagData.nameTags[key].push(tag);
                    }
                } else {
                    // Remove
                    if (tagData.nameTags[key]) {
                        tagData.nameTags[key] = tagData.nameTags[key]
                            .filter(t => t.toLowerCase() !== lowerTag);
                        if (tagData.nameTags[key].length === 0) {
                            delete tagData.nameTags[key];
                        }
                    }
                }
            }
        }
    }

    /**
     * Show conflict resolution dialog when local and cloud tags are out of sync.
     */
    private showConflictDialog(): Promise<'cloud' | 'merge' | 'local'> {
        return this.dialogsService.choose(
            'Tag Sync Conflict',
            'Your local tag changes conflict with changes made on another device. How would you like to resolve this?',
            [
                { label: 'USE CLOUD', value: 'cloud' as const },
                { label: 'MERGE (KEEP BOTH)', value: 'merge' as const },
                { label: 'USE LOCAL', value: 'local' as const }
            ],
            'merge'
        );
    }

    // ================== WebSocket Handlers ==================

    /** Register WebSocket handlers for real-time updates from other sessions */
    public registerWsHandlers(): void {
        // Handle remote tag operations from other sessions of the same user
        this.wsService.registerMessageHandler('tagOps', async (msg) => {
            if (msg.ops) {
                await this.handleRemoteTagOps(msg.ops);
            }
        });

        // Handle state reset notification - another session did a full state replacement
        this.wsService.registerMessageHandler('tagStateReset', async () => {
            // Clear our pending ops and re-sync from server
            await this.dbService.clearPendingTagOps(0); // Reset lastSyncTs to force full sync
            await this.syncFromCloud();
        });

        // Sync tags after user login/registration
        this.wsService.registerMessageHandler('userState', async () => {
            const uuid = this.userStateService.uuid();
            if (uuid) {
                await this.syncFromCloud();
            }
        });
    }

    /**
     * Handle remote tag updates from other sessions.
     * Receives operations instead of full state.
     */
    public async handleRemoteTagOps(ops: TagOp[]): Promise<void> {
        if (!ops || ops.length === 0) return;

        const localData = await this.getTagData();

        // Apply operations
        this.applyTagOps(localData, ops);
        localData.timestamp = Math.max(localData.timestamp, ...ops.map(op => op.ts));

        await this.dbService.saveAllTagData(localData);
        this.cachedTagData = localData;
        this.refreshUnitsCallback?.(localData);
        this.notifyStoreUpdatedCallback?.();
        this.version.update(v => v + 1);
    }
}
