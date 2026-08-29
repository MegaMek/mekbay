// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CBTForceUnit } from './cbt-force-unit.model';
import { C3Capabilities, C3_FLAGS, C3Network, C3NetworkType } from './c3-network.model';
import type { Equipment } from './equipment.model';
import { MountedEquipment } from './mounted-equipment.model';
import type { SerializedC3NetworkGroup } from './force-serialization';
import type { InventoryControlRuntimeTarget } from './inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './rules/game-rules';
import { UnitTypeRulesBase } from './rules/unit-type-rules';
import { NOVA_CEWS_OFF_STATE, NOVA_CEWS_STATE_KEY } from '../utils/ecm-state.util';

class C3BadgeRules extends UnitTypeRulesBase {
    override evaluateDestroyed(): void { }
}

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
    const rules = new C3BadgeRules(unit);
    const inventory = mounts.map(mount => new MountedEquipment({
        owner: unit,
        id: mount.id,
        name: mount.id,
        equipment: {
            flags: new Set([mount.flag]),
            modes: mount.flag === 'F_STEALTH' || mount.flag === 'F_CHAMELEON_SHIELD' || mount.flag === 'F_NULL_SIG'
                ? ['Off', 'On']
                : [],
        } as Equipment,
        states: new Map(),
    }));
    Object.defineProperties(unit, {
        id: { value: id, configurable: true },
        destroyed: { value: false, configurable: true },
        shutdown: { value: false, writable: true, configurable: true },
        getUnit: { value: () => ({ comp: [] }), configurable: true },
        getInventory: { value: () => inventory, configurable: true },
        turnState: { value: () => ({ moveDistance: () => 0 }), configurable: true },
        getCrewMember: { value: () => ({ getState: () => 'healthy' }), configurable: true },
        getEquipmentStatus: {
            value: (entry: MountedEquipment) => unavailable.has(entry.id) ? 'destroyed' : 'available',
            configurable: true,
        },
        isEquipmentOperational: {
            value: (entry: MountedEquipment) => !unavailable.has(entry.id),
            configurable: true,
        },
        rules: {
            value: rules,
            configurable: true,
        },
        getCondition: {
            value: (condition: string) => condition === 'stealth' && rules.hasComputedCondition(condition),
            configurable: true,
        },
    });
    return unit;
}

function connectBadgeUnits(units: CBTForceUnit[], networks: SerializedC3NetworkGroup[]): void {
    const force = {
        units: () => units,
        c3Networks: () => networks,
        c3Network: () => new C3Network(networks, units),
    };
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
    let slaveMount!: MountedEquipment;
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
            units: () => [master],
            c3Network: () => {
                const linked = options.linked ?? (options.operationalPins?.[0] ?? true);
                const state = {
                    linked,
                    degraded: options.masterJammed === true && linked,
                };
                return {
                    hasLinkedNetwork: () => linked,
                    statesFor: () => [state],
                    stateFor: () => state,
                };
            },
        },
        getC3DegradationSource: CBTForceUnit.prototype.getC3DegradationSource,
        c3DegradationSource: () => CBTForceUnit.prototype.getC3DegradationSource.call(context),
        withoutC3Distance: (target: InventoryControlRuntimeTarget) => target.c3Distance === undefined
            ? target
            : { ...target, c3Distance: undefined }
    };
    context = unit as unknown as CBTForceUnit;
    slaveMount = new MountedEquipment({
        owner: context,
        id: 'slave',
        name: 'C3 Slave',
        equipment: { flags: new Set([C3_FLAGS.C3S]) } as Equipment,
        states: new Map(),
    });
    return context;
}

