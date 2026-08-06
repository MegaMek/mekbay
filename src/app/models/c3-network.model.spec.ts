// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, computed } from '@angular/core';
import type { CBTForceUnit } from './cbt-force-unit.model';
import type { Equipment } from './equipment.model';
import type { ForceUnit } from './force-unit.model';
import type { SerializedC3NetworkGroup } from './force-serialization';
import { MountedEquipment } from './mounted-equipment.model';
import { C3EM_MODE_STATE_KEY, C3EM_OPERATING_TURNS_STATE_KEY } from './c3-emergency-master.model';
import {
    C3Capabilities,
    C3_FLAGS,
    C3_NETWORK_LIMITS,
    C3Network,
    C3NetworkType,
    C3Role,
    C3TaxCalculator,
} from './c3-network.model';

interface TestUnitState {
    unit: CBTForceUnit;
    operational: ReturnType<typeof signal<boolean>>;
    jammed: ReturnType<typeof signal<boolean>>;
}

function c3Unit(id: string, flag: string, baseBv = 1000, tagBv = 0): TestUnitState {
    const operational = signal(true);
    const jammed = signal(false);
    const unit = {
        id,
        destroyed: false,
        getUnit: () => ({ comp: [] }),
        getInventory: () => inventory,
        isC3EndpointOperational: (index: number) => operational() && index < inventory.length,
        isC3Jammed: () => jammed(),
        getBaseBv: () => baseBv,
        tagBV: () => tagBv,
    } as unknown as CBTForceUnit;
    const inventory = [new MountedEquipment({
        owner: unit,
        id: `${id}-${flag}`,
        name: flag,
        equipment: { flags: new Set([flag]) } as Equipment,
        states: new Map(),
    })];
    return { unit, operational, jammed };
}

function peerNetwork(units: readonly TestUnitState[], type: C3NetworkType): SerializedC3NetworkGroup[] {
    return [{ id: 'peers', type, color: '#1565C0', peerIds: units.map(({ unit }) => unit.id) }];
}

function emergencyMasterUnit(id: string): TestUnitState {
    const state = c3Unit(id, C3_FLAGS.C3S);
    state.unit.getInventory()[0].equipment = { flags: new Set([C3_FLAGS.C3S, C3_FLAGS.C3EM]) } as Equipment;
    return state;
}

describe('C3Capabilities', () => {
    it('normalizes only mounted CBT endpoints in zero-based inventory order', () => {
        const state = c3Unit('multi', C3_FLAGS.C3M);
        state.unit.getInventory().push(new MountedEquipment({
            owner: state.unit,
            id: 'peer',
            name: 'Peer',
            equipment: { flags: new Set([C3_FLAGS.C3I]) } as Equipment,
            states: new Map(),
        }));

        const capabilities = new C3Capabilities(state.unit);

        expect(capabilities.components.map(component => [component.index, component.role, component.networkType]))
            .toEqual([[0, C3Role.MASTER, C3NetworkType.C3], [1, C3Role.PEER, C3NetworkType.C3I]]);
        expect(capabilities.uniqueIndex(C3Role.MASTER, C3NetworkType.C3)).toBe(0);
        expect(capabilities.has(C3NetworkType.C3I, C3Role.PEER)).toBeTrue();
    });

    it('does not derive CBT endpoints from static comp equipment', () => {
        const unit = {
            getInventory: () => [],
            getUnit: () => ({ comp: [{ eq: { flags: new Set([C3_FLAGS.C3M]) } }] }),
        } as unknown as ForceUnit;

        expect(new C3Capabilities(unit).components).toEqual([]);
    });

    it('falls back to counted Alpha Strike specials only without mounted inventory', () => {
        const unit = { getUnit: () => ({ as: { specials: ['C3M2', 'NOVA'] } }) } as unknown as ForceUnit;
        const capabilities = new C3Capabilities(unit);

        expect(capabilities.components.map(component => [component.index, component.role, component.networkType]))
            .toEqual([
                [0, C3Role.MASTER, C3NetworkType.C3],
                [1, C3Role.MASTER, C3NetworkType.C3],
                [2, C3Role.PEER, C3NetworkType.NOVA],
            ]);
        expect(capabilities.uniqueIndex(C3Role.MASTER, C3NetworkType.C3)).toBeUndefined();
    });

    it('normalizes mounted and Alpha Strike emergency masters as construction slaves', () => {
        const mounted = emergencyMasterUnit('mounted');
        const alphaStrike = { getUnit: () => ({ as: { specials: ['C3EM2'] } }) } as unknown as ForceUnit;

        expect(new C3Capabilities(mounted.unit).components.map(component => component.role)).toEqual([C3Role.SLAVE]);
        expect(new C3Capabilities(alphaStrike).components.map(component => component.role)).toEqual([C3Role.SLAVE]);
    });
});

