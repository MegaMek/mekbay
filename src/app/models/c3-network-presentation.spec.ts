// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from './entity/entity-identifiers';
import {
    asEncounterNetworkId,
    CBTEncounterC3State,
    type EncounterNetwork,
} from './runtime/encounter-runtime';
import { C3NetworkType, C3Role, type C3Component } from './c3-network.model';
import {
    projectC3EditorNetworksToEncounter,
    projectEncounterC3Components,
    projectEncounterNetworksToC3Editor,
    validateEncounterNetworks,
    type C3EncounterPresentationUnit,
} from './c3-network-presentation';

function component(
    id: string,
    role: C3Role,
    networkType: C3NetworkType = C3NetworkType.C3,
    index = 0,
): C3Component {
    return Object.freeze({
        componentId: asComponentId(id),
        networkType,
        role,
        boosted: false,
        index,
    });
}

function unit(id: string, ...components: C3Component[]): C3EncounterPresentationUnit {
    return Object.freeze({
        instanceId: id,
        c3Components: Object.freeze(components),
    });
}

describe('C3 encounter/editor presentation', () => {
    it('preserves a member Master capability while promoting an explicit emergency root', () => {
        const commandId = 'command';
        const command = [
            component('master-a', C3Role.MASTER, C3NetworkType.C3, 0),
            component('master-b', C3Role.MASTER, C3NetworkType.C3, 1),
        ];
        const internal: EncounterNetwork = {
            id: asEncounterNetworkId('internal'),
            networkType: C3NetworkType.C3,
            color: '#123456',
            endpoints: [
                { instanceId: commandId, componentId: asComponentId('master-a'), role: 'master' },
                { instanceId: commandId, componentId: asComponentId('master-b'), role: 'member' },
            ],
        };
        expect(projectEncounterC3Components(commandId, command, [internal]).map(value => value.role))
            .toEqual([C3Role.MASTER, C3Role.MASTER]);

        const emergencyId = 'emergency';
        const emergency = component('emergency-master', C3Role.SLAVE);
        const activated: EncounterNetwork = {
            id: asEncounterNetworkId('activated'),
            networkType: C3NetworkType.C3,
            color: '#abcdef',
            endpoints: [
                { instanceId: emergencyId, componentId: asComponentId('emergency-master'), role: 'master' },
                { instanceId: commandId, componentId: asComponentId('master-a'), role: 'member' },
            ],
        };
        expect(projectEncounterC3Components(emergencyId, [emergency], [activated])[0].role)
            .toBe(C3Role.MASTER);
    });

    it('round-trips stable standard endpoints including a sub-master', () => {
        const units = [
            unit('root', component('root-master', C3Role.MASTER)),
            unit('slave', component('slave-endpoint', C3Role.SLAVE)),
            unit('sub', component('sub-master', C3Role.MASTER)),
        ];
        const encounter: EncounterNetwork = Object.freeze({
            id: asEncounterNetworkId('standard'),
            networkType: C3NetworkType.C3,
            color: '#123456',
            endpoints: Object.freeze([
                Object.freeze({
                    instanceId: units[0].instanceId,
                    componentId: asComponentId('root-master'),
                    role: 'master' as const,
                }),
                Object.freeze({
                    instanceId: units[1].instanceId,
                    componentId: asComponentId('slave-endpoint'),
                    role: 'member' as const,
                }),
                Object.freeze({
                    instanceId: units[2].instanceId,
                    componentId: asComponentId('sub-master'),
                    role: 'member' as const,
                }),
            ]),
        });

        const visual = projectEncounterNetworksToC3Editor([encounter], units);

        expect(visual).toEqual([{
            id: 'standard',
            type: C3NetworkType.C3,
            color: '#123456',
            masterId: 'root',
            masterCompIndex: 0,
            members: ['slave', 'sub:0'],
        }]);
        expect(projectC3EditorNetworksToEncounter(visual, units)).toEqual([encounter]);
    });

    it('round-trips a peer network through unique stable component IDs', () => {
        const units = [
            unit('first', component('first-c3i', C3Role.PEER, C3NetworkType.C3I)),
            unit('second', component('second-c3i', C3Role.PEER, C3NetworkType.C3I)),
        ];
        const visual = [{
            id: 'peer',
            type: C3NetworkType.C3I,
            color: '#abcdef',
            peerIds: ['first', 'second'],
        }];

        const projected = projectC3EditorNetworksToEncounter(visual, units);

        expect(projected[0].endpoints.map(endpoint => endpoint.componentId)).toEqual([
            asComponentId('first-c3i'),
            asComponentId('second-c3i'),
        ]);
        expect(projectEncounterNetworksToC3Editor(projected, units)).toEqual(visual);
    });

    it('delegates peer-size rejection to the canonical editor rules', () => {
        const units = ['one', 'two', 'three', 'four'].map(id =>
            unit(id, component(`${id}-nova`, C3Role.PEER, C3NetworkType.NOVA)));
        const encounter: EncounterNetwork = Object.freeze({
            id: asEncounterNetworkId('oversized-nova'),
            networkType: C3NetworkType.NOVA,
            color: '#abcdef',
            endpoints: Object.freeze(units.map((candidate, index) => Object.freeze({
                instanceId: candidate.instanceId,
                componentId: asComponentId(`${['one', 'two', 'three', 'four'][index]}-nova`),
                role: 'peer' as const,
            }))),
        });

        expect(validateEncounterNetworks([encounter], units)).toBeFalse();
    });

    it('validates and stores an internal standard-C3 Master link through the canonical utility', () => {
        const units = [
            unit(
                'command',
                component('command-master-a', C3Role.MASTER, C3NetworkType.C3, 0),
                component('command-master-b', C3Role.MASTER, C3NetworkType.C3, 1),
            ),
            unit('slave', component('slave-c3', C3Role.SLAVE)),
        ];
        const visual = [{
            id: 'branch-network',
            type: C3NetworkType.C3,
            color: '#7B1FA2',
            masterId: 'command',
            masterCompIndex: 1,
            members: ['slave'],
        }, {
            id: 'command-network',
            type: C3NetworkType.C3,
            color: '#1565C0',
            masterId: 'command',
            masterCompIndex: 0,
            members: ['command:1'],
        }];

        const networks = projectC3EditorNetworksToEncounter(visual, units);
        const runtime = new CBTEncounterC3State();

        expect(validateEncounterNetworks(networks, units)).toBeTrue();
        runtime.replaceC3Configuration(networks, []);
        expect(projectEncounterNetworksToC3Editor(runtime.snapshot().networks, units)).toEqual(visual);
    });

    it('fails closed when a visual endpoint is missing or ambiguous', () => {
        const missing = unit('missing');
        const ambiguous = unit(
            'ambiguous',
            component('peer-a', C3Role.PEER, C3NetworkType.C3I, 0),
            component('peer-b', C3Role.PEER, C3NetworkType.C3I, 1),
        );
        const visual = [{
            id: 'peer',
            type: C3NetworkType.C3I,
            color: '#abcdef',
            peerIds: ['missing', 'ambiguous'],
        }];

        expect(() => projectC3EditorNetworksToEncounter(visual, [missing, ambiguous]))
            .toThrowError(/missing or ambiguous/);
    });

    it('rejects duplicate presentation unit identities', () => {
        const first = unit('duplicate', component('one', C3Role.PEER, C3NetworkType.C3I));
        const second = unit('duplicate', component('two', C3Role.PEER, C3NetworkType.C3I));

        expect(() => projectC3EditorNetworksToEncounter([], [first, second]))
            .toThrowError(/Duplicate C3 presentation unit/);
    });
});
