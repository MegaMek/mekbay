// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import {
    EntityRepository,
    type LoadedEntity,
    type NativeEntitySource,
} from '../models/entity/entity-repository';
import type { NativeUnitSourceHandle } from '../models/native-unit-source-handle';
import { sourceHashCanary } from '../models/source-hash-canary';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { CoreUnitCatalogService } from './unit-catalog/core-unit-catalog.service';
import { DataService } from './data.service';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';
import { UnitsCatalogService } from './catalogs/units-catalog.service';

interface PreparedEntityRepository {
    readonly inputsKey: string;
    readonly repository: EntityRepository;
    readonly generation: NonNullable<ReturnType<CoreUnitCatalogService['getPublishedGeneration']>>;
}

/** One catalog-backed native Entity loading boundary for every CBT family. */
@Injectable({ providedIn: 'root' })
export class NativeEntityService {
    private readonly coreCatalog = inject(CoreUnitCatalogService);
    private readonly catalog = inject(UnitsCatalogService);
    private readonly equipment = inject(EquipmentCatalogService);
    private readonly sourcebooks = inject(SourcebooksCatalogService);
    private readonly quirks = inject(QuirksCatalogService);
    private readonly data = inject(DataService);
    private cachedRepository?: PreparedEntityRepository;

    public canLoad(identity: { readonly uuid: UnitUuid }): boolean {
        const units = this.coreCatalog.getPublishedGeneration()?.manifest.manifest.units;
        return units !== undefined && Object.prototype.hasOwnProperty.call(units, identity.uuid);
    }

    public async load(uuid: UnitUuid): Promise<LoadedEntity> {
        const prepared = await this.prepareRepository();
        const sourceHash = prepared.generation.manifest.manifest.units[uuid]?.hash;
        return prepared.repository.load({
            uuid,
            ...(sourceHash === undefined ? {} : { sourceHash }),
        });
    }

    private async prepareRepository(): Promise<PreparedEntityRepository> {
        try {
            await this.data.requireApplicationCatalogReady();
        } catch (error) {
            throw new Error(
                `The complete application catalog is not ready: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
        const generation = this.coreCatalog.getPublishedGeneration();
        if (!generation) {
            throw new Error('The native unit catalog has no active generation');
        }
        const inputsKey = [
            generation.activationId,
            this.equipment.getCatalogRevision(),
            this.sourcebooks.getCatalogRevision(),
            this.quirks.getCatalogRevision(),
        ].join('\0');
        if (this.cachedRepository?.inputsKey === inputsKey) return this.cachedRepository;

        const sourcebooks = this.sourcebooks.getSourcebooks();
        const quirks = this.quirks.getQuirksByKey();
        const repository = new EntityRepository(
            { read: uuid => this.readSource(uuid) },
            this.equipment.getEquipmentRegistry(),
            {
                sourcebookResolver: abbreviation => sourcebooks.get(abbreviation),
                quirkResolver: key => quirks.get(key),
            },
        );
        this.cachedRepository = Object.freeze({ inputsKey, repository, generation });
        return this.cachedRepository;
    }

    private async readSource(uuid: UnitUuid): Promise<NativeEntitySource | undefined> {
        await this.data.requireApplicationCatalogReady();
        const stored = await this.catalog.readNativeUnitSource(uuid);
        if (!stored) return undefined;
        return {
            uuid,
            format: stored.format,
            sourceHash: stored.hash,
            bytes: stored.bytes,
            file: stored.file,
        };
    }
}

export function nativeSourceHandleForLoadedEntity(
    loaded: LoadedEntity,
): NativeUnitSourceHandle | undefined {
    if (loaded.source.file === undefined) return undefined;
    const hashCanary = sourceHashCanary(loaded.source.sourceHash);
    return Object.freeze({
        file: loaded.source.file,
        format: loaded.source.format,
        ...(hashCanary === undefined ? {} : { sourceHashCanary: hashCanary }),
        bytes: loaded.source.bytes.slice(0),
    });
}
