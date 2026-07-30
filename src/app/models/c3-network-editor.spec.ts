import type { CBTForceUnit } from './cbt-force-unit.model';
import type { Equipment } from './equipment.model';
import { EquipmentFlag } from './equipment-flags.type';
import type { ForceUnit } from './force-unit.model';
import type { SerializedC3NetworkGroup } from './force-serialization';
import {
    C3Capabilities,
    C3_FLAGS,
    C3_MAX_NETWORK_TOTAL,
    C3Network,
    C3NetworkType,
    type C3Node,
    C3Role,
} from './c3-network.model';
import { MountedEquipment } from './mounted-equipment.model';
import { C3NetworkEditor } from './c3-network-editor';

function c3Unit(id: string, flag: EquipmentFlag): CBTForceUnit {
    const unit = {
        id,
        destroyed: false,
        getUnit: () => ({ comp: [] }),
        getInventory: () => inventory,
        isC3EndpointOperational: () => true,
        isC3Jammed: () => false,
    } as unknown as CBTForceUnit;
    const inventory = [new MountedEquipment({
        owner: unit,
        id: `${id}-${flag}`,
        name: flag,
        equipment: { flags: new Set([flag]) } as Equipment,
        states: new Map(),
    })];
    return unit;
}

function addC3Endpoint(unit: CBTForceUnit, flag: EquipmentFlag): void {
    unit.getInventory().push(new MountedEquipment({
        owner: unit,
        id: `${unit.id}-${flag}-${unit.getInventory().length}`,
        name: flag,
        equipment: { flags: new Set([flag]) } as Equipment,
        states: new Map(),
    }));
}

function alphaStrikeC3Unit(id: string, specials: string[]): ForceUnit {
    return {
        id,
        destroyed: false,
        getUnit: () => ({ as: { specials } }),
        isC3EndpointOperational: () => true,
        isC3Jammed: () => false,
    } as unknown as ForceUnit;
}

function connectPins(networks: SerializedC3NetworkGroup[], source: C3Node, sourcePin: number,
    target: C3Node, targetPin: number): SerializedC3NetworkGroup[] {
    const result = C3NetworkEditor.connect(context(networks), source, sourcePin, target, targetPin);
    expect(result.success).withContext(result.message ?? 'connection failed').toBeTrue();
    return result.networks;
}

function unitMap(units: readonly ForceUnit[]): ReadonlyMap<string, ForceUnit> {
    return new Map(units.map(unit => [unit.id, unit]));
}

function node(unit: ForceUnit): C3Node {
    return {
        unit,
        c3Components: [...new C3Capabilities(unit).components],
        x: 0,
        y: 0,
        zIndex: 0,
        pinOffsetsX: [],
    };
}

const context = (networks: SerializedC3NetworkGroup[] = []) => ({
    networks,
    getNextColor: () => '#1565C0',
});

