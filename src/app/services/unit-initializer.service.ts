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
import { MountedEquipment, type CriticalSlot } from '../models/force-serialization';
import { DataService } from './data.service';
import { AmmoEquipment, WeaponEquipment, type Equipment } from '../models/equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';

/*
 * Author: Drake
 */
export const CRITICAL_ONLY_INVENTORY_EXCLUDED_EQUIPMENT = new Set<string>();

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
    initializeUnitIfNeeded(unit: CBTForceUnit, svg: SVGSVGElement): void {
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
     * Cleans up a ForceUnit by clearing element references from crits, inventory, and locations.
     * This releases SVG nodes that were captured during initialization.
     * @param unit The ForceUnit to deinitialize.
     */
    deinitializeUnit(unit: CBTForceUnit): void {
        if (!unit.initialized) {
            return;
        }

        // Clear element references from crits
        for (const crit of unit.getCritSlots()) {
            crit.el = undefined;
        }
        unit.setCritSlots([], true);

        // Clear element references from inventory
        for (const item of unit.getInventory()) {
            item.el = undefined;
            item.critSlots = [];
            if (item.linkedWith) {
                for (const linked of item.linkedWith) {
                    linked.el = undefined;
                    linked.critSlots = [];
                }
            }
        }
        unit.setInventory([], true);

        // Clear locations
        unit.locations = undefined;

        // Remove SVG from DOM if still attached
        const currentSvg = unit.svg();
        if (currentSvg?.parentElement) {
            currentSvg.parentElement.removeChild(currentSvg);
        }
        unit.svg.set(null);

        unit.initialized = false;
    }


    /**
     * Extracts armor and structure locations from the SVG and saves them to the unit.
     * @param unit The ForceUnit to update.
     * @param svg The SVGSVGElement to extract locations from.
     */
    private extractLocations(unit: CBTForceUnit, svg: SVGSVGElement): void {
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
    private initCritSlots(unit: CBTForceUnit, svg: SVGSVGElement): void {
        const critSlotsEl = svg.querySelectorAll(`.critSlot`) as NodeListOf<SVGElement>;
        if (critSlotsEl.length === 0) return;

        const criticalSlots: CriticalSlot[] = unit.getCritSlots().filter(crit => !crit.loc || crit.slot === undefined);
        const critSlotMatrix = unit.getCritSlotsAsMatrix();
        const equipmentList = this.getDataService().getEquipments();
        let slotsChanged = false;

        critSlotsEl.forEach(critSlotEl => {
            const id = critSlotEl.getAttribute('uid');
            const loc = critSlotEl.getAttribute('loc');
            const name = critSlotEl.getAttribute('name') || '';
            const armored = critSlotEl.getAttribute('armored') === '1';
            const totalAmmo = parseInt(critSlotEl.getAttribute('totalAmmo') || '', 10);
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
                const equipmentName = critSlot.name || name;
                critSlot.name = equipmentName;
                critSlot.eq = equipmentName ? equipmentList[equipmentName] : undefined;
                if (armored) {
                    critSlot.armored = true; // in case it was added later
                }
                if (critSlotEl.classList.contains('ammoSlot')) {
                    critSlot.consumed ??= 0;
                    if (critSlot.totalAmmo === undefined && !isNaN(totalAmmo)) {
                        critSlot.totalAmmo = totalAmmo;
                    }
                }
                criticalSlots.push(critSlot);
                slotsChanged = true;
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
                if (!isNaN(totalAmmo)) {
                    critSlot.totalAmmo = totalAmmo;
                }
            }
            if (armored) {
                critSlot.armored = true;
            }
            criticalSlots.push(critSlot);
            slotsChanged = true;
        });

        if (slotsChanged) {
            unit.setCritSlots(criticalSlots, true);
        }
    }

    /**
     * Extracts critical locs information from the SVG and populates the unit's data.
     * @param unit The ForceUnit to populate.
     * @param svg The SVGSVGElement containing the crit loc definitions.
     */
    private initCritLocs(unit: CBTForceUnit, svg: SVGSVGElement): void {
        const critLocEls = svg.querySelectorAll(`.critLoc`) as NodeListOf<SVGElement>;
        if (critLocEls.length === 0) return;

        const criticalLocs: CriticalSlot[] = unit.getCritSlots().filter(crit => crit.loc && crit.slot !== undefined);
        const critLocs = unit.getCritSlots();
        let newLocsFound = false;

        critLocEls.forEach(el => {
            const id = el.getAttribute('critId') || el.getAttribute('id');
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

    private getInventoryElements(unit: CBTForceUnit, svg: SVGSVGElement, inventoryEntryEls: NodeListOf<SVGElement>): MountedEquipment[] {
        const inventoryEntries: MountedEquipment[] = [];
        const allCritSlots = unit.getCritSlots();
        const hasAmmoCritSlots = allCritSlots.some(slot => slot.eq instanceof AmmoEquipment);
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
                eq = this.getDataService().getEquipments()[name];
                critSlots.forEach(slot => {
                    const loc = slot.loc;
                    if (loc) {
                        locations.add(loc);
                    }
                });
            } else {
                name = id.split('@')[0];
                eq = this.getDataService().getEquipments()[name];
            }
            if (locations.size === 0) {
                // If no locations found, try to get it from entry itself
                const locText = entryEl.querySelector('.location')?.textContent;
                if (locText && locText != '—') {
                    locations = new Set(locText.split('/'));
                }
            }
            if (eq instanceof AmmoEquipment && hasAmmoCritSlots) return;
            let baseHitMod = entryEl.getAttribute('hitMod');
            if (entryEl.parentElement?.classList.contains('inventoryEntry')) {
                baseHitMod = entryEl.parentElement.getAttribute('hitMod2');
            }
            // We remove the buttons in inventory for weapon enhancements (except RISC LASER)
            if (eq && eq.flags.has('F_WEAPON_ENHANCEMENT')) {
                svg.querySelector(`.inventoryEntryButton[inventory-id="${id}"]`)?.remove();
                svg.querySelector(`.shrButton[inventory-id="${id}"]`)?.remove();
                svg.querySelector(`.medButton[inventory-id="${id}"]`)?.remove();
                svg.querySelector(`.lngButton[inventory-id="${id}"]`)?.remove();
                svg.querySelector(`.extButton[inventory-id="${id}"]`)?.remove();
            }
            const baseHitModClean = (baseHitMod || '').replace('−', '-');
            let inventoryEntry: MountedEquipment;
            const existingEntry = currentInventory.find(item => item.id === id);
            if (existingEntry) {
                inventoryEntry = existingEntry.clone();
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
                inventoryEntry = new MountedEquipment({
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
                    el: entryEl,
                    states: new Map<string, string>(),
                });
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

    private getDirectAmmoInventoryEntries(unit: CBTForceUnit, currentInventory: MountedEquipment[]): MountedEquipment[] {
        const inventoryEntries: MountedEquipment[] = [];
        const equipmentList = this.getDataService().getEquipments();
        unit.getUnit().comp.forEach((component, index) => {
            const equipment = component.eq ?? equipmentList[component.id];
            if (!(equipment instanceof AmmoEquipment)) return;

            const binCount = Math.max(1, component.q || 1);
            const totalAmmo = component.q2 || (equipment.shots * binCount) || 0;
            const baseBinAmmo = Math.floor(totalAmmo / binCount);
            const extraBinAmmo = totalAmmo % binCount;
            const locations = component.l && component.l !== '—'
                ? new Set(component.l.split('/'))
                : new Set<string>();
            for (let binIndex = 0; binIndex < binCount; binIndex++) {
                const id = `${component.id}@${component.l || 'Ammo'}#${index}.${binIndex}`;
                const originalTotalAmmo = baseBinAmmo + (binIndex < extraBinAmmo ? 1 : 0);
                const existingEntry = currentInventory.find(item => item.id === id);

                inventoryEntries.push(new MountedEquipment({
                    owner: unit,
                    id,
                    name: component.id,
                    locations,
                    equipment,
                    physical: false,
                    linkedWith: null,
                    parent: null,
                    destroyed: existingEntry?.committedDestroyedState() ?? false,
                    destroying: existingEntry?.isDestroying(),
                    ammo: existingEntry?.ammo,
                    totalAmmo: existingEntry?.totalAmmo ?? originalTotalAmmo,
                    consumed: existingEntry?.consumed ?? 0,
                    states: existingEntry?.states ?? new Map<string, string>(),
                }));
            }
        });
        return inventoryEntries;
    }

    private getInfantryFieldGunInventoryEntries(unit: CBTForceUnit, currentInventory: MountedEquipment[]): MountedEquipment[] {
        if (unit.getUnit().type !== 'Infantry' || unit.getUnit().subtype === 'Battle Armor') return [];

        const inventoryEntries: MountedEquipment[] = [];
        const equipmentList = this.getDataService().getEquipments();
        unit.getUnit().comp.forEach((component, index) => {
            if (component.l !== 'FGUN') return;
            const equipment = component.eq ?? equipmentList[component.id];
            if (!(equipment instanceof WeaponEquipment)) return;

            const gunCount = Math.max(1, component.q || 1);
            const locations = new Set([component.l]);
            for (let gunIndex = 0; gunIndex < gunCount; gunIndex++) {
                const id = `${component.id}@${component.l}#${index}.${gunIndex}`;
                const existingEntry = currentInventory.find(item => item.id === id);

                inventoryEntries.push(new MountedEquipment({
                    owner: unit,
                    id,
                    name: component.id,
                    locations,
                    equipment,
                    physical: false,
                    linkedWith: null,
                    parent: null,
                    destroyed: existingEntry?.committedDestroyedState() ?? false,
                    destroying: existingEntry?.isDestroying(),
                    states: existingEntry?.states ?? new Map<string, string>(),
                }));
            }
        });
        return inventoryEntries;
    }

    private getCriticalOnlyInventoryEntries(unit: CBTForceUnit, existingIds: Set<string>, currentInventory: MountedEquipment[]): MountedEquipment[] {
        const critSlotsById = new Map<string, CriticalSlot[]>();
        for (const critSlot of unit.getCritSlots()) {
            if (!critSlot.id || existingIds.has(critSlot.id) || !critSlot.eq || critSlot.eq instanceof AmmoEquipment || this.isCriticalOnlyInventoryExcluded(critSlot)) continue;
            const critSlots = critSlotsById.get(critSlot.id) ?? [];
            critSlots.push(critSlot);
            critSlotsById.set(critSlot.id, critSlots);
        }

        return Array.from(critSlotsById.entries()).map(([id, critSlots]) => {
            const existingEntry = currentInventory.find(item => item.id === id);
            const equipment = critSlots[0].eq;
            return new MountedEquipment({
                owner: unit,
                id,
                name: critSlots[0].name || id.split('@')[0],
                locations: new Set(critSlots.map(slot => slot.loc).filter((loc): loc is string => !!loc)),
                equipment,
                physical: false,
                linkedWith: null,
                parent: null,
                destroyed: existingEntry?.committedDestroyedState() ?? false,
                destroying: existingEntry?.pendingDestroyed(),
                critSlots,
                states: existingEntry?.states ? new Map(existingEntry.states) : new Map<string, string>(),
            });
        });
    }

    private isCriticalOnlyInventoryExcluded(critSlot: CriticalSlot): boolean {
        const equipment = critSlot.eq;
        return [critSlot.id, critSlot.name, equipment?.internalName, equipment?.name]
            .some(value => !!value && CRITICAL_ONLY_INVENTORY_EXCLUDED_EQUIPMENT.has(value));
    }

    private initInventory(unit: CBTForceUnit, svg: SVGSVGElement): void {
        const inventoryEntryEls = svg.querySelectorAll(`.inventoryEntry:not(.inventoryEntry .inventoryEntry)`) as NodeListOf<SVGElement>;
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
        if (svg.querySelector('.critSlot')) {
            inventoryData.push(...this.getCriticalOnlyInventoryEntries(unit, new Set(inventoryData.map(entry => entry.id)), unit.getInventory()));
        }
        if (!svg.querySelector('.critSlot')) {
            inventoryData.push(...this.getInfantryFieldGunInventoryEntries(unit, unit.getInventory()));
            inventoryData.push(...this.getDirectAmmoInventoryEntries(unit, unit.getInventory()));
        }
        unit.setInventory(inventoryData, true);
    }

}