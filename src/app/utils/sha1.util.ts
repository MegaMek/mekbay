// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Native browser checksum used only to detect corrupt or incomplete downloads. */
export async function sha1Base64Url(source: BufferSource): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-1', source);
    let binary = '';
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
