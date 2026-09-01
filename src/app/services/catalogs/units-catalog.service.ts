// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, computed, effect, inject, signal } from '@angular/core';

import type { UnitSummary } from '../../models/unit-summary.model';
import { materializeUnitSummaryView } from '../../utils/unit-summary-view';
import { LoggerService } from '../logger.service';
import {
    CoreUnitCatalogService,
    type PreparedCoreCatalogActivation,
} from '../unit-catalog/core-unit-catalog.service';
import {
    type CatalogActivationId,
    type StoredCoreContent,
    type UnitUuid,
} from '../unit-catalog/unit-catalog.types';

export interface UnitsCatalogSnapshot {
    readonly revision: number;
    readonly coreRevision: number;
    readonly coreActivationId?: CatalogActivationId;
    readonly summaries: readonly UnitSummary[];
    readonly units: UnitSummary[];
    readonly summariesByUuid: ReadonlyMap<UnitUuid, UnitSummary>;
}

export interface PreparedUnitsCatalogActivation {
    readonly revision: number;
    readonly coreRevision: number;
    readonly core: PreparedCoreCatalogActivation;
    readonly snapshot: UnitsCatalogSnapshot;
}

/**
 * Projects the one native MegaMek catalog into mutable search views.
 *
 * Native MTF/BLK content remains authoritative. UnitSummary exists only for
 * catalog/search presentation, and no remote summary-only overlay is accepted.
 */
@Injectable({ providedIn: 'root' })
export class UnitsCatalogService {
    private readonly core = inject(CoreUnitCatalogService);
    private readonly logger = inject(LoggerService);

    public readonly coreState = this.core.state;

    private readonly snapshotValue = signal<UnitsCatalogSnapshot>(Object.freeze({
        revision: 0,
        coreRevision: 0,
        summaries: Object.freeze([]),
        units: [],
        summariesByUuid: new Map<UnitUuid, UnitSummary>(),
    }));
    public readonly catalogSnapshot = this.snapshotValue.asReadonly();
    public readonly catalogRevision = computed(() => this.snapshotValue().revision);

    private readonly pendingActivationValue =
        signal<PreparedUnitsCatalogActivation | undefined>(undefined);
    public readonly pendingActivation = this.pendingActivationValue.asReadonly();
    private readonly liveCoreUpdatesEnabled = signal(false);
    private readonly nativeSourceLoads = new Map<string, Promise<StoredCoreContent | undefined>>();
    private nextPreparedRevision = 1;
    private initialized = false;
    private initialization?: Promise<void>;

    public constructor() {
        effect(() => {
            if (!this.liveCoreUpdatesEnabled()) return;
            const pending = this.core.pendingActivation();
            if (!pending || pending.revision === this.pendingActivationValue()?.coreRevision) return;
            this.prepareCoreActivation(pending);
        });
    }

    public initialize(): Promise<void> {
        if (this.initialized) return Promise.resolve();
        if (this.initialization) return this.initialization;
        this.initialization = this.performInitialize()
            .then(() => { this.initialized = true; })
            .finally(() => { this.initialization = undefined; });
        return this.initialization;
    }

    public getUnits(): UnitSummary[] {
        return this.snapshotValue().units;
    }

    public getCoreSummaries(): readonly UnitSummary[] {
        return this.snapshotValue().summaries;
    }

    public getCoreSummaryByUuid(uuid: UnitUuid): UnitSummary | undefined {
        return this.snapshotValue().summariesByUuid.get(uuid);
    }

    public async readNativeUnitSource(uuid: UnitUuid): Promise<StoredCoreContent | undefined> {
        const snapshot = this.core.catalogSnapshot();
        const activationId = snapshot.generation?.activationId;
        const loadKey = `${snapshot.revision}\0${activationId ?? ''}\0${uuid}`;
        let loading = this.nativeSourceLoads.get(loadKey);
        if (!loading) {
            loading = this.loadNativeUnitSource(uuid, snapshot.revision, activationId)
                .finally(() => this.nativeSourceLoads.delete(loadKey));
            this.nativeSourceLoads.set(loadKey, loading);
        }
        const source = await loading;
        return source ? cloneStoredCoreContent(source) : undefined;
    }

    /** DataService calls this only after every derived consumer has committed. */
    public acknowledgeCatalogRevisionApplied(revision: number): Promise<void> {
        const snapshot = this.snapshotValue();
        if (revision !== snapshot.revision || snapshot.coreActivationId === undefined) {
            return Promise.resolve();
        }
        return this.core.acknowledgeCatalogConsumersReady(
            snapshot.coreRevision,
            snapshot.coreActivationId,
        );
    }

