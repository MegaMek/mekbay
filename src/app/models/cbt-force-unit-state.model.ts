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

import { signal, computed } from '@angular/core';
import { type LocationData, type HeatProfile, type SerializedInventory, type CriticalSlot, type MountedEquipment, type SerializedState, type CBTSerializedState, C3_POSITION_SCHEMA } from './force-serialization';
import { CrewMember } from './crew-member.model';
import { ForceUnitState } from './force-unit-state.model';
import { TurnState } from './turn-state.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { Sanitizer } from '../utils/sanitizer.util';

/*
 * Author: Drake
 */
export class CBTForceUnitState extends ForceUnitState {
    declare unit: CBTForceUnit;
    /** Crew members assigned to this unit */
    public crew = signal<CrewMember[]>([]);
    /** Critical hits on this unit */
    public crits = signal<CriticalSlot[]>([]);
    /** Locations and their armor/structure and other properties */
    public locations = signal<Record<string, LocationData>>({});
    /** Heat state of the unit */
    public heat = signal<HeatProfile>({ current: 0, previous: 0 });
    /** Inventory of the unit */
    public inventory = signal<MountedEquipment[]>([]);
    public readonly turnState = signal<TurnState>(null!);

    constructor(unit: CBTForceUnit) {
        super(unit);
        this.turnState.set(new TurnState(this));
    }

    resetTurnState() {
        this.turnState.set(new TurnState(this));
    }

    hasUnconsolidatedCrits = computed(() => {
        return this.crits().some(crit => !!crit.destroying !== !!crit.destroyed);
    });

    hasUnconsolidatedLocations = computed(() => {
        const locations = this.locations();
        return Object.values(locations).some(loc => (loc.pendingArmor ?? 0) !== 0 || (loc.pendingInternal ?? 0) !== 0);
    });

    consolidateLocations() {
        if (!this.hasUnconsolidatedLocations()) return;
        const locations = this.locations();
        const updated: Record<string, LocationData> = {};
        for (const [key, loc] of Object.entries(locations)) {
            updated[key] = {
                armor: (loc.armor ?? 0) + (loc.pendingArmor ?? 0),
                internal: (loc.internal ?? 0) + (loc.pendingInternal ?? 0),
            };
        }
        this.locations.set(updated);
        this.unit.evaluateDestroyed();
        this.unit.setModified();
    }

    discardPendingLocations() {
        const locations = this.locations();
        if (!this.hasUnconsolidatedLocations()) return;
        const updated: Record<string, LocationData> = {};
        for (const [key, loc] of Object.entries(locations)) {
            updated[key] = {
                armor: loc.armor,
                internal: loc.internal,
            };
        }
        this.locations.set(updated);
    }

    consolidateCrits() {
        if (!this.hasUnconsolidatedCrits()) return;
        const crits = this.crits();
        let updated = false;
        crits.forEach(crit => {
            if (!!crit.destroying !== !!crit.destroyed) {
                crit.destroyed = crit.destroying;
                updated = true;
            }
        });
        if (updated) {
            this.crits.set([...crits]);
            this.unit.evaluateDestroyed();
            this.unit.setModified();
        }
    }

    consolidateHeat() {
        const heat = this.heat();
        if (heat.next !== undefined) {
            heat.previous = heat.current;
            heat.current = heat.next;
            heat.next = undefined;
            this.heat.set({ ...heat });
        }
        this.unit.setModified();
    }

    endPhase() {
        this.consolidateLocations();
        this.consolidateCrits();
        const turnState = this.turnState();
        turnState.resetPSRChecks();
    }

    endTurn() {
        this.consolidateHeat();
        this.endPhase();
    }

