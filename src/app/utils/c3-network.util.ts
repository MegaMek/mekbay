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
    C3_TAX_RATE,
    C3_BOOSTED_TAX_RATE,
    C3NetworkLink
} from "../models/c3-network.model";
import { SerializedC3NetworkGroup } from "../models/force-serialization";

/*
 * Author: Drake
 */

export class C3NetworkUtil {

    /**
     * Check if a component has any C3 equipment flag
     */
    public static hasC3Flag(component: UnitComponent): boolean {
        if (!component.eq?.flags) return false;
        return ALL_C3_FLAGS.some(flag => component.eq!.flags.has(flag));
    }

    /**
     * Get the C3 network type for a component
     */
    public static getNetworkType(component: UnitComponent): C3NetworkType | null {
        if (!component.eq?.flags) return null;
        
        for (const network of C3_COMPATIBLE_NETWORKS) {
            if (network.flags.some(flag => component.eq!.flags.has(flag))) {
                return network.type;
            }
        }
        return null;
    }

    /**
     * Get the C3 role for a component
     */
    public static getRole(component: UnitComponent): C3Role | null {
        if (!component.eq?.flags) return null;
        
        // Check for master flags
        if (C3_MASTER_FLAGS.some(flag => component.eq!.flags.has(flag))) {
            return C3Role.MASTER;
        }
        
        // Check for slave flags
        if (C3_SLAVE_FLAGS.some(flag => component.eq!.flags.has(flag))) {
            return C3Role.SLAVE;
        }
        
        // Check for peer flags (C3i, Nova, Naval)
        if (C3_PEER_FLAGS.some(flag => component.eq!.flags.has(flag))) {
            return C3Role.PEER;
        }
        
        return null;
    }

    /**
     * Check if a component is a boosted C3
     */
    public static isBoosted(component: UnitComponent): boolean {
        if (!component.eq?.flags) return false;
        return C3_BOOSTED_FLAGS.some(flag => component.eq!.flags.has(flag));
    }

    /**
     * Get all C3 components from a unit
     */
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

    /**
     * Check if a unit has any C3 capability
     */
    public static hasC3(unit: Unit): boolean {
        return unit.comp.some(comp => this.hasC3Flag(comp));
    }

    /**
     * Check if a unit can act as a master (has master equipment or peer equipment)
     */
    public static canBeMaster(unit: Unit): boolean {
        return unit.comp.some(comp => {
            const role = this.getRole(comp);
            return role === C3Role.MASTER || role === C3Role.PEER;
        });
    }

    /**
     * Check if a unit can act as a slave (has slave equipment or peer equipment)
     */
    public static canBeSlave(unit: Unit): boolean {
        return unit.comp.some(comp => {
            const role = this.getRole(comp);
            return role === C3Role.SLAVE || role === C3Role.PEER;
        });
    }

    /**
     * Get the master components from a unit (components that can have slaves)
     */
    public static getMasterComponents(unit: Unit): C3Component[] {
        return this.getC3Components(unit).filter(c => 
            c.role === C3Role.MASTER || c.role === C3Role.PEER
        );
    }

    /**
     * Check if two units are compatible for C3 linking
     */
    public static areCompatible(unit1: Unit, unit2: Unit): boolean {
        const c3Comps1 = this.getC3Components(unit1);
        const c3Comps2 = this.getC3Components(unit2);
        
        if (c3Comps1.length === 0 || c3Comps2.length === 0) return false;
        
        // Check if they share at least one compatible network type
        const types1 = new Set(c3Comps1.map(c => c.networkType));
        return c3Comps2.some(c => types1.has(c.networkType));
    }

    /**
     * Get the maximum number of slaves for a network type
     */
    public static getMaxSlaves(networkType: C3NetworkType): number {
        return C3_NETWORK_LIMITS[networkType];
    }

