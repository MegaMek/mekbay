// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Units } from '../../models/unit-summary.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import {
    CustomProviderCatalogValidationError,
    customProviderIdForServer,
    importCustomProviderUnits,
} from './custom-provider-catalog';

const SERVER = 'https://custom.example';
const UUID = '019f6767-0dcb-7bb8-992f-000000000100';

function dataset(...units: Units['units']): Units {
    return { version: '1', assetHash: 'provider-revision-1', units };
}

describe('custom provider catalog import', () => {
    it('uses a stable provider-scoped identity and does not make JSON mechanics authority', async () => {
        const [first] = await importCustomProviderUnits(SERVER, dataset(createEmptyUnit({
            uuid: UUID,
        })));

        expect(first.provider).toBe(await customProviderIdForServer(SERVER));
        expect(first.provider).not.toBe(await customProviderIdForServer('https://other.example'));
        expect(first.uuid).toBe(UUID);
        expect(first.origin).toBe('user');
        expect(first.hash).toBe('provider-revision-1');
        expect(first.summaryVersion).toBeGreaterThan(0);
        expect(Object.prototype.hasOwnProperty.call(first, 'sourceRef')).toBeFalse();
        expect(Object.prototype.hasOwnProperty.call(first, 'readiness')).toBeFalse();
        expect(Object.prototype.hasOwnProperty.call(first, 'fluff')).toBeFalse();
    });

    it('rejects prose-bearing summary rows instead of preserving a legacy fluff shape', async () => {
        await expectAsync(importCustomProviderUnits(SERVER, dataset(createEmptyUnit({
            uuid: UUID,
            fluff: {
                overview: 'Remote prose must not enter the summary',
                systems: [{ label: 'Engine', manufacturer: 'Remote Works', model: 'R-1' }],
            },
        })))).toBeRejectedWithError(CustomProviderCatalogValidationError);
    });

    it('keeps identical UUIDs isolated by provider', async () => {
        const body = dataset(createEmptyUnit({ uuid: UUID }));
        const [left] = await importCustomProviderUnits(SERVER, body);
        const [right] = await importCustomProviderUnits('https://second.example', body);

        expect(left.uuid).toBe(right.uuid);
        expect(left.provider).not.toBe(right.provider);
    });

    it('rejects malformed, non-v7, and duplicate UUID records before publication', async () => {
        await expectAsync(importCustomProviderUnits(SERVER, dataset(createEmptyUnit({ uuid: 'not-a-uuid' })))).toBeRejectedWithError(CustomProviderCatalogValidationError);
        await expectAsync(importCustomProviderUnits(SERVER, dataset(
            createEmptyUnit({ uuid: UUID }),
            createEmptyUnit({ uuid: UUID }),
        ))).toBeRejectedWithError(CustomProviderCatalogValidationError);
        await expectAsync(importCustomProviderUnits(SERVER, {
            version: '1', assetHash: 'x', units: [{ uuid: UUID, name: 'Incomplete' }] as Units['units'],
        })).toBeRejectedWithError(CustomProviderCatalogValidationError);
    });
});
