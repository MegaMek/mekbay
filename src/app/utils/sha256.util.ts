// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type Sha256Input = string | ArrayBuffer | ArrayBufferView<ArrayBufferLike>;

const UTF8 = new TextEncoder();

export async function sha256Bytes(input: Sha256Input): Promise<Uint8Array<ArrayBuffer>> {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes(input)));
}

export async function sha256Base64Url(input: Sha256Input): Promise<string> {
    return toBase64Url(await sha256Bytes(input));
}

export async function sha256Hex(input: Sha256Input): Promise<string> {
    return [...await sha256Bytes(input)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function bytes(input: Sha256Input): Uint8Array<ArrayBuffer> {
    if (typeof input === 'string') return UTF8.encode(input);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return Uint8Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
}

function toBase64Url(input: Uint8Array): string {
    let binary = '';
    for (const byte of input) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
