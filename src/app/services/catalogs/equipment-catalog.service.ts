// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import {
    EMPTY_EQUIPMENT_REGISTRY,
    EquipmentRegistry,
} from '../../models/equipment-lookup';
import { type EquipmentMap, type RawEquipmentData, createEquipment } from '../../models/equipment.model';
import { equipmentCatalogEntriesIncludingSupplements } from '../../models/equipment-catalog-supplements';
import { LoggerService } from '../logger.service';
import {
    CatalogBaseService,
    type PreparedCatalogTransport,
} from './catalog-base.service';
import { isPlaytestEquipment } from './equipment-catalog-policy';

export { isPlaytestEquipment } from './equipment-catalog-policy';

export interface PreparedEquipmentCatalog {
    readonly transport: PreparedCatalogTransport<RawEquipmentData>;
    readonly registry: EquipmentRegistry;
    readonly contentRevision: string;
}

@Injectable({
    providedIn: 'root'
})
export class EquipmentCatalogService extends CatalogBaseService<RawEquipmentData, RawEquipmentData, RawEquipmentData> {
    private readonly catalogLogger = inject(LoggerService);

    private equipmentRegistry = EMPTY_EQUIPMENT_REGISTRY;
    private contentRevision = 'unversioned';

    protected override get catalogKey(): string {
        return 'equipment';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/static/equipment.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

    public getEquipmentRegistry(): EquipmentRegistry {
        return this.equipmentRegistry;
    }

    public override getCatalogRevision(): string {
        return this.contentRevision;
    }

    public async prepareCachedCatalog(): Promise<PreparedEquipmentCatalog | undefined> {
        const transport = await this.prepareCachedTransport();
        return transport ? this.prepareCatalog(transport) : undefined;
    }

    public async prepareRemoteCatalog(
        previous?: PreparedEquipmentCatalog,
        signal?: AbortSignal,
    ): Promise<PreparedEquipmentCatalog> {
        return this.prepareCatalog(await this.prepareRemoteTransport(previous?.transport, signal));
    }

    /** Rebuilds runtime state from a bundle already verified at its trust boundary. */
    public prepareBundledCatalog(
        data: RawEquipmentData,
    ): PreparedEquipmentCatalog {
        return this.prepareCatalog(Object.freeze({ source: 'bundle' as const, data }));
    }

    /** Assignment-only commit used by the atomic application bundle coordinator. */
    public commitPreparedCatalog(candidate: PreparedEquipmentCatalog): void {
        this.equipmentRegistry = candidate.registry;
        this.contentRevision = candidate.contentRevision;
        this.markPreparedCatalogCommitted(candidate.transport.data);
    }

    protected override hasHydratedData(): boolean {
        return this.equipmentRegistry.size > 0;
    }

    protected override hydrate(data: RawEquipmentData): void {
        this.equipmentRegistry = buildEquipmentRegistry(data, (internalName, error) => {
            this.catalogLogger.error(`Failed to hydrate cached equipment ${internalName}: ${error}`);
        });
        this.transportRevision = data.assetHash || '';
    }

    protected override afterInitialize(): Promise<void> {
        this.contentRevision = this.transportRevision || 'unversioned';
        return Promise.resolve();
    }

    private prepareCatalog(
        transport: PreparedCatalogTransport<RawEquipmentData>,
    ): PreparedEquipmentCatalog {
        const registry = buildEquipmentRegistry(transport.data);
        if (registry.size === 0) throw new Error('Equipment catalog prepared to an empty registry');
        return {
            transport,
            registry,
            contentRevision: transport.data.assetHash || transport.data.version || 'unversioned',
        };
    }

    protected override normalizeFetchedData(data: RawEquipmentData, assetHash: string): RawEquipmentData {
        return {
            ...data,
            assetHash,
        };
    }

    protected override getDatasetSize(data: RawEquipmentData): number {
        return Object.keys(data.equipment ?? {}).length;
    }

    protected override getMinimumDatasetSize(): number {
        return 4000;
    }
}

function buildEquipmentRegistry(
    data: RawEquipmentData,
    onInvalidEntry?: (internalName: string, error: unknown) => void,
): EquipmentRegistry {
    const equipment: EquipmentMap = {};
    for (const [internalName, raw] of equipmentCatalogEntriesIncludingSupplements(data.equipment)) {
        if (isPlaytestEquipment(internalName, raw)) continue;
        try {
            equipment[internalName] = createEquipment(raw);
        } catch (error) {
            if (!onInvalidEntry) throw new Error(`Invalid equipment catalog entry ${internalName}`, { cause: error });
            onInvalidEntry(internalName, error);
        }
    }
    return new EquipmentRegistry(equipment);
}
