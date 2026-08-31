// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ReadyMekUnitFactory } from '../models/runtime/ready-unit-factory';
import { asCommandId, asStateRevision, asUnitInstanceId } from '../models/runtime/runtime-state';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';

describe('ReadyMekUnitFactory direct entity boundary', () => {
    it('creates and restores one effective unit around the same pristine entity', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const factory = readyFactory();
        const ready = await factory.createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:ready'),
        }, fixture.entity, fixture.identity);
        const face = [...ready.getIndex().armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;

        expect(ready.getUnit()).toBe(fixture.entity);
        expect(ready.getInstance().matchesEntity(fixture.entity)).toBeTrue();
        expect(ready.getInstance().query().heatCapability().kind).toBe('supported');
        expect(ready.getInstance().query().mekDestruction().kind).toBe('supported');
        expect(ready.getInstance().dispatch({
            type: 'damage-armor', commandId: asCommandId('ready:damage'),
            expectedRevision: asStateRevision(0), faceId: face.id, amount: 1, target: 'committed',
        }).accepted).toBeTrue();

        const saved = ready.serialize();
        const restored = await factory.restoreFromEntity(saved, fixture.entity, fixture.identity);
        expect(restored.getUnit()).toBe(fixture.entity);
        expect(restored.getInstance().query().remainingArmor(face.id)).toBe(face.maximumPoints - 1);
        expect(Object.prototype.hasOwnProperty.call(saved.baselineRefAtSave, 'published')).toBeFalse();
    });

});

function readyFactory(): ReadyMekUnitFactory {
    return new ReadyMekUnitFactory({
        initializeOptions: {
            initializerRevision: 1,
            profileId: 'pristine',
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
        },
    });
}
