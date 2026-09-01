// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../common.model';
import { MiscEquipment } from '../equipment.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { ComponentId } from '../entity/entity-identifiers';
import {
    activeProbeEffectivelyPowered,
    electronicComponentModes,
    effectiveEcmMode,
    isPowerControlledEquipment,
    type ElectronicComponentFact,
} from './component-electronic-suite';
import { createDirectElectronicSuiteRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('direct electronic-suite lifecycle', () => {
    it('only admits equipment with an explicit switchable rules benefit', () => {
        const equipment = (flag: EquipmentFlag) =>
            new MiscEquipment({ id: flag, name: flag, type: 'misc', flags: [flag] });

        for (const flag of ['F_SEARCHLIGHT', 'F_BA_SEARCHLIGHT', 'F_MINESWEEPER'] as const) {
            expect(isPowerControlledEquipment(equipment(flag))).withContext(flag).toBeTrue();
        }
        expect(isPowerControlledEquipment(equipment('F_EI_INTERFACE'))).toBeTrue();
        expect(isPowerControlledEquipment(equipment('F_EI_INTERFACE'), true)).toBeFalse();
        expect(electronicComponentModes(equipment('F_TAG'))).toBeNull();
    });

    it('resolves implicit defaults and hands ECM operation over only at End Turn', () => {
        const fixture = createDirectElectronicSuiteRuntimeFixture();
        const ordinary = component(fixture, 'Test ECM');
        const angel = component(fixture, 'Test Angel ECM');
        const [firstProbe, secondProbe] = components(fixture, 'Test BAP');
        const nova = component(fixture, 'Test Nova CEWS');

        expect(effectiveEcmMode(facts(fixture), angel)).toBe(ECMMode.ECM);
        expect(effectiveEcmMode(facts(fixture), ordinary)).toBe(ECMMode.OFF);
        expect(activeProbeEffectivelyPowered(facts(fixture), firstProbe)).toBeTrue();
        expect(activeProbeEffectivelyPowered(facts(fixture), secondProbe)).toBeFalse();
        expect(activeProbeEffectivelyPowered(facts(fixture), nova)).toBeFalse();

        expect(setMode(fixture, ordinary, ECMMode.ECCM).accepted).toBeTrue();
        expect(effectiveEcmMode(facts(fixture), angel)).toBe(ECMMode.ECM);
        expect(effectiveEcmMode(facts(fixture), ordinary)).toBe(ECMMode.OFF);
        expect(effectiveEcmMode(facts(fixture), ordinary, true)).toBe(ECMMode.ECCM);

        expect(endTurn(fixture).accepted).toBeTrue();
        expect(effectiveEcmMode(facts(fixture), angel)).toBe(ECMMode.OFF);
        expect(effectiveEcmMode(facts(fixture), ordinary)).toBe(ECMMode.ECCM);
    });

    it('makes the last queued combined suite win both ECM and probe claims atomically', () => {
        const fixture = createDirectElectronicSuiteRuntimeFixture();
        const ordinary = component(fixture, 'Test ECM');
        const angel = component(fixture, 'Test Angel ECM');
        const probes = components(fixture, 'Test BAP');
        const nova = component(fixture, 'Test Nova CEWS');

        expect(setMode(fixture, ordinary, ECMMode.ECCM).accepted).toBeTrue();
        expect(setMode(fixture, nova, 'enabling').accepted).toBeTrue();
        expect(effectiveEcmMode(facts(fixture), angel)).toBe(ECMMode.ECM);
        expect(effectiveEcmMode(facts(fixture), nova)).toBe(ECMMode.OFF);
        expect(effectiveEcmMode(facts(fixture), nova, true)).toBe(ECMMode.ECM);

        expect(endTurn(fixture).accepted).toBeTrue();
        expect(effectiveEcmMode(facts(fixture), nova)).toBe(ECMMode.ECM);
        expect(effectiveEcmMode(facts(fixture), ordinary)).toBe(ECMMode.OFF);
        expect(effectiveEcmMode(facts(fixture), angel)).toBe(ECMMode.OFF);
        expect(activeProbeEffectivelyPowered(facts(fixture), nova)).toBeTrue();
        for (const probe of probes) {
            expect(activeProbeEffectivelyPowered(facts(fixture), probe)).toBeFalse();
        }
    });

    it('charges Nova CEWS heat only while its committed power state is effective', () => {
        const fixture = createDirectElectronicSuiteRuntimeFixture();
        const nova = component(fixture, 'Test Nova CEWS');

        expect(novaHeat(fixture, nova)).toBeUndefined();
        expect(setMode(fixture, nova, 'enabling').accepted).toBeTrue();
        expect(novaHeat(fixture, nova)).toBeUndefined();

        expect(endTurn(fixture).accepted).toBeTrue();
        expect(novaHeat(fixture, nova)).toBe(2);
        expect(novaHeatSource(fixture, nova)).toEqual(jasmine.objectContaining({
            label: 'Nova CEWS',
            value: 2,
            group: 'Equipment',
        }));

        expect(setMode(fixture, nova, 'disabling').accepted).toBeTrue();
        expect(novaHeat(fixture, nova)).toBe(2);

        expect(endTurn(fixture).accepted).toBeTrue();
        expect(novaHeat(fixture, nova)).toBeUndefined();
    });

    it('cancels an earlier probe startup when another probe is selected last', () => {
        const fixture = createDirectElectronicSuiteRuntimeFixture();
        const [first, second] = components(fixture, 'Test BAP');

        expect(setMode(fixture, first, 'disabling').accepted).toBeTrue();
        expect(endTurn(fixture).accepted).toBeTrue();
        expect(activeProbeEffectivelyPowered(facts(fixture), second)).toBeTrue();
        expect(setMode(fixture, second, 'disabling').accepted).toBeTrue();
        expect(endTurn(fixture).accepted).toBeTrue();

        expect(setMode(fixture, first, 'enabling').accepted).toBeTrue();
        expect(setMode(fixture, second, 'enabling').accepted).toBeTrue();
        expect(fixture.instance.query().componentMode(first)).toBe('disabled');
        expect(fixture.instance.query().componentMode(second)).toBe('enabling');
        expect(activeProbeEffectivelyPowered(facts(fixture), first)).toBeFalse();
        expect(activeProbeEffectivelyPowered(facts(fixture), second)).toBeFalse();

        expect(endTurn(fixture).accepted).toBeTrue();
        expect(activeProbeEffectivelyPowered(facts(fixture), first)).toBeFalse();
        expect(activeProbeEffectivelyPowered(facts(fixture), second)).toBeTrue();
    });

    it('ignores an Angel-only mode on ordinary ECM without changing revision', () => {
        const fixture = createDirectElectronicSuiteRuntimeFixture();
        const ordinary = component(fixture, 'Test ECM');
        const revision = fixture.instance.revision();

        const result = setMode(fixture, ordinary, ECMMode.ECM_ECCM);

        expect(result).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(fixture.instance.revision()).toBe(revision);
    });
});

type Fixture = ReturnType<typeof createDirectElectronicSuiteRuntimeFixture>;

function component(fixture: Fixture, equipmentId: string): ComponentId {
    const matches = components(fixture, equipmentId);
    if (matches.length !== 1) throw new Error(`Expected one ${equipmentId}, found ${matches.length}`);
    return matches[0];
}

function components(fixture: Fixture, equipmentId: string): ComponentId[] {
    return [...fixture.index.components].flatMap(([componentId, definition]) =>
        definition.kind === 'equipment' && definition.mount.equipment?.id === equipmentId
            ? [componentId]
            : []);
}

function facts(fixture: Fixture): readonly ElectronicComponentFact[] {
    const state = fixture.instance.snapshot();
    return Object.freeze([...fixture.index.components].flatMap(([componentId, definition]) => {
        if (definition.kind !== 'equipment' || !definition.mount.equipment) return [];
        const equipment = definition.mount.equipment;
        if (!equipment.hasAnyFlag(['F_ECM', 'F_BAP', 'F_NOVA'])) return [];
        return [Object.freeze({
            componentId,
            equipment,
            mode: state.components.get(componentId)?.mode,
            operational: fixture.instance.query().componentStatus(componentId) === 'available',
        })];
    }));
}

function novaHeat(fixture: Fixture, componentId: ComponentId): number | undefined {
    return novaHeatSource(fixture, componentId)?.value;
}

function novaHeatSource(fixture: Fixture, componentId: ComponentId) {
    const result = fixture.instance.query().heatProjection('manual');
    expect(result.kind).toBe('supported');
    if (result.kind !== 'supported') return undefined;
    return result.projection.committedSources.find(source =>
        source.id === `nova-cews:${componentId}`);
}

function setMode(fixture: Fixture, componentId: ComponentId, mode: string) {
    return fixture.instance.dispatch({
        type: 'set-component-mode',
        
        
        componentId,
        mode,
    });
}

function endTurn(fixture: Fixture) {
    return fixture.instance.dispatch({
        type: 'end-turn',
        
        
        policy: 'automatic',
    });
}
