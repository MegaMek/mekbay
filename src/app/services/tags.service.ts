// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject, signal } from '@angular/core';
import { DbService, type TagData, type TagEntry, type UnitTagData, type TagOp, type StoredTags, type StoredChassisTags } from './db.service';
import { WsService } from './ws.service';
import { UserStateService } from './userState.service';
import { LoggerService } from './logger.service';
import { DialogsService } from './dialogs.service';
import type { UnitSummary } from '../models/unit-summary.model';
import { getUnitVariantGroupKey } from '../utils/unit-variant.util';

/*
 * 
 * Service for managing unit tags with local storage and cloud sync.
 * Supports unit tags (keyed by unit UUID) and chassis-wide tags (keyed by variant group).
 * Uses incremental sync with operations log for efficient cloud synchronization.
 */

/** Chunk size for large batch operations to stay within server limits */
const TAG_OPS_CHUNK_SIZE = 1000;

const TAG_CATEGORY = {
    name: 0,
    chassis: 1,
} as const;

const TAG_ACTION = {
    remove: 0,
    add: 1,
    rename: 2,
} as const;

/**
 * Tag document format.
 * 3: V3, unit tags keyed by UnitSummary.name and chassis tags by `chassis|type`.
 * 4: V3 with variant-group chassis keys.
 * 5: V4, unit tags keyed by UnitSummary.uuid.
 */
const TAG_FORMAT_VERSION = 5;

interface TagCommitOptions {
    timestamp?: number;
    searchIndexChanged?: boolean;
    notifyLocal?: boolean;
    syncToCloud?: boolean;
}

/** Current and V3 tag keys of one catalog unit list, for migrating documents older than format 5. */
interface TagKeyMigration {
    readonly units: readonly UnitSummary[];
    readonly unitKeys: ReadonlySet<string>;
    /** V3 unit name -> UUID of the first catalog unit with that name (core units precede custom ones). */
    readonly unitKeyByName: ReadonlyMap<string, string>;
    readonly chassisKeys: ReadonlySet<string>;
    readonly chassisKeysByLegacyKey: ReadonlyMap<string, readonly string[]>;
}