describe('C3Network indexes', () => {
    const networks: SerializedC3NetworkGroup[] = [
        { id: 'parent', type: C3NetworkType.C3, color: '#111111', masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1', 'atlas'] },
        { id: 'child', type: C3NetworkType.C3, color: '#222222', masterId: 'sunder', masterCompIndex: 1, members: ['akuma'] },
        { id: 'peer', type: C3NetworkType.C3I, color: '#333333', peerIds: ['sunder', 'peer'] },
    ];

    it('indexes hierarchy, membership, endpoint identity, colors, and cyclic traversal', () => {
        const model = new C3Network(networks);

        expect(model.topLevelNetworks.map(network => network.id)).toEqual(['parent', 'peer']);
        expect(model.parentOf('child')?.id).toBe('parent');
        expect(model.parentNetworkForEndpoint('sunder', 1)?.id).toBe('parent');
        expect(model.childrenOf('parent').map(network => network.id)).toEqual(['child']);
        expect(model.masterNetwork('sunder', 1)?.id).toBe('child');
        expect(model.peerNetwork('sunder', C3NetworkType.C3I)?.id).toBe('peer');
        expect(model.networksForUnit('sunder').map(network => network.id)).toEqual(['parent', 'child', 'peer']);
        expect(model.colorsForUnit('sunder')).toEqual(['#111111', '#222222', '#333333']);
        expect(model.isUnitMasterConnected('sunder')).toBeTrue();
        expect(model.isUnitSlaveConnected('atlas')).toBeTrue();
        expect(model.isUnitConnected('missing')).toBeFalse();
        expect(model.networkUnitIds(networks[0])).toEqual(['sunder', 'atlas']);
        expect(model.depthOf('child')).toBe(1);
        expect(model.subTreeDepth('parent')).toBe(1);
        expect(model.treeUnitIds('parent')).toEqual(new Set(['sunder', 'atlas', 'akuma']));
        expect(model.treeEndpointKeys('parent')).toEqual(new Set([
            'master:sunder:0',
            'master:sunder:1',
            'slave:atlas',
            'slave:akuma',
        ]));
        expect(model.connectionBetween(
            { unitId: 'sunder', compIndex: 0 }, C3Role.MASTER,
            { unitId: 'sunder', compIndex: 1 }, C3Role.MASTER,
        )).toEqual({ networkId: 'parent', member: 'sunder:1' });
        expect(model.connectionBetween(
            { unitId: 'sunder', compIndex: 1 }, C3Role.MASTER,
            { unitId: 'sunder', compIndex: 0 }, C3Role.MASTER,
        )).toEqual({ networkId: 'parent', member: 'sunder:1' });
        expect(model.connectionBetween(
            { unitId: 'sunder', compIndex: 0 }, C3Role.MASTER,
            { unitId: 'missing', compIndex: 0 }, C3Role.MASTER,
        )).toBeUndefined();
        expect(model.connectionBetween(
            { unitId: 'sunder', compIndex: 2 }, C3Role.PEER,
            { unitId: 'peer', compIndex: 0 }, C3Role.PEER,
            C3NetworkType.C3I,
        )).toEqual({ networkId: 'peer' });

        const cyclic: SerializedC3NetworkGroup[] = [
            { id: 'a', type: C3NetworkType.C3, color: '#1', masterId: 'a', masterCompIndex: 0, members: ['b:0'] },
            { id: 'b', type: C3NetworkType.C3, color: '#2', masterId: 'b', masterCompIndex: 0, members: ['a:0'] },
        ];
        expect(new C3Network(cyclic).treeNetworks('a').map(network => network.id).sort()).toEqual(['a', 'b']);
    });

    it('parses valid exact indexes and preserves malformed IDs as bare IDs', () => {
        expect(C3Network.parseMember('unit:2')).toEqual({ unitId: 'unit', compIndex: 2 });
        expect(C3Network.parseMember('unit')).toEqual({ unitId: 'unit' });
        expect(C3Network.parseMember('unit:nope')).toEqual({ unitId: 'unit:nope' });
        expect(C3Network.parseMember('unit:-1')).toEqual({ unitId: 'unit:-1' });
        expect(C3Network.masterMember('unit', 0)).toBe('unit:0');
    });
});

describe('C3Network runtime', () => {
    [
        [C3NetworkType.C3I, C3_FLAGS.C3I],
        [C3NetworkType.NAVAL, C3_FLAGS.NAVAL_C3],
        [C3NetworkType.NOVA, C3_FLAGS.NOVA],
    ].forEach(([type, flag]) => {
        it(`matches every legal ${type} damage state and representative jamming boundaries`, () => {
            for (let size = 2; size <= C3_NETWORK_LIMITS[type as C3NetworkType]; size++) {
                const states = Array.from({ length: size }, (_, index) => c3Unit(`peer-${index}`, flag));
                const units = states.map(({ unit }) => unit);
                const network = peerNetwork(states, type as C3NetworkType);
                const stateCount = 1 << size;
                const allUnitsMask = stateCount - 1;
                for (let operationalMask = 0; operationalMask < stateCount; operationalMask++) {
                    states.forEach((state, index) => state.operational.set((operationalMask & (1 << index)) !== 0));
                    const operationalCount = states.filter((_, index) => (operationalMask & (1 << index)) !== 0).length;
                    const jammedMasks = new Set([
                        0,
                        operationalMask,
                        allUnitsMask ^ operationalMask,
                        allUnitsMask,
                    ]);
                    for (let index = 0; index < size; index++) {
                        const unitMask = 1 << index;
                        if ((operationalMask & unitMask) === 0) continue;
                        jammedMasks.add(unitMask);
                        jammedMasks.add(operationalMask & ~unitMask);
                    }
                    for (const jammedMask of jammedMasks) {
                        states.forEach((state, index) => state.jammed.set((jammedMask & (1 << index)) !== 0));
                        const model = new C3Network(network, units);
                        states.forEach(({ unit }, index) => {
                            const unitMask = 1 << index;
                            const linked = (operationalMask & unitMask) !== 0 && operationalCount >= 2;
                            const operationalCounterpartsMask = operationalMask & ~unitMask;
                            const degraded = linked && ((jammedMask & unitMask) !== 0
                                || (jammedMask & operationalCounterpartsMask) === operationalCounterpartsMask);
                            expect(model.stateFor(unit.id, type as C3NetworkType)).withContext(
                                `${type} size=${size} operational=${operationalMask} jammed=${jammedMask} unit=${index}`
                            ).toEqual({ linked, degraded, color: '#1565C0' });
                        });
                    }
                }
            }
        });
    });

    it('uses exact Sunder endpoints, splits on damage, and chooses the operational root color', () => {
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        sunder.unit.getInventory().push(new MountedEquipment({
            owner: sunder.unit, id: 'second', name: 'second',
            equipment: { flags: new Set([C3_FLAGS.C3M]) } as Equipment, states: new Map(),
        }));
        const atlas = c3Unit('atlas', C3_FLAGS.C3M);
        const akuma = c3Unit('akuma', C3_FLAGS.C3S);
        const unavailable = new Set<string>();
        sunder.unit.isC3EndpointOperational = index => !unavailable.has(`sunder:${index}`);
        atlas.unit.isC3EndpointOperational = index => !unavailable.has(`atlas:${index}`);
        akuma.unit.isC3EndpointOperational = index => !unavailable.has(`akuma:${index}`);
        atlas.jammed.set(true);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'a', type: C3NetworkType.C3, color: '#111111', masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1', 'atlas:0'] },
            { id: 'b', type: C3NetworkType.C3, color: '#222222', masterId: 'sunder', masterCompIndex: 1, members: ['akuma'] },
        ];
        const build = () => new C3Network(networks, [sunder.unit, atlas.unit, akuma.unit]);

        expect(build().links.map(link => `${link.source.unitId}:${link.source.compIndex}>${link.target.unitId}:${link.target.compIndex}`))
            .toEqual(['sunder:0>sunder:1', 'sunder:0>atlas:0', 'sunder:1>akuma:0']);
        expect(build().stateForNetwork('atlas', 'a')).toEqual({ linked: true, degraded: true, color: '#111111' });
        expect(build().stateForNetwork('sunder', 'a')).toEqual({ linked: true, degraded: false, color: '#111111' });
        expect(build().stateForNetwork('sunder', 'b')).toEqual({ linked: true, degraded: false, color: '#111111' });
        expect(build().stateFor('akuma', C3NetworkType.C3)).toEqual({ linked: true, degraded: false, color: '#111111' });
        unavailable.add('sunder:0');
        expect(build().stateFor('atlas', C3NetworkType.C3)).toEqual({ linked: false, degraded: false, color: '#111111' });
        expect(build().stateFor('akuma', C3NetworkType.C3)).toEqual({ linked: true, degraded: false, color: '#222222' });
    });

    it('matches every standard C3 endpoint availability and jamming combination', () => {
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        sunder.unit.getInventory().push(new MountedEquipment({
            owner: sunder.unit, id: 'second', name: 'second',
            equipment: { flags: new Set([C3_FLAGS.C3M]) } as Equipment, states: new Map(),
        }));
        const atlas = c3Unit('atlas', C3_FLAGS.C3M);
        const akuma = c3Unit('akuma', C3_FLAGS.C3S);
        const units = [sunder, atlas, akuma];
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'a', type: C3NetworkType.C3, color: '#111111', masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1', 'atlas:0'] },
            { id: 'b', type: C3NetworkType.C3, color: '#222222', masterId: 'sunder', masterCompIndex: 1, members: ['akuma'] },
        ];
        const endpointKeys = ['sunder:0', 'sunder:1', 'atlas:0', 'akuma:0'];
        const endpointsByUnit = new Map<string, readonly string[]>([
            ['sunder', ['sunder:0', 'sunder:1']],
            ['atlas', ['atlas:0']],
            ['akuma', ['akuma:0']],
        ]);
        const structuralEdges = [
            { networkId: 'a', source: 'sunder:0', target: 'sunder:1', color: '#111111', subordinateMasterId: 'sunder' },
            { networkId: 'a', source: 'sunder:0', target: 'atlas:0', color: '#111111', subordinateMasterId: 'atlas' },
            { networkId: 'b', source: 'sunder:1', target: 'akuma:0', color: '#222222' },
        ];

        for (let operationalMask = 0; operationalMask < 1 << endpointKeys.length; operationalMask++) {
            const isOperational = (endpoint: string) =>
                (operationalMask & (1 << endpointKeys.indexOf(endpoint))) !== 0;
            units.forEach(({ unit }) => {
                unit.isC3EndpointOperational = componentIndex => isOperational(`${unit.id}:${componentIndex}`);
            });
            const operationalEdges = structuralEdges.filter(edge =>
                isOperational(edge.source) && isOperational(edge.target));

            for (let jammedMask = 0; jammedMask < 1 << units.length; jammedMask++) {
                units.forEach((state, index) => state.jammed.set((jammedMask & (1 << index)) !== 0));
                const model = new C3Network(networks, units.map(({ unit }) => unit));
                const healthyEdges = operationalEdges.filter(edge => {
                    const sourceId = edge.source.slice(0, edge.source.lastIndexOf(':'));
                    const targetId = edge.target.slice(0, edge.target.lastIndexOf(':'));
                    return !units.find(state => state.unit.id === sourceId)!.jammed()
                        && !units.find(state => state.unit.id === targetId)!.jammed();
                });
                const effectiveColor = (localEndpoints: readonly string[], networkId: string, fallback: string) => {
                    const adjacency = new Map<string, Set<string>>();
                    for (const edge of healthyEdges) {
                        const source = adjacency.get(edge.source) ?? new Set<string>();
                        source.add(edge.target);
                        adjacency.set(edge.source, source);
                        const target = adjacency.get(edge.target) ?? new Set<string>();
                        target.add(edge.source);
                        adjacency.set(edge.target, target);
                    }
                    const networkEndpoints = structuralEdges.filter(edge => edge.networkId === networkId)
                        .flatMap(edge => [edge.source, edge.target]);
                    const stack = localEndpoints.filter(endpoint => networkEndpoints.includes(endpoint) && adjacency.has(endpoint));
                    const component = new Set<string>();
                    while (stack.length) {
                        const endpoint = stack.pop()!;
                        if (component.has(endpoint)) continue;
                        component.add(endpoint);
                        stack.push(...(adjacency.get(endpoint) ?? []));
                    }
                    const links = healthyEdges.filter(edge => component.has(edge.source) && component.has(edge.target));
                    const targets = new Set(links.map(edge => edge.target));
                    return links.find(edge => !targets.has(edge.source))?.color ?? links[0]?.color ?? fallback;
                };

                for (const { unit } of units) {
                    const localEndpoints = endpointsByUnit.get(unit.id)!;
                    const participations = networks.flatMap(network => {
                        const networkEdges = structuralEdges.filter(edge => edge.networkId === network.id);
                        if (!networkEdges.some(edge => localEndpoints.includes(edge.source) || localEndpoints.includes(edge.target))) return [];
                        const activeEdges = operationalEdges.filter(edge => edge.networkId === network.id);
                        const linked = activeEdges.some(edge => localEndpoints.includes(edge.source) || localEndpoints.includes(edge.target));
                        const connectedUnitIds = new Set(activeEdges.flatMap(edge => [edge.source, edge.target])
                            .map(endpoint => endpoint.slice(0, endpoint.lastIndexOf(':'))));
                        const directSlaveIds = new Set(networkEdges
                            .filter(edge => edge.subordinateMasterId === undefined)
                            .map(edge => edge.target.slice(0, edge.target.lastIndexOf(':'))));
                        const isJammed = (id: string) => units.find(state => state.unit.id === id)!.jammed();
                        const degraded = linked && (isJammed(unit.id) || (
                            directSlaveIds.has(unit.id)
                                ? [...connectedUnitIds].some(id => id === network.masterId && isJammed(id))
                                : network.masterId !== unit.id && isJammed(network.masterId!)
                                    || network.masterId === unit.id
                                        && [...connectedUnitIds].some(id => directSlaveIds.has(id) && isJammed(id))
                        ));
                        return [{ linked, degraded, color: linked
                            ? effectiveColor(localEndpoints, network.id, network.color)
                            : network.color }];
                    });
                    const linkedStates = participations.filter(state => state.linked);
                    const expected = linkedStates.length === 0
                        ? { linked: false, degraded: false, color: participations[0]?.color }
                        : {
                            linked: true,
                            degraded: linkedStates.every(state => state.degraded),
                            color: (linkedStates.find(state => !state.degraded) ?? linkedStates[0]).color,
                        };

                    expect(model.stateFor(unit.id, C3NetworkType.C3)).withContext(
                        `operational=${operationalMask.toString(2)}, jammed=${jammedMask.toString(2)}, unit=${unit.id}`
                    ).toEqual(expected);
                }
            }
        }
    });

    it('degrades only direct slave leaves when a grand master is jammed', () => {
        const grandMaster = c3Unit('grand-master', C3_FLAGS.C3M);
        const subordinateMaster = c3Unit('subordinate-master', C3_FLAGS.C3M);
        const directLeaf = c3Unit('direct-leaf', C3_FLAGS.C3S);
        const childLeaf = c3Unit('child-leaf', C3_FLAGS.C3S);
        grandMaster.jammed.set(true);
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'parent', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'grand-master', masterCompIndex: 0,
                members: ['subordinate-master:0', 'direct-leaf'],
            },
            {
                id: 'child', type: C3NetworkType.C3, color: '#E65100',
                masterId: 'subordinate-master', masterCompIndex: 0,
                members: ['child-leaf'],
            },
        ];
        const model = new C3Network(networks, [
            grandMaster.unit, subordinateMaster.unit, directLeaf.unit, childLeaf.unit,
        ]);

        expect(model.stateForNetwork('grand-master', 'parent').degraded).toBeTrue();
        expect(model.stateForNetwork('direct-leaf', 'parent')).toEqual({
            linked: true, degraded: true, color: '#7B1FA2',
        });
        expect(model.stateForNetwork('subordinate-master', 'parent')).toEqual({
            linked: true, degraded: true, color: '#E65100',
        });
        expect(model.stateForNetwork('subordinate-master', 'child')).toEqual({
            linked: true, degraded: false, color: '#E65100',
        });
        expect(model.stateFor('child-leaf', C3NetworkType.C3)).toEqual({
            linked: true, degraded: false, color: '#E65100',
        });
    });

    it('inherits the GrandMaster color while the hierarchy is healthy', () => {
        const grandMaster = c3Unit('grand-master', C3_FLAGS.C3M);
        const subordinateMaster = c3Unit('subordinate-master', C3_FLAGS.C3M);
        const childLeaf = c3Unit('child-leaf', C3_FLAGS.C3S);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'parent', type: C3NetworkType.C3, color: '#7B1FA2', masterId: 'grand-master', masterCompIndex: 0,
                members: ['subordinate-master:0'] },
            { id: 'child', type: C3NetworkType.C3, color: '#E65100', masterId: 'subordinate-master', masterCompIndex: 0,
                members: ['child-leaf'] },
        ];

        const model = new C3Network(networks, [grandMaster.unit, subordinateMaster.unit, childLeaf.unit]);

        expect(model.stateForNetwork('child-leaf', 'child').color).toBe('#7B1FA2');
        expect(model.stateFor('child-leaf', C3NetworkType.C3).color).toBe('#7B1FA2');
    });

    it('memoizes runtime state within one reactive snapshot and rebuilds when state changes', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        const networks: SerializedC3NetworkGroup[] = [{ id: 'network', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0, members: ['slave'] }];
        let builds = 0;
        const model = computed(() => { builds++; return new C3Network(networks, [master.unit, slave.unit]); });
        const first = model();
        expect(first.stateFor('slave', C3NetworkType.C3)).toBe(first.stateFor('slave', C3NetworkType.C3));
        expect(builds).toBe(1);
        master.jammed.set(true);
        expect(model()).not.toBe(first);
        expect(model().stateFor('slave', C3NetworkType.C3).degraded).toBeTrue();
    });

    it('automatically relinks the failed master direct network through the first emergency master', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const first = emergencyMasterUnit('first-emergency');
        const second = emergencyMasterUnit('second-emergency');
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        master.operational.set(false);
        const network: SerializedC3NetworkGroup = {
            id: 'network', type: C3NetworkType.C3, color: '#123456', masterId: 'master', masterCompIndex: 0,
            members: ['first-emergency', 'second-emergency', 'slave'],
        };

        const model = new C3Network([network], [master.unit, first.unit, second.unit, slave.unit]);

        expect(model.links.map(link => `${link.source.unitId}>${link.target.unitId}`)).toEqual([
            'first-emergency>second-emergency',
            'first-emergency>slave',
        ]);
        expect(model.stateFor('slave', C3NetworkType.C3)).toEqual({ linked: true, degraded: false, color: '#123456' });
        expect(model.emergencyMasterStatus(first.unit.getInventory()[0])).toBe('active');
        expect(model.emergencyMasterStatus(second.unit.getInventory()[0])).toBe('standby');
    });

    it('pauses automatic emergency mode when the master recovers and resumes at the retained count', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const emergency = emergencyMasterUnit('emergency');
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        const mount = emergency.unit.getInventory()[0];
        mount.setState(C3EM_OPERATING_TURNS_STATE_KEY, '3');
        const network: SerializedC3NetworkGroup = {
            id: 'network', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0,
            members: ['emergency', 'slave'],
        };

        master.jammed.set(true);
        expect(new C3Network([network], [master.unit, emergency.unit, slave.unit]).emergencyMasterStatus(mount)).toBe('active');
        master.jammed.set(false);
        expect(new C3Network([network], [master.unit, emergency.unit, slave.unit]).emergencyMasterStatus(mount)).toBe('dormant');
        expect(new C3Network([network], [master.unit, emergency.unit, slave.unit]).emergencyMasterOperatingTurns(mount)).toBe(3);
        master.operational.set(false);
        expect(new C3Network([network], [master.unit, emergency.unit, slave.unit]).emergencyMasterStatus(mount)).toBe('active');
    });

    it('honors manual emergency override and suppresses takeover while the emergency unit is jammed', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const emergency = emergencyMasterUnit('emergency');
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        const mount = emergency.unit.getInventory()[0];
        const network: SerializedC3NetworkGroup = {
            id: 'network', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0,
            members: ['emergency', 'slave'],
        };
        const build = () => new C3Network([network], [master.unit, emergency.unit, slave.unit]);

        mount.setState(C3EM_MODE_STATE_KEY, 'on');
        expect(build().links[0].source.unitId).toBe('emergency');
        emergency.jammed.set(true);
        expect(build().emergencyMasterStatus(mount)).toBe('standby');
        expect(build().stateFor('slave', C3NetworkType.C3).degraded).toBeFalse();
        emergency.jammed.set(false);
        mount.setState(C3EM_MODE_STATE_KEY, 'off');
        master.operational.set(false);
        expect(build().emergencyMasterStatus(mount)).toBe('dormant');
        expect(build().stateFor('slave', C3NetworkType.C3).linked).toBeFalse();
    });

    it('isolates a subordinate emergency network instead of reconnecting it to the parent hierarchy', () => {
        const root = c3Unit('root', C3_FLAGS.C3M);
        const subordinate = c3Unit('subordinate', C3_FLAGS.C3M);
        const emergency = emergencyMasterUnit('emergency');
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        subordinate.operational.set(false);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'parent', type: C3NetworkType.C3, color: '#111', masterId: 'root', masterCompIndex: 0, members: ['subordinate:0'] },
            { id: 'child', type: C3NetworkType.C3, color: '#222', masterId: 'subordinate', masterCompIndex: 0, members: ['emergency', 'slave'] },
        ];

        const model = new C3Network(networks, [root.unit, subordinate.unit, emergency.unit, slave.unit]);

        expect(model.findLink('parent', { unitId: 'root', compIndex: 0 }, { unitId: 'subordinate', compIndex: 0 })?.operational).toBeFalse();
        expect(model.stateFor('slave', C3NetworkType.C3)).toEqual({ linked: true, degraded: false, color: '#222' });
        expect(model.stateFor('root', C3NetworkType.C3).linked).toBeFalse();
    });

    it('removes a fried emergency master from both master and slave operation', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const emergency = emergencyMasterUnit('emergency');
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        emergency.unit.getInventory()[0].setState(C3EM_OPERATING_TURNS_STATE_KEY, '7');
        const network: SerializedC3NetworkGroup = {
            id: 'network', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0,
            members: ['emergency', 'slave'],
        };

        let model = new C3Network([network], [master.unit, emergency.unit, slave.unit]);
        expect(model.emergencyMasterStatus(emergency.unit.getInventory()[0])).toBe('fried');
        expect(model.stateFor('emergency', C3NetworkType.C3).linked).toBeFalse();
        master.operational.set(false);
        model = new C3Network([network], [master.unit, emergency.unit, slave.unit]);
        expect(model.stateFor('slave', C3NetworkType.C3).linked).toBeFalse();
    });
});

