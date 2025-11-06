
import { signal, computed, WritableSignal } from '@angular/core';
import { EquipmentUnitType } from './equipment.model';
import { LocationData, HeatProfile, SerializedInventory, CriticalSlot, MountedEquipment } from './force-serialization';
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
