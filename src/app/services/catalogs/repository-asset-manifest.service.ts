// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { sha1Base64Url } from '../../utils/sha1.util';

export const REPOSITORY_ASSETS_MANIFEST_PATH = 'online-assets/assets-manifest.json' as const;
export const MAX_REPOSITORY_ASSETS_MANIFEST_BYTES = 8 * 1_024 * 1_024;

const HASH_PATTERN = /^[A-Za-z0-9_-]{27}$/u;
const MAX_REPOSITORY_ASSET_BYTES = 512 * 1_024 * 1_024;

export interface RepositoryAssetDescriptor {
    readonly hash: string;
}

export type RepositoryAssetsManifest = Readonly<Record<string, string>>;

export interface VerifiedRepositoryAsset {
    readonly path: string;
    readonly descriptor: RepositoryAssetDescriptor;
    readonly bytes: ArrayBuffer;
}

export interface RepositoryAssetDownload {
    readonly path: string;
    readonly descriptor: RepositoryAssetDescriptor;
    readonly blob: Blob;
}

export interface RepositoryAssetReader {
    loadManifest(signal?: AbortSignal): Promise<RepositoryAssetsManifest>;
    descriptor(path: string, signal?: AbortSignal): Promise<RepositoryAssetDescriptor>;
    download(path: string, signal?: AbortSignal): Promise<RepositoryAssetDownload>;
    read(path: string, signal?: AbortSignal): Promise<VerifiedRepositoryAsset>;
}

export type RepositoryAssetFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const REPOSITORY_ASSET_FETCHER = new InjectionToken<RepositoryAssetFetcher>(
    'REPOSITORY_ASSET_FETCHER',
    { providedIn: 'root', factory: () => globalThis.fetch.bind(globalThis) },
);

@Injectable({ providedIn: 'root' })
export class RepositoryAssetManifestService implements RepositoryAssetReader {
    private readonly document = inject(DOCUMENT);
    private readonly fetcher = inject(REPOSITORY_ASSET_FETCHER);
    private manifestPromise?: Promise<RepositoryAssetsManifest>;

    public loadManifest(signal?: AbortSignal): Promise<RepositoryAssetsManifest> {
        if (signal?.aborted) return Promise.reject(abortError());
        if (!this.manifestPromise) {
            const load = this.fetchManifest();
            this.manifestPromise = load;
            void load.catch(() => {
                if (this.manifestPromise === load) this.manifestPromise = undefined;
            });
        }
        return signal === undefined ? this.manifestPromise : raceAbort(this.manifestPromise, signal);
    }

    public async descriptor(path: string, signal?: AbortSignal): Promise<RepositoryAssetDescriptor> {
        const canonicalPath = canonicalAssetPath(path);
        const hash = (await this.loadManifest(signal))[canonicalPath];
        if (!hash) throw new Error(`Repository asset is absent from assets-manifest.json: ${canonicalPath}`);
        return Object.freeze({ hash });
    }

    /** Downloads without hashing so a Worker can validate a large ZIP exactly once. */
    public async download(path: string, signal?: AbortSignal): Promise<RepositoryAssetDownload> {
        const canonicalPath = canonicalAssetPath(path);
        const descriptor = await this.descriptor(canonicalPath, signal);
        const response = await this.fetcher(bypassServiceWorker(new URL(canonicalPath, this.document.baseURI)), {
            method: 'GET',
            cache: 'no-cache',
            credentials: 'same-origin',
            redirect: 'error',
            signal,
        });
        if (!response.ok || response.status !== 200 || response.redirected) {
            throw new Error(`Repository asset ${canonicalPath} returned HTTP ${response.status}`);
        }
        const blob = await readBoundedBlob(response, MAX_REPOSITORY_ASSET_BYTES);
        return Object.freeze({ path: canonicalPath, descriptor, blob });
    }

