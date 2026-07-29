/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { ForceUnit } from '../models/force-unit.model';
import type { Equipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    type C3Component,
    C3NetworkType,
    type C3Node,
    C3Role,
    ALL_C3_FLAGS,
    C3_MASTER_FLAGS,
    C3_SLAVE_FLAGS,
    C3_PEER_FLAGS,
    C3_BOOSTED_FLAGS,
    C3_COMPATIBLE_NETWORKS,
    C3_NETWORK_LIMITS,
    C3_MAX_NETWORK_DEPTH,
    C3_MAX_NETWORK_TOTAL,
    C3_TAX_RATE,
    C3_BOOSTED_TAX_RATE,
    NOVA_MAX_TAX_RATE,
    C3_NETWORK_COLORS,
    parseASC3Specials
} from '../models/c3-network.model';
import type { SerializedC3NetworkGroup } from '../models/force-serialization';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { uuidv7 } from './uuid.util';

/** Result of a network mutation operation */
export interface NetworkMutationResult {
    networks: SerializedC3NetworkGroup[];
    success: boolean;
    message?: string;
}

/** Context for network operations using C3Nodes */
export interface C3NetworkContext {
    networks: SerializedC3NetworkGroup[];
    /** Function to get the next available color */
    getNextColor: () => string;
    /** Pre-assigned colors for master pins */
    masterPinColors?: Map<string, string>;
}

export interface C3ConnectedEndpoint {
    unitId: string;
    compIndex: number;
}

export interface C3RuntimeLink {
    network: SerializedC3NetworkGroup;
    source: C3ConnectedEndpoint;
    target: C3ConnectedEndpoint;
    operational: boolean;
}

export interface C3RuntimeUnitState {
    linked: boolean;
    degraded: boolean;
    color?: string;
}

/**
 * C3 Network Utility - Simplified API using C3Node
 */
export class C3NetworkUtil {

    // ==================== Component Detection ====================

    /** Check if mounted equipment has any C3 capability. */
    public static hasC3Flag(equipment?: Equipment): boolean {
        return !!equipment && ALL_C3_FLAGS.some(flag => equipment.flags.has(flag));
    }

    /** Get the C3 network type for equipment. */
    public static getNetworkType(equipment?: Equipment): C3NetworkType | null {
        if (!equipment) return null;
        for (const network of C3_COMPATIBLE_NETWORKS) {
            if (network.flags.some(flag => equipment.flags.has(flag))) {
                return network.type;
            }
        }
        return null;
    }

    /** Get the C3 role for equipment. */
    public static getRole(equipment?: Equipment): C3Role | null {
        if (!equipment) return null;
        if (C3_MASTER_FLAGS.some(flag => equipment.flags.has(flag))) return C3Role.MASTER;
        if (C3_SLAVE_FLAGS.some(flag => equipment.flags.has(flag))) return C3Role.SLAVE;
        if (C3_PEER_FLAGS.some(flag => equipment.flags.has(flag))) return C3Role.PEER;
        return null;
    }

    /** Check if equipment is boosted C3. */
    public static isBoosted(equipment?: Equipment): boolean {
        return !!equipment && C3_BOOSTED_FLAGS.some(flag => equipment.flags.has(flag));
    }

    /** Get normalized C3 endpoints from CBT mounts or Alpha Strike specials. */
    public static getC3Components(forceUnit: ForceUnit): C3Component[] {
        const mounts = this.getMountedInventory(forceUnit);
        if (mounts) {
            return mounts.flatMap((mount): C3Component[] => {
                const networkType = this.getNetworkType(mount.equipment);
                const role = this.getRole(mount.equipment);
                if (!networkType || !role) return [];
                return [{
                    mount,
                    networkType,
                    role,
                    boosted: this.isBoosted(mount.equipment),
                    index: 0,
                }];
            }).map((component, index) => ({ ...component, index }));
        }

        const components: C3Component[] = [];
        const specials = forceUnit.getUnit().as?.specials;
        if (specials) {
            const asC3Info = parseASC3Specials(specials);
            for (const info of asC3Info) {
                const count = info.role === C3Role.MASTER ? info.count : 1;
                for (let i = 0; i < count; i++) {
                    components.push({
                        networkType: info.networkType,
                        role: info.role,
                        boosted: info.boosted,
                        index: components.length,
                    });
                }
            }
        }
        
        return components;
    }

    private static getMountedInventory(forceUnit: ForceUnit): readonly MountedEquipment[] | null {
        const candidate = forceUnit as ForceUnit & { getInventory?: () => readonly MountedEquipment[] };
        return typeof candidate.getInventory === 'function' ? candidate.getInventory() : null;
    }

    public static hasC3(forceUnit: ForceUnit): boolean {
        return this.getC3Components(forceUnit).length > 0;
    }

    // ==================== Network Queries ====================

    /** Find a peer network containing a unit */
    public static findPeerNetwork(
        unitId: string,
        networks: SerializedC3NetworkGroup[],
        networkType?: C3NetworkType,
    ): SerializedC3NetworkGroup | null {
        return networks.find(n => n.peerIds?.includes(unitId)
            && (networkType === undefined || n.type === networkType)) ?? null;
    }