    override update(data: CBTSerializedState) {
        this.modified.set(data.modified);
        this.destroyed.set(data.destroyed);
        this.shutdown.set(data.shutdown);
        this.heat.set(data.heat);
        if (data.c3Position) {
            this.c3Position.set(Sanitizer.sanitize(data.c3Position, C3_POSITION_SCHEMA));
        }

        // Incoming locations are sparse: only locations with non-zero damage.
        // Locations not in the incoming data are reset to pristine.
        if (data.locations !== undefined) {
            const currentLocations = this.locations();
            const incomingLocations = data.locations;
            const incomingKeys = new Set(Object.keys(incomingLocations));
            let locationsChanged = false;

            // Check incoming locations against current
            for (const key of incomingKeys) {
                const currentLoc = currentLocations[key];
                const incomingLoc = incomingLocations[key];
                if (!currentLoc
                    || currentLoc.armor !== incomingLoc.armor
                    || currentLoc.internal !== incomingLoc.internal
                    || currentLoc.pendingArmor !== incomingLoc.pendingArmor
                    || currentLoc.pendingInternal !== incomingLoc.pendingInternal) {
                    locationsChanged = true;
                    break;
                }
            }

            // Check if any current locations with state are absent from incoming (need reset)
            if (!locationsChanged) {
                for (const key of Object.keys(currentLocations)) {
                    if (!incomingKeys.has(key)) {
                        const loc = currentLocations[key];
                        if ((loc.armor ?? 0) !== 0 || (loc.internal ?? 0) !== 0 ||
                            (loc.pendingArmor ?? 0) !== 0 || (loc.pendingInternal ?? 0) !== 0) {
                            locationsChanged = true;
                            break;
                        }
                    }
                }
            }

            if (locationsChanged) {
                this.locations.set(incomingLocations);
            }
        }

        // In-place update for critical slots to preserve references.
        // Incoming crits are sparse: only slots with state (hits, consumed, destroying, destroyed, name override).
        // Slots not in the incoming data are reset to pristine.
        if (data.crits) {
            const currentCrits = this.crits();
            const incomingCritMap = new Map(data.crits.map(c => [`${c.loc}-${c.slot}`, c]));
            let critsChanged = false;

            for (const existingCrit of currentCrits) {
                const key = `${existingCrit.loc}-${existingCrit.slot}`;
                const incomingCrit = incomingCritMap.get(key);

                if (incomingCrit) {
                    // Update from incoming state
                    if (existingCrit.hits !== incomingCrit.hits ||
                        existingCrit.destroyed !== incomingCrit.destroyed ||
                        existingCrit.consumed !== incomingCrit.consumed) {
                        existingCrit.hits = incomingCrit.hits;
                        existingCrit.destroying = incomingCrit.destroying;
                        existingCrit.name = incomingCrit.name;
                        existingCrit.originalName = incomingCrit.originalName;
                        existingCrit.destroyed = incomingCrit.destroyed;
                        existingCrit.consumed = incomingCrit.consumed;
                        critsChanged = true;
                    }
                } else {
                    // Not in incoming data: reset to pristine if it had any state
                    if ((existingCrit.hits ?? 0) > 0 || existingCrit.destroying !== undefined ||
                        existingCrit.destroyed !== undefined || (existingCrit.consumed ?? 0) > 0 ||
                        existingCrit.originalName !== undefined) {
                        existingCrit.hits = 0;
                        existingCrit.destroying = undefined;
                        existingCrit.destroyed = undefined;
                        existingCrit.consumed = undefined;
                        if (existingCrit.originalName) {
                            existingCrit.name = existingCrit.originalName;
                            existingCrit.originalName = undefined;
                        }
                        critsChanged = true;
                    }
                }
            }

            if (critsChanged) {
                this.crits.set([...currentCrits]);
            }
        }

        // Incoming inventory is sparse: only items with state (destroyed, consumed, states).
        // Items not in incoming data are reset to pristine.
        {
            const currentInventory = this.inventory();
            const incomingMap = new Map((data.inventory ?? []).map(e => [e.id, e]));
            let inventoryChanged = false;

            for (const item of currentInventory) {
                const incoming = incomingMap.get(item.id);
                if (incoming) {
                    // Apply incoming state
                    if (item.destroyed !== incoming.destroyed) {
                        item.destroyed = incoming.destroyed;
                        inventoryChanged = true;
                    }
                    if (item.consumed !== incoming.consumed) {
                        item.consumed = incoming.consumed;
                        inventoryChanged = true;
                    }
                    if (incoming.states !== undefined) {
                        item.states = new Map(incoming.states.map(s => [s.name, s.value]));
                        inventoryChanged = true;
                    }
                } else {
                    // Not in incoming: reset to pristine if it had state
                    if (item.destroyed || (item.consumed ?? 0) > 0 ||
                        (item.states && item.states.size > 0 && Array.from(item.states.values()).some(v => v !== ''))) {
                        item.destroyed = undefined;
                        item.consumed = undefined;
                        if (item.states) {
                            item.states.forEach((_v, k) => item.states!.set(k, ''));
                        }
                        inventoryChanged = true;
                    }
                }
            }

            if (inventoryChanged) {
                this.inventory.set([...currentInventory]);
            }
        }

        const crewMap = new Map(this.crew().map(c => [c.getId(), c]));
        const incomingCrewIds = new Set(data.crew.map(c => c.id));

        // Remove crew members that are no longer present
        const crewToRemove = this.crew().filter(c => !incomingCrewIds.has(c.getId()));
        if (crewToRemove.length > 0) {
            this.crew.update(crew => crew.filter(c => incomingCrewIds.has(c.getId())));
        }

        // Update existing crew and add new ones
        const updatedCrew = data.crew.map(crewData => {
            const crewMember = crewMap.get(crewData.id);
            if (crewMember) {
                crewMember.update(crewData);
                return crewMember;
            }
            return CrewMember.deserialize(crewData, this.unit);
        });
        this.crew.set(updatedCrew);
    }

