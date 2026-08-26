// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    canUseEscalatingFailure,
    componentEscalatingFailureFacts,
    componentEscalatingFailureDefinition,
    createComponentEscalatingFailureDefinition,
    selectComponentEscalatingFailureSequence,
} from '../models/runtime/component-escalating-failure';
import { asComponentId } from '../models/entity/entity-identifiers';
import { asCommandId } from '../models/runtime/runtime-state';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    type HandlerDialogsService,
    type HandlerToastService,
} from '../services/equipment-interaction-registry.service';
import {
    ESCALATING_FAILURE_DISABLED_CHOICE_VALUE,
    MascHandler,
} from '../models/runtime/component-escalating-failure';

describe('MascHandler direct V2 runtime', () => {
    it('uses the Core sequence and advances only through unlocked choices', () => {
        const setup = directMascSetup('core-2026');
        const initial = setup.handler.getComponentEscalatingFailureChoices(
            setup.runtime, setup.definition, setup.queryContext,
        );

        expect(initial.slice(0, 5).map(choice => ({
            label: choice.label,
            disabled: choice.disabled,
            active: choice.active,
        }))).toEqual([
            { label: '3+', disabled: false, active: false },
            { label: '5+', disabled: true, active: false },
            { label: '7+', disabled: true, active: false },
            { label: '10+', disabled: true, active: false },
            { label: '11+', disabled: true, active: false },
        ]);
        setup.handler.handleComponentEscalatingFailureSelection(
            setup.runtime, setup.definition, initial[2], setup.commandContext,
        );
        expect(componentEscalatingFailureFacts(setup.runtime, setup.definition).sequence).toBe(0);

        expect(setup.handler.handleComponentEscalatingFailureSelection(
            setup.runtime, setup.definition, initial[0], setup.commandContext,
        )).toBeTrue();
        expect(componentEscalatingFailureFacts(setup.runtime, setup.definition))
            .toEqual(jasmine.objectContaining({ sequence: 1, active: true }));
        expect(setup.handler.getComponentEscalatingFailureRunMovementMultiplierBonus(
            setup.runtime, setup.definition, null, true,
        )).toBe(0.5);
        const advanced = setup.handler.getComponentEscalatingFailureChoices(
            setup.runtime, setup.definition, setup.queryContext,
        );
        expect(advanced.slice(0, 2).map(choice => ({ disabled: choice.disabled, active: choice.active })))
            .toEqual([
                { disabled: false, active: true },
                { disabled: false, active: false },
            ]);
    });

    it('uses Total Warfare escalation labels without changing the entity owner model', () => {
        const setup = directMascSetup('total-warfare');
        const choices = setup.handler.getComponentEscalatingFailureChoices(
            setup.runtime, setup.definition, setup.queryContext,
        );

        expect(choices.slice(0, 5).map(choice => choice.label))
            .toEqual(['3+', '5+', '7+', '11+', '!!']);
        expect(choices[4].colors).toEqual(jasmine.objectContaining({ selected: '#f00' }));
        expect(setup.fixture.index.components.get(setup.component.id)).toBe(setup.component);
    });

    it('settles active and inactive sequences in the one whole-unit end-turn command', () => {
        const active = directMascSetup('core-2026');
        expect(selectComponentEscalatingFailureSequence(active.runtime, active.definition, 0).accepted).toBeTrue();
        expect(active.runtime.dispatch({
            type: 'end-turn', commandId: asCommandId('masc:end-active'),
            expectedRevision: active.runtime.revision(), policy: 'automatic',
        }).accepted).toBeTrue();
        expect(componentEscalatingFailureFacts(active.runtime, active.definition))
            .toEqual(jasmine.objectContaining({ sequence: 1, active: false }));

        const inactive = directMascSetup('core-2026');
        expect(selectComponentEscalatingFailureSequence(inactive.runtime, inactive.definition, 0).accepted).toBeTrue();
        expect(selectComponentEscalatingFailureSequence(inactive.runtime, inactive.definition, 0).accepted).toBeTrue();
        expect(componentEscalatingFailureFacts(inactive.runtime, inactive.definition))
            .toEqual(jasmine.objectContaining({ sequence: 1, active: false }));
        expect(inactive.runtime.dispatch({
            type: 'end-turn', commandId: asCommandId('masc:end-inactive'),
            expectedRevision: inactive.runtime.revision(), policy: 'automatic',
        }).accepted).toBeTrue();
        expect(componentEscalatingFailureFacts(inactive.runtime, inactive.definition))
            .toEqual(jasmine.objectContaining({ sequence: 0, active: false }));
    });

    it('disables and re-enables MASC through sparse component status', () => {
        const setup = directMascSetup('core-2026');
        expect(selectComponentEscalatingFailureSequence(setup.runtime, setup.definition, 0).accepted).toBeTrue();
        const disable = setup.handler.getComponentEscalatingFailureChoices(
            setup.runtime, setup.definition, setup.queryContext,
        ).at(-1)!;
        expect(disable.value).toBe(ESCALATING_FAILURE_DISABLED_CHOICE_VALUE);

        expect(setup.handler.handleComponentEscalatingFailureSelection(
            setup.runtime, setup.definition, disable, setup.commandContext,
        )).toBeTrue();
        expect(componentEscalatingFailureFacts(setup.runtime, setup.definition))
            .toEqual(jasmine.objectContaining({ status: 'disabled', active: false }));
        expect(setup.handler.getComponentEscalatingFailureRunMovementMultiplierBonus(
            setup.runtime, setup.definition, null, false,
        )).toBe(0);

        const enable = setup.handler.getComponentEscalatingFailureChoices(
            setup.runtime, setup.definition, setup.queryContext,
        ).at(-1)!;
        expect(setup.handler.handleComponentEscalatingFailureSelection(
            setup.runtime, setup.definition, enable, setup.commandContext,
        )).toBeTrue();
        expect(componentEscalatingFailureFacts(setup.runtime, setup.definition).status).toBe('available');
    });

    it('allows jet boosters only while airborne', () => {
        const definition = createComponentEscalatingFailureDefinition({
            componentId: asComponentId('component:jet-booster'),
            displayName: 'Jet Booster', flags: ['F_MASC', 'F_JET_BOOSTER'],
            ruleset: 'core-2026',
        });

        expect(canUseEscalatingFailure(definition, false)).toBeFalse();
        expect(canUseEscalatingFailure(definition, null)).toBeFalse();
        expect(canUseEscalatingFailure(definition, true)).toBeTrue();
    });
});

function directMascSetup(ruleset: CBTRuleset) {
    const fixture = createDirectMekRuntimeFixture(ruleset);
    const component = [...fixture.index.components.values()].find(candidate =>
        candidate.kind === 'equipment' && candidate.mount.equipmentId === 'Test MASC');
    if (!component || component.kind !== 'equipment') throw new Error('Missing direct MASC fixture component');
    const runtime = fixture.instance;
    const definition = componentEscalatingFailureDefinition(fixture.index, component.id, ruleset);
    const toast = toastService();
    return {
        fixture,
        component,
        runtime,
        definition,
        handler: new MascHandler(),
        queryContext: createHandlerQueryContext(fixture.equipment, 'inventory'),
        commandContext: createHandlerCommandContext(fixture.equipment, toast, dialogsService()),
    };
}

function toastService(): HandlerToastService {
    return { showToast: jasmine.createSpy('showToast'), toasts: () => [] };
}

function dialogsService(): HandlerDialogsService {
    return {
        createDialog: jasmine.createSpy('createDialog'),
        showError: jasmine.createSpy('showError'),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
