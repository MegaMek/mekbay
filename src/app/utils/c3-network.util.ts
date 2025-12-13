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

import { ForceUnit } from "../models/force-unit.model";
import { Unit, UnitComponent } from "../models/units.model";
import {
    C3Component,
    C3NetworkType,
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
    C3_BOOSTED_TAX_RATE
} from "../models/c3-network.model";
import { SerializedC3NetworkGroup } from "../models/force-serialization";
import { CBTForceUnit } from "../models/cbt-force-unit.model";

/**
 * C3 Network Utility - Simplified implementation
 * 
 * Rules:
 * a) Only same network type can connect (C3_COMPATIBLE_NETWORKS)
 * b) Peers connect equally, limit is C3_NETWORK_LIMITS[type]
 * c) C3: Master can have up to 3 children (all slaves OR all masters, not mixed per component)
 * d) A sub-master with 0 children is NOT a sub-network (treated as slave in parent)
 * e) Multi-master units can connect their components following same rules
 * f) Max depth is C3_MAX_NETWORK_DEPTH (Master -> SubMaster -> children)
 * g) Tax calculation at unit and force level
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
        return networks.find(n => n.peerIds?.includes(unitId)) || null;
    }

    /** Find a master network by master unit and component */
    public static findMasterNetwork(
        masterId: string,
        compIndex: number,
        networks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup | null {
        return networks.find(n => 
            n.masterId === masterId && n.masterCompIndex === compIndex
        ) || null;
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
    
    /** Check if a unit's Master component is connected (is a master of a network or a sub-master) */
    public static isUnitMasterConnected(unitId: string, networks: SerializedC3NetworkGroup[]): boolean {
        // Check if unit is the master of any network
        if (networks.some(n => n.masterId === unitId && (n.members?.length || 0) > 0)) {
            return true;
        }
        // Check if unit is a sub-master (master connected as child to another master)
        for (const net of networks) {
            if (net.members?.some(m => this.isMasterMember(m) && this.parseMember(m).unitId === unitId)) {
                return true;
            }
        }
        return false;
    }
    
    /** Check if a unit's Slave component is connected */
    public static isUnitSlaveConnected(unitId: string, networks: SerializedC3NetworkGroup[]): boolean {
        // Check if unit is a slave member (stored as just unitId, not unitId:compIndex)
        for (const net of networks) {
            if (net.members?.some(m => !this.isMasterMember(m) && m === unitId)) {
                return true;
            }
        }
        return false;
    }

    /** 
     * Parse a member string. Members can be:
     * - "unitId" for slaves
     * - "unitId:compIndex" for masters connected as children
     */
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

    /** Get all unit IDs in a network (master + all members) */
    public static getNetworkUnitIds(network: SerializedC3NetworkGroup): string[] {
        const ids: string[] = [];
        if (network.peerIds) {
            ids.push(...network.peerIds);
        } else if (network.masterId) {
            ids.push(network.masterId);
            if (network.members) {
                for (const m of network.members) {
                    ids.push(this.parseMember(m).unitId);
                }
            }
        }
        return [...new Set(ids)]; // Dedupe in case same unit appears twice (multi-master)
    }

    /** Get all units in a network (master + all members) */
    public static getNetworkUnits(network: SerializedC3NetworkGroup, allUnits: ForceUnit[]): ForceUnit[] {
        const unitIds = this.getNetworkUnitIds(network);
        const unitMap = new Map(allUnits.map(u => [u.id, u]));
        const units: ForceUnit[] = [];
        for (const id of unitIds) {
            const unit = unitMap.get(id);
            if (unit) {
                units.push(unit);
            }
        }
        return units;
    }

    /**
     * Check if a member is a master (has compIndex in member string)
     */
    public static isMasterMember(member: string): boolean {
        return member.includes(':');
    }

    /**
     * Find the parent network of a sub-network (if the master is a member of another network)
     */
    public static findParentNetwork(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup | null {
        if (!network.masterId || network.masterCompIndex === undefined) return null;
        const masterMember = this.createMasterMember(network.masterId, network.masterCompIndex);
        return allNetworks.find(n => 
            n.id !== network.id && n.members?.includes(masterMember)
        ) || null;
    }

    /**
     * Find sub-networks of a network (networks whose masters are members of this network)
     */
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

    /**
     * Get the depth of a network in the hierarchy (0 = top-level, 1 = sub-network, 2 = sub-sub)
     */
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

    /**
     * Get the maximum depth of sub-networks below a network (0 if no sub-networks)
     */
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

    /**
     * Get top-level networks (networks that are not sub-networks of another)
     */
    public static getTopLevelNetworks(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        return networks.filter(n => !this.findParentNetwork(n, networks));
    }

    /**
     * Count total units in a network tree (including sub-networks)
     */
    public static countNetworkTreeUnits(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): number {
        const unitIds = new Set<string>();
        
        const collectUnits = (net: SerializedC3NetworkGroup) => {
            for (const id of this.getNetworkUnitIds(net)) {
                unitIds.add(id);
            }
            for (const subNet of this.findSubNetworks(net, allNetworks)) {
                collectUnits(subNet);
            }
        };
        
        collectUnits(network);
        return unitIds.size;
    }

    // ==================== Validation ====================

    /**
     * Check if two components are compatible (same network type)
     */
    public static areComponentsCompatible(comp1: C3Component, comp2: C3Component): boolean {
        return comp1.networkType === comp2.networkType;
    }

    /**
     * Validate if a specific source pin can connect to a specific target pin.
     * This is the main validation entry point for pin-to-pin connections.
     */
    public static canConnectToPin(
        sourceUnitId: string,
        sourceCompIdx: number,
        sourceRole: C3Role,
        sourceNetworkType: C3NetworkType,
        targetUnitId: string,
        targetCompIdx: number,
        targetRole: C3Role,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        // Same unit, same pin - not allowed
        if (sourceUnitId === targetUnitId && sourceCompIdx === targetCompIdx) {
            return { valid: false, reason: 'Cannot connect pin to itself' };
        }

        // Peer to Peer
        if (sourceRole === C3Role.PEER && targetRole === C3Role.PEER) {
            return this.canPeerConnectToPeer(sourceNetworkType, sourceUnitId, targetUnitId, networks);
        }

        // Master to Slave
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.SLAVE) {
            return this.canSlaveConnectToMaster(sourceUnitId, sourceCompIdx, targetUnitId, networks);
        }

        // Master to Master
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.MASTER) {
            // Check if reverse connection exists - if so, allow (will be replaced)
        //    const targetNet = this.findMasterNetwork(targetUnitId, targetCompIdx, networks);
        //    const sourceMemberStr = this.createMasterMember(sourceUnitId, sourceCompIdx);
        //    if (targetNet?.members?.includes(sourceMemberStr)) {
        //        return { valid: true }; // Allow - will replace reverse connection
        //    }
            return this.canMasterConnectToMaster(sourceUnitId, sourceCompIdx, targetUnitId, targetCompIdx, networks);
        }

        // Slave to Master
        if (sourceRole === C3Role.SLAVE && targetRole === C3Role.MASTER) {
            return this.canSlaveConnectToMaster(targetUnitId, targetCompIdx, sourceUnitId, networks);
        }

        return { valid: false, reason: 'Incompatible connection types' };
    }

    /**
     * Get the maximum children for a master component
     */
    public static getMaxChildren(networkType: C3NetworkType): number {
        return C3_NETWORK_LIMITS[networkType];
    }

    public static canPeerConnectToPeer(
        networkType: C3NetworkType,
        unitId1: string,
        unitId2: string,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        // Verify merging peer networks won't exceed the limit
        const sourceNet = this.findPeerNetwork(unitId1, networks);
        const targetNet = this.findPeerNetwork(unitId2, networks);
        if (sourceNet && targetNet && sourceNet.type !== targetNet.type) {
            return { valid: false, reason: 'Incompatible network types' };
        }
        const limit = C3_NETWORK_LIMITS[networkType];
        const sourceCount = sourceNet?.peerIds?.length || 1;
        const targetCount = targetNet?.peerIds?.length || 1;
        // If same network, already connected
        if (sourceNet && targetNet && sourceNet.id === targetNet.id) {
            return { valid: false, reason: 'Units are already connected in the same network' };
        }
        // Check if merged count would exceed limit
        if (sourceCount + targetCount > limit) {
            return { valid: false, reason: `Merging networks would exceed limit of ${limit} units` };
        }
        return { valid: true };
    }

    /**
     * Check if a child can be added to a master's network
     * @param masterId The master unit's ID
     * @param masterCompIndex The master component index
     * @param childIsMaster Whether the child being added is a master component
     */
    public static canAddChildToMaster(
        masterId: string,
        masterCompIndex: number,
        childIsMaster: boolean,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        // Check if master unit has a Slave component that is already connected
        // (Master/Slave mutual exclusion on same unit)
        if (this.isUnitSlaveConnected(masterId, networks)) {
            return { valid: false, reason: 'Master unit already has a Slave component connected' };
        }
        
        const network = this.findMasterNetwork(masterId, masterCompIndex, networks);
        
        // Calculate depth: check if master is already a sub-master of something
        let depth = 0;
        if (network) {
            depth = this.getNetworkDepth(network, networks);
        } else {
            // Master doesn't have its own network yet, but might be a sub-master
            const masterMemberStr = this.createMasterMember(masterId, masterCompIndex);
            const parentNet = networks.find(n => n.members?.includes(masterMemberStr));
            if (parentNet) {
                depth = this.getNetworkDepth(parentNet, networks) + 1;
            }
        }
        
        // Check depth limit
        if (depth >= C3_MAX_NETWORK_DEPTH) {
            return { valid: false, reason: `Maximum network depth (${C3_MAX_NETWORK_DEPTH}) reached` };
        }
        
        // New network with valid depth - no more checks needed
        if (!network) return { valid: true };

        const members = network.members || [];
        const limit = C3_NETWORK_LIMITS[network.type as C3NetworkType];

        // Check capacity
        if (members.length >= limit) {
            return { valid: false, reason: `Master already has ${limit} children` };
        }

        // Check mixing: can't mix slaves and masters on same component
        const hasMasterMembers = members.some(m => this.isMasterMember(m));
        const hasSlaveMembers = members.some(m => !this.isMasterMember(m));

        if (childIsMaster && hasSlaveMembers) {
            return { valid: false, reason: 'Cannot mix masters and slaves under same master component' };
        }
        if (!childIsMaster && hasMasterMembers) {
            return { valid: false, reason: 'Cannot mix slaves and masters under same master component' };
        }

        return { valid: true };
    }

    /**
     * Check if a master can connect as a child to another master
     */
    public static canMasterConnectToMaster(
        parentMasterId: string,
        parentCompIndex: number,
        childMasterId: string,
        childCompIndex: number,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        // Same unit, same component - not allowed
        if (parentMasterId === childMasterId && parentCompIndex === childCompIndex) {
            return { valid: false, reason: 'Cannot connect component to itself' };
        }
        
        // Check if child master unit has a Slave component that is already connected
        // (Master/Slave mutual exclusion on same unit)
        if (this.isUnitSlaveConnected(childMasterId, networks)) {
            return { valid: false, reason: 'Unit already has a Slave component connected' };
        }
        const parentNet = this.findMasterNetwork(parentMasterId, parentCompIndex, networks);
        
        // Check if child master already has a parent
        const childNet = this.findMasterNetwork(childMasterId, childCompIndex, networks);
        if (childNet) {
            const existingParent = this.findParentNetwork(childNet, networks);
            if (existingParent) {
                return { valid: false, reason: 'Master already connected to another master' };
            }
        }

        // Check if child is already a member somewhere (as a childless master)
        const childMemberKey = this.createMasterMember(childMasterId, childCompIndex);
        const existingParentNet = networks.find(n => n.members?.includes(childMemberKey));
        if (existingParentNet && existingParentNet.id !== parentNet?.id) {
            return { valid: false, reason: 'Master component already connected to another master' };
        }

        // Check total unit count limit
        // Parent's root network unit count + child's network tree unit count must not exceed limit
        const parentRootNet = parentNet ? this.getRootNetwork(parentNet, networks) : null;
        const parentTreeCount = parentRootNet ? this.countNetworkTreeUnits(parentRootNet, networks) : 1; // 1 for the parent master itself
        
        const childTreeCount = childNet ? this.countNetworkTreeUnits(childNet, networks) : 1; // 1 for the child master itself
        
        if (parentTreeCount + childTreeCount > C3_MAX_NETWORK_TOTAL) {
            return { valid: false, reason: `Combined networks would exceed maximum of ${C3_MAX_NETWORK_TOTAL} units` };
        }

        // Check depth limit: parent's depth from root + 1 (new connection) + child's sub-tree depth
        // Parent depth: how many levels above the parent master
        let parentDepth = 0;
        if (parentNet) {
            parentDepth = this.getNetworkDepth(parentNet, networks);
        } else {
            // Parent doesn't have its own network yet, but might be a sub-master
            const parentMemberStr = this.createMasterMember(parentMasterId, parentCompIndex);
            const grandParentNet = networks.find(n => n.members?.includes(parentMemberStr));
            if (grandParentNet) {
                parentDepth = this.getNetworkDepth(grandParentNet, networks) + 1;
            }
        }
        
        // Child sub-tree depth: how many levels below the child master
        const childSubTreeDepth = childNet ? this.getSubTreeDepth(childNet, networks) : 0;
        
        // The resulting depth would be: parentDepth + 1 (this connection) + childSubTreeDepth
        const resultingMaxDepth = parentDepth + 1 + childSubTreeDepth;
        
        if (resultingMaxDepth >= C3_MAX_NETWORK_DEPTH) {
            return { valid: false, reason: `Connection would exceed maximum network depth (${C3_MAX_NETWORK_DEPTH})` };
        }

        // Check capacity and mixing rules (skip depth check since we already did it)
        const capacityCheck = this.canAddChildToMaster(parentMasterId, parentCompIndex, true, networks);
        // Filter out depth-related errors since we've already checked depth more thoroughly
        if (!capacityCheck.valid && !capacityCheck.reason?.includes('depth')) {
            return capacityCheck;
        }
        
        return { valid: true };
    }

    /**
     * Check if a slave can connect to a master
     */
    public static canSlaveConnectToMaster(
        masterId: string,
        masterCompIndex: number,
        slaveId: string,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        // Same unit, same component - not allowed
        if (masterId === slaveId) {
            return { valid: false, reason: 'Cannot connect same unit Master to Slave component' };
        }
        // Check if slave is already connected somewhere
        const existingNets = this.findNetworksContainingUnit(slaveId, networks);
        if (existingNets.length > 0) {
            return { valid: false, reason: 'Unit already connected to a network' };
        }
        
        // Check if slave unit has a Master component that is already connected
        // (Master/Slave mutual exclusion on same unit)
        if (this.isUnitMasterConnected(slaveId, networks)) {
            return { valid: false, reason: 'Unit already has a Master component connected' };
        }

        // Check total unit count limit
        const masterNet = this.findMasterNetwork(masterId, masterCompIndex, networks);
        const rootNet = masterNet ? this.getRootNetwork(masterNet, networks) : null;
        const currentTreeCount = rootNet ? this.countNetworkTreeUnits(rootNet, networks) : 1; // 1 for the master itself
        
        // Also check if master is a sub-master without its own network yet
        if (!rootNet) {
            const masterMemberStr = this.createMasterMember(masterId, masterCompIndex);
            const parentNet = networks.find(n => n.members?.includes(masterMemberStr));
            if (parentNet) {
                const parentRoot = this.getRootNetwork(parentNet, networks);
                const parentTreeCount = this.countNetworkTreeUnits(parentRoot, networks);
                if (parentTreeCount + 1 > C3_MAX_NETWORK_TOTAL) {
                    return { valid: false, reason: `Adding unit would exceed maximum of ${C3_MAX_NETWORK_TOTAL} units in network` };
                }
            }
        } else if (currentTreeCount + 1 > C3_MAX_NETWORK_TOTAL) {
            return { valid: false, reason: `Adding unit would exceed maximum of ${C3_MAX_NETWORK_TOTAL} units in network` };
        }

        return this.canAddChildToMaster(masterId, masterCompIndex, false, networks);
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

    /**
     * Calculate C3 tax for a specific unit based on its network participation.
     * Tax is distributed proportionally based on BV.
     */
    public static calculateUnitC3Tax(
        unitId: string,
        unitBv: number,
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[]
    ): number {
        // Find all networks this unit participates in
        const participatingNets = this.findNetworksContainingUnit(unitId, networks);
        if (participatingNets.length === 0) return 0;

        const rootNet = this.getRootNetwork(participatingNets[0], networks);
        // Get the root network to avoid double-counting in hierarchies
        const networkedUnits = this.getNetworkUnits(rootNet, allUnits) as CBTForceUnit[];
        // Calculate total network BV and check for boosted equipment
        let networkTotalBv = 0;

        for (const unit of networkedUnits) {
            unitBv = unit.baseBvPilotAdjusted();
            let taxRate = C3_TAX_RATE;
            const c3Comps = this.getC3Components(unit.getUnit());
            if (c3Comps.some(c => c.boosted)) {
                taxRate = C3_BOOSTED_TAX_RATE;
            }
            networkTotalBv += unitBv * taxRate;
        }
        return Math.round(networkTotalBv);
    }

    /**
     * Get the root network of a hierarchy (traverse up to find top-level)
     */
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

    /**
     * Collect all unit IDs in a network tree (including sub-networks)
     */
    private static collectAllUnitIdsInTree(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[],
        unitIds: Set<string>
    ): void {
        for (const id of this.getNetworkUnitIds(network)) {
            unitIds.add(id);
        }
        for (const subNet of this.findSubNetworks(network, allNetworks)) {
            this.collectAllUnitIdsInTree(subNet, allNetworks, unitIds);
        }
    }
    
    // ==================== Network Validation & Cleanup ====================

    /**
     * Validate and clean C3 networks against available units.
     * Removes references to units that don't exist or don't have the required C3 components.
     * Returns a new array of cleaned networks (does not mutate input).
     * 
     * @param networks The networks to validate
     * @param unitMap Map of unit ID to Unit object (containing C3 component info)
     * @returns Cleaned networks with invalid references removed
     */
    public static validateAndCleanNetworks(
        networks: SerializedC3NetworkGroup[],
        unitMap: Map<string, Unit>
    ): SerializedC3NetworkGroup[] {
        if (!networks || networks.length === 0) return [];

        // Build a map of unitId -> C3 components for quick lookup
        const unitC3Map = new Map<string, C3Component[]>();
        for (const [id, unit] of unitMap) {
            const c3Comps = this.getC3Components(unit);
            if (c3Comps.length > 0) {
                unitC3Map.set(id, c3Comps);
            }
        }

        const cleanedNetworks: SerializedC3NetworkGroup[] = [];

        for (const network of networks) {
            const cleaned = this.validateNetwork(network, unitMap, unitC3Map);
            if (cleaned) {
                cleanedNetworks.push(cleaned);
            }
        }

        // Second pass: validate network depth and remove networks that exceed max depth
        return this.validateNetworkDepth(cleanedNetworks);
    }

    /**
     * Validate network depth constraints and remove networks/connections that exceed max depth.
     * Max depth is 2: M -> M -> S (or M -> M -> M)
     */
    private static validateNetworkDepth(
        networks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] {
        // Build a map of all networks for quick lookup
        const networkMap = new Map<string, SerializedC3NetworkGroup>();
        for (const net of networks) {
            networkMap.set(net.id, net);
        }

        // Find networks that exceed depth and need to be disconnected
        const networksToRemove = new Set<string>();
        const membersToRemove = new Map<string, Set<string>>(); // networkId -> members to remove

        for (const network of networks) {
            if (network.peerIds) continue; // Peer networks don't have depth

            const depth = this.getNetworkDepth(network, networks);
            
            if (depth >= C3_MAX_NETWORK_DEPTH) {
                // This network is too deep - it should become a top-level network
                // Find and remove the connection from its parent
                const parent = this.findParentNetwork(network, networks);
                if (parent) {
                    const masterMemberStr = this.createMasterMember(network.masterId!, network.masterCompIndex!);
                    if (!membersToRemove.has(parent.id)) {
                        membersToRemove.set(parent.id, new Set());
                    }
                    membersToRemove.get(parent.id)!.add(masterMemberStr);
                }
            }
        }

        // Apply member removals
        const result: SerializedC3NetworkGroup[] = [];
        for (const network of networks) {
            if (networksToRemove.has(network.id)) continue;

            const toRemove = membersToRemove.get(network.id);
            if (toRemove && network.members) {
                const filteredMembers = network.members.filter(m => !toRemove.has(m));
                if (filteredMembers.length === 0) {
                    // No members left - remove the network
                    continue;
                }
                result.push({
                    ...network,
                    members: filteredMembers
                });
            } else {
                result.push(network);
            }
        }

        // Third pass: validate total unit count per network tree
        return this.validateNetworkTotalUnits(result);
    }

    /**
     * Validate that each network tree doesn't exceed C3_MAX_NETWORK_TOTAL units.
     * If exceeded, disconnect sub-networks until under the limit.
     */
    private static validateNetworkTotalUnits(
        networks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] {
        let result = [...networks];
        let changed = true;

        while (changed) {
            changed = false;
            const topLevelNets = this.getTopLevelNetworks(result);

            for (const rootNet of topLevelNets) {
                if (rootNet.peerIds) continue; // Peer networks already have limit enforced

                const totalUnits = this.countNetworkTreeUnits(rootNet, result);

                if (totalUnits > C3_MAX_NETWORK_TOTAL) {
                    // Find a sub-network connection to remove (from any network in this tree)
                    const removed = this.removeOneSubNetworkConnection(rootNet, result);
                    if (removed) {
                        result = removed;
                        changed = true;
                        break; // Restart the loop with updated networks
                    }
                }
            }
        }

        return result;
    }

    /**
     * Find and remove one sub-network connection from a network tree.
     * Returns the updated networks array, or null if nothing to remove.
     */
    private static removeOneSubNetworkConnection(
        rootNet: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[]
    ): SerializedC3NetworkGroup[] | null {
        // Find all master members (sub-network connections) in this tree
        const findMasterMember = (net: SerializedC3NetworkGroup): { networkId: string; member: string } | null => {
            if (!net.members) return null;
            
            // Check this network's members for master connections (reverse order = latest first)
            for (let i = net.members.length - 1; i >= 0; i--) {
                const member = net.members[i];
                if (this.isMasterMember(member)) {
                    return { networkId: net.id, member };
                }
            }
            
            // Recurse into sub-networks
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

        // Remove the member from the network
        return allNetworks.map(net => {
            if (net.id === toRemove.networkId && net.members) {
                const filteredMembers = net.members.filter(m => m !== toRemove.member);
                if (filteredMembers.length === 0) {
                    // Return null to filter out this network later
                    return { ...net, members: [] };
                }
                return { ...net, members: filteredMembers };
            }
            return net;
        }).filter(net => !(net.members && net.members.length === 0 && !net.peerIds));
    }

    /**
     * Validate a single network and return a cleaned version or null if invalid.
     */
    private static validateNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, Unit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        // Validate peer network
        if (network.peerIds && network.peerIds.length > 0) {
            return this.validatePeerNetwork(network, unitMap, unitC3Map);
        }

        // Validate master/slave network
        if (network.masterId !== undefined) {
            return this.validateC3MasterNetwork(network, unitMap, unitC3Map);
        }

        // Invalid network structure
        return null;
    }

    /**
     * Validate a peer network (C3i, Naval, Nova)
     */
    private static validatePeerNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, Unit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (!network.peerIds) return null;

        const validPeerIds: string[] = [];
        const networkType = network.type as C3NetworkType;

        for (const peerId of network.peerIds) {
            // Check if unit exists
            if (!unitMap.has(peerId)) continue;

            // Check if unit has appropriate C3 component
            const c3Comps = unitC3Map.get(peerId);
            if (!c3Comps) continue;

            // Check if unit has a peer component of the right type
            const hasPeerComp = c3Comps.some(c => 
                c.role === C3Role.PEER && c.networkType === networkType
            );
            if (hasPeerComp) {
                validPeerIds.push(peerId);
            }
        }

        // Need at least 2 peers for a valid network
        if (validPeerIds.length < 2) return null;

        // Enforce network limit - keep only up to the max allowed peers
        const limit = C3_NETWORK_LIMITS[networkType];
        const truncatedPeerIds = validPeerIds.slice(0, limit);

        return {
            ...network,
            peerIds: truncatedPeerIds
        };
    }

    /**
     * Validate a master/slave network (C3)
     */
    private static validateC3MasterNetwork(
        network: SerializedC3NetworkGroup,
        unitMap: Map<string, Unit>,
        unitC3Map: Map<string, C3Component[]>
    ): SerializedC3NetworkGroup | null {
        if (network.masterId === undefined || network.masterCompIndex === undefined) {
            return null;
        }

        // Check if master unit exists
        if (!unitMap.has(network.masterId)) return null;

        // Check if master has appropriate C3 master component at the specified index
        const masterC3Comps = unitC3Map.get(network.masterId);
        if (!masterC3Comps) return null;

        const masterComp = masterC3Comps.find(c => 
            c.index === network.masterCompIndex && c.role === C3Role.MASTER
        );
        if (!masterComp) return null;

        // Validate members
        const validMembers: string[] = [];
        let firstMemberType: 'master' | 'slave' | null = null;
        
        if (network.members) {
            for (const member of network.members) {
                const { unitId, compIndex } = this.parseMember(member);
                
                // Check if unit exists
                if (!unitMap.has(unitId)) continue;

                const memberC3Comps = unitC3Map.get(unitId);
                if (!memberC3Comps) continue;

                if (compIndex !== undefined) {
                    // This is a master component connected as a child
                    const hasMasterComp = memberC3Comps.some(c => 
                        c.index === compIndex && c.role === C3Role.MASTER
                    );
                    if (hasMasterComp) {
                        // Check mixing rule: first member determines the type
                        if (firstMemberType === null) {
                            firstMemberType = 'master';
                        } else if (firstMemberType !== 'master') {
                            // Skip - can't mix masters with slaves
                            continue;
                        }
                        validMembers.push(member);
                    }
                } else {
                    // This is a slave
                    const hasSlaveComp = memberC3Comps.some(c => c.role === C3Role.SLAVE);
                    if (hasSlaveComp) {
                        // Check mixing rule: first member determines the type
                        if (firstMemberType === null) {
                            firstMemberType = 'slave';
                        } else if (firstMemberType !== 'slave') {
                            // Skip - can't mix slaves with masters
                            continue;
                        }
                        validMembers.push(member);
                    }
                }
            }
        }

        if (validMembers.length === 0) {
            // No members - no network
            return null;
        }

        // Enforce network limit - master can have up to limit children
        const limit = C3_NETWORK_LIMITS[network.type as C3NetworkType];
        const truncatedMembers = validMembers.slice(0, limit);

        // Return network with cleaned and truncated members
        return {
            ...network,
            members: truncatedMembers
        };
    }
}
