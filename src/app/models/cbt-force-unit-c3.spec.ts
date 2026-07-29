import { CBTForceUnit } from './cbt-force-unit.model';
import { C3_FLAGS, C3NetworkType } from './c3-network.model';
import type { Equipment } from './equipment.model';
import { MountedEquipment } from './mounted-equipment.model';
import type { SerializedC3NetworkGroup } from './force-serialization';
import type { InventoryControlRuntimeTarget } from './inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './rules/game-rules';

const TARGET: InventoryControlRuntimeTarget = {
    id: 'A',
    letter: 'A',
    name: 'Target',
    color: '#1565C0',
    distance: 15,
    c3Distance: 12,
    useC3: true,
    tnModifier: 0
};

function c3Network(members: string[] = ['attacker']): SerializedC3NetworkGroup[] {
    return [{
        id: 'network',
        type: C3NetworkType.C3,
        color: '#1565C0',
        masterId: 'master',
        masterCompIndex: 0,
        members
    }];
}

function c3BadgeUnit(
    id: string,
    mounts: { id: string; flag: string }[],
    unavailable: Set<string>,
): CBTForceUnit {
    const unit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
    const inventory = mounts.map(mount => new MountedEquipment({
        owner: unit,
        id: mount.id,
        name: mount.id,
        equipment: { flags: new Set([mount.flag]) } as Equipment,
        states: new Map(),
    }));
    Object.defineProperties(unit, {
        id: { value: id, configurable: true },
        destroyed: { value: false, configurable: true },
        getUnit: { value: () => ({ comp: [] }), configurable: true },
        getInventory: { value: () => inventory, configurable: true },
        isEquipmentUnavailable: {
            value: (entry: MountedEquipment) => unavailable.has(entry.id),
            configurable: true,
        },
        getCondition: { value: () => false, configurable: true },
    });
    return unit;
}

function connectBadgeUnits(units: CBTForceUnit[], networks: SerializedC3NetworkGroup[]): void {
    const force = { units: () => units, c3Networks: () => networks };
    units.forEach(unit => Object.defineProperty(unit, 'force', { value: force, configurable: true }));
}

function unitContext(options: {
    selfJammed?: boolean;
    masterJammed?: boolean;
    networks?: SerializedC3NetworkGroup[];
    rules?: typeof CORE_2026_GAME_RULES | typeof TW_GAME_RULES;
    linked?: boolean;
    operationalPins?: Record<number, boolean>;
}) {
    let context: CBTForceUnit;
    const slaveMount = new MountedEquipment({
        owner: null!,
        id: 'slave',
        name: 'C3 Slave',
        equipment: { flags: new Set([C3_FLAGS.C3S]) } as Equipment,
        states: new Map(),
    });
    const master = {
        id: 'master',
        getCondition: (condition: string) => condition === 'jammed' && options.masterJammed === true,
        isC3ComponentOperational: (index: number) => options.operationalPins?.[index] ?? true
    } as CBTForceUnit;
    Object.setPrototypeOf(master, CBTForceUnit.prototype);
    const unit = {
        id: 'attacker',
        gameRules: options.rules ?? CORE_2026_GAME_RULES,
        getUnit: () => ({ comp: [] }),
        getInventory: () => [slaveMount],
        isC3ComponentOperational: (index: number) => options.operationalPins?.[index] ?? true,
        getCondition: (condition: string) => condition === 'jammed' && options.selfJammed === true,
        hasLinkedC3Network: () => options.linked ?? true,
        getC3NetworkRuntimeState: () => ({
            linked: options.linked ?? (options.operationalPins?.[0] ?? true),
            degraded: options.masterJammed === true && (options.operationalPins?.[0] ?? true),
        }),
        force: {
            c3Networks: () => options.networks ?? c3Network(),
            units: () => [master]
        },
        getC3DegradationSource: CBTForceUnit.prototype.getC3DegradationSource,
        c3DegradationSource: () => CBTForceUnit.prototype.getC3DegradationSource.call(context),
        withoutC3Distance: (target: InventoryControlRuntimeTarget) => target.c3Distance === undefined
            ? target
            : { ...target, c3Distance: undefined }
    };
    context = unit as unknown as CBTForceUnit;
    slaveMount.owner = context;
    return context;
}

