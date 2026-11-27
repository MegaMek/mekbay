// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { TestAeroSpaceFighterEntity } from '../entity/testing/test-entities';
import { unitCommandHistory } from './cbt-force-runtime-history';
import type { CBTUnit } from './cbt-unit';
import { RUNTIME_HISTORY_MESSAGE } from './runtime-history';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { createNonMekRuntimeForTest } from './testing/unit-runtime-owner-fixture';
import type { CBTUnitCommand } from './unit-command';

describe('unit command history', () => {
    it('records pending heat with the same semantic event for Meks and aerospace units', () => {
        for (const unit of [createDirectMekRuntimeFixture('core-2026', 'history-mek').instance, fighter()]) {
            const before = snapshot(unit);
            const command: CBTUnitCommand = { type: 'set-pending-heat', heat: 6 };
            expect(unit.dispatch(command).changed).toBeTrue();
            expect<unknown>(unitCommandHistory(unit.instanceId, unit, command, before, snapshot(unit))).toEqual({
                messageId: RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED,
                data: [unit.instanceId, 1, 0, 6],
            });
        }
    });

    it('logs switching heat sinks as such, and leaves this turn\'s calculation to the sinks still on', () => {
        const unit = createDirectMekRuntimeFixture('core-2026', 'history-mek-sinks').instance;
        // 15 outside heat against 10 sinks calculates to 5; NEXT at 6 is +1. Once a move is assigned, sinks switched
        // off now stop dissipating from the next Heat Phase (Core p. 103), so NEXT stays where it is.
        expect(unit.dispatch({ type: 'declare-mek-movement',
            declaration: { mode: 'stationary', distance: 0, boosterComponentIds: [] } }).changed).toBeTrue();
        expect(unit.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).changed).toBeTrue();
        expect(unit.dispatch({ type: 'set-pending-heat', heat: 6, follow: true }).changed).toBeTrue();
        const before = snapshot(unit);
        const command: CBTUnitCommand = { type: 'set-heatsinks-off', heatsinksOff: 2 };
        expect(unit.dispatch(command).changed).toBeTrue();
        expect(unit.query().heatState().pendingOverride).toBe(6);
        expect<unknown>(unitCommandHistory(unit.instanceId, unit, command, before, snapshot(unit))).toEqual({
            messageId: RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED,
            data: [unit.instanceId, 2, 0, 2],
        });
    });

    it('logs the heat End Turn settled beside the turn ending, for Meks and aerospace units', () => {
        for (const unit of [createDirectMekRuntimeFixture('core-2026', 'history-mek-end').instance, fighter()]) {
            expect(unit.dispatch({ type: 'set-pending-heat', heat: 7 }).changed).toBeTrue();
            const before = snapshot(unit);
            const command: CBTUnitCommand = { type: 'end-turn', policy: 'automatic' };
            expect(unit.dispatch(command).changed).toBeTrue();
            expect<unknown>(unitCommandHistory(unit.instanceId, unit, command, before, snapshot(unit))).toEqual([
                { messageId: RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, data: [unit.instanceId, 0, 0, 7] },
                { messageId: RUNTIME_HISTORY_MESSAGE.TURN_ENDED, data: [unit.instanceId] },
            ]);
        }
    });

    it('preserves non-Mek airborne changes as a dedicated event', () => {
        const unit = fighter();
        const before = snapshot(unit);
        const command: CBTUnitCommand = { type: 'set-airborne', airborne: true };
        expect(unit.dispatch(command).changed).toBeTrue();
        expect<unknown>(unitCommandHistory(unit.instanceId, unit, command, before, snapshot(unit))).toEqual([{
            messageId: RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED,
            data: [unit.instanceId, -1, 1],
        }]);
    });

    it('preserves Mek location condition history while sharing the general command switch', () => {
        const unit = createDirectMekRuntimeFixture('core-2026', 'history-mek-location').instance;
        const locationId = [...unit.getIndex().locations.values()].find(location => location.code === 'LA')!.id;
        const before = snapshot(unit);
        const command: CBTUnitCommand = { type: 'set-location-condition', locationId,
            condition: 'blown-off', value: 1, target: 'committed' };
        expect(unit.dispatch(command).changed).toBeTrue();
        expect<unknown>(unitCommandHistory(unit.instanceId, unit, command, before, snapshot(unit)))
            .toEqual(jasmine.objectContaining({ messageId: RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED,
                data: [unit.instanceId, jasmine.any(String), 'blown-off', 0, 1, 'committed'] }));
    });
});

function snapshot(unit: CBTUnit): CBTUnitSnapshot {
    return { instanceId: unit.instanceId, uuid: unit.uuid, entity: unit.getUnit(), index: unit.getIndex(),
        ruleset: unit.ruleset(), crewAssignment: unit.getCrewAssignment(), state: unit.snapshot(), query: unit.query(),
        editContext: { owner: unit, state: unit.snapshot() } };
}

function fighter() {
    const entity = new TestAeroSpaceFighterEntity();
    entity.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'));
    entity.structuralIntegrity.set(8);
    return createNonMekRuntimeForTest('history-aero', { entity: entity.uuid(), ruleset: 'core-2026',
        initialStateProfile: { profileId: 'pristine-non-mek' } }, entity, 'core-2026');
}
