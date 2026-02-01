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
import { HttpClient } from '@angular/common/http';
import { Unit, UnitComponent, Units } from '../models/units.model';
import { Faction, Factions } from '../models/factions.model';
import { Era, Eras } from '../models/eras.model';
import { DbService, TagData, SavedSearchOp, StoredSavedSearches } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';
import { ADVANCED_FILTERS, AdvFilterType, SerializedSearchFilter } from './unit-search-filters.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { Equipment, EquipmentData, EquipmentMap, RawEquipmentData, createEquipment } from '../models/equipment.model';
import { Quirk, Quirks } from '../models/quirks.model';
import { generateUUID, WsService } from './ws.service';
import { ForceUnit } from '../models/force-unit.model';
import { Force }    from '../models/force.model';
import { ASSerializedForce, CBTSerializedForce, SerializedForce, SerializedGroup, SerializedUnit } from '../models/force-serialization';
import { UnitInitializerService } from './unit-initializer.service';
import { UserStateService } from './userState.service';
import { LoadForceEntry, LoadForceGroup, LoadForceUnit } from '../models/load-force-entry.model';
import { LoggerService } from './logger.service';
import { DialogsService } from './dialogs.service';
import { firstValueFrom } from 'rxjs';
import { GameSystem, REMOTE_HOST } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import { Sourcebook, Sourcebooks } from '../models/sourcebook.model';
import { MULUnitSources, MULUnitSourcesData } from '../models/mul-unit-sources.model';
import { removeAccents } from '../utils/string.util';

/*
 * Author: Drake
 */
export const DOES_NOT_TRACK = 999;
const SHEET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

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

interface RemoteStore<T> {
    key: string;
    url: string;
    getFromLocalStorage: () => Promise<T | null>;
    putInLocalStorage: (data: T) => Promise<void>;
    preprocess?: (data: T) => T;
    postprocess?: (data: T) => T;
}
interface LocalStore {
    [key: string]: any;
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
    private http = inject(HttpClient);
    private dbService = inject(DbService);
    private wsService = inject(WsService);
    private userStateService = inject(UserStateService);
    private unitInitializer = inject(UnitInitializerService);
    private tagsService = inject(TagsService);
    private publicTagsService = inject(PublicTagsService);
    private destroyRef = inject(DestroyRef);

    isDataReady = signal(false);
    isDownloading = signal(false);
    public isCloudForceLoading = signal(false);

    private data: LocalStore = {};
    private unitNameMap = new Map<string, Unit>();
    private eraNameMap = new Map<string, Era>();
    private eraIdMap = new Map<number, Era>();
    private factionNameMap = new Map<string, Faction>();
    private unitTypeMaxStats: UnitTypeMaxStats = {};
    private quirksMap = new Map<string, Quirk>();
    private sourcebooksMap = new Map<string, Sourcebook>();
    private mulUnitSourcesMap = new Map<number, string[]>();

    public tagsVersion = signal(0);

