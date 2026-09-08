// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject, signal } from '@angular/core';
import { decodeSavedCustomUnit, type SavedCustomUnit } from '../models/custom-unit.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import { parseEntity } from '../models/entity/parse-entity';
import { encodeNativeEntity } from '../models/entity/write-entity';
import type { UnitSummary } from '../models/unit-summary.model';
import { sha1Base64Url } from '../utils/sha1.util';
import { uuidv7 } from '../utils/uuid.util';
import { UnitSummaryBuilder } from '../utils/unit-summary-builder';
import { createUnitIconResolver } from '../utils/unit-sprite-resolver';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import type { PreparedApplicationCatalogDependencies } from './unit-catalog/application-catalog-bundle-coordinator.service';
import { validateNativeUnitSource } from './unit-catalog/native-unit-source';
import {
    asSourceHash, asUnitUuid, makeUnitFileName, CUSTOM_UNIT_PROVIDER_ID,
    type StoredCoreContent, type UnitUuid,
} from './unit-catalog/unit-catalog.types';

export type { SavedCustomUnit } from '../models/custom-unit.model';
export interface SaveCustomUnitOptions {
    /** Present only when updating an existing custom design. Omit to create a new UUID. */
    readonly uuid?: UnitUuid;
    readonly originalUnitUuid?: UnitUuid;
}

/** Native design storage and an independently derived custom summary collection. */
@Injectable({ providedIn: 'root' })
export class CustomUnitsService {
    private readonly db = inject(DbService);
    private readonly logger = inject(LoggerService);
    private readonly recordsValue = signal<readonly SavedCustomUnit[]>([]);
    readonly records = this.recordsValue.asReadonly();
    private readonly summariesValue = signal<readonly UnitSummary[]>([]);
    readonly summaries = this.summariesValue.asReadonly();
    private readonly revisionValue = signal(0);
    readonly revision = this.revisionValue.asReadonly();
    private sources = new Map<UnitUuid, StoredCoreContent>();
    private dependencies?: PreparedApplicationCatalogDependencies;
    private initialization?: Promise<void>;
    private changes: Promise<unknown> = Promise.resolve();

    initialize(): Promise<void> {
        return this.initialization ??= this.hydrate();
    }

    async get(uuid: UnitUuid): Promise<SavedCustomUnit | undefined> {
        await this.initialize();
        return this.recordsValue().find(record => record.uuid === uuid);
    }

    async load(uuid: UnitUuid): Promise<BaseEntity> {
        const record = await this.get(uuid);
        if (!record) throw new Error('The custom unit no longer exists');
        return this.parse(record.source, record.uuid, record.format, this.requireDependencies());
    }

    /** A fresh parse prevents editor changes from mutating cached/force-owned entities. */
    detach(entity: BaseEntity): BaseEntity {
        return this.parse(encodeNativeEntity(entity), entity.uuid(),
            entity instanceof MekEntity ? 'mtf' : 'blk', this.requireDependencies());
    }

    /** Import and undo use the same equipment, sourcebook and quirk resolution as saved designs. */
    parseDraft(source: string, format: 'mtf' | 'blk'): BaseEntity {
        const dependencies = this.requireDependencies();
        return parseEntity(source, `construction.${format}`, dependencies.equipment.registry, {
            sourcebookResolver: key => dependencies.sourcebooks.sourcebooksByAbbrev.get(key),
            quirkResolver: key => dependencies.quirks.quirksByKey.get(key),
        }).entity;
    }

    save(entity: BaseEntity, options: SaveCustomUnitOptions = {}): Promise<SavedCustomUnit> {
        // Capture editor state synchronously; later UI edits cannot alter this save.
        const detached = this.detach(entity);
        return this.enqueue(async () => {
            await this.initialize();
            const existing = options.uuid ? await this.get(options.uuid) : undefined;
            if (options.uuid && !existing) throw new Error('Only an existing custom unit can be updated');
            const uuid = existing?.uuid ?? asUnitUuid(uuidv7());
            const originalUnitUuid = existing ? existing.originalUnitUuid : options.originalUnitUuid;
            detached.uuid.set(uuid);
            detached.mulId.set(-1);
            const now = Date.now();
            const record = decodeSavedCustomUnit({
                schemaVersion: 1, uuid,
                ...(originalUnitUuid ? { originalUnitUuid } : {}),
                createdAt: existing?.createdAt ?? now, updatedAt: now,
                format: detached instanceof MekEntity ? 'mtf' : 'blk',
                source: encodeNativeEntity(detached),
            });
            const source = await this.sourceFor(record);
            // Project the persisted native form before committing anything to disk.
            this.project(record, source, this.requireDependencies());
            await this.db.saveCustomUnit(record);
            this.sources.set(uuid, source);
            this.recordsValue.update(records => [record, ...records.filter(item => item.uuid !== uuid)]);
            this.revisionValue.update(value => value + 1);
            return record;
        });
    }

