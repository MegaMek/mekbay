// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    NativeUnitFormat,
    SourceHash,
    UnitFileName,
} from '../services/unit-catalog/unit-catalog.types';

/** Exact detached native bytes owned by one loaded unit runtime. */
export interface NativeUnitSourceHandle {
    readonly file: UnitFileName;
    readonly sourceHash: SourceHash;
    readonly format: NativeUnitFormat;
    readonly bytes: ArrayBuffer;
}

export function cloneNativeUnitSourceHandle(
    source: NativeUnitSourceHandle,
): NativeUnitSourceHandle {
    return Object.freeze({
        file: source.file,
        sourceHash: source.sourceHash,
        format: source.format,
        bytes: source.bytes.slice(0),
    });
}
