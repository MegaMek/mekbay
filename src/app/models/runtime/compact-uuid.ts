// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const COMPACT_UUID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

/** Keep opaque imported identities intact while shortening generated UUIDs. */
export function packOpaqueId(value: string): string {
    if (UUID_PATTERN.test(value)) return `~${packUuid(value)}`;
    return value.startsWith('~') ? `~${value}` : value;
}

export function unpackOpaqueId(value: string, path: string): string {
    if (!value.startsWith('~')) return value;
    if (value.startsWith('~~')) return value.slice(1);
    return COMPACT_UUID_PATTERN.test(value.slice(1))
        ? unpackUuid(value.slice(1), path)
        : value;
}

export function packUuid(value: string): string {
    if (!UUID_PATTERN.test(value)) throw new Error('UUID is invalid');
    const hex = value.replaceAll('-', '').toLowerCase();
    let bytes = '';
    for (let index = 0; index < hex.length; index += 2) {
        bytes += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    return btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function unpackUuid(value: string, path: string): string {
    if (!COMPACT_UUID_PATTERN.test(value)) throw new Error(`${path} is not a compact UUID`);
    let bytes: string;
    try {
        bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==');
    } catch {
        throw new Error(`${path} is not a compact UUID`);
    }
    if (bytes.length !== 16) throw new Error(`${path} is not a compact UUID`);
    const hex = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return [
        hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
        hex.slice(16, 20), hex.slice(20),
    ].join('-');
}
