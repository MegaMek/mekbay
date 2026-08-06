// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from './equipment-flags.type';
import type { ForceUnit } from './force-unit.model';
import type { MountedEquipment } from './mounted-equipment.model';
import type { Equipment } from './equipment.model';
import type { SerializedC3NetworkGroup } from './force-serialization';
import {
    getC3EmergencyMasterMode,
    getC3EmergencyMasterOperatingTurns,
    isC3EmergencyMaster,
    isC3EmergencyMasterFried,
    isC3EmergencyMasterRequested,
    type C3EmergencyMasterStatus,
} from './c3-emergency-master.model';

/**
 * C3 Network Types based on equipment flags
 */
export enum C3NetworkType {
    /** Standard C3 Network (Master/Slave) */
    C3 = 'c3',
    /** C3i Network */
    C3I = 'c3i',
    /** Naval C3 */
    NAVAL = 'naval',
    /** Nova CEWS */
    NOVA = 'nova'
}

/**
 * C3 Equipment Role
 */
export enum C3Role {
    /** C3 Master - can have slaves connected */
    MASTER = 'master',
    /** C3 Slave - connects to a master */
    SLAVE = 'slave',
    /** C3i/Nova/Naval - any unit can be master or slave */
    PEER = 'peer'
}

export function c3NetworkTypeName(type: C3NetworkType): string {
    switch (type) {
        case C3NetworkType.C3: return 'C³';
        case C3NetworkType.C3I: return 'C³i';
        case C3NetworkType.NAVAL: return 'Naval C³';
        case C3NetworkType.NOVA: return 'Nova';
        default: return 'Unknown';
    }
}

export function c3RoleName(role: C3Role): string {
    switch (role) {
        case C3Role.MASTER: return 'M';
        case C3Role.SLAVE: return 'S';
        case C3Role.PEER: return 'P';
        default: return '?';
    }
}

/**
 * Equipment flags for C3 detection
 */
export const C3_FLAGS = {
    /** Any C3 equipment */
    ANY_C3: 'ANY_C3', // We'll check for any C3 flag
    /** C3 Slave */
    C3S: 'F_C3S',
    /** C3 Boosted Slave */
    C3SBS: 'F_C3SBS',
    /** C3 Emergency Master */
    C3EM: 'F_C3EM',
    /** C3 Master */
    C3M: 'F_C3M',
    /** C3 Boosted Master */
    C3MBS: 'F_C3MBS',
    /** C3i */
    C3I: 'F_C3I',
    /** Nova CEWS */
    NOVA: 'F_NOVA',
    /** Naval C3 */
    NAVAL_C3: 'F_NAVAL_C3'
} as const;

/**
 * All C3 related flags for detection
 */
export const ALL_C3_FLAGS = [
    C3_FLAGS.C3S,
    C3_FLAGS.C3SBS,
    C3_FLAGS.C3EM,
    C3_FLAGS.C3M,
    C3_FLAGS.C3MBS,
    C3_FLAGS.C3I,
    C3_FLAGS.NOVA,
    C3_FLAGS.NAVAL_C3
] as const;

/**
 * Master flags (can have slaves connected)
 */
export const C3_MASTER_FLAGS = [
    C3_FLAGS.C3M,
    C3_FLAGS.C3MBS
] as const;

/**
 * Slave flags (connects to a master)
 */
export const C3_SLAVE_FLAGS = [
    C3_FLAGS.C3S,
    C3_FLAGS.C3SBS
] as const;

/**
 * Peer flags (any unit can be master)
 */
export const C3_PEER_FLAGS = [
    C3_FLAGS.C3I,
    C3_FLAGS.NOVA,
    C3_FLAGS.NAVAL_C3
] as const;

/**
 * Boosted C3 flags (higher tax rate)
 */
export const C3_BOOSTED_FLAGS = [
    C3_FLAGS.C3SBS,
    C3_FLAGS.C3MBS
] as const;

/**
 * Network compatibility groups - units can only link within the same group
 */
export const C3_COMPATIBLE_NETWORKS: { type: C3NetworkType; flags: EquipmentFlag[] }[] = [
    {
        type: C3NetworkType.C3,
        flags: [C3_FLAGS.C3S, C3_FLAGS.C3SBS, C3_FLAGS.C3EM, C3_FLAGS.C3M, C3_FLAGS.C3MBS]
    },
    {
        type: C3NetworkType.C3I,
        flags: [C3_FLAGS.C3I]
    },
    {
        type: C3NetworkType.NAVAL,
        flags: [C3_FLAGS.NAVAL_C3]
    },
    {
        type: C3NetworkType.NOVA,
        flags: [C3_FLAGS.NOVA]
    }
];

/**
 * Maximum units per network type
 * For standard C3: 4 per master (1 master + 3 slaves/sub-masters)
 * Total company-level C3 network: max 12 participating endpoints
 */
export const C3_NETWORK_LIMITS: Record<C3NetworkType, number> = {
    [C3NetworkType.C3]: 3, // Master can have up to 3 slaves OR 3 sub-masters (not both)
    [C3NetworkType.C3I]: 6,
    [C3NetworkType.NAVAL]: 6,
    [C3NetworkType.NOVA]: 3
};

/** Maximum participating endpoints in a hierarchical C3 network. */
export const C3_MAX_NETWORK_TOTAL = 12;
/** Maximum network depth (master -> sub-master -> slaves). */
export const C3_MAX_NETWORK_DEPTH = 2;

/**
 * Tax rates for BV calculation
 */
export const C3_TAX_RATE = 0.05;
export const C3_BOOSTED_TAX_RATE = 0.07;
export const NOVA_MAX_TAX_RATE = 0.35;

