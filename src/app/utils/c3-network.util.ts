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

import { ForceUnit } from '../models/force-unit.model';
import { Unit, UnitComponent } from '../models/units.model';
import {
    C3Component,
    C3NetworkType,
    C3Node,
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
    C3_NETWORK_COLORS
} from '../models/c3-network.model';
import { SerializedC3NetworkGroup } from '../models/force-serialization';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { generateUUID } from '../services/ws.service';

/** Result of a network mutation operation */
export interface NetworkMutationResult {
    networks: SerializedC3NetworkGroup[];
    success: boolean;
    message?: string;
}

/** Context for network operations using C3Nodes */
export interface C3NetworkContext {
    networks: SerializedC3NetworkGroup[];
    nodesById: Map<string, C3Node>;
    /** Function to get the next available color */
    getNextColor: () => string;
    /** Pre-assigned colors for master pins */
    masterPinColors?: Map<string, string>;
}

/**
 * C3 Network Utility - Simplified API using C3Node
 */
export class C3NetworkUtil {

    // ==================== Component Detection ====================

    /** Check if a component has any C3 equipment flag */
    public static hasC3Flag(component: UnitComponent): boolean {
        if (!component.eq?.flags) return false;
        return ALL_C3_FLAGS.some(flag => component.eq!.flags.has(flag));
    }

    /** Get the C3 network type for a component */
    public static getNetworkType(component: UnitComponent): C3NetworkType | null {
        if (!component.eq?.flags) return null;
        for (const network of C3_COMPATIBLE_NETWORKS) {
            if (network.flags.some(flag => component.eq!.flags.has(flag))) {
                return network.type;
            }
        }
        return null;
    }

    /** Get the C3 role for a component */
    public static getRole(component: UnitComponent): C3Role | null {
        if (!component.eq?.flags) return null;
        if (C3_MASTER_FLAGS.some(flag => component.eq!.flags.has(flag))) return C3Role.MASTER;
        if (C3_SLAVE_FLAGS.some(flag => component.eq!.flags.has(flag))) return C3Role.SLAVE;
        if (C3_PEER_FLAGS.some(flag => component.eq!.flags.has(flag))) return C3Role.PEER;
        return null;
    }

    /** Check if a component is boosted C3 */
    public static isBoosted(component: UnitComponent): boolean {
        if (!component.eq?.flags) return false;
        return C3_BOOSTED_FLAGS.some(flag => component.eq!.flags.has(flag));
    }

    /** Get all C3 components from a unit */
    public static getC3Components(unit: Unit): C3Component[] {
        const components: C3Component[] = [];
        let index = 0;
        for (const comp of unit.comp) {
            if (this.hasC3Flag(comp)) {
                const networkType = this.getNetworkType(comp);
                const role = this.getRole(comp);
                if (networkType && role) {
                    components.push({
                        component: comp,
                        networkType,
                        role,
                        boosted: this.isBoosted(comp),
                        index: index++
                    });
                }
            }
        }
        return components;
    }

    /** Check if a unit has any C3 capability */
    public static hasC3(unit: Unit): boolean {
        return unit.comp.some(comp => this.hasC3Flag(comp));
    }

    // ==================== Network Queries ====================

