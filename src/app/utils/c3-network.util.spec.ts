import { C3_FLAGS, C3_NETWORK_LIMITS, C3NetworkType, type C3Node } from '../models/c3-network.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { ForceUnit } from '../models/force-unit.model';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { Equipment } from '../models/equipment.model';
import type { SerializedC3NetworkGroup } from '../models/force-serialization';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { C3NetworkUtil } from './c3-network.util';

function c3Unit(id: string, baseBv: number, flag: EquipmentFlag, tagBv = 0): CBTForceUnit {
    const unit = {
        id,
        getBaseBv: () => baseBv,
        tagBV: () => tagBv,
        getUnit: () => ({ comp: [] }),
        getInventory: () => mounts,
    } as unknown as CBTForceUnit;
    const mounts = [new MountedEquipment({
        owner: unit,
        id: `${id}-${flag}`,
        name: flag,
        equipment: { flags: new Set([flag]) } as Equipment,
        states: new Map(),
    })];
    return unit;
}

function peerNetwork(units: CBTForceUnit[], type = C3NetworkType.C3I): SerializedC3NetworkGroup[] {
    return [{
        id: 'peer-network',
        type,
        color: '#1565C0',
        peerIds: units.map(unit => unit.id),
    }];
}

describe('C3NetworkUtil', () => {
    describe('runtime link status', () => {
        const network = {
            id: 'network', type: C3NetworkType.C3, color: '#1565C0',
            masterId: 'master', masterCompIndex: 0, members: ['child:1'],
        } satisfies SerializedC3NetworkGroup;
        const links = [
            {
                network,
                source: { unitId: 'master', compIndex: 0 },
                target: { unitId: 'child', compIndex: 1 },
                operational: true,
            },
            {
                network,
                source: { unitId: 'master', compIndex: 0 },
                target: { unitId: 'broken-child', compIndex: 0 },
                operational: false,
            },
        ];

        it('reports a unit broken only when it has no operational incident link', () => {
            expect(C3NetworkUtil.hasOnlyBrokenIncidentLinks(network.id, 'master', links)).toBeFalse();
            expect(C3NetworkUtil.hasOnlyBrokenIncidentLinks(network.id, 'child', links)).toBeFalse();
            expect(C3NetworkUtil.hasOnlyBrokenIncidentLinks(network.id, 'broken-child', links)).toBeTrue();
            expect(C3NetworkUtil.hasOnlyBrokenIncidentLinks(network.id, 'missing', links)).toBeTrue();
        });

        it('checks the exact child endpoint and network', () => {
            expect(C3NetworkUtil.isChildLinkBroken(network.id, 'child', 1, links)).toBeFalse();
            expect(C3NetworkUtil.isChildLinkBroken(network.id, 'child', 0, links)).toBeTrue();
            expect(C3NetworkUtil.isChildLinkBroken('other-network', 'child', 1, links)).toBeTrue();
            expect(C3NetworkUtil.isChildLinkBroken(network.id, 'broken-child', 0, links)).toBeTrue();
        });
    });

    it('derives ordered C3 endpoints directly from mounted equipment', () => {
        const unit = c3Unit('multi', 1000, C3_FLAGS.C3M);
        const firstMount = unit.getInventory()[0];
        const secondMount = new MountedEquipment({
            owner: unit,
            id: 'second-master',
            name: 'Second Master',
            equipment: { flags: new Set([C3_FLAGS.C3M]) } as Equipment,
            states: new Map(),
        });
        unit.getInventory().push(secondMount);

        const components = C3NetworkUtil.getC3Components(unit);

        expect(components.map(component => component.index)).toEqual([0, 1]);
        expect(components.map(component => component.mount)).toEqual([firstMount, secondMount]);
    });

    it('does not derive CBT C3 capability from Unit.comp', () => {
        const unit = {
            getUnit: () => ({
                comp: [{ q: 1, eq: { flags: new Set([C3_FLAGS.C3M]) } }],
            }),
            getInventory: () => [],
        } as unknown as CBTForceUnit;

        expect(C3NetworkUtil.getC3Components(unit)).toEqual([]);
    });

    it('derives Alpha Strike C3 endpoints from specials without mounted equipment', () => {
        const unit = {
            getUnit: () => ({ comp: [], as: { specials: ['C3M2'] } }),
        } as unknown as ForceUnit;

        const components = C3NetworkUtil.getC3Components(unit);

        expect(components.length).toBe(2);
        expect(components.every(component => component.mount === undefined)).toBeTrue();
        expect(components.every(component => component.role === 'master')).toBeTrue();
    });

    it('removes CBT networks whose endpoints are not represented by mounts', () => {
        const staticOnlyMaster = {
            id: 'master',
            getUnit: () => ({ comp: [{ q: 1, eq: { flags: new Set([C3_FLAGS.C3M]) } }] }),
            getInventory: () => [],
        } as unknown as CBTForceUnit;
        const slave = c3Unit('slave', 1000, C3_FLAGS.C3S);
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'network', type: C3NetworkType.C3, color: '#1565C0',
            masterId: 'master', masterCompIndex: 0, members: ['slave'],
        }];

        expect(C3NetworkUtil.validateAndCleanNetworks(networks, new Map([
            ['master', staticOnlyMaster],
            ['slave', slave],
        ]))).toEqual([]);
    });

    it('rejects network shapes that do not match their network type', () => {
        const c3Master = c3Unit('c3-master', 1000, C3_FLAGS.C3M);
        const c3Slave = c3Unit('c3-slave', 1000, C3_FLAGS.C3S);
        const peerA = c3Unit('peer-a', 1000, C3_FLAGS.C3I);
        const peerB = c3Unit('peer-b', 1000, C3_FLAGS.C3I);
        const units = new Map<string, ForceUnit>([
            [c3Master.id, c3Master], [c3Slave.id, c3Slave],
            [peerA.id, peerA], [peerB.id, peerB],
        ]);
        const malformedNetworks: SerializedC3NetworkGroup[] = [
            {
                id: 'c3-as-peers', type: C3NetworkType.C3, color: '#1565C0',
                peerIds: [c3Master.id, c3Slave.id],
            },
            {
                id: 'c3i-as-hierarchy', type: C3NetworkType.C3I, color: '#2E7D32',
                masterId: peerA.id, masterCompIndex: 0, members: [peerB.id],
            },
        ];

        expect(C3NetworkUtil.validateAndCleanNetworks(malformedNetworks, units)).toEqual([]);
    });

    it('rejects ambiguous peer networks and unknown network types', () => {
        const peerA = c3Unit('peer-a', 1000, C3_FLAGS.C3I);
        const peerB = c3Unit('peer-b', 1000, C3_FLAGS.C3I);
        const units = new Map<string, ForceUnit>([[peerA.id, peerA], [peerB.id, peerB]]);
        const malformedNetworks: SerializedC3NetworkGroup[] = [
            {
                id: 'ambiguous', type: C3NetworkType.C3I, color: '#1565C0',
                peerIds: [peerA.id, peerB.id], masterId: peerA.id,
            },
            {
                id: 'unknown', type: 'unknown' as C3NetworkType, color: '#2E7D32',
                peerIds: [peerA.id, peerB.id],
            },
        ];

        expect(C3NetworkUtil.validateAndCleanNetworks(malformedNetworks, units)).toEqual([]);
    });

    it('preserves independent network trees for each mounted network type', () => {
        const multi = c3Unit('multi', 1000, C3_FLAGS.C3S);
        multi.getInventory().push(c3Unit('multi-peer-mount', 1000, C3_FLAGS.C3I).getInventory()[0]);
        const master = c3Unit('master', 1000, C3_FLAGS.C3M);
        const peer = c3Unit('peer', 1000, C3_FLAGS.C3I);
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'hierarchy', type: C3NetworkType.C3, color: '#1565C0',
                masterId: master.id, masterCompIndex: 0, members: [multi.id], peerIds: [],
            },
            {
                id: 'peers', type: C3NetworkType.C3I, color: '#2E7D32',
                peerIds: [multi.id, peer.id],
            },
        ];

        expect(C3NetworkUtil.validateAndCleanNetworks(networks, new Map([
            [multi.id, multi], [master.id, master], [peer.id, peer],
        ]))).toEqual([
            {
                id: 'hierarchy', type: C3NetworkType.C3, color: '#1565C0',
                masterId: master.id, masterCompIndex: 0, members: [multi.id],
            },
            networks[1],
        ]);
    });

    it('rejects hierarchical endpoints whose mounted network type does not match', () => {
        const peerMaster = c3Unit('peer-master', 1000, C3_FLAGS.C3I);
        const peerMember = c3Unit('peer-member', 1000, C3_FLAGS.C3I);
        const malformedNetwork: SerializedC3NetworkGroup[] = [{
            id: 'wrong-endpoints', type: C3NetworkType.C3, color: '#1565C0',
            masterId: peerMaster.id, masterCompIndex: 0, members: [peerMember.id],
        }];

        expect(C3NetworkUtil.validateAndCleanNetworks(malformedNetwork, new Map([
            [peerMaster.id, peerMaster], [peerMember.id, peerMember],
        ]))).toEqual([]);
    });

    it('deduplicates validated endpoints before enforcing network sizes', () => {
        const peerA = c3Unit('peer-a', 1000, C3_FLAGS.C3I);
        const peerB = c3Unit('peer-b', 1000, C3_FLAGS.C3I);
        const master = c3Unit('master', 1000, C3_FLAGS.C3M);
        const slave = c3Unit('slave', 1000, C3_FLAGS.C3S);
        const units = new Map<string, ForceUnit>([
            [peerA.id, peerA], [peerB.id, peerB], [master.id, master], [slave.id, slave],
        ]);
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'invalid-duplicate-peer', type: C3NetworkType.C3I, color: '#1565C0',
                peerIds: [peerA.id, peerA.id],
            },
            {
                id: 'valid-peers', type: C3NetworkType.C3I, color: '#2E7D32',
                peerIds: [peerA.id, peerA.id, peerB.id],
            },
            {
                id: 'valid-hierarchy', type: C3NetworkType.C3, color: '#C62828',
                masterId: master.id, masterCompIndex: 0, members: [slave.id, slave.id],
            },
        ];

        expect(C3NetworkUtil.validateAndCleanNetworks(networks, units)).toEqual([
            { ...networks[1], peerIds: [peerA.id, peerB.id] },
            { ...networks[2], members: [slave.id] },
        ]);
    });

    it('derives slave and peer endpoints from role and network type', () => {
        const slave = c3Unit('slave', 1000, C3_FLAGS.C3S);
        slave.getInventory().push(c3Unit('local-master', 1000, C3_FLAGS.C3M).getInventory()[0]);
        slave.getInventory().push(c3Unit('local-peer', 1000, C3_FLAGS.C3I).getInventory()[0]);
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'network', type: C3NetworkType.C3, color: '#1565C0',
            masterId: 'master', masterCompIndex: 0, members: ['slave']
        }];

        expect(C3NetworkUtil.findConnectedComponentIndexes('slave', slave, networks)).toEqual([0]);
        expect(C3NetworkUtil.findConnectedComponentIndexes('slave', slave, [{
            id: 'peer-network', type: C3NetworkType.C3I, color: '#1565C0', peerIds: ['slave', 'peer']
        }])).toEqual([2]);
    });

    it('serializes slave and peer connections without redundant component indexes', () => {
        const master = c3Unit('master', 1000, C3_FLAGS.C3M);
        const slave = c3Unit('slave', 1000, C3_FLAGS.C3S);
        const peerA = c3Unit('peer-a', 1000, C3_FLAGS.C3I);
        const peerB = c3Unit('peer-b', 1000, C3_FLAGS.C3I);
        const node = (unit: CBTForceUnit): C3Node => ({
            unit,
            c3Components: C3NetworkUtil.getC3Components(unit),
            x: 0, y: 0, zIndex: 0, pinOffsetsX: []
        });
        const context = {
            networks: [] as SerializedC3NetworkGroup[],
            getNextColor: () => '#1565C0'
        };

        const standard = C3NetworkUtil.createConnection(context, node(master), 0, node(slave), 0);
        expect(standard.success).toBeTrue();
        expect(standard.networks[0].members).toEqual(['slave']);

        const peer = C3NetworkUtil.createConnection(context, node(peerA), 0, node(peerB), 0);
        expect(peer.success).toBeTrue();
        expect(peer.networks[0].peerIds).toEqual(['peer-a', 'peer-b']);
    });

    it('serializes a master-to-master gesture from source parent to target child', () => {
        const parent = c3Unit('parent', 1000, C3_FLAGS.C3M);
        const child = c3Unit('child', 1000, C3_FLAGS.C3M);
        const node = (unit: CBTForceUnit): C3Node => ({
            unit,
            c3Components: C3NetworkUtil.getC3Components(unit),
            x: 0, y: 0, zIndex: 0, pinOffsetsX: [],
        });
        const context = {
            networks: [] as SerializedC3NetworkGroup[],
            getNextColor: () => '#1565C0',
        };

        const result = C3NetworkUtil.createConnection(context, node(parent), 0, node(child), 0);

        expect(result.success).toBeTrue();
        expect(result.networks[0].masterId).toBe('parent');
        expect(result.networks[0].masterCompIndex).toBe(0);
        expect(result.networks[0].members).toEqual(['child:0']);
    });

    it('derives hierarchy degradation and root color from surviving exact-pin links', () => {
        const sunder = c3Unit('sunder', 1000, C3_FLAGS.C3M);
        sunder.getInventory().push(c3Unit('sunder-b-mount', 1000, C3_FLAGS.C3M).getInventory()[0]);
        const atlas = c3Unit('atlas', 1000, C3_FLAGS.C3M);
        const akuma = c3Unit('akuma', 1000, C3_FLAGS.C3S);
        const units = new Map<string, ForceUnit>([
            [sunder.id, sunder], [atlas.id, atlas], [akuma.id, akuma],
        ]);
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'master-a', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1', 'atlas:0'],
            },
            {
                id: 'master-b', type: C3NetworkType.C3, color: '#2E7D32',
                masterId: 'sunder', masterCompIndex: 1, members: ['akuma'],
            },
        ];
        const unavailable = new Set<string>();
        const jammed = new Set<string>(['atlas']);
        const buildLinks = () => C3NetworkUtil.getRuntimeLinks(
            networks,
            units,
            (unit, componentIndex) => !unavailable.has(`${unit.id}:${componentIndex}`),
        );

        expect(buildLinks().map(link => `${link.source.unitId}:${link.source.compIndex}>${link.target.unitId}:${link.target.compIndex}`))
            .toEqual(['sunder:0>sunder:1', 'sunder:0>atlas:0', 'sunder:1>akuma:0']);

        expect(C3NetworkUtil.getRuntimeUnitState('akuma', C3NetworkType.C3, buildLinks(), id => jammed.has(id)))
            .toEqual({ linked: true, degraded: true, color: '#1565C0' });

        unavailable.add('sunder:0');
        expect(C3NetworkUtil.getRuntimeUnitState('atlas', C3NetworkType.C3, buildLinks(), id => jammed.has(id)))
            .toEqual({ linked: false, degraded: false, color: '#1565C0' });
        expect(C3NetworkUtil.getRuntimeUnitState('akuma', C3NetworkType.C3, buildLinks(), id => jammed.has(id)))
            .toEqual({ linked: true, degraded: false, color: '#2E7D32' });
    });

    it('keeps surviving peers connected when another peer endpoint fails', () => {
        const peers = ['alpha', 'bravo', 'charlie'].map(id => c3Unit(id, 1000, C3_FLAGS.C3I));
        const units = new Map<string, ForceUnit>(peers.map(unit => [unit.id, unit]));
        const network = peerNetwork(peers);
        const links = C3NetworkUtil.getRuntimeLinks(
            network,
            units,
            unit => unit.id !== 'alpha',
        );

        expect(C3NetworkUtil.getRuntimeUnitState('alpha', C3NetworkType.C3I, links, () => false).linked).toBeFalse();
        expect(C3NetworkUtil.getRuntimeUnitState('bravo', C3NetworkType.C3I, links, () => false).linked).toBeTrue();
        expect(C3NetworkUtil.getRuntimeUnitState('charlie', C3NetworkType.C3I, links, () => false).linked).toBeTrue();
    });

    [
        { type: C3NetworkType.C3I, flag: C3_FLAGS.C3I },
        { type: C3NetworkType.NAVAL, flag: C3_FLAGS.NAVAL_C3 },
        { type: C3NetworkType.NOVA, flag: C3_FLAGS.NOVA },
    ].forEach(({ type, flag }) => {
        it(`keeps ${type} jamming local until every healthy unit's counterpart is jammed`, () => {
            const peers = ['alpha', 'bravo', 'charlie'].map(id => c3Unit(id, 1000, flag));
            const units = new Map<string, ForceUnit>(peers.map(unit => [unit.id, unit]));
            const links = C3NetworkUtil.getRuntimeLinks(
                peerNetwork(peers, type),
                units,
                () => true,
            );
            const jammed = new Set<string>();
            const state = (unitId: string) => C3NetworkUtil.getRuntimeUnitState(
                unitId,
                type,
                links,
                candidateId => jammed.has(candidateId),
            );

            expect(state('alpha').degraded).toBeFalse();

            jammed.add('bravo');
            expect(state('alpha').degraded).toBeFalse();
            expect(state('bravo').degraded).toBeTrue();
            expect(state('charlie').degraded).toBeFalse();

            jammed.add('charlie');
            expect(state('alpha').degraded).toBeTrue();

            const twoPeerLinks = C3NetworkUtil.getRuntimeLinks(
                peerNetwork(peers.slice(0, 2), type),
                units,
                () => true,
            );
            expect(C3NetworkUtil.getRuntimeUnitState(
                'alpha', type, twoPeerLinks, candidateId => candidateId === 'bravo').degraded
            ).toBeTrue();
        });

        it(`evaluates ${type} jamming only among surviving operational peers`, () => {
            const peers = ['alpha', 'bravo', 'charlie', 'delta'].map(id => c3Unit(id, 1000, flag));
            const units = new Map<string, ForceUnit>(peers.map(unit => [unit.id, unit]));
            const network = peerNetwork(peers, type);
            const unavailable = new Set<string>(['charlie', 'delta']);
            const buildLinks = () => C3NetworkUtil.getRuntimeLinks(
                network,
                units,
                unit => !unavailable.has(unit.id),
            );
            const jammed = new Set<string>(['bravo']);
            const alphaState = () => C3NetworkUtil.getRuntimeUnitState(
                'alpha', type, buildLinks(), candidateId => jammed.has(candidateId));

            expect(alphaState()).toEqual({
                linked: true,
                degraded: true,
                color: '#1565C0',
            });

            unavailable.add('bravo');
            expect(alphaState()).toEqual({
                linked: false,
                degraded: false,
                color: '#1565C0',
            });
        });
    });

    describe('exhaustive peer runtime state matrices', () => {
        [
            { type: C3NetworkType.C3I, flag: C3_FLAGS.C3I },
            { type: C3NetworkType.NAVAL, flag: C3_FLAGS.NAVAL_C3 },
            { type: C3NetworkType.NOVA, flag: C3_FLAGS.NOVA },
        ].forEach(({ type, flag }) => {
            it(`matches the ${type} oracle for every legal size, damage mask, and jamming mask`, () => {
                for (let size = 2; size <= C3_NETWORK_LIMITS[type]; size++) {
                    const peers = Array.from({ length: size }, (_, index) =>
                        c3Unit(`peer-${index}`, 1000, flag));
                    const units = new Map<string, ForceUnit>(peers.map(unit => [unit.id, unit]));
                    const network = peerNetwork(peers, type);
                    const stateCount = 1 << size;

                    for (let operationalMask = 0; operationalMask < stateCount; operationalMask++) {
                        const links = C3NetworkUtil.getRuntimeLinks(
                            network,
                            units,
                            unit => (operationalMask & (1 << Number(unit.id.slice(5)))) !== 0,
                        );
                        const operationalUnitIds = peers
                            .filter((_, index) => (operationalMask & (1 << index)) !== 0)
                            .map(unit => unit.id);

                        for (let jammedMask = 0; jammedMask < stateCount; jammedMask++) {
                            const isJammed = (unitId: string) =>
                                (jammedMask & (1 << Number(unitId.slice(5)))) !== 0;

                            peers.forEach((peer, peerIndex) => {
                                const peerOperational = (operationalMask & (1 << peerIndex)) !== 0;
                                const expectedLinked = peerOperational && operationalUnitIds.length >= 2;
                                const operationalCounterparts = operationalUnitIds.filter(id => id !== peer.id);
                                const expectedDegraded = expectedLinked && (
                                    isJammed(peer.id) || operationalCounterparts.every(isJammed)
                                );
                                const context = `${type}, size=${size}, operational=${operationalMask.toString(2)}, jammed=${jammedMask.toString(2)}, unit=${peer.id}`;

                                expect(C3NetworkUtil.getRuntimeUnitState(peer.id, type, links, isJammed))
                                    .withContext(context)
                                    .toEqual({
                                        linked: expectedLinked,
                                        degraded: expectedDegraded,
                                        color: '#1565C0',
                                    });
                            });
                        }
                    }
                }
            });
        });
    });

    it('matches the standard C3 hierarchy oracle for every endpoint and jamming combination', () => {
        const sunder = c3Unit('sunder', 1000, C3_FLAGS.C3M);
        sunder.getInventory().push(c3Unit('sunder-b-mount', 1000, C3_FLAGS.C3M).getInventory()[0]);
        const atlas = c3Unit('atlas', 1000, C3_FLAGS.C3M);
        const akuma = c3Unit('akuma', 1000, C3_FLAGS.C3S);
        const units = [sunder, atlas, akuma];
        const unitsById = new Map<string, ForceUnit>(units.map(unit => [unit.id, unit]));
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'master-a', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1', 'atlas:0'],
            },
            {
                id: 'master-b', type: C3NetworkType.C3, color: '#2E7D32',
                masterId: 'sunder', masterCompIndex: 1, members: ['akuma'],
            },
        ];
        const endpointKeys = ['sunder:0', 'sunder:1', 'atlas:0', 'akuma:0'];
        const unitEndpoints = new Map<string, string[]>([
            ['sunder', ['sunder:0', 'sunder:1']],
            ['atlas', ['atlas:0']],
            ['akuma', ['akuma:0']],
        ]);
        const structuralEdges = [
            { source: 'sunder:0', target: 'sunder:1', color: '#1565C0' },
            { source: 'sunder:0', target: 'atlas:0', color: '#1565C0' },
            { source: 'sunder:1', target: 'akuma:0', color: '#2E7D32' },
        ];

        for (let operationalMask = 0; operationalMask < (1 << endpointKeys.length); operationalMask++) {
            const isEndpointOperational = (endpointKey: string) =>
                (operationalMask & (1 << endpointKeys.indexOf(endpointKey))) !== 0;
            const operationalEdges = structuralEdges.filter(edge =>
                isEndpointOperational(edge.source) && isEndpointOperational(edge.target));
            const links = C3NetworkUtil.getRuntimeLinks(
                networks,
                unitsById,
                (unit, componentIndex) => isEndpointOperational(`${unit.id}:${componentIndex}`),
            );

            for (let jammedMask = 0; jammedMask < (1 << units.length); jammedMask++) {
                const isJammed = (unitId: string) => {
                    const unitIndex = units.findIndex(unit => unit.id === unitId);
                    return unitIndex >= 0 && (jammedMask & (1 << unitIndex)) !== 0;
                };

                for (const unit of units) {
                    const localEndpoints = unitEndpoints.get(unit.id)!;
                    const connectedEndpoints = new Set<string>();
                    const componentEdges = new Set<typeof structuralEdges[number]>();
                    const stack = localEndpoints.filter(endpoint =>
                        operationalEdges.some(edge => edge.source === endpoint || edge.target === endpoint));

                    while (stack.length > 0) {
                        const endpoint = stack.pop()!;
                        if (connectedEndpoints.has(endpoint)) continue;
                        connectedEndpoints.add(endpoint);
                        for (const edge of operationalEdges) {
                            if (edge.source !== endpoint && edge.target !== endpoint) continue;
                            componentEdges.add(edge);
                            stack.push(edge.source === endpoint ? edge.target : edge.source);
                        }
                    }

                    const expectedLinked = connectedEndpoints.size > 0;
                    const expectedDegraded = expectedLinked && [...connectedEndpoints].some(endpoint =>
                        isJammed(endpoint.slice(0, endpoint.lastIndexOf(':'))));
                    const orderedComponentEdges = structuralEdges.filter(edge => componentEdges.has(edge));
                    const incomingTargets = new Set(orderedComponentEdges.map(edge => edge.target));
                    const operationalRoot = orderedComponentEdges.find(edge => !incomingTargets.has(edge.source))
                        ?? orderedComponentEdges[0];
                    const configuredEdge = structuralEdges.find(edge =>
                        localEndpoints.includes(edge.source) || localEndpoints.includes(edge.target));
                    const expectedColor = operationalRoot?.color ?? configuredEdge?.color;
                    const context = `operational=${operationalMask.toString(2)}, jammed=${jammedMask.toString(2)}, unit=${unit.id}`;

                    expect(C3NetworkUtil.getRuntimeUnitState(
                        unit.id, C3NetworkType.C3, links, isJammed))
                        .withContext(context)
                        .toEqual({
                            linked: expectedLinked,
                            degraded: expectedDegraded,
                            color: expectedColor,
                        });
                }
            }
        }
    });

    it('does not merge different peer network types on a multi-capability unit', () => {
        const multi = c3Unit('multi', 1000, C3_FLAGS.C3I);
        multi.getInventory().push(c3Unit('multi-nova', 1000, C3_FLAGS.NOVA).getInventory()[0]);
        const c3iPeer = c3Unit('c3i-peer', 1000, C3_FLAGS.C3I);
        const novaPeer = c3Unit('nova-peer', 1000, C3_FLAGS.NOVA);
        const novaTarget = c3Unit('nova-target', 1000, C3_FLAGS.NOVA);
        const node = (unit: CBTForceUnit): C3Node => ({
            unit,
            c3Components: C3NetworkUtil.getC3Components(unit),
            x: 0, y: 0, zIndex: 0, pinOffsetsX: [],
        });
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'c3i', type: C3NetworkType.C3I, color: '#1565C0', peerIds: ['multi', 'c3i-peer'] },
            { id: 'nova', type: C3NetworkType.NOVA, color: '#2E7D32', peerIds: ['multi', 'nova-peer'] },
        ];
        const context = {
            networks,
            getNextColor: () => '#C62828',
        };

        const result = C3NetworkUtil.createConnection(context, node(multi), 1, node(novaTarget), 0);

        expect(result.success).toBeTrue();
        expect(result.networks.find(network => network.id === 'c3i')?.peerIds).toEqual(['multi', 'c3i-peer']);
        expect(result.networks.find(network => network.id === 'nova')?.peerIds)
            .toEqual(['multi', 'nova-peer', 'nova-target']);
    });

    it('pairs a slave only with its master rather than a sibling member', () => {
        const master = c3Unit('master', 1000, C3_FLAGS.C3M);
        const slaveA = c3Unit('slave-a', 1000, C3_FLAGS.C3S);
        const slaveB = c3Unit('slave-b', 1000, C3_FLAGS.C3S);
        const network: SerializedC3NetworkGroup = {
            id: 'network', type: C3NetworkType.C3, color: '#1565C0',
            masterId: 'master', masterCompIndex: 0,
            members: ['slave-a', 'slave-b']
        };
        const unitsById = new Map([
            ['master', master],
            ['slave-a', slaveA],
            ['slave-b', slaveB]
        ]);

        expect(C3NetworkUtil.findConnectedCounterpartEndpoints('slave-a', unitsById, network))
            .toEqual([{ unitId: 'master', compIndex: 0 }]);
        expect(C3NetworkUtil.findConnectedCounterpartEndpoints('master', unitsById, network))
            .toEqual([
                { unitId: 'slave-a', compIndex: 0 },
                { unitId: 'slave-b', compIndex: 0 }
            ]);
    });

    it('calculates Core2026 tax from each unit BV and network size', () => {
        const twoUnits = [
            c3Unit('alpha', 1000, C3_FLAGS.C3I, 100),
            c3Unit('bravo', 2000, C3_FLAGS.C3I),
        ];

        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(twoUnits[0], peerNetwork(twoUnits), twoUnits)).toBe(110);
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(twoUnits[1], peerNetwork(twoUnits), twoUnits)).toBe(200);

        const fiveUnits = Array.from({ length: 5 }, (_, index) =>
            c3Unit(`five-${index}`, 1000, C3_FLAGS.C3I)
        );
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(fiveUnits[0], peerNetwork(fiveUnits), fiveUnits)).toBe(250);

        const eightUnits = Array.from({ length: 8 }, (_, index) =>
            c3Unit(`eight-${index}`, 1000, C3_FLAGS.C3I)
        );
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(eightUnits[0], peerNetwork(eightUnits), eightUnits)).toBe(400);
    });

    it('adds five percentage points for a Boosted Core2026 member after the network rate', () => {
        const boosted = c3Unit('master', 1000, C3_FLAGS.C3MBS);
        const units = [
            boosted,
            c3Unit('slave-1', 1000, C3_FLAGS.C3S),
            c3Unit('slave-2', 1000, C3_FLAGS.C3S),
            c3Unit('slave-3', 1000, C3_FLAGS.C3S),
        ];
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'master-network',
            type: C3NetworkType.C3,
            color: '#1565C0',
            masterId: boosted.id,
            masterCompIndex: 0,
            members: units.slice(1).map(unit => unit.id),
        }];

        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(boosted, networks, units)).toBe(250);
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(units[1], networks, units)).toBe(200);
    });

    it('retains the TW network-total C3 tax calculation', () => {
        const units = [
            c3Unit('alpha', 1000, C3_FLAGS.C3I),
            c3Unit('bravo', 2000, C3_FLAGS.C3I),
        ];

        expect(C3NetworkUtil.calculateTWUnitC3Tax(units[0], peerNetwork(units), units)).toBe(150);
        expect(C3NetworkUtil.calculateTWUnitC3Tax(units[1], peerNetwork(units), units)).toBe(150);
    });

    it('keeps Nova CEWS tax unchanged in both rulesets', () => {
        const units = [
            c3Unit('alpha', 1000, C3_FLAGS.NOVA),
            c3Unit('bravo', 2000, C3_FLAGS.NOVA),
        ];

        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(units[0], [], units)).toBe(150);
        expect(C3NetworkUtil.calculateTWUnitC3Tax(units[0], [], units)).toBe(150);
    });

    it('removes a unit from cyclic master networks without overflowing the stack', () => {
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'network-alpha',
                type: C3NetworkType.C3,
                color: '#1565C0',
                masterId: 'alpha',
                masterCompIndex: 0,
                members: ['bravo:0']
            },
            {
                id: 'network-bravo',
                type: C3NetworkType.C3,
                color: '#2E7D32',
                masterId: 'bravo',
                masterCompIndex: 0,
                members: ['alpha:0']
            }
        ];

        const result = C3NetworkUtil.removeUnitFromAllNetworks(networks, 'alpha');

        expect(result.success).toBeTrue();
        expect(result.networks).toEqual([]);
    });

});