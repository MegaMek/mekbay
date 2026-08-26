// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { REMOTE_HOST } from '../../models/common.model';
import type { FluffImageCatalog } from '../../models/presentation-catalog.model';
import { withServiceWorkerBypass } from '../../utils/service-worker-bypass.util';
import { MM_DATA_UNIT_PROVIDER_ID } from '../unit-catalog/unit-catalog.types';
import { LoggerService } from '../logger.service';
import { CatalogDownloadTrackerService } from './catalog-base.service';
import { FluffImageCatalogService } from './fluff-image-catalog.service';
import { buildFluffImageCatalog } from './presentation-catalog-builders';
import {
  MAX_PRESENTATION_CATALOG_WIRE_LENGTH,
  CatalogStorage,
  fluffImageCatalogKey,
  type StoredFluffImageCatalog,
} from './catalog-storage.service';
import {
  MEKBAY_DATA_IMAGES_MINIMUM,
  MEKBAY_PRESENTATION_MINIMUM_RELATIVE_SIZE,
} from './presentation-catalog-policy';

@Injectable({ providedIn: 'root' })
export class PresentationCatalogSyncService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(CatalogStorage);
  private readonly images = inject(FluffImageCatalogService);
  private readonly logger = inject(LoggerService);
  private readonly downloads = inject(CatalogDownloadTrackerService);
  private imagesInitialization?: Promise<void>;
  private imagesInitialized = false;

  initializeFluffImages(): Promise<void> {
    if (this.imagesInitialized) return Promise.resolve();
    if (this.imagesInitialization) return this.imagesInitialization;
    this.images.beginLoading(MM_DATA_UNIT_PROVIDER_ID);
    this.imagesInitialization = this.loadFluffImages()
      .then(() => { this.imagesInitialized = true; })
      .finally(() => { this.imagesInitialization = undefined; });
    return this.imagesInitialization;
  }

  private async loadFluffImages(): Promise<void> {
    let stored: StoredFluffImageCatalog | undefined;
    let cached: FluffImageCatalog | undefined;
    try {
      stored = await this.storage.getFluffImages(MM_DATA_UNIT_PROVIDER_ID);
      if (stored) {
        cached = this.buildFluffImages(stored.wireJson, stored.baseUrl);
        this.images.publish(cached);
      }
    } catch (error) {
      stored = undefined;
      this.logger.warn(`Ignoring invalid cached fluff-images catalog: ${describeError(error)}`);
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!cached) this.images.markUnavailable(MM_DATA_UNIT_PROVIDER_ID, 'offline-no-cache');
      return;
    }

    try {
      await this.refreshFluffImages(stored, cached);
    } catch (error) {
      this.logger.warn(`Failed to refresh fluff-images catalog: ${describeError(error)}`);
      if (!cached) {
        this.images.markUnavailable(
          MM_DATA_UNIT_PROVIDER_ID,
          error instanceof HttpErrorResponse ? 'offline-no-cache' : 'invalid-catalog',
        );
      }
    }
  }

  private async refreshFluffImages(
    stored: StoredFluffImageCatalog | undefined,
    cached: FluffImageCatalog | undefined,
  ): Promise<void> {
    let headers = new HttpHeaders();
    if (stored?.etag) headers = headers.set('If-None-Match', stored.etag);

    let response;
    try {
      response = await this.downloads.trackDownload(() => firstValueFrom(this.http.get(
        withServiceWorkerBypass(`${REMOTE_HOST}/images.json`),
        { observe: 'response', responseType: 'text', headers },
      )));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 304 && cached) return;
      throw error;
    }

    const wireJson = response.body;
    if (!wireJson) throw new Error('fluff-images response has no body');
    if (wireJson.length > MAX_PRESENTATION_CATALOG_WIRE_LENGTH) {
      throw new Error(`fluff-images response exceeds ${MAX_PRESENTATION_CATALOG_WIRE_LENGTH} characters`);
    }
    const catalog = this.buildFluffImages(wireJson, REMOTE_HOST, cached?.paths.length ?? 0);
    try {
      await this.storage.putFluffImages({
        key: fluffImageCatalogKey(MM_DATA_UNIT_PROVIDER_ID),
        provider: MM_DATA_UNIT_PROVIDER_ID,
        baseUrl: REMOTE_HOST,
        wireJson,
        etag: response.headers.get('ETag') ?? '',
      });
    } catch (error) {
      this.logger.warn(`Could not cache fluff-images catalog: ${describeError(error)}`);
    }
    this.images.publish(catalog);
  }

  private buildFluffImages(wireJson: string, baseUrl: string, previousSize = 0): FluffImageCatalog {
    return buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl,
      wireJson,
      validation: {
        minimumEntryCount: Math.max(
          MEKBAY_DATA_IMAGES_MINIMUM,
          Math.ceil(previousSize * MEKBAY_PRESENTATION_MINIMUM_RELATIVE_SIZE),
        ),
        maximumEntryCount: 100_000,
        maximumPathLength: 512,
      },
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
