// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentRegistry } from '../equipment-lookup';
import type {
    NativeUnitFormat,
    SourceHash,
    UnitFileName,
    UnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { asSourceHash } from '../../services/unit-catalog/unit-catalog.types';
import type { BaseEntity } from './base-entity';
import { parseEntity } from './parse-entity';
import type { EntityLoadIssue, ParseContextOptions } from './parsers/parse-context';

export interface NativeEntitySource {
    readonly uuid: UnitUuid;
    readonly format: NativeUnitFormat;
    readonly sourceHash: SourceHash;
    readonly bytes: ArrayBuffer;
    readonly file?: UnitFileName;
}

export interface LoadedEntity {
    readonly entity: BaseEntity;
    readonly source: NativeEntitySource;
}

export interface NativeEntitySourceRepository {
    read(uuid: UnitUuid): Promise<NativeEntitySource | undefined>;
}

export type EntityRepositoryErrorCode =
    | 'SOURCE_NOT_FOUND'
    | 'SOURCE_IDENTITY_MISMATCH'
    | 'UNSUPPORTED_NATIVE_FORMAT'
    | 'INVALID_SOURCE_HASH'
    | 'INVALID_UTF8'
    | 'PARSE_FAILED';

export class EntityRepositoryError extends Error {
    public constructor(
        public readonly code: EntityRepositoryErrorCode,
        message: string,
        public readonly diagnostics: readonly EntityLoadIssue[] = [],
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'EntityRepositoryError';
    }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** UUID/source-hash cache of canonical native-codec entities. */
export class EntityRepository {
    private readonly cache = new Map<string, Promise<LoadedEntity>>();

    public constructor(
        private readonly sources: NativeEntitySourceRepository,
        private readonly equipmentRegistry: EquipmentRegistry,
        private readonly parseOptions: ParseContextOptions = {},
    ) {}

    public async load(identity: Readonly<{
        uuid: UnitUuid;
        /** Lets generation-aware callers hit the canonical cache before source I/O. */
        sourceHash?: SourceHash;
    }>): Promise<LoadedEntity> {
        if (identity.sourceHash !== undefined) {
            const key = cacheKey(identity.uuid, identity.sourceHash);
            const cached = this.cache.get(key);
            if (cached !== undefined) return cached;
            const loading = this.loadSource(identity, identity.sourceHash);
            this.cache.set(key, loading);
            try {
                return await loading;
            } catch (error) {
                if (this.cache.get(key) === loading) this.cache.delete(key);
                throw error;
            }
        }

        const source = captureSource(await this.sources.read(identity.uuid));
        if (source === undefined) {
            throw new EntityRepositoryError(
                'SOURCE_NOT_FOUND',
                `Native source is not installed for ${identity.uuid}`,
            );
        }
        if (source.uuid !== identity.uuid) {
            throw new EntityRepositoryError(
                'SOURCE_IDENTITY_MISMATCH',
                'Native source repository returned a different unit UUID',
            );
        }
        validateSource(source);
        const key = cacheKey(source.uuid, source.sourceHash);
        const cached = this.cache.get(key);
        if (cached !== undefined) return cached;

        const loading = Promise.resolve().then(() => loadedEntity(
            source, this.equipmentRegistry, this.parseOptions,
        ));
        this.cache.set(key, loading);
        try {
            return await loading;
        } catch (error) {
            if (this.cache.get(key) === loading) this.cache.delete(key);
            throw error;
        }
    }

    public clear(): void {
        this.cache.clear();
    }

    private async loadSource(
        identity: Readonly<{ uuid: UnitUuid }>,
        expectedHash: SourceHash,
    ): Promise<LoadedEntity> {
        const source = captureSource(await this.sources.read(identity.uuid));
        if (source === undefined) {
            throw new EntityRepositoryError(
                'SOURCE_NOT_FOUND',
                `Native source is not installed for ${identity.uuid}`,
            );
        }
        if (source.uuid !== identity.uuid || source.sourceHash !== expectedHash) {
            throw new EntityRepositoryError(
                'SOURCE_IDENTITY_MISMATCH',
                'Native source repository returned a different UUID/source revision',
            );
        }
        validateSource(source);
        return loadedEntity(source, this.equipmentRegistry, this.parseOptions);
    }
}

function cacheKey(uuid: UnitUuid, hash: SourceHash): string {
    return `${uuid}\0${hash}`;
}

function loadedEntity(
    source: NativeEntitySource,
    equipmentRegistry: EquipmentRegistry,
    parseOptions: ParseContextOptions,
): LoadedEntity {
    return Object.freeze({
        entity: parseNativeEntity(source, equipmentRegistry, parseOptions),
        source,
    });
}

export function parseNativeEntity(
    source: NativeEntitySource,
    equipmentRegistry: EquipmentRegistry,
    parseOptions: ParseContextOptions = {},
): BaseEntity {
    validateSource(source);
    let raw: string;
    try {
        raw = UTF8.decode(source.bytes);
    } catch (error) {
        throw new EntityRepositoryError(
            'INVALID_UTF8',
            'Native entity source is not valid UTF-8',
            [],
            { cause: error },
        );
    }

    let parsed: ReturnType<typeof parseEntity>;
    try {
        parsed = parseEntity(raw, `${source.uuid}.${source.format}`, equipmentRegistry, parseOptions);
    } catch (error) {
        throw new EntityRepositoryError(
            'PARSE_FAILED',
            'Native entity source could not be parsed',
            [],
            { cause: error },
        );
    }
    if (parsed.entity.uuid() !== source.uuid) {
        throw new EntityRepositoryError(
            'SOURCE_IDENTITY_MISMATCH',
            'Parsed native source UUID does not match its catalog identity',
            parsed.diagnostics,
        );
    }
    return parsed.entity;
}

function validateSource(source: NativeEntitySource): void {
    if (source.format !== 'mtf' && source.format !== 'blk') {
        throw new EntityRepositoryError(
            'UNSUPPORTED_NATIVE_FORMAT',
            `Unsupported native entity format ${String(source.format)}`,
        );
    }
    try {
        asSourceHash(source.sourceHash);
    } catch {
        throw new EntityRepositoryError('INVALID_SOURCE_HASH', 'Native source hash is invalid');
    }
}

function captureSource(source: NativeEntitySource | undefined): NativeEntitySource | undefined {
    return source === undefined
        ? undefined
        : Object.freeze({ ...source, bytes: source.bytes.slice(0) });
}
