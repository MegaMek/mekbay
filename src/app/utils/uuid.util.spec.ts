// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { uuidv4 } from './uuid.util';

describe('uuid utilities', () => {
    it('creates a UUIDv4 when randomUUID is unavailable on a plain-HTTP LAN origin', () => {
        const cryptoWithoutRandomUuid = {
            getRandomValues(target: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
                target.fill(0xab);
                return target;
            },
        } as unknown as Crypto;

        expect(uuidv4(cryptoWithoutRandomUuid)).toBe('abababab-abab-4bab-abab-abababababab');
    });
});
