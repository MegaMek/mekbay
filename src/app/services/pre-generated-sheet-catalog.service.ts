// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { REMOTE_HOST, normalizeUnitServerUrl } from '../models/common.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { withServiceWorkerBypass } from '../utils/service-worker-bypass.util';

const MAX_CATALOG_LENGTH = 16 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 100_000;
const MAX_SHEETS_PER_UNIT = 16;
const MAX_SHEET_PATH_LENGTH = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface PreGeneratedSheetAsset {
    readonly serverHost: string;
    readonly fileName: string;
}

type SheetCatalog = ReadonlyMap<string, readonly string[]>;

/** Lazily resolves the legacy sheets.json catalog without adding sheet paths to UnitSummary. */
@Injectable({ providedIn: 'root' })
export class PreGeneratedSheetCatalogService {
    private readonly http = inject(HttpClient);
    private readonly catalogs = new Map<string, Promise<SheetCatalog>>();

    async resolve(unit: Pick<UnitSummary, 'uuid' | 'serverHost'>): Promise<readonly PreGeneratedSheetAsset[]> {
        const serverHost = resolveServerHost(unit.serverHost);
        const catalog = await this.catalog(serverHost);
        return (catalog.get(unit.uuid) ?? []).map(fileName => Object.freeze({ serverHost, fileName }));
    }

    private catalog(serverHost: string): Promise<SheetCatalog> {
        const existing = this.catalogs.get(serverHost);
        if (existing) return existing;

        const pending = this.download(serverHost).catch(error => {
            this.catalogs.delete(serverHost);
            throw error;
        });
        this.catalogs.set(serverHost, pending);
        return pending;
    }

    private async download(serverHost: string): Promise<SheetCatalog> {
        const url = withServiceWorkerBypass(`${serverHost}/sheets.json`);
        const wireJson = await firstValueFrom(this.http.get(url, { responseType: 'text' }));
        if (wireJson.length > MAX_CATALOG_LENGTH) {
            throw new Error(`sheets.json exceeds ${MAX_CATALOG_LENGTH} characters`);
        }
        return parsePreGeneratedSheetCatalog(wireJson);
    }
}

export function parsePreGeneratedSheetCatalog(wireJson: string): SheetCatalog {
    let value: unknown;
    try {
        value = JSON.parse(wireJson) as unknown;
    } catch (error) {
        throw new Error(`Invalid sheets.json: ${describeError(error)}`);
    }
    if (!isObject(value)) throw new Error('sheets.json must be an object');

    const entries = Object.entries(value);
    if (entries.length > MAX_CATALOG_ENTRIES) {
        throw new Error(`sheets.json exceeds ${MAX_CATALOG_ENTRIES} entries`);
    }

    const catalog = new Map<string, readonly string[]>();
    for (const [uuid, rawPaths] of entries) {
        if (!UUID_PATTERN.test(uuid)) throw new Error(`sheets.json contains invalid unit UUID ${uuid}`);
        if (!Array.isArray(rawPaths) || rawPaths.length > MAX_SHEETS_PER_UNIT) {
            throw new Error(`sheets.json[${uuid}] must be an array of at most ${MAX_SHEETS_PER_UNIT} paths`);
        }
        const paths = rawPaths.map((path, index) => validateSheetPath(path, `${uuid}[${index}]`));
        catalog.set(uuid, Object.freeze(paths));
    }
    return catalog;
}

function validateSheetPath(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SHEET_PATH_LENGTH) {
        throw new Error(`sheets.json[${field}] must be a nonempty bounded path`);
    }
    const segments = value.split('/');
    if (
        value.startsWith('/')
        || value.includes('\\')
        || value.includes('?')
        || value.includes('#')
        || !value.toLowerCase().endsWith('.svg')
        || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
    ) {
        throw new Error(`sheets.json[${field}] contains an unsafe SVG path`);
    }
    return value;
}

function resolveServerHost(serverHost: string | undefined): string {
    if (serverHost === undefined) return REMOTE_HOST;
    const normalized = normalizeUnitServerUrl(serverHost);
    if (!normalized) throw new Error(`Invalid record-sheet server URL: ${serverHost}`);
    return normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
