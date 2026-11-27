// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


export interface Sourcebook {
    id: number;
    sku: string;
    abbrev: string;
    title: string;
    url?: string;
    mul_url?: string;
    image?: string;
    canon: boolean;
}

export interface UnknownSourcebookReference {
    readonly abbrev: string;
    readonly canon: false;
    readonly unresolved: true;
}

export type SourcebookReference = Sourcebook | UnknownSourcebookReference;

export interface Sourcebooks {
    assetHash: string;
    sourcebooks: Sourcebook[];
}
