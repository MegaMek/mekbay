// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import {
    EntityRepository,
    type LoadedEntity,
    type NativeEntitySource,
    type NativeEntitySourceRepository,
} from '../models/entity/entity-repository';
import type { NativeUnitSourceHandle } from '../models/native-unit-source-handle';
import type { SavedEntityIdentity } from '../models/persisted-unit-state';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { CoreUnitCatalogService } from './unit-catalog/core-unit-catalog.service';
import { DataService } from './data.service';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    type SourceHash,
    type UnitProviderId,
    type UnitUuid,
} from './unit-catalog/unit-catalog.types';

interface PreparedEntityRepository {
    readonly inputsKey: string;
    readonly repository: EntityRepository;
    readonly generation: NonNullable<ReturnType<CoreUnitCatalogService['getPublishedGeneration']>>;
}

export type NativeEntityLoadErrorCode = 'UNSUPPORTED_PROVIDER' | 'CATALOG_NOT_READY';

export class NativeEntityLoadError extends Error {
    public constructor(
        public readonly code: NativeEntityLoadErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'NativeEntityLoadError';
    }
}

@Injectable({ providedIn: 'root' })
export class CoreCatalogNativeEntitySourceRepository implements NativeEntitySourceRepository {
    private readonly data = inject(DataService);

    public async read(identity: {
        readonly provider: UnitProviderId;
        readonly uuid: UnitUuid;
    }): Promise<NativeEntitySource | undefined> {
        if (identity.provider !== MM_DATA_UNIT_PROVIDER_ID) return undefined;
        await this.data.requireApplicationCatalogReady();
        const stored = await this.data.readNativeUnitSource(identity.provider, identity.uuid);
        if (!stored) return undefined;
        return Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: identity.uuid,
            format: stored.format,
            sourceHash: stored.hash,
            bytes: stored.bytes,
            file: stored.file,
        });
    }
}

/** One catalog-backed native Entity loading boundary for every CBT family. */
@Injectable({ providedIn: 'root' })
export class NativeEntityService {
    private readonly coreCatalog = inject(CoreUnitCatalogService);
    private readonly nativeSources = inject(CoreCatalogNativeEntitySourceRepository);
    private readonly equipment = inject(EquipmentCatalogService);
    private readonly sourcebooks = inject(SourcebooksCatalogService);
    private readonly quirks = inject(QuirksCatalogService);
    private readonly data = inject(DataService);
    private cachedRepository?: PreparedEntityRepository;

    public canLoad(identity: { readonly provider: UnitProviderId }): boolean {
        return identity.provider === MM_DATA_UNIT_PROVIDER_ID;
    }

    public async load(identity: {
        readonly provider: UnitProviderId;
        readonly uuid: UnitUuid;
        readonly sourceHashAtSave?: SourceHash;
    }): Promise<LoadedEntity> {
        const captured = Object.freeze({ ...identity });
        if (!this.canLoad(captured)) {
            throw new NativeEntityLoadError(
                'UNSUPPORTED_PROVIDER',
                `Native entity loading does not support provider ${captured.provider}`,
            );
        }
        const prepared = await this.prepareRepository();
        // The UUID is the persisted source of truth. A saved hash describes an
        // obsolete catalog snapshot and must never reject a unit after mm-data
        // legitimately updates it. Use only the current generation hash to
        // verify/cache the source that is installed now.
        const sourceHash = prepared.generation.manifest.manifest.units[captured.uuid]?.hash;
        return prepared.repository.load({
            provider: captured.provider,
            uuid: captured.uuid,
            ...(sourceHash === undefined ? {} : { sourceHash }),
        });
    }

    private async prepareRepository(): Promise<PreparedEntityRepository> {
        try {
            await this.data.requireApplicationCatalogReady();
        } catch (error) {
            throw new NativeEntityLoadError(
                'CATALOG_NOT_READY',
                `The complete application catalog is not ready: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        const generation = this.coreCatalog.getPublishedGeneration();
        if (!generation) {
            throw new NativeEntityLoadError(
                'CATALOG_NOT_READY',
                'The native unit catalog has no active generation',
            );
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
            this.nativeSources,
            this.equipment.getEquipmentRegistry(),
            {
                sourcebookResolver: abbreviation => sourcebooks.get(abbreviation),
                quirkResolver: key => quirks.get(key),
            },
        );
        this.cachedRepository = Object.freeze({ inputsKey, repository, generation });
        return this.cachedRepository;
    }
}

export function savedIdentityForLoadedEntity(loaded: LoadedEntity): SavedEntityIdentity {
    return Object.freeze({
        origin: loaded.source.origin,
        provider: loaded.source.provider,
        uuid: loaded.source.uuid,
        sourceHashAtSave: loaded.source.sourceHash,
        sourceFormat: loaded.source.format,
    });
}

export function nativeSourceHandleForLoadedEntity(
    loaded: LoadedEntity,
): NativeUnitSourceHandle | undefined {
    if (loaded.source.file === undefined) return undefined;
    return Object.freeze({
        file: loaded.source.file,
        sourceHash: loaded.source.sourceHash,
        format: loaded.source.format,
        bytes: loaded.source.bytes.slice(0),
    });
}
