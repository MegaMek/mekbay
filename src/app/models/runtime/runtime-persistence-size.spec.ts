// SPDX-License-Identifier: GPL-3.0-or-later

import { createMekUnit } from './cbt-mek-unit';
import { createNonMekUnit } from './cbt-non-mek-unit';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { TestTankEntity } from '../entity/testing/test-entities';

describe('compact runtime persistence', () => {
    it('does not copy pristine Mek topology into sparse state', async () => {
        const unit = await pristineMek();

        expect(Object.keys(unit.blueprintReferences.targets)).toEqual([]);
        expect(byteLength(unit)).toBeLessThan(2_000);
    });

    it('does not copy pristine non-Mek topology into sparse state', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
        entity.uuid.set(uuid);
        entity.setTonnage(20);
        const identity = uuid;
        const unit = createNonMekUnit(entity, {
            instanceId: 'unit:size-tank',
            uuid: identity,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek',
        }).serialize();

        expect(Object.hasOwn(unit, 'references')).toBeFalse();
        expect(byteLength(unit)).toBeLessThan(1_500);
    });
});

async function pristineMek() {
    const fixture = createDirectMekRuntimeFixture();
    return (await createMekUnit({
        uuid: fixture.identity,
        instanceId: 'unit:size-template',
    }, fixture.entity, fixture.identity, {
            profileId: 'pristine',
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
    })).serialize();
}

function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}