/**
 * Represents a C3 component on a unit
 */
export interface C3Component {
    /** Runtime equipment endpoint; absent only for Alpha Strike specials. */
    mount?: MountedEquipment;
    /** Network type */
    networkType: C3NetworkType;
    /** Role (master/slave/peer) */
    role: C3Role;
    /** Is this a boosted C3 */
    boosted: boolean;
    /** Index within this unit's normalized C3 endpoints. */
    index: number;
}

export interface C3Node {
    unit: ForceUnit;
    c3Components: C3Component[];
    x: number;
    y: number;
    zIndex: number;
    pinOffsetsX: number[];
}

/**
 * Visual position for the network editor
 */
export interface C3NodePosition {
    x: number;
    y: number;
}

/**
 * Network colors for visualization (32 distinct colors with good white text contrast)
 */
export const C3_NETWORK_COLORS = [
    // Primary spectrum
    '#1565C0', // Blue
    '#2E7D32', // Green
    '#7B1FA2', // Purple
    '#E65100', // Orange
    '#00838F', // Teal
    '#5D4037', // Brown
    // Secondary spectrum
    '#283593', // Indigo
    '#558B2F', // Lime
    '#00695C', // Dark Cyan
    '#6A1B9A', // Violet
    '#EF6C00', // Amber
    '#0277BD', // Light Blue
    '#4E342E', // Dark Brown
    // Extended palette
    '#1B5E20', // Forest Green
    '#4527A0', // Deep Indigo
    '#006064', // Dark Teal
    '#33691E', // Olive
    '#311B92', // Deep Purple
    '#00796B', // Sea Green
    '#5E35B1', // Medium Purple
    '#F57C00', // Light Orange
    '#0288D1', // Sky Blue
    '#8E24AA', // Orchid
    '#3E2723', // Espresso
    '#827717', // Dark Lime
    '#01579B', // Navy Blue
] as const;

/**
 * Alpha Strike C3 ability info (parsed from specials)
 */
export interface ASC3Info {
    /** C3 flag equivalent */
    flag: EquipmentFlag;
    /** Network type */
    networkType: C3NetworkType;
    /** Role (master/slave/peer) */
    role: C3Role;
    /** Is this a boosted C3 */
    boosted: boolean;
    /** Count (for multiple masters) */
    count: number;
}

/**
 * Mapping of Alpha Strike special ability patterns to C3 flags.
 * Pattern uses regex to match the ability string from as.specials.
 */
const AS_C3_PATTERNS: { pattern: RegExp; flag: EquipmentFlag; networkType: C3NetworkType; role: C3Role; boosted: boolean }[] = [
    // C3BSS - Boosted Slave (no count)
    { pattern: /^C3BSS$/, flag: C3_FLAGS.C3SBS, networkType: C3NetworkType.C3, role: C3Role.SLAVE, boosted: true },
    // C3BSM# - Boosted Master with count
    { pattern: /^C3BSM(\d*)$/, flag: C3_FLAGS.C3MBS, networkType: C3NetworkType.C3, role: C3Role.MASTER, boosted: true },
    // C3EM# - Emergency Master with count
    { pattern: /^C3EM(\d*)$/, flag: C3_FLAGS.C3EM, networkType: C3NetworkType.C3, role: C3Role.SLAVE, boosted: false },
    // C3M# - Master with count
    { pattern: /^C3M(\d*)$/, flag: C3_FLAGS.C3M, networkType: C3NetworkType.C3, role: C3Role.MASTER, boosted: false },
    // C3S - Slave (no count)
    { pattern: /^C3S$/, flag: C3_FLAGS.C3S, networkType: C3NetworkType.C3, role: C3Role.SLAVE, boosted: false },
    // C3I - Improved C3 (peer network)
    { pattern: /^C3I$/, flag: C3_FLAGS.C3I, networkType: C3NetworkType.C3I, role: C3Role.PEER, boosted: false },
    // NC3 - Naval C3
    { pattern: /^NC3$/, flag: C3_FLAGS.NAVAL_C3, networkType: C3NetworkType.NAVAL, role: C3Role.PEER, boosted: false },
    // NOVA - Nova CEWS
    { pattern: /^NOVA$/, flag: C3_FLAGS.NOVA, networkType: C3NetworkType.NOVA, role: C3Role.PEER, boosted: false },
];

/**
 * Parse Alpha Strike specials to extract C3 capabilities.
 * @param specials Array of special ability strings from unit.as.specials
 * @returns Array of C3 info objects
 */
export function parseASC3Specials(specials: string[]): ASC3Info[] {
    const results: ASC3Info[] = [];
    
    for (const special of specials) {
        for (const { pattern, flag, networkType, role, boosted } of AS_C3_PATTERNS) {
            const match = special.match(pattern);
            if (match) {
                // Extract count from capture group if present, default to 1
                const count = match[1] ? parseInt(match[1], 10) : 1;
                results.push({ flag, networkType, role, boosted, count });
                break; // Only match one pattern per special
            }
        }
    }
    
    return results;
}

export interface C3EndpointRef {
    readonly unitId: string;
    readonly compIndex: number;
}

export interface C3MemberRef {
    readonly unitId: string;
    readonly compIndex?: number;
}

export interface C3Link {
    readonly network: SerializedC3NetworkGroup;
    readonly source: C3EndpointRef;
    readonly target: C3EndpointRef;
    readonly operational: boolean;
}

export interface C3SerializedConnection {
    readonly networkId: string;
    readonly member?: string;
}

