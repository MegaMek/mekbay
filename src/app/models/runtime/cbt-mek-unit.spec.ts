// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CBTMekUnit } from './cbt-mek-unit';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('CBTMekUnit direct entity boundary', () => {
    it('creates and restores one effective unit around the same pristine entity', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await CBTMekUnit.createFromEntity({
            uuid: fixture.identity,
            instanceId: 'unit:ready',
        }, fixture.entity, fixture.identity, initializeOptions);
        const face = [...ready.getIndex().armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;

        expect(ready.getUnit()).toBe(fixture.entity);
        expect(ready.getInstance().matchesEntity(fixture.entity)).toBeTrue();
        expect(ready.getInstance().query().heatCapability().kind).toBe('supported');
        expect(ready.getInstance().query().mekDestruction().kind).toBe('supported');
        expect(ready.getInstance().dispatch({
            type: 'damage-armor',
            faceId: face.id, amount: 1, target: 'committed',
        }).accepted).toBeTrue();

        const saved = ready.serialize();
        const restored = await CBTMekUnit.restoreFromEntity(
            saved,
            fixture.entity,
            fixture.identity,
            initializeOptions,
        );
        expect(restored.getUnit()).toBe(fixture.entity);
        expect(restored.getInstance().query().remainingArmor(face.id)).toBe(face.maximumPoints - 1);
        expect(Object.prototype.hasOwnProperty.call(saved.baselineRefAtSave, 'published')).toBeFalse();
    });

});

const initializeOptions = {
    initializerRevision: 1,
    profileId: 'pristine',
    deployment: { id: 'default' },
    scenario: { id: 'megamek', ruleset: 'core-2026' as const },
};
