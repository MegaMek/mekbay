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
import { EquipmentUnitType } from './equipment.model';
import { LocationData, HeatProfile, SerializedInventory, CriticalSlot, MountedEquipment, SerializedState, CBTSerializedState, C3_POSITION_SCHEMA } from './force-serialization';
import { CrewMember } from './crew-member.model';
import { ForceUnitState } from './force-unit-state.model';
import { TurnState } from './turn-state.model';
import { CBTForceUnit } from './cbt-force-unit.model';
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
            this.unit.svgService?.evaluateDestroyed();
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

        // We update it only if changed
        if (data.locations) {
            const currentLocations = this.locations();
            const incomingLocations = data.locations;
            let locationsChanged = false;

            const currentKeys = Object.keys(currentLocations);
            const incomingKeys = Object.keys(incomingLocations);

            if (currentKeys.length !== incomingKeys.length) {
                locationsChanged = true;
            } else {
                for (const key of incomingKeys) {
                    const currentLoc = currentLocations[key];
                    const incomingLoc = incomingLocations[key];
                    if (!currentLoc || currentLoc.armor !== incomingLoc.armor || currentLoc.internal !== incomingLoc.internal) {
                        locationsChanged = true;
                        break;
                    }
                }
            }

            if (locationsChanged) {
                this.locations.set(incomingLocations);
            }
        }

        // In-place update for critical slots to preserve references
        if (data.crits) {
            const currentCrits = this.crits();
            const critMap = new Map(currentCrits.map(c => [`${c.loc}-${c.slot}`, c]));
            const incomingCritKeys = new Set(data.crits.map(c => `${c.loc}-${c.slot}`));

            // Filter out crits that are no longer present (unlikely)
            let updatedCrits = currentCrits.filter(c => incomingCritKeys.has(`${c.loc}-${c.slot}`));
            let critsChanged = updatedCrits.length !== currentCrits.length;

            data.crits.forEach(incomingCrit => {
                const key = `${incomingCrit.loc}-${incomingCrit.slot}`;
                const existingCrit = critMap.get(key);
                if (existingCrit) {
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
                    // Note: We don't update el, eq, name, loc, slot as they are initialized once!!!
                } else {
                    // This case should not happen if initialization is correct
                    console.warn(`Incoming critical slot ${incomingCrit.id} not found in current slots`);
                    updatedCrits.push(incomingCrit);
                    critsChanged = true;
                }
            });

            if (critsChanged) {
                // Create a new array to trigger signal change detection
                this.crits.set([...updatedCrits]);
            }
        }

        if (data.inventory) {
            this.deserializeInventory(data.inventory);
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

    inventoryForSerialization(): SerializedInventory[] {
        const inventory = this.inventory();
        const serializedData = inventory.map(item => ({
            id: item.id,
            ...(item.destroyed !== undefined && { destroyed: item.destroyed }),
            ...(item.consumed !== undefined && { consumed: item.consumed }),
            ...(item.states !== undefined && item.states.size > 0 && { 
                states: Array.from(item.states.entries()).map(([name, value]) => ({ name, value })) 
            })
        }));
        return serializedData;
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
