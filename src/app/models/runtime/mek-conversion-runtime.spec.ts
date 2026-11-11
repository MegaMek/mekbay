// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekConversionMode } from '../mek-conversion-mode';
import { MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION, type MekMovementModeV2 } from './mek-movement-psr-v2';
import { projectMekRecordSheet } from './mek-record-sheet';
import { restoreSerializedCBTUnitV2, serializeCBTUnitStateV2 } from './runtime-state-codec-v2';
import {
    createDirectLamRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectQuadVeeRuntimeFixture,
    emptyCBTEncounterSnapshot,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

/**
 * Interstellar Operations: Alternate Eras, Land-Air BattleMechs (pp. 100-107) and QuadVees (pp. 127-128). Neither
 * Total Warfare nor the Core Rulebook covers these units, so both rulesets play them the same way.
 */
describe('Mek conversion modes at runtime', () => {
    const rulesets: readonly CBTRuleset[] = ['total-warfare', 'core-2026'];

    it('converts only to a mode the unit has, and shows the mode as a derived condition', () => {
        const lam = createDirectLamRuntimeFixture();
        expect(lam.instance.query().conversionMode()).toBe('mek');
        expect(convert(lam, 'vehicle')).toBeFalse();
        expect(convert(lam, 'mek')).toBeFalse();
        expect(convert(lam, 'airmek')).toBeTrue();
        expect(lam.instance.query().conversionMode()).toBe('airmek');
        expect([...lam.instance.query().conditions()]).toContain('airmek-mode');
        expect(lam.instance.snapshot().conditions.has('airmek-mode')).toBeFalse();
        expect(convert(lam, 'fighter')).toBeTrue();
        expect([...lam.instance.query().conditions()]).toEqual(jasmine.arrayContaining(['fighter-mode']));
        expect([...lam.instance.query().conditions()]).not.toContain('airmek-mode');
        expect(convert(lam, 'mek')).toBeTrue();
        expect(lam.instance.snapshot().conversionMode).toBeUndefined();

        const quadVee = createDirectQuadVeeRuntimeFixture();
        expect(convert(quadVee, 'airmek')).toBeFalse();
        expect(convert(quadVee, 'vehicle')).toBeTrue();
        expect(convert(createDirectMekRuntimeFixture(), 'airmek')).toBeFalse();
        // The mode conditions are derived only: they cannot be set as conditions.
        expect(lam.instance.dispatch({ type: 'set-condition', condition: 'fighter-mode', active: true }).changed)
            .toBeFalse();
    });

    it('drops the declared movement and air state on conversion, and takes an air state only as AirMech or fighter', () => {
        const lam = createDirectLamRuntimeFixture();
        expect(setAirborne(lam, true)).toBeFalse();
        expect(declare(lam, 'walk', 2)).toBeTrue();
        expect(convert(lam, 'airmek')).toBeTrue();
        expect(lam.instance.query().mekMovementPsrState().movement).toBeNull();
        expect(setAirborne(lam, true)).toBeTrue();
        expect([...lam.instance.query().conditions()]).toContain('airborne');
        expect(convert(lam, 'fighter')).toBeTrue();
        // A fighter declares ground or air every turn, as an aerospace fighter does.
        expect(lam.instance.query().turnState().airborne).toBeNull();
        expect(setAirborne(lam, false)).toBeTrue();
        expect([...lam.instance.query().conditions()]).toContain('grounded');
        expect(setAirborne(createDirectQuadVeeRuntimeFixture(), true)).toBeFalse();
    });

    for (const ruleset of rulesets) {
        it(`${ruleset}: moves a LAM on its mode's MP, with jumping and sprinting only as a BattleMech`, () => {
            const lam = createDirectLamRuntimeFixture(ruleset);
            expect(mp(lam)).toEqual(jasmine.objectContaining({ walkMp: 5, runMp: 8, jumpMp: 3 }));
            expect(movement(lam).airGroundMp).toBeUndefined();

            // AirMech: Walking MP x 0.33 rounded up, running x 1.5; flying, Jumping MP x 3 and x 1.5.
            expect(convert(lam, 'airmek')).toBeTrue();
            expect(mp(lam)).toEqual(jasmine.objectContaining({ walkMp: 2, runMp: 3, jumpMp: 0, sprintMp: 0 }));
            expect(movement(lam).airGroundMp).toEqual({
                grounded: { walkMp: 2, runMp: 3 }, airborne: { walkMp: 9, runMp: 14 },
            });
            expect(action(lam, 'jump').legal).toBeFalse();
            expect(action(lam, 'sprint').reasons.map(reason => reason.code)).toContain('NOT_BATTLEMECH_MODE');
            expect(setAirborne(lam, true)).toBeTrue();
            expect(mp(lam)).toEqual(jasmine.objectContaining({ walkMp: 9, runMp: 14 }));
            expect(declare(lam, 'run', 14)).toBeTrue();

            // Fighter: Safe Thrust is the Jumping MP; landed, it taxis at half with no Maximum Thrust.
            expect(convert(lam, 'fighter')).toBeTrue();
            expect(movement(lam).airGroundMp).toEqual({
                grounded: { walkMp: 1, runMp: 0 }, airborne: { walkMp: 3, runMp: 5 },
            });
            expect(mp(lam)).toEqual(jasmine.objectContaining({ walkMp: 1, runMp: 0 }));
            expect(setAirborne(lam, true)).toBeTrue();
            expect(mp(lam)).toEqual(jasmine.objectContaining({ walkMp: 3, runMp: 5 }));
        });

        it(`${ruleset}: drives a QuadVee in Vehicle mode on its tracks, whatever its leg actuators`, () => {
            const quadVee = createDirectQuadVeeRuntimeFixture(ruleset);
            expect(movement(quadVee).trackedMp).toBe(0);
            expect(convert(quadVee, 'vehicle')).toBeTrue();
            expect(mp(quadVee)).toEqual(jasmine.objectContaining({ walkMp: 5, runMp: 8, jumpMp: 0 }));

            hit(quadVee, systemSlot(quadVee, 'Upper Leg Actuator', 'FLL'));
            hit(quadVee, systemSlot(quadVee, 'Hip', 'FRL'));
            expect(mp(quadVee).walkMp).toBe(5);
            // Each track lost takes a quarter of the Cruise MP.
            hit(quadVee, trackSlot(quadVee, 'FLL'));
            expect(mp(quadVee).walkMp).toBe(4);
            hit(quadVee, trackSlot(quadVee, 'RRL'));
            expect(mp(quadVee).walkMp).toBe(3);
        });

        it(`${ruleset}: makes no roll to avoid a fall in Vehicle or Fighter mode`, () => {
            const checks = (fixture: DirectMekRuntimeFixture, mode: MekConversionMode, leg: string) => {
                if (mode !== 'mek') expect(convert(fixture, mode)).toBeTrue();
                if (mode === 'fighter') expect(setAirborne(fixture, true)).toBeTrue();
                expect(declare(fixture, 'run', 2)).toBeTrue();
                hit(fixture, systemSlot(fixture, 'Hip', leg));
                for (const slot of systemSlots(fixture, 'Gyro').slice(0, 2)) hit(fixture, slot);
                const state = fixture.instance.query().mekMovementPsrState();
                return [state.checks.length > 0, state.automaticFalls.length > 0];
            };
            expect(checks(createDirectQuadVeeRuntimeFixture(ruleset), 'mek', 'FLL')[0]).toBeTrue();
            expect(checks(createDirectQuadVeeRuntimeFixture(ruleset), 'vehicle', 'FLL')).toEqual([false, false]);
            expect(checks(createDirectLamRuntimeFixture(ruleset), 'mek', 'LL')).toEqual([true, true]);
            expect(checks(createDirectLamRuntimeFixture(ruleset), 'fighter', 'LL')).toEqual([false, false]);
        });
    }

    it('judges each AirMech air state on its own MP, so a state it cannot move in is not offered', () => {
        const lam = createDirectLamRuntimeFixture('total-warfare');
        expect(convert(lam, 'airmek')).toBeTrue();
        const options = () => projectMekRecordSheet(lam.entity, lam.index, lam.instance.ruleset(), lam.instance.snapshot(),
            lam.instance.query(), emptyCBTEncounterSnapshot(), null).movementSelection.options
            .map(option => [option.mode, option.airborne, option.legal, option.modifier]);
        expect(options()).toEqual([
            ['stationary', undefined, true, 0],
            ['walk', false, true, 1], ['run', false, true, 2],
            ['walk', true, true, 3], ['run', true, true, 4],
        ]);
        // With every jump jet gone the AirMech still walks, but it cannot fly.
        for (const slot of equipmentSlots(lam, 'Test Jump Jet')) hit(lam, slot);
        expect(options().slice(1)).toEqual([
            ['walk', false, true, 1], ['run', false, true, 2],
            ['walk', true, false, 3], ['run', true, false, 4],
        ]);
    });

    it('saves the mode and restores it', async () => {
        const lam = createDirectLamRuntimeFixture();
        expect(convert(lam, 'fighter')).toBeTrue();
        const saved = structuredClone(serializeCBTUnitStateV2({
            entity: lam.entity, index: lam.index, instanceId: lam.instance.instanceId,
            baselineRef: lam.instance.baselineRef, state: lam.instance.snapshot(),
            deployment: { schemaVersion: 2, values: lam.initialized.deployment },
        }));
        expect(saved.conversionMode).toBe('fighter');
        const restored = await restoreSerializedCBTUnitV2(saved, lam.entity, lam.index, lam.initialized);
        expect(restored.state.conversionMode).toBe('fighter');
    });
});

function convert(fixture: DirectMekRuntimeFixture, mode: MekConversionMode): boolean {
    return fixture.instance.dispatch({ type: 'set-mek-conversion-mode', mode }).changed;
}

function setAirborne(fixture: DirectMekRuntimeFixture, airborne: boolean): boolean {
    return fixture.instance.dispatch({
        type: 'replace-turn-state',
        turn: { ...fixture.instance.query().turnState(), airborne },
    }).changed;
}

function movement(fixture: DirectMekRuntimeFixture) {
    const projected = fixture.instance.query().mekMovementPsr();
    if (projected.kind !== 'supported') throw new Error('Conversion fixture movement is unsupported');
    return projected;
}

function mp(fixture: DirectMekRuntimeFixture) {
    const { walkMp, runMp, jumpMp, sprintMp } = movement(fixture);
    return { walkMp, runMp, jumpMp, sprintMp };
}

function action(fixture: DirectMekRuntimeFixture, kind: MekMovementModeV2) {
    return movement(fixture).actions.find(candidate => candidate.kind === kind)!;
}

function declare(fixture: DirectMekRuntimeFixture, mode: MekMovementModeV2, distance: number): boolean {
    return fixture.instance.dispatch({
        type: 'declare-mek-movement',
        declaration: { schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION, mode, distance, boosterComponentIds: [] },
    }).changed;
}

function locationCode(fixture: DirectMekRuntimeFixture, slot: { readonly locationId: unknown }): string | undefined {
    return [...fixture.index.locations.values()].find(location => location.id === slot.locationId)?.code;
}

function systemSlots(fixture: DirectMekRuntimeFixture, systemType: string, code?: string) {
    return [...fixture.index.slots.values()].filter(slot => slot.componentIds.some(componentId => {
        const component = fixture.index.components.get(componentId);
        return component?.kind === 'system' && component.systemType === systemType;
    }) && (code === undefined || locationCode(fixture, slot) === code));
}

function systemSlot(fixture: DirectMekRuntimeFixture, systemType: string, code?: string) {
    const slot = systemSlots(fixture, systemType, code)[0];
    if (!slot) throw new Error(`Conversion fixture has no ${systemType} slot in ${code ?? 'any location'}`);
    return slot;
}

function equipmentSlots(fixture: DirectMekRuntimeFixture, equipmentId: string, code?: string) {
    return [...fixture.index.slots.values()].filter(slot => slot.componentIds.some(componentId => {
        const component = fixture.index.components.get(componentId);
        return component?.kind === 'equipment' && component.mount.equipmentId === equipmentId;
    }) && (code === undefined || locationCode(fixture, slot) === code));
}

function trackSlot(fixture: DirectMekRuntimeFixture, code: string) {
    const slot = equipmentSlots(fixture, 'Test Tracks', code)[0];
    if (!slot) throw new Error(`Conversion fixture has no track in ${code}`);
    return slot;
}

function hit(fixture: DirectMekRuntimeFixture, slot: { readonly id: ReturnType<typeof systemSlot>['id'] }): void {
    expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).accepted)
        .toBeTrue();
}
