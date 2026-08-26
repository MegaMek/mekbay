// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { sha256Base64Url, sha256Hex } from './sha256.util';

describe('SHA-256 utilities', () => {
    const ABC_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    const ABC_BASE64_URL = 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0';

    it('keeps the asynchronous encodings identical', async () => {
        await expectAsync(sha256Hex('abc')).toBeResolvedTo(ABC_HEX);
        await expectAsync(sha256Base64Url('abc')).toBeResolvedTo(ABC_BASE64_URL);
    });
});
