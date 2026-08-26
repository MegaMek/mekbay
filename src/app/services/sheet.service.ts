// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { REMOTE_HOST, normalizeUnitServerUrl } from '../models/common.model';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { uuidv7 } from '../utils/uuid.util';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';

const SHEET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Downloads and caches legacy MegaMekLab SVG record sheets. */
@Injectable({ providedIn: 'root' })
export class SheetService {
    private readonly http = inject(HttpClient);
    private readonly dbService = inject(DbService);
    private readonly logger = inject(LoggerService);
    private readonly inFlight = new Map<string, Promise<SVGSVGElement>>();

    async getSheet(sheetFileName: string, rawServerHost: string = REMOTE_HOST): Promise<SVGSVGElement> {
        const serverHost = normalizeUnitServerUrl(rawServerHost);
        if (!serverHost) throw new Error(`Invalid record-sheet server URL: ${rawServerHost}`);
        assertSheetFileName(sheetFileName);

        const cacheKey = this.sheetCacheKey(sheetFileName, serverHost);
        const meta = await this.dbService.getSheetMeta(cacheKey);
        if (meta && Date.now() - meta.timestamp < SHEET_CACHE_MAX_AGE_MS) {
            const sheet = await this.dbService.getSheet(cacheKey);
            if (sheet) {
                this.logger.info(`Sheet ${cacheKey} loaded from cache (fresh).`);
                return sheet;
            }
        }

        const existing = this.inFlight.get(cacheKey);
        if (existing) return (await existing).cloneNode(true) as SVGSVGElement;

        const pending = this.getSheetFromNetwork(sheetFileName, serverHost, cacheKey, meta);
        this.inFlight.set(cacheKey, pending);
        try {
            return await pending;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    private sheetCacheKey(sheetFileName: string, serverHost: string): string {
        return serverHost === REMOTE_HOST ? sheetFileName : `${serverHost}::${sheetFileName}`;
    }

    private async getSheetFromNetwork(
        sheetFileName: string,
        serverHost: string,
        cacheKey: string,
        meta: { etag: string; timestamp: number } | null,
    ): Promise<SVGSVGElement> {
        const url = sheetUrl(serverHost, sheetFileName);
        const remoteEtag = await this.getRemoteETag(url);
        if (meta && (!remoteEtag || meta.etag === remoteEtag)) {
            const sheet = await this.dbService.getSheet(cacheKey);
            if (sheet) {
                if (remoteEtag) await this.dbService.touchSheet(cacheKey);
                this.logger.info(`Sheet ${cacheKey} loaded from cache (validated).`);
                return sheet;
            }
        }
        return this.fetchAndCacheSheet(url, sheetFileName, cacheKey);
    }

    private async getRemoteETag(url: string): Promise<string> {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return '';
        try {
            const response = await firstValueFrom(this.http.head(url, { observe: 'response' }));
            return response.headers.get('ETag') ?? '';
        } catch (error) {
            this.logger.warn(`Failed to fetch sheet ETag for ${url}: ${describeError(error)}`);
            return '';
        }
    }

    private async fetchAndCacheSheet(
        url: string,
        sheetFileName: string,
        cacheKey: string,
    ): Promise<SVGSVGElement> {
        this.logger.info(`Fetching sheet: ${cacheKey}`);
        try {
            const response = await firstValueFrom(this.http.get(url, {
                observe: 'response',
                responseType: 'text',
            }));
            if (!response.body) throw new Error(`No body received for sheet ${sheetFileName}`);

            const document = new DOMParser().parseFromString(response.body, 'image/svg+xml');
            if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
                throw new Error(`Invalid SVG content for sheet ${sheetFileName}`);
            }
            const svg = document.documentElement as unknown as SVGSVGElement;
            RsPolyfillUtil.fixSvg(svg);
            await this.dbService.saveSheet(cacheKey, svg, response.headers.get('ETag') ?? uuidv7());
            this.logger.info(`Sheet ${cacheKey} fetched and cached.`);
            return svg;
        } catch (error) {
            this.logger.error(`Failed to download sheet ${cacheKey}: ${describeError(error)}`);
            throw error;
        }
    }
}

function sheetUrl(serverHost: string, sheetFileName: string): string {
    const encodedPath = sheetFileName.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `${serverHost}/sheets/${encodedPath}`;
}

function assertSheetFileName(value: string): void {
    const segments = value.split('/');
    if (
        !value
        || value.length > 512
        || value.startsWith('/')
        || value.includes('\\')
        || value.includes('?')
        || value.includes('#')
        || !value.toLowerCase().endsWith('.svg')
        || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
    ) {
        throw new Error(`Invalid record-sheet path: ${value}`);
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
