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

import { inject, Injectable, Injector } from '@angular/core';
import { ForceUnit } from '../../models/force-unit.model';
import { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import { DataService } from '../../services/data.service';
import { Equipment } from '../../models/equipment.model';

/*
 * Author: Drake
 */
@Injectable({
    providedIn: 'root'
})
export class UnitInitializerService {
    private injector = inject(Injector);
    private dataService: DataService | null = null;

    constructor() {}
    
    private getDataService(): DataService {
        if (!this.dataService) {
            this.dataService = this.injector.get(DataService);
        }
        return this.dataService;
    }

    /**
     * Initializes a ForceUnit if it hasn't been initialized yet.
     * This includes extracting critical slots and location data from the SVG.
     * @param unit The ForceUnit to initialize.
     * @param svg The corresponding SVGSVGElement for the unit.
     */
    initializeUnitIfNeeded(unit: ForceUnit, svg: SVGSVGElement): void {
        if (unit.initialized) {
            return;
        }

        this.extractLocations(unit, svg);
        if (svg.querySelector(`.critLoc`)) {
            this.initCritLocs(unit, svg);
        };
        if (svg.querySelector('.critSlot')) {
            this.initCritSlots(unit, svg);
        }
        this.initInventory(unit, svg);

        unit.initialized = true;
    }


    /**
     * Extracts armor and structure locations from the SVG and saves them to the unit.
     * @param unit The ForceUnit to update.
     * @param svg The SVGSVGElement to extract locations from.
     */
    private extractLocations(unit: ForceUnit, svg: SVGSVGElement): void {
        const armorLocs = new Map<string, { loc: string; rear: boolean; points: number }>();
        const structureLocs = new Map<string, { loc: string; points: number }>();

        const hasTroops = svg.getElementById('soldier_1');
        if (hasTroops) {
            structureLocs.set('TROOP', { loc: `TROOP`, points: 0 });
            for (let i = 1; i <= 30; i++) {
                const soldierEl = svg.getElementById(`soldier_${i}`);
                const hasSoldierX = !!soldierEl;
                if (hasSoldierX) {
                    structureLocs.get('TROOP')!.points++;
                    soldierEl.classList.add('soldierPip');
                    soldierEl.setAttribute('soldier-id', i.toString());
                } else {
                    svg.getElementById(`no_soldier_${i}`)?.remove();
                }
            }
        } else {
            const armorPips = svg.querySelectorAll('.pip.armor');
            armorPips.forEach(pip => {
                const loc = pip.getAttribute('loc');
                const rear = !!pip.getAttribute('rear');
                if (!loc) return;
                const locKey = rear ? `${loc}-rear` : loc;
                if (!armorLocs.has(locKey)) {
                    armorLocs.set(locKey, { loc: loc, rear: rear, points: 1 });
                } else {
                    armorLocs.get(locKey)!.points++;
                }
            });
    
            const structurePips = svg.querySelectorAll('.pip.structure');
            structurePips.forEach(pip => {
                const loc = pip.getAttribute('loc');
                if (!loc) return;
                if (!structureLocs.has(loc)) {
                    structureLocs.set(loc, { loc: loc, points: 1 });
                } else {
                    structureLocs.get(loc)!.points++;
                }
            });
            
            const shieldPips = svg.querySelectorAll('.pip.shield');
            shieldPips.forEach(pip => {
                const loc = pip.parentElement?.getAttribute('loc');
                const linkedLoc = pip.getAttribute('loc');
                if (!loc || !linkedLoc) return;
                if (!armorLocs.has(loc)) {
                    armorLocs.set(loc, { loc: loc, rear: false, points: 1 });
                } else {
                    armorLocs.get(loc)!.points++;
                }
            });

        }
        unit.locations = {
            armor: armorLocs,
            internal: structureLocs
        };
    }

    /**
     * Extracts critical slot information from the SVG and populates the unit's data.
     * @param unit The ForceUnit to populate.
     * @param svg The SVGSVGElement containing the crit slot definitions.
     */
    private initCritSlots(unit: ForceUnit, svg: SVGSVGElement): void {
        const critSlotsEl = svg.querySelectorAll(`.critSlot`) as NodeListOf<SVGElement>;
        if (critSlotsEl.length === 0) return;

        const criticalSlots: CriticalSlot[] = [];
        const critSlotMatrix = unit.getCritSlotsAsMatrix();
        const equipmentList = this.getDataService().getEquipment(unit.getUnit().type);
        let newSlotsFound = false;

        critSlotsEl.forEach(critSlotEl => {
            const id = critSlotEl.getAttribute('uid');
            const loc = critSlotEl.getAttribute('loc');
            const name = critSlotEl.getAttribute('name') || '';
            const armored = critSlotEl.getAttribute('armored') === '1';
            if (!loc || !id) return;

            const slot = parseInt(critSlotEl.getAttribute('slot') as string, 10);
            if (isNaN(slot)) return;

            if (critSlotMatrix[loc]?.[slot]) { // found, we keep it
                const critSlot = critSlotMatrix[loc][slot];
                critSlot.el = critSlotEl;
                if (critSlot.id && critSlot.id !== id) {
                    console.warn(`Critical slot ID mismatch for loc ${loc} slot ${slot}: expected ${critSlot.id}, found ${id}`);
                }
                critSlot.id = id;
                critSlot.name = name;
                if (critSlot.name) {
                    critSlot.eq = equipmentList[critSlot.name];
                }
                if (armored) {
                    critSlot.armored = true; // in case it was added later
                }
                criticalSlots.push(critSlot);
                return;
            }
            const critSlot: CriticalSlot = {
                el: critSlotEl,
                id: id,
                name: name,
                loc: loc,
                slot: slot,
                hits: 0,
                eq: name ? equipmentList[name] : undefined
            };

            if (critSlotEl.classList.contains('ammoSlot')) {
                critSlot.consumed = 0;
            }
            if (armored) {
                critSlot.armored = true;
            }
            criticalSlots.push(critSlot);
            newSlotsFound = true;
        });

        if (newSlotsFound) {
            unit.setCritSlots(criticalSlots, true);
        }
    }

    /**
     * Extracts critical locs information from the SVG and populates the unit's data.
     * @param unit The ForceUnit to populate.
     * @param svg The SVGSVGElement containing the crit loc definitions.
     */
    private initCritLocs(unit: ForceUnit, svg: SVGSVGElement): void {
        const critLocEls = svg.querySelectorAll(`.critLoc`) as NodeListOf<SVGElement>;
        if (critLocEls.length === 0) return;

        const criticalLocs: CriticalSlot[] = [];
        const critLocs = unit.getCritSlots();
        let newLocsFound = false;

        critLocEls.forEach(el => {
            const id = el.getAttribute('id');
            const type = el.getAttribute('type');
            if (!id || !type) return;

            const existingCritLoc = critLocs.find(loc => loc.id === id || loc.name === id);
            if (existingCritLoc) { // found, we keep it
                existingCritLoc.id = id; // in case it was missing because we got it from the name
                existingCritLoc.el = el;
                criticalLocs.push(existingCritLoc);
                return;
            }

            const critLoc: CriticalSlot = {
                id: id,
                el: el
            };

            criticalLocs.push(critLoc);
            newLocsFound = true;
        });

        if (newLocsFound) {
            unit.setCritSlots(criticalLocs, true);
        }
    }

    private getInventoryElements(unit: ForceUnit, svg: SVGSVGElement, inventoryEntryEls: NodeListOf<SVGElement>): MountedEquipment[] {
        const inventoryEntries: MountedEquipment[] = [];
        const allCritSlots = unit.getCritSlots();
        const currentInventory = unit.getInventory();
        inventoryEntryEls.forEach(entryEl => {
            const id = entryEl.getAttribute('id') || '';
            const iPhysAtk = entryEl.getAttribute('iPhysAtk') || null; // TODO: rewrite it and handle differently
            if (!id) return;
            entryEl.classList.add('interactive');
            const critSlots = allCritSlots.filter(slot => slot.id === id);
            let name = '';
            let eq: Equipment | undefined = undefined;
            
            let locations = new Set<string>();
            if (critSlots.length > 0) {
                name = critSlots[0].name ?? '';
                eq = this.getDataService().getEquipment(unit.getUnit().type)[name];
                critSlots.forEach(slot => {
                    const loc = slot.loc;
                    if (loc) {
                        locations.add(loc);
                    }
                });
            }
            if (locations.size === 0) {
                // If no locations found, try to get it from entry itself
                const locText = entryEl.querySelector('.location')?.textContent;
                if (locText && locText != '—') {
                    locations = new Set(locText.split('/'));
                }
            }
            let baseHitMod = entryEl.getAttribute('hitMod');
            if (entryEl.parentElement?.classList.contains('inventoryEntry')) {
                baseHitMod = entryEl.parentElement.getAttribute('hitMod2');
            }
            // We remove the buttons in inventory for weapon enhancements (except RISC LASER)
            if (eq && eq.flags.has('F_WEAPON_ENHANCEMENT')) {
                if (!eq.flags.has('F_RISC_LASER_PULSE_MODULE')) {
                    svg.querySelector(`.inventoryEntryButton[inventory-id="${id}"]`)?.remove();
                }
            }
            const baseHitModClean = (baseHitMod || '').replace('−', '-');
            let inventoryEntry: MountedEquipment;
            const existingEntry = currentInventory.find(item => item.id === id);
            if (existingEntry) {
                inventoryEntry = { ...existingEntry };
                // full refresh (but is it really needed?)
                inventoryEntry.name = iPhysAtk || name;
                inventoryEntry.locations = locations;
                inventoryEntry.equipment = eq;
                inventoryEntry.baseHitMod = baseHitModClean;
                inventoryEntry.physical = !!iPhysAtk;
                inventoryEntry.linkedWith = null;
                inventoryEntry.parent = null;
                inventoryEntry.critSlots = critSlots;
                inventoryEntry.el = entryEl;
            } else {
                inventoryEntry = {
                    owner: unit,
                    id: id,
                    name: iPhysAtk || name,
                    locations: locations,
                    equipment: eq,
                    baseHitMod: baseHitModClean,
                    physical: !!iPhysAtk,
                    linkedWith: null,
                    parent: null,
                    destroyed: false,
                    critSlots: critSlots,
                    el: entryEl
                };
            }
            const subElements = entryEl.querySelectorAll('.inventoryEntry') as NodeListOf<SVGElement>;
            if (subElements.length > 0) {
                const linkedWith = this.getInventoryElements(unit, svg, subElements);
                linkedWith.forEach(linkedEntry => {
                    linkedEntry.parent = inventoryEntry;
                });
                inventoryEntry.linkedWith = linkedWith;
            }

            inventoryEntries.push(inventoryEntry);
        });
        return inventoryEntries;
    }

    private initInventory(unit: ForceUnit, svg: SVGSVGElement): void {
        const inventoryEntryEls = svg.querySelectorAll(`.inventoryEntry:not(.inventoryEntry .inventoryEntry)`) as NodeListOf<SVGElement>;
        if (inventoryEntryEls.length === 0) return;
        const inventory = this.getInventoryElements(unit, svg, inventoryEntryEls);
        const inventoryData: MountedEquipment[] = [];
        for (const entry of inventory) {
            inventoryData.push(entry);
            if (entry.linkedWith && (entry.linkedWith?.length > 0)) {
                entry.linkedWith.forEach(linkedEntry => {
                    inventoryData.push(linkedEntry);
                });
            }
        }
        unit.setInventory(inventoryData, true);
    }

}