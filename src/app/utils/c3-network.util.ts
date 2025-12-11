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
    C3_TAX_RATE,
    C3_BOOSTED_TAX_RATE
} from "../models/c3-network.model";
import { SerializedC3NetworkGroup } from "../models/force-serialization";

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
     * Get the maximum children for a master component
     */
    public static getMaxChildren(networkType: C3NetworkType): number {
        return C3_NETWORK_LIMITS[networkType];
    }

    /**
     * Check if a peer can join a network
     */
    public static canPeerJoinNetwork(
        network: SerializedC3NetworkGroup | null,
        networkType: C3NetworkType
    ): boolean {
        if (!network) return true; // New network
        if (network.type !== networkType) return false;
        const limit = C3_NETWORK_LIMITS[networkType as C3NetworkType];
        return (network.peerIds?.length || 0) < limit;
    }

    /**
     * Check if a child can be added to a master's network
     * @param childIsMaster Whether the child being added is a master component
     */
    public static canAddChildToMaster(
        network: SerializedC3NetworkGroup | null,
        childIsMaster: boolean,
        networks: SerializedC3NetworkGroup[]
    ): { valid: boolean; reason?: string } {
        // New network - always valid
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

        // Check depth limit
        const depth = this.getNetworkDepth(network, networks);
        if (depth >= C3_MAX_NETWORK_DEPTH) {
            return { valid: false, reason: `Maximum network depth (${C3_MAX_NETWORK_DEPTH}) reached` };
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

        // Check capacity and mixing rules
        return this.canAddChildToMaster(parentNet, true, networks);
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
        // Check if slave is already connected somewhere
        const existingNets = this.findNetworksContainingUnit(slaveId, networks);
        if (existingNets.length > 0) {
            return { valid: false, reason: 'Unit already connected to a network' };
        }

        const masterNet = this.findMasterNetwork(masterId, masterCompIndex, networks);
        return this.canAddChildToMaster(masterNet, false, networks);
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
        allUnits: ForceUnit[]
    ): number {
        // Find all networks this unit participates in
        const participatingNets = this.findNetworksContainingUnit(unitId, networks);
        if (participatingNets.length === 0) return 0;

        let totalTax = 0;

        for (const network of participatingNets) {
            // Get the root network to avoid double-counting in hierarchies
            const rootNet = this.getRootNetwork(network, networks);
            const networkUnitIds = new Set<string>();
            this.collectAllUnitsInTree(rootNet, networks, networkUnitIds);

            // Calculate total network BV and check for boosted equipment
            let networkTotalBv = 0;
            let hasBoosted = false;

            for (const id of networkUnitIds) {
                const forceUnit = allUnits.find(u => u.id === id);
                if (forceUnit) {
                    networkTotalBv += forceUnit.getUnit()?.bv || 0;
                    const unit = forceUnit.getUnit();
                    if (unit) {
                        const c3Comps = this.getC3Components(unit);
                        if (c3Comps.some(c => c.boosted)) {
                            hasBoosted = true;
                        }
                    }
                }
            }

            if (networkTotalBv <= 0) continue;

            // Calculate tax rate and total tax
            const taxRate = hasBoosted ? C3_BOOSTED_TAX_RATE : C3_TAX_RATE;
            const networkTax = networkTotalBv * taxRate;

            // Distribute tax proportionally by BV
            const unitShare = unitBv / networkTotalBv;
            totalTax += networkTax * unitShare;
        }

        return Math.round(totalTax);
    }

    /**
     * Calculate total C3 tax for all networks in a force.
     */
    public static calculateForceC3Tax(
        allUnits: ForceUnit[],
        networks: SerializedC3NetworkGroup[]
    ): number {
        if (networks.length === 0) return 0;

        // Only count top-level networks to avoid double counting
        const topLevelNets = this.getTopLevelNetworks(networks);
        let totalTax = 0;

        for (const network of topLevelNets) {
            const unitIds = new Set<string>();
            this.collectAllUnitsInTree(network, networks, unitIds);

            let networkBv = 0;
            let hasBoosted = false;

            for (const id of unitIds) {
                const forceUnit = allUnits.find(u => u.id === id);
                if (forceUnit) {
                    networkBv += forceUnit.getUnit()?.bv || 0;
                    const unit = forceUnit.getUnit();
                    if (unit) {
                        const c3Comps = this.getC3Components(unit);
                        if (c3Comps.some(c => c.boosted)) {
                            hasBoosted = true;
                        }
                    }
                }
            }

            const taxRate = hasBoosted ? C3_BOOSTED_TAX_RATE : C3_TAX_RATE;
            totalTax += networkBv * taxRate;
        }

        return Math.round(totalTax);
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
    private static collectAllUnitsInTree(
        network: SerializedC3NetworkGroup,
        allNetworks: SerializedC3NetworkGroup[],
        unitIds: Set<string>
    ): void {
        for (const id of this.getNetworkUnitIds(network)) {
            unitIds.add(id);
        }
        for (const subNet of this.findSubNetworks(network, allNetworks)) {
            this.collectAllUnitsInTree(subNet, allNetworks, unitIds);
        }
    }
}
