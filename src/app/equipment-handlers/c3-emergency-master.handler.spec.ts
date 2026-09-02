// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    componentC3EmergencyMasterDefinition,
    componentC3EmergencyMasterFacts,
    selectComponentC3EmergencyMasterOperatingTurns,
    settleComponentC3EmergencyMasterEndTurn,
    syncComponentC3EmergencyMasterEncounter,
} from '../models/runtime/component-c3-emergency-master';
import {
    asEncounterNetworkId,
    type CBTEncounterSnapshot,
    type EncounterNetworkEndpoint,
} from '../models/runtime/encounter-runtime';
import {
    createDirectMekRuntimeFixture,
    emptyCBTEncounterSnapshot,
} from '../models/runtime/testing/direct-mek-runtime-fixture';
import type {
    EquipmentInteractionDialogsService,
    EquipmentInteractionNotifications,
} from '../models/runtime/equipment-interaction';
import {
    C3EM_TOGGLE_CHOICE_VALUE,
    C3EmergencyMasterHandler,
} from '../models/runtime/component-c3-emergency-master';

describe('C3EmergencyMasterHandler direct V2 runtime', () => {
    it('renders the production track from direct sparse operating-turn state', () => {
        const setup = directC3Setup(null);
        let choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );

        expect(choices.map(choice => choice.label)).toEqual([
            '1', '2', '3', '4', '5', '6', '!!', 'EMERGENCY',
        ]);
        expect(choices.slice(0, 7).every(choice => !choice.active)).toBeTrue();
        expect(choices.at(-1)).toEqual(jasmine.objectContaining({
            value: C3EM_TOGGLE_CHOICE_VALUE,
            active: false,
        }));

        expect(selectComponentC3EmergencyMasterOperatingTurns(
            setup.runtime,
            setup.definition,
            4,
        ).accepted).toBeTrue();
        choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );
        expect(choices.slice(0, 4).every(choice => choice.active
            && choice.selectionTone === 'muted')).toBeTrue();
        expect(choices.slice(4, 7).every(choice => !choice.active)).toBeTrue();

        setup.setRole('master');
        choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );
        expect(choices[3]).toEqual(jasmine.objectContaining({
            active: true,
            selectionTone: 'selected',
        }));
    });

    it('uses the typed encounter role and direct sparse lifecycle commands', () => {
        const setup = directC3Setup('master');
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({
            mode: 'auto', status: 'active', operatingTurns: 0, endpointRole: 'master',
        }));

        expect(syncComponentC3EmergencyMasterEncounter(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).accepted).toBeTrue();
        const choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );
        expect(choices[0]).toEqual(jasmine.objectContaining({ value: 1, active: true }));
        expect(choices.at(-1)).toEqual(jasmine.objectContaining({
            value: C3EM_TOGGLE_CHOICE_VALUE,
            active: true,
        }));

        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            { value: C3EM_TOGGLE_CHOICE_VALUE } as never,
            setup.commandContext,
        )).toBeTrue();
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).status).toBe('dormant');

        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            { value: 7 } as never,
            setup.commandContext,
        )).toBeTrue();
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).status).toBe('fried');
        expect(setup.toast.showToast).toHaveBeenCalledWith(
            'Test C3 Emergency Master: fried after 6 operating turns',
            'error',
        );
    });

    it('settles active masters but not standby members at end turn', () => {
        const master = directC3Setup('master');
        expect(syncComponentC3EmergencyMasterEncounter(
            master.runtime, master.definition, master.runtimeContext,
        ).accepted).toBeTrue();
        expect(selectComponentC3EmergencyMasterOperatingTurns(
            master.runtime, master.definition, 6,
        ).accepted).toBeTrue();
        settleEndTurn(master);
        expect(componentC3EmergencyMasterFacts(
            master.runtime, master.definition, master.runtimeContext,
        )).toEqual(jasmine.objectContaining({ status: 'fried', operatingTurns: 7 }));

        const member = directC3Setup('member');
        expect(member.handler.handleComponentC3EmergencyMasterSelection(
            member.runtime,
            member.definition,
            member.runtimeContext,
            { value: C3EM_TOGGLE_CHOICE_VALUE } as never,
            member.commandContext,
        )).toBeTrue();
        expect(componentC3EmergencyMasterFacts(
            member.runtime, member.definition, member.runtimeContext,
        )).toEqual(jasmine.objectContaining({ status: 'standby', operatingTurns: 1 }));
        settleEndTurn(member);
        expect(componentC3EmergencyMasterFacts(
            member.runtime, member.definition, member.runtimeContext,
        ).operatingTurns).toBe(1);
    });

    it('retains consumed turns across manual Emergency overrides', () => {
        const setup = directC3Setup('member');
        const toggle = () => setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        ).at(-1)!;

        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            toggle() as never,
            setup.commandContext,
        )).toBeTrue();
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({
            mode: 'on', status: 'standby', operatingTurns: 1,
        }));

        settleEndTurn(setup);
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).operatingTurns).toBe(1);

        setup.setRole('master');
        settleEndTurn(setup);
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).operatingTurns).toBe(2);

        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            toggle() as never,
            setup.commandContext,
        )).toBeTrue();
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({
            mode: 'off', status: 'dormant', operatingTurns: 2,
        }));
    });

    it('pauses outside active service and resumes from the retained turn', () => {
        const setup = directC3Setup('master');
        expect(syncComponentC3EmergencyMasterEncounter(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).accepted).toBeTrue();

        settleEndTurn(setup);
        setup.setRole(null);
        settleEndTurn(setup);
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        ).operatingTurns).toBe(2);

        setup.setRole('master');
        expect(setup.runtime.dispatch({
            type: 'set-component-status',
            
            
            componentId: setup.component.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        settleEndTurn(setup);
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({ status: 'unavailable', operatingTurns: 2 }));

        expect(setup.runtime.dispatch({
            type: 'set-component-status',
            
            
            componentId: setup.component.id,
            status: 'available',
            target: 'committed',
        }).accepted).toBeTrue();
        settleEndTurn(setup);
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({ status: 'active', operatingTurns: 3 }));
    });

    it('fries after six operating turns and keeps direct track correction available', () => {
        const setup = directC3Setup('master');
        expect(selectComponentC3EmergencyMasterOperatingTurns(
            setup.runtime,
            setup.definition,
            6,
        ).accepted).toBeTrue();

        settleEndTurn(setup);
        let choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({ status: 'fried', operatingTurns: 7 }));
        expect(choices[6]).toEqual(jasmine.objectContaining({
            active: true,
            disabled: false,
            selectionTone: 'selected',
            colors: jasmine.objectContaining({ selected: '#f00', selectedText: '#fff' }),
        }));
        expect(choices.at(-1)).toEqual(jasmine.objectContaining({
            active: false,
            disabled: true,
        }));

        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            choices[3] as never,
            setup.commandContext,
        )).toBeTrue();
        choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );
        expect(componentC3EmergencyMasterFacts(
            setup.runtime, setup.definition, setup.runtimeContext,
        )).toEqual(jasmine.objectContaining({
            mode: 'off', status: 'dormant', operatingTurns: 4,
        }));
        expect(choices.slice(0, 4).every(choice => choice.active)).toBeTrue();
        expect(choices[6].active).toBeFalse();
        expect(choices.at(-1)?.disabled).toBeFalse();
    });

    it('ignores malformed track values without changing sparse state', () => {
        const setup = directC3Setup('master');
        const revision = setup.runtime.revision();

        for (const value of ['invalid', Number.NaN, 0, -1, 1.5, 8]) {
            expect(setup.handler.handleComponentC3EmergencyMasterSelection(
                setup.runtime,
                setup.definition,
                setup.runtimeContext,
                { value } as never,
                setup.commandContext,
            )).toBeTrue();
        }

        expect(setup.runtime.revision()).toBe(revision);
        expect(setup.toast.showToast).not.toHaveBeenCalled();
    });

    it('disables every control and rejects edits when the component is unavailable', () => {
        const setup = directC3Setup('master');
        expect(setup.runtime.dispatch({
            type: 'set-component-status',
            
            
            componentId: setup.component.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();

        const choices = setup.handler.getComponentC3EmergencyMasterChoices(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            setup.queryContext,
        );
        expect(choices.every(choice => choice.disabled)).toBeTrue();

        const revision = setup.runtime.revision();
        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            { value: C3EM_TOGGLE_CHOICE_VALUE } as never,
            setup.commandContext,
        )).toBeTrue();
        expect(setup.handler.handleComponentC3EmergencyMasterSelection(
            setup.runtime,
            setup.definition,
            setup.runtimeContext,
            { value: 3 } as never,
            setup.commandContext,
        )).toBeTrue();
        expect(setup.runtime.revision()).toBe(revision);
    });
});