describe('C3NetworkEditor', () => {
    it('connects master/slave and peer endpoints using the unchanged bare-ID contract', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        const peerA = c3Unit('peer-a', C3_FLAGS.C3I);
        const peerB = c3Unit('peer-b', C3_FLAGS.C3I);

        const hierarchy = C3NetworkEditor.connect(context(), node(master), 0, node(slave), 0);
        const peers = C3NetworkEditor.connect(context(), node(peerA), 0, node(peerB), 0);

        expect(hierarchy.success).toBeTrue();
        expect(hierarchy.networks[0]).toEqual(jasmine.objectContaining({
            type: C3NetworkType.C3,
            masterId: 'master',
            masterCompIndex: 0,
            members: ['slave'],
        }));
        expect(peers.networks[0]).toEqual(jasmine.objectContaining({
            type: C3NetworkType.C3I,
            peerIds: ['peer-a', 'peer-b'],
        }));
    });

    it('normalizes slave-to-master connections to the Master-to-Slave hierarchy', () => {
        const master = node(c3Unit('master', C3_FLAGS.C3M));
        const slave = node(c3Unit('slave', C3_FLAGS.C3S));

        const result = C3NetworkEditor.connect(context(), slave, 0, master, 0);

        expect(result.success).toBeTrue();
        expect(result.networks[0]).toEqual(jasmine.objectContaining({
            masterId: 'master',
            masterCompIndex: 0,
            members: ['slave'],
        }));
    });

    it('serializes a master child with its exact zero-based endpoint index', () => {
        const parent = c3Unit('parent', C3_FLAGS.C3M);
        const child = c3Unit('child', C3_FLAGS.C3M);

        const result = C3NetworkEditor.connect(context(), node(parent), 0, node(child), 0);

        expect(result.success).toBeTrue();
        expect(result.networks[0].members).toEqual(['child:0']);
    });

    it('creates the same valid hierarchy when a networked master is dragged to its new parent', () => {
        const atlas = node(c3Unit('atlas', C3_FLAGS.C3M));
        const akuma = node(c3Unit('akuma', C3_FLAGS.C3S));
        const battleMaster = node(c3Unit('battlemaster', C3_FLAGS.C3M));
        const initialNetworks: SerializedC3NetworkGroup[] = [{
            id: 'atlas-network',
            type: C3NetworkType.C3,
            color: '#E65100',
            masterId: 'atlas',
            masterCompIndex: 0,
            members: ['akuma'],
        }];
        const original = structuredClone(initialNetworks);

        expect(C3NetworkEditor.canConnect(battleMaster, 0, atlas, 0, initialNetworks).valid).toBeTrue();
        expect(C3NetworkEditor.canConnect(atlas, 0, battleMaster, 0, initialNetworks).valid).toBeTrue();

        const forward = C3NetworkEditor.connect(context(initialNetworks), battleMaster, 0, atlas, 0);
        const reverse = C3NetworkEditor.connect(context(initialNetworks), atlas, 0, battleMaster, 0);

        for (const result of [forward, reverse]) {
            expect(result.success).withContext(result.message ?? 'connection failed').toBeTrue();
            const model = new C3Network(result.networks);
            expect(model.masterNetwork('battlemaster', 0)?.members).toEqual(['atlas:0']);
            expect(model.masterNetwork('atlas', 0)?.members).toEqual(['akuma']);
            expect(model.parentNetworkForEndpoint('atlas', 0)?.masterId).toBe('battlemaster');
            expect(model.treeUnitIds(model.masterNetwork('battlemaster', 0)!.id))
                .toEqual(new Set(['battlemaster', 'atlas', 'akuma']));
        }
        expect(initialNetworks).toEqual(original);
    });

    it('promotes an unused internal Master above a same-unit Master with Slave children', () => {
        const naginata = c3Unit('naginata', C3_FLAGS.C3M);
        addC3Endpoint(naginata, C3_FLAGS.C3M);
        const naginataNode = node(naginata);
        const akuma = node(c3Unit('akuma', C3_FLAGS.C3S));
        const branch = connectPins([], naginataNode, 1, akuma, 0);

        expect(C3NetworkEditor.canConnect(naginataNode, 0, naginataNode, 1, branch).valid).toBeTrue();
        const result = C3NetworkEditor.connect(context(branch), naginataNode, 0, naginataNode, 1);

        expect(result.success).withContext(result.message ?? 'connection failed').toBeTrue();
        const model = new C3Network(result.networks);
        expect(model.masterNetwork('naginata', 0)?.members).toEqual(['naginata:1']);
        expect(model.masterNetwork('naginata', 1)?.members).toEqual(['akuma']);
        expect(model.parentNetworkForEndpoint('naginata', 1)?.masterCompIndex).toBe(0);
    });

    it('prefers the dragged Master-to-Master direction when both orientations are valid', () => {
        const source = node(c3Unit('source', C3_FLAGS.C3M));
        const target = node(c3Unit('target', C3_FLAGS.C3M));

        const result = C3NetworkEditor.connect(context(), source, 0, target, 0);

        expect(result.success).toBeTrue();
        expect(result.networks[0]).toEqual(jasmine.objectContaining({
            masterId: 'source',
            masterCompIndex: 0,
            members: ['target:0'],
        }));
    });

    it('rejects an existing Master-to-Master edge in either direction', () => {
        const parent = node(c3Unit('parent', C3_FLAGS.C3M));
        const child = node(c3Unit('child', C3_FLAGS.C3M));
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'hierarchy', type: C3NetworkType.C3, color: '#1',
            masterId: 'parent', masterCompIndex: 0, members: ['child:0'],
        }];

        for (const [source, target] of [[parent, child], [child, parent]] as const) {
            expect(C3NetworkEditor.canConnect(source, 0, target, 0, networks)).toEqual({
                valid: false,
                reason: 'Already connected',
            });
            expect(C3NetworkEditor.connect(context(networks), source, 0, target, 0)).toEqual({
                networks,
                success: false,
                message: 'Already connected',
            });
        }
    });

    it('rejects Master-to-Master linking when neither hierarchy orientation is valid', () => {
        const first = node(c3Unit('first', C3_FLAGS.C3M));
        const second = node(c3Unit('second', C3_FLAGS.C3M));
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'first-network', type: C3NetworkType.C3, color: '#1',
                masterId: 'first', masterCompIndex: 0, members: ['first-slave'],
            },
            {
                id: 'second-network', type: C3NetworkType.C3, color: '#2',
                masterId: 'second', masterCompIndex: 0, members: ['second-slave'],
            },
        ];

        expect(C3NetworkEditor.canConnect(first, 0, second, 0, networks)).toEqual({
            valid: false,
            reason: 'Cannot mix sub-masters with slaves',
        });
        expect(C3NetworkEditor.connect(context(networks), first, 0, second, 0)).toEqual({
            networks,
            success: false,
            message: 'Cannot mix sub-masters with slaves',
        });
    });

    it('auto-links multiple masters internally with exact zero-based endpoints before adding the child', () => {
        const multiMaster = c3Unit('multi', C3_FLAGS.C3M);
        addC3Endpoint(multiMaster, C3_FLAGS.C3M);
        const newSlave = c3Unit('new', C3_FLAGS.C3S);
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'first', type: C3NetworkType.C3, color: '#111111',
            masterId: 'multi', masterCompIndex: 0, members: ['existing:0'],
        }];

        const result = C3NetworkEditor.connect(
            context(networks), node(multiMaster), 1, node(newSlave), 0,
        );

        expect(result.success).toBeTrue();
        expect(result.networks).toEqual([
            { ...networks[0], members: ['existing:0', 'multi:1'] },
            jasmine.objectContaining({
                type: C3NetworkType.C3,
                masterId: 'multi',
                masterCompIndex: 1,
                members: ['new'],
            }),
        ]);
    });

    it('allows a subordinate internal Master to control a terminal Master child', () => {
        const atlas = c3Unit('atlas', C3_FLAGS.C3M);
        addC3Endpoint(atlas, C3_FLAGS.C3M);
        addC3Endpoint(atlas, C3_FLAGS.C3M);
        addC3Endpoint(atlas, C3_FLAGS.C3M);
        const atlasNode = node(atlas);
        const locusts = Array.from({ length: 6 }, (_, index) => node(c3Unit(`locust-${index}`, C3_FLAGS.C3S)));
        const commandos = Array.from({ length: 3 }, (_, index) => node(c3Unit(`commando-${index}`, C3_FLAGS.C3M)));
        let networks: SerializedC3NetworkGroup[] = [];

        for (const childPin of [1, 2, 3]) networks = connectPins(networks, atlasNode, 0, atlasNode, childPin);
        for (let index = 0; index < 3; index++) networks = connectPins(networks, atlasNode, 1, locusts[index], 0);
        for (let index = 3; index < 6; index++) networks = connectPins(networks, atlasNode, 2, locusts[index], 0);
        const result = C3NetworkEditor.connect(context(networks), atlasNode, 3, commandos[0], 0);
        networks = result.networks;

        const model = new C3Network(networks);
        expect(new Set(model.masterNetwork('atlas', 0)?.members))
            .toEqual(new Set(['atlas:1', 'atlas:2', 'atlas:3']));
        expect(model.masterNetwork('atlas', 1)?.members).toEqual(['locust-0', 'locust-1', 'locust-2']);
        expect(model.masterNetwork('atlas', 2)?.members).toEqual(['locust-3', 'locust-4', 'locust-5']);
        expect(model.masterNetwork('atlas', 3)?.members).toEqual(['commando-0:0']);
        expect(result.success).toBeTrue();
    });

    it('supports canonical configuration 1: a separate Grand Master commands three Master units', () => {
        const grandMaster = node(c3Unit('grand-master', C3_FLAGS.C3M));
        const masters = ['left-master', 'center-master', 'right-master'].map(id => node(c3Unit(id, C3_FLAGS.C3M)));
        const slaves = [3, 3, 2].map((count, branch) => Array.from(
            { length: count }, (_, index) => node(c3Unit(`branch-${branch}-slave-${index}`, C3_FLAGS.C3S)),
        ));
        let networks: SerializedC3NetworkGroup[] = [];

        for (const master of masters) networks = connectPins(networks, grandMaster, 0, master, 0);
        for (let branch = 0; branch < masters.length; branch++) {
            for (const slave of slaves[branch]) networks = connectPins(networks, masters[branch], 0, slave, 0);
        }

        const model = new C3Network(networks);
        expect(model.masterNetwork('grand-master', 0)?.members)
            .toEqual(['left-master:0', 'center-master:0', 'right-master:0']);
        expect(model.treeUnitIds(model.masterNetwork('grand-master', 0)!.id).size).toBe(12);
    });

    it('supports canonical configuration 2: two internal masters distribute three subnetworks', () => {
        const center = c3Unit('center', C3_FLAGS.C3M);
        addC3Endpoint(center, C3_FLAGS.C3M);
        const centerNode = node(center);
        const outerMasters = ['left-master', 'right-master'].map(id => node(c3Unit(id, C3_FLAGS.C3M)));
        const centerSlaves = Array.from({ length: 3 }, (_, index) => node(c3Unit(`center-slave-${index}`, C3_FLAGS.C3S)));
        const outerSlaves = [3, 2].map((count, side) => Array.from(
            { length: count }, (_, index) => node(c3Unit(`outer-${side}-slave-${index}`, C3_FLAGS.C3S)),
        ));
        let networks: SerializedC3NetworkGroup[] = [];

        networks = connectPins(networks, centerNode, 0, centerNode, 1);
        for (const master of outerMasters) networks = connectPins(networks, centerNode, 0, master, 0);
        for (const slave of centerSlaves) networks = connectPins(networks, centerNode, 1, slave, 0);
        for (let side = 0; side < outerMasters.length; side++) {
            for (const slave of outerSlaves[side]) networks = connectPins(networks, outerMasters[side], 0, slave, 0);
        }

        const model = new C3Network(networks);
        expect(new Set(model.masterNetwork('center', 0)?.members))
            .toEqual(new Set(['center:1', 'left-master:0', 'right-master:0']));
        expect(model.masterNetwork('center', 1)?.members).toEqual(centerSlaves.map(slave => slave.unit.id));
        expect(model.treeEndpointKeys(model.masterNetwork('center', 0)!.id).size).toBe(12);
    });

    it('supports canonical configuration 3: three internal masters serve two slave branches and one master branch', () => {
        const center = c3Unit('center', C3_FLAGS.C3M);
        addC3Endpoint(center, C3_FLAGS.C3M);
        addC3Endpoint(center, C3_FLAGS.C3M);
        const centerNode = node(center);
        const outerMaster = node(c3Unit('outer-master', C3_FLAGS.C3M));
        const centerSlaves = [1, 2].map(branch => Array.from(
            { length: 3 }, (_, index) => node(c3Unit(`branch-${branch}-slave-${index}`, C3_FLAGS.C3S)),
        ));
        const outerSlaves = Array.from({ length: 2 }, (_, index) => node(c3Unit(`outer-slave-${index}`, C3_FLAGS.C3S)));
        let networks: SerializedC3NetworkGroup[] = [];

        networks = connectPins(networks, centerNode, 0, centerNode, 1);
        networks = connectPins(networks, centerNode, 0, centerNode, 2);
        networks = connectPins(networks, centerNode, 0, outerMaster, 0);
        for (const slave of centerSlaves[0]) networks = connectPins(networks, centerNode, 1, slave, 0);
        for (const slave of centerSlaves[1]) networks = connectPins(networks, centerNode, 2, slave, 0);
        for (const slave of outerSlaves) networks = connectPins(networks, outerMaster, 0, slave, 0);

        const model = new C3Network(networks);
        expect(new Set(model.masterNetwork('center', 0)?.members))
            .toEqual(new Set(['center:1', 'center:2', 'outer-master:0']));
        expect(model.masterNetwork('center', 1)?.members).toEqual(centerSlaves[0].map(slave => slave.unit.id));
        expect(model.masterNetwork('center', 2)?.members).toEqual(centerSlaves[1].map(slave => slave.unit.id));
        expect(model.treeEndpointKeys(model.masterNetwork('center', 0)!.id).size).toBe(12);
    });

    it('supports canonical configuration 4: one of four internal masters commands the other three', () => {
        const center = c3Unit('center', C3_FLAGS.C3M);
        addC3Endpoint(center, C3_FLAGS.C3M);
        addC3Endpoint(center, C3_FLAGS.C3M);
        addC3Endpoint(center, C3_FLAGS.C3M);
        const centerNode = node(center);
        const slaves = [3, 3, 2].map((count, branch) => Array.from(
            { length: count }, (_, index) => node(c3Unit(`branch-${branch + 1}-slave-${index}`, C3_FLAGS.C3S)),
        ));
        let networks: SerializedC3NetworkGroup[] = [];

        for (const childPin of [1, 2, 3]) networks = connectPins(networks, centerNode, 0, centerNode, childPin);
        for (const childPin of [1, 2, 3]) {
            for (const slave of slaves[childPin - 1]) networks = connectPins(networks, centerNode, childPin, slave, 0);
        }

        const model = new C3Network(networks);
        expect(model.masterNetwork('center', 0)?.members).toEqual(['center:1', 'center:2', 'center:3']);
        for (const childPin of [1, 2, 3]) {
            expect(model.masterNetwork('center', childPin)?.members)
                .toEqual(slaves[childPin - 1].map(slave => slave.unit.id));
        }
        expect(model.treeEndpointKeys(model.masterNetwork('center', 0)!.id).size).toBe(12);
    });

    it('prevents a unit with C3i and C3 Slave components from joining both networks', () => {
        const mixed = c3Unit('mixed', C3_FLAGS.C3I);
        addC3Endpoint(mixed, C3_FLAGS.C3S);
        const mixedNode = node(mixed);
        const peer = node(c3Unit('peer', C3_FLAGS.C3I));
        const master = node(c3Unit('master', C3_FLAGS.C3M));

        const peerFirst = connectPins([], mixedNode, 0, peer, 0);
        expect(C3NetworkEditor.canConnect(master, 0, mixedNode, 1, peerFirst).valid).toBeFalse();

        const slaveFirst = connectPins([], master, 0, mixedNode, 1);
        expect(C3NetworkEditor.canConnect(mixedNode, 0, peer, 0, slaveFirst).valid).toBeFalse();
    });

    it('prevents a unit with C3i and C3 Master components from joining both networks', () => {
        const mixed = c3Unit('mixed', C3_FLAGS.C3I);
        addC3Endpoint(mixed, C3_FLAGS.C3M);
        const mixedNode = node(mixed);
        const peer = node(c3Unit('peer', C3_FLAGS.C3I));
        const externalMaster = node(c3Unit('external-master', C3_FLAGS.C3M));

        const peerFirst = connectPins([], mixedNode, 0, peer, 0);
        expect(C3NetworkEditor.canConnect(externalMaster, 0, mixedNode, 1, peerFirst).valid).toBeFalse();

        const hierarchyFirst = connectPins([], externalMaster, 0, mixedNode, 1);
        expect(C3NetworkEditor.canConnect(mixedNode, 0, peer, 0, hierarchyFirst).valid).toBeFalse();
    });

    it('prevents a unit with mounted C3i and Nova components from joining both peer networks', () => {
        const mixed = c3Unit('mixed', C3_FLAGS.C3I);
        addC3Endpoint(mixed, C3_FLAGS.NOVA);
        const mixedNode = node(mixed);
        const c3iPeer = node(c3Unit('c3i-peer', C3_FLAGS.C3I));
        const novaPeer = node(c3Unit('nova-peer', C3_FLAGS.NOVA));

        const c3iFirst = connectPins([], mixedNode, 0, c3iPeer, 0);
        expect(C3NetworkEditor.canConnect(mixedNode, 1, novaPeer, 0, c3iFirst)).toEqual({
            valid: false,
            reason: 'Unit is already part of another network',
        });
        expect(C3NetworkEditor.connect(context(c3iFirst), mixedNode, 1, novaPeer, 0).networks)
            .toEqual(c3iFirst);

        const novaFirst = connectPins([], mixedNode, 1, novaPeer, 0);
        expect(C3NetworkEditor.canConnect(mixedNode, 0, c3iPeer, 0, novaFirst)).toEqual({
            valid: false,
            reason: 'Unit is already part of another network',
        });
        expect(C3NetworkEditor.connect(context(novaFirst), mixedNode, 0, c3iPeer, 0).networks)
            .toEqual(novaFirst);
    });

    [
        { label: 'C3i and Nova', specials: ['C3I', 'NOVA'], counterpart: 'NOVA' },
        { label: 'C3i and C3 Slave', specials: ['C3I', 'C3S'], counterpart: 'C3M' },
        { label: 'C3i and C3 Master', specials: ['C3I', 'C3M'], counterpart: 'C3S' },
    ].forEach(({ label, specials, counterpart }) => {
        it(`prevents an Alpha Strike unit with ${label} specials from joining both networks`, () => {
            const mixedNode = node(alphaStrikeC3Unit('mixed', specials));
            const c3iPeer = node(alphaStrikeC3Unit('c3i-peer', ['C3I']));
            const otherNode = node(alphaStrikeC3Unit('other', [counterpart]));

            const c3iFirst = connectPins([], mixedNode, 0, c3iPeer, 0);
            expect(C3NetworkEditor.canConnect(mixedNode, 1, otherNode, 0, c3iFirst).valid).toBeFalse();
            expect(C3NetworkEditor.connect(context(c3iFirst), mixedNode, 1, otherNode, 0).networks)
                .toEqual(c3iFirst);

            const otherFirst = connectPins([], mixedNode, 1, otherNode, 0);
            expect(C3NetworkEditor.canConnect(mixedNode, 0, c3iPeer, 0, otherFirst).valid).toBeFalse();
            expect(C3NetworkEditor.connect(context(otherFirst), mixedNode, 0, c3iPeer, 0).networks)
                .toEqual(otherFirst);
        });
    });

    it('allows a Grand Master, subordinate Master, and terminal Master chain in either drag orientation', () => {
        const root = node(c3Unit('root', C3_FLAGS.C3M));
        const middle = node(c3Unit('middle', C3_FLAGS.C3M));
        const leaf = node(c3Unit('leaf', C3_FLAGS.C3M));
        const hierarchy = connectPins([], root, 0, middle, 0);

        expect(C3NetworkEditor.canConnect(middle, 0, leaf, 0, hierarchy).valid).toBeTrue();
        const forward = C3NetworkEditor.connect(context(hierarchy), middle, 0, leaf, 0);
        expect(new C3Network(forward.networks).masterNetwork('middle', 0)?.members).toEqual(['leaf:0']);

        expect(C3NetworkEditor.canConnect(leaf, 0, middle, 0, hierarchy).valid).toBeTrue();
        const reverse = C3NetworkEditor.connect(context(hierarchy), leaf, 0, middle, 0);
        expect(new C3Network(reverse.networks).masterNetwork('middle', 0)?.members).toEqual(['leaf:0']);
    });

    it('rejects Slave and Master descendants beneath a terminal Master', () => {
        const root = node(c3Unit('root', C3_FLAGS.C3M));
        const middle = node(c3Unit('middle', C3_FLAGS.C3M));
        const leaf = node(c3Unit('leaf', C3_FLAGS.C3M));
        const deeperMaster = node(c3Unit('deeper-master', C3_FLAGS.C3M));
        const slave = node(c3Unit('slave', C3_FLAGS.C3S));
        const hierarchy = connectPins(connectPins([], root, 0, middle, 0), middle, 0, leaf, 0);

        expect(C3NetworkEditor.canConnect(leaf, 0, slave, 0, hierarchy).valid).toBeFalse();
        expect(C3NetworkEditor.canConnect(leaf, 0, deeperMaster, 0, hierarchy).valid).toBeFalse();
        expect(C3NetworkEditor.connect(context(hierarchy), leaf, 0, slave, 0).networks).toEqual(hierarchy);
        expect(C3NetworkEditor.connect(context(hierarchy), leaf, 0, deeperMaster, 0).networks).toEqual(hierarchy);
    });

    it('allows an internal terminal Master chain', () => {
        const command = c3Unit('command', C3_FLAGS.C3M);
        addC3Endpoint(command, C3_FLAGS.C3M);
        addC3Endpoint(command, C3_FLAGS.C3M);
        const commandNode = node(command);
        const hierarchy = connectPins([], commandNode, 0, commandNode, 1);

        expect(C3NetworkEditor.canConnect(commandNode, 1, commandNode, 2, hierarchy).valid).toBeTrue();
        const result = C3NetworkEditor.connect(context(hierarchy), commandNode, 1, commandNode, 2);
        expect(new C3Network(result.networks).masterNetwork('command', 1)?.members).toEqual(['command:2']);
    });

    it('allows an external Grand Master above an internal terminal Master', () => {
        const external = node(c3Unit('external', C3_FLAGS.C3M));
        const command = c3Unit('command', C3_FLAGS.C3M);
        addC3Endpoint(command, C3_FLAGS.C3M);
        const commandNode = node(command);
        const externalParent = connectPins([], external, 0, commandNode, 0);

        expect(C3NetworkEditor.canConnect(commandNode, 0, commandNode, 1, externalParent).valid).toBeTrue();
        const result = C3NetworkEditor.connect(context(externalParent), commandNode, 0, commandNode, 1);
        expect(new C3Network(result.networks).masterNetwork('command', 0)?.members).toEqual(['command:1']);
    });

    it('allows multiple internal components only when they form one connected tree', () => {
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        const sunderNode = node(sunder);
        let networks: SerializedC3NetworkGroup[] = [];

        networks = connectPins(networks, sunderNode, 1, sunderNode, 0);
        networks = connectPins(networks, sunderNode, 1, sunderNode, 2);
        networks = connectPins(networks, sunderNode, 1, sunderNode, 3);

        expect(new C3Network(networks).masterNetwork('sunder', 1)?.members)
            .toEqual(['sunder:0', 'sunder:2', 'sunder:3']);
    });

    it('rejects a second disconnected internal component tree', () => {
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        const sunderNode = node(sunder);
        const firstTree = connectPins([], sunderNode, 0, sunderNode, 1);

        expect(C3NetworkEditor.canConnect(sunderNode, 2, sunderNode, 3, firstTree)).toEqual({
            valid: false,
            reason: 'Internal connection would create a second component network',
        });
        expect(C3NetworkEditor.connect(context(firstTree), sunderNode, 2, sunderNode, 3)).toEqual({
            networks: firstTree,
            success: false,
            message: 'Internal connection would create a second component network',
        });
    });

    it('rejects assigning different components of one unit to multiple external masters', () => {
        const atlas = node(c3Unit('atlas', C3_FLAGS.C3M));
        const battleMaster = node(c3Unit('battlemaster', C3_FLAGS.C3M));
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        const sunderNode = node(sunder);
        const firstParent = connectPins([], atlas, 0, sunderNode, 0);

        expect(C3NetworkEditor.canConnect(battleMaster, 0, sunderNode, 1, firstParent)).toEqual({
            valid: false,
            reason: 'Unit already has an external master',
        });
        expect(C3NetworkEditor.connect(context(firstParent), battleMaster, 0, sunderNode, 1)).toEqual({
            networks: firstParent,
            success: false,
            message: 'Unit already has an external master',
        });
    });

    it('rejects assigning two components of one unit to the same external master', () => {
        const atlas = node(c3Unit('atlas', C3_FLAGS.C3M));
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        const sunderNode = node(sunder);
        const firstParent = connectPins([], atlas, 0, sunderNode, 0);

        expect(C3NetworkEditor.canConnect(atlas, 0, sunderNode, 1, firstParent).valid).toBeFalse();
        expect(C3NetworkEditor.connect(context(firstParent), atlas, 0, sunderNode, 1).success).toBeFalse();
    });

    it('cleans disconnected component trees and duplicate external parents at unit scope', () => {
        const first = c3Unit('first', C3_FLAGS.C3M);
        const second = c3Unit('second', C3_FLAGS.C3M);
        const sunder = c3Unit('sunder', C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        addC3Endpoint(sunder, C3_FLAGS.C3M);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'first', type: C3NetworkType.C3, color: '#1', masterId: 'first', masterCompIndex: 0, members: ['sunder:0'] },
            { id: 'sunder-zero', type: C3NetworkType.C3, color: '#2', masterId: 'sunder', masterCompIndex: 0, members: ['sunder:1'] },
            { id: 'second', type: C3NetworkType.C3, color: '#3', masterId: 'second', masterCompIndex: 0, members: ['sunder:2'] },
            { id: 'sunder-two', type: C3NetworkType.C3, color: '#4', masterId: 'sunder', masterCompIndex: 2, members: ['sunder:3'] },
        ];

        const cleaned = C3NetworkEditor.clean(networks, unitMap([first, second, sunder]));

        expect(cleaned).toEqual([
            networks[0],
            networks[1],
        ]);
        expect(C3NetworkEditor.clean(cleaned, unitMap([first, second, sunder]))).toEqual(cleaned);
    });

    it('supports three Atlas master pins plus a Commando master and eight slave units', () => {
        const atlas = c3Unit('atlas', C3_FLAGS.C3M);
        addC3Endpoint(atlas, C3_FLAGS.C3M);
        addC3Endpoint(atlas, C3_FLAGS.C3M);
        const commando = node(c3Unit('commando', C3_FLAGS.C3M));
        const atlasNode = node(atlas);
        const locusts = Array.from({ length: 9 }, (_, index) => node(c3Unit(`locust-${index}`, C3_FLAGS.C3S)));
        let networks: SerializedC3NetworkGroup[] = [];

        networks = connectPins(networks, atlasNode, 0, atlasNode, 1);
        networks = connectPins(networks, atlasNode, 0, atlasNode, 2);
        networks = connectPins(networks, atlasNode, 0, commando, 0);
        for (let index = 0; index < 3; index++) networks = connectPins(networks, commando, 0, locusts[index], 0);
        for (let index = 3; index < 6; index++) networks = connectPins(networks, atlasNode, 1, locusts[index], 0);
        for (let index = 6; index < 8; index++) networks = connectPins(networks, atlasNode, 2, locusts[index], 0);

        const model = new C3Network(networks);
        expect(new Set(model.masterNetwork('atlas', 0)?.members)).toEqual(new Set(['atlas:1', 'atlas:2', 'commando:0']));
        expect(model.treeEndpointKeys(model.masterNetwork('atlas', 0)!.id).size).toBe(12);
        expect(C3NetworkEditor.canConnect(atlasNode, 2, locusts[8], 0, networks)).toEqual({
            valid: false,
            reason: `Would exceed ${C3_MAX_NETWORK_TOTAL}-member C3 limit`,
        });
        expect(C3NetworkEditor.connect(context(networks), atlasNode, 2, locusts[8], 0).networks).toEqual(networks);
        expect(C3NetworkEditor.clean(networks, unitMap([
            atlas, commando.unit, ...locusts.map(entry => entry.unit),
        ]))).toEqual(networks);
    });

    it('preserves the second peer network identity, color, position, and member ordering when merging', () => {
        const first = ['a', 'b'].map(id => c3Unit(id, C3_FLAGS.C3I));
        const second = ['c', 'd'].map(id => c3Unit(id, C3_FLAGS.C3I));
        const untouched: SerializedC3NetworkGroup = {
            id: 'untouched', type: C3NetworkType.NOVA, color: '#000000', peerIds: ['x', 'y'],
        };
        const destination: SerializedC3NetworkGroup = {
            id: 'destination', type: C3NetworkType.C3I, color: '#222222', peerIds: ['c', 'd'],
        };
        const networks: SerializedC3NetworkGroup[] = [
            untouched,
            { id: 'source', type: C3NetworkType.C3I, color: '#111111', peerIds: ['a', 'b'] },
            destination,
        ];

        const result = C3NetworkEditor.connect(context(networks), node(first[0]), 0, node(second[0]), 0);

        expect(result).toEqual({
            success: true,
            message: 'Networks merged',
            networks: [untouched, { ...destination, peerIds: ['a', 'b', 'c', 'd'] }],
        });
    });

    it('moves a peer into the destination and dissolves its undersized old network', () => {
        const moving = c3Unit('moving', C3_FLAGS.C3I);
        const destinationMember = c3Unit('destination-member', C3_FLAGS.C3I);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'old', type: C3NetworkType.C3I, color: '#111111', peerIds: ['moving', 'old-peer'] },
            { id: 'destination', type: C3NetworkType.C3I, color: '#222222',
                peerIds: ['destination-member', 'd2', 'd3', 'd4', 'd5'] },
        ];

        const result = C3NetworkEditor.connect(
            context(networks), node(moving), 0, node(destinationMember), 0,
        );

        expect(result.networks).toEqual([{
            id: 'destination', type: C3NetworkType.C3I, color: '#222222',
            peerIds: ['destination-member', 'd2', 'd3', 'd4', 'd5', 'moving'],
        }]);
    });

    it('rejects invalid, self, incompatible, and full-network connections', () => {
        const master = node(c3Unit('master', C3_FLAGS.C3M));
        const slave = node(c3Unit('slave', C3_FLAGS.C3S));
        const peer = node(c3Unit('peer', C3_FLAGS.C3I));
        expect(C3NetworkEditor.canConnect(master, 99, slave, 0, []).valid).toBeFalse();
        expect(C3NetworkEditor.canConnect(master, 0, master, 0, []).valid).toBeFalse();
        expect(C3NetworkEditor.canConnect(master, 0, peer, 0, []).valid).toBeFalse();

        const full: SerializedC3NetworkGroup[] = [{
            id: 'full', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0,
            members: ['one', 'two', 'three'],
        }];
        expect(C3NetworkEditor.canConnect(master, 0, node(c3Unit('four', C3_FLAGS.C3S)), 0, full).valid).toBeFalse();
    });

    it('rejects adding a child at the depth limit', () => {
        const leaf = node(c3Unit('leaf', C3_FLAGS.C3M));
        const slave = node(c3Unit('slave', C3_FLAGS.C3S));
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'root', type: C3NetworkType.C3, color: '#1', masterId: 'root', masterCompIndex: 0, members: ['middle:0'] },
            { id: 'middle', type: C3NetworkType.C3, color: '#2', masterId: 'middle', masterCompIndex: 0, members: ['leaf:0'] },
            { id: 'leaf', type: C3NetworkType.C3, color: '#3', masterId: 'leaf', masterCompIndex: 0, members: ['existing'] },
        ];

        expect(C3NetworkEditor.canConnect(leaf, 0, slave, 0, networks)).toEqual({
            valid: false,
            reason: 'Would exceed depth 2',
        });
    });

    it('allows the total-member limit exactly and rejects the next component', () => {
        const target = node(c3Unit('target', C3_FLAGS.C3M));
        const added = node(c3Unit('added', C3_FLAGS.C3S));
        const networks = (lastMembers: string[]): SerializedC3NetworkGroup[] => [
            { id: 'root', type: C3NetworkType.C3, color: '#1', masterId: 'root', masterCompIndex: 0, members: ['target:0', 'left:0', 'right:0'] },
            { id: 'target', type: C3NetworkType.C3, color: '#2', masterId: 'target', masterCompIndex: 0, members: ['t1', 't2'] },
            { id: 'left', type: C3NetworkType.C3, color: '#3', masterId: 'left', masterCompIndex: 0, members: ['l1', 'l2', 'l3'] },
            { id: 'right', type: C3NetworkType.C3, color: '#4', masterId: 'right', masterCompIndex: 0, members: lastMembers },
        ];

        expect(C3NetworkEditor.canConnect(target, 0, added, 0, networks(['r1', 'r2'])).valid)
            .withContext(`adding the ${C3_MAX_NETWORK_TOTAL}th member`)
            .toBeTrue();
        expect(C3NetworkEditor.canConnect(target, 0, added, 0, networks(['r1', 'r2', 'r3']))).toEqual({
            valid: false,
            reason: `Would exceed ${C3_MAX_NETWORK_TOTAL}-member C3 limit`,
        });
    });

    it('disconnects and removes without mutating the input, dissolving undersized peers', () => {
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'peer', type: C3NetworkType.C3I, color: '#1', peerIds: ['a', 'b'],
        }];
        const original = structuredClone(networks);

        const disconnected = C3NetworkEditor.disconnect(networks, 'a', 0, C3Role.PEER, C3NetworkType.C3I);

        expect(disconnected.success).toBeTrue();
        expect(disconnected.networks).toEqual([]);
        expect(networks).toEqual(original);
        expect(C3NetworkEditor.removeConnection(networks, 'missing', 'a').success).toBeFalse();
    });

    it('disconnects master members and reports missing endpoint connections', () => {
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'hierarchy', type: C3NetworkType.C3, color: '#1',
            masterId: 'parent', masterCompIndex: 0, members: ['child:0'],
        }];

        expect(C3NetworkEditor.disconnect(networks, 'child', 0, C3Role.MASTER).networks).toEqual([]);
        expect(C3NetworkEditor.disconnect(networks, 'missing', 0, C3Role.MASTER)).toEqual({
            networks, success: false, message: 'No connection found',
        });
    });

    it('chooses the least-used palette color including preassigned master pins', () => {
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'peer', type: C3NetworkType.C3I, color: '#1565C0', peerIds: ['a', 'b'],
        }];
        expect(C3NetworkEditor.nextColor(networks, new Map([['master:0', '#2E7D32']]))).toBe('#7B1FA2');
        expect(C3NetworkEditor.nextColor([])).toBe('#1565C0');
    });

    it('removes cyclic hierarchy trees without recursion overflow', () => {
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'a', type: C3NetworkType.C3, color: '#1', masterId: 'a', masterCompIndex: 0, members: ['b:0'] },
            { id: 'b', type: C3NetworkType.C3, color: '#2', masterId: 'b', masterCompIndex: 0, members: ['a:0'] },
        ];
        expect(C3NetworkEditor.removeUnit(networks, 'a')).toEqual({ networks: [], success: true });
    });

    it('cleans malformed and unknown shapes while preserving IDs, colors, order, and bare members', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const slave = c3Unit('slave', C3_FLAGS.C3S);
        const peerA = c3Unit('peer-a', C3_FLAGS.C3I);
        const peerB = c3Unit('peer-b', C3_FLAGS.C3I);
        const units = new Map<string, ForceUnit>([
            ['master', master], ['slave', slave], ['peer-a', peerA], ['peer-b', peerB],
        ]);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'hierarchy', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0, members: ['slave', 'slave'] },
            { id: 'peers', type: C3NetworkType.C3I, color: '#2', peerIds: ['peer-a', 'peer-a', 'peer-b'] },
            { id: 'wrong-shape', type: C3NetworkType.C3, color: '#3', peerIds: ['master', 'slave'] },
            { id: 'unknown', type: 'unknown' as C3NetworkType, color: '#4', peerIds: ['peer-a', 'peer-b'] },
        ];

        expect(C3NetworkEditor.clean(networks, units)).toEqual([
            { id: 'hierarchy', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0, members: ['slave'] },
            { id: 'peers', type: C3NetworkType.C3I, color: '#2', peerIds: ['peer-a', 'peer-b'] },
        ]);
    });

    it('discards empty and duplicate network IDs deterministically', () => {
        const master = c3Unit('master', C3_FLAGS.C3M);
        const slaves = [1, 2, 3].map(index => c3Unit(`slave-${index}`, C3_FLAGS.C3S));
        const networks: SerializedC3NetworkGroup[] = [
            { id: '', type: C3NetworkType.C3, color: '#0', masterId: 'master', masterCompIndex: 0, members: ['slave-0'] },
            { id: 'duplicate', type: C3NetworkType.C3, color: '#1', masterId: 'master', masterCompIndex: 0, members: ['slave-1'] },
            { id: 'duplicate', type: C3NetworkType.C3, color: '#2', masterId: 'master', masterCompIndex: 0, members: ['slave-2'] },
        ];

        const cleaned = C3NetworkEditor.clean(networks, unitMap([master, ...slaves]));

        expect(cleaned).toEqual([networks[1]]);
        expect(C3NetworkEditor.clean(cleaned, unitMap([master, ...slaves]))).toEqual(cleaned);
    });

    it('cleans mixed members by committed majority and master-tie policy without reordering metadata or members', () => {
        const rootA = c3Unit('root-a', C3_FLAGS.C3M);
        const rootB = c3Unit('root-b', C3_FLAGS.C3M);
        const rootC = c3Unit('root-c', C3_FLAGS.C3M);
        const masterA = c3Unit('master-a', C3_FLAGS.C3M);
        const masterB = c3Unit('master-b', C3_FLAGS.C3M);
        const masterTie = c3Unit('master-tie', C3_FLAGS.C3M);
        const masterMinority = c3Unit('master-minority', C3_FLAGS.C3M);
        const slaveA = c3Unit('slave-a', C3_FLAGS.C3S);
        const slaveB = c3Unit('slave-b', C3_FLAGS.C3S);
        const slaveC = c3Unit('slave-c', C3_FLAGS.C3S);
        const slaveD = c3Unit('slave-d', C3_FLAGS.C3S);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'master-majority', type: C3NetworkType.C3, color: '#1', masterId: 'root-a', masterCompIndex: 0,
                members: ['master-a:0', 'slave-a', 'master-b:0'] },
            { id: 'slave-majority', type: C3NetworkType.C3, color: '#2', masterId: 'root-b', masterCompIndex: 0,
                members: ['slave-b', 'master-minority:0', 'slave-c'] },
            { id: 'master-tie', type: C3NetworkType.C3, color: '#3', masterId: 'root-c', masterCompIndex: 0,
                members: ['slave-d', 'master-tie:0'] },
        ];

        expect(C3NetworkEditor.clean(networks, unitMap([
            rootA, rootB, rootC, masterA, masterB, masterTie, masterMinority, slaveA, slaveB, slaveC, slaveD,
        ]))).toEqual([
            { ...networks[0], members: ['master-a:0', 'master-b:0'] },
            { ...networks[1], members: ['slave-b', 'slave-c'] },
            { ...networks[2], members: ['master-tie:0'] },
        ]);
    });

    it('keeps only the first network when a unit appears in multiple network types', () => {
        const shared = c3Unit('shared', C3_FLAGS.C3I);
        addC3Endpoint(shared, C3_FLAGS.NOVA);
        const first = c3Unit('first', C3_FLAGS.C3I);
        const later = c3Unit('later', C3_FLAGS.C3I);
        const nova = c3Unit('nova', C3_FLAGS.NOVA);
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'first-root', type: C3NetworkType.C3I, color: '#1', peerIds: ['first', 'shared'] },
            { id: 'later-root', type: C3NetworkType.C3I, color: '#2', peerIds: ['shared', 'later'] },
            { id: 'nova-root', type: C3NetworkType.NOVA, color: '#3', peerIds: ['shared', 'nova'] },
        ];

        expect(C3NetworkEditor.clean(networks, unitMap([shared, first, later, nova]))).toEqual([
            networks[0],
        ]);
    });

    it('deterministically trims an oversized hierarchy and terminates with stable ordering', () => {
        const root = c3Unit('root', C3_FLAGS.C3M);
        const childIds = ['left', 'middle', 'right'];
        const children = childIds.map(id => c3Unit(id, C3_FLAGS.C3M));
        const slaves = childIds.flatMap(id => [1, 2, 3].map(index => c3Unit(`${id}-${index}`, C3_FLAGS.C3S)));
        const networks: SerializedC3NetworkGroup[] = [
            { id: 'root-network', type: C3NetworkType.C3, color: '#1', masterId: 'root', masterCompIndex: 0,
                members: ['left:0', 'middle:0', 'right:0'] },
            ...children.map((child, index): SerializedC3NetworkGroup => ({
                id: `${child.id}-network`, type: C3NetworkType.C3, color: `#${index + 2}`,
                masterId: child.id, masterCompIndex: 0,
                members: [1, 2, 3].map(member => `${child.id}-${member}`),
            })),
        ];

        const cleaned = C3NetworkEditor.clean(networks, unitMap([root, ...children, ...slaves]));

        expect(cleaned).toEqual([
            { ...networks[0], members: ['left:0', 'middle:0'] },
            networks[1],
            networks[2],
            networks[3],
        ]);
        expect(C3NetworkEditor.clean(cleaned, unitMap([root, ...children, ...slaves]))).toEqual(cleaned);
    });
});