describe('CBTForceUnit C3 targeting resolution', () => {
    it('disconnects every C3 endpoint while the unit is shutdown', () => {
        const unit = c3BadgeUnit('shutdown-unit', [
            { id: 'master', flag: C3_FLAGS.C3M },
            { id: 'slave', flag: C3_FLAGS.C3S },
        ], new Set());

        expect(unit.isC3ComponentOperational(0)).toBeTrue();
        expect(unit.isC3ComponentOperational(1)).toBeTrue();

        Object.defineProperty(unit, 'getCondition', {
            value: (condition: string) => condition === 'shutdown',
            configurable: true,
        });

        expect(unit.isEquipmentOperational(unit.getInventory()[0])).toBeTrue();
        expect(unit.isEquipmentOperational(unit.getInventory()[1])).toBeTrue();
        expect(CBTForceUnit.prototype.canPerformEquipmentAction.call(unit, unit.getInventory()[0], 'configure-network')).toBeTrue();
        expect(CBTForceUnit.prototype.canPerformEquipmentAction.call(unit, unit.getInventory()[1], 'configure-network')).toBeTrue();
        expect(unit.isC3ComponentOperational(0)).toBeFalse();
        expect(unit.isC3ComponentOperational(1)).toBeFalse();
    });

    it('keeps a switched-off Nova CEWS configurable while its endpoint is unavailable', () => {
        const unit = c3BadgeUnit('nova-unit', [
            { id: 'nova', flag: C3_FLAGS.NOVA },
        ], new Set());
        const nova = unit.getInventory()[0];

        expect(new C3Capabilities(unit).has(C3NetworkType.NOVA)).toBeTrue();
        expect(unit.isC3ComponentOperational(0)).toBeTrue();

        nova.states.set(NOVA_CEWS_STATE_KEY, NOVA_CEWS_OFF_STATE);

        expect(new C3Capabilities(unit).has(C3NetworkType.NOVA)).toBeTrue();
        expect(unit.isC3ComponentOperational(0)).toBeFalse();
        expect(unit.canPerformEquipmentAction(nova, 'configure-network')).toBeTrue();
    });

    it('keeps every C3 network type configurable regardless unit or component condition', () => {
        const unavailable = new Set(['master', 'slave', 'c3i', 'naval', 'nova']);
        const unit = c3BadgeUnit('damaged-c3-unit', [
            { id: 'master', flag: C3_FLAGS.C3M },
            { id: 'slave', flag: C3_FLAGS.C3S },
            { id: 'c3i', flag: C3_FLAGS.C3I },
            { id: 'naval', flag: C3_FLAGS.NAVAL_C3 },
            { id: 'nova', flag: C3_FLAGS.NOVA },
        ], unavailable);
        Object.defineProperty(unit, 'destroyed', { value: true, configurable: true });

        const components = new C3Capabilities(unit).components;
        expect(components.length).toBe(5);
        components.forEach(component => {
            expect(unit.isC3ComponentOperational(component.index, component)).toBeFalse();
            expect(unit.canPerformEquipmentAction(component.mount!, 'configure-network')).toBeTrue();
        });
    });

    it('disconnects C3 for active Stealth Armor except Chameleon LPS and Null Signature', () => {
        const stealthUnit = c3BadgeUnit('stealth-unit', [
            { id: 'c3', flag: C3_FLAGS.C3M },
            { id: 'stealth', flag: 'F_STEALTH' },
            { id: 'ecm', flag: 'F_ECM' },
        ], new Set());
        const chameleonUnit = c3BadgeUnit('chameleon-unit', [
            { id: 'c3', flag: C3_FLAGS.C3M },
            { id: 'chameleon', flag: 'F_CHAMELEON_SHIELD' },
        ], new Set());
        const nullSignatureUnit = c3BadgeUnit('null-signature-unit', [
            { id: 'c3', flag: C3_FLAGS.C3M },
            { id: 'null-signature', flag: 'F_NULL_SIG' },
        ], new Set());
        stealthUnit.getInventory()[1].states.set('state', 'enabled');
        chameleonUnit.getInventory()[1].states.set('state', 'enabled');
        nullSignatureUnit.getInventory()[1].states.set('state', 'enabled');

        expect(stealthUnit.isC3ComponentOperational(0)).toBeFalse();
        expect(chameleonUnit.isC3ComponentOperational(0)).toBeTrue();
        expect(nullSignatureUnit.isC3ComponentOperational(0)).toBeTrue();
    });

    it('suppresses probes only while standard Stealth Armor is active', () => {
        const stealthUnit = c3BadgeUnit('stealth-unit', [
            { id: 'probe', flag: 'F_BAP' },
            { id: 'stealth', flag: 'F_STEALTH' },
            { id: 'ecm', flag: 'F_ECM' },
        ], new Set());
        const nullSignatureUnit = c3BadgeUnit('null-signature-unit', [
            { id: 'probe', flag: 'F_BAP' },
            { id: 'null-signature', flag: 'F_NULL_SIG' },
        ], new Set());
        const [stealthProbe, stealth] = stealthUnit.getInventory();
        const [nullProbe, nullSignature] = nullSignatureUnit.getInventory();

        expect(stealthUnit.canPerformEquipmentAction(stealthProbe, 'provide-passive-effect')).toBeTrue();
        stealth.states.set('state', 'enabled');
        nullSignature.states.set('state', 'enabled');

        expect(stealthUnit.canPerformEquipmentAction(stealthProbe, 'provide-passive-effect')).toBeFalse();
        expect(nullSignatureUnit.canPerformEquipmentAction(nullProbe, 'provide-passive-effect')).toBeTrue();
    });

    it('derives the STEALTH banner condition from an effective stealth system', () => {
        const stealthUnit = c3BadgeUnit('stealth-unit', [
            { id: 'stealth', flag: 'F_STEALTH' },
            { id: 'ecm', flag: 'F_ECM' },
        ], new Set());
        const chameleonUnit = c3BadgeUnit('chameleon-unit', [
            { id: 'chameleon', flag: 'F_CHAMELEON_SHIELD' },
        ], new Set());
        const brokenEcmUnit = c3BadgeUnit('broken-ecm-unit', [
            { id: 'stealth', flag: 'F_STEALTH' },
            { id: 'ecm', flag: 'F_ECM' },
        ], new Set(['ecm']));

        expect(stealthUnit.rules.isComputedCondition('stealth')).toBeTrue();
        expect(stealthUnit.rules.computedConditions()).toContain('stealth');
        expect(stealthUnit.getCondition('stealth')).toBeFalse();

        stealthUnit.getInventory()[0].states.set('state', 'enabled');
        chameleonUnit.getInventory()[0].states.set('state', 'enabled');
        brokenEcmUnit.getInventory()[0].states.set('state', 'enabled');

        expect(stealthUnit.getCondition('stealth')).toBeTrue();
        expect(chameleonUnit.getCondition('stealth')).toBeTrue();
        expect(brokenEcmUnit.getCondition('stealth')).toBeFalse();
    });

    it('keeps C3 configuration available while runtime effects are suppressed', () => {
        const unit = c3BadgeUnit('stealth-unit', [
            { id: 'c3', flag: C3_FLAGS.C3M },
            { id: 'stealth', flag: 'F_STEALTH' },
            { id: 'ecm', flag: 'F_ECM' },
        ], new Set());
        const [c3, stealth] = unit.getInventory();

        expect(unit.canPerformEquipmentAction(c3, 'configure-network')).toBeTrue();
        expect(unit.canPerformEquipmentAction(stealth, 'configure-network')).toBeFalse();

        stealth.states.set('state', 'enabled');

        expect(unit.isEquipmentOperational(c3)).toBeTrue();
        expect(unit.isC3ComponentOperational(0)).toBeFalse();
        expect(unit.canPerformEquipmentAction(c3, 'configure-network')).toBeTrue();
    });

    it('does not disconnect C3 for an unavailable stealth system with stale active state', () => {
        const unit = c3BadgeUnit('damaged-stealth', [
            { id: 'c3', flag: C3_FLAGS.C3M },
            { id: 'stealth', flag: 'F_STEALTH' },
            { id: 'ecm', flag: 'F_ECM' },
        ], new Set(['stealth']));
        unit.getInventory()[1].states.set('state', 'enabled');

        expect(unit.isC3ComponentOperational(0)).toBeTrue();
    });

    it('queries mounted capabilities and filters unavailable mounts', () => {
        const unavailable = new Set<string>(['broken-ecm']);
        const inventory = [
            { id: 'working-ecm', equipment: { hasFlag: (flag: string) => flag === 'F_ECM' } },
            { id: 'broken-ecm', equipment: { hasFlag: (flag: string) => flag === 'F_ECM' } },
            { id: 'tag', equipment: { hasFlag: (flag: string) => flag === 'F_TAG' } },
        ] as unknown as MountedEquipment[];
        const context = {
            getInventory: () => inventory,
            isEquipmentOperational: (entry: MountedEquipment) => !unavailable.has(entry.id),
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
            force: { value: {
                c3Network: () => ({
                    statesFor: () => [
                        { linked: true, degraded: true },
                        { linked: true, degraded: false },
                    ],
                }),
            }, configurable: true },
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
            force: { value: {
                c3Network: () => ({
                    statesFor: () => [
                        { linked: true, degraded: true },
                        { linked: true, degraded: true },
                    ],
                }),
            }, configurable: true },
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
            isEquipmentOperational: () => true,
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
            isEquipmentOperational: (entry: MountedEquipment) => !unavailable.has(entry.id),
            isC3ComponentOperational: CBTForceUnit.prototype.isC3ComponentOperational,
            getC3NetworkRuntimeState: CBTForceUnit.prototype.getC3NetworkRuntimeState,
            getCondition: () => false,
        } as unknown as CBTForceUnit;
        Object.setPrototypeOf(context, CBTForceUnit.prototype);
        Object.defineProperty(context, 'force', {
            value: {
                c3Networks: () => networks,
                units: () => [master, context],
                c3Network: () => new C3Network(networks, [master, context]),
            },
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
