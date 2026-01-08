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

import { Injectable, signal, Injector, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Unit, UnitComponent, Units } from '../models/units.model';
import { Faction, Factions } from '../models/factions.model';
import { Era, Eras } from '../models/eras.model';
import { DbService, StoredTags, StoredChassisTags, TagData, TagOp, TagSyncState } from './db.service';
import { ADVANCED_FILTERS, AdvFilterType, SerializedSearchFilter } from './unit-search-filters.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { AmmoEquipment, Equipment, EquipmentData, EquipmentUnitType, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
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
    private dialogsService = inject(DialogsService);
    private broadcast?: BroadcastChannel;
    private injector = inject(Injector);
    private http = inject(HttpClient);
    private dbService = inject(DbService);
    private wsService = inject(WsService);
    private userStateService = inject(UserStateService);
    private unitInitializer = inject(UnitInitializerService);

    isDataReady = signal(false);
    isDownloading = signal(false);
    public isCloudForceLoading = signal(false);

    private data: LocalStore = {};
    private unitNameMap = new Map<string, Unit>();
    private eraNameMap = new Map<string, Era>();
    private eraIdMap = new Map<number, Era>();
    private factionNameMap = new Map<string, Faction>();
    public filterIndexes: Record<string, Map<string | number, Set<number>>> = {};
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
            url: `${REMOTE_HOST}/equipment.json`,
            getFromLocalStorage: async () => (await this.dbService.getEquipment()) ?? null,
            putInLocalStorage: async (data: EquipmentData) => this.dbService.saveEquipment(data),
            preprocess: (data: EquipmentData): EquipmentData => {
                const newData: EquipmentData = {
                    version: data.version,
                    etag: data.etag,
                    equipment: {}
                };
                for (const [unitType, equipmentForType] of Object.entries(data.equipment)) {
                    newData.equipment[unitType] = {};

                    for (const [equipmentInternalName, equipmentData] of Object.entries(equipmentForType)) {
                        try {
                            const equipment = equipmentData as any;

                            switch (equipment.type) {
                                case 'weapon':
                                    newData.equipment[unitType][equipmentInternalName] = new WeaponEquipment(equipment);
                                    break;
                                case 'ammo':
                                    newData.equipment[unitType][equipmentInternalName] = new AmmoEquipment(equipment);
                                    break;
                                case 'misc':
                                    newData.equipment[unitType][equipmentInternalName] = new MiscEquipment(equipment);
                                    break;
                                default:
                                    this.logger.warn(`Unknown equipment type for ${equipmentInternalName}: ${equipment.type}`);
                                    newData.equipment[unitType][equipmentInternalName] = new Equipment({
                                        ...equipment,
                                        internalName: equipmentInternalName,
                                        name: equipment.name || equipmentInternalName,
                                        type: equipment.type || 'misc'
                                    });
                            }
                        } catch (error) {
                            this.logger.error(`Failed to create equipment ${equipmentInternalName}: ${error}`);
                        }
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
                        this.mulUnitSourcesMap.set(mulId, sourceAbbrevs);
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

                this.broadcast.addEventListener('message', (ev) => {
                    void this.handleStoreUpdate(ev.data as any);
                });
            };
        } catch { /* best-effort */ }
        if (typeof window !== 'undefined') {
            const flushOnUnload = () => {
                try {
                    this.flushAllPendingSavesOnUnload();
                } catch { /* best-effort */ }
            };
            window.addEventListener('beforeunload', flushOnUnload);
            window.addEventListener('pagehide', flushOnUnload);
            // also try when visibility becomes hidden (mobile browsers)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    flushOnUnload();
                }
            });

            // Handle network online event to sync tags from cloud
            window.addEventListener('online', () => {
                // Small delay to let WS reconnect first
                setTimeout(() => this.syncTagsFromCloud(), 1000);
            });
        }

        // Register WS message handlers for tag sync
        this.setupTagSyncHandlers();
    }

    /**
     * Set up WebSocket handlers for tag synchronization.
     */
    private setupTagSyncHandlers(): void {
        // Handle remote tag operations from other sessions of the same user
        this.wsService.registerMessageHandler('tagOps', async (msg) => {
            if (msg.ops) {
                await this.handleRemoteTagOps(msg.ops);
            }
        });

        // Handle state reset notification - another session did a full state replacement
        this.wsService.registerMessageHandler('tagStateReset', async (msg) => {
            // Clear our pending ops and re-sync from server
            await this.dbService.clearPendingTagOps(0); // Reset lastSyncTs to force full sync
            await this.syncTagsFromCloud();
        });

        // Legacy handler for backwards compatibility during migration
        this.wsService.registerMessageHandler('updatedTags', async (msg) => {
            if (msg.data) {
                await this.handleRemoteTagUpdate(msg.data);
            }
        });

        // Handle userState response after register (includes tag sync trigger)
        this.wsService.registerMessageHandler('userState', async () => {
            // After registration, sync tags from cloud (only if we have a uuid)
            const uuid = this.userStateService.uuid();
            if (uuid) {
                await this.syncTagsFromCloud();
            }
        });
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
                await this.loadUnitTags(this.getUnits());
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
        return `${unit.chassis}|${unit.type}`;
    }

    /**
     * Load tags from IndexedDB and apply them to units.
     * Tags are stored separately as _nameTags and _chassisTags on each unit.
     */
    private async loadUnitTags(units: Unit[]): Promise<void> {
        const tagData = await this.dbService.getAllTagData();
        const nameTags = tagData?.nameTags || {};
        const chassisTags = tagData?.chassisTags || {};

        for (const unit of units) {
            const chassisKey = DataService.getChassisTagKey(unit);
            unit._nameTags = nameTags[unit.name] ?? [];
            unit._chassisTags = chassisTags[chassisKey] ?? [];
        }
        this.tagsVersion.set(this.tagsVersion() + 1);
    }

    private formatUnitType(type: string): string {
        if (type === 'Handheld Weapon') {
            return 'Weapon';
        }
        return type;
    }

    public static removeAccents(str: string): string {
        if (!str) return '';
        // Decompose combined characters, then remove diacritical marks.
        let s = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Handle specific characters that are not decomposed.
        s = s.replace(/ł/g, 'l').replace(/Ł/g, 'L');
        s = s.replace(/ø/g, 'o').replace(/Ø/g, 'O');
        s = s.replace(/ß/g, 'ss');
        s = s.replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
        s = s.replace(/œ/g, 'oe').replace(/Œ/g, 'OE');
        return s;
    }

    public getUnits(): Unit[] {
        return (this.data['units'] as Units)?.units ?? [];
    }

    public getUnitByName(name: string): Unit | undefined {
        return this.unitNameMap.get(name);
    }

    public getEquipment(unitType: string): EquipmentUnitType {
        return (this.data['equipment'] as EquipmentData)?.equipment?.[unitType] ?? {};
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
                if (unit.subtype === 'Battle Armor' && weapon.l !== 'SSW') {
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
        this.filterIndexes = {};
        // Get all dropdown filters except the external ones
        const filtersToIndex = ADVANCED_FILTERS.filter(f => f.type === AdvFilterType.DROPDOWN && f.external !== true);

        for (const filter of filtersToIndex) {
            const index = new Map<string, Set<number>>();
            for (const unit of units) {
                const key = (unit as any)[filter.key];
                if (key !== undefined && key !== null && key !== '') {
                    if (!index.has(key)) {
                        index.set(key, new Set());
                    }
                    index.get(key)!.add(unit.id);
                }
            }
            this.filterIndexes[filter.key] = index;
        }

        const statsByType: {
            [type: string]: {
                armor: number[],
                internal: number[],
                heat: number[],
                dissipation: number[],
                dissipationEfficiency: number[],
                runMP: number[],
                run2MP: number[],
                jumpMP: number[],
                umuMP: number[],
                alphaNoPhysical: number[],
                alphaNoPhysicalNoOneshots: number[],
                maxRange: number[],
                dpt: number[],
                // Capital ships
                dropshipCapacity: number[],
                escapePods: number[],
                lifeBoats: number[],
                sailIntegrity: number[],
                kfIntegrity: number[],
            }
        } = {};

        for (const unit of units) {
            unit._chassis = DataService.removeAccents(unit.chassis?.toLowerCase() || '');
            unit._model = DataService.removeAccents(unit.model?.toLowerCase() || '');
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
                    armor: [],
                    internal: [],
                    heat: [],
                    dissipation: [],
                    dissipationEfficiency: [],
                    runMP: [],
                    run2MP: [],
                    jumpMP: [],
                    umuMP: [],
                    alphaNoPhysical: [],
                    alphaNoPhysicalNoOneshots: [],
                    maxRange: [],
                    dpt: [],
                    // Capital ships
                    dropshipCapacity: [],
                    escapePods: [],
                    lifeBoats: [],
                    sailIntegrity: [],
                    kfIntegrity: [],
                };
            }
            statsByType[t].armor.push(unit.armor || 0);
            statsByType[t].internal.push(unit.internal || 0);
            statsByType[t].heat.push(unit.heat || 0);
            statsByType[t].dissipation.push(unit.dissipation || 0);
            statsByType[t].dissipationEfficiency.push((unit._dissipationEfficiency || 0));
            statsByType[t].runMP.push(unit.run || 0);
            statsByType[t].run2MP.push(unit.run2 || 0);
            statsByType[t].jumpMP.push(unit.jump || 0);
            statsByType[t].umuMP.push(unit.umu || 0);
            statsByType[t].alphaNoPhysical.push(unit._mdSumNoPhysical || 0);
            statsByType[t].alphaNoPhysicalNoOneshots.push(unit._mdSumNoPhysicalNoOneshots || 0);
            statsByType[t].maxRange.push(unit._maxRange || 0);
            statsByType[t].dpt.push(unit.dpt || 0);
            // Capital ships
            if (unit.capital) {
                statsByType[t].dropshipCapacity.push(unit.capital.dropshipCapacity || 0);
                statsByType[t].escapePods.push(unit.capital.escapePods || 0);
                statsByType[t].lifeBoats.push(unit.capital.lifeBoats || 0);
                statsByType[t].sailIntegrity.push(unit.capital.sailIntegrity || 0);
                statsByType[t].kfIntegrity.push(unit.capital.kfIntegrity || 0);
            }
        }

        // Compute max for each stat per unit type
        for (const [type, stats] of Object.entries(statsByType)) {
            this.unitTypeMaxStats[type] = {
                armor: [
                    Math.min(...stats.armor, 0),
                    Math.max(...stats.armor, 0)],
                internal: [
                    Math.min(...stats.internal, 0),
                    Math.max(...stats.internal, 0)],
                heat: [
                    Math.min(...stats.heat, 0),
                    Math.max(...stats.heat, 0)],
                dissipation: [
                    Math.min(...stats.dissipation, 0),
                    Math.max(...stats.dissipation, 0)],
                dissipationEfficiency: [
                    Math.min(...stats.dissipationEfficiency, 0),
                    Math.max(...stats.dissipationEfficiency, 0)],
                runMP: [
                    Math.min(...stats.runMP, 0),
                    Math.max(...stats.runMP, 0)],
                run2MP: [
                    Math.min(...stats.run2MP, 0),
                    Math.max(...stats.run2MP, 0)],
                jumpMP: [
                    Math.min(...stats.jumpMP, 0),
                    Math.max(...stats.jumpMP, 0)],
                umuMP: [
                    Math.min(...stats.umuMP, 0),
                    Math.max(...stats.umuMP, 0)],
                alphaNoPhysical: [
                    Math.min(...stats.alphaNoPhysical, 0),
                    Math.max(...stats.alphaNoPhysical, 0)],
                alphaNoPhysicalNoOneshots: [
                    Math.min(...stats.alphaNoPhysicalNoOneshots, 0),
                    Math.max(...stats.alphaNoPhysicalNoOneshots, 0)],
                maxRange: [
                    Math.min(...stats.maxRange, 0),
                    Math.max(...stats.maxRange, 0)],
                dpt: [
                    Math.min(...stats.dpt, 0),
                    Math.max(...stats.dpt, 0)],
                // Capital ships
                dropshipCapacity: [
                    Math.min(...stats.dropshipCapacity, 0),
                    Math.max(...stats.dropshipCapacity, 0)],
                escapePods: [
                    Math.min(...stats.escapePods, 0),
                    Math.max(...stats.escapePods, 0)],
                lifeBoats: [
                    Math.min(...stats.lifeBoats, 0),
                    Math.max(...stats.lifeBoats, 0)],
                sailIntegrity: [
                    Math.min(...stats.sailIntegrity, 0),
                    Math.max(...stats.sailIntegrity, 0)],
                kfIntegrity: [
                    Math.min(...stats.kfIntegrity, 0),
                    Math.max(...stats.kfIntegrity, 0)],
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
    }

    public async checkForUpdate(): Promise<void> {
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
            this.isDataReady.set(true);
        } catch (error) {
            this.logger.error('Failed to initialize data: ' + error);
            // Check if we have any data loaded despite the error
            const hasData = this.remoteStores.every(store => !!this.data[store.key as keyof LocalStore]);
            this.isDataReady.set(hasData);
        } finally {
            this.isDownloading.set(false);
        }
    }

    private async fetchFromRemote<T extends object>(remoteStore: RemoteStore<T>): Promise<void> {
        this.isDownloading.set(true);
        this.logger.info(`Downloading ${remoteStore.key}...`);
        return new Promise<void>((resolve, reject) => {
            this.http.get<T>(remoteStore.url, {
                reportProgress: false,
                observe: 'response',
            }).subscribe({
                next: async (response) => {
                    try {
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
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                },
                error: (err: any) => {
                    this.logger.error(`Failed to download ${remoteStore.key}: ` + (err.message ?? err));
                    reject(err);
                }
            });
        });
    }

    public async getSheet(sheetFileName: string): Promise<SVGSVGElement> {
        const etag = await this.fetchSheetETag(sheetFileName);
        const sheet: SVGSVGElement | null = await this.dbService.getSheet(sheetFileName, etag);
        if (sheet) {
            this.logger.info(`Sheet ${sheetFileName} found in cache.`);
            return sheet;
        }
        return this.fetchAndCacheSheet(sheetFileName);
    }

    private async fetchSheetETag(sheetFileName: string): Promise<string> {
        const src = `${REMOTE_HOST}/sheets/${sheetFileName}`;
        return this.getRemoteETag(src);
    }

    private async fetchAndCacheSheet(sheetFileName: string): Promise<SVGSVGElement> {
        this.logger.info(`Fetching sheet: ${sheetFileName}`);
        const src = `${REMOTE_HOST}/sheets/${sheetFileName}`;

        return new Promise<SVGSVGElement>((resolve, reject) => {
            this.http.get(src, {
                reportProgress: false,
                observe: 'response' as const,
                responseType: 'text' as const,
            }).subscribe({
                next: async (response) => {
                    try {
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
                        resolve(svgElement);
                    } catch (error) {
                        reject(error);
                    }
                },
                error: (err) => {
                    this.logger.error(`Failed to download sheet ${sheetFileName}: ` + err);
                    reject(err);
                }
            });
        });
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
     * Tags
     */

    /** Cached tag data for detecting changes during save */
    private cachedTagData: TagData | null = null;

    /**
     * Save unit tags to local storage.
     * This is the legacy method that only saves name-based tags.
     * For new code, use modifyTag() instead.
     * @deprecated Use modifyTag() for new implementations
     */
    public async saveUnitTags(units: Unit[]): Promise<void> {
        const tagsToSave: StoredTags = {};
        for (const unit of units) {
            if (unit._nameTags && unit._nameTags.length > 0) {
                tagsToSave[unit.name] = unit._nameTags;
            }
        }
        await this.dbService.saveTags(tagsToSave);
        this.notifyStoreUpdated('update', 'tags');
    }

    /**
     * Add or remove a tag from units, with support for chassis-wide tagging.
     * @param units The units to tag
     * @param tag The tag to add
     * @param tagType 'name' for unit-specific or 'chassis' for chassis-wide
     * @param action 'add' to add the tag, 'remove' to remove it
     */
    public async modifyTag(
        units: Unit[], 
        tag: string, 
        tagType: 'name' | 'chassis',
        action: 'add' | 'remove'
    ): Promise<void> {
        const tagData = await this.dbService.getAllTagData() ?? {
            nameTags: {},
            chassisTags: {},
            timestamp: 0
        };

        const trimmedTag = tag.trim();
        const lowerTag = trimmedTag.toLowerCase();
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedKeys = new Set<string>();

        for (const unit of units) {
            if (tagType === 'chassis') {
                const chassisKey = DataService.getChassisTagKey(unit);

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

        // Update cached data
        this.cachedTagData = tagData;

        // Reload tags on all units to reflect merged state
        await this.loadUnitTags(this.getUnits());

        // Notify other tabs
        this.notifyStoreUpdated('update', 'tags');

        // Sync operations to cloud (incremental, fire-and-forget)
        void this.syncTagOpsToCloud(ops);
    }

    /**
     * Remove a tag from units. Removes from both name and chassis tags.
     */
    public async removeTagFromUnits(units: Unit[], tag: string): Promise<void> {
        const tagData = await this.dbService.getAllTagData() ?? {
            nameTags: {},
            chassisTags: {},
            timestamp: 0
        };

        const lowerTag = tag.toLowerCase();
        const now = Date.now();
        const ops: TagOp[] = [];

        // Track processed keys to avoid duplicate operations
        const processedNameKeys = new Set<string>();
        const processedChassisKeys = new Set<string>();

        for (const unit of units) {
            const chassisKey = DataService.getChassisTagKey(unit);

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

        // Update cached data
        this.cachedTagData = tagData;

        // Reload tags on all units
        await this.loadUnitTags(this.getUnits());

        // Notify other tabs
        this.notifyStoreUpdated('update', 'tags');

        // Sync operations to cloud (incremental, fire-and-forget)
        void this.syncTagOpsToCloud(ops);
    }

    /**
     * Check if a tag is assigned at the chassis level for any of the given units.
     */
    public async isChassisTag(units: Unit[], tag: string): Promise<boolean> {
        const tagData = await this.dbService.getAllTagData();
        if (!tagData) return false;

        const lowerTag = tag.toLowerCase();
        for (const unit of units) {
            const chassisKey = DataService.getChassisTagKey(unit);
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
        const tagData = await this.dbService.getAllTagData();
        if (!tagData) return null;

        const lowerTag = tag.toLowerCase();
        const chassisKey = DataService.getChassisTagKey(unit);

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

    /**
     * Sync tag operations to cloud (incremental).
     * Sends only the operations, not the full state.
     */
    private static readonly TAG_OPS_CHUNK_SIZE = 1000;

    private async syncTagOpsToCloud(ops: TagOp[]): Promise<void> {
        const ws = this.wsService.getWebSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const uuid = this.userStateService.uuid();
        if (!uuid || ops.length === 0) return;

        // Chunk large batches to stay within server limits
        for (let i = 0; i < ops.length; i += DataService.TAG_OPS_CHUNK_SIZE) {
            const chunk = ops.slice(i, i + DataService.TAG_OPS_CHUNK_SIZE);
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
        const ws = this.wsService.getWebSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        const localData = await this.dbService.getAllTagData();
        if (!localData) return;

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
    public async syncTagsFromCloud(): Promise<void> {
        const ws = await this.canUseCloud();
        if (!ws) return;

        const uuid = this.userStateService.uuid();
        if (!uuid) return;

        try {
            const syncState = await this.dbService.getTagSyncState();
            const localData = await this.dbService.getAllTagData();
            const hasPendingOps = syncState.pendingOps.length > 0;
            const hasLocalTags = localData && 
                (Object.keys(localData.nameTags).length > 0 || Object.keys(localData.chassisTags).length > 0);

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
                const resolution = await this.showTagConflictDialog();
                
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
                // syncTagOpsToCloud will clear pending ops on success
                await this.syncTagOpsToCloud(syncState.pendingOps);
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
            await this.loadUnitTags(this.getUnits());
            this.notifyStoreUpdated('update', 'tags');
        } else if (response.ops && response.ops.length > 0) {
            // Apply incremental operations
            const localData = await this.dbService.getAllTagData() ?? { 
                nameTags: {}, 
                chassisTags: {}, 
                timestamp: 0 
            };
            this.applyTagOps(localData, response.ops);
            localData.timestamp = serverTs;
            await this.dbService.saveAllTagData(localData);
            await this.dbService.clearPendingTagOps(serverTs);
            this.cachedTagData = localData;
            await this.loadUnitTags(this.getUnits());
            this.notifyStoreUpdated('update', 'tags');
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
        const tagData = await this.dbService.getAllTagData() ?? { 
            nameTags: {}, 
            chassisTags: {}, 
            timestamp: 0 
        };

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
        await this.loadUnitTags(this.getUnits());

        // Push merged state to cloud
        await this.pushFullStateToCloud();
        
        this.notifyStoreUpdated('update', 'tags');
    }

    /**
     * Show conflict resolution dialog when local and cloud tags are out of sync.
     */
    private showTagConflictDialog(): Promise<'cloud' | 'merge' | 'local'> {
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
     * Handle remote tag updates from other sessions.
     * Now receives operations instead of full state.
     */
    public async handleRemoteTagOps(ops: TagOp[]): Promise<void> {
        if (!ops || ops.length === 0) return;

        const localData = await this.dbService.getAllTagData() ?? {
            nameTags: {},
            chassisTags: {},
            timestamp: 0
        };

        // Apply operations
        this.applyTagOps(localData, ops);
        localData.timestamp = Math.max(localData.timestamp, ...ops.map(op => op.ts));

        await this.dbService.saveAllTagData(localData);
        this.cachedTagData = localData;
        await this.loadUnitTags(this.getUnits());
        this.notifyStoreUpdated('update', 'tags');
    }

    /**
     * @deprecated Use handleRemoteTagOps for new code.
     * Kept for backwards compatibility during migration.
     */
    public async handleRemoteTagUpdate(tagData: TagData): Promise<void> {
        const localData = await this.dbService.getAllTagData();
        const localTimestamp = localData?.timestamp ?? 0;

        // Only update if remote is newer
        if (tagData.timestamp > localTimestamp) {
            await this.dbService.saveAllTagData(tagData);
            this.cachedTagData = tagData;
            await this.loadUnitTags(this.getUnits());
            this.notifyStoreUpdated('update', 'tags');
        }
    }

    /* ----------------------------------------------------------
     * Favorites searches
     */

    public async saveFavoriteSearch(fav: SerializedSearchFilter): Promise<void> {
    }

    private async getFavoriteSearchCloud(instanceId: string): Promise<SerializedSearchFilter | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;
        const uuid = this.userStateService.uuid();
        const payload = {
            action: 'getFavoriteSearch',
            uuid,
            instanceId,
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

}