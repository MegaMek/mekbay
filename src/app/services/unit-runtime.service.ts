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
    type SavedEntityIdentity,
    sanitizeSavedEntityIdentity,
} from '../models/persisted-unit-state';
import {
    asUnitProviderId,
    asSourceHash,
    asUnitUuid,
    encodeDesignIdentity,
    type DesignIdentity,
    type UnitProviderId,
} from './unit-catalog/unit-catalog.types';

export interface SerializedUnitIdentityReference {
    readonly unit: string;
    readonly chassis?: string;
    readonly model?: string;
    readonly type?: string;
    readonly entityIdentity?: SavedEntityIdentity;
}

export type UnitReferenceResolution =
    | {
        readonly kind: 'resolved';
        readonly unit: UnitSummary;
        readonly currentIdentity?: SavedEntityIdentity;
        readonly savedIdentity?: SavedEntityIdentity;
        readonly usedLegacyNameFallback: boolean;
        readonly sourceChanged: boolean;
        readonly formatChanged: boolean;
    }
    | {
        readonly kind: 'deferred';
        readonly descriptor: DeferredUnitDescriptor;
    };

export interface PreparedUnitRuntimeCatalog {
    readonly unitNameMap: ReadonlyMap<string, readonly UnitSummary[]>;
    readonly unitIdentityMap: ReadonlyMap<string, readonly UnitSummary[]>;
}

@Injectable({
    providedIn: 'root'
})
export class UnitRuntimeService {
    private readonly tagsService = inject(TagsService);
    private readonly publicTagsService = inject(PublicTagsService);
    private readonly unitSearchIndexService = inject(UnitSearchIndexService);

    private unitNameMap: ReadonlyMap<string, readonly UnitSummary[]> = new Map();
    private unitIdentityMap: ReadonlyMap<string, readonly UnitSummary[]> = new Map();

    private static getUnitNameKey(name: string): string {
        return name.toLowerCase();
    }

    public preprocessUnits(units: UnitSummary[]): void {
        this.commitPreparedRuntimeCatalog(this.prepareRuntimeCatalog(units));
        this.unitSearchIndexService.prepareUnits(units);
    }

    /** Builds lookup maps and unit-local display fields without changing live lookup state. */
    public prepareRuntimeCatalog(units: UnitSummary[]): PreparedUnitRuntimeCatalog {
        const unitNameMap = new Map<string, UnitSummary[]>();
        const unitIdentityMap = new Map<string, UnitSummary[]>();
        for (const unit of units) {
            unit._techBaseDisplay = getUnitTechBaseDisplay(unit);
            const nameKey = UnitRuntimeService.getUnitNameKey(unit.name);
            const nameMatches = unitNameMap.get(nameKey) ?? [];
            nameMatches.push(unit);
            unitNameMap.set(nameKey, nameMatches);

            const identity = this.getSavedEntityIdentity(unit);
            if (identity) {
                const identityKey = encodeDesignIdentity(identity);
                const identityMatches = unitIdentityMap.get(identityKey) ?? [];
                identityMatches.push(unit);
                unitIdentityMap.set(identityKey, identityMatches);
            }
        }
        return Object.freeze({ unitNameMap, unitIdentityMap });
    }

    /** Final reference-only lookup switch. */
    public commitPreparedRuntimeCatalog(candidate: PreparedUnitRuntimeCatalog): void {
        this.unitNameMap = candidate.unitNameMap;
        this.unitIdentityMap = candidate.unitIdentityMap;
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
        const matches = this.unitNameMap.get(UnitRuntimeService.getUnitNameKey(name)) ?? [];
        return matches.length === 1 ? matches[0] : undefined;
    }

    public getUnitByIdentity(provider: UnitProviderId, uuid: string): UnitSummary | undefined {
        let key: string;
        try {
            key = encodeDesignIdentity({ provider: asUnitProviderId(provider), uuid: asUnitUuid(uuid) });
        } catch {
            return undefined;
        }
        const matches = this.unitIdentityMap.get(key) ?? [];
        return matches.length === 1 ? matches[0] : undefined;
    }

