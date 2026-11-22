// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { TestTankEntity } from '../entity/testing/test-entities';
import { createNonMekUnit } from './cbt-non-mek-unit';

import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { mekTargetRosterRow, entityTargetRosterRow } from './cbt-force-target-roster';

describe('CBT force target roster', () => {
    it('publishes a Narc pod at its hit location when the phase commits and forgets a cancelled attachment', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f1');
        entity.uuid.set(uuid);
        entity.setTonnage(40);
        const unit = createNonMekUnit(entity, { instanceId: 'pod', uuid, deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'total-warfare' }, initialStateProfileId: 'pristine-non-mek' });
        const locationId = [...unit.getIndex().locations.keys()][0];
        const attach = () => unit.dispatch({ type: 'set-location-condition', locationId, condition: 'narc', value: 1, target: 'pending' });
        const guided = () => entityTargetRosterRow('force', unit).tnCalculator.narcAboveWater;
        expect(attach().changed).toBeTrue();
        expect(guided()).toBeFalse();
        unit.dispatch({ type: 'cancel-pending' });
        expect(unit.snapshot().pendingCombat.narcPods).toBeUndefined();
        expect(attach().changed).toBeTrue();
        unit.dispatch({ type: 'end-phase' });
        expect(unit.snapshot().narcPods).toEqual([locationId]);
        expect(guided()).toBeTrue();
    });

    it('activates a new Core pod only after the current turn, even after committing phase damage', () => {
        const unit = createDirectMekRuntimeFixture().instance;
        const locationId = [...unit.getIndex().locations.values()].find(location => location.code === 'CT')!.id;
        const guided = () => mekTargetRosterRow('force', unit).tnCalculator.narcAboveWater;
        expect(unit.dispatch({ type: 'set-location-condition', locationId, condition: 'new-narc',
            value: 2, target: 'pending' }).changed).toBeTrue();
        expect(unit.dispatch({ type: 'end-phase' }).accepted).toBeTrue();
        expect(unit.query().locationCondition(locationId, 'new-narc', 'committed')).toBe(2);
        expect(guided()).toBeFalse();
        expect(unit.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
        expect(guided()).toBeTrue();
        expect(unit.query().locationCondition(locationId, 'narc', 'committed')).toBe(2);
    });

    it('projects non-Mek Entity turn cover into target-number facts', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5f1');
        entity.uuid.set(uuid);
        entity.setTonnage(40);
        entity.originalWalkMP.set(4);
        const ready = createNonMekUnit(entity, {
            instanceId: 'unit:target-roster-tank',
            uuid,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek',
        });
        const runtime = ready;
        expect(runtime.dispatch({
            type: 'set-movement',
            
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'set-cover',
            
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