describe('CBTForceUnit C3 targeting resolution', () => {
    it('queries mounted capabilities and filters unavailable mounts', () => {
        const unavailable = new Set<string>(['broken-ecm']);
        const inventory = [
            { id: 'working-ecm', equipment: { hasFlag: (flag: string) => flag === 'F_ECM' } },
            { id: 'broken-ecm', equipment: { hasFlag: (flag: string) => flag === 'F_ECM' } },
            { id: 'tag', equipment: { hasFlag: (flag: string) => flag === 'F_TAG' } },
        ] as unknown as MountedEquipment[];
        const context = {
            getInventory: () => inventory,
            isEquipmentUnavailable: (entry: MountedEquipment) => unavailable.has(entry.id),
            getMountedEquipmentByFlag: CBTForceUnit.prototype.getMountedEquipmentByFlag,
        } as unknown as CBTForceUnit;

        expect(CBTForceUnit.prototype.getMountedEquipmentByFlag.call(context, 'F_ECM').map(entry => entry.id))
            .toEqual(['working-ecm', 'broken-ecm']);
        expect(CBTForceUnit.prototype.getOperationalMountedEquipmentByFlag.call(context, 'F_ECM').map(entry => entry.id))
            .toEqual(['working-ecm']);
        expect(CBTForceUnit.prototype.getMountedEquipmentByFlag.call(context, 'F_TAG').map(entry => entry.id))
            .toEqual(['tag']);
    });

    describe('C3 badge availability', () => {
        it('is unavailable only when all local components of the displayed type are unavailable', () => {
            const unavailable = new Set(['broken']);
            const unit = c3BadgeUnit('unit', [
                { id: 'working', flag: C3_FLAGS.C3S },
                { id: 'broken', flag: C3_FLAGS.C3S },
            ], unavailable);
            connectBadgeUnits([unit], []);

            expect(unit.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeFalse();

            unavailable.add('working');
            expect(unit.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeTrue();
        });

        it('marks a standard C3 slave unavailable when its exact direct-master component is unavailable', () => {
            const unavailable = new Set(['connected-master']);
            const master = c3BadgeUnit('master', [
                { id: 'connected-master', flag: C3_FLAGS.C3M },
                { id: 'other-master', flag: C3_FLAGS.C3M },
            ], unavailable);
            const slave = c3BadgeUnit('slave', [{ id: 'slave-c3', flag: C3_FLAGS.C3S }], unavailable);
            const networks: SerializedC3NetworkGroup[] = [{
                id: 'network', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'master', masterCompIndex: 0, members: ['slave'],
            }];
            connectBadgeUnits([master, slave], networks);

            expect(master.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeTrue();
            expect(slave.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeTrue();

            unavailable.delete('connected-master');
            unavailable.add('other-master');
            expect(slave.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeFalse();
        });

        it('does not cascade unavailable state through a master with its own subnetwork', () => {
            const unavailable = new Set(['master-a-c3']);
            const masterA = c3BadgeUnit('master-a', [{ id: 'master-a-c3', flag: C3_FLAGS.C3M }], unavailable);
            const masterB = c3BadgeUnit('master-b', [{ id: 'master-b-c3', flag: C3_FLAGS.C3M }], unavailable);
            const slave = c3BadgeUnit('slave', [{ id: 'slave-c3', flag: C3_FLAGS.C3S }], unavailable);
            const networks: SerializedC3NetworkGroup[] = [
                {
                    id: 'parent', type: C3NetworkType.C3, color: '#1565C0',
                    masterId: 'master-a', masterCompIndex: 0, members: ['master-b:0'],
                },
                {
                    id: 'child', type: C3NetworkType.C3, color: '#2E7D32',
                    masterId: 'master-b', masterCompIndex: 0, members: ['slave'],
                },
            ];
            connectBadgeUnits([masterA, masterB, slave], networks);

            expect(masterA.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeTrue();
            expect(masterB.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeFalse();
            expect(slave.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeFalse();

            unavailable.add('master-b-c3');
            expect(masterB.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeTrue();
            expect(slave.isC3NetworkTypeUnavailable(C3NetworkType.C3)).toBeTrue();
        });

        [
            { type: C3NetworkType.C3I, flag: C3_FLAGS.C3I },
            { type: C3NetworkType.NOVA, flag: C3_FLAGS.NOVA },
            { type: C3NetworkType.NAVAL, flag: C3_FLAGS.NAVAL_C3 },
        ].forEach(({ type, flag }) => {
            it(`loses its two-unit ${type} link when the remote endpoint fails`, () => {
                const unavailable = new Set(['remote-component']);
                const local = c3BadgeUnit('local', [{ id: 'local-component', flag }], unavailable);
                const remote = c3BadgeUnit('remote', [{ id: 'remote-component', flag }], unavailable);
                const networks: SerializedC3NetworkGroup[] = [{
                    id: 'peer-network', type, color: '#1565C0', peerIds: ['local', 'remote'],
                }];
                connectBadgeUnits([local, remote], networks);

                expect(local.isC3NetworkTypeUnavailable(type)).toBeTrue();
                expect(remote.isC3NetworkTypeUnavailable(type)).toBeTrue();
            });
        });
    });

    it('identifies direct and direct-master jamming', () => {
        expect(CBTForceUnit.prototype.getC3DegradationSource.call(unitContext({ selfJammed: true }))).toBe('unit');
        expect(CBTForceUnit.prototype.getC3DegradationSource.call(unitContext({ masterJammed: true }))).toBe('network-member');
        expect(CBTForceUnit.prototype.getC3DegradationSource.call(unitContext({}))).toBe('none');
    });

    it('uses a healthy linked network when another network type is degraded', () => {
        const unit = c3BadgeUnit('multi-network', [
            { id: 'slave', flag: C3_FLAGS.C3S },
            { id: 'peer', flag: C3_FLAGS.C3I },
        ], new Set());
        Object.defineProperties(unit, {
            getCondition: { value: () => false, configurable: true },
            getC3NetworkRuntimeState: {
                value: (type: C3NetworkType) => ({
                    linked: true,
                    degraded: type === C3NetworkType.C3,
                }),
                configurable: true,
            },
        });

        expect(unit.getC3DegradationSource()).toBe('none');
    });

    it('reports network degradation when every linked network is degraded', () => {
        const unit = c3BadgeUnit('multi-network', [
            { id: 'slave', flag: C3_FLAGS.C3S },
            { id: 'peer', flag: C3_FLAGS.C3I },
        ], new Set());
        Object.defineProperties(unit, {
            getCondition: { value: () => false, configurable: true },
            getC3NetworkRuntimeState: {
                value: () => ({ linked: true, degraded: true }),
                configurable: true,
            },
        });

        expect(unit.getC3DegradationSource()).toBe('network-member');
    });

    it('does not inherit degradation through an unavailable connected endpoint', () => {
        expect(CBTForceUnit.prototype.getC3DegradationSource.call(unitContext({
            masterJammed: true,
            operationalPins: { 0: false }
        }))).toBe('none');
    });

    it('propagates a jammed member through a master with children', () => {
        const networks = [
            ...c3Network(['attacker:0']),
            {
                id: 'child-network',
                type: C3NetworkType.C3,
                color: '#2E7D32',
                masterId: 'attacker',
                masterCompIndex: 0,
                members: ['child']
            }
        ];

        expect(CBTForceUnit.prototype.getC3DegradationSource.call(unitContext({ masterJammed: true, networks }))).toBe('network-member');
    });

    it('blocks C3 under Total Warfare without mutating stored target state', () => {
        const unit = unitContext({ selfJammed: true, rules: TW_GAME_RULES });

        const resolution = CBTForceUnit.prototype.resolveC3Targeting.call(unit, TARGET);

        expect(resolution.target.c3Distance).toBeUndefined();
        expect(resolution.target.useC3).toBeTrue();
        expect(resolution.degradationSource).toBe('unit');
        expect(TARGET.c3Distance).toBe(12);
    });

    it('preserves C3 and marks ECM degradation under Core Rules', () => {
        const unit = unitContext({ masterJammed: true, rules: CORE_2026_GAME_RULES });

        const resolution = CBTForceUnit.prototype.resolveC3Targeting.call(unit, TARGET);

        expect(resolution.target).toBe(TARGET);
        expect(resolution.degradationSource).toBe('network-member');
    });

    it('removes stale C3 distance for an unlinked unit without adding ECM degradation', () => {
        const unit = unitContext({ selfJammed: true, linked: false, rules: CORE_2026_GAME_RULES });

        const resolution = CBTForceUnit.prototype.resolveC3Targeting.call(unit, TARGET);

        expect(resolution.target.c3Distance).toBeUndefined();
        expect(resolution.degradationSource).toBe('none');
    });

    it('uses only the specifically connected C3 component for operational linkage', () => {
        const unavailable = new Set<string>(['local-master']);
        const mounts: MountedEquipment[] = [];
        const networks = c3Network();
        const masterMounts: MountedEquipment[] = [];
        const master = {
            id: 'master',
            destroyed: false,
            getUnit: () => ({ comp: [] }),
            getInventory: () => masterMounts,
            isEquipmentUnavailable: () => false,
            isC3ComponentOperational: CBTForceUnit.prototype.isC3ComponentOperational,
            getCondition: () => false,
        } as unknown as CBTForceUnit;
        Object.setPrototypeOf(master, CBTForceUnit.prototype);
        masterMounts.push(new MountedEquipment({
            owner: master,
            id: 'master',
            name: 'C3 Master',
            equipment: { flags: new Set([C3_FLAGS.C3M]) } as Equipment,
            states: new Map(),
        }));
        const context = {
            id: 'attacker',
            destroyed: false,
            getUnit: () => ({ comp: [] }),
            getInventory: () => mounts,
            isEquipmentUnavailable: (entry: MountedEquipment) => unavailable.has(entry.id),
            isC3ComponentOperational: CBTForceUnit.prototype.isC3ComponentOperational,
            getC3NetworkRuntimeState: CBTForceUnit.prototype.getC3NetworkRuntimeState,
            getCondition: () => false,
        } as unknown as CBTForceUnit;
        Object.setPrototypeOf(context, CBTForceUnit.prototype);
        Object.defineProperty(context, 'force', {
            value: { c3Networks: () => networks, units: () => [master, context] },
        });
        mounts.push(
            new MountedEquipment({
                owner: context,
                id: 'slave',
                name: 'C3 Slave',
                equipment: { flags: new Set([C3_FLAGS.C3S]) } as Equipment,
                states: new Map(),
            }),
            new MountedEquipment({
                owner: context,
                id: 'local-master',
                name: 'C3 Master',
                equipment: { flags: new Set([C3_FLAGS.C3M]) } as Equipment,
                states: new Map(),
            }),
        );

        expect(CBTForceUnit.prototype.hasLinkedC3Network.call(context)).toBeTrue();

        unavailable.delete('local-master');
        unavailable.add('slave');
        expect(CBTForceUnit.prototype.hasLinkedC3Network.call(context)).toBeFalse();
    });
});
