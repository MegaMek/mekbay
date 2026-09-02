// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal, inject, DestroyRef, effect } from '@angular/core';
import type { UnitSummary } from '../models/unit-summary.model';
import type { Faction, FactionId } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import { DbService, type TagData } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';

import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { Quirk } from '../models/quirks.model';
import type { SerializedUnit } from '../models/force-serialization';
import { LoggerService } from './logger.service';
import type { Sourcebook } from '../models/sourcebook.model';
import type { SarnaLookupUnit } from '../models/sarna-page-titles.model';
import type { MegaMekFactionRecord } from '../models/megamek/factions.model';
import type { MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import type { MegaMekRulesetRecord } from '../models/megamek/rulesets.model';
import type { ForceNameWords } from '../models/force-name-words.model';
import { getForcePacks } from '../models/forcepacks.model';
import { MegaMekAvailabilityCatalogService } from './catalogs/megamek-availability-catalog.service';
import { MegaMekFactionsCatalogService } from './catalogs/megamek-factions-catalog.service';
import { MegaMekRulesetsCatalogService } from './catalogs/megamek-rulesets-catalog.service';
import { EraIndexService } from './era-index.service';
import { FactionsCatalogService } from './catalogs/mulfactions-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SarnaPageTitlesCatalogService } from './catalogs/sarna-page-titles-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import {
    UnitSearchIndexService,
    type PreparedUnitSearchIndexes,
} from './unit-search-index.service';
import {
    UnitRuntimeService,
    type PreparedUnitRuntimeCatalog,
} from './unit-runtime.service';
import {
    UnitsCatalogService,
    type PreparedUnitsCatalogActivation,
} from './catalogs/units-catalog.service';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { ForceNameWordsCatalogService } from './catalogs/force-name-words-catalog.service';
import { CatalogDownloadTrackerService } from './catalogs/catalog-base.service';
import { MULFACTION_EXTINCT, MULFACTION_NONE } from '../models/mulfactions.model';
import { getUnitVariantGroupKey } from '../utils/unit-variant.util';
import type { RuntimeCatalogProgressState } from '../models/startup-progress.model';
import {
    DeferredUnitResolutionError,
} from '../models/persisted-unit-state';
import type { UnitReferenceResolution } from './unit-runtime.service';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';
import { PresentationCatalogSyncService } from './catalogs/presentation-catalog-sync.service';


type TagRefreshOptions = Readonly<{ searchIndexChanged?: boolean }>;
// Cross-tab message for the one store that currently needs live refresh.
export type BroadcastPayload = {
    readonly source: 'mekbay';
    readonly action: 'update';
    readonly context: 'tags';
    readonly meta?: TagRefreshOptions;
};

function isBroadcastPayload(value: unknown): value is BroadcastPayload {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const message = value as Readonly<Record<string, unknown>>;
    if (message['source'] !== 'mekbay'
        || message['action'] !== 'update'
        || message['context'] !== 'tags') return false;
    const meta = message['meta'];
    if (meta === undefined) return true;
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return false;
    const searchIndexChanged = (meta as Readonly<Record<string, unknown>>)['searchIndexChanged'];
    return searchIndexChanged === undefined || typeof searchIndexChanged === 'boolean';
}

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private logger = inject(LoggerService);
    private broadcast?: BroadcastChannel;
    private broadcastHandler?: (ev: MessageEvent<unknown>) => void;
    private dbService = inject(DbService);
    private tagsService = inject(TagsService);
    private publicTagsService = inject(PublicTagsService);
    private destroyRef = inject(DestroyRef);
    private unitSearchIndexService = inject(UnitSearchIndexService);
    private unitRuntimeService = inject(UnitRuntimeService);
    private unitsCatalog = inject(UnitsCatalogService);
    private presentationCatalogs = inject(PresentationCatalogSyncService);
    private equipmentCatalog = inject(EquipmentCatalogService);
    private eraIndex = inject(EraIndexService);
    private factionsCatalog = inject(FactionsCatalogService);
    private megaMekAvailabilityCatalog = inject(MegaMekAvailabilityCatalogService);
    private megaMekFactionsCatalog = inject(MegaMekFactionsCatalogService);
    private megaMekRulesetsCatalog = inject(MegaMekRulesetsCatalogService);
    private quirksCatalog = inject(QuirksCatalogService);
    private sarnaPageTitlesCatalog = inject(SarnaPageTitlesCatalogService);
    private sourcebooksCatalog = inject(SourcebooksCatalogService);
    private forceNameWordsCatalog = inject(ForceNameWordsCatalogService);
    private catalogDownloadTracker = inject(CatalogDownloadTrackerService);

    isDataReady = signal(false);
    public readonly isDownloading = this.catalogDownloadTracker.isDownloading;
    public readonly unitCatalogState = this.unitsCatalog.coreState;
    public readonly runtimeCatalogProgress = signal<RuntimeCatalogProgressState>({ status: 'idle' });
    public readonly auxiliaryCatalogProgress = signal<RuntimeCatalogProgressState>({ status: 'idle' });
    /** Exact gate: worker/search derivatives belong to the currently committed summary revision. */
    public readonly runtimeSearchIndexesReady = signal(false);

    /** packName -> Set<chassis|as.TP|omni> for force pack membership checks */
    private forcePackToLookupKey: Map<string, Set<string>> | null = null;
    /** chassis|as.TP|omni -> sorted pack names[] for reverse lookups */
    private lookupKeyToForcePacks: Map<string, string[]> | null = null;

    public tagsVersion = signal(0);
    public searchCorpusVersion = signal(0);
    public megaMekAvailabilityVersion = signal(0);
    public sarnaPageTitlesVersion = signal(0);
    private appliedUnitCatalogRevision = 0;
    private queuedUnitCatalogRevision = 0;
    private unitCatalogSettlement: Promise<void> = Promise.resolve();
    private readonly dataReadyWaiters = new Set<() => void>();
    private auxiliaryStartupSettlement: Promise<void> = Promise.resolve();
    private localSearchCatalogHydration: Promise<void> = Promise.resolve();
    private initialization?: Promise<void>;
    private destroyed = false;
    private catalogActivationFinalizing = false;
    private hasLatestTagDataSnapshot = false;
    private latestTagDataSnapshot: TagData | null = null;
    private bufferedTagRefresh?: {
        readonly data: TagData | null;
        readonly searchIndexChanged: boolean;
    };
    private bufferedPublicTagRefresh = false;
    /** Atomic derived membership projection paired with the visible Unit[] activation. */
    private activeMemberships?: Readonly<{
        eras: Era[];
        factions: Faction[];
        erasById: ReadonlyMap<number, Era>;
        factionsById: ReadonlyMap<FactionId, Faction>;
    }>;


    constructor() {
        effect(() => {
            const pending = this.unitsCatalog.pendingActivation();
            if (!pending || pending.revision <= this.appliedUnitCatalogRevision) return;
            this.queueUnitCatalogRevision(pending.revision);
        });
        this.destroyRef.onDestroy(() => { this.destroyed = true; });
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.broadcast = new BroadcastChannel('mekbay-updates');
                this.broadcastHandler = (event: MessageEvent<unknown>) => {
                    void this.handleStoreUpdate(event.data);
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
            const onOnline = () => {
                // Small delay to let WS reconnect first
                setTimeout(() => this.tagsService.syncFromCloud(), 1000);
            };
            window.addEventListener('online', onOnline);

            this.destroyRef.onDestroy(() => {
                window.removeEventListener('online', onOnline);
            });
        }

        // Wire up TagsService callbacks
        this.tagsService.setRefreshUnitsCallback((tagData, options) => {
            this.applyTagDataToUnits(tagData, options);
        });
        this.tagsService.setNotifyStoreUpdatedCallback((options) => {
            this.notifyTagStoreUpdated(options);
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
    private applyTagDataToUnits(tagData: TagData | null, options?: TagRefreshOptions): void {
        const searchIndexChanged = options?.searchIndexChanged ?? true;
        this.latestTagDataSnapshot = tagData;
        this.hasLatestTagDataSnapshot = true;
        if (this.catalogActivationFinalizing) {
            this.bufferedTagRefresh = { data: tagData, searchIndexChanged };
            return;
        }
        this.unitRuntimeService.applyTagDataToUnits(this.getUnits(), tagData, { rebuildTagSearchIndex: searchIndexChanged });
        if (searchIndexChanged) {
            this.tagsVersion.update(v => v + 1);
        }
    }

    /**
     * Apply public tags to all loaded units.
     * Called by PublicTagsService when public tags change (import/subscribe/update).
     */
    private applyPublicTagsToUnits(
        units: UnitSummary[] = this.getUnits(),
        options: { readonly rebuildTagSearchIndex?: boolean } = {},
    ): void {
        if (this.catalogActivationFinalizing && units === this.getUnits()) {
            this.bufferedPublicTagRefresh = true;
            return;
        }
        this.unitRuntimeService.applyPublicTagsToUnits(units, options);
        this.tagsVersion.update(v => v + 1);
    }

    /** Flush callbacks that arrived while the fenced DB pointer was finalizing. */
    private flushBufferedTagRefresh(): void {
        const searchIndexChanged = this.applyBufferedTagRefreshToUnits(this.getUnits());
        if (!searchIndexChanged) return;
        this.unitSearchIndexService.rebuildTagSearchIndex(this.getUnits());
        this.tagsVersion.update(version => version + 1);
        this.bumpSearchCorpusVersion();
    }

    /** Applies buffered tag state to one exact Unit[] without publishing an index. */
    private applyBufferedTagRefreshToUnits(units: UnitSummary[]): boolean {
        const local = this.bufferedTagRefresh;
        const refreshPublic = this.bufferedPublicTagRefresh;
        this.bufferedTagRefresh = undefined;
        this.bufferedPublicTagRefresh = false;
        if (!local && !refreshPublic) return false;
        if (local) {
            this.unitRuntimeService.applyPreparedTagDataToUnits(
                units,
                local.data,
                { rebuildTagSearchIndex: false },
            );
        }
        if (refreshPublic) {
            this.unitRuntimeService.applyPublicTagsToUnits(units, { rebuildTagSearchIndex: false });
        }
        return Boolean(local?.searchIndexChanged || refreshPublic);
    }

    private notifyTagStoreUpdated(meta?: TagRefreshOptions): void {
        if (!this.broadcast) return;
        const payload: BroadcastPayload = { source: 'mekbay', action: 'update', context: 'tags', meta };
        try {
            this.broadcast?.postMessage(payload);
        } catch { /* best-effort */ }
    }

    private async handleStoreUpdate(value: unknown): Promise<void> {
        try {
            if (!isBroadcastPayload(value)) return;
            const tagData = await this.tagsService.getTagData();
            this.applyTagDataToUnits(tagData, value.meta);
        } catch (err) {
            this.logger.error('Error handling store update broadcast: ' + err);
        }
    }

    public getUnits(): UnitSummary[] {
        return this.unitsCatalog.getUnits();
    }

    public getUnitSummaries(): readonly UnitSummary[] {
        return this.unitsCatalog.getCoreSummaries();
    }

    public getUnitByName(name: string): UnitSummary | undefined {
        return this.unitRuntimeService.getUnitByName(name);
    }

    public getUnitsByName(name: string): readonly UnitSummary[] {
        return this.unitRuntimeService.getUnitsByName(name);
    }

    public getUnitByUuid(uuid: UnitUuid): UnitSummary | undefined {
        return this.unitRuntimeService.getUnitByUuid(uuid);
    }

    /** UUID is authoritative; name is accepted only for an unversioned unique legacy match. */
    public resolveSerializedUnit(data: SerializedUnit): Extract<UnitReferenceResolution, { readonly kind: 'resolved' }> {
        const resolution = this.unitRuntimeService.resolveUnitReference(
            data,
            this.isDataReady(),
        );
        if (resolution.kind === 'deferred') {
            throw new DeferredUnitResolutionError(resolution.descriptor);
        }
        return resolution;
    }

    public getEquipmentRegistry(): EquipmentRegistry {
        return this.equipmentCatalog.getEquipmentRegistry();
    }

    /** Resolves an equipment internal name or alias using the canonical registry. */
    public findEquipment(name: string) {
        return this.getEquipmentRegistry().findEquipment(name) ?? undefined;
    }

    /** Links equipment only on an explicitly detached mechanics/display unit. */
    public linkEquipmentToUnit(unit: UnitSummary): void {
        this.unitRuntimeService.linkEquipmentToUnit(unit, this.getEquipmentRegistry());
    }

    public getFactions(): Faction[] {
        return this.activeMemberships?.factions ?? this.factionsCatalog.getFactions();
    }

    public getFactionByName(name: string): Faction | undefined {
        const canonical = this.factionsCatalog.getFactionByName(name);
        return canonical === undefined ? undefined : this.getFactionById(canonical.id);
    }

    public getFactionById(id: FactionId): Faction | undefined {
        const active = this.activeMemberships;
        return active === undefined
            ? this.factionsCatalog.getFactionById(id)
            : active.factionsById.get(id);
    }

    public getEras(): Era[] {
        return this.activeMemberships?.eras ?? this.eraIndex.getEras();
    }

    public getEraByName(name: string): Era | undefined {
        const canonical = this.eraIndex.getEraByName(name);
        return canonical === undefined ? undefined : this.getEraById(canonical.id);
    }

    public getEraById(id: number): Era | undefined {
        const active = this.activeMemberships;
        return active === undefined
            ? this.eraIndex.getEraById(id)
            : active.erasById.get(id);
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirksCatalog.getQuirkByName(name);
    }

    public getQuirkByKey(key: string): Quirk | undefined {
        return this.quirksCatalog.getQuirkByKey(key);
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

    public getSarnaPageTitleForUnit(unit: SarnaLookupUnit | null | undefined): string | undefined {
        return this.sarnaPageTitlesCatalog.getPageTitleForUnit(unit);
    }

    public getForceNameWords(): ForceNameWords {
        return this.forceNameWordsCatalog.getWords();
    }

    public getMegaMekFactionByKey(key: string): MegaMekFactionRecord | undefined {
        return this.megaMekFactionsCatalog.getFactionByKey(key);
    }

    public getMegaMekFactionsByMulId(mulId: number): MegaMekFactionRecord[] {
        return this.megaMekFactionsCatalog.getFactionsByMulId(mulId);
    }

    public getMegaMekRulesetByFactionKey(factionKey: string): MegaMekRulesetRecord | undefined {
        return this.megaMekRulesetsCatalog.getRulesetByFactionKey(factionKey);
    }

    public getMegaMekRulesetsByMulFactionId(mulFactionId: number): MegaMekRulesetRecord[] {
        return this.getMegaMekFactionsByMulId(mulFactionId)
            .map((faction) => this.megaMekRulesetsCatalog.getRulesetByFactionKey(faction.id))
            .filter((ruleset): ruleset is MegaMekRulesetRecord => ruleset !== undefined);
    }

    public getMegaMekAvailabilityRecordForUnit(unit: Pick<UnitSummary, 'name'>): MegaMekWeightedAvailabilityRecord | undefined {
        return this.megaMekAvailabilityCatalog.getRecordForUnit(unit);
    }

    private bumpSearchCorpusVersion(): void {
        this.searchCorpusVersion.update(version => version + 1);
    }

    private bumpMegaMekAvailabilityVersion(): void {
        this.megaMekAvailabilityVersion.update(version => version + 1);
    }

    private bumpSarnaPageTitlesVersion(): void {
        this.sarnaPageTitlesVersion.update(version => version + 1);
    }

    private invalidateForcePackCaches(): void {
        this.forcePackToLookupKey = null;
        this.lookupKeyToForcePacks = null;
    }

    private queueUnitCatalogRevision(revision: number): void {
        if (revision <= this.appliedUnitCatalogRevision
            || revision <= this.queuedUnitCatalogRevision) {
            return;
        }
        this.queuedUnitCatalogRevision = revision;
        this.unitCatalogSettlement = this.unitCatalogSettlement
            .catch(() => undefined)
            .then(() => this.applyUnitCatalogRevision(revision));
    }

    private async applyUnitCatalogRevision(revision: number): Promise<void> {
        const pending = this.readExactPendingActivation(revision);
        if (!pending || revision <= this.appliedUnitCatalogRevision) return;
        const units = pending.snapshot.units;
        const startedAt = Date.now();
        const indexPreparationStartedAt = Date.now();
        let backgroundYieldMs = 0;
        const yieldForResponsiveness = async (): Promise<void> => {
            const yieldStartedAt = Date.now();
            await this.yieldBackgroundCatalogWork();
            backgroundYieldMs += Math.max(0, Date.now() - yieldStartedAt);
        };
        let completed = false;
        this.logger.info(
            `[Background:runtime-unit-catalog] Started revision ${revision} for ${units.length.toLocaleString()} stored summaries.`,
        );

        this.catalogActivationFinalizing = true;
        let summaryCommitted = false;
        try {
            const eras = pending.core.dependencies.eras.eras;
            const factions = pending.core.dependencies.factions.factions;
            const equipmentRegistry = pending.core.dependencies.equipment.registry;
            const membershipState = this.cloneEraFactionMembershipState(eras, factions);

            const runtimePreparationStartedAt = Date.now();
            const runtimeCandidate: PreparedUnitRuntimeCatalog =
                this.unitRuntimeService.prepareRuntimeCatalog(units);
            const runtimePreparationMs = Math.max(0, Date.now() - runtimePreparationStartedAt);

            this.setRuntimeCatalogProgress({
                status: 'running',
                completed: 0,
                total: 5,
                detail: `Preparing indexes from ${units.length.toLocaleString()} stored unit summaries`,
            });

            // Availability is a separate saved catalog. Its cache-only hydration
            // starts alongside the core summary read and must settle before the
            // first search corpus is published; remote revalidation stays in the
            // auxiliary background phase.
            const localCatalogHydrationStartedAt = Date.now();
            await this.localSearchCatalogHydration;
            const localCatalogHydrationMs = Math.max(0, Date.now() - localCatalogHydrationStartedAt);
            await yieldForResponsiveness();
            if (revision < this.queuedUnitCatalogRevision) return;
            const tagPreparationStartedAt = Date.now();
            const hydratedTagData = await this.unitRuntimeService.loadUnitTags(
                units,
                { rebuildTagSearchIndex: false },
            );
            if (revision < this.queuedUnitCatalogRevision) return;
            this.unitRuntimeService.applyPreparedTagDataToUnits(
                units,
                this.hasLatestTagDataSnapshot ? this.latestTagDataSnapshot : hydratedTagData,
                { rebuildTagSearchIndex: false },
            );
            const tagPreparationMs = Math.max(0, Date.now() - tagPreparationStartedAt);
            this.setRuntimeCatalogProgress({
                status: 'running', completed: 1, total: 5,
                detail: 'Loaded personal unit tags',
            });

            await yieldForResponsiveness();
            if (revision < this.queuedUnitCatalogRevision) return;
            const summaryFilterPreparationStartedAt = Date.now();
            this.applyNoneFactionMemberships(units, membershipState.eras, membershipState.factions);
            this.unitRuntimeService.postprocessUnits(units, membershipState.eras, { loadTags: false });
            this.unitRuntimeService.applyPublicTagsToUnits(units, { rebuildTagSearchIndex: false });
            this.applyBufferedTagRefreshToUnits(units);
            const summaryFilterPreparationMs = Math.max(0, Date.now() - summaryFilterPreparationStartedAt);
            this.setRuntimeCatalogProgress({
                status: 'running', completed: 2, total: 5,
                detail: 'Prepared summary filters and availability memberships',
            });

            await yieldForResponsiveness();
            if (revision < this.queuedUnitCatalogRevision) return;
            const extinctFaction = membershipState.factions.find(
                faction => faction.id === MULFACTION_EXTINCT,
            );
            const searchIndexPreparationStartedAt = Date.now();
            const searchCandidate: PreparedUnitSearchIndexes =
                this.unitSearchIndexService.prepareCatalogIndexes(
                    units,
                    membershipState.eras,
                    membershipState.factions,
                    extinctFaction,
                    equipmentRegistry,
                );
            const searchIndexPreparationMs = Math.max(0, Date.now() - searchIndexPreparationStartedAt);
            this.setRuntimeCatalogProgress({
                status: 'running', completed: 3, total: 5,
                detail: `Indexed ${units.length.toLocaleString()} unit summaries`,
            });

            this.setRuntimeCatalogProgress({
                status: 'running', completed: 4, total: 5,
                detail: 'Finalizing the shared catalog publication',
            });

            const publicationStartedAt = Date.now();
            if (!this.readExactPendingActivation(revision, pending)) return;
            if (!await this.unitsCatalog.finalizePendingActivation(revision)
                || !this.readExactPendingActivation(revision, pending)) return;
            const committed = this.unitsCatalog.commitPendingActivation(revision);
            if (!committed) {
                throw new Error('The finalized application catalog activation was superseded before commit');
            }
            summaryCommitted = true;

            // One synchronous publication boundary: consumers can never see a
            // new summary paired with old memberships, derived fields, or indexes.
            this.unitRuntimeService.commitPreparedRuntimeCatalog(runtimeCandidate);
            this.activeMemberships = Object.freeze({
                eras: membershipState.eras,
                factions: membershipState.factions,
                erasById: new Map(membershipState.eras.map(era => [era.id, era])),
                factionsById: new Map(
                    membershipState.factions.map(faction => [faction.id, faction]),
                ),
            });
            this.unitSearchIndexService.commitPreparedCatalogIndexes(searchCandidate);
            this.appliedUnitCatalogRevision = committed.revision;
            this.invalidateForcePackCaches();
            this.runtimeSearchIndexesReady.set(true);
            this.tagsVersion.update(version => version + 1);
            this.bumpSearchCorpusVersion();
            this.markDataReady();

            this.setRuntimeCatalogProgress({
                status: 'running', completed: 5, total: 5,
                detail: 'Unit indexes and shared catalog publication are ready',
            });
            const publicationMs = Math.max(0, Date.now() - publicationStartedAt);
            const indexPreparationMs = Math.max(0, Date.now() - indexPreparationStartedAt);
            this.logger.info(
                `[Background:runtime-unit-catalog] Prepared unit indexes in ${indexPreparationMs} ms `
                + `[runtime=${runtimePreparationMs}ms, local-catalog=${localCatalogHydrationMs}ms, tags=${tagPreparationMs}ms, `
                + `summary-filters=${summaryFilterPreparationMs}ms, search-indexes=${searchIndexPreparationMs}ms, `
                + `unit-derivatives=${searchCandidate.preparationTimings.unitDerivativesMs}ms, `
                + `filter-indexes=${searchCandidate.preparationTimings.filterIndexesMs}ms, `
                + `component-indexes=${searchCandidate.preparationTimings.componentIndexesMs}ms, `
                + `index-keys=${searchCandidate.indexStats.filterKeys.toLocaleString()}, `
                + `index-values=${searchCandidate.indexStats.filterValues.toLocaleString()}, `
                + `memberships=${searchCandidate.indexStats.memberships.toLocaleString()}, `
                + `publication=${publicationMs}ms, yielding=${backgroundYieldMs}ms].`,
            );
            this.logger.info(
                `[Background:runtime-unit-catalog] Search-index phases `
                + `[identity-map=${searchCandidate.preparationTimings.identityMapMs}ms, `
                + `unit-filters=${searchCandidate.preparationTimings.unitFiltersMs}ms, `
                + `component-indexes=${searchCandidate.preparationTimings.componentIndexesMs}ms, `
                + `era-memberships=${searchCandidate.preparationTimings.eraMembershipsMs}ms, `
                + `faction-memberships=${searchCandidate.preparationTimings.factionMembershipsMs}ms, `
                + `finalization=${searchCandidate.preparationTimings.finalizationMs}ms].`,
            );
            try {
                await this.unitsCatalog.acknowledgeCatalogRevisionApplied(committed.revision);
            } catch (error) {
                this.logger.warn(`Catalog maintenance acknowledgement failed: ${this.describeError(error)}`);
            }
            await this.yieldBackgroundCatalogWork();
            this.setRuntimeCatalogProgress({ status: 'idle' });
            completed = true;
            this.logger.info(
                `[Background:runtime-unit-catalog] Finished revision ${revision} in ${Math.max(0, Date.now() - startedAt)} ms.`,
            );
        } catch (error) {
            if (!summaryCommitted && this.readExactPendingActivation(revision, pending)) {
                this.unitsCatalog.rejectPendingActivation(revision, error);
                this.setRuntimeCatalogProgress({
                    status: 'error',
                    detail: this.describeError(error),
                });
                this.logger.error(`Failed to prepare application catalog activation: ${this.describeError(error)}`);
            } else if (summaryCommitted) {
                this.setRuntimeCatalogProgress({
                    status: 'error',
                    detail: this.describeError(error),
                });
                this.logger.error(`Failed to build background unit indexes: ${this.describeError(error)}`);
            }
        } finally {
            if (!completed && revision < this.queuedUnitCatalogRevision) {
                this.logger.info(
                    `[Background:runtime-unit-catalog] Superseded revision ${revision} after ${Math.max(0, Date.now() - startedAt)} ms.`,
                );
            }
            if (this.catalogActivationFinalizing) {
                this.catalogActivationFinalizing = false;
                try {
                    this.flushBufferedTagRefresh();
                } catch (error) {
                    this.logger.warn(`Buffered tag refresh failed: ${this.describeError(error)}`);
                }
            }
        }
    }

    private yieldBackgroundCatalogWork(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    private setRuntimeCatalogProgress(progress: RuntimeCatalogProgressState): void {
        this.runtimeCatalogProgress.set(progress);
    }

    private setAuxiliaryCatalogProgress(progress: RuntimeCatalogProgressState): void {
        this.auxiliaryCatalogProgress.set(progress);
    }

    private readExactPendingActivation(
        revision: number,
        expected?: PreparedUnitsCatalogActivation,
    ): PreparedUnitsCatalogActivation | undefined {
        if (this.destroyed) return undefined;
        const pending = this.unitsCatalog.pendingActivation();
        if (!pending || pending.revision !== revision || (expected && pending !== expected)) return undefined;
        return pending;
    }

    private applyNoneFactionMemberships(units: readonly UnitSummary[], eras: readonly Era[], factions: readonly Faction[]): void {
        const noneFaction = factions.find(faction => faction.id === MULFACTION_NONE);
        if (!noneFaction) {
            return;
        }

        const factionUnitIds = new Set<number>();
        for (const faction of factions) {
            if (faction.id === MULFACTION_NONE) {
                continue;
            }

            for (const eraUnitIds of Object.values(faction.eras) as Set<number>[]) {
                for (const unitId of eraUnitIds) {
                    factionUnitIds.add(unitId);
                }
            }
        }

        const noneUnits = units.filter((unit) => !factionUnitIds.has(unit.id));

        noneFaction.eras = {};
        for (const era of eras) {
            const noneEraUnitIds = new Set<number>();
            for (const unit of noneUnits) {
                if (!this.isUnitYearValidForEra(unit, era)) {
                    continue;
                }

                noneEraUnitIds.add(unit.id);
                (era.units as Set<number>).add(unit.id);
            }

            if (noneEraUnitIds.size > 0) {
                noneFaction.eras[era.id] = noneEraUnitIds;
                (era.factions as Set<number>).add(MULFACTION_NONE);
            }
        }
    }

    private isUnitYearValidForEra(unit: Pick<UnitSummary, 'year'>, era: Era): boolean {
        const eraEndYear = era.years.to ?? Number.POSITIVE_INFINITY;
        return Number.isFinite(unit.year) && unit.year <= eraEndYear;
    }

    private async checkForUpdate(): Promise<void> {
        await this.unitsCatalog.initialize();
        const pending = this.unitsCatalog.pendingActivation();
        if (pending) this.queueUnitCatalogRevision(pending.revision);
        await this.waitForDataReadyOrCatalogSettlement();
        if (!this.isDataReady()) {
            throw new Error('The application catalog did not commit a complete activation');
        }
    }

    private waitForDataReadyOrCatalogSettlement(): Promise<void> {
        if (this.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error): void => {
                if (settled) return;
                settled = true;
                this.dataReadyWaiters.delete(onReady);
                if (error) reject(error);
                else resolve();
            };
            const onReady = (): void => finish();
            this.dataReadyWaiters.add(onReady);
            void this.unitCatalogSettlement.then(() => {
                if (this.isDataReady()) finish();
                else finish(new Error('The application catalog did not commit a complete activation'));
            }, error => finish(error instanceof Error ? error : new Error(this.describeError(error))));
        });
    }

    private markDataReady(): void {
        this.isDataReady.set(true);
        for (const resolve of this.dataReadyWaiters) resolve();
        this.dataReadyWaiters.clear();
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        if (typeof error === 'object' && error !== null && 'message' in error) {
            return String(error.message);
        }

        return String(error);
    }

    private initializeCatalog(
        name: string,
        initialize: () => Promise<void>,
        onInitialized?: () => void,
    ): Promise<boolean> {
        return initialize()
            .then(() => {
                onInitialized?.();
                return true;
            })
            .catch((error) => {
                this.logger.error(`Failed to initialize catalog service "${name}": ${this.describeError(error)}`);
                return false;
            });
    }

    private async ensureCatalogGroupInitialized(
        catalogs: readonly { name: string; ensure: () => Promise<boolean> }[],
    ): Promise<boolean> {
        const results = await Promise.all(catalogs.map(async ({ name, ensure }) => ({ name, success: await ensure() })));
        const failures = results.filter((result) => !result.success).map((result) => result.name);

        if (failures.length === 0) {
            return true;
        }

        this.logger.error(
            `Failed to initialize ${failures.length} catalog service${failures.length === 1 ? '' : 's'}: ${failures.map((name) => `"${name}"`).join(', ')}`,
        );
        return false;
    }

    private initializeStartupCatalogs(): Promise<boolean> {
        return this.ensureCatalogGroupInitialized([
            {
                name: 'fluff_images',
                ensure: () => this.initializeCatalog(
                    'fluff_images',
                    () => this.presentationCatalogs.initializeFluffImages(),
                ),
            },
            {
                name: 'force_name_words',
                ensure: () => this.initializeCatalog('force_name_words', () => this.forceNameWordsCatalog.initialize()),
            },
            { name: 'megamek_availability', ensure: () => this.ensureMegaMekAvailabilityCatalogInitialized() },
            {
                name: 'sarna_page_titles',
                ensure: () => this.initializeCatalog(
                    'sarna_page_titles',
                    () => this.sarnaPageTitlesCatalog.initialize(),
                    () => {
                        if (this.sarnaPageTitlesVersion() === 0) {
                            this.bumpSarnaPageTitlesVersion();
                        }
                    },
                ),
            },
        ]);
    }

    public ensureMegaMekAvailabilityCatalogInitialized(): Promise<boolean> {
        const previousRevision = this.megaMekAvailabilityCatalog.getCatalogRevision();
        return this.initializeCatalog(
            'megamek_availability',
            () => this.megaMekAvailabilityCatalog.initialize(),
            () => {
                if (this.megaMekAvailabilityVersion() === 0
                    || this.megaMekAvailabilityCatalog.getCatalogRevision() !== previousRevision) {
                    this.bumpMegaMekAvailabilityVersion();
                }
            },
        );
    }

    private async hydrateSavedSearchCatalogs(): Promise<void> {
        try {
            if (await this.megaMekAvailabilityCatalog.hydrateFromCache()
                && this.megaMekAvailabilityVersion() === 0) {
                this.bumpMegaMekAvailabilityVersion();
            }
        } catch (error) {
            this.logger.warn(`Saved availability catalog could not be loaded: ${this.describeError(error)}`);
        }
    }

    public ensureMegaMekCatalogsInitialized(): Promise<boolean> {
        return this.ensureCatalogGroupInitialized([
            { name: 'megamek_availability', ensure: () => this.ensureMegaMekAvailabilityCatalogInitialized() },
            {
                name: 'megamek_factions',
                ensure: () => this.initializeCatalog('megamek_factions', () => this.megaMekFactionsCatalog.initialize()),
            },
            {
                name: 'megamek_rulesets',
                ensure: () => this.initializeCatalog('megamek_rulesets', () => this.megaMekRulesetsCatalog.initialize()),
            },
        ]);
    }

    private startAuxiliaryStartupCatalogs(): Promise<void> {
        const startedAt = Date.now();
        this.logger.info('[Background:auxiliary-catalogs] Started.');
        this.setAuxiliaryCatalogProgress({
            status: 'running', completed: 0, total: 1,
            detail: 'Loading optional presentation and rules catalogs',
        });
        return this.initializeStartupCatalogs()
            .then(ready => {
                if (ready) {
                    this.logger.info(
                        `[Background:auxiliary-catalogs] Finished in ${Math.max(0, Date.now() - startedAt)} ms.`,
                    );
                    this.setAuxiliaryCatalogProgress({ status: 'idle' });
                    return;
                }
                this.setAuxiliaryCatalogProgress({
                    status: 'error',
                    detail: 'One or more optional startup catalogs could not be loaded',
                });
            })
            .catch(error => {
                this.setAuxiliaryCatalogProgress({ status: 'error', detail: this.describeError(error) });
                this.logger.warn(
                    `[Background:auxiliary-catalogs] Failed after ${Math.max(0, Date.now() - startedAt)} ms: ${this.describeError(error)}`,
                );
            });
    }

    /**
     * Starts the single application-catalog bootstrap. Route-scoped services
     * may join this promise, but must never initialize required CatalogBase
     * services on their own: only the atomic bundle coordinator may publish
     * equipment, quirks, sourcebooks, eras, factions, sheets, and sprites.
     */
    public initialize(): Promise<void> {
        if (this.isDataReady()) return Promise.resolve();
        if (this.initialization) return this.initialization;
        const startedAt = Date.now();
        this.logger.info('[Startup] Loading local data.');
        let initialization!: Promise<void>;
        initialization = this.performInitialize()
            .then(() => {
                if (this.isDataReady()) {
                    this.logger.info(
                        `[Startup] Local data ready in ${Math.max(0, Date.now() - startedAt)} ms.`,
                    );
                }
            })
            .finally(() => {
                if (this.initialization === initialization) this.initialization = undefined;
            });
        this.initialization = initialization;
        return this.initialization;
    }

    /** Exact readiness gate for editor/mechanics routes entered during cold bootstrap. */
    public async requireApplicationCatalogReady(): Promise<void> {
        await this.initialize();
        if (!this.isDataReady()) {
            throw new Error('The complete application catalog is not ready');
        }
    }

    private async performInitialize(): Promise<void> {
        this.isDataReady.set(false);
        const applicationDatabaseReady = this.dbService.waitForDbReady();
        this.localSearchCatalogHydration = applicationDatabaseReady
            .then(() => this.hydrateSavedSearchCatalogs());
        try {
            await Promise.all([
                applicationDatabaseReady,
                this.localSearchCatalogHydration,
                this.checkForUpdate(),
            ]);
            // These catalogs enable optional features only. A slow/unavailable
            // request must never delay readiness after the exact core
            // application bundle and all required derived state are committed.
            this.auxiliaryStartupSettlement = this.startAuxiliaryStartupCatalogs();
            void this.auxiliaryStartupSettlement;
        } catch (error) {
            this.logger.error(`Failed to initialize data: ${this.describeError(error)}`);
            // Never promote length-only or mixed legacy caches to readiness.
            // A previously committed exact LKG remains interactive; a cold
            // start remains unavailable until a complete activation wins.
            if (this.appliedUnitCatalogRevision === 0) this.isDataReady.set(false);
        }
    }

    /** Build derived memberships without mutating a prepared or already-live catalog bundle. */
    private cloneEraFactionMembershipState(
        eras: readonly Era[],
        factions: readonly Faction[],
    ): { eras: Era[]; factions: Faction[] } {
        return {
            eras: eras.map(era => ({
                ...era,
                factions: new Set(era.factions),
                units: new Set(era.units),
            })),
            factions: factions.map(faction => ({
                ...faction,
                eras: Object.fromEntries(
                    Object.entries(faction.eras).map(([eraId, units]) => [
                        eraId,
                        new Set(units),
                    ]),
                ),
            })),
        };
    }

    /* ----------------------------------------------------------
     * Force Pack Lookups (lazily built, cached globally)
     */

    /**
     * Build both force pack lookup maps on first use.
        * - forcePackToLookupKey: packName -> Set<chassis|as.TP|omni>
        * - lookupKeyToForcePacks: chassis|as.TP|omni -> sorted packName[]
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
                        const key = getUnitVariantGroupKey(unit);
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
    * Check if a unit belongs to a force pack (by variants).
     */
    public unitBelongsToForcePack(unit: UnitSummary, packName: string): boolean {
        if (!this.forcePackToLookupKey) this.buildForcePackCaches();
        const lookupSet = this.forcePackToLookupKey!.get(packName);
        if (!lookupSet) return false;
        return lookupSet.has(getUnitVariantGroupKey(unit));
    }

    /**
    * Get the variants set for a force pack (for bulk filtering).
     */
    public getForcePackLookupSet(packName: string): Set<string> | undefined {
        if (!this.forcePackToLookupKey) this.buildForcePackCaches();
        return this.forcePackToLookupKey!.get(packName);
    }

    /**
    * Get the sorted list of force pack names that contain a unit's variants.
     */
    public getForcePacksForUnit(unit: UnitSummary): string[] {
        if (!this.lookupKeyToForcePacks) this.buildForcePackCaches();
        return this.lookupKeyToForcePacks!.get(getUnitVariantGroupKey(unit)) ?? [];
    }

}
