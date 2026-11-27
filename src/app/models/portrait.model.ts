// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export const PORTRAIT_SETS = ['Male', 'Female'] as const;
export type PortraitSet = typeof PORTRAIT_SETS[number];

export interface PortraitPosition {
    readonly sheet: string;
    readonly set: PortraitSet;
    readonly category: string;
    readonly x: number;
    readonly y: number;
}

export interface PortraitSheet {
    readonly url: string;
    /** Same SHA-1 content hash as the repository asset manifest and IndexedDB cache. */
    readonly hash: string;
    readonly width: number;
    readonly height: number;
}

export interface PortraitManifest {
    readonly width: number;
    readonly height: number;
    readonly sheets: Readonly<Record<string, PortraitSheet>>;
    /** Filename without its extension; independent of display category and sheet layout. */
    readonly portraits: Readonly<Record<string, PortraitPosition>>;
}