    /** Find a master network by master unit and component */
    public static findMasterNetwork(
        masterId: string,
        compIndex: number,
        networks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup | null {
        return networks.find(n => 
            n.masterId === masterId && n.masterCompIndex === compIndex
        ) ?? null;
    }

    /** Find all networks containing a unit (as master, slave, or peer) */
    public static findNetworksContainingUnit(
        unitId: string,
        networks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] {
        return networks.filter(n =>
            n.masterId === unitId ||
            n.peerIds?.includes(unitId) ||
            n.members?.some(m => m === unitId || m.startsWith(unitId + ':'))
        );
    }

    /** Check if a unit is connected to any network */
    public static isUnitConnected(unitId: string, networks: SerializedC3NetworkGroup[]): boolean {
        return this.findNetworksContainingUnit(unitId, networks).length > 0;
    }

    /** Resolve serialized topology into exact endpoint links and runtime availability. */
    public static getRuntimeLinks(
        networks: readonly SerializedC3NetworkGroup[],
        unitsById: ReadonlyMap<string, ForceUnit>,
        isEndpointOperational: (unit: ForceUnit, componentIndex: number) => boolean,
    ): C3RuntimeLink[] {
        const links: C3RuntimeLink[] = [];
        for (const network of networks) {
            if (network.peerIds) {
                const endpoints = network.peerIds.flatMap(unitId => {
                    const unit = unitsById.get(unitId);
                    if (!unit) return [];
                    const compIndex = this.resolveConnectedComponentIndex(unitId, unit, network, C3Role.PEER);
                    return compIndex === undefined ? [] : [{ unitId, compIndex }];
                });
                for (let sourceIndex = 0; sourceIndex < endpoints.length; sourceIndex++) {
                    for (let targetIndex = sourceIndex + 1; targetIndex < endpoints.length; targetIndex++) {
                        links.push(this.runtimeLink(
                            network,
                            endpoints[sourceIndex],
                            endpoints[targetIndex],
                            unitsById,
                            isEndpointOperational,
                        ));
                    }
                }
                continue;
            }

            if (!network.masterId || network.masterCompIndex === undefined) continue;
            const source = { unitId: network.masterId, compIndex: network.masterCompIndex };
            for (const member of network.members ?? []) {
                const parsed = this.parseMember(member);
                const unit = unitsById.get(parsed.unitId);
                if (!unit) continue;
                const role = parsed.compIndex === undefined ? C3Role.SLAVE : C3Role.MASTER;
                const explicitComponent = parsed.compIndex === undefined
                    ? undefined
                    : this.getC3Components(unit)[parsed.compIndex];
                const compIndex = explicitComponent?.role === role && explicitComponent.networkType === network.type
                    ? parsed.compIndex
                    : parsed.compIndex === undefined
                        ? this.resolveConnectedComponentIndex(parsed.unitId, unit, network, role)
                        : undefined;
                if (compIndex === undefined) continue;
                links.push(this.runtimeLink(
                    network,
                    source,
                    { unitId: parsed.unitId, compIndex },
                    unitsById,
                    isEndpointOperational,
                ));
            }
        }
        return links;
    }

    public static hasOnlyBrokenIncidentLinks(
        networkId: string,
        unitId: string,
        links: readonly C3RuntimeLink[],
    ): boolean {
        const incidentLinks = links.filter(link => link.network.id === networkId
            && (link.source.unitId === unitId || link.target.unitId === unitId));
        return incidentLinks.length === 0 || incidentLinks.every(link => !link.operational);
    }

    public static isChildLinkBroken(
        networkId: string,
        unitId: string,
        componentIndex: number | undefined,
        links: readonly C3RuntimeLink[],
    ): boolean {
        return !links.some(link => link.network.id === networkId
            && link.target.unitId === unitId
            && (componentIndex === undefined || link.target.compIndex === componentIndex)
            && link.operational);
    }

    /** Runtime state for one unit/network type, based only on operational exact-pin links. */
    public static getRuntimeUnitState(
        unitId: string,
        networkType: C3NetworkType,
        links: readonly C3RuntimeLink[],
        isUnitJammed: (unitId: string) => boolean,
    ): C3RuntimeUnitState {
        const typedLinks = links.filter(link => link.network.type === networkType);
        const localEndpointKeys = new Set<string>();
        for (const link of typedLinks) {
            if (link.source.unitId === unitId) localEndpointKeys.add(this.endpointKey(link.source));
            if (link.target.unitId === unitId) localEndpointKeys.add(this.endpointKey(link.target));
        }
        if (localEndpointKeys.size === 0) return { linked: false, degraded: false };

        const operationalLinks = typedLinks.filter(link => link.operational);
        const adjacency = new Map<string, Set<string>>();
        const incidentLinks = new Map<string, C3RuntimeLink[]>();
        for (const link of operationalLinks) {
            const sourceKey = this.endpointKey(link.source);
            const targetKey = this.endpointKey(link.target);
            this.addAdjacent(adjacency, sourceKey, targetKey);
            this.addAdjacent(adjacency, targetKey, sourceKey);
            this.addIncidentLink(incidentLinks, sourceKey, link);
            this.addIncidentLink(incidentLinks, targetKey, link);
        }

        const linkedLocalKeys = [...localEndpointKeys].filter(key => (adjacency.get(key)?.size ?? 0) > 0);
        if (linkedLocalKeys.length === 0) {
            const configuredLink = typedLinks.find(link =>
                localEndpointKeys.has(this.endpointKey(link.source)) || localEndpointKeys.has(this.endpointKey(link.target)));
            return { linked: false, degraded: false, color: configuredLink?.network.color };
        }

        const componentKeys = new Set<string>();
        const componentLinks = new Map<string, C3RuntimeLink>();
        const stack = [...linkedLocalKeys];
        while (stack.length > 0) {
            const key = stack.pop()!;
            if (componentKeys.has(key)) continue;
            componentKeys.add(key);
            for (const link of incidentLinks.get(key) ?? []) componentLinks.set(this.runtimeLinkKey(link), link);
            for (const neighbor of adjacency.get(key) ?? []) stack.push(neighbor);
        }

        const componentUnitIds = new Set([...componentKeys].map(key => this.endpointUnitId(key)));
        const degraded = networkType === C3NetworkType.C3
            ? [...componentUnitIds].some(isUnitJammed)
            : isUnitJammed(unitId) || [...componentUnitIds]
                .filter(componentUnitId => componentUnitId !== unitId)
                .every(isUnitJammed);
        return {
            linked: true,
            degraded,
            color: this.operationalRootColor([...componentLinks.values()], networkType),
        };
    }

    private static runtimeLink(
        network: SerializedC3NetworkGroup,
        source: C3ConnectedEndpoint,
        target: C3ConnectedEndpoint,
        unitsById: ReadonlyMap<string, ForceUnit>,
        isEndpointOperational: (unit: ForceUnit, componentIndex: number) => boolean,
    ): C3RuntimeLink {
        const sourceUnit = unitsById.get(source.unitId);
        const targetUnit = unitsById.get(target.unitId);
        return {
            network,
            source,
            target,
            operational: !!sourceUnit && !!targetUnit
                && isEndpointOperational(sourceUnit, source.compIndex)
                && isEndpointOperational(targetUnit, target.compIndex),
        };
    }

    private static operationalRootColor(links: readonly C3RuntimeLink[], networkType: C3NetworkType): string | undefined {
        if (links.length === 0) return undefined;
        if (networkType !== C3NetworkType.C3) return links[0].network.color;
        const incomingTargets = new Set(links.map(link => this.endpointKey(link.target)));
        return links.find(link => !incomingTargets.has(this.endpointKey(link.source)))?.network.color
            ?? links[0].network.color;
    }

    private static endpointKey(endpoint: C3ConnectedEndpoint): string {
        return `${endpoint.unitId}:${endpoint.compIndex}`;
    }

    private static endpointUnitId(endpointKey: string): string {
        return endpointKey.slice(0, endpointKey.lastIndexOf(':'));
    }

    private static runtimeLinkKey(link: C3RuntimeLink): string {
        return `${link.network.id}:${this.endpointKey(link.source)}>${this.endpointKey(link.target)}`;
    }

    private static addAdjacent(adjacency: Map<string, Set<string>>, key: string, adjacent: string): void {
        const values = adjacency.get(key) ?? new Set<string>();
        values.add(adjacent);
        adjacency.set(key, values);
    }

    private static addIncidentLink(linksByEndpoint: Map<string, C3RuntimeLink[]>, key: string, link: C3RuntimeLink): void {
        const links = linksByEndpoint.get(key) ?? [];
        links.push(link);
        linksByEndpoint.set(key, links);
    }

    /** Resolve the exact C3 pins used by a unit's serialized network links. */
    public static findConnectedComponentIndexes(
        unitId: string,
        unit: ForceUnit,
        networks: SerializedC3NetworkGroup[]
    ): number[] {
        const components = this.getC3Components(unit);
        const indexes = new Set<number>();
        for (const network of networks) {
            if (network.masterId === unitId && (network.members?.length ?? 0) > 0) {
                const component = components[network.masterCompIndex ?? -1];
                if (component?.role === C3Role.MASTER && component.networkType === network.type) indexes.add(component.index);
            }

            const member = network.members?.find(value => this.parseMember(value).unitId === unitId);
            if (member) {
                const parsed = this.parseMember(member);
                const compIndex = parsed.compIndex
                    ?? this.uniqueComponentIndex(components, C3Role.SLAVE, network.type);
                const component = compIndex === undefined ? undefined : components[compIndex];
                const expectedRole = parsed.compIndex === undefined ? C3Role.SLAVE : C3Role.MASTER;
                if (component?.role === expectedRole && component.networkType === network.type) indexes.add(component.index);
            }

            if (network.peerIds?.includes(unitId)) {
                const compIndex = this.uniqueComponentIndex(components, C3Role.PEER, network.type);
                const component = compIndex === undefined ? undefined : components[compIndex];
                if (component?.role === C3Role.PEER && component.networkType === network.type) indexes.add(component.index);
            }
        }
        return [...indexes];
    }

    /** Return only the remote endpoints directly connected to this unit in one network. */
    public static findConnectedCounterpartEndpoints(
        unitId: string,
        unitsById: ReadonlyMap<string, ForceUnit>,
        network: SerializedC3NetworkGroup
    ): C3ConnectedEndpoint[] {
        if (network.peerIds?.includes(unitId)) {
            return network.peerIds
                .filter(peerId => peerId !== unitId)
                .flatMap(peerId => {
                    const peer = unitsById.get(peerId);
                    if (!peer) return [];
                    const indexes = this.findConnectedComponentIndexes(peerId, peer, [network]);
                    return indexes.map(compIndex => ({ unitId: peerId, compIndex }));
                });
        }

        if (network.masterId === unitId) {
            return (network.members ?? []).flatMap(member => {
                const { unitId: memberId } = this.parseMember(member);
                if (memberId === unitId) return [];
                const memberUnit = unitsById.get(memberId);
                if (!memberUnit) return [];
                return this.findConnectedComponentIndexes(memberId, memberUnit, [network])
                    .map(compIndex => ({ unitId: memberId, compIndex }));
            });
        }

        if (network.members?.some(member => this.parseMember(member).unitId === unitId)
            && network.masterId) {
            const master = unitsById.get(network.masterId);
            if (!master) return [];
            return this.findConnectedComponentIndexes(network.masterId, master, [network])
                .map(compIndex => ({ unitId: network.masterId!, compIndex }));
        }
        return [];
    }

    /** Resolve an explicit master pin or the unique slave/peer pin for the network type. */
    public static resolveConnectedComponentIndex(
        unitId: string,
        unit: ForceUnit,
        network: SerializedC3NetworkGroup,
        role: C3Role
    ): number | undefined {
        const components = this.getC3Components(unit);
        const explicitMasterIndex = role === C3Role.MASTER
            ? network.masterId === unitId ? network.masterCompIndex : this.parseMember(
                network.members?.find(member => this.parseMember(member).unitId === unitId) ?? ''
            ).compIndex
            : undefined;
        if (explicitMasterIndex !== undefined) {
            const component = components[explicitMasterIndex];
            return component?.role === role && component.networkType === network.type
                ? explicitMasterIndex
                : undefined;
        }
        return this.uniqueComponentIndex(components, role, network.type);
    }

    private static uniqueComponentIndex(
        components: C3Component[],
        role: C3Role,
        networkType: C3NetworkType
    ): number | undefined {
        const candidates = components.filter(component => component.role === role && component.networkType === networkType);
        return candidates.length === 1 ? candidates[0].index : undefined;
    }

    /** Check if a unit's Master component is connected */
    public static isUnitMasterConnected(unitId: string, networks: SerializedC3NetworkGroup[]): boolean {
        if (networks.some(n => n.masterId === unitId && (n.members?.length ?? 0) > 0)) {
            return true;
        }
        for (const net of networks) {
            if (net.members?.some(m => this.isMasterMember(m) && this.parseMember(m).unitId === unitId)) {
                return true;
            }
        }
        return false;
    }

    /** Check if a unit's Slave component is connected */
    public static isUnitSlaveConnected(unitId: string, networks: SerializedC3NetworkGroup[]): boolean {
        for (const net of networks) {
            if (net.members?.some(m => !this.isMasterMember(m) && m === unitId)) {
                return true;
            }
        }
        return false;
    }

    /** Parse a member string into unitId and optional compIndex */
    public static parseMember(member: string): { unitId: string; compIndex?: number } {
        const parts = member.split(':');
        return {
            unitId: parts[0],
            compIndex: parts.length > 1 ? parseInt(parts[1], 10) : undefined
        };
    }

    /** Create a member string for a master component */
    public static createMasterMember(unitId: string, compIndex: number): string {
        return `${unitId}:${compIndex}`;
    }

    /** Check if a member string represents a master (has compIndex) */
    public static isMasterMember(member: string): boolean {
        return member.includes(':');
    }

    /** Get all unit IDs in a network */
    public static getNetworkUnitIds(network: SerializedC3NetworkGroup): string[] {
        const idSet = new Set<string>();
        if (network.peerIds) {
            for (const id of network.peerIds) idSet.add(id);
        } else if (network.masterId) {
            idSet.add(network.masterId);
            for (const m of network.members ?? []) {
                idSet.add(this.parseMember(m).unitId);
            }
        }
        return Array.from(idSet);
    }

    /** Get all units in a network */
    public static getNetworkUnits(network: SerializedC3NetworkGroup, allUnits: ForceUnit[]): ForceUnit[] {
        const unitIds = this.getNetworkUnitIds(network);
        const unitMap = new Map(allUnits.map(u => [u.id, u]));
        return unitIds.map(id => unitMap.get(id)).filter((u): u is ForceUnit => !!u);
    }

    /** Find the parent network of a sub-network */
    public static findParentNetwork(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup | null {
        if (!network.masterId || network.masterCompIndex === undefined) return null;
        const masterMember = this.createMasterMember(network.masterId, network.masterCompIndex);
        return allNetworks.find(n => 
            n.id !== network.id && n.members?.includes(masterMember)
        ) ?? null;
    }

    /** Find sub-networks of a network */
    public static findSubNetworks(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] {
        if (!network.members) return [];
        const subNets: SerializedC3NetworkGroup[] = [];
        for (const member of network.members) {
            if (this.isMasterMember(member)) {
                const { unitId, compIndex } = this.parseMember(member);
                const subNet = this.findMasterNetwork(unitId, compIndex!, allNetworks);
                if (subNet) subNets.push(subNet);
            }
        }
        return subNets;
    }

    /** Walk a master/sub-master tree without revisiting cyclic links. */
    private static collectNetworkTree(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] {
        const collected: SerializedC3NetworkGroup[] = [];
        const visited = new Set<string>();
        const stack = [network];

        while (stack.length > 0) {
            const current = stack.pop()!;
            if (visited.has(current.id)) continue;

            visited.add(current.id);
            collected.push(current);

            for (const subNet of this.findSubNetworks(current, allNetworks)) {
                if (!visited.has(subNet.id)) {
                    stack.push(subNet);
                }
            }
        }

        return collected;
    }

    /** Get the depth of a network in the hierarchy */
    public static getNetworkDepth(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): number {
        let depth = 0;
        let current: SerializedC3NetworkGroup | null = network;
        const visited = new Set<string>();

        while (current) {
            if (visited.has(current.id)) {
                return C3_MAX_NETWORK_DEPTH + 1;
            }

            visited.add(current.id);
            const parent = this.findParentNetwork(current, allNetworks);
            if (parent) {
                depth++;
                current = parent;
            } else {
                break;
            }
        }
        return depth;
    }

    /** Get the maximum sub-tree depth below a network */
    public static getSubTreeDepth(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): number {
        let maxSubDepth = 0;
        const visited = new Set<string>();
        const stack: Array<{ network: SerializedC3NetworkGroup; depth: number }> = [{ network, depth: 0 }];

        while (stack.length > 0) {
            const current = stack.pop()!;
            if (visited.has(current.network.id)) continue;

            visited.add(current.network.id);
            maxSubDepth = Math.max(maxSubDepth, current.depth);

            for (const subNet of this.findSubNetworks(current.network, allNetworks)) {
                if (!visited.has(subNet.id)) {
                    stack.push({ network: subNet, depth: current.depth + 1 });
                }
            }
        }

        return maxSubDepth;
    }

    /** Get top-level networks (not sub-networks of another) */
    public static getTopLevelNetworks(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        return networks.filter(n => !this.findParentNetwork(n, networks));
    }

    /** Count total units in a network tree */
    public static countNetworkTreeUnits(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): number {
        const unitIds = new Set<string>();

        for (const net of this.collectNetworkTree(network, allNetworks)) {
            for (const id of this.getNetworkUnitIds(net)) unitIds.add(id);
        }

        return unitIds.size;
    }

    /** Get the root network of a hierarchy */
    public static getRootNetwork(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup {
        let current = network;
        const visited = new Set<string>();
        let parent = this.findParentNetwork(current, allNetworks);
        while (parent) {
            if (visited.has(current.id)) {
                break;
            }

            visited.add(current.id);
            current = parent;
            parent = this.findParentNetwork(current, allNetworks);
        }
        return current;
    }

    // ==================== Validation ====================

    /** Check if two C3 components are compatible */
    public static areComponentsCompatible(comp1: C3Component, comp2: C3Component): boolean {
        return comp1.networkType === comp2.networkType;
    }

    /** Validate if a source pin can connect to a target pin */
    public static canConnectToPin(
        sourceNode: C3Node,
        sourceCompIdx: number,
        targetNode: C3Node,
        targetCompIdx: number,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        const sourceComp = sourceNode.c3Components[sourceCompIdx];
        const targetComp = targetNode.c3Components[targetCompIdx];
        if (!sourceComp || !targetComp) return { valid: false, reason: 'Invalid component' };
        
        if (!this.areComponentsCompatible(sourceComp, targetComp)) {
            return { valid: false, reason: 'Incompatible network types' };
        }

        const sourceId = sourceNode.unit.id;
        const targetId = targetNode.unit.id;

        // Same pin
        if (sourceId === targetId && sourceCompIdx === targetCompIdx) {
            return { valid: false, reason: 'Cannot connect pin to itself' };
        }

        // Peer connections
        if (sourceComp.role === C3Role.PEER && targetComp.role === C3Role.PEER) {
            return this.canPeerConnect(sourceId, targetId, sourceComp.networkType, networks);
        }

        // Master to Slave
        if (sourceComp.role === C3Role.MASTER && targetComp.role === C3Role.SLAVE) {
            return this.canSlaveConnectToMaster(sourceNode, sourceCompIdx, targetNode, networks);
        }

        // Slave to Master
        if (sourceComp.role === C3Role.SLAVE && targetComp.role === C3Role.MASTER) {
            return this.canSlaveConnectToMaster(targetNode, targetCompIdx, sourceNode, networks);
        }

        // Master to Master
        if (sourceComp.role === C3Role.MASTER && targetComp.role === C3Role.MASTER) {
            return this.canMasterConnectToMaster(sourceNode, sourceCompIdx, targetNode, targetCompIdx, networks);
        }

        return { valid: false, reason: 'Incompatible connection types' };
    }

    private static canPeerConnect(
        unitId1: string,
        unitId2: string,
        networkType: C3NetworkType,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        const net1 = this.findPeerNetwork(unitId1, networks, networkType);
        const net2 = this.findPeerNetwork(unitId2, networks, networkType);
        
        if (net1 && net2 && net1.type !== net2.type) {
            return { valid: false, reason: 'Incompatible network types' };
        }
        if (net1 && net2 && net1.id === net2.id) {
            return { valid: false, reason: 'Already in same network' };
        }
        
        const limit = C3_NETWORK_LIMITS[networkType];
        const count1 = net1?.peerIds?.length ?? 1;
        const count2 = net2?.peerIds?.length ?? 1;
        
        if (count1 >= limit && count2 >= limit) {
            return { valid: false, reason: `Both networks are at limit of ${limit}` };
        }
        
        return { valid: true };
    }

    private static canSlaveConnectToMaster(
        masterNode: C3Node,
        masterCompIdx: number,
        slaveNode: C3Node,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        const masterId = masterNode.unit.id;
        const slaveId = slaveNode.unit.id;
        if (masterId === slaveId) {
            return { valid: false, reason: 'Cannot connect same unit' };
        }
        
        // if (this.findNetworksContainingUnit(slaveId, networks).length > 0) {
        //     return { valid: false, reason: 'Unit already in a network' };
        // }
        
        if (this.isUnitMasterConnected(slaveId, networks)) {
            return { valid: false, reason: 'Unit Master component is connected' };
        }
        
        if (this.isUnitSlaveConnected(masterId, networks)) {
            return { valid: false, reason: 'Master unit Slave is connected' };
        }

        // The parent has multiple Master components
        if (masterNode.c3Components.length > 1 && masterId !== slaveId) {
            // Check if this node is already connected elsewhere
            const parentMemberStr = this.createMasterMember(masterId, masterCompIdx);
            const parentNetAsMaster = this.findMasterNetwork(masterId, masterCompIdx, networks);
            const parentNetAsMember = networks.find(n => n.members?.includes(parentMemberStr));
            if (!parentNetAsMaster && !parentNetAsMember) {
                // If is not connected, we check if there is another Master component connected
                for (const comp of masterNode.c3Components) {
                    if (comp.role === C3Role.MASTER && comp.index !== masterCompIdx) {
                        // We found another Master component
                        const altMemberStr = this.createMasterMember(masterId, comp.index);
                        const altNetAsMaster = this.findMasterNetwork(masterId, comp.index, networks);
                        const altNetAsMember = networks.find(n => n.members?.includes(altMemberStr));
                        if (altNetAsMaster && altNetAsMaster.members) {
                            const canAutoInternalink = this.canMasterConnectToMaster(masterNode, comp.index, masterNode, masterCompIdx, networks);
                            if (!canAutoInternalink.valid) {
                                return { valid: false, reason: canAutoInternalink.reason };
                            }
                            return { valid: true, reason: 'Master has another Master component and we can auto-link internally' };
                        } else if (altNetAsMember) {
                            return { valid: false, reason: 'Master has another Master component connected' };
                        }
                    }
                }
            }
        }

        const network = this.findMasterNetwork(masterId, masterCompIdx, networks);
        let parentNet: SerializedC3NetworkGroup | undefined;
        if (network) {
            const limit = C3_NETWORK_LIMITS[network.type];
            if ((network.members?.length ?? 0) >= limit) {
                return { valid: false, reason: `Master has max ${limit} children` };
            }
            if (network.members?.some(m => this.isMasterMember(m))) {
                return { valid: false, reason: 'Cannot mix slaves with sub-masters' };
            }
            // Depth check
            const depth = this.getNetworkDepth(network, networks);
            if (depth >= C3_MAX_NETWORK_DEPTH) {
                return { valid: false, reason: `Would exceed depth ${C3_MAX_NETWORK_DEPTH}` };
            }
        } else {
            // Find if master is a member of another network
            const masterMemberStr = this.createMasterMember(masterId, masterCompIdx);
            parentNet = networks.find(n => n.members?.includes(masterMemberStr));
            if (parentNet) {
                const depth = this.getNetworkDepth(parentNet, networks) + 1;
                if (depth >= C3_MAX_NETWORK_DEPTH) {
                    return { valid: false, reason: `Would exceed depth ${C3_MAX_NETWORK_DEPTH}` };
                }
            }
        }

        // Check total network size
        const rootNet = network ? this.getRootNetwork(network, networks) : (parentNet ? this.getRootNetwork(parentNet, networks) : null);
        const currentCount = rootNet ? this.countNetworkTreeUnits(rootNet, networks) : 1;
        if (currentCount + 1 > C3_MAX_NETWORK_TOTAL) {
            return { valid: false, reason: `Would exceed ${C3_MAX_NETWORK_TOTAL} unit limit` };
        }

        return { valid: true };
    }

    private static canMasterConnectToMaster(
        parentNode: C3Node,
        parentCompIdx: number,
        childNode: C3Node,
        childCompIdx: number,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        const parentId = parentNode.unit.id;
        const childId = childNode.unit.id;
        if (parentId === childId && parentCompIdx === childCompIdx) {
            return { valid: false, reason: 'Cannot connect to itself' };
        }
        
        if (this.isUnitSlaveConnected(childId, networks)) {
            return { valid: false, reason: 'Unit Slave component is connected' };
        }
        
        if (this.isUnitSlaveConnected(parentId, networks)) {
            return { valid: false, reason: 'Parent Slave component is connected' };
        }

        // Check capacity/mixing
        const parentNet = this.findMasterNetwork(parentId, parentCompIdx, networks);
        if (parentNet) {
            const limit = C3_NETWORK_LIMITS[parentNet.type];
            if ((parentNet.members?.length ?? 0) >= limit) {
                return { valid: false, reason: `Parent has max ${limit} children` };
            }
            if (parentNet.members?.some(m => !this.isMasterMember(m))) {
                return { valid: false, reason: 'Cannot mix sub-masters with slaves' };
            }
        }
        
        let depthModifierFromAutoLink = 0;
        // The parent has multiple Master components
        if (parentNode.c3Components.length > 1 && parentId !== childId) {
            // Check if this node is already connected elsewhere
            const parentMemberStr = this.createMasterMember(parentId, parentCompIdx);
            const parentNetAsMaster = this.findMasterNetwork(parentId, parentCompIdx, networks);
            const parentNetAsMember = networks.find(n => n.members?.includes(parentMemberStr));
            if (!parentNetAsMaster && !parentNetAsMember) {
                // If is not connected, we check if there is another Master component connected
                for (const comp of parentNode.c3Components) {
                    if (comp.role === C3Role.MASTER && comp.index !== parentCompIdx) {
                        // We found another Master component
                        const altMemberStr = this.createMasterMember(parentId, comp.index);
                        const altNetAsMaster = this.findMasterNetwork(parentId, comp.index, networks);
                        const altNetAsMember = networks.find(n => n.members?.includes(altMemberStr));
                        if (altNetAsMaster && altNetAsMaster.members) {
                            const canAutoInternalink = this.canMasterConnectToMaster(parentNode, comp.index, parentNode, parentCompIdx, networks);
                            if (!canAutoInternalink.valid) {
                                return { valid: false, reason: canAutoInternalink.reason };
                            }
                            depthModifierFromAutoLink++;
                            // return { valid: true, reason: 'Master has another Master component and we can auto-link internally' };
                        } else if (altNetAsMember) {
                            return { valid: false, reason: 'Master has another Master component connected' };
                        }
                    }
                }
            }
        }
        // The child has multiple Master components
        if (childNode.c3Components.length > 1 && parentId !== childId) {
            // If one of the OTHER components is already connected and our child component is not connected, block the connection
            const childMemberStr = this.createMasterMember(childId, childCompIdx);
            const childNetAsMaster = this.findMasterNetwork(childId, childCompIdx, networks);
            const childNetAsMember = networks.find(n => n.members?.includes(childMemberStr));
            const childPinConnected = childNetAsMaster !== null || childNetAsMember !== undefined;

            if (!childPinConnected) {
                // Our pin is not connected - check if any OTHER master pin is connected
                for (const comp of childNode.c3Components) {
                    if (comp.role === C3Role.MASTER && comp.index !== childCompIdx) {
                        const altMemberStr = this.createMasterMember(childId, comp.index);
                        const altNetAsMaster = this.findMasterNetwork(childId, comp.index, networks);
                        const altNetAsMember = networks.find(n => n.members?.includes(altMemberStr));
                        if (altNetAsMaster || altNetAsMember) {
                            return { valid: false, reason: 'Must connect via already-connected pin' };
                        }
                    }
                }
            }
        }

        // const childMemberKey = this.createMasterMember(childId, childCompIdx);
        // const existingParentForChild = networks.find(n => n.members?.includes(childMemberKey));
        // if (existingParentForChild) {
        //     return { valid: false, reason: 'Child already has a parent' };
        // }
        

        const childNet = this.findMasterNetwork(childId, childCompIdx, networks);
        if (childNet && this.findParentNetwork(childNet, networks)) {
            return { valid: false, reason: 'Child already in hierarchy' };
        }

        // Check depth
        let parentDepth = 0;
        if (parentNet) {
            parentDepth = this.getNetworkDepth(parentNet, networks);
        } else {
            const parentMemberStr = this.createMasterMember(parentId, parentCompIdx);
            const grandParent = networks.find(n => n.members?.includes(parentMemberStr));
            if (grandParent) {
                parentDepth = this.getNetworkDepth(grandParent, networks) + 1;
            }
        }
        if (parentDepth + depthModifierFromAutoLink >= C3_MAX_NETWORK_DEPTH) {
            return { valid: false, reason: `Would exceed parent depth ${C3_MAX_NETWORK_DEPTH}` };
        }

        const childSubDepth = childNet ? 1 + this.getSubTreeDepth(childNet, networks) : 0;

        if (parentDepth + 1 + depthModifierFromAutoLink + childSubDepth > C3_MAX_NETWORK_DEPTH) {
            return { valid: false, reason: `Would exceed depth ${C3_MAX_NETWORK_DEPTH}` };
        }
        // Check total size
        const parentRootNet = parentNet ? this.getRootNetwork(parentNet, networks) : null;
        const parentTreeCount = parentRootNet ? this.countNetworkTreeUnits(parentRootNet, networks) : 1;
        const childTreeCount = childNet ? this.countNetworkTreeUnits(childNet, networks) : 1;
        if (parentTreeCount + childTreeCount > C3_MAX_NETWORK_TOTAL) {
            return { valid: false, reason: `Would exceed ${C3_MAX_NETWORK_TOTAL} unit limit` };
        }

        return { valid: true };
    }

    // ==================== Network Mutation ====================

    /** Create a connection between two pins */
    public static createConnection(
        ctx: C3NetworkContext,
        sourceNode: C3Node,
        sourceCompIdx: number,
        targetNode: C3Node,
        targetCompIdx: number
    ): NetworkMutationResult {
        const sourceComp = sourceNode.c3Components[sourceCompIdx];
        const targetComp = targetNode.c3Components[targetCompIdx];
        if (!sourceComp || !targetComp) {
            return { networks: ctx.networks, success: false, message: 'Invalid components' };
        }

        if (sourceComp.role === C3Role.PEER) {
            return this.createPeerConnection(ctx, sourceNode, targetNode, sourceComp.networkType);
        }

        if (sourceComp.role === C3Role.MASTER && targetComp.role === C3Role.SLAVE) {
            return this.addMemberToMaster(ctx, sourceNode, sourceCompIdx, targetNode.unit.id);
        }

        if (sourceComp.role === C3Role.SLAVE && targetComp.role === C3Role.MASTER) {
            return this.addMemberToMaster(ctx, targetNode, targetCompIdx, sourceNode.unit.id);
        }

        if (sourceComp.role === C3Role.MASTER && targetComp.role === C3Role.MASTER) {
            // Check if already in master-child relationship
            if (this.isChildOfMaster(ctx.networks, sourceNode.unit.id, sourceCompIdx, targetNode.unit.id, targetCompIdx)
            || this.isChildOfMaster(ctx.networks, targetNode.unit.id, targetCompIdx, sourceNode.unit.id, sourceCompIdx)) {
                return { networks: ctx.networks, success: false, message: 'Already connected' };
            }
            return this.addMemberToMaster(ctx, sourceNode, sourceCompIdx, targetNode.unit.id, targetCompIdx);
        }

        return { networks: ctx.networks, success: false, message: 'Incompatible roles' };
    }

    /** Create or merge peer networks */
    private static createPeerConnection(
        ctx: C3NetworkContext,
        node1: C3Node,
        node2: C3Node,
        networkType: C3NetworkType
    ): NetworkMutationResult {
        const networks = [...ctx.networks];
        const net1 = this.findPeerNetwork(node1.unit.id, networks, networkType);
        const net2 = this.findPeerNetwork(node2.unit.id, networks, networkType);
        const limit = C3_NETWORK_LIMITS[networkType];

        const removeFromNetwork = (unitId: string, net: SerializedC3NetworkGroup | null) => {
            if (!net) return;
            const idx = networks.findIndex(n => n.id === net.id);
            if (idx < 0) return;
            networks[idx] = {
                ...networks[idx],
                peerIds: networks[idx].peerIds?.filter(id => id !== unitId)
            };
            if ((networks[idx].peerIds?.length ?? 0) < 2) {
                networks.splice(idx, 1);
            }
        };

        const addToNetwork = (unitId: string, net: SerializedC3NetworkGroup) => {
            const idx = networks.findIndex(n => n.id === net.id);
            if (idx >= 0 && !networks[idx].peerIds?.includes(unitId)) {
                networks[idx] = {
                    ...networks[idx],
                    peerIds: [...(networks[idx].peerIds ?? []), unitId]
                };
            }
        };

        // Both in networks - try to merge
        if (net1 && net2 && net1.id !== net2.id) {
            const total = (net1.peerIds?.length ?? 0) + (net2.peerIds?.length ?? 0);
            if (total <= limit) {
                // Merge net2 into net1
                const merged = new Set([...(net1.peerIds ?? []), ...(net2.peerIds ?? [])]);
                const idx1 = networks.findIndex(n => n.id === net1.id);
                const idx2 = networks.findIndex(n => n.id === net2.id);
                // We make net2 the surviving network to preserve color
                networks[idx2] = {
                    ...networks[idx2],
                    peerIds: [...merged]
                };
                networks.splice(idx1, 1);
                return { networks, success: true, message: 'Networks merged' };
            }
        }

        // Add node1 to net2 if possible
        if (net2 && (net2.peerIds?.length ?? 0) < limit) {
            removeFromNetwork(node1.unit.id, net1);
            addToNetwork(node1.unit.id, net2);
            return { networks, success: true, message: 'Peer connected' };
        }

        // Add node2 to net1 if possible
        if (net1 && (net1.peerIds?.length ?? 0) < limit) {
            removeFromNetwork(node2.unit.id, net2);
            addToNetwork(node2.unit.id, net1);
            return { networks, success: true, message: 'Peer connected' };
        }

        // Create new network
        removeFromNetwork(node1.unit.id, net1);
        removeFromNetwork(node2.unit.id, net2);
        networks.push({
            id: uuidv7(),
            type: networkType,
            color: ctx.getNextColor(),
            peerIds: [node1.unit.id, node2.unit.id]
        });

        return { networks, success: true, message: 'Peer network created' };
    }

    /** Add a member (slave or sub-master) to a master's network */
    private static addMemberToMaster(
        ctx: C3NetworkContext,
        masterNode: C3Node,
        masterCompIdx: number,
        memberId: string,
        memberCompIdx?: number
    ): NetworkMutationResult {
        let networks = [...ctx.networks];
        const masterComp = masterNode.c3Components[masterCompIdx];
        const memberStr = memberCompIdx !== undefined
            ? this.createMasterMember(memberId, memberCompIdx)
            : memberId;

        // Find or create the network
        let network = this.findMasterNetwork(masterNode.unit.id, masterCompIdx, networks);
        let networkIdx = networks.findIndex(n => n.id === network?.id);

        if (!network) {
            // The parent has multiple Master components
            if (masterNode.c3Components.length > 1 && masterNode.unit.id !== memberId) {
                // It has no network and has multiple Master components
                // We check if there is another Master component connected
                for (const comp of masterNode.c3Components) {
                    if (comp.role === C3Role.MASTER && comp.index !== masterCompIdx) {
                        // We found another Master component
                        const altMemberStr = this.createMasterMember(masterNode.unit.id, comp.index);
                        const altNetAsMaster = this.findMasterNetwork(masterNode.unit.id, comp.index, networks);
                        const altNetAsMember = networks.find(n => n.members?.includes(altMemberStr));
                        if (altNetAsMaster && altNetAsMaster.members) {
                            const canAutoInternalink = this.canMasterConnectToMaster(masterNode, comp.index, masterNode, masterCompIdx, networks);
                            if (!canAutoInternalink.valid) {
                                continue;
                            }
                            const result = this.addMemberToMaster(ctx, masterNode, comp.index, masterNode.unit.id, masterCompIdx);
                            networks = result.networks;
                            break;
                        } else if (altNetAsMember) {
                            continue;
                        }
                    }
                }
            }
        }

        if (!network) {
            const pinKey = `${masterNode.unit.id}:${masterCompIdx}`;
            const color = ctx.masterPinColors?.get(pinKey) ?? ctx.getNextColor();
            network = {
                id: uuidv7(),
                type: masterComp.networkType,
                color,
                masterId: masterNode.unit.id,
                masterCompIndex: masterCompIdx,
                members: []
            };
            networks.push(network);
            networkIdx = networks.length - 1;
        }

        // Remove member from any existing network
        for (let i = 0; i < networks.length; i++) {
            if (networks[i].members) {
                networks[i] = {
                    ...networks[i],
                    members: networks[i].members!.filter(m => this.parseMember(m).unitId !== memberId)
                };
            }
        }

        // Re-find network after modifications
        networkIdx = networks.findIndex(n => n.id === network!.id);
        if (networkIdx < 0) {
            networks.push(network);
            networkIdx = networks.length - 1;
        }

        // Add the member
        const currentMembers = networks[networkIdx].members ?? [];
        if (!currentMembers.includes(memberStr)) {
            networks[networkIdx] = {
                ...networks[networkIdx],
                members: [...currentMembers, memberStr]
            };
        }

        // Clean up empty networks
        const filtered = networks.filter(n => 
            (n.peerIds && n.peerIds.length > 0) ||
            (n.masterId && (n.members?.length ?? 0) > 0) ||
            n.id === networks[networkIdx].id
        );

        return { networks: filtered, success: true, message: 'Member added' };
    }

    /** Check if a master is a child of another master */
    private static isChildOfMaster(
        networks: SerializedC3NetworkGroup[],
        childId: string,
        childCompIdx: number,
        parentId: string,
        parentCompIdx: number
    ): boolean {
        const parentNet = this.findMasterNetwork(parentId, parentCompIdx, networks);
        if (!parentNet?.members) return false;
        const childMemberStr = this.createMasterMember(childId, childCompIdx);
        return parentNet.members.includes(childMemberStr);
    }

    /** Remove a master child from a parent network */
    private static removeChildFromMaster(
        networks: SerializedC3NetworkGroup[],
        parentId: string,
        parentCompIdx: number,
        childId: string,
        childCompIdx: number
    ): NetworkMutationResult {
        const result = [...networks];
        const childMemberStr = this.createMasterMember(childId, childCompIdx);
        const parentIdx = result.findIndex(n => 
            n.masterId === parentId && n.masterCompIndex === parentCompIdx
        );

        if (parentIdx >= 0 && result[parentIdx].members) {
            result[parentIdx] = {
                ...result[parentIdx],
                members: result[parentIdx].members!.filter(m => m !== childMemberStr)
            };
            if (result[parentIdx].members!.length === 0) {
                result.splice(parentIdx, 1);
            }
        }

        return { networks: result, success: true };
    }

    /** Remove a member from a network */
    public static removeMemberFromNetwork(
        networks: SerializedC3NetworkGroup[],
        networkId: string,
        memberStr: string
    ): NetworkMutationResult {
        const result = [...networks];
        const idx = result.findIndex(n => n.id === networkId);
        if (idx < 0 || !result[idx].members) {
            return { networks: result, success: false, message: 'Network not found' };
        }

        // Get the network's masterId before modifying
        const networkMasterId = result[idx].masterId;
        result[idx] = {
            ...result[idx],
            members: result[idx].members!.filter(m => m !== memberStr)
        };
        if (result[idx].members!.length === 0) {
            result.splice(idx, 1);
        }
        if (this.isMasterMember(memberStr)) {
            const { unitId, compIndex } = this.parseMember(memberStr);
            // Check if this is an internal link (member's unitId equals network's masterId)
            if (compIndex !== undefined && unitId === networkMasterId) {
                // If it was an internal link, we have to dissolve also the subnetwork if any
                const subnetwork = this.findMasterNetwork(unitId, compIndex, result);
                if (subnetwork) {
                    result.splice(result.findIndex(n => n.id === subnetwork.id), 1);
                }
            }
        }

        return { networks: result, success: true };
    }

    /** Remove a unit from a peer network */
    public static removeUnitFromPeerNetwork(
        networks: SerializedC3NetworkGroup[],
        unitId: string,
        networkType?: C3NetworkType,
    ): NetworkMutationResult {
        const result = [...networks];
        const net = this.findPeerNetwork(unitId, result, networkType);
        if (!net) return { networks: result, success: false, message: 'Unit not in peer network' };

        const idx = result.findIndex(n => n.id === net.id);
        if (idx < 0) return { networks: result, success: false };

        result[idx] = {
            ...result[idx],
            peerIds: result[idx].peerIds?.filter(id => id !== unitId)
        };

        if ((result[idx].peerIds?.length ?? 0) < 2) {
            result.splice(idx, 1);
        }

        return { networks: result, success: true };
    }

    /** Remove a unit from all networks it participates in (as master, slave, peer, or sub-master) */
    public static removeUnitFromAllNetworks(
        networks: SerializedC3NetworkGroup[],
        unitId: string
    ): NetworkMutationResult {
        let result = [...networks];

        // 1. Remove networks where this unit is the master (including sub-networks)
        const networksToRemove = new Set<string>();
        for (const net of result) {
            if (net.masterId !== unitId) continue;

            for (const treeNet of this.collectNetworkTree(net, result)) {
                networksToRemove.add(treeNet.id);
            }
        }
        result = result.filter(n => !networksToRemove.has(n.id));

        // 2. Remove unit from peer networks
        for (let i = 0; i < result.length; i++) {
            if (result[i].peerIds?.includes(unitId)) {
                result[i] = {
                    ...result[i],
                    peerIds: result[i].peerIds!.filter(id => id !== unitId)
                };
            }
        }

        // 3. Remove unit from member lists (as slave or sub-master)
        for (let i = 0; i < result.length; i++) {
            if (result[i].members) {
                const filteredMembers = result[i].members!.filter(m => {
                    const { unitId: memberId } = this.parseMember(m);
                    return memberId !== unitId;
                });
                if (filteredMembers.length !== result[i].members!.length) {
                    result[i] = { ...result[i], members: filteredMembers };
                }
            }
        }

        // 4. Clean up empty/invalid networks
        result = result.filter(n => {
            // Peer networks need at least 2 members
            if (n.peerIds) return n.peerIds.length >= 2;
            // Master networks need at least 1 member
            if (n.masterId) return (n.members?.length ?? 0) > 0;
            return false;
        });

        return { networks: result, success: true };
    }

    /** Find connection between two pins */
    public static findConnectionBetweenPins(
        networks: SerializedC3NetworkGroup[],
        sourceId: string,
        sourceCompIdx: number,
        sourceRole: C3Role,
        targetId: string,
        targetCompIdx: number,
        targetRole: C3Role,
        networkType?: C3NetworkType
    ): { networkId: string; memberStr?: string } | null {
        // Master -> Slave
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.SLAVE) {
            const net = this.findMasterNetwork(sourceId, sourceCompIdx, networks);
            if (net?.members?.includes(targetId)) {
                return { networkId: net.id, memberStr: targetId };
            }
        }

        // Slave -> Master
        if (sourceRole === C3Role.SLAVE && targetRole === C3Role.MASTER) {
            const net = this.findMasterNetwork(targetId, targetCompIdx, networks);
            if (net?.members?.includes(sourceId)) {
                return { networkId: net.id, memberStr: sourceId };
            }
        }

        // Master -> Master
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.MASTER) {
            const memberStr = this.createMasterMember(targetId, targetCompIdx);
            const net = this.findMasterNetwork(sourceId, sourceCompIdx, networks);
            if (net?.members?.includes(memberStr)) {
                return { networkId: net.id, memberStr };
            }
            // Check reverse
            const reverseStr = this.createMasterMember(sourceId, sourceCompIdx);
            const reverseNet = this.findMasterNetwork(targetId, targetCompIdx, networks);
            if (reverseNet?.members?.includes(reverseStr)) {
                return { networkId: reverseNet.id, memberStr: reverseStr };
            }
        }

        // Peer -> Peer
        if (sourceRole === C3Role.PEER && targetRole === C3Role.PEER && sourceId !== targetId) {
            const net = this.findPeerNetwork(sourceId, networks, networkType);
            if (net?.peerIds?.includes(targetId)) {
                return { networkId: net.id };
            }
        }

        return null;
    }

    /** Cancel existing connection for a pin */
    public static cancelConnectionForPin(
        networks: SerializedC3NetworkGroup[],
        unitId: string,
        compIdx: number,
        role: C3Role,
        networkType?: C3NetworkType,
    ): NetworkMutationResult {
        const result = [...networks];

        if (role === C3Role.SLAVE) {
            const net = result.find(n => n.members?.includes(unitId));
            if (net) {
                return this.removeMemberFromNetwork(result, net.id, unitId);
            }
        }
        if (role === C3Role.MASTER) {
            const memberStr = this.createMasterMember(unitId, compIdx);
            const net = result.find(n => n.members?.includes(memberStr));
            if (net) {
                return this.removeMemberFromNetwork(result, net.id, memberStr);
            }
        }

        if (role === C3Role.PEER) {
            const peerNetwork = this.findPeerNetwork(unitId, result, networkType);
            return peerNetwork
                ? this.removeUnitFromPeerNetwork(result, unitId, peerNetwork.type)
                : { networks: result, success: false, message: 'No connection found' };
        }

        return { networks: result, success: false, message: 'No connection found' };
    }

    // ==================== Display Helpers ====================

    public static getNetworkTypeName(type: C3NetworkType): string {
        switch (type) {
            case C3NetworkType.C3: return 'C³';
            case C3NetworkType.C3I: return 'C³i';
            case C3NetworkType.NAVAL: return 'Naval C³';
            case C3NetworkType.NOVA: return 'Nova';
            default: return 'Unknown';
        }
    }

    public static getRoleName(role: C3Role): string {
        switch (role) {
            case C3Role.MASTER: return 'M';
            case C3Role.SLAVE: return 'S';
            case C3Role.PEER: return 'P';
            default: return '?';
        }
    }

    // ==================== Tax Calculation ====================

    public static calculateCore2026UnitC3Tax(
        unit: CBTForceUnit,
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[]
    ): number {
        const novaTax = this.calculateNovaC3Tax(unit, allUnits);
        if (novaTax !== null) return novaTax;

        const participatingNets = this.findNetworksContainingUnit(unit.id, networks);
        if (participatingNets.length === 0) return 0;
        const rootNet = this.getRootNetwork(participatingNets[0], networks);
        const networkedUnits = this.getNetworkTreeUnits(rootNet, networks, allUnits);
        if (networkedUnits.length < 2) return 0;

        const networkTaxRate = Math.min(0.4, networkedUnits.length * C3_TAX_RATE);
        const hasBoosted = this.getC3Components(unit).some(component => component.boosted);
        const unitTaxRate = networkTaxRate + (hasBoosted ? C3_TAX_RATE : 0);
        return Math.round((unit.getBaseBv() + unit.tagBV()) * unitTaxRate);
    }

    public static calculateTWUnitC3Tax(
        unit: CBTForceUnit,
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[]
    ): number {
        const novaTax = this.calculateNovaC3Tax(unit, allUnits);
        if (novaTax !== null) return novaTax;

        const participatingNets = this.findNetworksContainingUnit(unit.id, networks);
        if (participatingNets.length === 0) return 0;
        const rootNet = this.getRootNetwork(participatingNets[0], networks);
        const networkedUnits = this.getNetworkTreeUnits(rootNet, networks, allUnits);
        if (networkedUnits.length < 2) return 0; // No tax for single unit

        const hasBoosted = this.getC3Components(unit).some(c => c.boosted);
        const taxRate = hasBoosted ? C3_BOOSTED_TAX_RATE : C3_TAX_RATE;
        const networkTotalBv = networkedUnits.reduce((sum, u) => sum + u.getBaseBv() + u.tagBV(), 0);
        return Math.round(networkTotalBv * taxRate);
    }

    private static calculateNovaC3Tax(unit: CBTForceUnit, allUnits: CBTForceUnit[]): number | null {
        const c3Comps = this.getC3Components(unit);
        if (!c3Comps.some(component => component.networkType === C3NetworkType.NOVA)) return null;

        const unitsCountWithNovaCews = allUnits.filter(candidate =>
            this.getC3Components(candidate).some(component => component.networkType === C3NetworkType.NOVA)
        ).length;
        if (unitsCountWithNovaCews < 2) return 0;
        const baseForceBV = allUnits.reduce((sum, candidate) => sum + candidate.getBaseBv() + candidate.tagBV(), 0);
        const taxRate = Math.min(unitsCountWithNovaCews * C3_TAX_RATE, NOVA_MAX_TAX_RATE);
        return Math.round((baseForceBV * taxRate) / unitsCountWithNovaCews);
    }

    /** Get all unique units in a network tree (including sub-networks) */
    private static getNetworkTreeUnits(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[]
    ): CBTForceUnit[] {
        const unitIds = new Set<string>();

        for (const net of this.collectNetworkTree(network, allNetworks)) {
            for (const id of this.getNetworkUnitIds(net)) unitIds.add(id);
        }

        const unitMap = new Map(allUnits.map(u => [u.id, u]));
        const result: CBTForceUnit[] = [];
        for (const id of unitIds) {
            const u = unitMap.get(id);
            if (u) result.push(u);
        }
        return result;
    }

    // ==================== Color Management ====================

    /** Get the next best color (least used) */
    public static getNextColor(
        networks: SerializedC3NetworkGroup[],
        usedColors?: Map<string, string>
    ): string {
        const colorUsage = new Map<string, number>();
        for (const color of C3_NETWORK_COLORS) colorUsage.set(color, 0);
        
        for (const net of networks) {
            colorUsage.set(net.color, (colorUsage.get(net.color) ?? 0) + 1);
        }
        
        if (usedColors) {
            for (const color of usedColors.values()) {
                colorUsage.set(color, (colorUsage.get(color) ?? 0) + 1);
            }
        }

        let leastUsed: string = C3_NETWORK_COLORS[0];
        let leastCount = Infinity;
        for (const [color, count] of colorUsage) {
            if (count < leastCount) {
                leastCount = count;
                leastUsed = color;
            }
        }
        return leastUsed;
    }

    // ==================== Validation & Cleanup ====================

    public static validateAndCleanNetworks(
        networks: SerializedC3NetworkGroup[],
        unitMap: Map<string, ForceUnit>
    ): SerializedC3NetworkGroup[] {
        if (!networks || networks.length === 0) return [];

        const unitC3Map = new Map<string, C3Component[]>();
        for (const [id, unit] of unitMap) {
            const c3Comps = this.getC3Components(unit);
            if (c3Comps.length > 0) unitC3Map.set(id, c3Comps);
        }

        let cleaned: SerializedC3NetworkGroup[] = [];
        for (const network of networks) {
            const validated = this.validateNetwork(network, unitMap, unitC3Map);
            if (validated) cleaned.push(validated);
        }

        cleaned = this.validateNetworkDepth(cleaned);
        cleaned = this.validateNetworkTotalUnits(cleaned);
        cleaned = this.validateMemberTypeHomogeneity(cleaned);
        cleaned = this.validateUnitSingleNetworkTree(cleaned);
        return cleaned;
    }

    private static validateNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, ForceUnit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (!Object.values(C3NetworkType).includes(network.type)) return null;
        if (network.peerIds && network.peerIds.length > 0) {
            if (network.type === C3NetworkType.C3 || network.masterId !== undefined) return null;
            return this.validatePeerNetwork(network, unitMap, unitC3Map);
        }
        if (network.masterId !== undefined) {
            if (network.type !== C3NetworkType.C3) return null;
            return this.validateC3MasterNetwork(network, unitMap, unitC3Map);
        }
        return null;
    }