export interface C3RuntimeState {
    readonly linked: boolean;
    readonly degraded: boolean;
    readonly color?: string;
}

const UNLINKED_C3_STATE: C3RuntimeState = Object.freeze({ linked: false, degraded: false });

/** One normalized, ordered snapshot of a unit's mounted or Alpha Strike C3 endpoints. */
export class C3Capabilities {
    readonly components: readonly C3Component[];
    readonly hasC3: boolean;
    readonly networkTypes: ReadonlySet<C3NetworkType>;

    constructor(readonly unit: ForceUnit) {
        const inventory = (unit as ForceUnit & { getInventory?: () => readonly MountedEquipment[] }).getInventory?.();
        this.components = inventory
            ? inventory.flatMap((mount): C3Component[] => {
                const networkType = C3Capabilities.networkType(mount.equipment);
                const role = C3Capabilities.role(mount.equipment);
                return networkType && role ? [{
                    mount, networkType, role,
                    boosted: C3Capabilities.isBoosted(mount.equipment),
                    index: 0,
                }] : [];
            }).map((component, index) => ({ ...component, index }))
            : C3Capabilities.fromAlphaStrike(unit);
        this.hasC3 = this.components.length > 0;
        this.networkTypes = new Set(this.components.map(component => component.networkType));
    }

    component(index: number): C3Component | undefined {
        return this.components[index];
    }

    uniqueIndex(role: C3Role, type: C3NetworkType): number | undefined {
        const matches = this.components.filter(component => component.role === role && component.networkType === type);
        return matches.length === 1 ? matches[0].index : undefined;
    }

    has(type: C3NetworkType, role?: C3Role): boolean {
        return this.components.some(component => component.networkType === type
            && (role === undefined || component.role === role));
    }

    static hasFlag(equipment?: Equipment): boolean {
        return !!equipment && ALL_C3_FLAGS.some(flag => equipment.flags.has(flag));
    }

    static networkType(equipment?: Equipment): C3NetworkType | null {
        return C3_COMPATIBLE_NETWORKS.find(group => group.flags.some(flag => equipment?.flags.has(flag)))?.type ?? null;
    }

    static role(equipment?: Equipment): C3Role | null {
        if (!equipment) return null;
        if (C3_MASTER_FLAGS.some(flag => equipment.flags.has(flag))) return C3Role.MASTER;
        if (C3_SLAVE_FLAGS.some(flag => equipment.flags.has(flag))) return C3Role.SLAVE;
        if (C3_PEER_FLAGS.some(flag => equipment.flags.has(flag))) return C3Role.PEER;
        return null;
    }

    static isBoosted(equipment?: Equipment): boolean {
        return !!equipment && C3_BOOSTED_FLAGS.some(flag => equipment.flags.has(flag));
    }

    private static fromAlphaStrike(unit: ForceUnit): C3Component[] {
        const components: C3Component[] = [];
        for (const info of parseASC3Specials(unit.getUnit().as?.specials ?? [])) {
            const count = info.role === C3Role.MASTER ? info.count : 1;
            for (let index = 0; index < count; index++) {
                components.push({
                    networkType: info.networkType,
                    role: info.role,
                    boosted: info.boosted,
                    index: components.length,
                });
            }
        }
        return components;
    }
}

/** Immutable indexed structural and runtime view of one serialized C3 revision. */
export class C3Network {
    readonly networks: readonly SerializedC3NetworkGroup[];
    readonly topLevelNetworks: readonly SerializedC3NetworkGroup[];
    readonly links: readonly C3Link[];
    readonly capabilitiesByUnitId: ReadonlyMap<string, C3Capabilities>;

    private readonly byId = new Map<string, SerializedC3NetworkGroup>();
    private readonly byUnit = new Map<string, SerializedC3NetworkGroup[]>();
    private readonly masterByEndpoint = new Map<string, SerializedC3NetworkGroup>();
    private readonly parentByEndpoint = new Map<string, SerializedC3NetworkGroup>();
    private readonly peerByUnitType = new Map<string, SerializedC3NetworkGroup>();
    private readonly parentById = new Map<string, SerializedC3NetworkGroup>();
    private readonly childrenById = new Map<string, SerializedC3NetworkGroup[]>();
    private readonly colorsByUnit = new Map<string, string[]>();
    private readonly linksByNetwork = new Map<string, C3Link[]>();
    private readonly incidentByNetworkUnit = new Map<string, C3Link[]>();
    private readonly exactLinks = new Map<string, C3Link>();
    private readonly stateCache = new Map<string, C3RuntimeState>();
    private readonly networkStateCache = new Map<string, C3RuntimeState>();
    private readonly emergencyNetworkIds = new Set<string>();
    private readonly emergencyMasterByNetworkId = new Map<string, { mount: MountedEquipment; endpoint: C3EndpointRef }>();
    private readonly unitsById: ReadonlyMap<string, ForceUnit>;
    private readonly jammedUnitIds: ReadonlySet<string>;

    constructor(
        networks: readonly SerializedC3NetworkGroup[],
        units: readonly ForceUnit[] = [],
        includeRuntime = true,
    ) {
        this.networks = networks;
        this.unitsById = new Map(units.map(unit => [unit.id, unit]));
        this.capabilitiesByUnitId = new Map(units.map(unit => [unit.id, new C3Capabilities(unit)]));
        this.jammedUnitIds = includeRuntime
            ? new Set(units.filter(unit => unit.isC3Jammed()).map(unit => unit.id))
            : new Set();
        for (const network of networks) this.indexNetwork(network);
        this.indexHierarchy();
        this.topLevelNetworks = networks.filter(network => !this.parentById.has(network.id));
        this.links = includeRuntime ? this.buildLinks() : [];
        if (includeRuntime) this.indexLinks();
    }

