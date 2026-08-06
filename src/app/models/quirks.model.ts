// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


export interface Quirk {
    key: string;
    name: string;
    description: string;
    type: 'positive' | 'negative';
}

export interface Quirks {
    version: string;
    etag: string;
    quirks: Quirk[];
}