    private readonly remoteStores: RemoteStore<any>[] = [
        {
            key: 'units',
            url: `${REMOTE_HOST}/units.json`,
            getFromLocalStorage: async () => (await this.dbService.getUnits()) ?? null,
            putInLocalStorage: async (data: Units) => this.dbService.saveUnits(data),
            preprocess: (data: Units): Units => {
                this.unitNameMap.clear();
                for (const unit of data.units) {
                    this.unitNameMap.set(unit.name, unit);
                }
                this.buildFilterIndexes(data.units); // Build all indexes
                return data;
            },
            postprocess: (data: Units): Units => {
                const eras = this.getEras();
                for (const unit of data.units) {
                    // Find era for unit.year
                    let foundEra: Era | undefined;
                    for (const era of eras) {
                        const from = era.years.from ?? Number.MIN_SAFE_INTEGER;
                        const to = era.years.to ?? Number.MAX_SAFE_INTEGER;
                        if (unit.year >= from && unit.year <= to) {
                            foundEra = era;
                            break;
                        }
                    }
                    unit._era = foundEra; // Attach era object for fast lookup

                    // Merge sources from original data and unit_sources.json
                    const originalSource = unit.source;
                    const sourcesSet = new Set<string>();

                    // Add original source(s)
                    if (Array.isArray(originalSource)) {
                        originalSource.forEach(s => sourcesSet.add(s));
                    } else if (originalSource) {
                        sourcesSet.add(originalSource);
                    }

                    // Add sources from unit_sources.json (by MUL ID)
                    const mulSources = this.mulUnitSourcesMap.get(unit.id);
                    if (mulSources) {
                        mulSources.forEach(s => sourcesSet.add(s));
                    }

                    unit.source = Array.from(sourcesSet);
                }
                this.loadUnitTags(data.units);
                return data;
            }
        },
        {
            key: 'equipment',
            url: `${REMOTE_HOST}/equipment2.json`,
            getFromLocalStorage: async () => (await this.dbService.getEquipments()) ?? null,
            putInLocalStorage: async (data: EquipmentData) => this.dbService.saveEquipment(data),
            preprocess: (data: RawEquipmentData): EquipmentData => {
                const newData: EquipmentData = {
                    version: data.version,
                    etag: data.etag,
                    equipment: {}
                };
                for (const [internalName, rawEquipment] of Object.entries(data.equipment)) {
                    try {
                        newData.equipment[internalName] = createEquipment(rawEquipment);
                    } catch (error) {
                        this.logger.error(`Failed to create equipment ${internalName}: ${error}`);
                    }
                }
                return newData;
            }
        },
        {
            key: 'quirks',
            url: `${REMOTE_HOST}/quirks.json`,
            getFromLocalStorage: async () => (await this.dbService.getQuirks()) ?? null,
            putInLocalStorage: async (data: Quirks) => this.dbService.saveQuirks(data),
            preprocess: (data: Quirks): Quirks => {
                // Quirks index
                const quirksMap = new Map<string, Quirk>();
                for (const quirk of data.quirks) {
                    quirksMap.set(quirk.name, quirk);
                }
                this.quirksMap = quirksMap;
                return data;
            }
        },
        {
            key: 'factions',
            url: `${REMOTE_HOST}/factions.json`,
            getFromLocalStorage: async () => (await this.dbService.getFactions()) ?? null,
            putInLocalStorage: async (data: Factions) => this.dbService.saveFactions(data),
            preprocess: (data: Factions): Factions => {
                this.factionNameMap.clear();
                for (const faction of data.factions) {
                    this.factionNameMap.set(faction.name, faction);
                    for (const eraId in faction.eras) {
                        faction.eras[eraId] = new Set(faction.eras[eraId]) as any; // Convert to Set for faster lookups
                    }
                }
                return data;
            }
        }, {
            key: 'eras',
            url: `${REMOTE_HOST}/eras.json`,
            getFromLocalStorage: async () => (await this.dbService.getEras()) ?? null,
            putInLocalStorage: async (data: Eras) => this.dbService.saveEras(data),
            preprocess: (data: Eras): Eras => {
                this.eraNameMap.clear();
                this.eraIdMap.clear();
                for (const era of data.eras) {
                    this.eraNameMap.set(era.name, era);
                    this.eraIdMap.set(era.id, era);
                    era.factions = new Set(era.factions) as any; // Convert to Set for faster lookups
                    era.units = new Set(era.units) as any; // Convert to Set for faster lookups
                }
                return data;
            }
        }, {
            key: 'units_sources',
            url: `${REMOTE_HOST}/units_sources.json`,
            getFromLocalStorage: async () => (await this.dbService.getMULUnitSources()) ?? null,
            putInLocalStorage: async (data: MULUnitSources) => this.dbService.saveMULUnitSources(data),
            preprocess: (data: MULUnitSources | MULUnitSourcesData): MULUnitSources => {
                // Handle both raw object format (from JSON file) and wrapped format (from IndexedDB)
                let sources: MULUnitSourcesData;
                if ('sources' in data && 'etag' in data && typeof data.sources === 'object' && !Array.isArray(data.sources)) {
                    sources = data.sources as MULUnitSourcesData;
                } else {
                    sources = data as MULUnitSourcesData;
                }
                this.mulUnitSourcesMap.clear();
                for (const [mulIdStr, sourceAbbrevs] of Object.entries(sources)) {
                    const mulId = parseInt(mulIdStr, 10);
                    if (!isNaN(mulId)) {
                        const filteredAbbrevs = sourceAbbrevs.filter(abbrev => abbrev !== 'None');
                        if (filteredAbbrevs.length > 0) {
                            this.mulUnitSourcesMap.set(mulId, filteredAbbrevs);
                        }
                    }
                }
                return {
                    etag: (data as any).etag || '',
                    sources
                };
            }
        },
        {
            key: 'sourcebooks',
            url: 'assets/sourcebooks.json',
            getFromLocalStorage: async () => (await this.dbService.getSourcebooks()) ?? null,
            putInLocalStorage: async (data: Sourcebooks) => this.dbService.saveSourcebooks(data),
            preprocess: (data: Sourcebooks | Sourcebook[]): Sourcebooks => {
                // Handle both array format (from JSON file) and wrapped format (from IndexedDB)
                let sourcebooks: Sourcebook[];
                if (Array.isArray(data)) {
                    sourcebooks = data;
                } else {
                    sourcebooks = data.sourcebooks;
                }
                this.sourcebooksMap.clear();
                for (const sb of sourcebooks) {
                    this.sourcebooksMap.set(sb.abbrev, sb);
                }
                return {
                    etag: (data as any).etag || '',
                    sourcebooks
                };
            }
        },
    ];


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
        const tags = tagData?.tags || {};

