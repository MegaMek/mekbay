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
import { DbService, TagData, TagDataLegacy, TagEntry, UnitTagData, TagOp, StoredTags, StoredChassisTags } from './db.service';
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
            const data = await this.dbService.getAllTagData();
            
            if (!data) {
                // No data - start fresh with V3
                this.cachedTagData = { tags: {}, timestamp: 0, formatVersion: 3 };
            } else if (data.formatVersion === 3) {
                // Already V3, use directly
                this.cachedTagData = data as TagData;
            } else {
                // Legacy V1 format - migrate to V3
                const legacyData = data as TagDataLegacy;
                this.cachedTagData = this.migrateV1ToV3(
                    legacyData.nameTags || {},
                    legacyData.chassisTags || {},
                    legacyData.timestamp || 0
                );
                await this.dbService.saveAllTagData(this.cachedTagData);
                this.logger.info('Migrated tags from V1 to V3 format');
            }
            
            this.version.update(v => v + 1);
        } catch (err) {
            this.logger.error('Failed to load tags: ' + err);
        }
    }
    
    /**
     * Migrate V1 format to V3 format.
     * V1: main = { unitName: [tags] }, chassis = { chassisKey: [tags] }
     * V3: tags = { lowercaseTagId: { label, units: {}, chassis: {} } }
     */
    private migrateV1ToV3(
        nameTags: Record<string, string[]>,
        chassisTags: Record<string, string[]>,
        timestamp: number
    ): TagData {
        const tags: Record<string, TagEntry> = {};
        
        // Convert V1 nameTags: unitName -> [tags]
        for (const [unitName, tagList] of Object.entries(nameTags)) {
            for (const tag of tagList) {
                const tagId = tag.toLowerCase();
                if (!tags[tagId]) {
                    tags[tagId] = { label: tag, units: {}, chassis: {} };
                }
                tags[tagId].units[unitName] = {};
            }
        }
        
        // Convert V1 chassisTags: chassisKey -> [tags]
        for (const [chassisKey, tagList] of Object.entries(chassisTags)) {
            for (const tag of tagList) {
                const tagId = tag.toLowerCase();
                if (!tags[tagId]) {
                    tags[tagId] = { label: tag, units: {}, chassis: {} };
                }
                tags[tagId].chassis[chassisKey] = {};
            }
        }
        
        return { tags, timestamp, formatVersion: 3 };
    }

    /** Get cached tag data (or load from storage if not cached) */
    public async getTagData(): Promise<TagData> {
        if (!this.cachedTagData) {
            await this.initialize();
        }
        return this.cachedTagData!;
    }

    /** 
     * Get all name tags in V2-compatible format for UI.
     * Derives from V3: { tagId: { units: {unitName: {}} } } -> { tag: [unitNames] }
     */
    public getNameTags(): StoredTags {
        if (!this.cachedTagData) return {};
        const result: StoredTags = {};
        for (const [tagId, entry] of Object.entries(this.cachedTagData.tags)) {
            const unitNames = Object.keys(entry.units);
            if (unitNames.length > 0) {
                result[entry.label] = unitNames;
            }
        }
        return result;
    }

    /** 
     * Get all chassis tags in V2-compatible format for UI.
     * Derives from V3: { tagId: { chassis: {chassisKey: {}} } } -> { tag: [chassisKeys] }
     */
    public getChassisTags(): StoredChassisTags {
        if (!this.cachedTagData) return {};
        const result: StoredChassisTags = {};
        for (const [tagId, entry] of Object.entries(this.cachedTagData.tags)) {
            const chassisKeys = Object.keys(entry.chassis);
            if (chassisKeys.length > 0) {
                result[entry.label] = chassisKeys;
            }
        }
        return result;
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
        const tagId = trimmedTag.toLowerCase();
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
                    if (this.hasUnitTag(tagData, tagId, unit.name)) {
                        this.removeUnitTag(tagData, tagId, unit.name);
                        ops.push({ k: unit.name, t: trimmedTag, c: 0, a: 0, ts: now });
                    }

                    // Add to chassis tags if not already present
                    if (!this.hasChassisTag(tagData, tagId, chassisKey)) {
                        this.addChassisTag(tagData, trimmedTag, chassisKey);
                        ops.push({ k: chassisKey, t: trimmedTag, c: 1, a: 1, ts: now });
                    }
                } else {
                    // Remove from chassis tags
                    if (this.hasChassisTag(tagData, tagId, chassisKey)) {
                        this.removeChassisTag(tagData, tagId, chassisKey);
                        ops.push({ k: chassisKey, t: trimmedTag, c: 1, a: 0, ts: now });
                    }
                }
            } else {
                // Name-based tagging - skip if already processed
                if (processedKeys.has(`n:${unit.name}`)) continue;
                processedKeys.add(`n:${unit.name}`);

                if (action === 'add') {
                    if (!this.hasUnitTag(tagData, tagId, unit.name)) {
                        this.addUnitTag(tagData, trimmedTag, unit.name);
                        ops.push({ k: unit.name, t: trimmedTag, c: 0, a: 1, ts: now });
                    }
                } else {
                    if (this.hasUnitTag(tagData, tagId, unit.name)) {
                        this.removeUnitTag(tagData, tagId, unit.name);
                        ops.push({ k: unit.name, t: trimmedTag, c: 0, a: 0, ts: now });
                    }
                }
            }
        }

        // No actual changes made
        if (ops.length === 0) {
            return;
        }

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
        const tagId = tag.toLowerCase();
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedNameKeys = new Set<string>();
        const processedChassisKeys = new Set<string>();

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);

            // Remove from unit tags
            if (!processedNameKeys.has(unit.name) && this.hasUnitTag(tagData, tagId, unit.name)) {
                processedNameKeys.add(unit.name);
                this.removeUnitTag(tagData, tagId, unit.name);
                ops.push({ k: unit.name, t: tag, c: 0, a: 0, ts: now });
            }

            // Remove from chassis tags
            if (!processedChassisKeys.has(chassisKey) && this.hasChassisTag(tagData, tagId, chassisKey)) {
                processedChassisKeys.add(chassisKey);
                this.removeChassisTag(tagData, tagId, chassisKey);
                ops.push({ k: chassisKey, t: tag, c: 1, a: 0, ts: now });
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
     * Check if a tag exists in the specified tag type (case-insensitive).
     * @returns The actual tag label if it exists, or null if not found
     */
    public async tagExists(tag: string, tagType: 'name' | 'chassis'): Promise<string | null> {
        const tagData = await this.getTagData();
        const tagId = tag.toLowerCase();
        const entry = tagData.tags[tagId];
        if (!entry) return null;
        
        if (tagType === 'name') {
            return Object.keys(entry.units).length > 0 ? entry.label : null;
        } else {
            return Object.keys(entry.chassis).length > 0 ? entry.label : null;
        }
    }

    /**
     * Check if a tag ID exists at all (regardless of whether it has units or chassis).
     * @returns The actual tag label if it exists, or null if not found
     */
    public async tagIdExists(tag: string): Promise<string | null> {
        const tagData = await this.getTagData();
        const tagId = tag.toLowerCase();
        const entry = tagData.tags[tagId];
        return entry ? entry.label : null;
    }

    /**
     * Rename a tag (including case-only changes).
     * If the target tag exists and merge is true, merges ALL collections (units + chassis) from source into target.
     * If merge is false and target exists, returns 'conflict'.
     * 
     * For merges, pushes full state to cloud (ops can't represent merge properly).
     * This ensures subscribers get the complete merged data.
     * 
     * @returns 'success', 'not-found', or 'conflict'
     */
    public async renameTag(
        oldTag: string, 
        newTag: string, 
        merge: boolean = false
    ): Promise<'success' | 'not-found' | 'conflict'> {
        const tagData = await this.getTagData();
        const trimmedOld = oldTag.trim();
        const trimmedNew = newTag.trim();
        const oldId = trimmedOld.toLowerCase();
        const newId = trimmedNew.toLowerCase();
        const now = Date.now();

        // Check if old tag exists
        const oldEntry = tagData.tags[oldId];
        if (!oldEntry) {
            console.warn(`[TagsService] Tag "${trimmedOld}" not found for renaming`);
            return 'not-found';
        }

        // Check if tag has any items at all
        const hasUnits = Object.keys(oldEntry.units).length > 0;
        const hasChassis = Object.keys(oldEntry.chassis).length > 0;
        if (!hasUnits && !hasChassis) {
            return 'not-found';
        }

        // Check if new tag already exists (different tag ID)
        const newEntry = tagData.tags[newId];
        const isConflict = newEntry && newId !== oldId;
        
        if (isConflict && !merge) {
            return 'conflict';
        }

        const isMerge = isConflict && merge;

        if (newId === oldId) {
            // Just case change - update label and use incremental sync
            oldEntry.label = trimmedNew;
            tagData.timestamp = now;

            // Generate rename ops for both collections that have items
            const ops: TagOp[] = [];
            if (hasUnits) {
                ops.push({
                    k: '',
                    t: oldEntry.label,
                    c: 0,  // units
                    a: 2,  // rename
                    ts: now,
                    n: trimmedNew
                });
            }
            if (hasChassis) {
                ops.push({
                    k: '',
                    t: oldEntry.label,
                    c: 1,  // chassis
                    a: 2,  // rename
                    ts: now,
                    n: trimmedNew
                });
            }

            await this.dbService.appendTagOps(ops, tagData);
            this.cachedTagData = tagData;
            this.refreshUnitsCallback?.(tagData);
            this.notifyStoreUpdatedCallback?.();
            this.version.update(v => v + 1);
            void this.syncToCloud(ops);
        } else {
            // Different ID - merge or move
            // For merge: combine both collections and delete source
            // This requires full state sync since ops can't represent merge

            if (!newEntry) {
                // Create new entry with target label
                tagData.tags[newId] = { 
                    label: trimmedNew, 
                    units: {}, 
                    chassis: {} 
                };
            }

            // Merge BOTH units and chassis from old to new
            Object.assign(tagData.tags[newId].units, oldEntry.units);
            Object.assign(tagData.tags[newId].chassis, oldEntry.chassis);

            // Delete the old tag entirely
            delete tagData.tags[oldId];

            tagData.timestamp = now;

            if (isMerge) {
                // Merge operation: clear ops and push full state
                // This ensures all clients and subscribers get the complete merged data
                await this.dbService.saveAllTagData(tagData);
                this.cachedTagData = tagData;
                this.refreshUnitsCallback?.(tagData);
                this.notifyStoreUpdatedCallback?.();
                this.version.update(v => v + 1);

                // Push full state to cloud - this triggers broadcast to other sessions
                // and notifies public tag subscribers with full state
                void this.pushFullStateToCloud();
            } else {
                // Simple rename (not merge) - use rename ops
                const ops: TagOp[] = [];
                if (hasUnits) {
                    ops.push({
                        k: '',
                        t: trimmedOld,
                        c: 0,
                        a: 2,
                        ts: now,
                        n: trimmedNew
                    });
                }
                if (hasChassis) {
                    ops.push({
                        k: '',
                        t: trimmedOld,
                        c: 1,
                        a: 2,
                        ts: now,
                        n: trimmedNew
                    });
                }

                await this.dbService.appendTagOps(ops, tagData);
                this.cachedTagData = tagData;
                this.refreshUnitsCallback?.(tagData);
                this.notifyStoreUpdatedCallback?.();
                this.version.update(v => v + 1);
                void this.syncToCloud(ops);
            }
        }

        return 'success';
    }

    /**
     * Delete a tag entirely from both units and chassis.
     * This removes the tag and all its associations.
     */
    public async deleteTag(tag: string): Promise<void> {
        const tagData = await this.getTagData();
        const tagId = tag.toLowerCase();
        const now = Date.now();
        const ops: TagOp[] = [];

        const entry = tagData.tags[tagId];
        if (!entry) return;

        // Generate remove ops for each unit
        for (const unitName of Object.keys(entry.units)) {
            ops.push({ k: unitName, t: entry.label, c: 0, a: 0, ts: now });
        }

        // Generate remove ops for each chassis
        for (const chassisKey of Object.keys(entry.chassis)) {
            ops.push({ k: chassisKey, t: entry.label, c: 1, a: 0, ts: now });
        }

        // Delete the tag
        delete tagData.tags[tagId];

        // No changes made
        if (ops.length === 0) {
            return;
        }

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
        const tagId = tag.toLowerCase();

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);
            if (this.hasChassisTag(tagData, tagId, chassisKey)) {
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
        const tagId = tag.toLowerCase();
        const chassisKey = TagsService.getChassisTagKey(unit);

        // Check chassis tags first
        if (this.hasChassisTag(tagData, tagId, chassisKey)) {
            return 'chassis';
        }

        // Check unit tags
        if (this.hasUnitTag(tagData, tagId, unit.name)) {
            return 'name';
        }

        return null;
    }
    
    // ================== V3 Format Helpers ==================
    // V3 format: tags = { tagId: { label, units: {}, chassis: {} } }
    // Tag IDs are always lowercase for O(1) lookup
    
    /** Check if a unit has a specific tag */
    private hasUnitTag(tagData: TagData, tagId: string, unitName: string): boolean {
        return tagData.tags[tagId]?.units[unitName] !== undefined;
    }
    
    /** Check if a chassis has a specific tag */
    private hasChassisTag(tagData: TagData, tagId: string, chassisKey: string): boolean {
        return tagData.tags[tagId]?.chassis[chassisKey] !== undefined;
    }
    
    /** Add a tag to a unit */
    private addUnitTag(tagData: TagData, tag: string, unitName: string): void {
        const tagId = tag.toLowerCase();
        if (!tagData.tags[tagId]) {
            tagData.tags[tagId] = { label: tag, units: {}, chassis: {} };
        }
        tagData.tags[tagId].units[unitName] = {};
    }
    
    /** Remove a tag from a unit */
    private removeUnitTag(tagData: TagData, tagId: string, unitName: string): void {
        const entry = tagData.tags[tagId];
        if (!entry) return;
        delete entry.units[unitName];
        // Clean up empty tag
        if (Object.keys(entry.units).length === 0 && Object.keys(entry.chassis).length === 0) {
            delete tagData.tags[tagId];
        }
    }
    
    /** Add a tag to a chassis */
    private addChassisTag(tagData: TagData, tag: string, chassisKey: string): void {
        const tagId = tag.toLowerCase();
        if (!tagData.tags[tagId]) {
            tagData.tags[tagId] = { label: tag, units: {}, chassis: {} };
        }
        tagData.tags[tagId].chassis[chassisKey] = {};
    }
    
    /** Remove a tag from a chassis */
    private removeChassisTag(tagData: TagData, tagId: string, chassisKey: string): void {
        const entry = tagData.tags[tagId];
        if (!entry) return;
        delete entry.chassis[chassisKey];
        // Clean up empty tag
        if (Object.keys(entry.units).length === 0 && Object.keys(entry.chassis).length === 0) {
            delete tagData.tags[tagId];
        }
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
            const hasLocalTags = Object.keys(localData.tags).length > 0;

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
     * Server sends V3 format directly to protocol v2+ clients.
     */
    private async applyCloudState(response: any, serverTs: number): Promise<void> {
        if (response.fullState) {
            // Server sent full state in V3 format
            const v3Data: TagData = {
                tags: response.fullState.tags || {},
                timestamp: serverTs,
                formatVersion: 3
            };
            await this.dbService.saveAllTagData(v3Data);
            await this.dbService.clearPendingTagOps(serverTs);
            this.cachedTagData = v3Data;
            this.refreshUnitsCallback?.(v3Data);
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
     * Merge cloud state with local pending operations (V3 format).
     */
    private async mergeCloudAndLocal(response: any, pendingOps: TagOp[], serverTs: number): Promise<void> {
        // Start with current local state
        const tagData = await this.getTagData();

        // Apply cloud changes first (server ops or full state)
        if (response.fullState) {
            // Merge cloud V3 state into local: cloud additions get added, but don't remove local tags
            const cloudTags = response.fullState.tags || {};
            for (const [tagId, cloudEntry] of Object.entries(cloudTags) as [string, TagEntry][]) {
                if (!tagData.tags[tagId]) {
                    // New tag from cloud - add it
                    tagData.tags[tagId] = { ...cloudEntry };
                } else {
                    // Tag exists locally - merge units and chassis
                    const localEntry = tagData.tags[tagId];
                    for (const [unitKey, unitData] of Object.entries(cloudEntry.units)) {
                        if (!localEntry.units[unitKey]) {
                            localEntry.units[unitKey] = unitData;
                        }
                    }
                    for (const [chassisKey, chassisData] of Object.entries(cloudEntry.chassis)) {
                        if (!localEntry.chassis[chassisKey]) {
                            localEntry.chassis[chassisKey] = chassisData;
                        }
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
     * Apply tag operations to tag data (V3 format).
     * Actions: 0 = remove, 1 = add, 2 = rename
     */
    private applyTagOps(tagData: TagData, ops: TagOp[]): void {
        for (const op of ops) {
            const { k: key, t: tag, c: category, a: action, q: quantity, n: newTag } = op;
            const tagId = tag.toLowerCase();

            if (action === 2 && newTag) {
                // Rename: move entry from old tagId to new tagId
                const oldTagId = tagId;
                const newTagId = newTag.toLowerCase();
                if (tagData.tags[oldTagId]) {
                    const entry = tagData.tags[oldTagId];
                    entry.label = newTag; // Update to new case
                    tagData.tags[newTagId] = entry;
                    delete tagData.tags[oldTagId];
                }
            } else if (action === 1) {
                // Add
                if (!tagData.tags[tagId]) {
                    tagData.tags[tagId] = { label: tag, units: {}, chassis: {} };
                } else if (tagData.tags[tagId].label !== tag) {
                    // Update case if different
                    tagData.tags[tagId].label = tag;
                }
                const entry = tagData.tags[tagId];
                if (category === 1) {
                    entry.chassis[key] = quantity != null ? { q: quantity } : {};
                } else {
                    entry.units[key] = quantity != null ? { q: quantity } : {};
                }
            } else {
                // Remove (action === 0)
                if (tagData.tags[tagId]) {
                    const entry = tagData.tags[tagId];
                    if (category === 1) {
                        delete entry.chassis[key];
                    } else {
                        delete entry.units[key];
                    }
                    // Clean up empty entries
                    if (Object.keys(entry.units).length === 0 && Object.keys(entry.chassis).length === 0) {
                        delete tagData.tags[tagId];
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