describe('C3TaxCalculator', () => {
    it('never evaluates runtime jamming or endpoint availability while calculating structural taxes', () => {
        const alpha = c3Unit('alpha', C3_FLAGS.C3I, 1000, 100);
        const bravo = c3Unit('bravo', C3_FLAGS.C3I, 2000);
        const jammedSpies = [alpha, bravo].map(({ unit }) =>
            spyOn(unit, 'isC3Jammed').and.throwError('runtime jamming must not be read'));
        const operationalSpies = [alpha, bravo].map(({ unit }) =>
            spyOn(unit, 'isC3EndpointOperational').and.throwError('runtime availability must not be read'));

        const calculator = new C3TaxCalculator(
            peerNetwork([alpha, bravo], C3NetworkType.C3I),
            [alpha.unit, bravo.unit],
        );

        expect(calculator.core2026(alpha.unit)).toBe(110);
        expect(calculator.totalWar(alpha.unit)).toBe(155);
        jammedSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
        operationalSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    });

    it('calculates Core 2026 and Total Warfare taxes from structural indexes', () => {
        const alpha = c3Unit('alpha', C3_FLAGS.C3I, 1000, 100);
        const bravo = c3Unit('bravo', C3_FLAGS.C3I, 2000);
        const units = [alpha.unit, bravo.unit];
        const calculator = new C3TaxCalculator(peerNetwork([alpha, bravo], C3NetworkType.C3I), units);

        expect(calculator.core2026(alpha.unit)).toBe(110);
        expect(calculator.core2026(bravo.unit)).toBe(200);
        expect(calculator.totalWar(alpha.unit)).toBe(155);
        alpha.operational.set(false);
        alpha.jammed.set(true);
        expect(new C3TaxCalculator(peerNetwork([alpha, bravo], C3NetworkType.C3I), units).core2026(alpha.unit)).toBe(110);
    });

    it('preserves force-wide Nova tax and its upper boundary', () => {
        const nova = Array.from({ length: 8 }, (_, index) => c3Unit(`nova-${index}`, C3_FLAGS.NOVA, 1000));
        const calculator = new C3TaxCalculator([], nova.map(({ unit }) => unit));
        expect(calculator.core2026(nova[0].unit)).toBe(350);
        expect(calculator.totalWar(nova[0].unit)).toBe(350);
        expect(new C3TaxCalculator([], [nova[0].unit]).core2026(nova[0].unit)).toBe(0);
    });
});