    capability(unitId: string): C3Capabilities | undefined { return this.capabilitiesByUnitId.get(unitId); }
    network(id: string): SerializedC3NetworkGroup | undefined { return this.byId.get(id); }
    networksForUnit(unitId: string): readonly SerializedC3NetworkGroup[] { return this.byUnit.get(unitId) ?? []; }
    isUnitConnected(unitId: string): boolean { return this.byUnit.has(unitId); }
    masterNetwork(unitId: string, compIndex: number): SerializedC3NetworkGroup | undefined {
        return this.masterByEndpoint.get(C3Network.endpointKey({ unitId, compIndex }));
    }
    peerNetwork(unitId: string, type: C3NetworkType): SerializedC3NetworkGroup | undefined {
        return this.peerByUnitType.get(C3Network.unitTypeKey(unitId, type));
    }
    parentNetworkForEndpoint(unitId: string, compIndex: number): SerializedC3NetworkGroup | undefined {
        return this.parentByEndpoint.get(C3Network.endpointKey({ unitId, compIndex }));
    }
    parentOf(networkId: string): SerializedC3NetworkGroup | undefined { return this.parentById.get(networkId); }
    childrenOf(networkId: string): readonly SerializedC3NetworkGroup[] { return this.childrenById.get(networkId) ?? []; }
    colorsForUnit(unitId: string): readonly string[] { return this.colorsByUnit.get(unitId) ?? []; }
    linksForNetwork(networkId: string): readonly C3Link[] { return this.linksByNetwork.get(networkId) ?? []; }
    incidentLinks(networkId: string, unitId: string): readonly C3Link[] {
        return this.incidentByNetworkUnit.get(`${networkId}\0${unitId}`) ?? [];
    }
    hasOnlyBrokenIncidentLinks(networkId: string, unitId: string): boolean {
        const links = this.incidentLinks(networkId, unitId);
        return links.length === 0 || links.every(link => !link.operational);
    }
    childLinkBroken(networkId: string, child: { unitId: string; compIndex?: number }): boolean {
        return !this.linksForNetwork(networkId).some(link => link.target.unitId === child.unitId
            && (child.compIndex === undefined || link.target.compIndex === child.compIndex) && link.operational);
    }
    findLink(networkId: string, source: C3EndpointRef, target: C3EndpointRef): C3Link | undefined {
        return this.exactLinks.get(C3Network.linkKey(networkId, source, target));
    }
    isUnitMasterConnected(unitId: string): boolean {
        return this.networksForUnit(unitId).some(network =>
            (network.masterId === unitId && !!network.members?.length)
            || !!network.members?.some(member => {
                const parsed = C3Network.parseMember(member);
                return parsed.unitId === unitId && parsed.compIndex !== undefined;
            }));
    }
    isUnitSlaveConnected(unitId: string): boolean {
        return this.networksForUnit(unitId).some(network => network.members?.includes(unitId) ?? false);
    }
    networkUnitIds(network: SerializedC3NetworkGroup): readonly string[] {
        const ids = new Set<string>();
        if (network.masterId) ids.add(network.masterId);
        for (const id of network.peerIds ?? []) ids.add(id);
        for (const member of network.members ?? []) ids.add(C3Network.parseMember(member).unitId);
        return [...ids];
    }
    resolveComponentIndex(unitId: string, network: SerializedC3NetworkGroup, role: C3Role): number | undefined {
        const capabilities = this.capability(unitId);
        if (!capabilities) return undefined;
        const explicit = role === C3Role.MASTER
            ? network.masterId === unitId ? network.masterCompIndex : C3Network.parseMember(
                network.members?.find(member => C3Network.parseMember(member).unitId === unitId) ?? '').compIndex
            : undefined;
        if (explicit !== undefined) {
            const component = capabilities.component(explicit);
            return component?.role === role && component.networkType === network.type ? explicit : undefined;
        }
        return capabilities.uniqueIndex(role, network.type);
    }
    connectedComponentIndexes(unitId: string): readonly number[] {
        const indexes = new Set<number>();
        for (const link of this.links) {
            if (link.source.unitId === unitId) indexes.add(link.source.compIndex);
            if (link.target.unitId === unitId) indexes.add(link.target.compIndex);
        }
        return [...indexes];
    }
    counterpartEndpoints(unitId: string, networkId: string): readonly C3EndpointRef[] {
        const endpoints: C3EndpointRef[] = [];
        for (const link of this.linksForNetwork(networkId)) {
            if (link.source.unitId === unitId && link.target.unitId !== unitId) endpoints.push(link.target);
            else if (link.target.unitId === unitId && link.source.unitId !== unitId) endpoints.push(link.source);
        }
        return endpoints;
    }
    stateForNetwork(unitId: string, networkId: string): C3RuntimeState {
        const cacheKey = `${networkId}\0${unitId}`;
        const cached = this.networkStateCache.get(cacheKey);
        if (cached) return cached;
        const network = this.network(networkId);
        if (!network || !this.networkUnitIds(network).includes(unitId)) return UNLINKED_C3_STATE;
        const links = this.linksForNetwork(networkId);
        const localKeys = new Set<string>();
        for (const link of links) {
            if (link.source.unitId === unitId) localKeys.add(C3Network.endpointKey(link.source));
            if (link.target.unitId === unitId) localKeys.add(C3Network.endpointKey(link.target));
        }
        const adjacency = new Map<string, Set<string>>();
        const operational = links.filter(link => link.operational);
        for (const link of operational) {
            C3Network.addToSet(adjacency, C3Network.endpointKey(link.source), C3Network.endpointKey(link.target));
            C3Network.addToSet(adjacency, C3Network.endpointKey(link.target), C3Network.endpointKey(link.source));
        }
        const stack = [...localKeys].filter(key => adjacency.has(key));
        if (stack.length === 0) {
            const state = { linked: false, degraded: false, color: network.color };
            this.networkStateCache.set(cacheKey, state);
            return state;
        }
        const component = new Set<string>();
        while (stack.length) {
            const key = stack.pop()!;
            if (component.has(key)) continue;
            component.add(key);
            for (const adjacent of adjacency.get(key) ?? []) stack.push(adjacent);
        }
        const componentLinks = operational.filter(link => component.has(C3Network.endpointKey(link.source))
            && component.has(C3Network.endpointKey(link.target)));
        const unitIds = new Set([...component].map(C3Network.endpointUnitId));
        const jammed = (id: string) => this.jammedUnitIds.has(id);
        const directSlaveIds = new Set((network.members ?? []).flatMap(member => {
            const parsed = C3Network.parseMember(member);
            return parsed.compIndex === undefined ? [parsed.unitId] : [];
        }));
        const effectiveMasterId = componentLinks[0]?.source.unitId;
        const isEffectiveMaster = unitId === effectiveMasterId;
        const degraded = network.type === C3NetworkType.C3
            ? jammed(unitId) || (
                isEffectiveMaster
                    ? componentLinks.some(link => directSlaveIds.has(link.target.unitId) && jammed(link.target.unitId))
                    : !!effectiveMasterId && jammed(effectiveMasterId)
            )
            : jammed(unitId) || [...unitIds].filter(id => id !== unitId).every(jammed);
        const state = { linked: true, degraded, color: this.effectiveComponentColor(localKeys, network) };
        this.networkStateCache.set(cacheKey, state);
        return state;
    }
    stateFor(unitId: string, type: C3NetworkType): C3RuntimeState {
        const cacheKey = C3Network.unitTypeKey(unitId, type);
        const cached = this.stateCache.get(cacheKey);
        if (cached) return cached;
        const states = this.networksForUnit(unitId)
            .filter(network => network.type === type)
            .map(network => this.stateForNetwork(unitId, network.id));
        if (states.length === 0) return UNLINKED_C3_STATE;
        const linked = states.filter(state => state.linked);
        const state = linked.length === 0
            ? { linked: false, degraded: false, color: states[0].color }
            : {
                linked: true,
                degraded: linked.every(state => state.degraded),
                color: (linked.find(state => !state.degraded) ?? linked[0]).color,
            };
        this.stateCache.set(cacheKey, state);
        return state;
    }
    statesFor(unitId: string): readonly C3RuntimeState[] {
        return this.networksForUnit(unitId).map(network => this.stateForNetwork(unitId, network.id));
    }
    hasLinkedNetwork(unitId: string): boolean { return this.statesFor(unitId).some(state => state.linked); }
    emergencyMasterStatus(equipment: MountedEquipment): C3EmergencyMasterStatus {
        if (!isC3EmergencyMaster(equipment)) return 'dormant';
        if (isC3EmergencyMasterFried(equipment)) return 'fried';
        const network = this.standardNetworkForEmergencyMaster(equipment);
        if (!network) return 'dormant';
        const requested = this.isEmergencyMasterRequested(network, equipment);
        if (!requested) return 'dormant';
        if (!this.isEndpointAvailable({
            unitId: equipment.owner.id,
            compIndex: this.emergencyMasterComponentIndex(equipment) ?? -1,
        }, false)) return 'unavailable';
        if (equipment.owner.isC3Jammed()) return 'standby';
        return this.effectiveEmergencyMaster(network)?.mount === equipment ? 'active' : 'standby';
    }
    emergencyMasterOperatingTurns(equipment: MountedEquipment): number {
        return getC3EmergencyMasterOperatingTurns(equipment);
    }
    effectiveEmergencyMasterForNetwork(networkId: string): C3EndpointRef | undefined {
        return this.emergencyMasterByNetworkId.get(networkId)?.endpoint;
    }
    rootOf(networkId: string): SerializedC3NetworkGroup | undefined {
        let current = this.network(networkId);
        const visited = new Set<string>();
        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            current = this.parentOf(current.id) ?? current;
            if (!this.parentOf(current.id)) return current;
        }
        return current;
    }
    treeNetworks(networkId: string): readonly SerializedC3NetworkGroup[] {
        const result: SerializedC3NetworkGroup[] = [];
        const visited = new Set<string>();
        const stack = [this.network(networkId)].filter((network): network is SerializedC3NetworkGroup => !!network);
        while (stack.length) {
            const network = stack.pop()!;
            if (visited.has(network.id)) continue;
            visited.add(network.id);
            result.push(network);
            stack.push(...this.childrenOf(network.id));
        }
        return result;
    }
    treeUnitIds(networkId: string): ReadonlySet<string> {
        const ids = new Set<string>();
        for (const network of this.treeNetworks(networkId)) {
            if (network.masterId) ids.add(network.masterId);
            for (const peerId of network.peerIds ?? []) ids.add(peerId);
            for (const member of network.members ?? []) ids.add(C3Network.parseMember(member).unitId);
        }
        return ids;
    }
    /** Participating endpoint identities; distinct Master components on one unit count separately. */
    treeEndpointKeys(networkId: string): ReadonlySet<string> {
        const keys = new Set<string>();
        for (const network of this.treeNetworks(networkId)) {
            if (network.peerIds) {
                for (const peerId of network.peerIds) keys.add(`peer:${peerId}`);
                continue;
            }
            if (network.masterId && network.masterCompIndex !== undefined) {
                keys.add(C3Network.masterEndpointKey(network.masterId, network.masterCompIndex));
            }
            for (const member of network.members ?? []) {
                const endpoint = C3Network.parseMember(member);
                keys.add(endpoint.compIndex === undefined
                    ? `slave:${endpoint.unitId}`
                    : C3Network.masterEndpointKey(endpoint.unitId, endpoint.compIndex));
            }
        }
        return keys;
    }
    static masterEndpointKey(unitId: string, compIndex: number): string {
        return `master:${unitId}:${compIndex}`;
    }
    isMasterBranchMember(member: string): boolean {
        const endpoint = C3Network.parseMember(member);
        return endpoint.compIndex !== undefined
            && !!this.masterNetwork(endpoint.unitId, endpoint.compIndex)?.members?.length;
    }
    depthOf(networkId: string): number {
        let depth = 0;
        let current = this.network(networkId);
        const visited = new Set<string>();
        while (current) {
            if (visited.has(current.id)) return C3_MAX_NETWORK_DEPTH + 1;
            visited.add(current.id);
            current = this.parentOf(current.id);
            if (current) depth++;
        }
        return depth;
    }
    subTreeDepth(networkId: string): number {
        let maximum = 0;
        const visited = new Set<string>();
        const stack = this.network(networkId) ? [{ id: networkId, depth: 0 }] : [];
        while (stack.length) {
            const current = stack.pop()!;
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            maximum = Math.max(maximum, current.depth);
            for (const child of this.childrenOf(current.id)) stack.push({ id: child.id, depth: current.depth + 1 });
        }
        return maximum;
    }
    connectionBetween(
        source: C3EndpointRef,
        sourceRole: C3Role,
        target: C3EndpointRef,
        targetRole: C3Role,
        networkType?: C3NetworkType,
    ): C3SerializedConnection | undefined {
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.SLAVE) {
            const network = this.masterNetwork(source.unitId, source.compIndex);
            if (network?.members?.includes(target.unitId)) return { networkId: network.id, member: target.unitId };
        } else if (sourceRole === C3Role.SLAVE && targetRole === C3Role.MASTER) {
            return this.connectionBetween(target, targetRole, source, sourceRole, networkType);
        } else if (sourceRole === C3Role.MASTER && targetRole === C3Role.MASTER) {
            const member = C3Network.masterMember(target.unitId, target.compIndex);
            const network = this.masterNetwork(source.unitId, source.compIndex);
            if (network?.members?.includes(member)) return { networkId: network.id, member };
            const reverseMember = C3Network.masterMember(source.unitId, source.compIndex);
            const reverseNetwork = this.masterNetwork(target.unitId, target.compIndex);
            if (reverseNetwork?.members?.includes(reverseMember)) {
                return { networkId: reverseNetwork.id, member: reverseMember };
            }
        } else if (sourceRole === C3Role.PEER && targetRole === C3Role.PEER && source.unitId !== target.unitId) {
            const network = networkType && this.peerNetwork(source.unitId, networkType);
            if (network?.peerIds?.includes(target.unitId)) return { networkId: network.id };
        }
        return undefined;
    }
    static parseMember(member: string): C3MemberRef {
        const separator = member.lastIndexOf(':');
        if (separator < 0) return { unitId: member };
        const compIndex = Number(member.slice(separator + 1));
        return Number.isInteger(compIndex) && compIndex >= 0
            ? { unitId: member.slice(0, separator), compIndex }
            : { unitId: member };
    }
    static masterMember(unitId: string, compIndex: number): string { return `${unitId}:${compIndex}`; }

    private effectiveComponentColor(localKeys: ReadonlySet<string>, network: SerializedC3NetworkGroup): string {
        if (network.type !== C3NetworkType.C3) return network.color;
        const healthyLinks = this.links.filter(link => link.network.type === network.type && link.operational
            && !this.jammedUnitIds.has(link.source.unitId) && !this.jammedUnitIds.has(link.target.unitId));
        const adjacency = new Map<string, Set<string>>();
        for (const link of healthyLinks) {
            C3Network.addToSet(adjacency, C3Network.endpointKey(link.source), C3Network.endpointKey(link.target));
            C3Network.addToSet(adjacency, C3Network.endpointKey(link.target), C3Network.endpointKey(link.source));
        }
        const stack = [...localKeys].filter(key => adjacency.has(key));
        const component = new Set<string>();
        while (stack.length) {
            const key = stack.pop()!;
            if (component.has(key)) continue;
            component.add(key);
            for (const adjacent of adjacency.get(key) ?? []) stack.push(adjacent);
        }
        const componentLinks = healthyLinks.filter(link => component.has(C3Network.endpointKey(link.source))
            && component.has(C3Network.endpointKey(link.target)));
        return C3Network.rootColor(componentLinks, network.type) ?? network.color;
    }

    private indexNetwork(network: SerializedC3NetworkGroup): void {
        this.byId.set(network.id, network);
        const ids = new Set<string>();
        if (network.masterId !== undefined && network.masterCompIndex !== undefined) {
            ids.add(network.masterId);
            this.masterByEndpoint.set(C3Network.endpointKey({ unitId: network.masterId, compIndex: network.masterCompIndex }), network);
        }
        for (const peerId of network.peerIds ?? []) {
            ids.add(peerId);
            this.peerByUnitType.set(C3Network.unitTypeKey(peerId, network.type), network);
        }
        for (const member of network.members ?? []) {
            const parsed = C3Network.parseMember(member);
            ids.add(parsed.unitId);
            if (parsed.compIndex !== undefined) {
                this.parentByEndpoint.set(C3Network.endpointKey({ unitId: parsed.unitId, compIndex: parsed.compIndex }), network);
            }
        }
        for (const id of ids) C3Network.append(this.byUnit, id, network);
        for (const id of network.peerIds ?? []) C3Network.appendUnique(this.colorsByUnit, id, network.color);
        for (const member of network.members ?? []) C3Network.appendUnique(this.colorsByUnit, C3Network.parseMember(member).unitId, network.color);
        if (network.masterId && network.members?.length) C3Network.appendUnique(this.colorsByUnit, network.masterId, network.color);
    }
    private indexHierarchy(): void {
        for (const parent of this.networks) {
            for (const member of parent.members ?? []) {
                const parsed = C3Network.parseMember(member);
                if (parsed.compIndex === undefined) continue;
                const child = this.masterNetwork(parsed.unitId, parsed.compIndex);
                if (!child || child.id === parent.id) continue;
                this.parentById.set(child.id, parent);
                C3Network.append(this.childrenById, parent.id, child);
            }
        }
    }
    private buildLinks(): C3Link[] {
        const links: C3Link[] = [];
        for (const network of this.networks) {
            const emergencyMaster = this.effectiveEmergencyMaster(network);
            if (!emergencyMaster) continue;
            this.emergencyNetworkIds.add(network.id);
            this.emergencyMasterByNetworkId.set(network.id, emergencyMaster);
        }
        for (const network of this.networks) {
            if (network.peerIds) {
                const endpoints = network.peerIds.flatMap(unitId => {
                    const compIndex = this.resolveComponentIndex(unitId, network, C3Role.PEER);
                    return compIndex === undefined ? [] : [{ unitId, compIndex }];
                });
                for (let left = 0; left < endpoints.length; left++) {
                    for (let right = left + 1; right < endpoints.length; right++) {
                        links.push(this.createLink(network, endpoints[left], endpoints[right]));
                    }
                }
            } else if (network.masterId && network.masterCompIndex !== undefined) {
                const emergencyMaster = this.emergencyMasterByNetworkId.get(network.id);
                const source = emergencyMaster?.endpoint
                    ?? { unitId: network.masterId, compIndex: network.masterCompIndex };
                for (const member of network.members ?? []) {
                    const parsed = C3Network.parseMember(member);
                    if (emergencyMaster && parsed.compIndex === undefined && parsed.unitId === source.unitId) continue;
                    const role = parsed.compIndex === undefined ? C3Role.SLAVE : C3Role.MASTER;
                    const explicitComponent = parsed.compIndex === undefined
                        ? undefined
                        : this.capability(parsed.unitId)?.component(parsed.compIndex);
                    const compIndex = explicitComponent?.role === role && explicitComponent.networkType === network.type
                        ? parsed.compIndex
                        : parsed.compIndex === undefined
                            ? this.resolveComponentIndex(parsed.unitId, network, role)
                            : undefined;
                    if (compIndex !== undefined) links.push(this.createLink(network, source, { unitId: parsed.unitId, compIndex }));
                }
            }
        }
        return links;
    }
    private createLink(network: SerializedC3NetworkGroup, source: C3EndpointRef, target: C3EndpointRef): C3Link {
        return { network, source, target, operational: this.isEndpointAvailable(source)
            && this.isEndpointAvailable(target) && !this.isDisplacedConfiguredMaster(network, target) };
    }
    private isDisplacedConfiguredMaster(linkNetwork: SerializedC3NetworkGroup, endpoint: C3EndpointRef): boolean {
        const childNetwork = this.masterNetwork(endpoint.unitId, endpoint.compIndex);
        return !!childNetwork && childNetwork.id !== linkNetwork.id && this.emergencyNetworkIds.has(childNetwork.id);
    }
    private isEndpointAvailable(endpoint: C3EndpointRef, rejectFried = true): boolean {
        const unit = this.unitsById.get(endpoint.unitId);
        const component = this.capability(endpoint.unitId)?.component(endpoint.compIndex);
        return !!unit && !!component
            && (!rejectFried || !component.mount || !isC3EmergencyMasterFried(component.mount))
            && unit.isC3EndpointOperational(endpoint.compIndex, component);
    }
    private standardNetworkForEmergencyMaster(equipment: MountedEquipment): SerializedC3NetworkGroup | undefined {
        return this.networksForUnit(equipment.owner.id).find(network => network.type === C3NetworkType.C3
            && network.members?.includes(equipment.owner.id));
    }
    private emergencyMasterComponentIndex(equipment: MountedEquipment): number | undefined {
        return this.capability(equipment.owner.id)?.components.find(component => component.mount === equipment)?.index;
    }
    private configuredMasterFailed(network: SerializedC3NetworkGroup): boolean {
        if (!network.masterId || network.masterCompIndex === undefined) return false;
        return this.jammedUnitIds.has(network.masterId)
            || !this.isEndpointAvailable({ unitId: network.masterId, compIndex: network.masterCompIndex });
    }
    private isEmergencyMasterRequested(network: SerializedC3NetworkGroup, equipment: MountedEquipment): boolean {
        return isC3EmergencyMasterRequested(equipment, this.configuredMasterFailed(network));
    }
    private effectiveEmergencyMaster(network: SerializedC3NetworkGroup): { mount: MountedEquipment; endpoint: C3EndpointRef } | undefined {
        for (const member of network.members ?? []) {
            const parsed = C3Network.parseMember(member);
            if (parsed.compIndex !== undefined) continue;
            const capabilities = this.capability(parsed.unitId);
            for (const component of capabilities?.components ?? []) {
                const mount = component.mount;
                if (component.role !== C3Role.SLAVE || component.networkType !== C3NetworkType.C3
                    || !mount || !isC3EmergencyMaster(mount) || !this.isEmergencyMasterRequested(network, mount)
                    || isC3EmergencyMasterFried(mount) || this.jammedUnitIds.has(parsed.unitId)
                    || !this.isEndpointAvailable({ unitId: parsed.unitId, compIndex: component.index }, false)) continue;
                return { mount, endpoint: { unitId: parsed.unitId, compIndex: component.index } };
            }
        }
        return undefined;
    }
    private indexLinks(): void {
        for (const link of this.links) {
            C3Network.append(this.linksByNetwork, link.network.id, link);
            C3Network.append(this.incidentByNetworkUnit, `${link.network.id}\0${link.source.unitId}`, link);
            if (link.source.unitId !== link.target.unitId) C3Network.append(this.incidentByNetworkUnit, `${link.network.id}\0${link.target.unitId}`, link);
            this.exactLinks.set(C3Network.linkKey(link.network.id, link.source, link.target), link);
        }
    }
    private static rootColor(links: readonly C3Link[], type: C3NetworkType): string | undefined {
        if (!links.length) return undefined;
        if (type !== C3NetworkType.C3) return links[0].network.color;
        const targets = new Set(links.map(link => C3Network.endpointKey(link.target)));
        return links.find(link => !targets.has(C3Network.endpointKey(link.source)))?.network.color ?? links[0].network.color;
    }
    private static endpointKey(endpoint: C3EndpointRef): string { return `${endpoint.unitId}:${endpoint.compIndex}`; }
    private static endpointUnitId(key: string): string { return key.slice(0, key.lastIndexOf(':')); }
    private static unitTypeKey(unitId: string, type: C3NetworkType): string { return `${unitId}\0${type}`; }
    private static linkKey(networkId: string, source: C3EndpointRef, target: C3EndpointRef): string {
        return `${networkId}\0${C3Network.endpointKey(source)}\0${C3Network.endpointKey(target)}`;
    }
    private static append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
        const values = map.get(key);
        if (values) values.push(value); else map.set(key, [value]);
    }
    private static appendUnique(map: Map<string, string[]>, key: string, value: string): void {
        const values = map.get(key);
        if (!values) map.set(key, [value]); else if (!values.includes(value)) values.push(value);
    }
    private static addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
        const values = map.get(key);
        if (values) values.add(value); else map.set(key, new Set([value]));
    }
}

