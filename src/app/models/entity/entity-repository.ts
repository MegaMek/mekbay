// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentRegistry } from '../equipment-lookup';
import type {
    NativeUnitFormat,
    SourceHash,
    UnitFileName,
    UnitProviderId,
    UnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { asSourceHash } from '../../services/unit-catalog/unit-catalog.types';
import type { BaseEntity } from './base-entity';
import { parseEntity } from './parse-entity';
import type { EntityLoadIssue, ParseContextOptions } from './parsers/parse-context';

export interface NativeEntitySource {
    readonly origin: 'megamek' | 'user';
    readonly provider: UnitProviderId;
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
    read(identity: Readonly<{
        provider: UnitProviderId;
        uuid: UnitUuid;
    }>): Promise<NativeEntitySource | undefined>;
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
    private readonly cache = new Map<string, Promise<BaseEntity>>();

    public constructor(
        private readonly sources: NativeEntitySourceRepository,
        private readonly equipmentRegistry: EquipmentRegistry,
        private readonly parseOptions: ParseContextOptions = {},
    ) {}

    public async load(identity: Readonly<{
        provider: UnitProviderId;
        uuid: UnitUuid;
    }>): Promise<LoadedEntity> {
        const source = captureSource(await this.sources.read(identity));
        if (source === undefined) {
            throw new EntityRepositoryError(
                'SOURCE_NOT_FOUND',
                `Native source is not installed for ${identity.provider}/${identity.uuid}`,
            );
        }
        if (source.provider !== identity.provider || source.uuid !== identity.uuid) {
            throw new EntityRepositoryError(
                'SOURCE_IDENTITY_MISMATCH',
                'Native source repository returned a different provider/UUID design',
            );
        }
        validateSource(source);
        const key = `${source.provider}\0${source.uuid}\0${source.sourceHash}`;
        const cached = this.cache.get(key);
        if (cached !== undefined) return Object.freeze({ entity: await cached, source });

        const loading = Promise.resolve().then(() => parseNativeEntity(
            source,
            this.equipmentRegistry,
            this.parseOptions,
        ));
        this.cache.set(key, loading);
        try {
            return Object.freeze({ entity: await loading, source });
        } catch (error) {
            if (this.cache.get(key) === loading) this.cache.delete(key);
            throw error;
        }
    }

    public clear(): void {
        this.cache.clear();
    }
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
