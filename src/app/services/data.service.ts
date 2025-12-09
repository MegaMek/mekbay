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
import { DbService, StoredTags } from './db.service';
import { ADVANCED_FILTERS, AdvFilterType, SerializedSearchFilter } from './unit-search-filters.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { AmmoEquipment, Equipment, EquipmentData, EquipmentUnitType, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { Quirk, Quirks } from '../models/quirks.model';
import { generateUUID, WsService } from './ws.service';
import { ForceUnit } from '../models/force-unit.model';
import { Force }    from '../models/force.model';
import { SerializedForce, SerializedGroup, SerializedUnit } from '../models/force-serialization';
import { UnitInitializerService } from './unit-initializer.service';
import { UserStateService } from './userState.service';
import { LoadForceEntry, LoadForceGroup, LoadForceUnit } from '../models/load-force-entry.model';
import { LoggerService } from './logger.service';
import { firstValueFrom } from 'rxjs';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';

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
    private eraNameMap = new Map<string, Era>();
    private eraIdMap = new Map<number, Era>();
    private factionNameMap = new Map<string, Faction>();
    public filterIndexes: Record<string, Map<string | number, Set<number>>> = {};
    private unitTypeMaxStats: UnitTypeMaxStats = {};
    private quirksMap = new Map<string, Quirk>();

    public tagsVersion = signal(0);

    private readonly remoteStores: RemoteStore<any>[] = [
        {
            key: 'units',
            url: 'https://db.mekbay.com/units.json',
            getFromLocalStorage: async () => (await this.dbService.getUnits()) ?? null,
            putInLocalStorage: async (data: Units) => this.dbService.saveUnits(data),
            preprocess: (data: Units): Units => {
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
                }
                this.loadUnitTags(data.units);
                return data;
            }
        },
        {
            key: 'equipment',
            url: 'https://db.mekbay.com/equipment.json',
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
            url: 'https://db.mekbay.com/quirks.json',
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
            url: 'https://db.mekbay.com/factions.json',
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
            url: 'https://db.mekbay.com/eras.json',
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
        }
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
                this.loadUnitTags(this.getUnits());
            }
        } catch (err) {
            this.logger.error('Error handling store update broadcast: ' + err);
        }
    }

    private async loadUnitTags(units: Unit[]): Promise<void> {
        const storedTags = await this.dbService.getTags();
        if (!storedTags) return;

        for (const unit of units) {
            const tags = storedTags[unit.name];
            unit._tags = tags ?? [];
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
        return this.getUnits().find(u => u.name === name);
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

    private async getRemoteETag(filename: string): Promise<string> {
        const src = `https://db.mekbay.com/${filename}`;
        try {
            const resp = await firstValueFrom(
                this.http.head(src, { observe: 'response' as const })
            );
            const etag = resp.headers.get('ETag') || '';
            return etag;
        } catch (err: any) {
            this.logger.warn(`Failed to fetch ETag via HttpClient HEAD for ${src}: ${err.message ?? err}`);
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
                const etag = await this.getRemoteETag(`${store.key}.json`);
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
            if (this.isDownloading()) {
                this.isDownloading.set(false);
            }
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
            this.logger.error('Could not check version, trying to load from cache. ' + error);
            let allDataReady = true;
            for (const store of this.remoteStores) {
                let localData = await store.getFromLocalStorage();
                if (localData) {
                    if (store.preprocess) {
                        localData = store.preprocess(localData);
                    }
                    this.data[store.key as keyof LocalStore] = localData;
                } else {
                    allDataReady = false;
                }
            }
            this.postprocessData();
            this.isDataReady.set(allDataReady);
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
        return this.getRemoteETag(`sheets/${sheetFileName}`);
    }

    private async fetchAndCacheSheet(sheetFileName: string): Promise<SVGSVGElement> {
        this.logger.info(`Fetching sheet: ${sheetFileName}`);
        const src = `https://db.mekbay.com/sheets/${sheetFileName}`;

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
                if (localRaw.type === GameSystem.AS) {
                    local = ASForce.deserialize(localRaw, this, this.unitInitializer, this.injector);
                } else { // CBT
                    local = CBTForce.deserialize(localRaw, this, this.unitInitializer, this.injector);
                }
            } catch (error) { 
                this.logger.error((error as any)?.message ?? error);
            }
        }
        if (cloudRaw) {
            try {
                if (cloudRaw.type === GameSystem.AS) {
                    cloud = ASForce.deserialize(cloudRaw, this, this.unitInitializer, this.injector);
                } else { // CBT
                    cloud = CBTForce.deserialize(cloudRaw, this, this.unitInitializer, this.injector);
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
                    } else if (raw.units && Array.isArray(raw.units)) {
                        const loadUnits: LoadForceUnit[] = [];
                        for (const unit of raw.units as SerializedUnit[]) {
                            const loadUnit: LoadForceUnit = {
                                unit: this.getUnitByName(unit.unit),
                                alias: unit.alias,
                                destroyed: unit.state.destroyed ?? false
                            }
                            loadUnits.push(loadUnit);
                        };
                        groups.push({
                            name: '',
                            units: loadUnits
                        });
                    }
                    const entry: LoadForceEntry = new LoadForceEntry({
                        cloud: true,
                        instanceId: raw.instanceId,
                        name: raw.name,
                        type: raw.type,
                        bv: raw.bv || 0,
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

    public async saveUnitTags(units: Unit[]): Promise<void> {
        const tagsToSave: StoredTags = {};
        for (const unit of units) {
            if (unit._tags && unit._tags.length > 0) {
                tagsToSave[unit.name] = unit._tags;
            }
        }
        await this.dbService.saveTags(tagsToSave);
        this.notifyStoreUpdated('update', 'tags');
    }

    private async getTagsCloud(instanceId: string): Promise<StoredTags | null> {
        const ws = await this.canUseCloud();
        if (!ws) return null;
        const uuid = this.userStateService.uuid();
        const payload = {
            action: 'getTags',
            uuid,
            instanceId,
        };
        const response = await this.wsService.sendAndWaitForResponse(payload);
        return response.data || null;
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