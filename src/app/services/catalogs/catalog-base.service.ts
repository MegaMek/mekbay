import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { LoggerService } from '../logger.service';
import { generateUUID } from '../ws.service';

export abstract class CatalogBaseService<THydrateInput, TStored extends THydrateInput, TRemoteBody = TStored> {
    protected readonly http = inject(HttpClient);
    protected readonly logger = inject(LoggerService);
    protected etag = '';

    public async initialize(): Promise<void> {
        const localData = await this.loadFromCache();
        if (localData) {
            this.hydrate(localData);
        }

        const remoteEtag = await this.getRemoteEtag();
        if (!remoteEtag) {
            if (this.hasHydratedData()) {
                this.logger.info(`${this.catalogKey} loaded from cache (offline or remote unavailable).`);
                return;
            }

            await this.fetchRemote();
            return;
        }

        if (this.etag && this.etag === remoteEtag) {
            this.logger.info(`${this.catalogKey} is up to date. (ETag: ${remoteEtag})`);
            return;
        }

        await this.fetchRemote();
    }

    protected abstract get catalogKey(): string;
    protected abstract get remoteUrl(): string;
    protected abstract hasHydratedData(): boolean;
    protected abstract loadFromCache(): Promise<THydrateInput | undefined>;
    protected abstract saveToCache(data: TStored): Promise<void>;
    protected abstract hydrate(data: THydrateInput): void;
    protected abstract normalizeFetchedData(data: TRemoteBody, etag: string): TStored;

    protected async getRemoteEtag(): Promise<string> {
        try {
            const response = await firstValueFrom(this.http.head(this.remoteUrl, {
                observe: 'response',
                responseType: 'text',
            }));
            return response.headers.get('ETag') || '';
        } catch (error: any) {
            this.logger.warn(`Failed to fetch ETag for ${this.remoteUrl}: ${error?.message ?? error}`);
            return '';
        }
    }

    protected async fetchRemote(): Promise<void> {
        this.logger.info(`Downloading ${this.catalogKey}...`);

        const response = await firstValueFrom(this.http.get<TRemoteBody>(this.remoteUrl, {
            observe: 'response',
            reportProgress: false,
        }));

        const body = response.body;
        if (!body) {
            throw new Error(`No body received for ${this.catalogKey}`);
        }

        const etag = response.headers.get('ETag') || generateUUID();
        const wrappedData = this.normalizeFetchedData(body, etag);
        await this.saveToCache(wrappedData);
        this.hydrate(wrappedData);
        this.logger.info(`${this.catalogKey} updated. (ETag: ${etag})`);
    }
}