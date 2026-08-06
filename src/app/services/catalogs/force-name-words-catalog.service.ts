// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import { DbService } from '../db.service';
import { createEmptyForceNameWords, type ForceNameWords, type ForceNameWordsData } from '../../models/force-name-words.model';
import { CatalogBaseService } from './catalog-base.service';

type ForceNameWordsRemoteBody = ForceNameWordsData | ForceNameWords;

function isForceNameWordsData(data: ForceNameWordsRemoteBody): data is ForceNameWordsData {
    return 'etag' in data && 'words' in data;
}

function normalizeWords(rawWords: Partial<ForceNameWords> | undefined): ForceNameWords {
    return {
        middleWordCorporate: normalizeStringArray(rawWords?.middleWordCorporate),
        endWordCorporate: normalizeStringArray(rawWords?.endWordCorporate),
        middleWordMercenary: normalizeStringArray(rawWords?.middleWordMercenary),
        endWordMercenary: normalizeStringArray(rawWords?.endWordMercenary),
        preFab: normalizeStringArray(rawWords?.preFab),
    };
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function normalizeData(data: ForceNameWordsRemoteBody, etag: string): ForceNameWordsData {
    if (isForceNameWordsData(data)) {
        return {
            etag: data.etag || etag,
            words: normalizeWords(data.words),
        };
    }

    return {
        etag,
        words: normalizeWords(data),
    };
}

function getWordCount(words: ForceNameWords): number {
    return words.middleWordCorporate.length
        + words.endWordCorporate.length
        + words.middleWordMercenary.length
        + words.endWordMercenary.length
        + words.preFab.length;
}

function hasAllWordLists(words: ForceNameWords): boolean {
    return words.middleWordCorporate.length > 0
        && words.endWordCorporate.length > 0
        && words.middleWordMercenary.length > 0
        && words.endWordMercenary.length > 0
        && words.preFab.length > 0;
}

@Injectable({
    providedIn: 'root'
})
export class ForceNameWordsCatalogService extends CatalogBaseService<ForceNameWordsRemoteBody, ForceNameWordsData, ForceNameWordsRemoteBody> {
    private readonly dbService = inject(DbService);

    private words = createEmptyForceNameWords();

    protected override get catalogKey(): string {
        return 'force_name_words';
    }

    protected override get remoteUrl(): string {
        return 'assets/force-name-words.json';
    }

    public getWords(): ForceNameWords {
        return this.words;
    }

    protected override hasHydratedData(): boolean {
        return hasAllWordLists(this.words);
    }

    protected override async loadFromCache(): Promise<ForceNameWordsData | undefined> {
        return await this.dbService.getForceNameWords() ?? undefined;
    }

    protected override saveToCache(data: ForceNameWordsData): Promise<void> {
        return this.dbService.saveForceNameWords(data);
    }

    protected override hydrate(data: ForceNameWordsRemoteBody): void {
        const wrappedData = normalizeData(data, isForceNameWordsData(data) ? data.etag : '');
        this.words = wrappedData.words;
        this.etag = wrappedData.etag;
    }

    protected override normalizeFetchedData(data: ForceNameWordsRemoteBody, etag: string): ForceNameWordsData {
        return normalizeData(data, etag);
    }

    protected override getDatasetSize(data: ForceNameWordsRemoteBody): number {
        return getWordCount(normalizeData(data, '').words);
    }

    protected override getMinimumDatasetSize(): number {
        return 100;
    }
}