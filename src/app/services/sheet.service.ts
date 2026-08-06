// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { REMOTE_HOST } from '../models/common.model';
import { uuidv7 } from '../utils/uuid.util';

const SHEET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * 
 * Manages fetching, caching, and serving record-sheet SVGs.
 */
@Injectable({ providedIn: 'root' })
export class SheetService {
    private http = inject(HttpClient);
    private dbService = inject(DbService);
    private logger = inject(LoggerService);

    /** In-flight fetch deduplication: prevents duplicate network requests for the same sheet. */
    private inFlight = new Map<string, Promise<SVGSVGElement>>();

    /**
     * Returns the SVG for the given sheet file name, using a cache-first
     * strategy with ETag validation.
     *
     * Multiple parallel calls for the same sheet are deduplicated — only one
     * network request is made and the resulting SVG is cloned for each caller.
     */
    public async getSheet(sheetFileName: string, serverHost: string = REMOTE_HOST): Promise<SVGSVGElement> {
        const cacheKey = this.sheetCacheKey(sheetFileName, serverHost);
        // Fast path: fresh cache hit — no network, no deduplication needed.
        const meta = await this.dbService.getSheetMeta(cacheKey);
        const now = Date.now();
        const isFresh = meta && (now - meta.timestamp) < SHEET_CACHE_MAX_AGE_MS;

        if (isFresh) {
            const sheet = await this.dbService.getSheet(cacheKey);
            if (sheet) {
                this.logger.info(`Sheet ${cacheKey} loaded from cache (fresh).`);
                return sheet;
            }
        }

        // Slow path: needs network check. Deduplicate parallel calls for the same sheet.
        const existing = this.inFlight.get(cacheKey);
        if (existing) {
            this.logger.info(`Sheet ${cacheKey} already in-flight, waiting for existing request.`);
            const original = await existing;
            return original.cloneNode(true) as SVGSVGElement;
        }

        const promise = this.getSheetFromNetwork(sheetFileName, serverHost, cacheKey, meta);
        this.inFlight.set(cacheKey, promise);
        try {
            return await promise;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    /**
     * Builds the cache key for a sheet. Sheets from the primary host keep their bare file
     * name (preserving existing caches); sheets from additional unit servers are namespaced
     * by host so identically-named files from different servers never collide.
     */
    private sheetCacheKey(sheetFileName: string, serverHost: string): string {
        return serverHost === REMOTE_HOST ? sheetFileName : `${serverHost}::${sheetFileName}`;
    }

    /**
     * Validate ETag and fetch from remote if needed. Separated from getSheet()
     * so that the in-flight deduplication map can wrap this whole operation.
     */
    private async getSheetFromNetwork(
        sheetFileName: string,
        serverHost: string,
        cacheKey: string,
        meta: { etag: string; timestamp: number } | null,
    ): Promise<SVGSVGElement> {
        // Cache is stale or missing - check remote ETag
        const remoteEtag = await this.getRemoteETag(`${serverHost}/sheets/${sheetFileName}`);

        // If offline or same ETag, use cached version and refresh timestamp
        if (meta && (!remoteEtag || meta.etag === remoteEtag)) {
            const sheet = await this.dbService.getSheet(cacheKey);
            if (sheet) {
                if (remoteEtag) {
                    // ETag matched, refresh timestamp so we don't check again for SHEET_CACHE_MAX_AGE_MS
                    this.dbService.touchSheet(cacheKey);
                }
                this.logger.info(`Sheet ${cacheKey} loaded from cache (validated).`);
                return sheet;
            }
        }

        // Fetch fresh copy from remote
        return this.fetchAndCacheSheet(sheetFileName, serverHost, cacheKey);
    }

    private async getRemoteETag(url: string): Promise<string> {
        if (!navigator.onLine) {
            return '';
        }
        try {
            const resp = await firstValueFrom(
                this.http.head(url, { observe: 'response' as const })
            );
            const etag = resp.headers.get('ETag') || '';
            return etag;
        } catch (err: any) {
            this.logger.warn(`Failed to fetch ETag via HttpClient HEAD for ${url}: ${err.message ?? err}`);
            return '';
        }
    }

    private async fetchAndCacheSheet(sheetFileName: string, serverHost: string, cacheKey: string): Promise<SVGSVGElement> {
        this.logger.info(`Fetching sheet: ${cacheKey}`);
        const src = `${serverHost}/sheets/${sheetFileName}`;

        try {
            const response = await firstValueFrom(
                this.http.get(src, {
                    reportProgress: false,
                    observe: 'response' as const,
                    responseType: 'text' as const,
                })
            );
            const etag = response.headers.get('ETag') || uuidv7(); // Fallback to random UUID if no ETag
            const svgText = response.body;
            if (!svgText) {
                throw new Error(`No body received for sheet ${sheetFileName}`);
            }

            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');

            if (svgDoc.getElementsByTagName('parsererror').length) {
                throw new Error('Failed to parse SVG');
            }

            const svgElement = svgDoc.documentElement as unknown as SVGSVGElement;
            if (!svgElement) {
                throw new Error('Invalid SVG content: Failed to find the SVG root element after parsing.');
            }

            RsPolyfillUtil.fixSvg(svgElement);
            await this.dbService.saveSheet(cacheKey, svgElement, etag);
            this.logger.info(`Sheet ${cacheKey} fetched and cached.`);
            return svgElement;
        } catch (err) {
            this.logger.error(`Failed to download sheet ${cacheKey}: ` + err);
            throw err;
        }
    }
}