    /**
     * Calculate C3 tax for a network based on linked units
     */
    public static calculateNetworkC3Tax(
        masterUnit: ForceUnit,
        slaveUnits: ForceUnit[],
        masterComponentIndex: number = 0
    ): number {
        if (slaveUnits.length === 0) return 0;
        
        const masterC3Comps = this.getC3Components(masterUnit.getUnit());
        const masterComp = masterC3Comps[masterComponentIndex];
        if (!masterComp) return 0;
        
        // Calculate total BV of all linked units (master + slaves)
        const allUnits = [masterUnit, ...slaveUnits];
        const totalBV = allUnits.reduce((sum, unit) => sum + unit.getUnit().bv, 0);
        
        // Check if any unit in the network has boosted C3
        const hasBoosted = allUnits.some(unit => 
            this.getC3Components(unit.getUnit()).some(c => c.boosted)
        );
        
        const taxRate = hasBoosted ? C3_BOOSTED_TAX_RATE : C3_TAX_RATE;
        return Math.round(totalBV * taxRate);
    }

    /**
     * Calculate total C3 tax for a unit based on its network connections
     */
    public static calculateUnitC3Tax(
        unit: ForceUnit,
        allUnits: ForceUnit[],
        networkLinks: C3NetworkLink[]
    ): number {
        let totalTax = 0;
        const processedNetworks = new Set<string>();
        
        // Find all networks this unit is part of
        for (const link of networkLinks) {
            const networkKey = `${link.masterId}-${link.masterComponentIndex}`;
            
            // Skip if we've already processed this network
            if (processedNetworks.has(networkKey)) continue;
            
            if (link.masterId === unit.id || link.slaveIds.includes(unit.id)) {
                processedNetworks.add(networkKey);
                
                const master = allUnits.find(u => u.id === link.masterId);
                if (master) {
                    const slaves = allUnits.filter(u => link.slaveIds.includes(u.id));
                    totalTax += this.calculateNetworkC3Tax(master, slaves, link.masterComponentIndex);
                }
            }
        }
        
        return totalTax;
    }

    /**
     * Check if a unit is linked to any network
     */
    public static isLinked(unitId: string, networkLinks: C3NetworkLink[]): boolean {
        return networkLinks.some(link => 
            link.masterId === unitId || link.slaveIds.includes(unitId)
        );
    }

    /**
     * Get all units linked to a specific unit
     */
    public static getLinkedUnits(unitId: string, networkLinks: C3NetworkLink[]): string[] {
        const linkedIds = new Set<string>();
        
        for (const link of networkLinks) {
            if (link.masterId === unitId) {
                link.slaveIds.forEach(id => linkedIds.add(id));
            } else if (link.slaveIds.includes(unitId)) {
                linkedIds.add(link.masterId);
                link.slaveIds.forEach(id => {
                    if (id !== unitId) linkedIds.add(id);
                });
            }
        }
        
        return Array.from(linkedIds);
    }

    /**
     * Validate a proposed network link
     */
    public static validateLink(
        masterUnit: ForceUnit,
        slaveUnit: ForceUnit,
        masterComponentIndex: number,
        existingLinks: C3NetworkLink[]
    ): { valid: boolean; reason?: string } {
        // Can't link to self
        if (masterUnit.id === slaveUnit.id) {
            return { valid: false, reason: "Cannot link a unit to itself" };
        }
        
        const masterC3Comps = this.getMasterComponents(masterUnit.getUnit());
        const masterComp = masterC3Comps[masterComponentIndex];
        
        if (!masterComp) {
            return { valid: false, reason: "Master component not found" };
        }
        
        const slaveC3Comps = this.getC3Components(slaveUnit.getUnit());
        if (slaveC3Comps.length === 0) {
            return { valid: false, reason: "Slave unit has no C3 equipment" };
        }
        
        // Check compatibility
        const slaveHasCompatible = slaveC3Comps.some(c => c.networkType === masterComp.networkType);
        if (!slaveHasCompatible) {
            return { valid: false, reason: "Units are not compatible (different C3 network types)" };
        }
        
        // Check if slave can be a slave (has slave or peer role)
        const canBeSlave = slaveC3Comps.some(c => 
            c.networkType === masterComp.networkType && 
            (c.role === C3Role.SLAVE || c.role === C3Role.PEER)
        );
        if (!canBeSlave) {
            return { valid: false, reason: "Unit cannot act as a slave in this network type" };
        }
        
        // Check network size limit
        const existingLink = existingLinks.find(
            l => l.masterId === masterUnit.id && l.masterComponentIndex === masterComponentIndex
        );
        const currentSlaves = existingLink?.slaveIds.length || 0;
        const maxSlaves = this.getMaxSlaves(masterComp.networkType);
        
        if (currentSlaves >= maxSlaves) {
            return { valid: false, reason: `Network is full (max ${maxSlaves} units)` };
        }
        
        // Check if slave is already linked to this master's component
        if (existingLink?.slaveIds.includes(slaveUnit.id)) {
            return { valid: false, reason: "Unit is already linked to this master" };
        }
        
        return { valid: true };
    }

