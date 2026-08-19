// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, computed } from '@angular/core';
import { MountedEquipment } from './mounted-equipment.model';
import { type LocationData, type HeatProfile, type SerializedInventory, type CriticalSlot, type SerializedState, type CBTSerializedState, C3_POSITION_SCHEMA, type SerializedCondition, type SerializedRuleChecks, committedConditionData, conditionsForSerialization, conditionsMapFromSerialization } from './force-serialization';
import { CrewMember } from './crew-member.model';
import { ForceUnitState } from './force-unit-state.model';
import { TurnState } from './turn-state.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { Sanitizer } from '../utils/sanitizer.util';


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
    /** Persistent user-resolved rule checks keyed by stable rule identifier. */
    public ruleChecks = signal<SerializedRuleChecks>({});
    public readonly turnState = signal<TurnState>(null!);

    constructor(unit: CBTForceUnit) {
        super(unit);
        this.turnState.set(new TurnState(this));
    }

    resetTurnState(turnCounter = 0) {
        const turnState = new TurnState(this, turnCounter);
        this.turnState.set(turnState);
        turnState.capturePassiveHeatSourceBaseline();
    }

    hasUnconsolidatedCrits = computed(() => {
        return this.crits().some(crit => !!crit.destroying !== !!crit.destroyed
            || (crit.pendingHits ?? 0) !== 0
            || (crit.pendingHitTimestamps?.length ?? 0) > 0);
    });

    hasUnconsolidatedLocations = computed(() => {
        const locations = this.locations();
        return Object.values(locations).some(loc => (loc.pendingArmor ?? 0) !== 0
            || (loc.pendingInternal ?? 0) !== 0
            || this.hasPendingLocationConditions(loc.conditions));
    });

    hasUnconsolidatedInventory = computed(() => {
        return this.inventory().some(item => item.hasPendingDestroyedChange());
    });

    consolidateLocations() {
        if (!this.hasUnconsolidatedLocations()) return;
        const locations = this.locations();
        const updated: Record<string, LocationData> = {};
        for (const [key, loc] of Object.entries(locations)) {
            updated[key] = {
                armor: (loc.armor ?? 0) + (loc.pendingArmor ?? 0),
                internal: (loc.internal ?? 0) + (loc.pendingInternal ?? 0),
                conditions: this.consolidateLocationConditions(loc.conditions),
            };
        }
        this.locations.set(updated);
        this.unit.applyUnderwaterBreachAndFlooding(true);
        this.unit.clearNarcFromCommittedPhysicallyDestroyedLocations();
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
                conditions: this.discardPendingLocationConditions(loc.conditions),
            };
        }
        this.locations.set(updated);
        this.unit.evaluateDestroyed();
        this.unit.setModified();
    }

    consolidateCrits() {
        if (!this.hasUnconsolidatedCrits()) return;
        const crits = this.crits();
        const commitsDestruction = crits.some(crit =>
            crit.destroying !== undefined && crit.destroyed === undefined);
        const destructionTurn = commitsDestruction
            ? this.turnState().getTurnCounter()
            : undefined;
        let updated = false;
        crits.forEach(crit => {
            if ((crit.pendingHits ?? 0) !== 0) {
                this.consolidateCritHitTimestamps(crit);
                crit.hits = Math.max(0, (crit.hits ?? 0) + (crit.pendingHits ?? 0));
                crit.pendingHits = undefined;
                crit.pendingHitTimestamps = undefined;
                updated = true;
            }
            if ((crit.destroying !== undefined) !== (crit.destroyed !== undefined)) {
                crit.destroyed = crit.destroying;
                crit.destroyedTurn = crit.destroying !== undefined ? destructionTurn : undefined;
                updated = true;
            }
        });
        if (updated) {
            this.crits.set([...crits]);
            this.unit.evaluateDestroyed();
            this.unit.setModified();
        }
    }

    consolidateInventory() {
        if (!this.hasUnconsolidatedInventory()) return;
        const inventory = this.inventory();
        let updated = false;
        inventory.forEach(item => {
            if (item.isRepairing()
                && this.unit.getEquipmentInstallationLocationStatus(item) === 'destroyed') {
                updated = item.setPendingDestroyed(undefined) || updated;
                return;
            }
            updated = item.commitPendingDestroyed() || updated;
        });
        if (updated) {
            this.inventory.set([...inventory]);
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
        const turnState = this.turnState();
        if (turnState.autoFall() && !this.hasCondition('prone')) {
            this.unit.setCondition('prone', true);
        }
        this.consolidateLocations();
        this.consolidateCrits();
        this.consolidateInventory();
        turnState.resetPSRChecks();
        turnState.commitEquipmentStateChanges();
    }

    private cleanupEndTurnConditions() {
        let cleanupDone = false;
        if (this.hasCondition('tagged')) {
            this.setCondition('tagged', false);
            cleanupDone = true;
        }
        if (this.hasCondition('skidding')) {
            this.setCondition('skidding', false);
            cleanupDone = true;
        }
        if (cleanupDone) {
            this.unit.setModified();
        }
    }

    endTurn() {
        this.consolidateHeat();
        this.cleanupEndTurnConditions();
        this.endPhase();
    }

    override update(data: CBTSerializedState) {
        this.modified.set(data.modified);
        this.destroyed.set(data.destroyed);
        this.setConditions(data.conditions ?? []);
        this.ruleChecks.set({ ...(data.ruleChecks ?? {}) });
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
                    || currentLoc.pendingInternal !== incomingLoc.pendingInternal
                    || !this.locationConditionsEqual(currentLoc.conditions, incomingLoc.conditions)) {
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
                            (loc.pendingArmor ?? 0) !== 0 || (loc.pendingInternal ?? 0) !== 0 ||
                            (loc.conditions?.length ?? 0) > 0) {
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
        // Incoming crits are sparse: only slots with state (hits, pendingHits, consumed, destroying, destroyed, name override).
        // Slots not in the incoming data are reset to pristine.
        if (data.crits) {
            const currentCrits = this.crits();
            const incomingCritMap = new Map(data.crits.map(c => [this.critStateKey(c), c]));
            let critsChanged = false;

            for (const existingCrit of currentCrits) {
                const key = this.critStateKey(existingCrit);
                const incomingCrit = incomingCritMap.get(key);

                if (incomingCrit) {
                    // Update from incoming state
                    if (existingCrit.hits !== incomingCrit.hits ||
                        existingCrit.pendingHits !== incomingCrit.pendingHits ||
                        !this.numberArraysEqual(existingCrit.hitTimestamps, incomingCrit.hitTimestamps) ||
                        !this.numberArraysEqual(existingCrit.pendingHitTimestamps, incomingCrit.pendingHitTimestamps) ||
                        existingCrit.destroying !== incomingCrit.destroying ||
                        existingCrit.destroyed !== incomingCrit.destroyed ||
                        existingCrit.destroyedTurn !== incomingCrit.destroyedTurn ||
                        existingCrit.consumed !== incomingCrit.consumed) {
                        existingCrit.hits = incomingCrit.hits;
                        existingCrit.pendingHits = incomingCrit.pendingHits;
                        existingCrit.hitTimestamps = incomingCrit.hitTimestamps;
                        existingCrit.pendingHitTimestamps = incomingCrit.pendingHitTimestamps;
                        existingCrit.destroying = incomingCrit.destroying;
                        existingCrit.name = incomingCrit.name;
                        existingCrit.originalName = incomingCrit.originalName;
                        existingCrit.destroyed = incomingCrit.destroyed;
                        existingCrit.destroyedTurn = incomingCrit.destroyedTurn;
                        existingCrit.consumed = incomingCrit.consumed;
                        critsChanged = true;
                    }
                } else {
                    // Not in incoming data: reset to pristine if it had any state
                    if ((existingCrit.hits ?? 0) > 0 || (existingCrit.pendingHits ?? 0) !== 0 ||
                        (existingCrit.hitTimestamps?.length ?? 0) > 0 || (existingCrit.pendingHitTimestamps?.length ?? 0) > 0 ||
                        existingCrit.destroying !== undefined ||
                        existingCrit.destroyed !== undefined ||
                        existingCrit.destroyedTurn !== undefined ||
                        (existingCrit.consumed ?? 0) > 0 ||
                        existingCrit.originalName !== undefined) {
                        existingCrit.hits = 0;
                        existingCrit.pendingHits = undefined;
                        existingCrit.hitTimestamps = undefined;
                        existingCrit.pendingHitTimestamps = undefined;
                        existingCrit.destroying = undefined;
                        existingCrit.destroyed = undefined;
                        existingCrit.destroyedTurn = undefined;
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
                    if (item.setCommittedDestroyed(incoming.destroyed)) {
                        inventoryChanged = true;
                    }
                    if (item.setPendingDestroyed(incoming.destroying)) {
                        inventoryChanged = true;
                    }
                    if (item.consumed !== incoming.consumed || item.ammo !== incoming.ammo
                        || item.totalAmmo !== incoming.totalAmmo) {
                        item.setAmmoState({
                            consumed: incoming.consumed,
                            ammo: incoming.ammo,
                            totalAmmo: incoming.totalAmmo,
                        });
                        inventoryChanged = true;
                    }
                    if (incoming.states !== undefined) {
                        item.replaceStates(new Map(incoming.states.map(s => [s.name, s.value])));
                        inventoryChanged = true;
                    }
                } else {
                    // Not in incoming: reset to pristine if it had state
                    if (item.committedDestroyed() || item.hasPendingDestroyedChange() || (item.consumed ?? 0) > 0 ||
                        (item.ammo !== undefined && item.ammo !== item.name) ||
                        (item.states && item.states.size > 0 && Array.from(item.states.values()).some(v => v !== ''))) {
                        item.setCommittedDestroyed(undefined);
                        item.setPendingDestroyed(undefined);
                        item.setAmmoState({ consumed: undefined, ammo: undefined, totalAmmo: undefined });
                        item.clearStateValues();
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
        this.turnState().capturePassiveHeatSourceBaseline();
        this.turnState().update(data.turnState);
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
                (loc.pendingArmor ?? 0) !== 0 || (loc.pendingInternal ?? 0) !== 0 ||
                (loc.conditions?.length ?? 0) > 0) {
                result[key] = loc;
            }
        }
        return result;
    }

    critsForSerialization(): Omit<CriticalSlot, 'el' | 'eq'>[] {
        return this.crits()
            .filter(crit =>
                (crit.hits ?? 0) > 0 ||
                (crit.pendingHits ?? 0) !== 0 ||
                (crit.hitTimestamps?.length ?? 0) > 0 ||
                (crit.pendingHitTimestamps?.length ?? 0) > 0 ||
                (crit.consumed ?? 0) > 0 ||
                (crit.originalName !== undefined && crit.originalName !== crit.name) ||
                crit.destroying ||
                crit.destroyed
            )
            .map(({ el, eq, ...rest }) => rest);
    }

    private critStateKey(crit: CriticalSlot): string {
        return crit.loc !== undefined && crit.slot !== undefined
            ? `slot:${crit.loc}-${crit.slot}`
            : `loc:${crit.id || crit.name || ''}`;
    }

    private consolidateCritHitTimestamps(crit: CriticalSlot): void {
        if (!crit.hitTimestamps && !crit.pendingHitTimestamps) return;

        const committedCount = Math.max(0, crit.hits ?? 0);
        const committed = this.normalizedTimestamps(crit.hitTimestamps, committedCount, crit.destroyed);
        const pendingHits = crit.pendingHits ?? 0;
        if (pendingHits > 0) {
            const pending = this.normalizedTimestamps(crit.pendingHitTimestamps, pendingHits, Date.now());
            crit.hitTimestamps = [...committed, ...pending].sort((a, b) => a - b);
        } else if (pendingHits < 0) {
            crit.hitTimestamps = committed.slice(0, Math.max(0, committed.length + pendingHits));
        }
    }

    private normalizedTimestamps(timestamps: number[] | undefined, count: number, fallback: number | undefined): number[] {
        const normalized = (timestamps ?? [])
            .filter(timestamp => Number.isFinite(timestamp))
            .sort((a, b) => a - b)
            .slice(0, Math.max(0, count));
        const missing = Math.max(0, count - normalized.length);
        const start = normalized[normalized.length - 1] ?? fallback ?? 0;
        return missing === 0
            ? normalized
            : [...normalized, ...Array.from({ length: missing }, (_value, index) => start + index + 1)];
    }

    private numberArraysEqual(left: number[] | undefined, right: number[] | undefined): boolean {
        const leftValues = left ?? [];
        const rightValues = right ?? [];
        return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
    }

    private locationConditionsEqual(left: SerializedCondition[] | undefined, right: SerializedCondition[] | undefined): boolean {
        const leftValues = left ?? [];
        const rightValues = right ?? [];
        return leftValues.length === rightValues.length
            && leftValues.every((value, index) => JSON.stringify(value) === JSON.stringify(rightValues[index]));
    }

    private hasPendingLocationConditions(conditions: SerializedCondition[] | undefined): boolean {
        return Array.from(conditionsMapFromSerialization(conditions).values()).some(data => data?.pending === true);
    }

    private consolidateLocationConditions(conditions: SerializedCondition[] | undefined): SerializedCondition[] | undefined {
        return this.normalizePendingLocationConditions(conditions, true);
    }

    private discardPendingLocationConditions(conditions: SerializedCondition[] | undefined): SerializedCondition[] | undefined {
        return this.normalizePendingLocationConditions(conditions, false);
    }

    private normalizePendingLocationConditions(conditions: SerializedCondition[] | undefined, commit: boolean): SerializedCondition[] | undefined {
        const result = conditionsMapFromSerialization(conditions);
        for (const [key, data] of result) {
            if (data?.pending !== true) continue;
            if (commit) {
                result.set(key, committedConditionData(data));
            } else {
                result.delete(key);
            }
        }
        const serialized = conditionsForSerialization(result);
        return serialized.length > 0 ? serialized : undefined;
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
            if (item.intrinsicOneShotAmmo) continue;
            const hasStates = item.states !== undefined && item.states.size > 0 
                && Array.from(item.states.values()).some(v => v !== '');
            const hasCustomAmmo = item.ammo !== undefined && item.ammo !== item.name;
            const committedDestroyed = item.committedDestroyedState();
            const pendingDestroyed = item.pendingDestroyed();
            if (committedDestroyed || pendingDestroyed !== undefined || (item.consumed ?? 0) > 0 || hasCustomAmmo || hasStates) {
                serializedData.push({
                    id: item.id,
                    ...(committedDestroyed && { destroyed: committedDestroyed }),
                    ...(pendingDestroyed !== undefined && { destroying: pendingDestroyed }),
                    ...((item.consumed ?? 0) > 0 && { consumed: item.consumed }),
                    ...(hasCustomAmmo && { ammo: item.ammo }),
                    ...(((item.consumed ?? 0) > 0 || hasCustomAmmo) && item.totalAmmo !== undefined && { totalAmmo: item.totalAmmo }),
                    ...(hasStates && { 
                        states: Array.from(item.states!.entries()).map(([name, value]) => ({ name, value })) 
                    })
                });
            }
        }
        return serializedData.length > 0 ? serializedData : undefined;
    }

    deserializeInventory(serializedInventory: SerializedInventory[]) {
        const inventory: MountedEquipment[] = [];
        const existingInventory = this.inventory();
        serializedInventory.forEach(entry => {
            const existingItem = existingInventory.find(item => item.id === entry.id);
            let newItem: MountedEquipment;
            if (existingItem) {
                newItem = existingItem.clone();
            } else {
                // id comes in the format of name@loc#slot, we grab the name
                const name = entry.id.split('@')[0];
                newItem = new MountedEquipment({
                    owner: this.unit,
                    id: entry.id,
                    name: name,
                    states: new Map<string, string>(),
                });
            }
            newItem.setCommittedDestroyed(entry.destroyed);
            if (entry.states !== undefined) {
                newItem.replaceStates(new Map(entry.states.map(s => [s.name, s.value])));
            }
            newItem.setAmmoState({ ammo: entry.ammo, totalAmmo: entry.totalAmmo, consumed: entry.consumed });
            newItem.setPendingDestroyed(entry.destroying);
            if (newItem.name && !newItem.equipment) {
                newItem = newItem.clone({
                    equipment: this.unit.getEquipmentRegistry().findEquipment(newItem.name) ?? undefined,
                });
            }
            inventory.push(newItem);
        });
        this.inventory.set(inventory);
    }
}