interface RemoteTagState {
    readonly serverTs?: number;
    readonly ops?: TagOp[];
    readonly fullState?: TagData;
    readonly formatVersion?: TagData['formatVersion'];
}

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
    private refreshUnitsCallback: ((tagData: TagData | null, options?: { searchIndexChanged?: boolean }) => void) | null = null;

    /** Callback to notify other tabs - set by DataService */
    private notifyStoreUpdatedCallback: ((options?: { searchIndexChanged?: boolean }) => void) | null = null;

    /** The latest catalog passed to migrateTagKeys, and its key lookups once a migration needed them. */
    private catalogUnits: readonly UnitSummary[] = [];
    private keyMigration: TagKeyMigration | null = null;
    private resolveKeyMigrationReady!: () => void;
    /** Cloud sync waits for local migration: remote V3 keys can only be migrated against a catalog. */
    private readonly keyMigrationReady = new Promise<void>(resolve => { this.resolveKeyMigrationReady = resolve; });
    /** Serializes cloud reconciliation and op uploads; login, reconnect, resets and edits can request them together. */
    private cloudSync: Promise<void> = Promise.resolve();
    /**
     * The connection the cloud was last reconciled on. Ops are uploaded only
     * on it: an upload before reconciling would move lastSyncTs past changes
     * other devices made meanwhile. Until then they wait in the pending queue.
     */
    private reconciledSocket: WebSocket | null = null;

    /**
     * Set the callback to refresh unit tags on units.
     * This is called by DataService to wire up the connection.
     */
    public setRefreshUnitsCallback(callback: (tagData: TagData | null, options?: { searchIndexChanged?: boolean }) => void): void {
        this.refreshUnitsCallback = callback;
    }

    /**
     * Set the callback to notify other tabs of changes.
     * This is called by DataService to wire up the connection.
     */
    public setNotifyStoreUpdatedCallback(callback: (options?: { searchIndexChanged?: boolean }) => void): void {
        this.notifyStoreUpdatedCallback = callback;
    }

    /**
     * Generates the chassis tag key for a unit.
     * Format: `${chassis}|${as.TP}|${omni ? 'O' : ''}` to match variant groups.
     */
    public static getChassisTagKey(unit: UnitSummary): string {
        return getUnitVariantGroupKey(unit);
    }

    /** Unit tag key: the unit's stable UUID (V4; V3 used the non-unique UnitSummary.name). */
    public static getUnitTagKey(unit: UnitSummary): string {
        return unit.uuid;
    }

    // ================== Initialization ==================

    /** Initialize and load tags from storage */
    public async initialize(): Promise<void> {
        try {
            const data = await this.dbService.getAllTagData();
            this.cachedTagData = data ?? this.createEmptyTagData();
            
            this.version.update(v => v + 1);
        } catch (err) {
            this.logger.error('Failed to load tags: ' + err);
            this.cachedTagData = this.createEmptyTagData();
            this.version.update(v => v + 1);
        }
    }

    private createEmptyTagData(): TagData {
        return { tags: {}, timestamp: 0, formatVersion: TAG_FORMAT_VERSION };
    }

    /**
     * One-time migration of a document older than format 5 and of the ops
     * queued with it. A V3 unit name becomes the UUID of the one unit carrying
     * that name (core units before custom ones); a name no unit carries, and
     * its tag assignment, is dropped. Format 3 `chassis|type` keys become the
     * variant-group keys of every matching unit. The rewrite happens
     * synchronously before the first await, so callers may assign the passed
     * document right after starting it.
     */
    public async migrateTagKeys(units: readonly UnitSummary[], tagData?: TagData): Promise<TagData> {
        const data = tagData ?? await this.getTagData();
        if (units.length === 0) {
            return data;
        }

        this.catalogUnits = units;
        if (data.formatVersion < TAG_FORMAT_VERSION) {
            const migration = this.getKeyMigration();
            this.migrateTagDataKeys(data, migration);
            try {
                // The cloud copy is upgraded by syncFromCloud after reconciling
                // with it; pushing here could overwrite other devices' changes.
                await this.dbService.saveMigratedTagData(data, ops => this.migrateTagOps(ops, migration));
                this.applyLocalTagState(data, { notifyLocal: false });
            } catch (err) {
                this.logger.error('Failed to migrate tag keys: ' + err);
            }
        }
        this.resolveKeyMigrationReady();
        return data;
    }

    /** The unit a V3 unit name stands for: the one its tags migrate to. */
    public getUnitKeyForV3Name(name: string): string | undefined {
        return this.getKeyMigration().unitKeyByName.get(name);
    }

    private getKeyMigration(): TagKeyMigration {
        const units = this.catalogUnits;
        if (this.keyMigration?.units === units) {
            return this.keyMigration;
        }

        const unitKeys = new Set<string>();
        const unitKeyByName = new Map<string, string>();
        const chassisKeys = new Set<string>();
        const chassisKeysByLegacyKey = new Map<string, string[]>();
        for (const unit of units) {
            const unitKey = TagsService.getUnitTagKey(unit);
            const chassisKey = TagsService.getChassisTagKey(unit);
            unitKeys.add(unitKey);
            chassisKeys.add(chassisKey);
            if (!unitKeyByName.has(unit.name)) {
                unitKeyByName.set(unit.name, unitKey);
            }
            const legacyChassisKey = `${unit.chassis}|${unit.type}`;
            const keys = chassisKeysByLegacyKey.get(legacyChassisKey) ?? [];
            if (!keys.includes(chassisKey)) keys.push(chassisKey);
            chassisKeysByLegacyKey.set(legacyChassisKey, keys);
        }

        this.keyMigration = { units, unitKeys, unitKeyByName, chassisKeys, chassisKeysByLegacyKey };
        return this.keyMigration;
    }

    /** The V4 keys a stored key stands for; none drops it. */
    private getMigratedKeys(migration: TagKeyMigration, category: TagOp['c'], key: string): readonly string[] {
        if (category === TAG_CATEGORY.chassis) {
            // Chassis keys this catalog does not know are not unit names; they stay.
            return migration.chassisKeys.has(key) ? [key] : migration.chassisKeysByLegacyKey.get(key) ?? [key];
        }
        if (migration.unitKeys.has(key)) {
            return [key];
        }
        const unitKey = migration.unitKeyByName.get(key);
        return unitKey ? [unitKey] : [];
    }

    private migrateTagDataKeys(tagData: TagData, migration: TagKeyMigration): void {
        for (const [tagId, entry] of Object.entries(tagData.tags)) {
            entry.units = this.migrateKeyedTagData(entry.units, TAG_CATEGORY.name, migration);
            entry.chassis = this.migrateKeyedTagData(entry.chassis, TAG_CATEGORY.chassis, migration);
            if (Object.keys(entry.units).length === 0 && Object.keys(entry.chassis).length === 0) {
                delete tagData.tags[tagId];
            }
        }
        tagData.formatVersion = TAG_FORMAT_VERSION;
    }

    private migrateKeyedTagData(
        values: Record<string, UnitTagData>,
        category: TagOp['c'],
        migration: TagKeyMigration,
    ): Record<string, UnitTagData> {
        const migrated: Record<string, UnitTagData> = {};
        for (const [key, value] of Object.entries(values)) {
            for (const migratedKey of this.getMigratedKeys(migration, category, key)) {
                migrated[migratedKey] = this.mergeTagData(migrated[migratedKey], value);
            }
        }
        return migrated;
    }

    /** Rewrites the keys of ops queued before the migration. */
    private migrateTagOps(ops: readonly TagOp[], migration: TagKeyMigration): TagOp[] {
        return ops.flatMap(op => op.a === TAG_ACTION.rename
            ? [op]
            : this.getMigratedKeys(migration, op.c, op.k).map(k => ({ ...op, k })));
    }

    /** Get cached tag data (or load from storage if not cached) */
    public async getTagData(): Promise<TagData> {
        if (!this.cachedTagData) {
            await this.initialize();
        }
        return this.cachedTagData!;
    }

    /** Get all unit tags (label -> unit UUIDs) for UI callers. */
    public getNameTags(): StoredTags {
        if (!this.cachedTagData) return {};
        const result: StoredTags = {};
        for (const entry of Object.values(this.cachedTagData.tags)) {
            const unitKeys = Object.keys(entry.units);
            if (unitKeys.length > 0) {
                result[entry.label] = unitKeys;
            }
        }
        return result;
    }

    /** Get all chassis tags keyed by display tag label for UI callers. */
    public getChassisTags(): StoredChassisTags {
        if (!this.cachedTagData) return {};
        const result: StoredChassisTags = {};
        for (const entry of Object.values(this.cachedTagData.tags)) {
            const chassisKeys = Object.keys(entry.chassis);
            if (chassisKeys.length > 0) {
                result[entry.label] = chassisKeys;
            }
        }
        return result;
    }

    private normalizeTag(tag: string): { label: string; id: string } {
        const label = tag.trim();
        return { label, id: label.toLowerCase() };
    }

    private async commitOps(tagData: TagData, ops: TagOp[], options: TagCommitOptions = {}): Promise<void> {
        if (ops.length === 0) {
            return;
        }

        if (options.timestamp !== undefined) {
            tagData.timestamp = options.timestamp;
        }

        await this.dbService.appendTagOps(ops, tagData);
        this.applyLocalTagState(tagData, options);

        if (options.syncToCloud ?? true) {
            this.uploadPendingOps();
        }
    }

    private async commitFullState(tagData: TagData, options: TagCommitOptions = {}): Promise<void> {
        if (options.timestamp !== undefined) {
            tagData.timestamp = options.timestamp;
        }

        await this.dbService.saveAllTagData(tagData);
        this.applyLocalTagState(tagData, options);

        if (options.syncToCloud ?? false) {
            void this.enqueueCloudSync(() => this.pushFullStateToCloud());
        }
    }

    private applyLocalTagState(tagData: TagData, options: TagCommitOptions = {}): void {
        this.cachedTagData = tagData;

        if (options.notifyLocal === false) {
            return;
        }

        const searchIndexChanged = options.searchIndexChanged ?? true;
        this.refreshUnitsCallback?.(tagData, { searchIndexChanged });
        this.notifyStoreUpdatedCallback?.({ searchIndexChanged });
        this.version.update(v => v + 1);
    }

    /**
     * Removes stale unit-level tag assignments when the same tag is already assigned to that unit's chassis.
     */
    public async fixNameTagsCoveredByChassis(units: UnitSummary[], tagData?: TagData | null): Promise<void> {
        if (units.length === 0 || tagData === null) {
            return;
        }

        try {
            const data = tagData ?? await this.getTagData();
            const now = Date.now();
            const ops = this.removeNameTagsCoveredByChassis(data, units, now);
            if (ops.length === 0) {
                return;
            }

            await this.commitOps(data, ops, { timestamp: now, notifyLocal: false });
        } catch (err) {
            this.logger.error('Failed to fix duplicate unit/chassis tags: ' + err);
        }
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
        units: UnitSummary[], 
        tag: string, 
        tagType: 'name' | 'chassis',
        action: 'add' | 'remove',
        quantity: number = 1
    ): Promise<void> {
        const tagData = await this.getTagData();
        const { label: tagLabel, id: tagId } = this.normalizeTag(tag);
        const normalizedQuantity = this.normalizeQuantity(quantity);
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedNameKeys = new Set<string>();
        const processedChassisKeys = new Set<string>();

        for (const unit of units) {
            const unitKey = TagsService.getUnitTagKey(unit);
            if (tagType === 'chassis') {
                const chassisKey = TagsService.getChassisTagKey(unit);

                if (action === 'add') {
                    // When adding a chassis tag, remove any existing name tag with the same value
                    // This "expands" the tag from unit-specific to chassis-wide
                    if (!processedNameKeys.has(unitKey) && this.hasUnitTag(tagData, tagId, unitKey)) {
                        processedNameKeys.add(unitKey);
                        this.removeUnitTag(tagData, tagId, unitKey);
                        ops.push({ k: unitKey, t: tagLabel, c: TAG_CATEGORY.name, a: TAG_ACTION.remove, ts: now });
                    }

                    if (processedChassisKeys.has(chassisKey)) continue;
                    processedChassisKeys.add(chassisKey);

                    // Add to chassis tags if not already present
                    if (!this.hasChassisTag(tagData, tagId, chassisKey)) {
                        this.addChassisTag(tagData, tagLabel, chassisKey, normalizedQuantity);
                        ops.push({
                            k: chassisKey,
                            t: tagLabel,
                            c: TAG_CATEGORY.chassis,
                            a: TAG_ACTION.add,
                            ts: now,
                            q: normalizedQuantity > 1 ? normalizedQuantity : undefined
                        });
                    } else if (!this.isChassisTagQuantity(tagData, tagId, chassisKey, normalizedQuantity)) {
                        this.setChassisTagQuantity(tagData, tagId, chassisKey, normalizedQuantity);
                        ops.push({
                            k: chassisKey,
                            t: tagLabel,
                            c: TAG_CATEGORY.chassis,
                            a: TAG_ACTION.add,
                            ts: now,
                            q: normalizedQuantity > 1 ? normalizedQuantity : undefined
                        });
                    }
                } else {
                    if (processedChassisKeys.has(chassisKey)) continue;
                    processedChassisKeys.add(chassisKey);

                    // Remove from chassis tags
                    if (this.hasChassisTag(tagData, tagId, chassisKey)) {
                        this.removeChassisTag(tagData, tagId, chassisKey);
                        ops.push({ k: chassisKey, t: tagLabel, c: TAG_CATEGORY.chassis, a: TAG_ACTION.remove, ts: now });
                    }
                }
            } else {
                // Unit tagging - skip if already processed
                if (processedNameKeys.has(unitKey)) continue;
                processedNameKeys.add(unitKey);

                if (action === 'add') {
                    if (!this.hasUnitTag(tagData, tagId, unitKey)) {
                        this.addUnitTag(tagData, tagLabel, unitKey, normalizedQuantity);
                        ops.push({
                            k: unitKey,
                            t: tagLabel,
                            c: TAG_CATEGORY.name,
                            a: TAG_ACTION.add,
                            ts: now,
                            q: normalizedQuantity > 1 ? normalizedQuantity : undefined
                        });
                    } else if (!this.isUnitTagQuantity(tagData, tagId, unitKey, normalizedQuantity)) {
                        this.setUnitTagQuantity(tagData, tagId, unitKey, normalizedQuantity);
                        ops.push({
                            k: unitKey,
                            t: tagLabel,
                            c: TAG_CATEGORY.name,
                            a: TAG_ACTION.add,
                            ts: now,
                            q: normalizedQuantity > 1 ? normalizedQuantity : undefined
                        });
                    }
                } else {
                    if (this.hasUnitTag(tagData, tagId, unitKey)) {
                        this.removeUnitTag(tagData, tagId, unitKey);
                        ops.push({ k: unitKey, t: tagLabel, c: TAG_CATEGORY.name, a: TAG_ACTION.remove, ts: now });
                    }
                }
            }
        }

        await this.commitOps(tagData, ops, { timestamp: now, searchIndexChanged: true });
    }

    /**
     * Update the numeric value for an existing tag on selected units.
     * Quantity defaults to 1 and is clamped to integer >= 1.
     */
    public async setTagQuantity(
        units: UnitSummary[],
        tag: string,
        tagType: 'name' | 'chassis',
        quantity: number
    ): Promise<void> {
        const tagData = await this.getTagData();
        const { label: tagLabel, id: tagId } = this.normalizeTag(tag);
        const normalizedQuantity = this.normalizeQuantity(quantity);
        const now = Date.now();
        const ops: TagOp[] = [];

        if (tagType === 'name') {
            const processedKeys = new Set<string>();
            for (const unit of units) {
                const unitKey = TagsService.getUnitTagKey(unit);
                if (processedKeys.has(unitKey)) {
                    continue;
                }
                processedKeys.add(unitKey);

                if (!this.hasUnitTag(tagData, tagId, unitKey)) {
                    continue;
                }
                if (this.isUnitTagQuantity(tagData, tagId, unitKey, normalizedQuantity)) {
                    continue;
                }

                this.setUnitTagQuantity(tagData, tagId, unitKey, normalizedQuantity);
                ops.push({
                    k: unitKey,
                    t: tagLabel,
                    c: TAG_CATEGORY.name,
                    a: TAG_ACTION.add,
                    ts: now,
                    q: normalizedQuantity > 1 ? normalizedQuantity : undefined
                });
            }
        } else {
            const processedKeys = new Set<string>();
            for (const unit of units) {
                const chassisKey = TagsService.getChassisTagKey(unit);
                if (processedKeys.has(chassisKey)) {
                    continue;
                }
                processedKeys.add(chassisKey);

                if (!this.hasChassisTag(tagData, tagId, chassisKey)) {
                    continue;
                }
                if (this.isChassisTagQuantity(tagData, tagId, chassisKey, normalizedQuantity)) {
                    continue;
                }

                this.setChassisTagQuantity(tagData, tagId, chassisKey, normalizedQuantity);
                ops.push({
                    k: chassisKey,
                    t: tagLabel,
                    c: TAG_CATEGORY.chassis,
                    a: TAG_ACTION.add,
                    ts: now,
                    q: normalizedQuantity > 1 ? normalizedQuantity : undefined
                });
            }
        }

        await this.commitOps(tagData, ops, { timestamp: now, searchIndexChanged: false });
    }

    /**
     * Remove a tag from units. Removes from both name and chassis tags.
     */
    public async removeTagFromUnits(units: UnitSummary[], tag: string): Promise<void> {
        const tagData = await this.getTagData();
        const { label: tagLabel, id: tagId } = this.normalizeTag(tag);
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedNameKeys = new Set<string>();
        const processedChassisKeys = new Set<string>();

        for (const unit of units) {
            const unitKey = TagsService.getUnitTagKey(unit);
            const chassisKey = TagsService.getChassisTagKey(unit);

            // Remove from unit tags
            if (!processedNameKeys.has(unitKey) && this.hasUnitTag(tagData, tagId, unitKey)) {
                processedNameKeys.add(unitKey);
                this.removeUnitTag(tagData, tagId, unitKey);
                ops.push({ k: unitKey, t: tagLabel, c: TAG_CATEGORY.name, a: TAG_ACTION.remove, ts: now });
            }

            // Remove from chassis tags
            if (!processedChassisKeys.has(chassisKey) && this.hasChassisTag(tagData, tagId, chassisKey)) {
                processedChassisKeys.add(chassisKey);
                this.removeChassisTag(tagData, tagId, chassisKey);
                ops.push({ k: chassisKey, t: tagLabel, c: TAG_CATEGORY.chassis, a: TAG_ACTION.remove, ts: now });
            }
        }

        await this.commitOps(tagData, ops, { timestamp: now, searchIndexChanged: true });
    }

    /**
     * Check if a tag exists in the specified tag type (case-insensitive).
     * @returns The actual tag label if it exists, or null if not found
     */
    public async tagExists(tag: string, tagType: 'name' | 'chassis'): Promise<string | null> {
        const tagData = await this.getTagData();
        const { id: tagId } = this.normalizeTag(tag);
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
        const { id: tagId } = this.normalizeTag(tag);
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
        const { label: oldLabel, id: oldId } = this.normalizeTag(oldTag);
        const { label: newLabel, id: newId } = this.normalizeTag(newTag);
        const now = Date.now();

        // Check if old tag exists
        const oldEntry = tagData.tags[oldId];
        if (!oldEntry) {
            this.logger.warn(`[TagsService] Tag "${oldLabel}" not found for renaming`);
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
            oldEntry.label = newLabel;

            // Generate rename ops for both collections that have items
            const ops: TagOp[] = [];
            if (hasUnits) {
                ops.push({
                    k: '',
                    t: oldEntry.label,
                    c: TAG_CATEGORY.name,
                    a: TAG_ACTION.rename,
                    ts: now,
                    n: newLabel
                });
            }
            if (hasChassis) {
                ops.push({
                    k: '',
                    t: oldEntry.label,
                    c: TAG_CATEGORY.chassis,
                    a: TAG_ACTION.rename,
                    ts: now,
                    n: newLabel
                });
            }

            await this.commitOps(tagData, ops, { timestamp: now, searchIndexChanged: true });
        } else {
            // Different ID - merge or move
            // For merge: combine both collections and delete source
            // This requires full state sync since ops can't represent merge

            if (!newEntry) {
                // Create new entry with target label
                tagData.tags[newId] = { 
                    label: newLabel, 
                    units: {}, 
                    chassis: {} 
                };
            }

            // Merge BOTH units and chassis from old to new
            Object.assign(tagData.tags[newId].units, oldEntry.units);
            Object.assign(tagData.tags[newId].chassis, oldEntry.chassis);

            // Delete the old tag entirely
            delete tagData.tags[oldId];

            if (isMerge) {
                // Merge operation: clear ops and push full state
                // This ensures all clients and subscribers get the complete merged data
                await this.commitFullState(tagData, { timestamp: now, searchIndexChanged: true, syncToCloud: true });
            } else {
                // Simple rename (not merge) - use rename ops
                const ops: TagOp[] = [];
                if (hasUnits) {
                    ops.push({
                        k: '',
                        t: oldLabel,
                        c: TAG_CATEGORY.name,
                        a: TAG_ACTION.rename,
                        ts: now,
                        n: newLabel
                    });
                }
                if (hasChassis) {
                    ops.push({
                        k: '',
                        t: oldLabel,
                        c: TAG_CATEGORY.chassis,
                        a: TAG_ACTION.rename,
                        ts: now,
                        n: newLabel
                    });
                }

                await this.commitOps(tagData, ops, { timestamp: now, searchIndexChanged: true });
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
        const { id: tagId } = this.normalizeTag(tag);
        const now = Date.now();
        const ops: TagOp[] = [];

        const entry = tagData.tags[tagId];
        if (!entry) return;

        // Generate remove ops for each unit
        for (const unitKey of Object.keys(entry.units)) {
            ops.push({ k: unitKey, t: entry.label, c: TAG_CATEGORY.name, a: TAG_ACTION.remove, ts: now });
        }

        // Generate remove ops for each chassis
        for (const chassisKey of Object.keys(entry.chassis)) {
            ops.push({ k: chassisKey, t: entry.label, c: TAG_CATEGORY.chassis, a: TAG_ACTION.remove, ts: now });
        }

        // Delete the tag
        delete tagData.tags[tagId];

        if (ops.length === 0) {
            await this.commitFullState(tagData, { timestamp: now, searchIndexChanged: true, syncToCloud: true });
            return;
        }

        await this.commitOps(tagData, ops, { timestamp: now, searchIndexChanged: true });
    }

    /**
     * Check if a tag is assigned at the chassis level for any of the given units.
     */
    public async isChassisTag(units: UnitSummary[], tag: string): Promise<boolean> {
        const tagData = await this.getTagData();
        const { id: tagId } = this.normalizeTag(tag);

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
    public async getTagType(unit: UnitSummary, tag: string): Promise<'chassis' | 'name' | null> {
        const tagData = await this.getTagData();
        const { id: tagId } = this.normalizeTag(tag);
        const chassisKey = TagsService.getChassisTagKey(unit);

        // Check chassis tags first
        if (this.hasChassisTag(tagData, tagId, chassisKey)) {
            return 'chassis';
        }

        // Check unit tags
        if (this.hasUnitTag(tagData, tagId, TagsService.getUnitTagKey(unit))) {
            return 'name';
        }

        return null;
    }

    // ================== Tag Document Helpers ==================
    // tags = { tagId: { label, units: { unitKey: {} }, chassis: { chassisKey: {} } } }
    // Tag IDs are always lowercase for O(1) lookup
    
    /** Check if a unit has a specific tag */
    private hasUnitTag(tagData: TagData, tagId: string, unitKey: string): boolean {
        return tagData.tags[tagId]?.units[unitKey] !== undefined;
    }
    
    /** Check if a chassis has a specific tag */
    private hasChassisTag(tagData: TagData, tagId: string, chassisKey: string): boolean {
        return tagData.tags[tagId]?.chassis[chassisKey] !== undefined;
    }

    private normalizeQuantity(quantity: number): number {
        const parsed = Number.isFinite(quantity) ? Math.trunc(quantity) : 1;
        return Math.max(1, parsed);
    }

    private getStoredQuantity(unitTagData: UnitTagData | undefined): number {
        const quantity = unitTagData?.q;
        return quantity && quantity > 0 ? quantity : 1;
    }

    private toUnitTagData(quantity: number): UnitTagData {
        return quantity > 1 ? { q: quantity } : {};
    }

    private mergeTagData(current: UnitTagData | undefined, next: UnitTagData): UnitTagData {
        if (!current) {
            return { ...next };
        }

        return this.toUnitTagData(Math.max(this.getStoredQuantity(current), this.getStoredQuantity(next)));
    }

    private isUnitTagQuantity(tagData: TagData, tagId: string, unitKey: string, quantity: number): boolean {
        const current = tagData.tags[tagId]?.units[unitKey];
        return this.getStoredQuantity(current) === quantity;
    }

    private isChassisTagQuantity(tagData: TagData, tagId: string, chassisKey: string, quantity: number): boolean {
        const current = tagData.tags[tagId]?.chassis[chassisKey];
        return this.getStoredQuantity(current) === quantity;
    }

    private setUnitTagQuantity(tagData: TagData, tagId: string, unitKey: string, quantity: number): void {
        const entry = tagData.tags[tagId];
        if (!entry || entry.units[unitKey] === undefined) {
            return;
        }
        entry.units[unitKey] = this.toUnitTagData(quantity);
    }

    private setChassisTagQuantity(tagData: TagData, tagId: string, chassisKey: string, quantity: number): void {
        const entry = tagData.tags[tagId];
        if (!entry || entry.chassis[chassisKey] === undefined) {
            return;
        }
        entry.chassis[chassisKey] = this.toUnitTagData(quantity);
    }
    
    /** Add a tag to a unit */
    private addUnitTag(tagData: TagData, tag: string, unitKey: string, quantity: number = 1): void {
        const { id: tagId } = this.normalizeTag(tag);
        if (!tagData.tags[tagId]) {
            tagData.tags[tagId] = { label: tag, units: {}, chassis: {} };
        }
        tagData.tags[tagId].units[unitKey] = this.toUnitTagData(quantity);
    }
    
    /** Remove a tag from a unit */
    private removeUnitTag(tagData: TagData, tagId: string, unitKey: string): void {
        const entry = tagData.tags[tagId];
        if (!entry) return;
        delete entry.units[unitKey];
        // Clean up empty tag
        if (Object.keys(entry.units).length === 0 && Object.keys(entry.chassis).length === 0) {
            delete tagData.tags[tagId];
        }
    }
    
    /** Add a tag to a chassis */
    private addChassisTag(tagData: TagData, tag: string, chassisKey: string, quantity: number = 1): void {
        const { id: tagId } = this.normalizeTag(tag);
        if (!tagData.tags[tagId]) {
            tagData.tags[tagId] = { label: tag, units: {}, chassis: {} };
        }
        tagData.tags[tagId].chassis[chassisKey] = this.toUnitTagData(quantity);
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

    private removeNameTagsCoveredByChassis(tagData: TagData, units: UnitSummary[], timestamp: number): TagOp[] {
        const ops: TagOp[] = [];
        const processedUnitTags = new Set<string>();

        for (const unit of units) {
            const unitKey = TagsService.getUnitTagKey(unit);
            const chassisKey = TagsService.getChassisTagKey(unit);
            for (const [tagId, entry] of Object.entries(tagData.tags)) {
                const processedKey = `${unitKey}\0${tagId}`;
                if (processedUnitTags.has(processedKey)) {
                    continue;
                }

                if (entry.units[unitKey] !== undefined && entry.chassis[chassisKey] !== undefined) {
                    processedUnitTags.add(processedKey);
                    this.removeUnitTag(tagData, tagId, unitKey);
                    ops.push({ k: unitKey, t: entry.label, c: TAG_CATEGORY.name, a: TAG_ACTION.remove, ts: timestamp });
                }
            }
        }

        return ops;
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

    /** Runs cloud work one task at a time; a failure is logged and leaves pending ops queued. */
    private enqueueCloudSync(task: () => Promise<void>): Promise<void> {
        this.cloudSync = this.cloudSync
            .then(task)
            .catch(err => this.logger.error('Failed to sync tags with cloud: ' + err));
        return this.cloudSync;
    }

    /** Uploads the pending ops once the cloud is reconciled on the current connection. */
    private uploadPendingOps(): void {
        void this.enqueueCloudSync(async () => {
            const socket = this.wsService.getWebSocket();
            if (socket !== null && socket === this.reconciledSocket) {
                await this.syncToCloud();
            }
        });
    }

    /**
     * Sync tag operations to cloud (incremental).
     * Sends the pending ops in order; each acknowledged chunk leaves the queue.
     */
    private async syncToCloud(): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        const { pendingOps } = await this.dbService.getTagSyncState();
        // Chunk large batches to stay within server limits
        for (let i = 0; i < pendingOps.length; i += TAG_OPS_CHUNK_SIZE) {
            const chunk = pendingOps.slice(i, i + TAG_OPS_CHUNK_SIZE);
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'tagOps',
                uuid,
                ops: chunk
            });
            const serverTs = response?.['serverTs'];
            if (typeof serverTs !== 'number' || !Number.isFinite(serverTs)) {
                // Keep this chunk and the ones after it for the next sync, in order.
                this.logger.warn('Tag ops were not acknowledged by the cloud; they stay queued');
                return;
            }
            await this.dbService.clearPendingTagOps(serverTs, chunk.length);
        }
    }

    /**
     * Push full local state to cloud, replacing server state.
     */
    private async pushFullStateToCloud(): Promise<void> {
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        // Ops queued so far are part of the pushed state; ops queued later stay queued.
        const { pendingOps } = await this.dbService.getTagSyncState();
        const localData = await this.getTagData();

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'setTagState',
            uuid,
            data: localData
        });

        const serverTs = response?.['serverTs'];
        if (typeof serverTs === 'number' && Number.isFinite(serverTs)) {
            await this.dbService.clearPendingTagOps(serverTs, pendingOps.length);
        }
    }

    /**
     * Fetch tags from cloud and merge with local if needed.
     * Called on login/register and when coming back online.
     * Uses incremental sync with conflict detection.
     * Waits until the local tags were migrated against a catalog, migrates
     * a V3 cloud copy the same way, and replaces it with its migrated full
     * state plus the pending ops (or the user's conflict choice).
     */
    public syncFromCloud(): Promise<void> {
        return this.enqueueCloudSync(() => this.reconcileWithCloud());
    }

    private async reconcileWithCloud(): Promise<void> {
        await this.keyMigrationReady;
        this.reconciledSocket = null;
        if (!await this.canUseCloud()) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        const socket = this.wsService.getWebSocket();
        try {
            if (await this.reconcile(uuid)) {
                this.reconciledSocket = socket;
            }
        } catch (err) {
            this.logger.error('Failed to sync tags from cloud: ' + err);
        }
    }

    /** Reconciles local tags with the cloud; false when the cloud state could not be read. */
    private async reconcile(uuid: string): Promise<boolean> {
        const syncState = await this.dbService.getTagSyncState();
        const { pendingOps } = syncState;
        const hasPendingOps = pendingOps.length > 0;
        const hasLocalTags = Object.keys((await this.getTagData()).tags).length > 0;

        // Request server state info (timestamp) and any ops since our last sync
        let response = await this.requestCloudTagState(uuid, syncState.lastSyncTs);
        if (response && (response.serverTs ?? 0) > 0 && !response.fullState
            && (response.formatVersion ?? TAG_FORMAT_VERSION) < TAG_FORMAT_VERSION) {
            // An older-format cloud copy is replaced below, so build the
            // replacement from all of it rather than from ops since lastSyncTs.
            response = await this.requestCloudTagState(uuid, 0);
        }
        if (!response) return false;

        const serverTs = response.serverTs ?? 0;
        const upgradeRemote = (response.fullState?.formatVersion ?? TAG_FORMAT_VERSION) < TAG_FORMAT_VERSION;
        if (upgradeRemote) {
            // An older cloud copy always arrives as full state; its ops are never applied.
            this.migrateTagDataKeys(response.fullState!, this.getKeyMigration());
        }

        // Migration case: local has tags but server has no data
        // Push local state to cloud to preserve existing tags
        if (hasLocalTags && serverTs === 0
            && !response.fullState
            && (!response.ops || response.ops.length === 0)) {
            this.logger.info('Migrating local tags to cloud (first sync)');
            await this.pushFullStateToCloud();
            return true;
        }

        // Conflict detection: we have pending ops AND server has changed since our last sync
        // (but not if serverTs is 0, meaning server has no data yet)
        if (hasPendingOps && serverTs > 0 && syncState.lastSyncTs !== serverTs) {
            // Potential conflict - ask user how to resolve
            const resolution = await this.showConflictDialog();

            switch (resolution) {
                case 'cloud':
                    // Drop local pending, use cloud state
                    await this.applyCloudState(response, serverTs, pendingOps.length);
                    if (upgradeRemote) {
                        await this.pushFullStateToCloud();
                    }
                    break;
                case 'merge':
                    // Apply cloud changes first, then re-apply our pending ops on top
                    await this.replayPendingOpsOnCloudState(response);
                    break;
                case 'local':
                    // Push our full local state to cloud
                    await this.pushFullStateToCloud();
                    break;
            }
            return true;
        }

        // No conflict: either no pending ops, or timestamps match (safe to sync)
        if (upgradeRemote) {
            // Replace the older-format cloud copy with itself plus the pending ops.
            await this.replayPendingOpsOnCloudState(response);
        } else if (hasPendingOps) {
            await this.syncToCloud();
        } else {
            // No pending ops - apply any cloud changes
            await this.applyCloudState(response, serverTs, 0);
        }
        return true;
    }

    /** getTagOps: the ops since `since`, or the full state; null when the server reports an error. */
    private async requestCloudTagState(uuid: string, since: number): Promise<RemoteTagState | null> {
        const response = await this.wsService.sendAndWaitForResponse({
            action: 'getTagOps',
            uuid,
            since
        });
        return !response || response['action'] === 'error' ? null : response;
    }

    /**
     * Apply cloud state (either full state or incremental ops).
     * The first `settledCount` pending ops are dropped; ops queued after
     * them, e.g. edits made while syncing, are re-applied on top.
     */
    private async applyCloudState(response: RemoteTagState, serverTs: number, settledCount: number): Promise<void> {
        const queuedOps = await this.dbService.clearPendingTagOps(serverTs, settledCount);
        if (!response.fullState && !response.ops?.length && queuedOps.length === 0) {
            return;
        }

        const tagData = response.fullState ?? await this.getTagData();
        if (!response.fullState) {
            this.applyTagOps(tagData, response.ops ?? []);
            tagData.timestamp = serverTs;
        }
        this.applyTagOps(tagData, queuedOps);
        await this.dbService.saveAllTagData(tagData);
        this.applyLocalTagState(tagData, { searchIndexChanged: true });
    }

    /**
     * Replays the pending ops on top of the cloud state (its full state, or
     * local state plus its ops) and makes the result both local and cloud state.
     */
    private async replayPendingOpsOnCloudState(response: RemoteTagState): Promise<void> {
        const tagData = response.fullState ?? await this.getTagData();
        if (!response.fullState) {
            this.applyTagOps(tagData, response.ops ?? []);
        }
        const { pendingOps } = await this.dbService.getTagSyncState();
        this.applyTagOps(tagData, pendingOps);
        await this.commitFullState(tagData, { timestamp: Date.now(), searchIndexChanged: true });
        await this.pushFullStateToCloud();
    }

    /**
     * Apply tag operations to tag data.
     * Actions: 0 = remove, 1 = add, 2 = rename
     */
    private applyTagOps(tagData: TagData, ops: TagOp[]): void {
        for (const op of ops) {
            const { k: key, t: tag, c: category, a: action, q: quantity, n: newTag } = op;
            const { id: tagId } = this.normalizeTag(tag);

            if (action === TAG_ACTION.rename && newTag) {
                // Rename: move entry from old tagId to new tagId
                const oldTagId = tagId;
                const { id: newTagId } = this.normalizeTag(newTag);
                if (tagData.tags[oldTagId]) {
                    const entry = tagData.tags[oldTagId];
                    entry.label = newTag; // Update to new case
                    tagData.tags[newTagId] = entry;
                    delete tagData.tags[oldTagId];
                }
            } else if (action === TAG_ACTION.add) {
                // Add
                if (!tagData.tags[tagId]) {
                    tagData.tags[tagId] = { label: tag, units: {}, chassis: {} };
                } else if (tagData.tags[tagId].label !== tag) {
                    // Update case if different
                    tagData.tags[tagId].label = tag;
                }
                const entry = tagData.tags[tagId];
                if (category === TAG_CATEGORY.chassis) {
                    entry.chassis[key] = quantity != null ? { q: quantity } : {};
                } else {
                    entry.units[key] = quantity != null ? { q: quantity } : {};
                }
            } else {
                // Remove
                if (tagData.tags[tagId]) {
                    const entry = tagData.tags[tagId];
                    if (category === TAG_CATEGORY.chassis) {
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
            // Another session replaced the cloud state: fetch it whole. Pending ops
            // stay queued for the reconciliation instead of being dropped.
            await this.enqueueCloudSync(async () => {
                await this.dbService.resetTagSyncTimestamp();
                await this.reconcileWithCloud();
            });
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
        this.applyLocalTagState(localData, { searchIndexChanged: true });
    }
}
