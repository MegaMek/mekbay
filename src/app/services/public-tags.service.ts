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
import { WsService } from './ws.service';
import { UserStateService } from './userState.service';
import { DbService, PublicTagData, TagEntry, TagOp } from './db.service';
import { LoggerService } from './logger.service';
import { Unit, PublicTagInfo } from '../models/units.model';
import { TagsService } from './tags.service';
import { DialogsService } from './dialogs.service';

/*
 * Author: Drake
 *
 * Service for managing public tags from other users.
 * Handles temporary imports and permanent subscriptions.
 * Uses incremental sync with timestamps and ops for efficiency.
 */

/** Make a subscription key from publicId and tagName */
export function makeSubKey(publicId: string, tagName: string): string {
    return `${publicId}:${tagName}`;
}

/** Parse a subscription key into publicId and tagName */
export function parseSubKey(key: string): { publicId: string; tagName: string } {
    const idx = key.indexOf(':');
    return {
        publicId: key.substring(0, idx),
        tagName: key.substring(idx + 1)
    };
}

/**
 * Extract unit names and chassis keys from V3 tag data for a specific tag.
 */
function extractFromV3Tags(
    tags: Record<string, TagEntry> | undefined,
    tagName: string
): { unitNames: string[]; chassisKeys: string[] } {
    if (!tags) return { unitNames: [], chassisKeys: [] };
    const tagId = tagName.toLowerCase();
    const entry = tags[tagId];
    if (!entry) return { unitNames: [], chassisKeys: [] };
    return {
        unitNames: Object.keys(entry.units),
        chassisKeys: Object.keys(entry.chassis)
    };
}

/**
 * Apply tag operations to public tag data.
 * Handles add (1), remove (0), and rename (2) operations.
 * 
 * Important: Subscriptions are to a KEY (lowercased tag name), not to a tag's lifecycle.
 * - If subscribed tag is renamed to a different key: clear data (tag is "gone" from this key)
 * - If another tag is renamed TO this key: data will come via full state, not ops
 */
function applyOpsToPublicTag(data: PublicTagData, ops: TagOp[], tagName: string): void {
    const tagId = tagName.toLowerCase();
    
    for (const op of ops) {
        const opTagId = op.t.toLowerCase();
        
        // Handle rename operations specially
        if (op.a === 2 && op.n) {
            const newId = op.n.toLowerCase();
            
            if (opTagId === tagId && newId !== tagId) {
                // Tag is being renamed AWAY from this key - clear data
                // Subscriber is subscribed to the key, not the tag's lifecycle
                data.unitNames = [];
                data.chassisKeys = [];
                // Keep tagName as-is (the subscription key label)
                continue;
            }
            
            if (opTagId === tagId && newId === tagId) {
                // Same key, just case change - update label
                data.tagName = op.n;
                continue;
            }
            
            // Rename TO this key from another key - skip, full state will handle this
            continue;
        }
        
        // Skip ops not for this tag
        if (opTagId !== tagId) {
            continue;
        }
        
        if (op.a === 1) {
            // Add
            if (op.c === 1) {
                // Chassis
                if (!data.chassisKeys.includes(op.k)) {
                    data.chassisKeys.push(op.k);
                }
            } else {
                // Unit
                if (!data.unitNames.includes(op.k)) {
                    data.unitNames.push(op.k);
                }
            }
        } else if (op.a === 0) {
            // Remove
            if (op.c === 1) {
                // Chassis
                const idx = data.chassisKeys.indexOf(op.k);
                if (idx !== -1) data.chassisKeys.splice(idx, 1);
            } else {
                // Unit
                const idx = data.unitNames.indexOf(op.k);
                if (idx !== -1) data.unitNames.splice(idx, 1);
            }
        }
    }
}

@Injectable({
    providedIn: 'root'
})
export class PublicTagsService {
    private readonly wsService = inject(WsService);
    private readonly userStateService = inject(UserStateService);
    private readonly dbService = inject(DbService);
    private readonly logger = inject(LoggerService);
    private readonly tagsService = inject(TagsService);
    private readonly dialogsService = inject(DialogsService);

    /** Current temporary (session-only) public tags */
    private temporaryTags = new Map<string, PublicTagData>();