    /** Final no-build switch invoked in the same turn as Core/Data commits. */
    public commitPendingActivation(revision: number): UnitsCatalogSnapshot | undefined {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return undefined;
        if (!this.core.commitPendingActivation(pending.core.revision)) return undefined;
        this.snapshotValue.set(pending.snapshot);
        this.pendingActivationValue.set(undefined);
        return pending.snapshot;
    }

    public async finalizePendingActivation(revision: number): Promise<boolean> {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return false;
        return this.core.finalizePendingActivation(pending.core.revision);
    }

    public rejectPendingActivation(revision: number, error: unknown): void {
        const pending = this.pendingActivationValue();
        if (!pending || pending.revision !== revision) return;
        this.pendingActivationValue.set(undefined);
        this.core.rejectPendingActivation(pending.core.revision, error);
    }

    private async performInitialize(): Promise<void> {
        await this.core.initialize();
        const pending = this.core.pendingActivation();
        if (!pending) {
            throw new Error('The core unit catalog prepared no complete activation');
        }
        this.prepareCoreActivation(pending);
        this.liveCoreUpdatesEnabled.set(true);
    }

    private prepareCoreActivation(
        core: PreparedCoreCatalogActivation,
    ): PreparedUnitsCatalogActivation {
        const existing = this.pendingActivationValue();
        if (existing?.coreRevision === core.revision) return existing;
        const snapshot = this.buildSnapshot(core);
        const prepared = Object.freeze({
            revision: snapshot.revision,
            coreRevision: core.revision,
            core,
            snapshot,
        });
        this.pendingActivationValue.set(prepared);
        return prepared;
    }

    private buildSnapshot(core: PreparedCoreCatalogActivation): UnitsCatalogSnapshot {
        const summaries = core.snapshot.summaries;
        for (const summary of summaries) {
            if (Object.prototype.hasOwnProperty.call(summary, 'fluff')) {
                throw new Error('Runtime catalog summary cannot contain native-source fluff');
            }
        }

        const summariesByUuid = new Map<UnitUuid, UnitSummary>();
        for (const summary of summaries) {
            summariesByUuid.set(summary.uuid, summary);
        }

        const previousUnitsByUuid = new Map<UnitUuid, UnitSummary>();
        const current = this.snapshotValue();
        for (let index = 0; index < current.units.length; index += 1) {
            const summary = current.summaries[index];
            const unit = current.units[index];
            if (summary && unit) previousUnitsByUuid.set(summary.uuid, unit);
        }
        const units = summaries.map(summary => {
            const unit = materializeUnitSummaryView(summary);
            const previous = previousUnitsByUuid.get(summary.uuid);
            if (previous) preserveTransientUnitOverlays(previous, unit);
            return unit;
        });

        return Object.freeze({
            revision: this.nextPreparedRevision++,
            coreRevision: core.revision,
            ...(core.snapshot.generation
                ? { coreActivationId: core.snapshot.generation.activationId }
                : {}),
            summaries,
            units,
            summariesByUuid,
        });
    }

    private async loadNativeUnitSource(
        uuid: UnitUuid,
        coreRevision: number,
        activationId: CatalogActivationId | undefined,
    ): Promise<StoredCoreContent | undefined> {
        const loaded = await this.core.readUnitSource(uuid);
        if (!loaded) return undefined;
        const current = this.core.catalogSnapshot();
        if (current.revision !== coreRevision
            || current.generation?.activationId !== activationId) {
            throw new Error('Core catalog generation changed while opening the native unit source');
        }
        const summary = this.snapshotValue().summaries.find(unit => unit.uuid === uuid);
        const unitLabel = summary ? ` for unit "${summary.name}"` : '';
        this.logger.info(
            `Opening native ${loaded.format.toUpperCase()} unit file "${loaded.file}"${unitLabel} (${uuid}).`,
        );
        return cloneStoredCoreContent(loaded);
    }
}

function cloneStoredCoreContent(source: StoredCoreContent): StoredCoreContent {
    return Object.freeze({
        file: source.file,
        hash: source.hash,
        format: source.format,
        bytes: source.bytes.slice(0),
    });
}

function preserveTransientUnitOverlays(source: UnitSummary, target: UnitSummary): void {
    target._nameTags = (source._nameTags ?? []).map(entry => ({ ...entry }));
    target._chassisTags = (source._chassisTags ?? []).map(entry => ({ ...entry }));
    target._publicTags = source._publicTags?.map(entry => ({ ...entry }));
}
