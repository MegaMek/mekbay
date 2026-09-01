// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestTankEntity } from '../entity/testing/test-entities';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import { entityTargetRosterRow } from './cbt-force-target-roster';

describe('CBT force target roster', () => {
    it('projects non-Mek Entity turn cover into target-number facts', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f1');
        entity.uuid.set(uuid);
        entity.setTonnage(40);
        entity.originalWalkMP.set(4);
        const ready = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:target-roster-tank',
            uuid,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const runtime = ready.getInstance();
        expect(runtime.dispatch({
            kind: 'set-movement',
            
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-cover',
            
            cover: 'building-1',
        }).accepted).toBeTrue();

        const row = entityTargetRosterRow('force:target-roster', ready);
        expect(row.projection).toBe('v2');
        expect(row.tnCalculator).toEqual(jasmine.objectContaining({
            targetMovementDistance: 4,
            targetMovementBracket: '3-4',
            targetHexCover: 'none',
            buildingCover: 'building-1',
            targetHeight: 1,
        }));
        expect(row.tnCalculator.waterDepth).toBeUndefined();
    });
});
