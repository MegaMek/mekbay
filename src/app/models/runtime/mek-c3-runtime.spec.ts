// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    componentC3EmergencyMasterDefinition,
    componentC3EmergencyMasterFacts,
} from './component-c3-emergency-master';
import type { ComponentId } from '../entity/entity-identifiers';
import {
    asEncounterNetworkId,
    type EncounterNetwork,
} from './encounter-runtime';
import { projectEffectiveMekC3Networks } from './mek-c3-runtime';
import { createCommandId, type UnitInstanceId } from './runtime-state';
import {
    createDirectC3MasterRuntimeFixture,
    createDirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('effective Mek C3 runtime', () => {
    it('promotes a requested available C3EM only after the configured master fails', () => {
        const master = createDirectC3MasterRuntimeFixture(undefined, 'unit:c3-master');
        const emergency = createDirectMekRuntimeFixture(undefined, 'unit:c3-emergency');
        const masterComponent = master.equipmentComponent('Test C3 Master');
        const emergencyComponent = emergency.equipmentComponent('Test C3 Emergency Master');
        const configured = network(
            master.instance.id,
            masterComponent.id,
            emergency.instance.id,
            emergencyComponent.id,
        );
        const configuredNetworks = [configured] as const;
        const units = [
            { instanceId: master.instance.id, query: master.instance.query() },
            { instanceId: emergency.instance.id, query: emergency.instance.query() },
        ];

        expect(projectEffectiveMekC3Networks(configuredNetworks, units)).toBe(configuredNetworks);

        expect(master.instance.dispatch({
            type: 'set-component-status',
            commandId: createCommandId(),
            expectedRevision: master.instance.snapshot().stateRevision,
            componentId: masterComponent.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();

        const effective = projectEffectiveMekC3Networks(configuredNetworks, [
            { instanceId: master.instance.id, query: master.instance.query() },
            { instanceId: emergency.instance.id, query: emergency.instance.query() },
        ]);
        expect(effective[0]?.endpoints).toEqual([{
            instanceId: emergency.instance.id,
            componentId: emergencyComponent.id,
            role: 'master',
        }]);

        const runtime = emergency.instance;
        expect(componentC3EmergencyMasterFacts(
            runtime,
            componentC3EmergencyMasterDefinition(
                emergency.entity,
                emergency.index,
                emergencyComponent.id,
            ),
            {
                instanceId: emergency.instance.id,
                encounter: () => ({ networks: effective }),
            },
        ).status).toBe('active');
    });

    it('does not promote an emergency master that was explicitly switched off', () => {
        const master = createDirectC3MasterRuntimeFixture(undefined, 'unit:c3-master-off');
        const emergency = createDirectMekRuntimeFixture(undefined, 'unit:c3-emergency-off');
        const masterComponent = master.equipmentComponent('Test C3 Master');
        const emergencyComponent = emergency.equipmentComponent('Test C3 Emergency Master');
        const configured = network(
            master.instance.id,
            masterComponent.id,
            emergency.instance.id,
            emergencyComponent.id,
        );
        const configuredNetworks = [configured] as const;
        expect(master.instance.dispatch({
            type: 'set-component-status',
            commandId: createCommandId(),
            expectedRevision: master.instance.snapshot().stateRevision,
            componentId: masterComponent.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(emergency.instance.dispatch({
            type: 'edit-c3-emergency-master',
            commandId: createCommandId(),
            expectedRevision: emergency.instance.snapshot().stateRevision,
            componentId: emergencyComponent.id,
            edit: { kind: 'toggle-requested', turningOn: false },
        }).accepted).toBeTrue();

        expect(projectEffectiveMekC3Networks(configuredNetworks, [
            { instanceId: master.instance.id, query: master.instance.query() },
            { instanceId: emergency.instance.id, query: emergency.instance.query() },
        ])).toBe(configuredNetworks);
    });

    it('does not promote a unit while active Stealth Armor disrupts C3', () => {
        const master = createDirectC3MasterRuntimeFixture(undefined, 'unit:c3-master-stealth');
        const emergency = createDirectMekRuntimeFixture(undefined, 'unit:c3-emergency-stealth');
        const masterComponent = master.equipmentComponent('Test C3 Master');
        const emergencyComponent = emergency.equipmentComponent('Test C3 Emergency Master');
        const stealthComponent = emergency.equipmentComponent('Test Stealth');
        const configured = network(
            master.instance.id,
            masterComponent.id,
            emergency.instance.id,
            emergencyComponent.id,
        );
        expect(master.instance.dispatch({
            type: 'set-component-status',
            commandId: createCommandId(),
            expectedRevision: master.instance.revision(),
            componentId: masterComponent.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(emergency.instance.dispatch({
            type: 'set-stealth-state',
            commandId: createCommandId(),
            expectedRevision: emergency.instance.revision(),
            componentId: stealthComponent.id,
            state: 'enabling',
        }).accepted).toBeTrue();
        expect(emergency.instance.dispatch({
            type: 'end-turn',
            commandId: createCommandId(),
            expectedRevision: emergency.instance.revision(),
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(emergency.instance.query().c3DisruptedByStealth()).toBeTrue();

        const configuredNetworks = [configured] as const;
        expect(projectEffectiveMekC3Networks(configuredNetworks, [
            { instanceId: master.instance.id, query: master.instance.query() },
            { instanceId: emergency.instance.id, query: emergency.instance.query() },
        ])).toBe(configuredNetworks);
    });
});

function network(
    masterId: UnitInstanceId,
    masterComponentId: ComponentId,
    memberId: UnitInstanceId,
    memberComponentId: ComponentId,
): EncounterNetwork {
    return Object.freeze({
        id: asEncounterNetworkId('network:c3'),
        networkType: 'c3',
        color: '#123456',
        endpoints: Object.freeze([
            Object.freeze({ instanceId: masterId, componentId: masterComponentId, role: 'master' as const }),
            Object.freeze({ instanceId: memberId, componentId: memberComponentId, role: 'member' as const }),
        ]),
    });
}