export interface C3TaxUnit {
    readonly id: string;
    getBaseBv(): number;
    tagBV(): number;
}

/** Structural BV tax calculator; damage and jamming intentionally do not affect tax. */
export class C3TaxCalculator {
    private readonly model: C3Network;
    private readonly unitsById: ReadonlyMap<string, C3TaxUnit>;
    private readonly novaUnits: readonly C3TaxUnit[];
    private readonly forceBv: number;

    constructor(networks: readonly SerializedC3NetworkGroup[], private readonly units: readonly C3TaxUnit[]) {
        this.model = new C3Network(networks, units as unknown as readonly ForceUnit[], false);
        this.unitsById = new Map(units.map(unit => [unit.id, unit]));
        this.novaUnits = units.filter(unit => this.model.capability(unit.id)?.has(C3NetworkType.NOVA));
        this.forceBv = units.reduce((sum, unit) => sum + unit.getBaseBv() + unit.tagBV(), 0);
    }

    core2026(unit: C3TaxUnit): number {
        const nova = this.nova(unit);
        if (nova !== null) return nova;
        const networked = this.networkUnits(unit.id);
        if (networked.length < 2) return 0;
        const networkRate = Math.min(0.4, networked.length * C3_TAX_RATE);
        const boosted = this.model.capability(unit.id)?.components.some(component => component.boosted) ?? false;
        return Math.round((unit.getBaseBv() + unit.tagBV()) * (networkRate + (boosted ? C3_TAX_RATE : 0)));
    }