    /** Current subscribed public tags (loaded from server) */
    private subscribedTags = new Map<string, PublicTagData>();

    /** Version signal to trigger reactivity on updates */
    public readonly version = signal(0);

    /** Callback to refresh unit public tags - set by DataService */
    private refreshUnitsCallback: (() => void) | null = null;

    /**
     * Set the callback to refresh unit public tags.
     * This is called by DataService to wire up the connection.
     */
    public setRefreshUnitsCallback(callback: () => void): void {
        this.refreshUnitsCallback = callback;
    }

    /**
     * Initialize the service by loading cached subscribed tags from IndexedDB.
     * This allows offline access to subscribed public tags.
     */
    public async initialize(): Promise<void> {
        try {
            // Load cached subscribed tags from IndexedDB
            const cachedTags = await this.dbService.getSubscribedPublicTags();
            if (cachedTags.size > 0) {
                this.subscribedTags = cachedTags;
                this.version.update(v => v + 1);
                this.refreshUnitsCallback?.();
                this.logger.info('Loaded ' + cachedTags.size + ' subscribed public tags from cache');
            }
        } catch (err) {
            this.logger.error('Failed to load cached public tags: ' + err);
        }
    }

    /**
     * Register WebSocket handlers for public tag updates
     */
    public registerWsHandlers(): void {
        // Handle real-time updates for subscribed tags
        this.wsService.registerMessageHandler('publicTagUpdate', (msg) => {
            if (msg.publicId && msg.tagName) {
                this.handlePublicTagUpdate(msg);
            }
        });

        // Load subscribed tags after registration
        this.wsService.registerMessageHandler('userState', async () => {
            await this.loadSubscribedTags();
        });
    }

    /**
     * Handle real-time updates for subscribed tags (V3 format).
     * Uses incremental ops when available, otherwise replaces with full state.
     */
    private async handlePublicTagUpdate(msg: any): Promise<void> {
        const lowerKey = makeSubKey(msg.publicId, msg.tagName.toLowerCase());
        
        // Find existing subscription by lowercase key
        let existing: PublicTagData | undefined;
        let existingKey: string | undefined;
        for (const [key, data] of this.subscribedTags) {
            if (key.toLowerCase() === lowerKey) {
                existing = data;
                existingKey = key;
                break;
            }
        }
        
        if (!existing || !existingKey) return; // Not subscribed to this tag

        // If case changed, update the map key
        const newKey = makeSubKey(msg.publicId, msg.tagName);
        if (existingKey !== newKey) {
            this.subscribedTags.delete(existingKey);
            existing.tagName = msg.tagName; // Update to new case
            this.subscribedTags.set(newKey, existing);
            existingKey = newKey;
            
            // Also update local DB
            const userData = await this.dbService.getUserData();
            if (userData?.tagSubscriptions) {
                const idx = userData.tagSubscriptions.findIndex(
                    s => s.toLowerCase() === lowerKey
                );
                if (idx !== -1) {
                    userData.tagSubscriptions[idx] = newKey;
                    await this.dbService.saveUserData(userData);
                }
            }
        }

        // Server sends either ops (incremental) OR tags (full state), not both
        if (msg.ops && msg.ops.length > 0) {
            // Incremental update - apply ops
            applyOpsToPublicTag(existing, msg.ops, msg.tagName);
        } else if (msg.tags !== undefined) {
            // Full state replacement (tags may be empty object for "deleted" state)
            const { unitNames, chassisKeys } = extractFromV3Tags(msg.tags, msg.tagName);
            existing.unitNames = unitNames;
            existing.chassisKeys = chassisKeys;
        }

        // Update timestamp
        if (msg.timestamp) {
            existing.timestamp = msg.timestamp;
        }

        // Save updated subscriptions to IndexedDB for offline access
        await this.dbService.saveSubscribedPublicTags(this.subscribedTags);

        this.version.update(v => v + 1);
        this.refreshUnitsCallback?.();
    }