    public async read(path: string, signal?: AbortSignal): Promise<VerifiedRepositoryAsset> {
        const download = await this.download(path, signal);
        const bytes = await download.blob.arrayBuffer();
        if (await sha1Base64Url(bytes) !== download.descriptor.hash) {
            throw new Error(`Repository asset ${download.path} is corrupt or incomplete`);
        }
        return Object.freeze({ path: download.path, descriptor: download.descriptor, bytes });
    }

    public async readText(path: string, signal?: AbortSignal): Promise<{
        readonly path: string;
        readonly descriptor: RepositoryAssetDescriptor;
        readonly text: string;
    }> {
        const asset = await this.read(path, signal);
        try {
            return Object.freeze({
                path: asset.path,
                descriptor: asset.descriptor,
                text: new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes),
            });
        } catch (error) {
            throw new Error(`Repository asset ${asset.path} is not valid UTF-8`, { cause: error });
        }
    }

    public async readJson<T>(path: string, signal?: AbortSignal): Promise<{
        readonly path: string;
        readonly descriptor: RepositoryAssetDescriptor;
        readonly value: T;
    }> {
        const asset = await this.readText(path, signal);
        try {
            return Object.freeze({ path: asset.path, descriptor: asset.descriptor, value: JSON.parse(asset.text) as T });
        } catch (error) {
            throw new Error(`Repository asset ${asset.path} is not valid JSON`, { cause: error });
        }
    }

    private async fetchManifest(): Promise<RepositoryAssetsManifest> {
        const response = await this.fetcher(
            bypassServiceWorker(new URL(REPOSITORY_ASSETS_MANIFEST_PATH, this.document.baseURI)),
            {
                method: 'GET',
                cache: 'no-cache',
                credentials: 'same-origin',
                redirect: 'error',
                headers: { Accept: 'application/json' },
            },
        );
        if (!response.ok || response.status !== 200 || response.redirected) {
            throw new Error(`Repository assets manifest returned HTTP ${response.status}`);
        }
        const bytes = await readBoundedResponse(response, MAX_REPOSITORY_ASSETS_MANIFEST_BYTES);
        let parsed: unknown;
        try {
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch (error) {
            throw new Error('Repository assets manifest is not valid JSON', { cause: error });
        }
        return normalizeRepositoryAssetsManifest(parsed);
    }
}

export function normalizeRepositoryAssetsManifest(value: unknown): RepositoryAssetsManifest {
    if (!isPlainObject(value) || Object.keys(value).length === 0) {
        throw new Error('Repository assets manifest must be a non-empty object');
    }
    const output: Record<string, string> = {};
    for (const [path, hash] of Object.entries(value)) {
        const canonicalPath = canonicalAssetPath(path);
        if (canonicalPath !== path || typeof hash !== 'string' || !HASH_PATTERN.test(hash)) {
            throw new Error(`Repository assets manifest contains an invalid entry: ${path}`);
        }
        output[path] = hash;
    }
    return Object.freeze(output);
}

export function canonicalAssetPath(value: string): string {
    if (!/^[A-Za-z0-9._ /-]+$/u.test(value)
        || value.startsWith('/')
        || value.includes('\\')
        || !value.startsWith('online-assets/')
        || value.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error(`Invalid repository asset path: ${value}`);
    }
    return value;
}

function bypassServiceWorker(url: URL): URL {
    const output = new URL(url.href);
    output.searchParams.set('ngsw-bypass', 'true');
    return output;
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<ArrayBuffer> {
    return (await readBoundedBlob(response, maximumBytes)).arrayBuffer();
}

async function readBoundedBlob(response: Response, maximumBytes: number): Promise<Blob> {
    const declaredLength = response.headers.get('Content-Length');
    if (declaredLength !== null
        && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
        throw new Error('Repository asset exceeds its byte ceiling');
    }
    const blob = await response.blob();
    if (blob.size < 1 || blob.size > maximumBytes) {
        throw new Error('Repository asset exceeds its byte ceiling');
    }
    return blob;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(abortError());
        signal.addEventListener('abort', abort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function abortError(): DOMException {
    return new DOMException('Repository asset request was cancelled', 'AbortError');
}
