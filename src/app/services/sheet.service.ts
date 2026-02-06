/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { generateUUID } from './ws.service';
import { RsPolyfillUtil } from '../utils/rs-polyfill.util';
import { REMOTE_HOST } from '../models/common.model';

const SHEET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Author: Drake
 * 
 * Manages fetching, caching, and serving record-sheet SVGs.
 */
@Injectable({ providedIn: 'root' })
export class SheetService {
    private http = inject(HttpClient);
    private dbService = inject(DbService);
    private logger = inject(LoggerService);

    /**
     * Returns the SVG for the given sheet file name, using a cache-first
     * strategy with ETag validation.
     */
    public async getSheet(sheetFileName: string): Promise<SVGSVGElement> {
        const meta = await this.dbService.getSheetMeta(sheetFileName);
        const now = Date.now();
        const isFresh = meta && (now - meta.timestamp) < SHEET_CACHE_MAX_AGE_MS;

        // If cache is fresh, use it without checking remote
        if (isFresh) {
            const sheet = await this.dbService.getSheet(sheetFileName);
            if (sheet) {
                this.logger.info(`Sheet ${sheetFileName} loaded from cache (fresh).`);
                return sheet;
            }
        }

        // Cache is stale or missing - check remote ETag
        const remoteEtag = await this.getRemoteETag(`${REMOTE_HOST}/sheets/${sheetFileName}`);

        // If offline or same ETag, use cached version and refresh timestamp
        if (meta && (!remoteEtag || meta.etag === remoteEtag)) {
            const sheet = await this.dbService.getSheet(sheetFileName);
            if (sheet) {
                if (remoteEtag) {
                    // ETag matched, refresh timestamp so we don't check again for SHEET_CACHE_MAX_AGE_MS
                    this.dbService.touchSheet(sheetFileName);
                }
                this.logger.info(`Sheet ${sheetFileName} loaded from cache (validated).`);
                return sheet;
            }
        }

        // Fetch fresh copy from remote
        return this.fetchAndCacheSheet(sheetFileName);
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

    private async fetchAndCacheSheet(sheetFileName: string): Promise<SVGSVGElement> {
        this.logger.info(`Fetching sheet: ${sheetFileName}`);
        const src = `${REMOTE_HOST}/sheets/${sheetFileName}`;

        try {
            const response = await firstValueFrom(
                this.http.get(src, {
                    reportProgress: false,
                    observe: 'response' as const,
                    responseType: 'text' as const,
                })
            );
            const etag = response.headers.get('ETag') || generateUUID(); // Fallback to random UUID if no ETag
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
            await this.dbService.saveSheet(sheetFileName, svgElement, etag);
            this.logger.info(`Sheet ${sheetFileName} fetched and cached.`);
            return svgElement;
        } catch (err) {
            this.logger.error(`Failed to download sheet ${sheetFileName}: ` + err);
            throw err;
        }
    }
}