    /**
     * Returns only crits with meaningful state for serialization.
     * Pristine crits (no hits, no consumption, no name override, not destroying/destroyed)
     * are omitted as they can be reconstructed from the SVG during initialization.
     */
    /**
     * Returns only locations with non-zero damage state for serialization.
     * Pristine locations (all values 0 or undefined) are omitted since
     * getters default to 0 for missing keys.
     */
    locationsForSerialization(): Record<string, LocationData> {
        const locations = this.locations();
        const result: Record<string, LocationData> = {};
        for (const [key, loc] of Object.entries(locations)) {
            if ((loc.armor ?? 0) !== 0 || (loc.internal ?? 0) !== 0 ||
                (loc.pendingArmor ?? 0) !== 0 || (loc.pendingInternal ?? 0) !== 0) {
                result[key] = loc;
            }
        }
        return result;
    }

    critsForSerialization(): Omit<CriticalSlot, 'el' | 'eq'>[] {
        return this.crits()
            .filter(crit =>
                (crit.hits ?? 0) > 0 ||
                (crit.consumed ?? 0) > 0 ||
                (crit.originalName !== undefined && crit.originalName !== crit.name) ||
                crit.destroying ||
                crit.destroyed
            )
            .map(({ el, eq, ...rest }) => rest);
    }

    /**
     * Returns only inventory items with meaningful state for serialization.
     * Items with no destroyed, consumed, or states are omitted since they
     * can be reconstructed from the SVG during initialization.
     */
    inventoryForSerialization(): SerializedInventory[] | undefined {
        const inventory = this.inventory();
        const serializedData: SerializedInventory[] = [];
        for (const item of inventory) {
            const hasStates = item.states !== undefined && item.states.size > 0 
                && Array.from(item.states.values()).some(v => v !== '');
            if (item.destroyed || (item.consumed ?? 0) > 0 || hasStates) {
                serializedData.push({
                    id: item.id,
                    ...(item.destroyed && { destroyed: item.destroyed }),
                    ...((item.consumed ?? 0) > 0 && { consumed: item.consumed }),
                    ...(hasStates && { 
                        states: Array.from(item.states!.entries()).map(([name, value]) => ({ name, value })) 
                    })
                });
            }
        }
        return serializedData.length > 0 ? serializedData : undefined;
    }

    deserializeInventory(serializedInventory: SerializedInventory[]) {
        const allEquipment = this.unit.getAvailableEquipment();
        const inventory: MountedEquipment[] = [];
        const existingInventory = this.inventory();
        serializedInventory.forEach(entry => {
            const existingItem = existingInventory.find(item => item.id === entry.id);
            // Ensure newItem is always initialized to avoid "used before assigned" errors.
            // If we have an existing item, clone it; otherwise create a minimal placeholder and cast to MountedEquipment.
            let newItem: MountedEquipment;
            if (existingItem) {
                newItem = { ...existingItem } as MountedEquipment;
            } else {
                // id comes in the format of name@loc#slot, we grab the name
                const name = entry.id.split('@')[0];
                newItem = {
                    owner: this.unit,
                    id: entry.id,
                    name: name,
                    states: new Map<string, string>(),
                }
            }
            if (entry.destroyed !== undefined) {
                newItem.destroyed = entry.destroyed;
            }
            if (entry.states !== undefined) {
                newItem.states = new Map(entry.states.map(s => [s.name, s.value]));
            }
            if (entry.ammo !== undefined) {
                newItem.ammo = entry.ammo;
            }
            if (entry.totalAmmo !== undefined) {
                newItem.totalAmmo = entry.totalAmmo;
            }
            if (entry.consumed !== undefined) {
                newItem.consumed = entry.consumed;
            }
            if (allEquipment && newItem.name && !newItem.equipment) {
                if (allEquipment) {
                    const equipment = allEquipment[newItem.name];
                    newItem.equipment = equipment;
                }
            }
            inventory.push(newItem);
        });
        this.inventory.set(inventory);
    }
}