    delete(uuid: UnitUuid): Promise<void> {
        return this.enqueue(async () => {
            await this.initialize();
            await this.db.deleteCustomUnit(uuid);
            this.sources.delete(uuid);
            this.recordsValue.update(records => records.filter(record => record.uuid !== uuid));
            this.revisionValue.update(value => value + 1);
        });
    }

    /** Called with the exact candidate dependency bundle before search publication. */
    prepareSummaries(dependencies: PreparedApplicationCatalogDependencies): readonly UnitSummary[] {
        const summaries: UnitSummary[] = [];
        for (const record of this.recordsValue()) {
            try {
                const summary = this.project(record, this.sources.get(record.uuid)!, dependencies);
                // MUL identities are reserved for core units. Negative local IDs keep
                // derived era memberships distinct even when custom names duplicate.
                summary.id = -2 - summaries.length;
                summaries.push(summary);
            } catch (error) {
                this.logger.warn(`Cannot project custom unit ${record.uuid}: ${String(error)}`);
            }
        }
        return summaries;
    }

    commitSummaries(dependencies: PreparedApplicationCatalogDependencies, summaries: readonly UnitSummary[]): void {
        this.dependencies = dependencies;
        this.summariesValue.set(summaries);
    }

    captureSources(): ReadonlyMap<UnitUuid, StoredCoreContent> {
        return new Map(this.sources);
    }

    private async hydrate(): Promise<void> {
        const records: SavedCustomUnit[] = [];
        for (const value of await this.db.listCustomUnits()) {
            try {
                const record = decodeSavedCustomUnit(value);
                this.sources.set(record.uuid, await this.sourceFor(record));
                records.push(record);
            } catch (error) {
                this.logger.warn(`Skipping unreadable custom unit: ${String(error)}`);
            }
        }
        this.recordsValue.set(records.sort((a, b) => b.updatedAt - a.updatedAt));
        this.revisionValue.update(value => value + 1);
    }

    private async sourceFor(record: SavedCustomUnit): Promise<StoredCoreContent> {
        const bytes = new TextEncoder().encode(record.source).buffer;
        await validateNativeUnitSource(record.uuid, record.format, bytes);
        return Object.freeze({
            file: makeUnitFileName(record.uuid, record.format), format: record.format,
            hash: asSourceHash(await sha1Base64Url(bytes)), bytes,
        });
    }

    private project(record: SavedCustomUnit, source: StoredCoreContent,
        dependencies: PreparedApplicationCatalogDependencies): UnitSummary {
        const entity = this.parse(record.source, record.uuid, record.format, dependencies);
        const summary = new UnitSummaryBuilder(createUnitIconResolver(
            dependencies.sprites.assignmentContext.assignments,
        )).build(entity, {
            entryKey: {
                origin: 'user', design: { provider: CUSTOM_UNIT_PROVIDER_ID, uuid: record.uuid },
                sourceRevision: source.hash,
            }, format: record.format,
        });
        return { ...summary, isCustom: true, canon: false,
            ...(record.originalUnitUuid ? { originalUnitUuid: record.originalUnitUuid } : {}) };
    }

    private parse(source: string, uuid: UnitUuid, format: 'mtf' | 'blk',
        dependencies: PreparedApplicationCatalogDependencies): BaseEntity {
        const parsed = parseEntity(source, makeUnitFileName(uuid, format), dependencies.equipment.registry, {
            sourcebookResolver: key => dependencies.sourcebooks.sourcebooksByAbbrev.get(key),
            quirkResolver: key => dependencies.quirks.quirksByKey.get(key),
        });
        if (parsed.entity.uuid() !== uuid) throw new Error('Custom unit source UUID does not match its record');
        return parsed.entity;
    }

    private requireDependencies(): PreparedApplicationCatalogDependencies {
        if (!this.dependencies) throw new Error('The application catalog must be ready before editing custom units');
        return this.dependencies;
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.changes.then(operation);
        this.changes = next.catch(() => undefined);
        return next;
    }
}
