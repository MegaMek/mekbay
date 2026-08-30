// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../common.model';
import { componentModeDefinition } from './component-mode';
import { StealthHandler } from './component-stealth';
import { mekTargetRosterRow } from './cbt-force-target-roster';
import { emptyCBTEncounterSnapshot } from './encounter-runtime';
import { projectMekEquipmentPanel } from './equipment-panel';
import { ReadyMekUnit } from './ready-unit-factory';
import { asCommandId } from './runtime-state';
import {
    createDirectVoidSignatureRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';
import { createHandlerQueryContext } from '../../services/equipment-interaction-registry.service';

describe('direct Void Signature runtime', () => {
    it('disables activation without ECM in both the handler and command boundary', () => {
        const fixture = createDirectVoidSignatureRuntimeFixture();
        const voidSignature = fixture.equipmentComponent('Test Void Signature');
        disableEcm(fixture);
        const definition = componentModeDefinition(
            fixture.entity,
            fixture.index,
            voidSignature.id,
            fixture.instance.ruleset(),
        );
        const choices = new StealthHandler().getComponentModeChoices(
            fixture.instance,
            definition,
            createHandlerQueryContext(fixture.equipment),
        );

        expect(choices).toEqual([jasmine.objectContaining({
            value: 'enabling',
            active: false,
            disabled: true,
        })]);
        const revision = fixture.instance.revision();
        expect(fixture.instance.dispatch({
            type: 'set-stealth-state',
            commandId: asCommandId('void:reject-without-ecm'),
            expectedRevision: revision,
            componentId: voidSignature.id,
            state: 'enabling',
        })).toEqual(jasmine.objectContaining({ accepted: false }));
        expect(fixture.instance.revision()).toBe(revision);
    });

    it('settles at End Turn, disrupts C3, contributes ten heat, and drops with ECM', () => {
        const fixture = createDirectVoidSignatureRuntimeFixture();
        const voidSignature = activateVoidSignature(fixture);

        expect(fixture.instance.query().componentStealthState(voidSignature.id)).toBe('enabled');
        expect(fixture.instance.query().voidSignatureActive()).toBeTrue();
        expect(fixture.instance.query().c3DisruptedByStealth()).toBeTrue();
        const heat = fixture.instance.query().heatProjection('automatic');
        expect(heat.kind).toBe('supported');
        if (heat.kind === 'supported') {
            expect(heat.projection.committedSources).toContain(jasmine.objectContaining({
                id: `equipment:${voidSignature.id}`,
                label: 'Void Signature',
                value: 10,
                group: 'Equipment',
            }));
        }

        disableEcm(fixture);
        expect(fixture.instance.query().voidSignatureActive()).toBeFalse();
        expect(fixture.instance.query().c3DisruptedByStealth()).toBeFalse();
        const unsupportedHeat = fixture.instance.query().heatProjection('automatic');
        if (unsupportedHeat.kind === 'supported') {
            expect(unsupportedHeat.projection.committedSources.some(source => (
                source.id === `equipment:${voidSignature.id}`
            ))).toBeFalse();
        }
        expect(fixture.instance.dispatch({
            type: 'end-phase',
            commandId: asCommandId('void:settle-ecm-loss'),
            expectedRevision: fixture.instance.revision(),
        }).accepted).toBeTrue();
        expect(fixture.instance.query().componentStealthState(voidSignature.id)).toBe('disabled');
    });

    it('projects movement-based protection and treats non-stationary zero-distance movement as one', () => {
        const fixture = createDirectVoidSignatureRuntimeFixture();
        activateVoidSignature(fixture);

        expect(fixture.instance.query().stealthTnModifiers(0)).toEqual({
            short: 3, medium: 3, long: 3,
            conventionalInfantry: { short: 2, medium: 2, long: 2 },
        });
        expect(fixture.instance.query().stealthTnModifiers(3)).toEqual({
            short: 1, medium: 1, long: 1,
            conventionalInfantry: { short: 0, medium: 0, long: 0 },
        });
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement',
            commandId: asCommandId('void:zero-distance-walk'),
            expectedRevision: fixture.instance.revision(),
            declaration: {
                schemaVersion: 1,
                mode: 'walk',
                distance: 0,
                boosterComponentIds: [],
            },
        }).accepted).toBeTrue();
        const ready = new ReadyMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );
        expect(mekTargetRosterRow('force:void-signature', ready).tnCalculator.stealth).toEqual({
            short: 2, medium: 2, long: 2,
            conventionalInfantry: { short: 1, medium: 1, long: 1 },
        });
    });

    it('penalizes weapon attacks without changing physical attack modifiers', () => {
        const fixture = createDirectVoidSignatureRuntimeFixture();
        activateVoidSignature(fixture);
        const panel = projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        );
        const laser = panel.components.find(row => row.equipment?.id === 'ISMediumLaser');

        expect(laser?.weapon?.hitModifierBreakdown).toContain({
            label: 'Void Signature',
            modifier: 1,
        });
        expect(panel.physicalAttacks.length).toBeGreaterThan(0);
        expect(panel.physicalAttacks.every(attack => !attack.hitModifierBreakdown.some(
            modifier => modifier.label === 'Void Signature',
        ))).toBeTrue();
    });
});

function activateVoidSignature(fixture: DirectMekRuntimeFixture) {
    const component = fixture.equipmentComponent('Test Void Signature');
    expect(fixture.instance.dispatch({
        type: 'set-stealth-state',
        commandId: asCommandId('void:enable'),
        expectedRevision: fixture.instance.revision(),
        componentId: component.id,
        state: 'enabling',
    }).accepted).toBeTrue();
    expect(fixture.instance.query().componentStealthState(component.id)).toBe('enabling');
    expect(fixture.instance.dispatch({
        type: 'end-turn',
        commandId: asCommandId('void:end-turn'),
        expectedRevision: fixture.instance.revision(),
        policy: 'automatic',
    }).accepted).toBeTrue();
    return component;
}

function disableEcm(fixture: DirectMekRuntimeFixture): void {
    for (const equipmentId of ['Test Angel ECM', 'Test ECM']) {
        const component = fixture.equipmentComponent(equipmentId);
        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            commandId: asCommandId(`void:disable:${equipmentId}`),
            expectedRevision: fixture.instance.revision(),
            componentId: component.id,
            mode: ECMMode.OFF,
        }).accepted).toBeTrue();
    }
}