        for (const unit of this.getUnits()) {
            const chassisKey = DataService.getChassisTagKey(unit);
            
            // V3 format: find all tags that have this unit in their units map
            unit._nameTags = Object.values(tags)
                .filter(entry => entry.units[unit.name] !== undefined)
                .map(entry => entry.label);
            
            // V3 format: find all tags that have this chassis in their chassis map
            unit._chassisTags = Object.values(tags)
                .filter(entry => entry.chassis[chassisKey] !== undefined)
                .map(entry => entry.label);
        }
        this.tagsVersion.set(this.tagsVersion() + 1);
    }

    /**
     * Apply public tags to all loaded units.
     * Called by PublicTagsService when public tags change (import/subscribe/update).
     */
    private applyPublicTagsToUnits(): void {
        for (const unit of this.getUnits()) {
            unit._publicTags = this.publicTagsService.getPublicTagsForUnit(unit);
        }
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
     * Generates the chassis tag key for a unit.
     * Format: `${chassis}|${type}` to uniquely identify a chassis across types.
     */
    public static getChassisTagKey(unit: Unit): string {
        return TagsService.getChassisTagKey(unit);
    }

    /**
     * Load tags from storage and apply them to units.
     * Uses TagsService for cached data.
     */
    private async loadUnitTags(units: Unit[]): Promise<void> {
        const tagData = await this.tagsService.getTagData();
        this.applyTagDataToUnits(tagData);
    }

    private formatUnitType(type: string): string {
        if (type === 'Handheld Weapon') {
            return 'Weapon';
        }
        return type;
    }

    public static removeAccents(str: string): string {
        return removeAccents(str);
    }

    public getUnits(): Unit[] {
        return (this.data['units'] as Units)?.units ?? [];
    }

    public getUnitByName(name: string): Unit | undefined {
        return this.unitNameMap.get(name);
    }

    public getEquipments(): EquipmentMap {
        return (this.data['equipment'] as EquipmentData)?.equipment ?? {};
    }

    public getEquipmentByName(internalName: string): Equipment | undefined {
        return (this.data['equipment'] as EquipmentData)?.equipment[internalName];
    }

    public getFactions(): Faction[] {
        return (this.data['factions'] as Factions)?.factions ?? [];
    }

    public getFactionByName(name: string): Faction | undefined {
        return this.factionNameMap.get(name);
    }

    public getEras(): Era[] {
        return (this.data['eras'] as Eras)?.eras ?? [];
    }

    public getEraByName(name: string): Era | undefined {
        return this.eraNameMap.get(name);
    }

    public getEraById(id: number): Era | undefined {
        return this.eraIdMap.get(id);
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirksMap.get(name);
    }

    public getSourcebookByAbbrev(abbrev: string): Sourcebook | undefined {
        return this.sourcebooksMap.get(abbrev);
    }

    /**
     * Get the display title for a sourcebook abbreviation.
     * Falls back to the abbreviation itself if not found.
     */
    public getSourcebookTitle(abbrev: string): string {
        return this.sourcebooksMap.get(abbrev)?.title ?? abbrev;
    }

    /**
     * Get the sourcebook abbreviations for a unit by its MUL ID.
     * @param mulId The Master Unit List ID of the unit
     * @returns Array of sourcebook abbreviations, or undefined if not found
     */
    public getUnitSourcesByMulId(mulId: number): string[] | undefined {
        return this.mulUnitSourcesMap.get(mulId);
    }

    private sumWeaponDamageNoPhysical(unit: Unit, components: UnitComponent[], ignoreOneshots: boolean = false): number {
        let sum = 0;
        for (const weapon of components) {
            if (ignoreOneshots && weapon.os && weapon.os > 0) {
                continue; // Skip oneshots
            }
            if ((weapon.md) && (weapon.t !== 'P')) {
                let maxDamage = weapon.md ? parseFloat(weapon.md) || 0 : 0;
                // Multiply by internal units for Battle Armor (except SSW and position is not on a specific soldier (p < 1))
                if (unit.subtype === 'Battle Armor' && weapon.l !== 'SSW' && weapon.p < 1) {
                    maxDamage *= unit.internal;
                }
                sum += maxDamage * (weapon.q || 1);
            }
            if (weapon.bay && Array.isArray(weapon.bay)) {
                sum += this.sumWeaponDamageNoPhysical(unit, weapon.bay, ignoreOneshots);
            }
        }
        return Math.round(sum);
    }

    private weaponsMaxRange(unit: Unit, components: UnitComponent[]): number {
        let maxRange = 0;
        for (const weapon of components) {
            if (weapon.r) {
                const rangeParts = weapon.r.split('/');
                const weaponMaxRange = Math.max(...rangeParts.map(r => parseInt(r, 10) || 0));
                maxRange = Math.max(maxRange, weaponMaxRange);
            }
        }
        return maxRange;
    }

    private buildFilterIndexes(units: Unit[]) {
        const statsByType: {
            [type: string]: {
                armor: [number, number],
                internal: [number, number],
                heat: [number, number],
                dissipation: [number, number],
                dissipationEfficiency: [number, number],
                runMP: [number, number],
                run2MP: [number, number],
                jumpMP: [number, number],
                umuMP: [number, number],
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
        } = {};
        
        const updateMinMax = (minMax: [number, number], value: number): void => {
            if (value < minMax[0]) minMax[0] = value;
            if (value > minMax[1]) minMax[1] = value;
        };

        for (const unit of units) {
            // Combine chassis + model into single search key to save memory
            const chassis = DataService.removeAccents(unit.chassis?.toLowerCase() || '');
            const model = DataService.removeAccents(unit.model?.toLowerCase() || '');
            unit._searchKey = `${chassis} ${model}`;
            unit._displayType = this.formatUnitType(unit.type);
            unit._mdSumNoPhysical = unit.comp ? this.sumWeaponDamageNoPhysical(unit, unit.comp) : 0;
            unit._mdSumNoPhysicalNoOneshots = unit.comp ? this.sumWeaponDamageNoPhysical(unit, unit.comp, true) : 0;
            unit._maxRange = unit.comp ? this.weaponsMaxRange(unit, unit.comp) : 0;
            unit._dissipationEfficiency = (unit.heat && unit.dissipation) ? unit.dissipation - unit.heat : 0;
            if (unit.as) {
                if (unit.as.dmg) {
                    unit.as.dmg._dmgS = parseFloat(unit.as.dmg.dmgS) || 0;
                    unit.as.dmg._dmgM = parseFloat(unit.as.dmg.dmgM) || 0;
                    unit.as.dmg._dmgL = parseFloat(unit.as.dmg.dmgL) || 0;
                    unit.as.dmg._dmgE = parseFloat(unit.as.dmg.dmgE) || 0;
                }
                // Normalize MVm: if a Mek only has jump movement, treat it as also having standard movement
                if (unit.type === 'Mek' && unit.as.MVm) {
                    const mvmKeys = Object.keys(unit.as.MVm);
                    if (mvmKeys.length === 1 && mvmKeys[0] === 'j') {
                        unit.as.MVm[''] = unit.as.MVm['j'];
                    }
                }
            }
            if (unit.comp) {
                if (unit.armorType) {
                    let armorName = unit.armorType;
                    if (!armorName.endsWith(' Armor')) {
                        armorName += ' Armor';
                    }
                    const armorType: UnitComponent = { q: 1, n: armorName, id: armorName, l: 'Armor', t: 'HIDDEN', p: -1 };
                    unit.comp.push(armorType);
                }
                if (unit.structureType) {
                    let structureName = unit.structureType;
                    if (!structureName.endsWith(' Structure')) {
                        structureName += ' Structure';
                    }
                    const structureType: UnitComponent = { q: 1, n: structureName, id: structureName, l: 'Structure', t: 'HIDDEN', p: -1 };
                    unit.comp.push(structureType);
                }
                if (unit.engine) {
                    let engineName = unit.engine;
                    if (!engineName.endsWith(' Engine')) {
                        engineName += ' Engine';
                    }
                    const engineType: UnitComponent = { q: 1, n: engineName, id: engineName, l: 'Engine', t: 'HIDDEN', p: -1 };
                    unit.comp.push(engineType);
                }
            }

            const t = unit.type;
            if (!statsByType[t]) {
                statsByType[t] = {
                    armor: [Infinity, -Infinity],
                    internal: [Infinity, -Infinity],
                    heat: [Infinity, -Infinity],
                    dissipation: [Infinity, -Infinity],
                    dissipationEfficiency: [Infinity, -Infinity],
                    runMP: [Infinity, -Infinity],
                    run2MP: [Infinity, -Infinity],
                    jumpMP: [Infinity, -Infinity],
                    umuMP: [Infinity, -Infinity],
                    alphaNoPhysical: [Infinity, -Infinity],
                    alphaNoPhysicalNoOneshots: [Infinity, -Infinity],
                    maxRange: [Infinity, -Infinity],
                    dpt: [Infinity, -Infinity],
                    // Capital ships
                    dropshipCapacity: [Infinity, -Infinity],
                    escapePods: [Infinity, -Infinity],
                    lifeBoats: [Infinity, -Infinity],
                    sailIntegrity: [Infinity, -Infinity],
                    kfIntegrity: [Infinity, -Infinity],
                };
            }
            const s = statsByType[t];
            updateMinMax(s.armor, unit.armor || 0);
            updateMinMax(s.internal, unit.internal || 0);
            updateMinMax(s.heat, unit.heat || 0);
            updateMinMax(s.dissipation, unit.dissipation || 0);
            updateMinMax(s.dissipationEfficiency, unit._dissipationEfficiency || 0);
            updateMinMax(s.runMP, unit.run || 0);
            updateMinMax(s.run2MP, unit.run2 || 0);
            updateMinMax(s.jumpMP, unit.jump || 0);
            updateMinMax(s.umuMP, unit.umu || 0);
            updateMinMax(s.alphaNoPhysical, unit._mdSumNoPhysical || 0);
            updateMinMax(s.alphaNoPhysicalNoOneshots, unit._mdSumNoPhysicalNoOneshots || 0);
            updateMinMax(s.maxRange, unit._maxRange || 0);
            updateMinMax(s.dpt, unit.dpt || 0);
            // Capital ships
            if (unit.capital) {
                updateMinMax(s.dropshipCapacity, unit.capital.dropshipCapacity || 0);
                updateMinMax(s.escapePods, unit.capital.escapePods || 0);
                updateMinMax(s.lifeBoats, unit.capital.lifeBoats || 0);
                updateMinMax(s.sailIntegrity, unit.capital.sailIntegrity || 0);
                updateMinMax(s.kfIntegrity, unit.capital.kfIntegrity || 0);
            }
        }

        // Helper to normalize Infinity values to 0 (when no units of that type exist)
        const normalize = (minMax: [number, number]): [number, number] => [
            minMax[0] === Infinity ? 0 : Math.min(minMax[0], 0),
            minMax[1] === -Infinity ? 0 : Math.max(minMax[1], 0)
        ];
        
        for (const [type, stats] of Object.entries(statsByType)) {
            this.unitTypeMaxStats[type] = {
                armor: normalize(stats.armor),
                internal: normalize(stats.internal),
                heat: normalize(stats.heat),
                dissipation: normalize(stats.dissipation),
                dissipationEfficiency: normalize(stats.dissipationEfficiency),
                runMP: normalize(stats.runMP),
                run2MP: normalize(stats.run2MP),
                jumpMP: normalize(stats.jumpMP),
                umuMP: normalize(stats.umuMP),
                alphaNoPhysical: normalize(stats.alphaNoPhysical),
                alphaNoPhysicalNoOneshots: normalize(stats.alphaNoPhysicalNoOneshots),
                maxRange: normalize(stats.maxRange),
                dpt: normalize(stats.dpt),
                // Capital ships
                dropshipCapacity: normalize(stats.dropshipCapacity),
                escapePods: normalize(stats.escapePods),
                lifeBoats: normalize(stats.lifeBoats),
                sailIntegrity: normalize(stats.sailIntegrity),
                kfIntegrity: normalize(stats.kfIntegrity),
            };
        }
    }

    public getUnitTypeMaxStats(type: string): MinMaxStatsRange {
        return this.unitTypeMaxStats[type] || {
            armor: [0, 0],
            internal: [0, 0],
            heat: [0, 0],
            dissipation: [0, 0],
            dissipationEfficiency: [0, 0],
            runMP: [0, 0],
            run2MP: [0, 0],
            umuMP: [0, 0],
            jumpMP: [0, 0],
            alphaNoPhysical: [0, 0],
            alphaNoPhysicalNoOneshots: [0, 0],
            maxRange: [0, 0],
            dpt: [0, 0],
            // Capital ships
            dropshipCapacity: [0, 0],
            escapePods: [0, 0],
            lifeBoats: [0, 0],
            sailIntegrity: [0, 0],
            kfIntegrity: [0, 0],
            gravDecks: [0, 0],
        };
    }

    private async getRemoteETag(url: string): Promise<string> {
        if (!navigator.onLine) {
            return '';
        }
        try {
            const resp = await firstValueFrom(
                this.http.head(url, { observe: 'response' as const })
            );
            const etag = resp.headers.get('ETag') || '';
            return etag;
        } catch (err: any) {
            this.logger.warn(`Failed to fetch ETag via HttpClient HEAD for ${url}: ${err.message ?? err}`);
            return '';
        }
    }

    private postprocessData(): void {
        for (const store of this.remoteStores) {
            const storeData = this.data[store.key as keyof LocalStore];
            if (storeData && store.postprocess) {
                this.data[store.key as keyof LocalStore] = store.postprocess(storeData);
            }
        }
        this.linkEquipmentToUnits();
    }

    /**
     * Link equipment objects to unit components so methods like .eq.hasFlag() work.
     */
    private linkEquipmentToUnits(): void {
        const units = this.getUnits();
        const equipment = this.getEquipments();
        for (const unit of units) {
            if (!unit.comp) continue;
            this.linkEquipmentToComponents(unit.comp, equipment);
        }
    }

    private linkEquipmentToComponents(components: UnitComponent[], equipment: EquipmentMap): void {
        for (const comp of components) {
            if (comp.id && !comp.eq) {
                comp.eq = equipment[comp.id];
            }
            if (comp.bay) {
                this.linkEquipmentToComponents(comp.bay, equipment);
            }
        }
    }

    private async checkForUpdate(): Promise<void> {
        try {
            const updatePromises = this.remoteStores.map(async (store) => {
                let localData = this.data[store.key as keyof LocalStore];
                if (!localData) {
                    localData = await store.getFromLocalStorage();
                    if (localData && store.preprocess) {
                        localData = store.preprocess(localData);
                    }
                }
                const etag = await this.getRemoteETag(store.url);
                // If offline/error (empty etag), use local data if available, otherwise fetch
                if (!etag) {
                    if (localData) {
                        this.data[store.key as keyof LocalStore] = localData;
                        this.logger.info(`${store.key} loaded from cache (offline or remote unavailable).`);
                        return;
                    }
                    // No cached data and no etag, try to fetch anyway
                    await this.fetchFromRemote(store);
                    return;
                }
                if (localData && localData.etag === etag) {
                    this.data[store.key as keyof LocalStore] = localData;
                    this.logger.info(`${store.key} is up to date. (ETag: ${etag})`);
                    return;
                }
                await this.fetchFromRemote(store);
            });
            await Promise.all(updatePromises);
            this.postprocessData();
        } finally {
            this.isDownloading.set(false);
        }
    }

    public async initialize(): Promise<void> {
        this.isDataReady.set(false);
        this.logger.info('Initializing data service...');
        await this.dbService.waitForDbReady();
        this.logger.info('Database is ready, checking for updates...');
        try {
            await this.checkForUpdate();
            this.logger.info('All data stores are ready.');
            // Apply public tags to units now that data is ready
            // (PublicTagsService.initialize() may have loaded cached tags before units were ready)
            this.applyPublicTagsToUnits();
            this.isDataReady.set(true);
        } catch (error) {
            this.logger.error('Failed to initialize data: ' + error);
            // Check if we have any data loaded despite the error
            const hasData = this.remoteStores.every(store => !!this.data[store.key as keyof LocalStore]);
            if (hasData) {
                // Apply public tags even on partial load
                this.applyPublicTagsToUnits();
            }
            this.isDataReady.set(hasData);
        } finally {
            this.isDownloading.set(false);
        }
    }

    private async fetchFromRemote<T extends object>(remoteStore: RemoteStore<T>): Promise<void> {
        this.isDownloading.set(true);
        this.logger.info(`Downloading ${remoteStore.key}...`);
        try {
            const response = await firstValueFrom(
                this.http.get<T>(remoteStore.url, {
                    reportProgress: false,
                    observe: 'response',
                })
            );
            const etag = response.headers.get('ETag') || generateUUID(); // Fallback to random UUID if no ETag
            const data = response.body;
            if (!data) {
                throw new Error(`No body received for ${remoteStore.key}`);
            }
            (data as any).etag = etag;
            let processedData = data;
            if (remoteStore.preprocess) {
                processedData = remoteStore.preprocess(data);
            }
            this.data[remoteStore.key as keyof LocalStore] = processedData;
            await remoteStore.putInLocalStorage(data); // Save original data with etag
            this.logger.info(`${remoteStore.key} updated. (ETag: ${etag})`);
        } catch (err: any) {
            this.logger.error(`Failed to download ${remoteStore.key}: ` + (err.message ?? err));
            throw err;
        }
    }

    public async getSheet(sheetFileName: string): Promise<SVGSVGElement> {
        const meta = await this.dbService.getSheetMeta(sheetFileName);
        const now = Date.now();
        const isFresh = meta && (now - meta.timestamp) < SHEET_CACHE_MAX_AGE_MS;

        // If cache is fresh, use it without checking remote
        if (isFresh) {
            const sheet = await this.dbService.getSheet(sheetFileName);
            if (sheet) {
                this.logger.info(`Sheet ${sheetFileName} loaded from cache (fresh).`);
                return sheet;
            }
        }

        // Cache is stale or missing - check remote ETag
        const remoteEtag = await this.getRemoteETag(`${REMOTE_HOST}/sheets/${sheetFileName}`);

        // If offline or same ETag, use cached version and refresh timestamp
        if (meta && (!remoteEtag || meta.etag === remoteEtag)) {
            const sheet = await this.dbService.getSheet(sheetFileName);
            if (sheet) {
                if (remoteEtag) {
                    // ETag matched, refresh timestamp so we don't check again for SHEET_CACHE_MAX_AGE_MS
                    this.dbService.touchSheet(sheetFileName);
                }
                this.logger.info(`Sheet ${sheetFileName} loaded from cache (validated).`);
                return sheet;
            }
        }

        // Fetch fresh copy from remote
        return this.fetchAndCacheSheet(sheetFileName);
    }

    private async fetchAndCacheSheet(sheetFileName: string): Promise<SVGSVGElement> {
        this.logger.info(`Fetching sheet: ${sheetFileName}`);
        const src = `${REMOTE_HOST}/sheets/${sheetFileName}`;

        try {
            const response = await firstValueFrom(
                this.http.get(src, {
                    reportProgress: false,
                    observe: 'response' as const,
                    responseType: 'text' as const,
                })
            );
            const etag = response.headers.get('ETag') || generateUUID(); // Fallback to random UUID if no ETag
            const svgText = response.body;
            if (!svgText) {
                throw new Error(`No body received for sheet ${sheetFileName}`);
            }

            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');

            if (svgDoc.getElementsByTagName('parsererror').length) {
                throw new Error('Failed to parse SVG');
            }

            const svgElement = svgDoc.documentElement as unknown as SVGSVGElement;
            if (!svgElement) {
                throw new Error('Invalid SVG content: Failed to find the SVG root element after parsing.');
            }

            RsPolyfillUtil.fixSvg(svgElement);
            await this.dbService.saveSheet(sheetFileName, svgElement, etag);
            this.logger.info(`Sheet ${sheetFileName} fetched and cached.`);
            return svgElement;
        } catch (err) {
            this.logger.error(`Failed to download sheet ${sheetFileName}: ` + err);
            throw err;
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
            return this.isCloudNewer(localRaw, cloudRaw) ? cloud : local;
        }
        if (!triedCloud && local) return local;
        return cloud || local || null;
    }

    public async saveForce(force: Force, localOnly: boolean = false): Promise<void> {
        if (!force.instanceId() || !force.owned()) {
            force.instanceId.set(generateUUID());
            force.owned.set(true);
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
        const localForces = await this.dbService.listForces(this, this.unitInitializer, this.injector);
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
            for (const raw of response.data as SerializedForce[]) {
                try {
                    const groups: LoadForceGroup[] = [];
                    if (raw.groups && Array.isArray(raw.groups)) {
                        for (const group of raw.groups as SerializedGroup[]) {
                            const loadGroup: LoadForceGroup = {
                                name: group.name,
                                units: []
                            };
                            for (const unit of group.units as SerializedUnit[]) {
                                const loadUnit: LoadForceUnit = {
                                    unit: this.getUnitByName(unit.unit),
                                    alias: unit.alias,
                                    destroyed: unit.state.destroyed ?? false
                                };
                                loadGroup.units.push(loadUnit);
                            }
                            groups.push(loadGroup);
                        }
                    }
                    const entry: LoadForceEntry = new LoadForceEntry({
                        cloud: true,
                        instanceId: raw.instanceId,
                        name: raw.name,
                        type: raw.type,
                        bv: raw.bv ?? undefined,
                        pv: raw.pv ?? undefined,
                        timestamp: raw.timestamp,
                        groups: groups
                    });
                    forces.push(entry);
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
                this.logger.warn('Cannot save force to cloud: not the owner, we regenerated a new instanceId.');
                const oldInstanceId = force.instanceId();
                force.instanceId.set(generateUUID());
                force.owned.set(true);
                // Save again (this will schedule another debounce for the new instanceId)
                await this.saveForce(force);
                if (oldInstanceId) {
                    this.dbService.deleteForce(oldInstanceId); // Clean up old local copy
                }
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
     * Tags (delegated to TagsService)
     */

    /**
     * Add or remove a tag from units, with support for chassis-wide tagging.
     * Delegates to TagsService.
     */
    public async modifyTag(
        units: Unit[], 
        tag: string, 
        tagType: 'name' | 'chassis',
        action: 'add' | 'remove'
    ): Promise<void> {
        return this.tagsService.modifyTag(units, tag, tagType, action);
    }

    /**
     * Remove a tag from units. Removes from both name and chassis tags.
     * Delegates to TagsService.
     */
    public async removeTagFromUnits(units: Unit[], tag: string): Promise<void> {
        return this.tagsService.removeTagFromUnits(units, tag);
    }

    /**
     * Check if a tag exists in a specific collection (case-insensitive).
     * @returns The actual tag name if it exists (with original case), or null if not found
     */
    public async tagExists(tag: string, tagType: 'name' | 'chassis'): Promise<string | null> {
        return this.tagsService.tagExists(tag, tagType);
    }

    /**
     * Check if a tag ID exists at all (regardless of collection).
     * @returns The actual tag name if it exists (with original case), or null if not found
     */
    public async tagIdExists(tag: string): Promise<string | null> {
        return this.tagsService.tagIdExists(tag);
    }

    /**
     * Rename a tag (including case-only changes).
     * If merge is true and target exists, merges BOTH collections (units + chassis) into target.
     * Delegates to TagsService.
     * @returns 'success', 'not-found', or 'conflict'
     */
    public async renameTag(
        oldTag: string, 
        newTag: string, 
        merge: boolean = false
    ): Promise<'success' | 'not-found' | 'conflict'> {
        return this.tagsService.renameTag(oldTag, newTag, merge);
    }

    /**
     * Check if a tag is assigned at the chassis level for any of the given units.
     * Delegates to TagsService.
     */
    public async isChassisTag(units: Unit[], tag: string): Promise<boolean> {
        return this.tagsService.isChassisTag(units, tag);
    }

    /**
     * Get the tag type for a specific tag on a unit.
     * Delegates to TagsService.
     */
    public async getTagType(unit: Unit, tag: string): Promise<'chassis' | 'name' | null> {
        return this.tagsService.getTagType(unit, tag);
    }

    /**
     * Fetch tags from cloud and merge with local if needed.
     * Delegates to TagsService.
     */
    public async syncTagsFromCloud(): Promise<void> {
        return this.tagsService.syncFromCloud();
    }

    /* ----------------------------------------------------------
     * Saved Searches (Tactical Bookmarks)
     */

    /** Cached saved searches for quick access */
    private cachedSavedSearches: StoredSavedSearches | null = null;
    public savedSearchesVersion = signal(0);

    /**
     * Get all saved searches for a specific game system.
     */
    public async getSavedSearches(gameSystem: 'cbt' | 'as'): Promise<SerializedSearchFilter[]> {
        if (!this.cachedSavedSearches) {
            this.cachedSavedSearches = await this.dbService.getSavedSearches() ?? {};
        }
        return Object.values(this.cachedSavedSearches)
            .filter(s => s.gameSystem === gameSystem)
            .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    }

    /**
     * Save a new search or update an existing one.
     */
    public async saveSearch(search: SerializedSearchFilter): Promise<void> {
        if (!this.cachedSavedSearches) {
            this.cachedSavedSearches = await this.dbService.getSavedSearches() ?? {};
        }
        
        this.cachedSavedSearches[search.id] = search;
        
        const op: SavedSearchOp = {
            id: search.id,
            a: 1, // add/update
            data: search,
            ts: Date.now()
        };
        
        await this.dbService.appendSavedSearchOps([op], this.cachedSavedSearches);
        this.savedSearchesVersion.update(v => v + 1);
        
        // Sync to cloud
        this.syncSavedSearchesToCloud();
    }

    /**
     * Delete a saved search by ID.
     */
    public async deleteSearch(id: string): Promise<void> {
        if (!this.cachedSavedSearches) {
            this.cachedSavedSearches = await this.dbService.getSavedSearches() ?? {};
        }
        
        if (!this.cachedSavedSearches[id]) return;
        
        delete this.cachedSavedSearches[id];
        
        const op: SavedSearchOp = {
            id,
            a: 0, // delete
            ts: Date.now()
        };
        
        await this.dbService.appendSavedSearchOps([op], this.cachedSavedSearches);
        this.savedSearchesVersion.update(v => v + 1);
        
        // Sync to cloud
        this.syncSavedSearchesToCloud();
    }

    /**
     * Rename a saved search.
     */
    public async renameSearch(id: string, newName: string): Promise<void> {
        if (!this.cachedSavedSearches) {
            this.cachedSavedSearches = await this.dbService.getSavedSearches() ?? {};
        }
        
        const search = this.cachedSavedSearches[id];
        if (!search) return;
        
        search.name = newName;
        search.timestamp = Date.now();
        
        await this.saveSearch(search);
    }

    /**
     * Sync saved searches to cloud.
     */
    private async syncSavedSearchesToCloud(): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;

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
                await this.dbService.clearPendingSavedSearchOps(response.serverTs ?? Date.now());
            }
        } catch (err) {
            this.logger.error('Failed to sync saved searches to cloud: ' + err);
        }
    }

    /**
     * Sync saved searches from cloud on login/reconnect.
     */
    public async syncSavedSearchesFromCloud(): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        try {
            const syncState = await this.dbService.getSavedSearchSyncState();
            const hasPendingOps = syncState.pendingOps.length > 0;

            const response = await this.wsService.sendAndWaitForResponse({
                action: 'getSavedSearches',
                uuid,
                since: syncState.lastSyncTs
            });

            if (!response || response.action === 'error') return;

            const serverTs: number = response.serverTs ?? 0;

            // Apply cloud state
            if (response.searches) {
                // Merge cloud searches with local
                if (!this.cachedSavedSearches) {
                    this.cachedSavedSearches = await this.dbService.getSavedSearches() ?? {};
                }

                // Apply cloud searches (cloud wins for conflicts unless we have pending ops)
                for (const [id, search] of Object.entries(response.searches as StoredSavedSearches)) {
                    const localSearch = this.cachedSavedSearches[id];
                    const hasPendingForThis = hasPendingOps && syncState.pendingOps.some(op => op.id === id);
                    
                    if (!localSearch || (!hasPendingForThis && (search.timestamp ?? 0) >= (localSearch.timestamp ?? 0))) {
                        this.cachedSavedSearches[id] = search;
                    }
                }

                // Handle deletions from cloud
                if (response.deletedIds && Array.isArray(response.deletedIds)) {
                    for (const id of response.deletedIds) {
                        const hasPendingForThis = hasPendingOps && syncState.pendingOps.some(op => op.id === id);
                        if (!hasPendingForThis) {
                            delete this.cachedSavedSearches[id];
                        }
                    }
                }

                await this.dbService.saveAllSavedSearchData(this.cachedSavedSearches, serverTs);
                this.savedSearchesVersion.update(v => v + 1);
            }

            // Push pending ops if any
            if (hasPendingOps) {
                await this.syncSavedSearchesToCloud();
            }
        } catch (err) {
            this.logger.error('Failed to sync saved searches from cloud: ' + err);
        }
    }

    /**
     * Handle remote saved search updates from other sessions.
     */
    public async handleRemoteSavedSearchOps(ops: SavedSearchOp[]): Promise<void> {
        if (!ops || ops.length === 0) return;

        if (!this.cachedSavedSearches) {
            this.cachedSavedSearches = await this.dbService.getSavedSearches() ?? {};
        }

        for (const op of ops) {
            if (op.a === 1 && op.data) {
                this.cachedSavedSearches[op.id] = op.data;
            } else if (op.a === 0) {
                delete this.cachedSavedSearches[op.id];
            }
        }

        await this.dbService.saveSavedSearches(this.cachedSavedSearches);
        this.savedSearchesVersion.update(v => v + 1);
    }

    /**
     * Link equipment data to loaded units.
     */

    /* ----------------------------------------------------------
     * Canvas Data
     */

    public deleteCanvasDataOfUnit(unit: ForceUnit): void {
        this.dbService.deleteCanvasData(unit.id);
    }

}