type C3EndpointRole = Extract<EncounterNetworkEndpoint['role'], 'master' | 'member'>;

function directC3Setup(initialRole: C3EndpointRole | null) {
    const fixture = createDirectMekRuntimeFixture();
    const component = fixture.equipmentComponent('Test C3 Emergency Master');
    const runtime = fixture.instance;
    const definition = componentC3EmergencyMasterDefinition(
        fixture.entity,
        fixture.index,
        component.id,
    );
    const empty = emptyCBTEncounterSnapshot();
    let role = initialRole;
    const encounter = (): CBTEncounterSnapshot => Object.freeze({
        ...empty,
        networks: role === null
            ? Object.freeze([])
            : Object.freeze([Object.freeze({
                id: asEncounterNetworkId(`network:${role}`),
                networkType: 'c3' as const,
                color: '#123456',
                endpoints: Object.freeze([Object.freeze({
                    instanceId: fixture.instance.id,
                    componentId: component.id,
                    role,
                })]),
            })]),
    });
    const toast = toastService();
    return {
        fixture,
        component,
        runtime,
        definition,
        runtimeContext: Object.freeze({
            instanceId: fixture.instance.id,
            encounter,
        }),
        setRole: (nextRole: C3EndpointRole | null) => { role = nextRole; },
        handler: new C3EmergencyMasterHandler(),
        toast,
        queryContext: {},
        commandContext: { toastService: toast, dialogsService: dialogsService() },
    };
}

function settleEndTurn(setup: ReturnType<typeof directC3Setup>): void {
    settleComponentC3EmergencyMasterEndTurn(
        setup.runtime,
        setup.definition,
        setup.runtimeContext,
    );
}

function toastService(): EquipmentInteractionNotifications & { showToast: jasmine.Spy } {
    return { showToast: jasmine.createSpy('showToast') };
}

function dialogsService(): EquipmentInteractionDialogsService {
    return {
        showNoticeHtml: jasmine.createSpy('showNoticeHtml'),
    };
}
