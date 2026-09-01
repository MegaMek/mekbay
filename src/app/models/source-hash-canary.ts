// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

declare const sourceHashCanaryBrand: unique symbol;

/** Four leading base64url hash characters: a compact 24-bit change canary. */
export type SourceHashCanary = string & {
    readonly [sourceHashCanaryBrand]: 'SourceHashCanary';
};

export const SOURCE_HASH_CANARY_LENGTH = 4;

const SOURCE_HASH_CANARY_PATTERN = /^[A-Za-z0-9_-]{4}$/u;

export function asSourceHashCanary(value: string): SourceHashCanary {
    if (!SOURCE_HASH_CANARY_PATTERN.test(value)) {
        throw new Error('Invalid source hash canary');
    }
    return value as SourceHashCanary;
}

export function sourceHashCanary(sourceHash: string): SourceHashCanary | undefined {
    const prefix = sourceHash.slice(0, SOURCE_HASH_CANARY_LENGTH);
    return SOURCE_HASH_CANARY_PATTERN.test(prefix)
        ? prefix as SourceHashCanary
        : undefined;
}

export function sourceHashCanaryChanged(
    saved: SourceHashCanary | undefined,
    currentSourceHash: string,
): boolean {
    if (saved === undefined) return false;
    const current = sourceHashCanary(currentSourceHash);
    return current !== undefined && current !== saved;
}
