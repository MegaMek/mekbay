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

import { Injectable, signal, Injector, inject, DestroyRef } from '@angular/core';
import type { Unit } from '../models/units.model';
import type { Faction, FactionId } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import { DbService, type TagData } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';

import { type Equipment, type EquipmentMap } from '../models/equipment.model';
import type { Quirk } from '../models/quirks.model';
import { generateUUID, WsService } from './ws.service';
import type { ForceUnit } from '../models/force-unit.model';
import type { Force }    from '../models/force.model';
import type { ASSerializedForce, CBTSerializedForce, SerializedForce } from '../models/force-serialization';
import { UnitInitializerService } from './unit-initializer.service';
import { UserStateService } from './userState.service';
import {
    createLoadForceEntry,
    createLoadForceEntryFromSerializedForce,
    LoadForceEntry,
    type RemoteLoadForceEntry,
} from '../models/load-force-entry.model';
import { LoggerService } from './logger.service';
import { type SerializedOperation, LoadOperationEntry, type OperationForceInfo } from '../models/operation.model';
import { type LoadedOrganization, type SerializedOrganization, LoadOrganizationEntry } from '../models/organization.model';
import { Subject } from 'rxjs';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import type { Sourcebook } from '../models/sourcebook.model';
import type { MegaMekFactionAffiliation, MegaMekFactionRecord, MegaMekFactions } from '../models/megamek/factions.model';
import type { MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import type { MegaMekRulesetRecord } from '../models/megamek/rulesets.model';
import { getForcePacks } from '../models/forcepacks.model';
import { getForcePackLookupKey } from '../utils/force-pack.util';
import type { UnitSearchWorkerFactionEraSnapshot, UnitSearchWorkerIndexSnapshot } from '../utils/unit-search-worker-protocol.util';
import { MegaMekAvailabilityCatalogService } from './catalogs/megamek-availability-catalog.service';
import { MegaMekFactionsCatalogService } from './catalogs/megamek-factions-catalog.service';
import { MegaMekRulesetsCatalogService } from './catalogs/megamek-rulesets-catalog.service';
import { ErasCatalogService } from './catalogs/eras-catalog.service';
import { FactionsCatalogService } from './catalogs/mulfactions-catalog.service';
import { MulUnitSourcesCatalogService } from './catalogs/mul-unit-sources-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { UnitsCatalogService } from './catalogs/units-catalog.service';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';

/*
 * Author: Drake
 */
export const DOES_NOT_TRACK = 999;

export interface MinMaxStatsRange {
    armor: [number, number],
    internal: [number, number],
    heat: [number, number],
    dissipation: [number, number],
    dissipationEfficiency: [number, number],
    runMP: [number, number],
    run2MP: [number, number],
    umuMP: [number, number],
    jumpMP: [number, number],
    alphaNoPhysical: [number, number],
    alphaNoPhysicalNoOneshots: [number, number],
    maxRange: [number, number],
    dpt: [number, number],

    // Capital ships
    dropshipCapacity: [number, number],
    escapePods: [number, number],
    lifeBoats: [number, number],
    sailIntegrity: [number, number],
    kfIntegrity: [number, number],
}
export interface UnitTypeMaxStats {
    [unitType: string]: MinMaxStatsRange
}

// Generic store update payload used for cross-tab notifications
export type BroadcastPayload = {
    source: 'mekbay';
    action: 'update';   // e.g. 'update'
    context?: string;     // e.g. 'tags'
    meta?: any;         // optional misc info
};

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private logger = inject(LoggerService);
    private broadcast?: BroadcastChannel;
    private broadcastHandler?: (ev: MessageEvent) => void;
    private injector = inject(Injector);
    private dbService = inject(DbService);
    private wsService = inject(WsService);
    private userStateService = inject(UserStateService);
    private unitInitializer = inject(UnitInitializerService);
    private tagsService = inject(TagsService);
    private publicTagsService = inject(PublicTagsService);
    private destroyRef = inject(DestroyRef);
    private unitSearchIndexService = inject(UnitSearchIndexService);
    private unitRuntimeService = inject(UnitRuntimeService);
    private unitsCatalog = inject(UnitsCatalogService);
    private equipmentCatalog = inject(EquipmentCatalogService);
    private erasCatalog = inject(ErasCatalogService);
    private factionsCatalog = inject(FactionsCatalogService);
    private megaMekAvailabilityCatalog = inject(MegaMekAvailabilityCatalogService);
    private megaMekFactionsCatalog = inject(MegaMekFactionsCatalogService);
    private megaMekRulesetsCatalog = inject(MegaMekRulesetsCatalogService);
    private mulUnitSourcesCatalog = inject(MulUnitSourcesCatalogService);
    private quirksCatalog = inject(QuirksCatalogService);
    private sourcebooksCatalog = inject(SourcebooksCatalogService);

    isDataReady = signal(false);
    isDownloading = signal(false);
    public isCloudForceLoading = signal(false);

    /** Emits when a cloud save is rejected (not_owner) and the force needs adoption. */
    public forceNeedsAdoption = new Subject<Force>();

    /** packName -> Set<chassis|type|subtype> for force pack membership checks */
    private forcePackToLookupKey: Map<string, Set<string>> | null = null;
    /** chassis|type|subtype -> sorted pack names[] for reverse lookups */
    private lookupKeyToForcePacks: Map<string, string[]> | null = null;

    public tagsVersion = signal(0);
    public searchCorpusVersion = signal(0);


    constructor() {
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.broadcast = new BroadcastChannel('mekbay-updates');
                this.broadcastHandler = (ev: MessageEvent) => {
                    void this.handleStoreUpdate(ev.data as any);
                };
                this.broadcast.addEventListener('message', this.broadcastHandler);
                inject(DestroyRef).onDestroy(() => {
                    if (this.broadcast && this.broadcastHandler) {
                        this.broadcast.removeEventListener('message', this.broadcastHandler);
                    }
                    this.broadcast?.close();
                });
            };
        } catch { /* best-effort */ }
        if (typeof window !== 'undefined') {
            const flushOnUnload = () => {
                try {
                    this.flushAllPendingSavesOnUnload();
                } catch { /* best-effort */ }
            };
            const onVisibility = () => {
                if (document.visibilityState === 'hidden') {
                    flushOnUnload();
                }
            };
            const onOnline = () => {
                // Small delay to let WS reconnect first
                setTimeout(() => this.tagsService.syncFromCloud(), 1000);
            };
            
            window.addEventListener('beforeunload', flushOnUnload);
            window.addEventListener('pagehide', flushOnUnload);
            document.addEventListener('visibilitychange', onVisibility);
            window.addEventListener('online', onOnline);
            
            this.destroyRef.onDestroy(() => {
                window.removeEventListener('beforeunload', flushOnUnload);
                window.removeEventListener('pagehide', flushOnUnload);
                document.removeEventListener('visibilitychange', onVisibility);
                window.removeEventListener('online', onOnline);
                this.broadcast?.close();
                // Clear pending debounced saves and reject their promises to prevent memory leaks
                for (const [, entry] of this.saveForceCloudDebounce) {
                    clearTimeout(entry.timeout);
                    // Reject pending promises to notify callers
                    for (const { reject } of entry.resolvers) {
                        reject(new Error('Service destroyed'));
                    }
                }
                this.saveForceCloudDebounce.clear();
            });
        }

        // Wire up TagsService callbacks
        this.tagsService.setRefreshUnitsCallback((tagData) => {
            this.applyTagDataToUnits(tagData);
        });
        this.tagsService.setNotifyStoreUpdatedCallback(() => {
            this.notifyStoreUpdated('update', 'tags');
        });

        // Register WS message handlers for tag sync (handled by TagsService)
        this.tagsService.registerWsHandlers();

        // Wire up PublicTagsService callback
        this.publicTagsService.setRefreshUnitsCallback(() => {
            this.applyPublicTagsToUnits();
        });

        // Initialize PublicTagsService (loads cached tags from IndexedDB)
        this.publicTagsService.initialize();

        // Register WS handlers for public tag sync
        this.publicTagsService.registerWsHandlers();
    }

    /**
     * Apply tag data to all loaded units.
     * Called by TagsService when tags change.
     * 
     * V3 format: tags = { tagId: { label, units: {unitName: {}}, chassis: {chassisKey: {}} } }
     */
    private applyTagDataToUnits(tagData: TagData | null): void {
        this.unitRuntimeService.applyTagDataToUnits(this.getUnits(), tagData);
        this.tagsVersion.set(this.tagsVersion() + 1);
    }

    /**
     * Apply public tags to all loaded units.
     * Called by PublicTagsService when public tags change (import/subscribe/update).
     */
    private applyPublicTagsToUnits(): void {
        this.unitRuntimeService.applyPublicTagsToUnits(this.getUnits());
        this.tagsVersion.set(this.tagsVersion() + 1);
    }

    public notifyStoreUpdated(action: BroadcastPayload['action'], store?: string, meta?: any) {
        if (!this.broadcast) return;
        const payload: any = { source: 'mekbay', action, store, meta };
        try {
            this.broadcast?.postMessage(payload);
        } catch { /* best-effort */ }
    }

    private async handleStoreUpdate(msg: BroadcastPayload): Promise<void> {
        try {
            if (!msg || msg.source !== 'mekbay') return;
            const action = msg.action;
            const context = msg.context;
            if (action === 'update' && context === 'tags') {
                // Reload tag data from TagsService and apply to units
                const tagData = await this.tagsService.getTagData();
                this.applyTagDataToUnits(tagData);
            }
        } catch (err) {
            this.logger.error('Error handling store update broadcast: ' + err);
        }
    }

    /**
     * Load tags from storage and apply them to units.
     * Uses TagsService for cached data.
     */
    private async loadUnitTags(units: Unit[]): Promise<void> {
        await this.unitRuntimeService.loadUnitTags(units);
        this.tagsVersion.set(this.tagsVersion() + 1);
    }

    public getUnits(): Unit[] {
        return this.unitsCatalog.getUnits();
    }

    public getUnitByName(name: string): Unit | undefined {
        return this.unitRuntimeService.getUnitByName(name);
    }

    public getEquipments(): EquipmentMap {
        return this.equipmentCatalog.getEquipments();
    }

    public getEquipmentByName(internalName: string): Equipment | undefined {
        return this.equipmentCatalog.getEquipmentByName(internalName);
    }

    public getFactions(): Faction[] {
        return this.factionsCatalog.getFactions();
    }

    public getFactionByName(name: string): Faction | undefined {
        return this.factionsCatalog.getFactionByName(name);
    }

    public getFactionById(id: FactionId): Faction | undefined {
        return this.factionsCatalog.getFactionById(id);
    }

    public getEras(): Era[] {
        return this.erasCatalog.getEras();
    }

    public getEraByName(name: string): Era | undefined {
        return this.erasCatalog.getEraByName(name);
    }

    public getEraById(id: number): Era | undefined {
        return this.erasCatalog.getEraById(id);
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirksCatalog.getQuirkByName(name);
    }

    public getSourcebookByAbbrev(abbrev: string): Sourcebook | undefined {
        return this.sourcebooksCatalog.getSourcebookByAbbrev(abbrev);
    }

    /**
     * Get the display title for a sourcebook abbreviation.
     * Falls back to the abbreviation itself if not found.
     */
    public getSourcebookTitle(abbrev: string): string {
        return this.sourcebooksCatalog.getSourcebookTitle(abbrev);
    }

    public getMegaMekFactions(): MegaMekFactions {
        return this.megaMekFactionsCatalog.getFactions();
    }

    public getMegaMekFactionByKey(key: string): MegaMekFactionRecord | undefined {
        return this.megaMekFactionsCatalog.getFactionByKey(key);
    }

    public getMegaMekFactionsByMulId(mulId: number): MegaMekFactionRecord[] {
        return this.megaMekFactionsCatalog.getFactionsByMulId(mulId);
    }

    public getMegaMekFactionAffiliation(factionKey: string): MegaMekFactionAffiliation {
        return this.megaMekFactionsCatalog.getFactionAffiliation(factionKey);
    }

    public getMegaMekRulesets(): readonly MegaMekRulesetRecord[] {
        return this.megaMekRulesetsCatalog.getRulesets();
    }

    public getMegaMekRulesetByFactionKey(factionKey: string): MegaMekRulesetRecord | undefined {
        return this.megaMekRulesetsCatalog.getRulesetByFactionKey(factionKey);
    }

    public getMegaMekRulesetsByMulFactionId(mulFactionId: number): MegaMekRulesetRecord[] {
        return this.getMegaMekFactionsByMulId(mulFactionId)
            .map((faction) => this.megaMekRulesetsCatalog.getRulesetByFactionKey(faction.id))
            .filter((ruleset): ruleset is MegaMekRulesetRecord => ruleset !== undefined);
    }

    public getMegaMekAvailabilityRecords(): readonly MegaMekWeightedAvailabilityRecord[] {
        return this.megaMekAvailabilityCatalog.getRecords();
    }

    public getMegaMekAvailabilityRecordForUnit(unit: Pick<Unit, 'type' | 'chassis' | 'model'>): MegaMekWeightedAvailabilityRecord | undefined {
        return this.megaMekAvailabilityCatalog.getRecordForUnit(unit);
    }

    /**
     * Get the sourcebook abbreviations for a unit by its MUL ID.
     * @param mulId The Master Unit List ID of the unit
     * @returns Array of sourcebook abbreviations, or undefined if not found
     */
    public getUnitSourcesByMulId(mulId: number): string[] | undefined {
        return this.mulUnitSourcesCatalog.getUnitSourcesByMulId(mulId);
    }

    private bumpSearchCorpusVersion(): void {
        this.searchCorpusVersion.update(version => version + 1);
    }

    private invalidateForcePackCaches(): void {
        this.forcePackToLookupKey = null;
        this.lookupKeyToForcePacks = null;
    }

    private rebuildUnitCatalogIndexes(units: Unit[]): void {
        this.invalidateForcePackCaches();
        this.unitRuntimeService.preprocessUnits(units);
    }

    public getIndexedUnitIds(filterKey: string, value: string): ReadonlySet<string> | undefined {
        return this.unitSearchIndexService.getIndexedUnitIds(filterKey, value);
    }

    public getIndexedFilterValues(filterKey: string): string[] {
        return this.unitSearchIndexService.getIndexedFilterValues(filterKey);
    }

    public getSearchWorkerIndexSnapshot(): UnitSearchWorkerIndexSnapshot {
        return this.unitSearchIndexService.getSearchWorkerIndexSnapshot();
    }

    public getSearchWorkerFactionEraSnapshot(): UnitSearchWorkerFactionEraSnapshot {
        return this.unitSearchIndexService.getSearchWorkerFactionEraSnapshot();
    }

    public getDropdownOptionUniverse(filterKey: string): Array<{ name: string; img?: string }> {
        return this.unitSearchIndexService.getDropdownOptionUniverse(filterKey);
    }

    public getIndexedComponentUnitCounts(name: string): ReadonlyMap<string, number> | undefined {
        return this.unitSearchIndexService.getIndexedComponentUnitCounts(name);
    }

    public refreshSearchCorpus(): void {
        this.rebuildUnitCatalogIndexes(this.getUnits());
        this.postprocessData();
        this.bumpSearchCorpusVersion();
    }

    private rebuildTagSearchIndex(): void {
        this.unitSearchIndexService.rebuildTagSearchIndex(this.getUnits());
    }

    public getUnitTypeMaxStats(type: string): MinMaxStatsRange {
        return this.unitSearchIndexService.getUnitTypeMaxStats(type);
    }

    private postprocessData(): void {
        this.unitRuntimeService.postprocessUnits(this.getUnits(), this.getEras());
        this.unitRuntimeService.linkEquipmentToUnits(this.getUnits(), this.getEquipments());
        const extinctFaction = this.getFactionById(MULFACTION_EXTINCT);
        this.unitSearchIndexService.rebuildIndexes(this.getUnits(), this.getEras(), this.getFactions(), extinctFaction);
    }

    private async checkForUpdate(): Promise<void> {
        try {
            await Promise.all([
                this.unitsCatalog.initialize(),
                this.equipmentCatalog.initialize(),
                this.mulUnitSourcesCatalog.initialize(),
                this.erasCatalog.initialize(),
                this.factionsCatalog.initialize(),
            ]);
            this.postprocessData();
            this.bumpSearchCorpusVersion();
        } finally {
            this.isDownloading.set(false);
        }
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }

        return String(error);
    }

    private async initializeSupplementalCatalogs(): Promise<void> {
        const catalogs = [
            { name: 'megamek_availability', initialize: () => this.megaMekAvailabilityCatalog.initialize() },
            { name: 'megamek_factions', initialize: () => this.megaMekFactionsCatalog.initialize() },
            { name: 'megamek_rulesets', initialize: () => this.megaMekRulesetsCatalog.initialize() },
            { name: 'quirks', initialize: () => this.quirksCatalog.initialize() },
            { name: 'sourcebooks', initialize: () => this.sourcebooksCatalog.initialize() },
        ] as const;
        const results = await Promise.allSettled(catalogs.map(({ initialize }) => initialize()));
        const failures = results.flatMap((result, index) => (
            result.status === 'rejected'
                ? [{ name: catalogs[index].name, error: result.reason }]
                : []
        ));

        if (failures.length === 0) {
            return;
        }

        for (const failure of failures) {
            this.logger.error(`Failed to initialize catalog service "${failure.name}": ${this.describeError(failure.error)}`);
        }

        this.logger.error(
            `Failed to initialize ${failures.length} catalog service${failures.length === 1 ? '' : 's'}: ${failures.map(({ name }) => `"${name}"`).join(', ')}`,
        );
    }

    public async initialize(): Promise<void> {
        this.isDataReady.set(false);
        this.logger.info('Initializing data service...');
        await this.dbService.waitForDbReady();
        this.logger.info('Database is ready, checking for updates...');
        try {
            await this.checkForUpdate();
            await this.initializeSupplementalCatalogs();
            this.logger.info('All data stores are ready.');
            // Apply public tags to units now that data is ready
            // (PublicTagsService.initialize() may have loaded cached tags before units were ready)
            this.applyPublicTagsToUnits();
            this.isDataReady.set(true);
        } catch (error) {
            this.logger.error(`Failed to initialize data: ${this.describeError(error)}`);
            // Check if we have any data loaded despite the error
            const hasData = this.getUnits().length > 0 && Object.keys(this.getEquipments()).length > 0;
            if (hasData) {
                // Apply public tags even on partial load
                this.applyPublicTagsToUnits();
            }
            this.isDataReady.set(hasData);
        } finally {
            this.isDownloading.set(false);
        }
    }

    private isCloudNewer(localRaw: any, cloudRaw: any): boolean {
        const localTs = localRaw?.timestamp ? new Date(localRaw.timestamp).getTime() : 0;
        const cloudTs = cloudRaw?.timestamp ? new Date(cloudRaw.timestamp).getTime() : 0;
        return cloudTs > localTs;
    }

    public async getForce(instanceId: string, ownedOnly: boolean = false): Promise<Force | null> {
        const localRaw = await this.dbService.getForce(instanceId);
        let cloudRaw: any | null = null;
        let triedCloud = false;
        this.isCloudForceLoading.set(true);
        try {
            const ws = await this.canUseCloud();
            if (ws) {
                try {
                    cloudRaw = await this.getForceCloud(instanceId, ownedOnly);
                    triedCloud = true;
                } catch {
                    cloudRaw = null;

                }
            }
        } finally {
            this.isCloudForceLoading.set(false);
        }
        let local: Force | null = null;
        let cloud: Force | null = null;
        let result: Force | null = null;
        if (localRaw) {
            try {
                if (localRaw.type === GameSystem.ALPHA_STRIKE) {
                    local = ASForce.deserialize(localRaw as ASSerializedForce, this, this.unitInitializer, this.injector);
                } else { // CBT
                    local = CBTForce.deserialize(localRaw as CBTSerializedForce, this, this.unitInitializer, this.injector);
                }
            } catch (error) { 
                this.logger.error((error as any)?.message ?? error);
            }
        }
        if (cloudRaw) {
            try {
                if (cloudRaw.type === GameSystem.ALPHA_STRIKE) {
                    cloud = ASForce.deserialize(cloudRaw as ASSerializedForce, this, this.unitInitializer, this.injector);
                } else { // CBT
                    cloud = CBTForce.deserialize(cloudRaw as CBTSerializedForce, this, this.unitInitializer, this.injector);
                }
            } catch (error) { 
                this.logger.error((error as any)?.message ?? error);
            }
        }

        if (local && cloud) {
            result = this.isCloudNewer(localRaw, cloudRaw) ? cloud : local;
        } else if (!triedCloud && local) {
            result = local;
        } else {
            result = cloud || local || null;
        }

        // If we reached cloud but the force only exists locally, push it up
        if (triedCloud && local && !cloud) {
            this.logger.info(`Force "${local.name}" exists locally but not in cloud: pushing to cloud.`);
            this.saveForceCloud(local);
        }

        // Fix any duplicate group/unit IDs that may have been persisted.
        if (result && result.deduplicateIds()) {
            this.logger.warn(`Force "${result.name}" had duplicate IDs — fixed and re-saving.`);
            this.saveForce(result);
        }

        return result;
    }

    public async saveForce(force: Force, localOnly: boolean = false): Promise<void> {
        if (force.readOnly()) {
            this.logger.warn(`DataService.saveForce() blocked: force "${force.name}" is read-only.`);
            return;
        }
        if (!force.instanceId()) {
            force.instanceId.set(generateUUID());
        }
        await this.dbService.saveForce(force.serialize());
        if (!localOnly) {
            this.saveForceCloud(force);
        }
    }



    public async saveSerializedForceToLocalStorage(serialized: SerializedForce): Promise<void> {
        await this.dbService.saveForce(serialized);
    }

    public async listForces(): Promise<LoadForceEntry[]> {
        this.logger.info(`Retrieving local forces...`);
        const localForces = await this.dbService.listForces(this);
        this.logger.info(`Retrieving cloud forces...`);
        const cloudForces = await this.listForcesCloud();
        this.logger.info(`Found ${localForces.length} local forces and ${cloudForces.length} cloud forces.`);
        const forceMap = new Map<string, LoadForceEntry>();
        const getTimestamp = (f: any) => {
            if (f && typeof f.timestamp === 'number') return f.timestamp;
            if (f && f.timestamp) return new Date(f.timestamp).getTime();
            return 0;
        };
        for (const force of localForces) {
            if (!force) continue;
            if (!force.instanceId) continue;
            force.local = true;
            forceMap.set(force.instanceId, force);
        }
        for (const cloudForce of cloudForces) {
            if (!cloudForce) continue;
            if (!cloudForce.instanceId) continue;
            const localForce = forceMap.get(cloudForce.instanceId);
            if (!localForce || getTimestamp(cloudForce) >= getTimestamp(localForce)) {
                if (localForce) {
                    cloudForce.local = true; // This force is both local and cloud
                }
                forceMap.set(cloudForce.instanceId, cloudForce);
            }
        }
        const mergedForces = Array.from(forceMap.values()).sort((a, b) => getTimestamp(b) - getTimestamp(a));
        this.logger.info(`Found ${mergedForces.length} unique forces.`);
        return mergedForces;
    }

    private static readonly FORCE_BULK_CHUNK_SIZE = 100;

    public async cacheForcesLocally(instanceIds: readonly string[]): Promise<number> {
        const uniqueIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        if (uniqueIds.length === 0) return 0;

        const localRawForces = await Promise.all(uniqueIds.map((instanceId) => this.dbService.getForce(instanceId)));
        const missingIds = uniqueIds.filter((instanceId, index) => !localRawForces[index]);
        if (missingIds.length === 0) return 0;

        const cloudForces = await this.getForcesCloudRawByIds(missingIds);
        for (const force of cloudForces) {
            await this.dbService.saveForce(force);
        }

        return cloudForces.length;
    }

    public async getLoadForceEntriesByIds(instanceIds: readonly string[]): Promise<LoadForceEntry[]> {
        const orderedIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        if (orderedIds.length === 0) return [];

        const entryMap = new Map<string, LoadForceEntry>();
        const localRawForces = await Promise.all(orderedIds.map(instanceId => this.dbService.getForce(instanceId)));

        for (const localRaw of localRawForces) {
            if (!localRaw?.instanceId) continue;
            entryMap.set(localRaw.instanceId, createLoadForceEntryFromSerializedForce(localRaw, this, { local: true }));
        }

        const cloudForces = await this.getForcesBulkSummaries(orderedIds);
        for (const raw of cloudForces) {
            if (!raw?.instanceId) continue;
            const cloudEntry = createLoadForceEntry(raw, this, { cloud: true });
            const existing = entryMap.get(raw.instanceId);
            if (!existing || this.getComparableTimestamp(raw.timestamp) >= this.getComparableTimestamp(existing.timestamp)) {
                if (existing?.local) cloudEntry.local = true;
                entryMap.set(raw.instanceId, cloudEntry);
            }
        }

        return orderedIds
            .map(instanceId => entryMap.get(instanceId))
            .filter((entry): entry is LoadForceEntry => entry !== undefined);
    }

    private async getForcesBulkSummaries(instanceIds: readonly string[]): Promise<RemoteLoadForceEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const orderedIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        const result: RemoteLoadForceEntry[] = [];

        for (let i = 0; i < orderedIds.length; i += DataService.FORCE_BULK_CHUNK_SIZE) {
            const chunk = orderedIds.slice(i, i + DataService.FORCE_BULK_CHUNK_SIZE);
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getForcesBulk',
                instanceIds: chunk,
            });
            if (!response?.data || !Array.isArray(response.data)) continue;
            result.push(...response.data as RemoteLoadForceEntry[]);
        }

        return result;
    }

    private async getForcesCloudRawByIds(instanceIds: readonly string[]): Promise<SerializedForce[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const orderedIds = Array.from(new Set(instanceIds.filter((instanceId): instanceId is string => !!instanceId)));
        const uuid = this.userStateService.uuid();
        const result: SerializedForce[] = [];

        for (const instanceId of orderedIds) {
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getForce',
                uuid,
                instanceId,
                ownedOnly: false,
            });
            const raw = response?.data as SerializedForce | null | undefined;
            if (raw?.instanceId) {
                result.push(raw);
            }
        }

        return result;
    }

    private _cloudReadyChecked = false;
    private async canUseCloud(timeoutMs = 3000): Promise<WebSocket | null> {
        if (!navigator.onLine) return null;
        const ws = this.wsService.getWebSocket();
        if (!ws) return null;
        if (!this._cloudReadyChecked) {
            try {
                await Promise.race([
                    this.wsService.getWsReady(),
                    new Promise((_, reject) => setTimeout(() => reject('WebSocket connect timeout'), timeoutMs))
                ]);
            } catch {
                this._cloudReadyChecked = true;
                return null;
            }
        }
        if (ws.readyState !== WebSocket.OPEN) return null;
        return ws;
    }

    public async deleteForce(instanceId: string): Promise<void> {
        // Delete from local IndexedDB
        await this.dbService.deleteForce(instanceId);
        // Delete from cloud
        const ws = await this.canUseCloud();
        if (ws) {
            const uuid = this.userStateService.uuid();
            const payload = {
                action: 'delForce',
                uuid,
                instanceId
            };
            this.wsService.send(payload);
        }
    }

    /** Delete a force from local storage only (no cloud request). */
    public async deleteLocalForce(instanceId: string): Promise<void> {
        await this.dbService.deleteForce(instanceId);
    }

    /* ----------------------------------------------------------
     * Operations (multi-force compositions)
     */

    /**
     * Save an operation locally and to the cloud.
     */
    public async saveOperation(op: SerializedOperation): Promise<void> {
        await this.dbService.saveOperation(op);
        this.saveOperationCloud(op);
    }

    /**
     * Retrieve a single operation by ID.
     * Fetches from both local storage and cloud in parallel, then keeps
     * whichever is newer (mirroring `getForce()` behaviour).
     * Returns a LoadOperationEntry enriched with force metadata, or null if not found.
     */
    public async getOperation(operationId: string): Promise<LoadOperationEntry | null> {
        const localPromise = this.getOperationLocal(operationId);
        let cloudEntry: LoadOperationEntry | null = null;
        let triedCloud = false;

        try {
            const ws = await this.canUseCloud();
            if (ws) {
                try {
                    cloudEntry = await this.getOperationCloud(operationId);
                    triedCloud = true;
                } catch {
                    cloudEntry = null;
                }
            }
        } catch {
            // cloud unavailable
        }

        const localEntry = await localPromise;

        // Pick the best result
        let result: LoadOperationEntry | null;
        if (localEntry && cloudEntry) {
            result = cloudEntry.timestamp > localEntry.timestamp ? cloudEntry : localEntry;
            result.owned = cloudEntry.owned;
        } else if (!triedCloud && localEntry) {
            result = localEntry;
        } else {
            result = cloudEntry || localEntry || null;
        }

        if (result) {
            result.localTimestamp = localEntry?.timestamp ?? 0;
            result.cloudTimestamp = triedCloud ? (cloudEntry?.timestamp ?? 0) : 0;

            // Push to cloud when we reached it and local is newer (or cloud is missing)
            if (triedCloud && result.localTimestamp > result.cloudTimestamp) {
                const serialized = await this.dbService.getOperation(operationId);
                if (serialized) {
                    this.saveOperationCloud(serialized);
                }
            }
        }

        return result;
    }

    /**
     * Retrieve a single operation from local IndexedDB.
     * No force enrichment — callers that load the operation will fetch
     * the actual forces via `getForce()` immediately after.
     */
    private async getOperationLocal(operationId: string): Promise<LoadOperationEntry | null> {
        const serialized = await this.dbService.getOperation(operationId);
        if (!serialized) return null;

        return new LoadOperationEntry({
            operationId: serialized.operationId,
            name: serialized.name || '',
            note: serialized.note || '',
            timestamp: serialized.timestamp,
            forces: serialized.forces.map(ref => ({
                instanceId: ref.instanceId,
                alignment: ref.alignment,
                timestamp: ref.timestamp,
                exists: false,
            })),
            local: true,
        });
    }

    /**
     * Delete an operation locally and from the cloud.
     */
    public async deleteOperation(operationId: string): Promise<void> {
        await this.dbService.deleteOperation(operationId);
        const ws = await this.canUseCloud();
        if (ws) {
            this.wsService.send({
                action: 'delOperation',
                operationId,
            });
        }
    }

    /**
     * List operations, merging local and cloud.
     * Cloud entries include joined force metadata; local entries are enriched
     * with locally available force data.
     *
     * After merging:
     * - Cloud operations are saved locally for offline access.
     * - Local-only operations are verified against the cloud to detect
     *   ownership conflicts (e.g. user changed accounts). If a conflict is
     *   found, the local operation gets a new operationId and is saved to cloud.
     */
    public async listOperations(): Promise<LoadOperationEntry[]> {
        const [localOps, cloudOps] = await Promise.all([
            this.listOperationsLocal(),
            this.listOperationsCloud(),
        ]);

        // Merge: cloud wins for same operationId, but keep local-only entries
        const opMap = new Map<string, LoadOperationEntry>();

        for (const op of localOps) {
            op.local = true;
            opMap.set(op.operationId, op);
        }

        const cloudOnlyOps: LoadOperationEntry[] = [];
        for (const cloudOp of cloudOps) {
            const existing = opMap.get(cloudOp.operationId);
            cloudOp.cloud = true;
            if (existing) {
                cloudOp.local = true;
                // Merge: use cloud's enriched force data but update with any
                // locally-fresher force info
                this.mergeOperationForceInfo(cloudOp, existing);
            } else {
                cloudOnlyOps.push(cloudOp);
            }
            opMap.set(cloudOp.operationId, cloudOp);
        }

        // Save cloud operations locally for offline access and to sync name/note changes.
        // Fire-and-forget to avoid blocking the UI.
        this.saveCloudOperationsLocally(cloudOps);

        // Identify local-only operations (not found on cloud) and verify them
        const localOnlyOps = Array.from(opMap.values()).filter(op => op.local && !op.cloud);
        if (localOnlyOps.length > 0) {
            // Fire-and-forget: verify ownership in the background
            this.verifyLocalOnlyOperations(localOnlyOps, opMap);
        }

        return Array.from(opMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Save cloud operations to local IndexedDB for offline access.
     * Uses the cloud data (which may have updated name/note) and writes them locally.
     */
    private async saveCloudOperationsLocally(cloudOps: LoadOperationEntry[]): Promise<void> {
        for (const op of cloudOps) {
            try {
                const serialized: SerializedOperation = {
                    operationId: op.operationId,
                    name: op.name,
                    note: op.note,
                    timestamp: op.timestamp,
                    forces: op.forces.map(f => ({
                        instanceId: f.instanceId,
                        alignment: f.alignment,
                        timestamp: f.timestamp,
                    })),
                };
                await this.dbService.saveOperation(serialized);
            } catch (err) {
                this.logger.error(`Failed to save cloud operation locally: ${err}`);
            }
        }
    }

    /**
     * Verify local-only operations against the cloud to detect ownership conflicts.
     * If a local operation exists on the cloud but isn't owned by us, we re-ID it
     * locally and save the new copy to the cloud immediately.
     * If it doesn't exist on the cloud, we leave it alone (user may have deleted it
     * from another device).
     *
     * Sends requests in chunks of VERIFY_OPS_CHUNK_SIZE to stay within the server limit.
     */
    private static readonly VERIFY_OPS_CHUNK_SIZE = 100;

    private async verifyLocalOnlyOperations(
        localOnlyOps: LoadOperationEntry[],
        opMap: Map<string, LoadOperationEntry>,
    ): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;

        const allIds = localOnlyOps.map(op => op.operationId);

        try {
            // Process in chunks to respect server-side cap
            for (let i = 0; i < allIds.length; i += DataService.VERIFY_OPS_CHUNK_SIZE) {
                const chunk = allIds.slice(i, i + DataService.VERIFY_OPS_CHUNK_SIZE);
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'verifyOperations',
                    operationIds: chunk,
                });
                if (!response?.data || !Array.isArray(response.data)) continue;

                await this.processVerifyResults(response.data, localOnlyOps, opMap);
            }
        } catch (err) {
            this.logger.error(`Failed to verify local-only operations: ${err}`);
        }
    }

    /**
     * Process verify results for a single chunk and handle conflicts.
     */
    private async processVerifyResults(
        results: Array<{ operationId: string; exists: boolean; owned: boolean }>,
        localOnlyOps: LoadOperationEntry[],
        opMap: Map<string, LoadOperationEntry>,
    ): Promise<void> {
        for (const result of results) {
            const { operationId, exists, owned } = result;

            if (exists && !owned) {
                // Conflict: the operationId is owned by another user.
                // Generate a new operationId, update local, and save to cloud.
                const conflictOp = localOnlyOps.find(op => op.operationId === operationId);
                if (!conflictOp) continue;

                const newOperationId = generateUUID();
                this.logger.warn(
                    `Operation "${conflictOp.name}" (${operationId}) is owned by another account. ` +
                    `Re-assigning to new ID: ${newOperationId}`
                );

                // Delete old local entry
                await this.dbService.deleteOperation(operationId);

                // Build the serialized operation with the new ID
                const serialized: SerializedOperation = {
                    operationId: newOperationId,
                    name: conflictOp.name,
                    note: conflictOp.note,
                    timestamp: conflictOp.timestamp,
                    forces: conflictOp.forces.map(f => ({
                        instanceId: f.instanceId,
                        alignment: f.alignment,
                        timestamp: f.timestamp,
                    })),
                };

                // Save locally with new ID
                await this.dbService.saveOperation(serialized);
                // Save to cloud with new ID
                await this.saveOperationCloud(serialized);

                // Update the opMap entry so callers see the new ID
                opMap.delete(operationId);
                conflictOp.operationId = newOperationId;
                conflictOp.cloud = true;
                opMap.set(newOperationId, conflictOp);
            }
            // If !exists: the operation was deleted elsewhere, leave it local-only.
            // It will be pushed to cloud if the user explicitly loads it.
        }
    }

    /**
     * Merge local force metadata into a cloud-enriched operation entry.
     * If local has newer timestamps for any force, update the entry.
     */
    private mergeOperationForceInfo(target: LoadOperationEntry, localEntry: LoadOperationEntry): void {
        for (const localForce of localEntry.forces) {
            const cloudForce = target.forces.find(f => f.instanceId === localForce.instanceId);
            if (!cloudForce) {
                // Force exists locally but not in cloud response — add it
                target.forces.push(localForce);
            } else {
                // If local force info is more recent, prefer it
                const localTs = localForce.forceTimestamp ? new Date(localForce.forceTimestamp).getTime() : 0;
                const cloudTs = cloudForce.forceTimestamp ? new Date(cloudForce.forceTimestamp).getTime() : 0;
                if (localTs > cloudTs) {
                    cloudForce.name = localForce.name ?? cloudForce.name;
                    cloudForce.type = localForce.type ?? cloudForce.type;
                    cloudForce.factionId = localForce.factionId ?? cloudForce.factionId;
                    cloudForce.bv = localForce.bv ?? cloudForce.bv;
                    cloudForce.pv = localForce.pv ?? cloudForce.pv;
                    cloudForce.forceTimestamp = localForce.forceTimestamp;
                }
                // Mark force as existing if either source has it
                if (localForce.exists) cloudForce.exists = true;
            }
        }
    }

    private async listOperationsLocal(): Promise<LoadOperationEntry[]> {
        const serialized = await this.dbService.listOperations();
        const entries: LoadOperationEntry[] = [];

        for (const op of serialized) {
            const forces: OperationForceInfo[] = [];
            for (const ref of op.forces) {
                // Try to enrich with local force metadata
                const localForce = await this.dbService.getForce(ref.instanceId);
                forces.push({
                    instanceId: ref.instanceId,
                    alignment: ref.alignment,
                    timestamp: ref.timestamp,
                    name: localForce?.name,
                    type: localForce?.type as GameSystem | undefined,
                    factionId: localForce?.factionId,
                    bv: localForce?.bv,
                    pv: localForce?.pv,
                    forceTimestamp: localForce?.timestamp,
                    exists: !!localForce,
                });
            }
            entries.push(new LoadOperationEntry({
                operationId: op.operationId,
                name: op.name || '',
                note: op.note || '',
                timestamp: op.timestamp,
                forces,
                local: true,
            }));
        }
        return entries;
    }

    private async listOperationsCloud(): Promise<LoadOperationEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'listOperations',
        });
        if (!response?.data || !Array.isArray(response.data)) return [];

        return response.data.map((raw: any) => new LoadOperationEntry({
            operationId: raw.operationId,
            name: raw.name || '',
            note: raw.note || '',
            timestamp: raw.timestamp,
            owned: raw.owned ?? true,
            forces: (raw.forces || []).map((f: any) => ({
                instanceId: f.instanceId,
                alignment: f.alignment,
                timestamp: f.timestamp,
                name: f.name,
                type: f.type,
                factionId: f.factionId,
                bv: f.bv,
                pv: f.pv,
                forceTimestamp: f.forceTimestamp,
                exists: f.exists ?? false,
            } as OperationForceInfo)),
            cloud: true,
        }));
    }

    private async getOperationCloud(operationId: string): Promise<LoadOperationEntry | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'getOperation',
            operationId,
        });
        const raw = response?.data;
        if (!raw) return null;

        return new LoadOperationEntry({
            operationId: raw.operationId,
            name: raw.name || '',
            note: raw.note || '',
            timestamp: raw.timestamp,
            owned: raw.owned ?? false,
            forces: (raw.forces || []).map((f: any) => ({
                instanceId: f.instanceId,
                alignment: f.alignment,
                timestamp: f.timestamp,
                exists: false,
            })),
            cloud: true,
        });
    }

    private async saveOperationCloud(op: SerializedOperation): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;
        this.wsService.send({
            action: 'saveOperation',
            data: op,
        });
    }

    /**
     * Bulk-fetch basic force metadata from the cloud for a list of instanceIds.
     * Returns enrichment data (name, type, bv, pv, timestamp) for each found force.
     * Sends requests in chunks of 100 to stay within the server limit.
     */
    private static readonly FORCE_INFO_CHUNK_SIZE = 100;

    public async getForceInfoBulk(instanceIds: string[]): Promise<Map<string, OperationForceInfo>> {
        const result = new Map<string, OperationForceInfo>();
        const ws = await this.canUseCloud();
        if (!ws || instanceIds.length === 0) return result;

        try {
            for (let i = 0; i < instanceIds.length; i += DataService.FORCE_INFO_CHUNK_SIZE) {
                const chunk = instanceIds.slice(i, i + DataService.FORCE_INFO_CHUNK_SIZE);
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'getForceInfoBulk',
                    instanceIds: chunk,
                });
                if (!response?.data || !Array.isArray(response.data)) continue;

                for (const entry of response.data) {
                    result.set(entry.instanceId, {
                        instanceId: entry.instanceId,
                        alignment: 'friendly', // placeholder, caller should override
                        timestamp: '',          // placeholder, caller should override
                        name: entry.name,
                        type: entry.type,
                        factionId: entry.factionId,
                        bv: entry.bv,
                        pv: entry.pv,
                        forceTimestamp: entry.timestamp,
                        exists: true,
                    });
                }
            }
        } catch (err) {
            this.logger.error(`Failed to fetch force info bulk: ${err}`);
        }

        return result;
    }

    private getComparableTimestamp(timestamp: string | number | null | undefined): number {
        if (typeof timestamp === 'number') return timestamp;
        if (timestamp) return new Date(timestamp).getTime();
        return 0;
    }


    private async listForcesCloud(): Promise<LoadForceEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];
        const forces: LoadForceEntry[] = [];
        const uuid = this.userStateService.uuid();
        const payload = {
            action: 'listForces',
            uuid,
        };
        const response = await this.wsService.sendAndWaitForResponse(payload);
        if (response && Array.isArray(response.data)) {
            for (const raw of response.data as RemoteLoadForceEntry[]) {
                try {
                    forces.push(createLoadForceEntry(raw, this, { cloud: true }));
                } catch (error) {
                    this.logger.error('Failed to deserialize force: ' + error + ' ' + raw);
                }
            }
        }
        return forces;
    }

    SAVE_FORCE_CLOUD_DEBOUNCE_MS = 1000;
    // Debounce map to prevent multiple simultaneous saves for the same force
    private saveForceCloudDebounce = new Map<string, {
        timeout: ReturnType<typeof setTimeout>,
        force: Force,
        resolvers: Array<{ resolve: () => void, reject: (e: any) => void }>
    }>();

    public hasPendingCloudSaves(): boolean {
        return this.saveForceCloudDebounce && this.saveForceCloudDebounce.size > 0;
    }

    private async saveForceCloud(force: Force): Promise<void> {
        if (force.readOnly()) {
            this.logger.warn(`DataService.saveForceCloud() blocked: force "${force.name}" is read-only.`);
            return;
        }
        const instanceId = force.instanceId();
        if (!instanceId) return; // Should not happen, nothing to save without an instanceId

        return new Promise<void>((resolve, reject) => {
            const existing = this.saveForceCloudDebounce.get(instanceId);
            if (existing) {
                // clear previous timeout and replace stored force with latest
                clearTimeout(existing.timeout);
                existing.force = force;
                existing.resolvers.push({ resolve, reject });
                // reschedule
                const timeout = setTimeout(() => {
                    void this.flushSaveForceCloud(instanceId);
                }, this.SAVE_FORCE_CLOUD_DEBOUNCE_MS);
                existing.timeout = timeout;
                this.saveForceCloudDebounce.set(instanceId, existing);
            } else {
                const timeout = setTimeout(() => {
                    void this.flushSaveForceCloud(instanceId);
                }, this.SAVE_FORCE_CLOUD_DEBOUNCE_MS);
                // store/replace entry
                this.saveForceCloudDebounce.set(instanceId, {
                    timeout,
                    force,
                    resolvers: [{ resolve, reject }]
                });
            }
        });
    }

    // Flush function performs the actual cloud save for the latest Force for a given instanceId
    private async flushSaveForceCloud(instanceId: string): Promise<void> {
        const entry = this.saveForceCloudDebounce.get(instanceId);
        if (!entry) return;
        // Remove entry immediately to allow new debounces
        this.saveForceCloudDebounce.delete(instanceId);
        clearTimeout(entry.timeout);

        const { force, resolvers } = entry;

        if (force.readOnly()) {
            this.logger.warn(`DataService.flushSaveForceCloud() blocked: force "${force.name}" is read-only.`);
            for (const r of resolvers) r.resolve();
            return;
        }

        try {
            const ws = await this.canUseCloud();
            if (!ws) {
                // Nothing to do, resolve all pending promises
                for (const r of resolvers) r.resolve();
                return;
            }
            const uuid = this.userStateService.uuid();
            const payload = {
                action: 'saveForce',
                uuid,
                data: force.serialize()
            };
            const response = await this.wsService.sendAndWaitForResponse(payload);
            if (response && response.code === 'not_owner') {
                this.logger.warn('Cannot save force to cloud: not the owner.');
                // Signal that this force needs adoption (clone with fresh IDs)
                this.forceNeedsAdoption.next(force);
            }
            for (const r of resolvers) r.resolve();
        } catch (err) {
            for (const r of resolvers) r.reject(err);
        }
    }

    // Best-effort flush of all pending debounced cloud saves.
    private flushAllPendingSavesOnUnload(): void {
        if (!this.saveForceCloudDebounce || this.saveForceCloudDebounce.size === 0) return;

        const ws = this.wsService.getWebSocket();
        const canSendOverWs = ws && ws.readyState === WebSocket.OPEN;

        for (const [instanceId, entry] of Array.from(this.saveForceCloudDebounce.entries())) {
            try {
                // stop scheduled debounce
                clearTimeout(entry.timeout);
                this.saveForceCloudDebounce.delete(instanceId);

                // Skip read-only forces, they must never be saved
                if (entry.force.readOnly()) {
                    for (const r of entry.resolvers) {
                        try { r.resolve(); } catch { /* best-effort */ }
                    }
                    continue;
                }

                // try to send final payload over websocket if available (synchronous queueing)
                if (canSendOverWs) {
                    try {
                        const uuid = this.userStateService.uuid();
                        const payload = {
                            action: 'saveForce',
                            uuid,
                            data: entry.force.serialize()
                        };
                        this.wsService.send(payload);
                    } catch { /* best-effort */ }
                }

                // resolve pending promises so callers do not hang on unload
                for (const r of entry.resolvers) {
                    try { r.resolve(); } catch { /* best-effort */ }
                }
            } catch (err) {
                // ensure resolvers are resolved even on error
                for (const r of entry.resolvers) {
                    try { r.resolve(); } catch { /* best-effort */ }
                }
            }
        }
    }

    private async getForceCloud(instanceId: string, ownedOnly: boolean): Promise<any | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;
        const uuid = this.userStateService.uuid();
        const payload = {
            action: 'getForce',
            uuid,
            instanceId,
            ownedOnly,
        };
        const response = await this.wsService.sendAndWaitForResponse(payload);
        return response.data || null;
    }

    /* ----------------------------------------------------------
     * Canvas Data
     */

    public deleteCanvasDataOfUnit(unit: ForceUnit): void {
        this.dbService.deleteCanvasData(unit.id);
    }

    /* ----------------------------------------------------------
     * Force Pack Lookups (lazily built, cached globally)
     */

    /**
     * Build both force pack lookup maps on first use.
     * - forcePackToLookupKey: packName -> Set<chassis|type|subtype>
     * - lookupKeyToForcePacks: chassis|type|subtype -> sorted packName[]
     */
    private buildForcePackCaches(): void {
        this.forcePackToLookupKey = new Map();
        const reverseMap = new Map<string, Set<string>>();

        for (const pack of getForcePacks()) {
            const lookupKeys = new Set<string>();

            const processUnits = (unitList: Array<{ name: string }>) => {
                for (const pu of unitList) {
                    const unit = this.getUnitByName(pu.name);
                    if (unit) {
                        const key = getForcePackLookupKey(unit);
                        lookupKeys.add(key);
                        if (!reverseMap.has(key)) reverseMap.set(key, new Set());
                        reverseMap.get(key)!.add(pack.name);
                    }
                }
            };

            processUnits(pack.units);
            if (pack.variants) {
                for (const variant of pack.variants) {
                    processUnits(variant.units);
                }
            }

            this.forcePackToLookupKey.set(pack.name, lookupKeys);
        }

        this.lookupKeyToForcePacks = new Map();
        for (const [key, names] of reverseMap) {
            this.lookupKeyToForcePacks.set(key, Array.from(names).sort());
        }
    }

    /**
     * Check if a unit belongs to a force pack (by chassis|type|subtype).
     */
    public unitBelongsToForcePack(unit: Unit, packName: string): boolean {
        if (!this.forcePackToLookupKey) this.buildForcePackCaches();
        const lookupSet = this.forcePackToLookupKey!.get(packName);
        if (!lookupSet) return false;
        return lookupSet.has(getForcePackLookupKey(unit));
    }

    /**
     * Get the chassis|type|subtype set for a force pack (for bulk filtering).
     */
    public getForcePackLookupSet(packName: string): Set<string> | undefined {
        if (!this.forcePackToLookupKey) this.buildForcePackCaches();
        return this.forcePackToLookupKey!.get(packName);
    }

    /**
     * Get the sorted list of force pack names that contain a unit's chassis|type|subtype.
     */
    public getForcePacksForUnit(unit: Unit): string[] {
        if (!this.lookupKeyToForcePacks) this.buildForcePackCaches();
        return this.lookupKeyToForcePacks!.get(getForcePackLookupKey(unit)) ?? [];
    }

    /* ----------------------------------------------------------
     * Organizations (force org-chart layouts)
     */

    public async saveOrganization(org: SerializedOrganization): Promise<void> {
        await this.dbService.saveOrganization(org);
        this.saveOrganizationCloud(org);
    }

    public async deleteOrganization(organizationId: string): Promise<void> {
        await this.dbService.deleteOrganization(organizationId);
        const ws = await this.canUseCloud();
        if (ws) {
            this.wsService.send({
                action: 'delOrganization',
                organizationId,
            });
        }
    }

    public async listOrganizations(): Promise<LoadOrganizationEntry[]> {
        const [localOrgs, cloudOrgs] = await Promise.all([
            this.listOrganizationsLocal(),
            this.listOrganizationsCloud(),
        ]);

        const orgMap = new Map<string, LoadOrganizationEntry>();

        for (const org of localOrgs) {
            org.local = true;
            orgMap.set(org.organizationId, org);
        }

        for (const cloudOrg of cloudOrgs) {
            const existing = orgMap.get(cloudOrg.organizationId);
            cloudOrg.cloud = true;
            if (existing) {
                cloudOrg.local = true;
            }
            orgMap.set(cloudOrg.organizationId, cloudOrg);
        }

        // Push local-only orgs to cloud
        const localOnly = Array.from(orgMap.values()).filter(o => o.local && !o.cloud);
        if (localOnly.length > 0) {
            for (const entry of localOnly) {
                const serialized = await this.dbService.getOrganization(entry.organizationId);
                if (serialized) this.saveOrganizationCloud(serialized);
            }
        }

        // Save cloud orgs locally for offline access
        for (const cloudOrg of cloudOrgs) {
            const localEntry = localOrgs.find(l => l.organizationId === cloudOrg.organizationId);
            if (!localEntry || cloudOrg.timestamp > localEntry.timestamp) {
                // Fetch full org from cloud and save locally
                this.syncOrganizationFromCloud(cloudOrg.organizationId);
            }
        }

        return Array.from(orgMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    public async getOrganization(organizationId: string): Promise<LoadedOrganization | null> {
        const localPromise = this.dbService.getOrganization(organizationId);
        let cloudOrg: LoadedOrganization | null = null;

        try {
            const ws = await this.canUseCloud();
            if (ws) {
                const response = await this.wsService.sendAndWaitForResponse({
                    action: 'getOrganization',
                    organizationId,
                });
                cloudOrg = response?.data ?? null;
            }
        } catch {
            // cloud unavailable
        }

        const localOrg = await localPromise;

        if (localOrg && cloudOrg) {
            return cloudOrg.timestamp > localOrg.timestamp ? cloudOrg : localOrg;
        }
        return cloudOrg || localOrg || null;
    }

    /**
     * Find all locally-stored organizations that contain a specific force instanceId.
     */
    public async findOrganizationsForForce(instanceId: string): Promise<LoadOrganizationEntry[]> {
        const serialized = await this.dbService.listOrganizations();
        return serialized
            .filter(org => org.forces.some(f => f.instanceId === instanceId))
            .map(org => new LoadOrganizationEntry({
                organizationId: org.organizationId,
                name: org.name,
                timestamp: org.timestamp,
                factionId: org.factionId,
                forceCount: org.forces.length,
                groupCount: org.groups.length,
                local: true,
            }));
    }

    private async listOrganizationsLocal(): Promise<LoadOrganizationEntry[]> {
        const serialized = await this.dbService.listOrganizations();
        return serialized.map(org => new LoadOrganizationEntry({
            organizationId: org.organizationId,
            name: org.name,
            timestamp: org.timestamp,
            factionId: org.factionId,
            forceCount: org.forces.length,
            groupCount: org.groups.length,
            local: true,
        }));
    }

    private async listOrganizationsCloud(): Promise<LoadOrganizationEntry[]> {
        const ws = await this.canUseCloud();
        if (!ws) return [];

        const response = await this.wsService.sendAndWaitForResponse({
            action: 'listOrganizations',
        });
        if (!response?.data || !Array.isArray(response.data)) return [];

        return response.data.map((raw: any) => new LoadOrganizationEntry({
            organizationId: raw.organizationId,
            name: raw.name || '',
            timestamp: raw.timestamp,
            factionId: raw.factionId,
            forceCount: raw.forceCount ?? 0,
            groupCount: raw.groupCount ?? 0,
            cloud: true,
            owned: raw.owned ?? true,
        }));
    }

    private async saveOrganizationCloud(org: SerializedOrganization): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;
        this.wsService.send({
            action: 'saveOrganization',
            data: org,
        });
    }

    private async syncOrganizationFromCloud(organizationId: string): Promise<void> {
        try {
            const ws = await this.canUseCloud();
            if (!ws) return;
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getOrganization',
                organizationId,
            });
            if (response?.data) {
                const { owned: _owned, ...serialized } = response.data as LoadedOrganization;
                await this.dbService.saveOrganization(serialized);
            }
        } catch {
            // Silently fail — will retry on next list
        }
    }
}