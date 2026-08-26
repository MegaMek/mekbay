// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asSourceHash,
    asUnitProviderId,
    asUnitUuid,
    decodeCatalogEntryDbKey,
    decodeDesignIdentityKey,
    encodeCatalogEntryKey,
    encodeDesignIdentity,
    makeUnitFileName,
    parseUnitFileName,
} from './unit-catalog.types';

describe('unit catalog identity', () => {
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const hash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');

    it('round-trips a provider and UUID without delimiter ambiguity', () => {
        const identity = { provider: asUnitProviderId('custom:server-1'), uuid };
        const encoded = encodeDesignIdentity(identity);

        expect(decodeDesignIdentityKey(encoded)).toEqual(identity);
        expect(() => decodeDesignIdentityKey(`${encoded}junk`)).toThrowError(/identity key/u);
    });

    it('round-trips the flat IndexedDB key', () => {
        const entry = {
            origin: 'megamek' as const,
            design: { provider: asUnitProviderId('mm-data'), uuid },
            sourceRevision: hash,
        };
        const encoded = encodeCatalogEntryKey(entry);

        expect(decodeCatalogEntryDbKey(encoded as unknown as IDBValidKey)).toEqual(entry);
    });

    it('derives and parses UUID filenames without a content-key abstraction', () => {
        const file = makeUnitFileName(uuid, 'mtf');

        expect(file).toBe(`${uuid}.mtf`);
        expect(parseUnitFileName(file)).toEqual({ file, uuid, format: 'mtf' });
        expect(() => parseUnitFileName(`${uuid}.json`)).toThrowError(/filename/u);
    });
});