    /** Find a peer network containing a unit */
    public static findPeerNetwork(
        unitId: string,
        networks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup | null {
        return networks.find(n => n.peerIds?.includes(unitId)) ?? null;
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
        const ids: string[] = [];
        if (network.peerIds) {
            ids.push(...network.peerIds);
        } else if (network.masterId) {
            ids.push(network.masterId);
            for (const m of network.members ?? []) {
                ids.push(this.parseMember(m).unitId);
            }
        }
        return [...new Set(ids)];
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

    /** Get the depth of a network in the hierarchy */
    public static getNetworkDepth(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): number {
        let depth = 0;
        let current: SerializedC3NetworkGroup | null = network;
        while (current) {
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
        const subNets = this.findSubNetworks(network, allNetworks);
        if (subNets.length === 0) return 0;
        let maxSubDepth = 0;
        for (const subNet of subNets) {
            const subDepth = 1 + this.getSubTreeDepth(subNet, allNetworks);
            if (subDepth > maxSubDepth) maxSubDepth = subDepth;
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
        const collect = (net: SerializedC3NetworkGroup) => {
            for (const id of this.getNetworkUnitIds(net)) unitIds.add(id);
            for (const subNet of this.findSubNetworks(net, allNetworks)) collect(subNet);
        };
        collect(network);
        return unitIds.size;
    }

    /** Get the root network of a hierarchy */
    public static getRootNetwork(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup {
        let current = network;
        let parent = this.findParentNetwork(current, allNetworks);
        while (parent) {
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
            return this.canMasterConnectToMaster(targetNode, targetCompIdx, sourceNode, sourceCompIdx, networks);
        }

        return { valid: false, reason: 'Incompatible connection types' };
    }

    private static canPeerConnect(
        unitId1: string,
        unitId2: string,
        networkType: C3NetworkType,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        const net1 = this.findPeerNetwork(unitId1, networks);
        const net2 = this.findPeerNetwork(unitId2, networks);
        
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
            // Check if this component is already connected elsewhere
            const parentMemberStr = this.createMasterMember(masterId, masterCompIdx);
            const parentNetAsMaster = this.findMasterNetwork(masterId, masterCompIdx, networks);
            const parentNetAsMember = networks.find(n => n.members?.includes(parentMemberStr));
            if (!parentNetAsMaster && !parentNetAsMember) {
                // If is not connected, we check if there is another Master component connected
                for (const comp of masterNode.c3Components) {
                    if (comp.role === C3Role.MASTER && comp.index !== masterCompIdx) {
                        if (this.isUnitMasterConnected(masterId, networks)) {
                            return { valid: false, reason: 'Master has another Master component connected' };
                        }
                    }
                }
            }
        }

        const network = this.findMasterNetwork(masterId, masterCompIdx, networks);
        let parentNet: SerializedC3NetworkGroup | undefined;
        if (network) {
            const limit = C3_NETWORK_LIMITS[network.type as C3NetworkType];
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

        // The parent has multieple Master components
        if (parentNode.c3Components.length > 1 && parentId !== childId) {
            // Check if this component is already connected elsewhere
            const parentMemberStr = this.createMasterMember(parentId, parentCompIdx);
            const parentNetAsMaster = this.findMasterNetwork(parentId, parentCompIdx, networks);
            const parentNetAsMember = networks.find(n => n.members?.includes(parentMemberStr));
            if (!parentNetAsMaster && !parentNetAsMember) {
                // If is not connected, we check if there is another Master component connected
                for (const comp of parentNode.c3Components) {
                    if (comp.role === C3Role.MASTER && comp.index !== parentCompIdx) {
                        if (this.isUnitMasterConnected(parentId, networks)) {
                            return { valid: false, reason: 'Parent has another Master component connected' };
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

        // Check capacity/mixing
        const parentNet = this.findMasterNetwork(parentId, parentCompIdx, networks);
        if (parentNet) {
            const limit = C3_NETWORK_LIMITS[parentNet.type as C3NetworkType];
            if ((parentNet.members?.length ?? 0) >= limit) {
                return { valid: false, reason: `Parent has max ${limit} children` };
            }
            if (parentNet.members?.some(m => !this.isMasterMember(m))) {
                return { valid: false, reason: 'Cannot mix sub-masters with slaves' };
            }
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
        if (parentDepth >= C3_MAX_NETWORK_DEPTH) {
            return { valid: false, reason: `Would exceed parent depth ${C3_MAX_NETWORK_DEPTH}` };
        }

        const childSubDepth = childNet ? 1 + this.getSubTreeDepth(childNet, networks) : 0;

        if (parentDepth + 1 + childSubDepth > C3_MAX_NETWORK_DEPTH) {
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
            return this.addMemberToMaster(ctx, targetNode, targetCompIdx, sourceNode.unit.id, sourceCompIdx);
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
        const net1 = this.findPeerNetwork(node1.unit.id, networks);
        const net2 = this.findPeerNetwork(node2.unit.id, networks);
        const limit = C3_NETWORK_LIMITS[networkType];

        const removeFromNetwork = (unitId: string, net: SerializedC3NetworkGroup | null) => {
            if (!net) return;
            const idx = networks.findIndex(n => n.id === net.id);
            if (idx < 0) return;
            networks[idx] = { ...networks[idx], peerIds: networks[idx].peerIds?.filter(id => id !== unitId) };
            if ((networks[idx].peerIds?.length ?? 0) < 2) {
                networks.splice(idx, 1);
            }
        };

        const addToNetwork = (unitId: string, net: SerializedC3NetworkGroup) => {
            const idx = networks.findIndex(n => n.id === net.id);
            if (idx >= 0 && !networks[idx].peerIds?.includes(unitId)) {
                networks[idx] = { ...networks[idx], peerIds: [...(networks[idx].peerIds ?? []), unitId] };
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
                networks[idx2] = { ...networks[idx2], peerIds: [...merged] };
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
            id: generateUUID(),
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
        const networks = [...ctx.networks];
        const masterComp = masterNode.c3Components[masterCompIdx];
        const memberStr = memberCompIdx !== undefined 
            ? this.createMasterMember(memberId, memberCompIdx)
            : memberId;

        // Find or create the network
        let network = this.findMasterNetwork(masterNode.unit.id, masterCompIdx, networks);
        let networkIdx = networks.findIndex(n => n.id === network?.id);

        if (!network) {
            const pinKey = `${masterNode.unit.id}:${masterCompIdx}`;
            const color = ctx.masterPinColors?.get(pinKey) ?? ctx.getNextColor();
            network = {
                id: generateUUID(),
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

        result[idx] = {
            ...result[idx],
            members: result[idx].members!.filter(m => m !== memberStr)
        };

        if (result[idx].members!.length === 0) {
            result.splice(idx, 1);
        }

        return { networks: result, success: true };
    }

    /** Remove a unit from a peer network */
    public static removeUnitFromPeerNetwork(
        networks: SerializedC3NetworkGroup[],
        unitId: string
    ): NetworkMutationResult {
        const result = [...networks];
        const net = this.findPeerNetwork(unitId, result);
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

    /** Find connection between two pins */
    public static findConnectionBetweenPins(
        networks: SerializedC3NetworkGroup[],
        sourceId: string,
        sourceCompIdx: number,
        sourceRole: C3Role,
        targetId: string,
        targetCompIdx: number,
        targetRole: C3Role
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
            const net = this.findPeerNetwork(sourceId, networks);
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
        role: C3Role
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
            return this.removeUnitFromPeerNetwork(result, unitId);
        }

        return { networks: result, success: false, message: 'No connection found' };
    }

    // ==================== Display Helpers ====================

    public static getNetworkTypeName(type: C3NetworkType): string {
        switch (type) {
            case C3NetworkType.C3: return 'C3';
            case C3NetworkType.C3I: return 'C3i';
            case C3NetworkType.NAVAL: return 'Naval C3';
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

    public static calculateUnitC3Tax(
        unit: CBTForceUnit,
        unitBv: number,
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[]
    ): number {
        const c3Comps = this.getC3Components(unit.getUnit());
        if (c3Comps.some(c => c.networkType === C3NetworkType.NOVA)) {
            let novaNetworkTotalBv = 0;
            let unitsCount = 0;
            for (const u of allUnits) {
                const unitC3Comps = this.getC3Components(u.getUnit());
                if (!unitC3Comps.some(c => c.networkType === C3NetworkType.NOVA)) continue;
                novaNetworkTotalBv += u.baseBvPilotAdjusted();
                unitsCount += 1;
            }
            if (unitsCount < 2) return 0;
            let taxRate = unitsCount * C3_TAX_RATE;
            if (taxRate > NOVA_MAX_TAX_RATE) taxRate = NOVA_MAX_TAX_RATE;
            return Math.round(novaNetworkTotalBv * taxRate);
        }

        const participatingNets = this.findNetworksContainingUnit(unit.id, networks);
        if (participatingNets.length === 0) return 0;
        const rootNet = this.getRootNetwork(participatingNets[0], networks);
        const networkedUnits = this.getNetworkUnits(rootNet, allUnits) as CBTForceUnit[];
        
        let networkTotalBv = 0;
        for (const u of networkedUnits) {
            const bv = u.baseBvPilotAdjusted();
            let taxRate = C3_TAX_RATE;
            const uC3Comps = this.getC3Components(u.getUnit());
            if (uC3Comps.some(c => c.boosted)) taxRate = C3_BOOSTED_TAX_RATE;
            networkTotalBv += bv * taxRate;
        }
        return Math.round(networkTotalBv);
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
        unitMap: Map<string, Unit>
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
        return cleaned;
    }

    private static validateNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, Unit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (network.peerIds?.length) {
            return this.validatePeerNetwork(network, unitMap, unitC3Map);
        }
        if (network.masterId !== undefined) {
            return this.validateC3MasterNetwork(network, unitMap, unitC3Map);
        }
        return null;
    }

    private static validatePeerNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, Unit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (!network.peerIds) return null;
        const networkType = network.type as C3NetworkType;
        const validPeerIds: string[] = [];

        for (const peerId of network.peerIds) {
            if (!unitMap.has(peerId)) continue;
            const c3Comps = unitC3Map.get(peerId);
            if (!c3Comps) continue;
            if (c3Comps.some(c => c.role === C3Role.PEER && c.networkType === networkType)) {
                validPeerIds.push(peerId);
            }
        }

        if (validPeerIds.length < 2) return null;
        const limit = C3_NETWORK_LIMITS[networkType];
        return { ...network, peerIds: validPeerIds.slice(0, limit) };
    }

    private static validateC3MasterNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, Unit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (network.masterId === undefined || network.masterCompIndex === undefined) return null;
        if (!unitMap.has(network.masterId)) return null;

        const masterC3Comps = unitC3Map.get(network.masterId);
        if (!masterC3Comps?.some(c => c.index === network.masterCompIndex && c.role === C3Role.MASTER)) {
            return null;
        }

        const validMembers: string[] = [];
        let memberType: 'master' | 'slave' | null = null;

        for (const member of network.members ?? []) {
            const { unitId, compIndex } = this.parseMember(member);
            if (!unitMap.has(unitId)) continue;
            const memberC3 = unitC3Map.get(unitId);
            if (!memberC3) continue;

            if (compIndex !== undefined) {
                if (!memberC3.some(c => c.index === compIndex && c.role === C3Role.MASTER)) continue;
                if (memberType === 'slave') continue;
                memberType = 'master';
                validMembers.push(member);
            } else {
                if (!memberC3.some(c => c.role === C3Role.SLAVE)) continue;
                if (memberType === 'master') continue;
                memberType = 'slave';
                validMembers.push(member);
            }
        }

        if (validMembers.length === 0) return null;
        const limit = C3_NETWORK_LIMITS[network.type as C3NetworkType];
        return { ...network, members: validMembers.slice(0, limit) };
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
}
