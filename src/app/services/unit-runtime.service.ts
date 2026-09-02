// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import type { Era } from '../models/eras.model';
import type { UnitSummary, UnitComponent, UnitTagEntry } from '../models/unit-summary.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { TagData, UnitTagData } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { getUnitTechBaseDisplay } from '../models/tech.model';
import {
    type DeferredUnitDescriptor,
    type PersistedUnitIdentity,
} from '../models/persisted-unit-state';
import { isRecord } from '../utils/json-value.util';
import {
    asUnitProviderId,
    asUnitUuid,
    encodeDesignIdentity,
    type DesignIdentity,
    type UnitUuid,
} from './unit-catalog/unit-catalog.types';

export interface SerializedUnitIdentityReference {
    readonly unit: string;
    readonly chassis?: string;
    readonly model?: string;
    readonly type?: string;
    /** Historical V1 identity object. */
    readonly entityIdentity?: unknown;
}

export type UnitReferenceResolution =
    | {
        readonly kind: 'resolved';
        readonly unit: UnitSummary;
        readonly uuid: UnitUuid;
        readonly usedLegacyNameFallback: boolean;
    }
    | {
        readonly kind: 'deferred';
        readonly descriptor: DeferredUnitDescriptor;
    };

export interface PreparedUnitRuntimeCatalog {
    readonly unitNameMap: ReadonlyMap<string, readonly UnitSummary[]>;
    readonly unitUuidMap: ReadonlyMap<UnitUuid, UnitSummary>;
}

@Injectable({
    providedIn: 'root'
})
export class UnitRuntimeService {
    private readonly tagsService = inject(TagsService);
    private readonly publicTagsService = inject(PublicTagsService);
    private readonly unitSearchIndexService = inject(UnitSearchIndexService);

    private unitNameMap: ReadonlyMap<string, readonly UnitSummary[]> = new Map();
    private unitUuidMap: ReadonlyMap<UnitUuid, UnitSummary> = new Map();

    private static getUnitNameKey(name: string): string {
        return name.toLowerCase();
    }

    /** Builds lookup maps and unit-local display fields without changing live lookup state. */
    public prepareRuntimeCatalog(units: UnitSummary[]): PreparedUnitRuntimeCatalog {
        const unitNameMap = new Map<string, UnitSummary[]>();
        const unitUuidMap = new Map<UnitUuid, UnitSummary>();
        for (const unit of units) {
            unit._techBaseDisplay = getUnitTechBaseDisplay(unit);
            const nameKey = UnitRuntimeService.getUnitNameKey(unit.name);
            const nameMatches = unitNameMap.get(nameKey) ?? [];
            nameMatches.push(unit);
            unitNameMap.set(nameKey, nameMatches);
            unitUuidMap.set(unit.uuid, unit);
        }
        return Object.freeze({ unitNameMap, unitUuidMap });
    }

    /** Final reference-only lookup switch. */
    public commitPreparedRuntimeCatalog(candidate: PreparedUnitRuntimeCatalog): void {
        this.unitNameMap = candidate.unitNameMap;
        this.unitUuidMap = candidate.unitUuidMap;
    }

    public postprocessUnits(
        units: UnitSummary[],
        eras: Era[],
        options: { readonly loadTags?: boolean } = {},
    ): void {
        for (const unit of units) {
            unit._era = this.findEraForYear(unit.year, eras);
        }

        if (options.loadTags ?? true) {
            void this.loadUnitTags(units);
        }
    }

    /** Links one detached mechanics/display unit; catalog summary arrays stay untouched. */
    public linkEquipmentToUnit(unit: UnitSummary, equipmentRegistry: EquipmentRegistry): void {
        if (unit.comp) this.linkEquipmentToComponents(unit.comp, equipmentRegistry);
    }

    public async loadUnitTags(
        units: UnitSummary[],
        options: { readonly rebuildTagSearchIndex?: boolean } = {},
    ): Promise<TagData | null> {
        const tagData = await this.tagsService.migrateChassisTagsToVariantGroups(units);
        // This cleanup can change the in-memory tag document before persisting
        // it. Await it so callers using tag hydration as a catalog-settlement
        // boundary never publish or acknowledge an index built from the
        // pre-cleanup view.
        await this.tagsService.fixNameTagsCoveredByChassis(units, tagData);
        this.assignTagDataToUnits(units, tagData, options);
        return tagData;
    }