    /**
     * Get display name for a C3 network type
     */
    public static getNetworkTypeName(type: C3NetworkType): string {
        switch (type) {
            case C3NetworkType.C3: return "C3 Network";
            case C3NetworkType.C3I: return "C3i Network";
            case C3NetworkType.NAVAL: return "Naval C3";
            case C3NetworkType.NOVA: return "Nova CEWS";
        }
    }

    /**
     * Get display name for a C3 role
     */
    public static getRoleName(role: C3Role): string {
        switch (role) {
            case C3Role.MASTER: return "Master";
            case C3Role.SLAVE: return "Slave";
            case C3Role.PEER: return "Peer";
        }
    }

    // ========== New methods for SerializedC3NetworkGroup ==========

    /**
     * Check if a unit is linked to any network group
     */
    public static isLinkedInGroups(unitId: string, networks: SerializedC3NetworkGroup[]): boolean {
        return networks.some(net =>
            net.peerIds?.includes(unitId) ||
            net.masterId === unitId ||
            net.slaveIds?.includes(unitId)
        );
    }

    /**
     * Get all unit IDs that are in the same networks as the given unit
     */
    public static getLinkedUnitsFromGroups(unitId: string, networks: SerializedC3NetworkGroup[]): string[] {
        const linkedIds = new Set<string>();

        for (const net of networks) {
            const isInNetwork =
                net.peerIds?.includes(unitId) ||
                net.masterId === unitId ||
                net.slaveIds?.includes(unitId);

            if (isInNetwork) {
                // Add all members from this network
                if (net.peerIds) {
                    net.peerIds.forEach(id => linkedIds.add(id));
                }
                if (net.masterId) {
                    linkedIds.add(net.masterId);
                }
                if (net.slaveIds) {
                    net.slaveIds.forEach(id => linkedIds.add(id));
                }
            }
        }

        // Remove self
        linkedIds.delete(unitId);
        return Array.from(linkedIds);
    }

    /**
     * Calculate total C3 tax for a Force based on SerializedC3NetworkGroup networks.
     * Returns the total tax to be added to force BV.
     */
    public static calculateForceC3Tax(
        allUnits: ForceUnit[],
        networks: SerializedC3NetworkGroup[]
    ): number {
        let totalTax = 0;

        for (const network of networks) {
            const networkUnits: ForceUnit[] = [];

            // Gather all units in this network
            if (network.peerIds) {
                for (const id of network.peerIds) {
                    const unit = allUnits.find(u => u.id === id);
                    if (unit) networkUnits.push(unit);
                }
            } else if (network.masterId && network.slaveIds) {
                const master = allUnits.find(u => u.id === network.masterId);
                if (master) networkUnits.push(master);
                for (const id of network.slaveIds) {
                    const unit = allUnits.find(u => u.id === id);
                    if (unit) networkUnits.push(unit);
                }
            }

            // Need at least 2 units in network to have a tax
            if (networkUnits.length < 2) continue;

            // Calculate BV sum
            const totalBV = networkUnits.reduce((sum, unit) => sum + unit.getUnit().bv, 0);

            // Check if any unit has boosted C3
            const hasBoosted = networkUnits.some(unit =>
                this.getC3Components(unit.getUnit()).some(c => c.boosted)
            );

            const taxRate = hasBoosted ? C3_BOOSTED_TAX_RATE : C3_TAX_RATE;
            totalTax += Math.round(totalBV * taxRate);
        }

        return totalTax;
    }
}