    private static validatePeerNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, ForceUnit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (!network.peerIds) return null;
        const networkType = network.type;
        const validPeerIds = new Set<string>();

        for (const peerId of network.peerIds) {
            if (!unitMap.has(peerId)) continue;
            const c3Comps = unitC3Map.get(peerId);
            if (!c3Comps) continue;
            if (c3Comps.some(c => c.role === C3Role.PEER && c.networkType === networkType)) {
                validPeerIds.add(peerId);
            }
        }

        if (validPeerIds.size < 2) return null;
        const limit = C3_NETWORK_LIMITS[networkType];
        if (limit === undefined) return null;
        return {
            id: network.id,
            type: network.type,
            color: network.color,
            peerIds: [...validPeerIds].slice(0, limit),
        };
    }

    private static validateC3MasterNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, ForceUnit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (network.masterId === undefined || network.masterCompIndex === undefined) return null;
        if (!unitMap.has(network.masterId)) return null;

        const masterC3Comps = unitC3Map.get(network.masterId);
        if (!masterC3Comps?.some(c => c.index === network.masterCompIndex
            && c.role === C3Role.MASTER
            && c.networkType === network.type)) {
            return null;
        }

        // First pass: collect valid members by type
        const validMasterMembers: string[] = [];
        const validSlaveMembers: string[] = [];

        for (const member of network.members ?? []) {
            const { unitId, compIndex } = this.parseMember(member);
            if (!unitMap.has(unitId)) continue;
            const memberC3 = unitC3Map.get(unitId);
            if (!memberC3) continue;

            if (compIndex !== undefined) {
                // Master member (sub-master)
                if (memberC3.some(c => c.index === compIndex
                    && c.role === C3Role.MASTER
                    && c.networkType === network.type)) {
                    validMasterMembers.push(member);
                }
            } else {
                // Slave member
                if (memberC3.some(c => c.role === C3Role.SLAVE && c.networkType === network.type)) {
                    validSlaveMembers.push(member);
                }
            }
        }

        // If mixed, keep the majority type
        let validMembers: string[];
        if (validMasterMembers.length > 0 && validSlaveMembers.length > 0) {
            validMembers = validMasterMembers.length >= validSlaveMembers.length 
                ? validMasterMembers 
                : validSlaveMembers;
        } else {
            validMembers = [...validMasterMembers, ...validSlaveMembers];
        }

        validMembers = [...new Set(validMembers)];
        if (validMembers.length === 0) return null;
        const limit = C3_NETWORK_LIMITS[network.type];
        return {
            id: network.id,
            type: network.type,
            color: network.color,
            masterId: network.masterId,
            masterCompIndex: network.masterCompIndex,
            members: validMembers.slice(0, limit),
        };
    }

    private static validateNetworkDepth(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        const membersToRemove = new Map<string, Set<string>>();

        for (const network of networks) {
            if (network.peerIds) continue;
            if (this.getNetworkDepth(network, networks) >= C3_MAX_NETWORK_DEPTH) {
                const parent = this.findParentNetwork(network, networks);
                if (parent) {
                    const memberStr = this.createMasterMember(network.masterId!, network.masterCompIndex!);
                    if (!membersToRemove.has(parent.id)) membersToRemove.set(parent.id, new Set());
                    membersToRemove.get(parent.id)!.add(memberStr);
                }
            }
        }

        return networks
            .map(n => {
                const toRemove = membersToRemove.get(n.id);
                if (!toRemove || !n.members) return n;
                const filtered = n.members.filter(m => !toRemove.has(m));
                return filtered.length > 0 ? { ...n, members: filtered } : null;
            })
            .filter((n): n is SerializedC3NetworkGroup => n !== null);
    }

    private static validateNetworkTotalUnits(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        let result = [...networks];
        let changed = true;

        while (changed) {
            changed = false;
            for (const rootNet of this.getTopLevelNetworks(result)) {
                if (rootNet.peerIds) continue;
                if (this.countNetworkTreeUnits(rootNet, result) > C3_MAX_NETWORK_TOTAL) {
                    const removed = this.removeOneSubNetworkConnection(rootNet, result);
                    if (removed) {
                        result = removed;
                        changed = true;
                        break;
                    }
                }
            }
        }
        return result;
    }

    private static removeOneSubNetworkConnection(
        rootNet: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] | null {
        const findMasterMember = (net: SerializedC3NetworkGroup): { networkId: string; member: string } | null => {
            if (!net.members) return null;
            for (let i = net.members.length - 1; i >= 0; i--) {
                if (this.isMasterMember(net.members[i])) {
                    return { networkId: net.id, member: net.members[i] };
                }
            }
            for (const member of net.members) {
                if (this.isMasterMember(member)) {
                    const { unitId, compIndex } = this.parseMember(member);
                    const subNet = this.findMasterNetwork(unitId, compIndex!, allNetworks);
                    if (subNet) {
                        const found = findMasterMember(subNet);
                        if (found) return found;
                    }
                }
            }
            return null;
        };

        const toRemove = findMasterMember(rootNet);
        if (!toRemove) return null;

        return allNetworks
            .map(n => {
                if (n.id !== toRemove.networkId || !n.members) return n;
                const filtered = n.members.filter(m => m !== toRemove.member);
                return filtered.length > 0 ? { ...n, members: filtered } : null;
            })
            .filter((n): n is SerializedC3NetworkGroup => n !== null && !(!n.peerIds && n.members?.length === 0));
    }

    /**
     * Validates that each master network has homogeneous member types.
     * All direct members must be either all masters (sub-masters) or all slaves.
     * If mixed, keeps the type that has more members (majority wins).
     */
    private static validateMemberTypeHomogeneity(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        return networks
            .map(network => {
                // Only check master networks with members
                if (!network.masterId || !network.members || network.members.length === 0) {
                    return network;
                }

                // Count each type
                const masterMembers = network.members.filter(m => this.isMasterMember(m));
                const slaveMembers = network.members.filter(m => !this.isMasterMember(m));

                // If no mixing, return as-is
                if (masterMembers.length === 0 || slaveMembers.length === 0) {
                    return network;
                }

                // Keep the majority type (slaves win ties since they're more common)
                const keepMasters = masterMembers.length > slaveMembers.length;
                const homogeneousMembers = keepMasters ? masterMembers : slaveMembers;

                return { ...network, members: homogeneousMembers };
            })
            .filter((n): n is SerializedC3NetworkGroup => n !== null);
    }

    /**
     * Validates that each unit with multiple pins belongs to only ONE network tree.
     * If a unit's pins are connected to different root networks, keep only the first
     * pin's connection and disconnect all others.
     */
    private static validateUnitSingleNetworkTree(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        let result = [...networks];
        
        // A unit may participate independently in different C3 network types.
        const unitNetworkCount = new Map<string, number>();
        for (const net of result) {
            for (const id of this.getNetworkUnitIds(net)) {
                const key = `${id}\u0000${net.type}`;
                unitNetworkCount.set(key, (unitNetworkCount.get(key) ?? 0) + 1);
            }
        }

        // Only check units that appear in multiple trees of the same type.
        for (const [unitTypeKey, count] of unitNetworkCount) {
            if (count <= 1) continue;
            const separatorIndex = unitTypeKey.lastIndexOf('\u0000');
            const unitId = unitTypeKey.slice(0, separatorIndex);
            const networkType = unitTypeKey.slice(separatorIndex + 1) as C3NetworkType;

            const containingNetworks = this.findNetworksContainingUnit(unitId, result)
                .filter(network => network.type === networkType);
            if (containingNetworks.length <= 1) continue;

            // Get unique root network IDs
            const rootIds = new Set(containingNetworks.map(net => this.getRootNetwork(net, result).id));
            if (rootIds.size <= 1) continue;

            // Multiple root networks - disconnect from all except the first
            const firstRootId = this.getRootNetwork(containingNetworks[0], result).id;
            
            for (const network of containingNetworks) {
                if (this.getRootNetwork(network, result).id === firstRootId) continue;

                if (network.masterId === unitId) {
                    // Remove entire network tree where unit is master
                    const toRemove = new Set<string>();

                    for (const treeNet of this.collectNetworkTree(network, result)) {
                        toRemove.add(treeNet.id);
                    }

                    result = result.filter(n => !toRemove.has(n.id));
                } else if (network.peerIds?.includes(unitId)) {
                    const idx = result.findIndex(n => n.id === network.id);
                    if (idx >= 0) {
                        result[idx] = { ...result[idx], peerIds: result[idx].peerIds!.filter(id => id !== unitId) };
                    }
                } else if (network.members) {
                    const idx = result.findIndex(n => n.id === network.id);
                    if (idx >= 0) {
                        result[idx] = { ...result[idx], members: result[idx].members!.filter(m => this.parseMember(m).unitId !== unitId) };
                    }
                }
            }

            // Clean up empty networks
            result = result.filter(n => 
                (n.peerIds && n.peerIds.length >= 2) || 
                (n.masterId && (n.members?.length ?? 0) > 0)
            );
        }

        return result;
    }
}