    /** Applies an already hydrated tag snapshot without starting async migration work. */
    public applyPreparedTagDataToUnits(
        units: UnitSummary[],
        tagData: TagData | null,
        options: { readonly rebuildTagSearchIndex?: boolean } = {},
    ): void {
        this.assignTagDataToUnits(units, tagData, options);
    }

    public applyTagDataToUnits(
        units: UnitSummary[],
        tagData: TagData | null,
        options?: { rebuildTagSearchIndex?: boolean }
    ): void {
        if (tagData) {
            void this.tagsService.migrateChassisTagsToVariantGroups(units, tagData);
        }

        void this.tagsService.fixNameTagsCoveredByChassis(units, tagData);
        this.assignTagDataToUnits(units, tagData, options);
    }

    private assignTagDataToUnits(
        units: UnitSummary[],
        tagData: TagData | null,
        options?: { readonly rebuildTagSearchIndex?: boolean },
    ): void {
        const tags = Object.values(tagData?.tags || {});
        const nameTags = new Map<string, UnitTagEntry[]>();
        const chassisTags = new Map<string, UnitTagEntry[]>();
        // Build reverse lookups once. The previous units × tags scan dominated
        // activation for large personal tag collections.
        for (const entry of tags) {
            for (const [unitName, value] of Object.entries(entry.units)) {
                const values = nameTags.get(unitName) ?? [];
                values.push({ tag: entry.label, quantity: this.getTagQuantity(value) });
                nameTags.set(unitName, values);
            }
            for (const [chassisKey, value] of Object.entries(entry.chassis)) {
                const values = chassisTags.get(chassisKey) ?? [];
                values.push({ tag: entry.label, quantity: this.getTagQuantity(value) });
                chassisTags.set(chassisKey, values);
            }
        }

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);
            unit._nameTags = nameTags.get(unit.name) ?? [];
            unit._chassisTags = chassisTags.get(chassisKey) ?? [];
        }

        if (options?.rebuildTagSearchIndex ?? true) {
            this.unitSearchIndexService.rebuildTagSearchIndex(units);
        }
    }

    private getTagQuantity(unitTagData: UnitTagData | undefined): number {
        const quantity = unitTagData?.q;
        return quantity && quantity > 0 ? quantity : 1;
    }

    public applyPublicTagsToUnits(
        units: UnitSummary[],
        options: { readonly rebuildTagSearchIndex?: boolean } = {},
    ): void {
        for (const unit of units) {
            unit._publicTags = this.publicTagsService.getPublicTagsForUnit(unit);
        }

        if (options.rebuildTagSearchIndex ?? true) {
            this.unitSearchIndexService.rebuildTagSearchIndex(units);
        }
    }

    public getUnitByName(name: string): UnitSummary | undefined {
        const matches = this.getUnitsByName(name);
        return matches.length === 1 ? matches[0] : undefined;
    }

    public getUnitsByName(name: string): readonly UnitSummary[] {
        return this.unitNameMap.get(UnitRuntimeService.getUnitNameKey(name)) ?? [];
    }

    public getUnitByUuid(uuid: UnitUuid): UnitSummary | undefined {
        return this.unitUuidMap.get(uuid);
    }

    public resolveUnitReference(
        reference: SerializedUnitIdentityReference,
        catalogReady = true,
    ): UnitReferenceResolution {
        let savedUuid: UnitUuid | undefined;
        if (reference.entityIdentity !== undefined) {
            try {
                if (!isRecord(reference.entityIdentity)) throw new Error('invalid V1 entity identity');
                savedUuid = asUnitUuid(String(reference.entityIdentity['uuid'] ?? ''));
            } catch {
                return {
                    kind: 'deferred',
                    descriptor: this.makeDeferredDescriptor(reference, [], catalogReady ? 'not-found' : 'catalog-not-ready'),
                };
            }
        }

        if (savedUuid) {
            const unit = this.unitUuidMap.get(savedUuid);
            if (unit !== undefined) {
                return {
                    kind: 'resolved',
                    unit,
                    uuid: savedUuid,
                    usedLegacyNameFallback: false,
                };
            }
            return {
                kind: 'deferred',
                descriptor: this.makeDeferredDescriptor(
                    reference,
                    [],
                    catalogReady ? 'not-found' : 'catalog-not-ready',
                    savedUuid,
                ),
            };
        }

        const nameMatches = this.unitNameMap.get(UnitRuntimeService.getUnitNameKey(reference.unit)) ?? [];
        if (nameMatches.length === 1) {
            const unit = nameMatches[0];
            return {
                kind: 'resolved',
                unit,
                uuid: unit.uuid,
                usedLegacyNameFallback: true,
            };
        }
        return {
            kind: 'deferred',
            descriptor: this.makeDeferredDescriptor(
                reference,
                this.designCandidates(nameMatches),
                nameMatches.length > 1 ? 'ambiguous' : catalogReady ? 'not-found' : 'catalog-not-ready',
            ),
        };
    }

    public resolvePersistedUnitIdentity(
        reference: SerializedUnitIdentityReference,
        catalogReady = true,
    ): PersistedUnitIdentity {
        const resolution = this.resolveUnitReference(reference, catalogReady);
        if (resolution.kind === 'resolved') {
            return { kind: 'resolved', uuid: resolution.uuid };
        }
        if (resolution.kind === 'deferred') {
            return {
                kind: 'unresolved',
                rawLegacyName: resolution.descriptor.rawLegacyName,
                rawChassis: resolution.descriptor.rawChassis,
                rawModel: resolution.descriptor.rawModel,
                rawEntityType: resolution.descriptor.rawEntityType,
                candidates: resolution.descriptor.candidates,
                reason: resolution.descriptor.reason,
            };
        }
        return {
            kind: 'unresolved',
            rawLegacyName: reference.unit,
            rawChassis: reference.chassis,
            rawModel: reference.model,
            rawEntityType: reference.type,
            candidates: [],
            reason: catalogReady ? 'not-found' : 'catalog-not-ready',
        };
    }

    private designCandidates(units: readonly UnitSummary[]): DesignIdentity[] {
        const identities = new Map<string, DesignIdentity>();
        for (const unit of units) {
            const identity = this.getCatalogIdentity(unit);
            if (!identity) continue;
            identities.set(encodeDesignIdentity(identity), identity);
        }
        return Array.from(identities.values());
    }

    private getCatalogIdentity(unit: UnitSummary): DesignIdentity | undefined {
        try {
            return {
                provider: asUnitProviderId(unit.provider),
                uuid: asUnitUuid(unit.uuid),
            };
        } catch {
            return undefined;
        }
    }

    private makeDeferredDescriptor(
        reference: SerializedUnitIdentityReference,
        candidates: readonly DesignIdentity[],
        reason: DeferredUnitDescriptor['reason'],
        requestedUuid?: UnitUuid,
    ): DeferredUnitDescriptor {
        return {
            rawLegacyName: reference.unit,
            rawChassis: reference.chassis,
            rawModel: reference.model,
            rawEntityType: reference.type,
            requestedUuid,
            candidates,
            reason,
        };
    }

    private findEraForYear(year: number, eras: Era[]): Era | undefined {
        for (const era of eras) {
            const from = era.years.from ?? Number.MIN_SAFE_INTEGER;
            const to = era.years.to ?? Number.MAX_SAFE_INTEGER;
            if (year >= from && year <= to) {
                return era;
            }
        }

        return undefined;
    }

    private linkEquipmentToComponents(components: UnitComponent[], equipmentRegistry: EquipmentRegistry): void {
        for (const component of components) {
            if (component.id) {
                component.eq = equipmentRegistry.findEquipment(component.id) ?? undefined;
            }
            if (component.bay) {
                this.linkEquipmentToComponents(component.bay, equipmentRegistry);
            }
        }
    }
}
