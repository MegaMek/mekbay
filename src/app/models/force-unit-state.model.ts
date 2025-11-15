
import { signal, computed, WritableSignal } from '@angular/core';
import { EquipmentUnitType } from './equipment.model';
import { LocationData, HeatProfile, SerializedInventory, CriticalSlot, MountedEquipment, SerializedState } from './force-serialization';
import { CrewMember } from './crew-member.model';
import { ForceUnit } from './force-unit.model';
import { TurnState } from './turn-state.model';

export class ForceUnitState {
    public unit: ForceUnit;
    public modified = signal(false);
    public immobile = signal(false);
    public prone = signal(false);
    public skidding = signal(false);
    public destroyed = signal(false);
    public shutdown = signal(false);
    public c3Linked = signal(false);
    /** Adjusted Battle Value, if any */
    public adjustedBv = signal<number | null>(null);
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
    public readonly turnState = signal(new TurnState(this));

    constructor(unit: ForceUnit) {
        this.unit = unit;
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

    endPhase() {
        this.consolidateCrits();
        const turnState = this.turnState();
        turnState.resetPSRChecks();
    }

    update(data: SerializedState, allEquipment: EquipmentUnitType) {
        this.modified.set(data.modified);
        this.destroyed.set(data.destroyed);
        this.shutdown.set(data.shutdown);
        this.c3Linked.set(data.c3Linked);
        this.heat.set(data.heat);
                
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
            this.deserializeInventory(data.inventory, allEquipment);
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

        this.unit.recalculateBv();
    }

    inventoryForSerialization(): SerializedInventory[] {
        const inventory = this.inventory();
        return inventory.map(item => ({
            id: item.id,
            ...(item.destroyed !== undefined && { destroyed: item.destroyed }),
            ...(item.consumed !== undefined && { consumed: item.consumed }),
            ...(item.state !== undefined && { state: item.state }),
        }));
    }

    deserializeInventory(serializedInventory: SerializedInventory[], allEquipment: EquipmentUnitType) {
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
                    name: name
                }
            }
            if (entry.destroyed !== undefined) {
                newItem.destroyed = entry.destroyed;
            }
            if (entry.state !== undefined) {
                newItem.state = entry.state;
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