    /**
     * Resolves the one catalog summary authored from the exact publication
     * artifact. Provider/UUID alone is deliberately insufficient while two
     * source revisions can coexist during a catalog handoff.
     */
    public getUnitByPublicationArtifact(
        provider: UnitProviderId,
        uuid: string,
        documentRevision: string,
        nativeSourceHash?: string,
    ): UnitSummary | undefined {
        let key: string;
        try {
            key = encodeDesignIdentity({ provider: asUnitProviderId(provider), uuid: asUnitUuid(uuid) });
        } catch {
            return undefined;
        }
        const expectedRevision = nativeSourceHash ?? documentRevision;
        const exact = (this.unitIdentityMap.get(key) ?? [])
            .filter(unit => unit.hash === expectedRevision);
        return exact.length === 1 ? exact[0] : undefined;
    }

    /** Returns the durable design/source witness authored on the UnitSummary. */
    public getSavedEntityIdentity(unit: UnitSummary): SavedEntityIdentity | undefined {
        let provider: UnitProviderId;
        try {
            provider = asUnitProviderId(unit.provider);
        } catch {
            return undefined;
        }

        let uuid;
        try {
            uuid = asUnitUuid(unit.uuid);
        } catch {
            return undefined;
        }

        let sourceFormat: 'mtf' | 'blk' | undefined;
        let sourceHashAtSave;
        if (unit.origin === 'megamek') {
            try {
                sourceHashAtSave = asSourceHash(unit.hash);
                sourceFormat = unit.entityType === 'Mek' ? 'mtf' : 'blk';
            } catch {
                return undefined;
            }
        }
        return { origin: unit.origin, provider, uuid, sourceHashAtSave, sourceFormat };
    }

    public resolveUnitReference(
        reference: SerializedUnitIdentityReference,
        catalogReady = true,
    ): UnitReferenceResolution {
        let savedIdentity: SavedEntityIdentity | undefined;
        if (reference.entityIdentity !== undefined) {
            try {
                savedIdentity = sanitizeSavedEntityIdentity(reference.entityIdentity);
            } catch {
                return {
                    kind: 'deferred',
                    descriptor: this.makeDeferredDescriptor(reference, [], catalogReady ? 'not-found' : 'catalog-not-ready'),
                };
            }
        }

        if (savedIdentity) {
            const key = encodeDesignIdentity(savedIdentity);
            const matches = this.unitIdentityMap.get(key) ?? [];
            if (matches.length === 1) {
                const unit = matches[0];
                const currentIdentity = this.getSavedEntityIdentity(unit);
                return {
                    kind: 'resolved',
                    unit,
                    currentIdentity,
                    savedIdentity,
                    usedLegacyNameFallback: false,
                    sourceChanged: !!savedIdentity.sourceHashAtSave
                        && !!currentIdentity?.sourceHashAtSave
                        && savedIdentity.sourceHashAtSave !== currentIdentity.sourceHashAtSave,
                    formatChanged: !!savedIdentity.sourceFormat
                        && !!currentIdentity?.sourceFormat
                        && savedIdentity.sourceFormat !== currentIdentity.sourceFormat,
                };
            }
            return {
                kind: 'deferred',
                descriptor: this.makeDeferredDescriptor(
                    reference,
                    this.designCandidates(matches),
                    matches.length > 1 ? 'ambiguous' : catalogReady ? 'not-found' : 'catalog-not-ready',
                    savedIdentity,
                ),
            };
        }

        const nameMatches = this.unitNameMap.get(UnitRuntimeService.getUnitNameKey(reference.unit)) ?? [];
        if (nameMatches.length === 1) {
            const unit = nameMatches[0];
            return {
                kind: 'resolved',
                unit,
                currentIdentity: this.getSavedEntityIdentity(unit),
                usedLegacyNameFallback: true,
                sourceChanged: false,
                formatChanged: false,
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
        if (resolution.kind === 'resolved' && resolution.currentIdentity) {
            return { kind: 'resolved', savedIdentity: resolution.currentIdentity };
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
            const identity = this.getSavedEntityIdentity(unit);
            if (!identity) continue;
            identities.set(encodeDesignIdentity(identity), {
                provider: identity.provider,
                uuid: identity.uuid,
            });
        }
        return Array.from(identities.values());
    }

    private makeDeferredDescriptor(
        reference: SerializedUnitIdentityReference,
        candidates: readonly DesignIdentity[],
        reason: DeferredUnitDescriptor['reason'],
        requestedIdentity?: SavedEntityIdentity,
    ): DeferredUnitDescriptor {
        return {
            rawLegacyName: reference.unit,
            rawChassis: reference.chassis,
            rawModel: reference.model,
            rawEntityType: reference.type,
            requestedIdentity,
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
