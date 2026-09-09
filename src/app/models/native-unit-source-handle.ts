// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    NativeUnitFormat,
    SourceHash,
    UnitFileName,
} from '../services/unit-catalog/unit-catalog.types';
import type { SourceHashCanary } from './source-hash-canary';
import type { PinnedCustomUnitSource } from './pinned-custom-unit-source';

/** Exact detached native bytes owned by one loaded unit runtime. */
export interface NativeUnitSourceHandle {
    readonly file: UnitFileName;
    readonly format: NativeUnitFormat;
    readonly sourceHashCanary?: SourceHashCanary;
    readonly sourceHash?: SourceHash;
    readonly bytes: ArrayBuffer;
    /** Custom source bytes must travel with a saved force rather than follow catalog updates. */
    readonly isCustom?: true;
}

export function cloneNativeUnitSourceHandle(
    source: NativeUnitSourceHandle,
): NativeUnitSourceHandle {
    return Object.freeze({
        file: source.file,
        format: source.format,
        ...(source.sourceHashCanary === undefined
            ? {}
            : { sourceHashCanary: source.sourceHashCanary }),
        ...(source.sourceHash === undefined ? {} : { sourceHash: source.sourceHash }),
        bytes: source.bytes.slice(0),
        ...(source.isCustom ? { isCustom: true as const } : {}),
    });
}

export function pinnedCustomSourceForHandle(source: NativeUnitSourceHandle | undefined): PinnedCustomUnitSource | undefined {
    if (!source?.isCustom) return undefined;
    return Object.freeze({ format: source.format, source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.bytes) });
}