    /**
     * Load subscribed tags from server after connection.
     * Uses incremental sync with timestamps when possible.
     * Syncs with server: updates changed tags, removes unsubscribed ones.
     */
    public async loadSubscribedTags(): Promise<void> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        try {
            // Get user's subscriptions from server
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getTagSubscriptions',
                uuid
            });

            // Track which keys are still valid from server
            const validKeys = new Set<string>();

            if (!response?.subscriptions?.length) {
                // No subscriptions - clear all
                if (this.subscribedTags.size > 0) {
                    this.subscribedTags.clear();
                    await this.dbService.saveSubscribedPublicTags(this.subscribedTags);
                    this.version.update(v => v + 1);
                    this.refreshUnitsCallback?.();
                }
                return;
            }

            // Group subscriptions by publicId, including cached timestamps for incremental sync
            const byPublicId = new Map<string, { tagNames: string[]; since: number }>();
            for (const subKey of response.subscriptions) {
                const { publicId, tagName } = parseSubKey(subKey);
                let group = byPublicId.get(publicId);
                if (!group) {
                    group = { tagNames: [], since: 0 };
                    byPublicId.set(publicId, group);
                }
                group.tagNames.push(tagName);
                
                // Find oldest timestamp among cached subscriptions for this publicId
                const lowerKey = makeSubKey(publicId, tagName).toLowerCase();
                for (const [key, data] of this.subscribedTags) {
                    if (key.toLowerCase() === lowerKey && data.timestamp) {
                        // Use minimum timestamp for batch request
                        if (group.since === 0 || data.timestamp < group.since) {
                            group.since = data.timestamp;
                        }
                    }
                }
            }

            // Fetch actual tag data for each publicId (with incremental sync support)
            for (const [publicId, { tagNames, since }] of byPublicId) {
                const tagResponse = await this.wsService.sendAndWaitForResponse({
                    action: 'getPublicTags',
                    publicId,
                    tagNames,
                    since: since > 0 ? since : undefined
                });

                if (tagResponse?.found) {
                    // Use actualTagNames from response (has correct case)
                    const actualTagNames: string[] = tagResponse.tagNames || tagNames;
                    const serverTimestamp = tagResponse.timestamp || 0;
                    
                    for (const actualTagName of actualTagNames) {
                        const subKey = makeSubKey(publicId, actualTagName);
                        const lowerKey = subKey.toLowerCase();
                        validKeys.add(lowerKey);
                        
                        // Find or create existing entry
                        let existing: PublicTagData | undefined;
                        for (const [existingKey, data] of this.subscribedTags) {
                            if (existingKey.toLowerCase() === lowerKey) {
                                existing = data;
                                // Remove old key if case changed
                                if (existingKey !== subKey) {
                                    this.subscribedTags.delete(existingKey);
                                }
                                break;
                            }
                        }
                        
                        // Check if this is an incremental response (has ops array, not full tags)
                        const isIncrementalResponse = tagResponse.ops !== undefined;
                        
                        if (isIncrementalResponse && existing) {
                            // Incremental update - apply ops to existing data (may be empty if up to date)
                            if (tagResponse.ops.length > 0) {
                                applyOpsToPublicTag(existing, tagResponse.ops, actualTagName);
                            }
                            existing.tagName = actualTagName; // Update case if changed
                            existing.timestamp = serverTimestamp;
                            this.subscribedTags.set(subKey, existing);
                        } else if (tagResponse.tags) {
                            // Full state replacement
                            const { unitNames, chassisKeys } = extractFromV3Tags(tagResponse.tags, actualTagName);
                            this.subscribedTags.set(subKey, {
                                publicId,
                                tagName: actualTagName,
                                unitNames,
                                chassisKeys,
                                subscribed: true,
                                timestamp: serverTimestamp
                            });
                        }
                        // If neither (shouldn't happen), entry is unchanged
                    }
                }
            }

            // Remove any locally cached subscriptions that are no longer on server
            for (const [key] of this.subscribedTags) {
                if (!validKeys.has(key.toLowerCase())) {
                    this.subscribedTags.delete(key);
                }
            }

            // Save updated subscriptions to IndexedDB for offline access
            await this.dbService.saveSubscribedPublicTags(this.subscribedTags);

            this.version.update(v => v + 1);
            this.refreshUnitsCallback?.();
        } catch (err) {
            this.logger.error('Failed to load subscribed tags: ' + err);
        }
    }

    /**
     * Import tags temporarily (for this session only)
     */
    public async importTemporary(publicId: string, tagNames: string[]): Promise<boolean> {
        try {
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getPublicTags',
                publicId,
                tagNames
            });

            if (!response?.found) {
                return false;
            }

            // Use actualTagNames from response (has correct case)
            const actualTagNames: string[] = response.tagNames || tagNames;
            const serverTimestamp = response.timestamp || 0;

            for (const actualTagName of actualTagNames) {
                const subKey = makeSubKey(publicId, actualTagName);
                // Extract from V3 format
                const { unitNames, chassisKeys } = extractFromV3Tags(response.tags, actualTagName);
                
                this.temporaryTags.set(subKey, {
                    publicId,
                    tagName: actualTagName,
                    unitNames,
                    chassisKeys,
                    subscribed: false,
                    timestamp: serverTimestamp
                });
            }

            this.version.update(v => v + 1);
            this.refreshUnitsCallback?.();
            return true;
        } catch (err) {
            this.logger.error('Failed to import temporary tags: ' + err);
            return false;
        }
    }

    /**
     * Subscribe to tags permanently.
     * Returns an object with success status and optional error message.
     */
    public async subscribe(publicId: string, tagName: string): Promise<{ success: boolean; error?: string }> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return { success: false, error: 'Not logged in' };

        try {
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'subscribePublicTag',
                uuid,
                publicId,
                tagName
            });

            if (!response?.success) {
                return { success: false, error: response?.error };
            }

            // Use actual tag name from response (has correct case)
            const actualTagName: string = response.tagName || tagName;
            const subKey = makeSubKey(publicId, actualTagName);
            
            // Remove from temporary if it was there (check both cases)
            this.temporaryTags.delete(subKey);
            this.temporaryTags.delete(makeSubKey(publicId, tagName));
            
            // Extract from V3 format
            const { unitNames, chassisKeys } = extractFromV3Tags(response.tags, actualTagName);
            
            // Add to subscribed with timestamp for incremental sync
            this.subscribedTags.set(subKey, {
                publicId,
                tagName: actualTagName,
                unitNames,
                chassisKeys,
                subscribed: true,
                timestamp: response.timestamp || 0
            });

            // Also save to local user data
            const userData = await this.dbService.getUserData();
            if (userData) {
                userData.tagSubscriptions = userData.tagSubscriptions || [];
                if (!userData.tagSubscriptions.includes(subKey)) {
                    userData.tagSubscriptions.push(subKey);
                    await this.dbService.saveUserData(userData);
                }
            }

            // Save subscribed tags to IndexedDB for offline access
            await this.dbService.saveSubscribedPublicTags(this.subscribedTags);

            this.version.update(v => v + 1);
            this.refreshUnitsCallback?.();
            return { success: true };
        } catch (err) {
            this.logger.error('Failed to subscribe to tag: ' + err);
            return { success: false, error: 'Failed to subscribe' };
        }
    }

    /**
     * Unsubscribe from a tag
     */
    public async unsubscribe(publicId: string, tagName: string): Promise<boolean> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return false;

        try {
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'unsubscribePublicTag',
                uuid,
                publicId,
                tagName
            });

            if (!response?.success) {
                return false;
            }

            // Remove from map (case-insensitive lookup)
            const lowerKey = makeSubKey(publicId, tagName.toLowerCase());
            for (const [key] of this.subscribedTags) {
                if (key.toLowerCase() === lowerKey.toLowerCase()) {
                    this.subscribedTags.delete(key);
                    break;
                }
            }

            // Also remove from local user data (case-insensitive)
            const userData = await this.dbService.getUserData();
            if (userData?.tagSubscriptions) {
                userData.tagSubscriptions = userData.tagSubscriptions.filter(
                    s => s.toLowerCase() !== lowerKey.toLowerCase()
                );
                await this.dbService.saveUserData(userData);
            }

            // Save updated tags to IndexedDB for offline access
            await this.dbService.saveSubscribedPublicTags(this.subscribedTags);

            this.version.update(v => v + 1);
            this.refreshUnitsCallback?.();
            return true;
        } catch (err) {
            this.logger.error('Failed to unsubscribe from tag: ' + err);
            return false;
        }
    }

    /**
     * Unsubscribe from a tag with confirmation dialog.
     * Shows a confirmation dialog before unsubscribing.
     * @returns true if unsubscribed, false if cancelled or failed
     */
    public async unsubscribeWithConfirmation(publicId: string, tagName: string): Promise<boolean> {
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to unsubscribe from the public tag "${tagName}"? This will remove the tag from your filters.`,
            'Unsubscribe from Public Tag',
            'danger'
        );
        if (!confirmed) return false;
        return this.unsubscribe(publicId, tagName);
    }

    /**
     * Clear all temporary tags
     */
    public clearTemporary(): void {
        this.temporaryTags.clear();
        this.version.update(v => v + 1);
        this.refreshUnitsCallback?.();
    }

    /**
     * Get all current public tags (temporary + subscribed)
     */
    public getAllPublicTags(): PublicTagData[] {
        return [
            ...Array.from(this.temporaryTags.values()),
            ...Array.from(this.subscribedTags.values())
        ];
    }

    /**
     * Get all subscribed tags
     */
    public getSubscribedTags(): PublicTagData[] {
        return Array.from(this.subscribedTags.values());
    }

    /**
     * Get public tag info for a specific unit
     */
    public getPublicTagsForUnit(unit: Unit): PublicTagInfo[] {
        const result: PublicTagInfo[] = [];
        const chassisKey = TagsService.getChassisTagKey(unit);

        for (const tagData of this.getAllPublicTags()) {
            const lowerTag = tagData.tagName.toLowerCase();
            
            // Check if unit name matches
            if (tagData.unitNames.includes(unit.name)) {
                result.push({
                    tag: tagData.tagName,
                    publicId: tagData.publicId,
                    subscribed: tagData.subscribed
                });
                continue;
            }

            // Check if chassis matches
            if (tagData.chassisKeys.includes(chassisKey)) {
                result.push({
                    tag: tagData.tagName,
                    publicId: tagData.publicId,
                    subscribed: tagData.subscribed
                });
            }
        }

        return result;
    }

    /**
     * Check if a publicId:tagName is currently subscribed (permanent)
     * Uses case-insensitive matching for tagName
     */
    public isTagSubscribed(publicId: string, tagName: string): boolean {
        const lowerKey = `${publicId}:${tagName.toLowerCase()}`;
        for (const key of this.subscribedTags.keys()) {
            if (key.toLowerCase() === lowerKey) return true;
        }
        return false;
    }

    /**
     * Check if a publicId:tagName is currently active (temporary or subscribed)
     * Uses case-insensitive matching for tagName
     */
    public isTagActive(publicId: string, tagName: string): boolean {
        const lowerKey = `${publicId}:${tagName.toLowerCase()}`;
        for (const key of this.temporaryTags.keys()) {
            if (key.toLowerCase() === lowerKey) return true;
        }
        for (const key of this.subscribedTags.keys()) {
            if (key.toLowerCase() === lowerKey) return true;
        }
        return false;
    }

    /**
     * Get all unique public tag names currently active
     */
    public getAllActivePublicTagNames(): string[] {
        const names = new Set<string>();
        for (const tagData of this.getAllPublicTags()) {
            names.add(tagData.tagName);
        }
        return Array.from(names);
    }

    /**
     * Get subscriber counts for the current user's own tags.
     * Returns a map of tagId (lowercase) -> subscriber count.
     * Returns null if WebSocket is not connected or user is not registered.
     */
    public async getOwnTagSubscriberCounts(): Promise<Record<string, number> | null> {
        const uuid = this.userStateService.uuid();
        if (!uuid) return null;

        try {
            const ws = this.wsService.getWebSocket();
            if (!ws || ws.readyState !== WebSocket.OPEN) return null;

            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getOwnTagSubscriberCounts',
                uuid
            });

            if (response?.counts) {
                return response.counts as Record<string, number>;
            }
            return {};
        } catch (err) {
            this.logger.error('Failed to get tag subscriber counts: ' + err);
            return null;
        }
    }
}
