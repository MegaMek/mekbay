// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { SerializedCBTForce } from '../force-serialization';
import { restoreMekUnit } from './cbt-mek-unit';
import type { CBTMekUnit } from './cbt-unit';
import { loadCBTForceFixture } from './testing/cbt-force-fixture';
import { createDirectMekRuntimeFixture,type DirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import type { CBTUnitCommand } from './unit-command';

/**
 * Every load raises pending PSRs again under the bound rules. Under unchanged rules that must reproduce the
 * saved checks exactly: a save and load must not move a single target.
 */
describe('pending PSRs across a save and load under the same ruleset', () => {
    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        it(`reloads every pending ${ruleset} check unchanged`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            raisePendingChecks(fixture, fixture.instance);
            const before = fixture.instance.query().mekPilotChecks();
            expect(before.filter(check => check.status === 'pending').length).toBeGreaterThanOrEqual(5);

            const restored = await restoreUnder(fixture, fixture.instance, ruleset);

            expect(restored.query().mekPilotChecks()).toEqual(before);
            expect(restored.serialize()).toEqual(fixture.instance.serialize());
        });

        it(`reloads ${ruleset} checks unchanged after later damage in the same phase raised the modifiers`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            raisePendingChecks(fixture, fixture.instance);
            // A hip hit after the checks were raised adds a permanent PSR modifier before anyone rolls.
            commit(fixture.instance, { type: 'hit-critical', slotId: systemSlot(fixture, 'Hip', 'RL').id, hits: 1,
                target: 'committed' });
            const before = fixture.instance.query().mekPilotChecks();

            const restored = await restoreUnder(fixture, fixture.instance, ruleset);

            expect(restored.query().mekPilotChecks()).toEqual(before);
        });

        it(`reloads an immediate ${ruleset} Movement check with its target unchanged`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            commit(fixture.instance, { type: 'hit-critical', slotId: systemSlot(fixture, 'Gyro').id, hits: 1, target: 'committed' });
            commit(fixture.instance, { type: 'declare-mek-movement', realPhases: true,
                declaration: { schemaVersion: 1, mode: 'run', distance: 2, boosterComponentIds: [] } });
            // A later event of the phase that the immediate check does not count.
            commit(fixture.instance, { type: 'record-mek-physical-attack-checks', attackId: 'attack:charge', checks: ['charged'] });
            const before = fixture.instance.query().mekPilotChecks();
            expect(before.filter(check => check.immediate).map(check => check.source.triggerKind)).toEqual(['move-damaged-gyro']);

            const restored = await restoreUnder(fixture, fixture.instance, ruleset);

            expect(restored.query().mekPilotChecks()).toEqual(before);
        });

        it(`reloads a ${ruleset} force with pending checks without changing a unit`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            const { force, reload } = await loadCBTForceFixture([fixture.instance], ruleset);
            const id = fixture.instance.instanceId;
            for (const command of pendingCheckCommands(fixture)) {
                expect((await force.dispatchUnitCommand(id, command)).accepted).withContext(command.type).toBeTrue();
            }
            const saved = await force.serializeForPersistence() as SerializedCBTForce;

            const reloaded = await reload(saved);
            expect((await reloaded.serializeForPersistence()).cbt!.units).toEqual(saved.cbt!.units);
        });
    }
});

/** Damage, movement and physical-attack checks: a gyro hit, a hip hit, 20+ damage, a run on a damaged gyro and two physical checks. */
function pendingCheckCommands(fixture: DirectMekRuntimeFixture): readonly CBTUnitCommand[] {
    const faces = [...fixture.index.armorFaces.values()].filter(face => face.maximumPoints >= 7)
        .slice(0, 3);
    return [
        { type: 'hit-critical', slotId: systemSlot(fixture, 'Gyro').id, hits: 1, target: 'committed' },
        { type: 'hit-critical', slotId: systemSlot(fixture, 'Hip', 'LL').id, hits: 1, target: 'committed' },
        ...faces.map(face => ({ type: 'damage-armor' as const, faceId: face.id, amount: 7, target: 'committed' as const })),
        { type: 'declare-mek-movement', declaration: { schemaVersion: 1, mode: 'run', distance: 2, boosterComponentIds: [] } },
        { type: 'record-mek-physical-attack-checks', attackId: 'attack:kick', checks: ['kicked'] },
        { type: 'record-mek-physical-attack-checks', attackId: 'attack:charge', checks: ['charged'] },
    ];
}

function raisePendingChecks(fixture: DirectMekRuntimeFixture, unit: CBTMekUnit): void {
    for (const command of pendingCheckCommands(fixture)) commit(unit, command);
}

function commit(unit: CBTMekUnit, command: CBTUnitCommand): void {
    expect(unit.dispatch(command).accepted).withContext(command.type).toBeTrue();
}

function systemSlot(fixture: DirectMekRuntimeFixture, systemType: string, locationCode?: string) {
    const slot = [...fixture.index.slots.values()].find(candidate =>
        (locationCode === undefined || fixture.index.locations.get(candidate.locationId)?.code === locationCode)
        && candidate.componentIds.some(componentId => {
            const component = fixture.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === systemType;
        }));
    if (!slot) throw new Error(`Missing ${systemType} slot`);
    return slot;
}

function restoreUnder(fixture: DirectMekRuntimeFixture, unit: CBTMekUnit, ruleset: CBTRuleset): Promise<CBTMekUnit> {
    const saved = JSON.parse(JSON.stringify(unit.serialize())) as ReturnType<CBTMekUnit['serialize']>;
    return restoreMekUnit(saved, fixture.entity, fixture.identity, {
        initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
        profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
        deployment: saved.deployment.values,
        scenario: { id: 'megamek', ruleset },
    });
}