    totalWar(unit: C3TaxUnit): number {
        const nova = this.nova(unit);
        if (nova !== null) return nova;
        const networked = this.networkUnits(unit.id);
        if (networked.length < 2) return 0;
        const boosted = this.model.capability(unit.id)?.components.some(component => component.boosted) ?? false;
        const rate = boosted ? C3_BOOSTED_TAX_RATE : C3_TAX_RATE;
        return Math.round(networked.reduce((sum, candidate) =>
            sum + candidate.getBaseBv() + candidate.tagBV(), 0) * rate);
    }

    private nova(unit: C3TaxUnit): number | null {
        if (!this.model.capability(unit.id)?.has(C3NetworkType.NOVA)) return null;
        if (this.novaUnits.length < 2) return 0;
        const rate = Math.min(this.novaUnits.length * C3_TAX_RATE, NOVA_MAX_TAX_RATE);
        return Math.round((this.forceBv * rate) / this.novaUnits.length);
    }

    private networkUnits(unitId: string): C3TaxUnit[] {
        const participating = this.model.networksForUnit(unitId)[0];
        if (!participating) return [];
        const root = this.model.rootOf(participating.id) ?? participating;
        return [...this.model.treeUnitIds(root.id)].flatMap(id => {
            const unit = this.unitsById.get(id);
            return unit ? [unit] : [];
        });
    }
}