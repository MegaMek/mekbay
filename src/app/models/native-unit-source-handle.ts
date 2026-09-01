// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    NativeUnitFormat,
    UnitFileName,
} from '../services/unit-catalog/unit-catalog.types';
import type { SourceHashCanary } from './source-hash-canary';

/** Exact detached native bytes owned by one loaded unit runtime. */
export interface NativeUnitSourceHandle {
    readonly file: UnitFileName;
    readonly format: NativeUnitFormat;
    readonly sourceHashCanary?: SourceHashCanary;
    readonly bytes: ArrayBuffer;
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
        bytes: source.bytes.slice(0),
    });
}
