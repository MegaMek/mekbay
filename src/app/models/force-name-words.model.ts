// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface ForceNameWords {
    middleWordCorporate: string[];
    endWordCorporate: string[];
    middleWordMercenary: string[];
    endWordMercenary: string[];
    preFab: string[];
}

export interface ForceNameWordsData {
    assetHash: string;
    words: ForceNameWords;
}

export function createEmptyForceNameWords(): ForceNameWords {
    return {
        middleWordCorporate: [],
        endWordCorporate: [],
        middleWordMercenary: [],
        endWordMercenary: [],
        preFab: [],
    };
}
