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

import { Injectable, signal, effect, computed, Injector, inject, untracked, DestroyRef, ApplicationRef } from '@angular/core';
import { Unit } from '../models/units.model';
import { Force, UnitGroup } from '../models/force.model';
import { ForceUnit } from '../models/force-unit.model';
import { DataService } from './data.service';
import { LayoutService } from './layout.service';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { ConfirmDialogComponent, ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { firstValueFrom, Subscription } from 'rxjs';
import { RenameForceDialogComponent, RenameForceDialogData } from '../components/rename-force-dialog/rename-force-dialog.component';
import { RenameGroupDialogComponent, RenameGroupDialogData } from '../components/rename-group-dialog/rename-group-dialog.component';
import { UnitInitializerService } from './unit-initializer.service';
import { DialogsService } from './dialogs.service';
import { generateUUID, WsService } from './ws.service';
import { ToastService } from './toast.service';
import { LoggerService } from './logger.service';
import { SheetService } from './sheet.service';
import { OptionsService } from './options.service';
import { LoadForceEntry } from '../models/load-force-entry.model';
import { ForceLoadDialogComponent, ForceLoadDialogResult } from '../components/force-load-dialog/force-load-dialog.component';
import { ForcePackDialogComponent, ForcePackDialogResult } from '../components/force-pack-dialog/force-pack-dialog.component';
import { SerializedForce } from '../models/force-serialization';
import { EditPilotDialogComponent, EditPilotDialogData, EditPilotResult } from '../components/edit-pilot-dialog/edit-pilot-dialog.component';
import { EditASPilotDialogComponent, EditASPilotDialogData, EditASPilotResult } from '../components/edit-as-pilot-dialog/edit-as-pilot-dialog.component';
import { C3NetworkDialogComponent, C3NetworkDialogData, C3NetworkDialogResult } from '../components/c3-network-dialog/c3-network-dialog.component';
import { ShareForceDialogComponent } from '../components/share-force-dialog/share-force-dialog.component';
import { ForceOverviewDialogComponent } from '../components/force-overview-dialog/force-overview-dialog.component';
import { CrewMember, DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { GameService } from './game.service';
import { UrlStateService } from './url-state.service';
import { canAntiMech, NO_ANTIMEK_SKILL } from '../utils/infantry.util';
import { ResolvedPack } from '../utils/force-pack.util';
import { buildMultiForceQueryParams, parseForceFromUrl, ForceQueryParams } from '../utils/force-url.util';
import { CBTPrintUtil } from '../utils/cbtprint.util';
import { ASPrintUtil } from '../utils/asprint.util';
import { ForceSlot, ForceAlignment } from '../models/force-slot.model';

/*
 * Author: Drake
 */
@Injectable({
    providedIn: 'root'
})
export class ForceBuilderService {
    logger = inject(LoggerService);
    dataService = inject(DataService);
    layoutService = inject(LayoutService);
    toastService = inject(ToastService);
    wsService = inject(WsService);
    private dialogsService = inject(DialogsService);
    private unitInitializer = inject(UnitInitializerService);
    private injector = inject(Injector);
    private urlStateService = inject(UrlStateService);

    public currentForce = signal<Force | null>(null);
    public selectedUnit = signal<ForceUnit | null>(null, { equal: () => false });
    public loadedForces = signal<ForceSlot[]>([]);
    private urlStateInitialized = signal(false);
    private conflictDialogRef: any;

    /** Current alignment filter: 'all' shows everything, 'friendly'/'enemy' filters by alignment. */
    public alignmentFilter = signal<'all' | 'friendly' | 'enemy'>('all');

    /** Remembers the last selected unit per filter mode so switching back restores it. */
    private savedSelectionByFilter = new Map<'all' | 'friendly' | 'enemy', string | null>();

    /** True when loaded forces have a mix of friendly and enemy alignments (>1 slot). */
    hasMixedAlignments = computed<boolean>(() => {
        const slots = this.loadedForces();
        if (slots.length < 2) return false;
        const alignments = new Set(slots.map(s => s.alignment));
        return alignments.has('friendly') && alignments.has('enemy');
    });

    /** Loaded forces filtered by the current alignment filter. */
    filteredLoadedForces = computed<ForceSlot[]>(() => {
        const filter = this.alignmentFilter();
        const slots = this.loadedForces();
        if (filter === 'all') return slots;
        return slots.filter(s => s.alignment === filter);
    });

    constructor() {
        // Register as a URL state consumer - must call markConsumerReady when done reading URL
        this.urlStateService.registerConsumer('force-builder');
        
        this.loadUnitsFromUrlOnStartup();
        this.updateUrlOnForceChange();
        this.monitorWebSocketConnection();

        // Auto-reset alignment filter when conditions no longer apply
        effect(() => {
            if (!this.hasMixedAlignments() && this.alignmentFilter() !== 'all') {
                this.alignmentFilter.set('all');
            }
        });

        // When cloud rejects a save (not_owner), adopt the force with fresh IDs
        this.dataService.forceNeedsAdoption.subscribe(force => {
            const slot = this.loadedForces().find(s => s.force === force);
            if (slot) {
                this.adoptForce(slot);
            }
        });

        inject(DestroyRef).onDestroy(() => {
            // Clean up all loaded force slots
            for (const slot of this.loadedForces()) {
                this.teardownForceSlot(slot);
            }
            if (this.conflictDialogRef) {
                this.conflictDialogRef.close();
                this.conflictDialogRef = undefined;
            }
        });
    }

    /** Current force's units as a non-nullable array (empty when no force). */
    forceUnitsOrEmpty = computed<ForceUnit[]>(() => this.currentForce()?.units() ?? []);
    /** True when a force is loaded (non-null). */
    hasForce = computed<boolean>(() => this.currentForce() !== null);
    /** True when the current force has one or more units. */
    hasUnits = computed<boolean>(() => this.forceUnitsOrEmpty().length > 0);
    /** Current force's name, or empty string. */
    forceName = computed<string>(() => this.currentForce()?.name ?? '');
    /** Current force's groups, or empty array. */
    forceGroups = computed<UnitGroup[]>(() => this.currentForce()?.groups() ?? []);
    /** Current force's game system, or null. */
    forceGameSystem = computed<GameSystem | null>(() => this.currentForce()?.gameSystem ?? null);
    /** True when current force is Alpha Strike. */
    isAlphaStrike = computed<boolean>(() => this.currentForce()?.gameSystem === GameSystem.ALPHA_STRIKE);
    /** True when the current force has exactly one group. */
    hasSingleGroup = computed<boolean>(() => (this.currentForce()?.groups().length ?? 0) === 1);
    /** True when any group in the current force has zero units. */
    hasEmptyGroups = computed<boolean>(() => this.currentForce()?.groups().some(g => g.units().length === 0) ?? false);
    /** Number of units in the current force. */
    unitCount = computed<number>(() => this.currentForce()?.units().length ?? 0);
    /** True when a single unit exists in the current force. */
    hasSingleUnit = computed<boolean>(() => (this.currentForce()?.units().length ?? 0) === 1);
    /** True when current force can be saved (has units, no instanceId, not readOnly). */
    canSaveForce = computed<boolean>(() => {
        const f = this.currentForce();
        return !!f && f.units().length > 0 && !f.instanceId() && !f.readOnly();
    });

    /** All units across all loaded forces (flat list). */
    allLoadedUnits = computed<ForceUnit[]>(() => {
        return this.loadedForces().flatMap(s => s.force.units());
    });

    readOnlyForce = computed<boolean>(() => {
        return this.currentForce()?.readOnly() ?? false;
    });

    /** Cycles the alignment filter: all → friendly → enemy → all. Auto-resets if conditions no longer apply. */
    cycleAlignmentFilter(): void {
        const current = this.alignmentFilter();

        // Save the current selection for this filter mode
        this.savedSelectionByFilter.set(current, this.selectedUnit()?.id ?? null);

        // Determine next filter
        let next: 'all' | 'friendly' | 'enemy';
        if (current === 'all') {
            next = 'friendly';
        } else if (current === 'friendly') {
            next = 'enemy';
        } else {
            next = 'all';
        }
        this.alignmentFilter.set(next);

        // Restore saved selection for the new filter, or pick first visible unit
        this.restoreSelectionForCurrentFilter();
    }

    /**
     * Restores the remembered unit selection for the current filter mode.
     * If the remembered unit is no longer visible, selects the first visible unit instead.
     */
    private restoreSelectionForCurrentFilter(): void {
        const filter = this.alignmentFilter();
        const visibleSlots = this.filteredLoadedForces();
        const visibleUnits = visibleSlots.flatMap(s => s.force.units());

        // Check if the currently selected unit is already visible
        const currentSelection = this.selectedUnit();
        if (currentSelection && visibleUnits.some(u => u.id === currentSelection.id)) {
            return; // Already visible, nothing to do
        }

        // Try to restore the saved selection for this filter
        const savedId = this.savedSelectionByFilter.get(filter);
        if (savedId) {
            const saved = visibleUnits.find(u => u.id === savedId);
            if (saved) {
                this.selectUnit(saved);
                return;
            }
        }

        // Fall back to first visible unit
        if (visibleUnits.length > 0) {
            this.selectUnit(visibleUnits[0]);
        }
    }

    /* ----------------------------------------
     * Multi-Force Slot Management
     */

    /**
     * Creates a ForceSlot, sets up WS and change subscriptions for a force.
     */
    private setupForceSlot(force: Force, alignment: ForceAlignment): ForceSlot {
        const slot: ForceSlot = { force, alignment, changeSub: null };
        const instanceId = force.instanceId();
        this.logger.info(`ForceBuilderService: Setting up force slot for "${force.name}"${instanceId ? ` (instance: ${instanceId})` : ''}`);
        if (instanceId) {
            this.wsService.subscribeToForceUpdates(instanceId, (serializedForce: SerializedForce) => {
                if (serializedForce.instanceId !== force.instanceId()) {
                    this.logger.warn(`Received force update for instance ID ${serializedForce.instanceId}, but force has instance ID ${force.instanceId()}. Ignoring.`);
                    return;
                }
                this.replaceForceInPlace(force, serializedForce);
            });
        }
        // Subscribe to force changes for auto-save
        slot.changeSub = force.changed.subscribe(() => {
            if (!force.owned()) {
                // Adopt: clone with fresh IDs, swap into this slot, save the clone
                this.adoptForce(slot);
                return;
            }
            this.dataService.saveForce(force);
            this.logger.info(`ForceBuilderService: Auto-saved force "${force.name}"`);
        });
        return slot;
    }

    /**
     * Adopts a non-owned force by cloning it with fresh IDs,
     * swapping the clone into the slot, and saving it.
     */
    private async adoptForce(slot: ForceSlot): Promise<void> {
        const oldForce = slot.force;
        const selectedIdx = oldForce.units().findIndex(u => u.id === this.selectedUnit()?.id);
        const wasActive = this.currentForce() === oldForce;

        const cloned = oldForce.clone();

        // Delete the old (non-owned) force from local storage only
        const oldInstanceId = oldForce.instanceId();
        if (oldInstanceId) {
            this.dataService.deleteLocalForce(oldInstanceId);
        }

        // Tear down old slot
        this.teardownForceSlot(slot);

        // Re-setup slot with cloned force
        const newSlot = this.setupForceSlot(cloned, slot.alignment);
        this.loadedForces.update(slots => slots.map(s => s === slot ? newSlot : s));

        if (wasActive) {
            this.currentForce.set(cloned);
            const units = cloned.units();
            if (selectedIdx >= 0 && selectedIdx < units.length) {
                this.selectUnit(units[selectedIdx]);
            }
        }

        await this.dataService.saveForce(cloned);
        this.logger.info(`ForceBuilderService: Adopted force "${cloned.name}" with fresh IDs.`);
    }

    /**
     * Tears down a ForceSlot — unsubscribes WS, change subscription, and destroys units.
     */
    private teardownForceSlot(slot: ForceSlot): void {
        slot.changeSub?.unsubscribe();
        slot.changeSub = null;
        const instanceId = slot.force.instanceId();
        if (instanceId) {
            this.wsService.unsubscribeFromForceUpdates(instanceId);
        }
        slot.force.units().forEach(unit => unit.destroy());
    }

    /**
     * Adds a force to the loaded forces list with the given alignment.
     * If no active force is set, this force becomes the active one.
     */
    addLoadedForce(force: Force, alignment: ForceAlignment = 'friendly'): void {
        const slot = this.setupForceSlot(force, alignment);
        this.loadedForces.update(slots => [...slots, slot]);
        if (!this.currentForce()) {
            this.currentForce.set(force);
        }
    }

    /**
     * Removes a specific force from the loaded forces list and cleans up its resources.
     */
    removeLoadedForce(force: Force): void {
        const slot = this.loadedForces().find(s => s.force === force);
        if (!slot) return;

        // Determine switch targets BEFORE teardown (which destroys units)
        const selectedUnit = this.selectedUnit();
        const selectionWasInForce = selectedUnit && force.units().some(u => u.id === selectedUnit.id);
        const wasActiveForce = this.currentForce() === force;
        const remaining = this.loadedForces().filter(s => s !== slot);
        const nextForce = remaining.length > 0 ? remaining[0].force : null;
        const nextUnit = nextForce ? nextForce.units()[0] ?? null : null;

        // Switch active force and selection before teardown
        if (wasActiveForce) {
            this.currentForce.set(nextForce);
        }
        if (selectionWasInForce) {
            this.selectedUnit.set(wasActiveForce ? nextUnit : null);
        }

        // Flush any pending debounced save while the subscription is still alive
        force.flushPendingChanges();

        // Now safe to tear down and remove from the list
        this.teardownForceSlot(slot);
        this.loadedForces.update(slots => slots.filter(s => s !== slot));
    }

    /**
     * Reorders the loaded forces by moving a force from one index to another.
     */
    reorderLoadedForces(previousIndex: number, currentIndex: number): void {
        if (previousIndex === currentIndex) return;
        this.loadedForces.update(slots => {
            const updated = [...slots];
            const [moved] = updated.splice(previousIndex, 1);
            if (moved) updated.splice(currentIndex, 0, moved);
            return updated;
        });
    }

    /**
     * Deletes a force from storage (local + cloud) and removes it from loaded forces.
     * Cancels any pending debounced saves before deletion.
     * Use when a force has been emptied and should be fully cleaned up.
     */
    async deleteAndRemoveForce(force: Force): Promise<void> {
        const forceInstanceId = force.instanceId();
        if (forceInstanceId) {
            force.cancelPendingChanges();
            await this.dataService.deleteForce(forceInstanceId);
            this.logger.info(`ForceBuilderService: Force with instance ID ${forceInstanceId} deleted.`);
        }
        this.removeLoadedForce(force);
        if (this.loadedForces().length === 0) {
            this.clearForceUrlParams();
        }
    }

    /**
     * Sets which loaded force is the "active" one (for adding units, editing, etc.).
     */
    setActiveForce(force: Force | null): void {
        this.currentForce.set(force);
    }

    /**
     * Returns the ForceSlot for a given force, or undefined if not loaded.
     */
    getForceSlot(force: Force): ForceSlot | undefined {
        return this.loadedForces().find(s => s.force === force);
    }

    /**
     * Loads a force by instance ID and adds it to the loaded forces.
     * Used for adding external forces (e.g., from other users).
     * @returns true if the force was loaded and added successfully.
     */
    async addForceById(instanceId: string, alignment: ForceAlignment = 'friendly'): Promise<boolean> {
        // Extract instance ID from a URL if a full link was pasted
        instanceId = this.extractInstanceId(instanceId);

        // Check if already loaded
        if (this.loadedForces().some(s => s.force.instanceId() === instanceId)) {
            this.toastService.showToast('This force is already loaded.', 'info');
            return false;
        }
        const force = await this.dataService.getForce(instanceId);
        if (!force) {
            this.toastService.showToast('Force not found.', 'error');
            return false;
        }
        this.addLoadedForce(force, alignment);
        this.toastService.showToast(`Force "${force.name}" added.`, 'success');
        return true;
    }

    /**
     * Extracts an instance ID from user input. If the input is a URL containing
     * an `instance` query parameter, returns that value. Otherwise returns the
     * input as-is (assumed to already be a plain instance ID).
     */
    private extractInstanceId(input: string): string {
        try {
            const url = new URL(input);
            const instance = url.searchParams.get('instance');
            if (instance) return instance;
        } catch {
            // Not a valid URL — treat as a plain instance ID
        }
        return input;
    }

    /* ----------------------------------------
     * Force Setting / Loading (backward-compatible)
     */

    /**
     * Clears all loaded forces and sets a single force as the only loaded & active force.
     * Pass null to clear everything.
     */
    setForce(newForce: Force | null) {
        this.selectedUnit.set(null);
        // Teardown all existing slots
        for (const slot of this.loadedForces()) {
            this.teardownForceSlot(slot);
        }
        this.loadedForces.set([]);
        this.currentForce.set(null);
        if (newForce) {
            this.addLoadedForce(newForce);
            this.currentForce.set(newForce);
        } else {
            this.clearForceUrlParams();
        }
    }

    /**
     * Handles an incoming WS update for a specific force, updating it in-place.
     */
    private async replaceForceInPlace(targetForce: Force, serializedForce: SerializedForce) {
        if (!targetForce) return;
        try {
            this.urlStateInitialized.set(false);
            const selectedUnitId = this.selectedUnit()?.id;
            // Only restore selection if the selected unit was in this force
            const wasInThisForce = selectedUnitId && targetForce.units().some(u => u.id === selectedUnitId);
            const selectedIndex = wasInThisForce
                ? targetForce.units().findIndex(u => u.id === selectedUnitId)
                : -1;
            targetForce.update(serializedForce);
            this.dataService.saveSerializedForceToLocalStorage(serializedForce);
            // Restore selected unit if it was in this force
            if (wasInThisForce) {
                const newSelectedUnit = targetForce.units().find(u => u.id === selectedUnitId);
                this.selectUnit(newSelectedUnit || targetForce.units()[selectedIndex] || targetForce.units()[0] || null);
            }
        } finally {
            this.urlStateInitialized.set(true);
        }
    }

    async loadForce(force: Force): Promise<boolean> {
        // Prompt to save current force if needed
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) {
            return false; // User cancelled, do not load new force
        }

        this.urlStateInitialized.set(false);
        try {
            this.setForce(force);
            this.selectUnit(force.units()[0] || null);
        } finally {
            this.urlStateInitialized.set(true);
        }
        return true;
    }

    /**
     * Adds a force to the loaded forces without replacing existing ones.
     * Unlike loadForce(), this preserves currently loaded forces.
     */
    async addForce(force: Force, alignment: ForceAlignment = 'friendly'): Promise<boolean> {
        this.urlStateInitialized.set(false);
        try {
            this.addLoadedForce(force, alignment);
            this.setActiveForce(force);
            this.selectUnit(force.units()[0] || null);
        } finally {
            this.urlStateInitialized.set(true);
        }
        return true;
    }

    async removeForce() {
        // Prompt to save current force if needed
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) {
            return false; // User cancelled
        }
        const forceToRemove = this.currentForce();
        if (forceToRemove) {
            this.removeLoadedForce(forceToRemove);
        } else {
            this.setForce(null);
        }
        if (this.loadedForces().length === 0) {
            this.clearForceUrlParams();
        }
        this.logger.info('ForceBuilderService: Force removed.');
        return true;
    }

    /**
     * Removes all loaded forces and resets to a clean state.
     */
    async removeAllForces() {
        const shouldContinue = await this.promptSaveForceIfNeeded();
        if (!shouldContinue) return false;
        this.setForce(null);
        this.logger.info('ForceBuilderService: All forces removed.');
        return true;
    }

    private clearForceUrlParams() {
        this.urlStateService.setParams({
            units: null,
            name: null,
            instance: null
        });
    }

    async createNewForce(name: string = 'New Force'): Promise<Force | null> {
        // Lazy inject GameService to avoid circular dependency
        const gameService = this.injector.get(GameService);
        const gameSystem = gameService.currentGameSystem();
        let newForce: Force | null = null;
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            newForce = new ASForce(name, this.dataService, this.unitInitializer, this.injector);
        } else {
            newForce = new CBTForce(name, this.dataService, this.unitInitializer, this.injector);
        }
        if (newForce && !await this.loadForce(newForce)) {
            return null;
        }
        return newForce;
    }

    /**
     * Adds a new unit to the force. The unit is cloned to prevent
     * modifications to the original object, and it's set as the
     * currently selected unit.
     * @param unit The unit to add.
     * @param gunnerySkill Optional gunnery skill to set for the crew
     * @param pilotingSkill Optional piloting skill to set for the crew
     */
    async addUnit(unit: Unit, gunnerySkill?: number, pilotingSkill?: number, group?: UnitGroup): Promise<ForceUnit | null> {
        let currentForce = this.currentForce();
        if (!currentForce) {
            currentForce = await this.createNewForce();
            if (!currentForce) {
                return null;
            }
        }
        let newForceUnit;
        try {
            newForceUnit = currentForce.addUnit(unit, group);
        } catch (error) {
            this.toastService.showToast(error instanceof Error ? error.message : (error as string), 'error');
            return null;
        }

        // Set crew skills if provided
        if (gunnerySkill !== undefined || pilotingSkill !== undefined) {
            const crewMembers = newForceUnit.getCrewMembers();
            newForceUnit.disabledSaving = true;
            if (unit.type === 'ProtoMek') {
                // ProtoMeks have a fixed Piloting skill of 5
                pilotingSkill = DEFAULT_PILOTING_SKILL;
            } else
            if (unit.type === 'Infantry') {
                if (!canAntiMech(unit)) {
                    if (unit.subtype === 'Conventional Infantry') {
                        pilotingSkill = NO_ANTIMEK_SKILL;
                    } else {
                        pilotingSkill = DEFAULT_PILOTING_SKILL;
                    }
                }
            }
            for (const crew of crewMembers) {
                if (gunnerySkill !== undefined) {
                    crew.setSkill('gunnery', gunnerySkill);
                }
                if (pilotingSkill !== undefined) {
                    crew.setSkill('piloting', pilotingSkill);
                }
            }

            newForceUnit.disabledSaving = false;
        }

        this.selectUnit(newForceUnit);
        if (currentForce.units().length === 1) {
            this.layoutService.openMenu();
        }
        const unitGroup = group ?? currentForce.groups().find(group => {
            return group.units().some(u => u.id === newForceUnit.id);
        });
        this.generateForceNameIfNeeded();
        if (unitGroup) {
            this.generateGroupNameIfNeeded(unitGroup);
        }
        return newForceUnit;
    }

    /**
     * Sets the provided unit as the currently selected one.
     * @param unit The unit to select.
     */
    selectUnit(unit: ForceUnit) {
        this.selectedUnit.set(unit);
    }

    getNextUnit(current: ForceUnit | null): ForceUnit | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        const units = currentForce.units();
        if (!current || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === current.id);
        if (idx === -1) return null;

        const nextIndex = (idx + 1) % units.length;
        return units[nextIndex] ?? null;
    }

    getPreviousUnit(current: ForceUnit | null): ForceUnit | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        const units = currentForce.units();
        if (!current || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === current.id);
        if (idx === -1) return null;

        const prevIndex = (idx - 1 + units.length) % units.length;
        return units[prevIndex] ?? null;
    }

    /**
     * Selects the next unit in the force list.
     */
    selectNextUnit() {
        const nextUnit = this.getNextUnit(this.selectedUnit());
        if (nextUnit) {
            this.selectUnit(nextUnit);
        }
    }

    /**
     * Selects the previous unit in the force list.
     */
    selectPreviousUnit() {
        const prevUnit = this.getPreviousUnit(this.selectedUnit());
        if (prevUnit) {
            this.selectUnit(prevUnit);
        }
    }

    /**
     * Removes a unit from the force. If the removed unit was selected,
     * it selects the previous unit in the list.
     * @param unitToRemove The unit to remove.
     */
    async removeUnit(unitToRemove: ForceUnit) {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        if (unitToRemove.modified) {
            const unitName = (unitToRemove.getUnit().chassis + ' ' + unitToRemove.getUnit().model).trim();
            const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
                panelClass: 'danger',
                data: <ConfirmDialogData<string>>{
                    title: `Delete Unit`,
                    message: `Removing will discard all marks on the sheet and permanently remove the unit "${unitName}" from the force.`,
                    buttons: [
                        { label: 'DELETE', value: 'delete', class: 'danger' },
                        { label: 'NO', value: 'cancel' }
                    ]
                }
            });
            const result = await firstValueFrom(dialogRef.closed);

            if (result !== 'delete') {
                return;
            }
        }

        const currentUnits = currentForce.units();
        const isLastUnit = currentUnits.length === 1;
        const idx = currentUnits.findIndex(u => u.id === unitToRemove.id);
        const unitGroup = currentForce.groups().find(group => {
            return group.units().some(u => u.id === unitToRemove.id);
        });

        // If this is the last unit, switch force/selection BEFORE removal
        if (isLastUnit) {
            await this.deleteAndRemoveForce(currentForce);
            return;
        }

        currentForce.removeUnit(unitToRemove);
        this.dataService.deleteCanvasDataOfUnit(unitToRemove);

        if (this.selectedUnit()?.id === unitToRemove.id) {
            const updatedUnits = currentForce.units();
            let newSelected: ForceUnit | null = null;
            if (updatedUnits.length > 0) {
                newSelected = updatedUnits[Math.max(0, idx - 1)] ?? updatedUnits[0];
            }
            this.selectedUnit.set(newSelected);
        }

        this.generateForceNameIfNeeded();
        if (unitGroup) {
            this.generateGroupNameIfNeeded(unitGroup);
        }
    }

    /**
     * Replaces a unit in the force with a new one, carrying over pilot info.
     * Shows a confirmation dialog warning about losing damage state.
     * @param originalUnit The ForceUnit to replace
     * @param newUnitData The new Unit data to replace with
     * @returns The new ForceUnit if successful, null if cancelled
     */
    async replaceUnit(originalUnit: ForceUnit, newUnitData: Unit): Promise<ForceUnit | null> {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }

        // Check if the original unit belongs to this force
        const allUnits = currentForce.units();
        if (!allUnits.some(u => u.id === originalUnit.id)) {
            this.toastService.showToast('Unit not found in current force.', 'error');
            return null;
        }

        // Build confirmation message
        const oldUnitName = `${originalUnit.getUnit().chassis} ${originalUnit.getUnit().model}`.trim();
        const newUnitName = `${newUnitData.chassis} ${newUnitData.model}`.trim();

        const result = await this.dialogsService.choose(
            'Change Unit',
            `Replace "${oldUnitName}" with "${newUnitName}"?\n\nThe new unit will be created fresh. Any damage or modifications on the current unit will be lost.\n\nPilot name and skills will be carried over.`,
            [
                { label: 'CHANGE', value: 'change', class: 'primary' },
                { label: 'CANCEL', value: 'cancel' }
            ],
            'cancel'
        );

        if (result !== 'change') {
            return null;
        }

        // Track if this unit was selected
        const wasSelected = this.selectedUnit()?.id === originalUnit.id;

        // Delete canvas data before replacement
        this.dataService.deleteCanvasDataOfUnit(originalUnit);

        // Use the Force model's replaceUnit method for core logic
        const replaceResult = currentForce.replaceUnit(originalUnit, newUnitData);

        if (!replaceResult) {
            this.toastService.showToast('Failed to replace unit.', 'error');
            return null;
        }

        const { newUnit: newForceUnit, group: originalGroup } = replaceResult;

        // Select the new unit if the old one was selected
        if (wasSelected) {
            this.selectUnit(newForceUnit);
        }

        this.generateForceNameIfNeeded();
        if (originalGroup) {
            this.generateGroupNameIfNeeded(originalGroup);
        }

        return newForceUnit;
    }

    public async requestCloneForce() {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        
        const isAlphaStrike = currentForce.gameSystem === GameSystem.ALPHA_STRIKE;
        const targetSystemLabel = isAlphaStrike ? 'CBT' : 'AS';
        
        const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            data: {
                title: 'Clone Force',
                message: 'Create a separate, editable copy of this force. The original will remain unchanged.',
                buttons: [
                    { label: 'CLONE', value: 'clone', class: 'primary' },
                    { label: `CONVERT TO ${targetSystemLabel}`, value: 'convert' },
                    { label: 'DISMISS', value: 'cancel' }
                ]
            } as ConfirmDialogData<string>
        });
        
        const result = await firstValueFrom(dialogRef.closed);
        if (result === 'clone') {
            this.cloneForce();
        } else if (result === 'convert') {
            this.convertForce();
        }
    }

    private async cloneForce(): Promise<boolean> {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return false;
        }

        const selectedIdx = currentForce.units().findIndex(u => u.id === this.selectedUnit()?.id);
        const cloned = currentForce.clone();
        cloned.loading = true;
        try {
            await this.dataService.saveForce(cloned);
        } finally {
            cloned.loading = false;
        }

        // Unload old, load clone
        this.setForce(cloned);
        const units = cloned.units();
        this.selectUnit(selectedIdx >= 0 && selectedIdx < units.length ? units[selectedIdx] : units[0] ?? null);

        this.toastService.showToast(`A copy of this force was created and saved. You can now edit the copy without affecting the original.`, 'success');
        return true;
    }

    /**
     * Converts the current force to the opposite game system (CBT <-> Alpha Strike).
     * Creates a new force with the same name and groups, but fresh units without state.
     */
    private async convertForce(): Promise<boolean> {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return false;
        }

        const isAlphaStrike = currentForce.gameSystem === GameSystem.ALPHA_STRIKE;
        const targetSystemLabel = isAlphaStrike ? 'Classic BattleTech' : 'Alpha Strike';

        // Create new force with opposite game system
        const newForce = isAlphaStrike
            ? new CBTForce(currentForce.name, this.dataService, this.unitInitializer, this.injector)
            : new ASForce(currentForce.name, this.dataService, this.unitInitializer, this.injector);

        newForce.nameLock = currentForce.nameLock;
        newForce.loading = true;

        try {
            const allUnits = this.dataService.getUnits();
            const unitMap = new Map(allUnits.map(u => [u.name, u]));

            // First, clear any default groups
            newForce.groups.set([]);

            // Recreate groups and units - process one group at a time
            for (const sourceGroup of currentForce.groups()) {
                const newGroup = newForce.addGroup(sourceGroup.name());
                newGroup.nameLock = sourceGroup.nameLock;

                for (const sourceUnit of sourceGroup.units()) {
                    const unitName = sourceUnit.getUnit().name;
                    const unit = unitMap.get(unitName);
                    if (!unit) {
                        this.logger.warn(`Unit "${unitName}" not found during conversion`);
                        continue;
                    }

                    // addUnit adds to the last group, which is newGroup since we just created it
                    const newForceUnit = newForce.addUnit(unit);

                    // Transfer pilot data cross-system
                    newForceUnit.disabledSaving = true;
                    try {
                        this.transferPilotDataCrossSystem(sourceUnit, newForceUnit, currentForce.gameSystem, newForce.gameSystem);
                    } finally {
                        newForceUnit.disabledSaving = false;
                    }
                }
            }

            // Set a new instance ID and save
            newForce.instanceId.set(generateUUID());
        } finally {
            newForce.loading = false;
        }

        // Load the new force (this handles URL state and other housekeeping)
        await this.loadForce(newForce);
        this.dataService.saveForce(newForce);

        this.toastService.showToast(`Force converted to ${targetSystemLabel} and saved.`, 'success');
        return true;
    }

    /**
     * Transfers pilot/crew data between ForceUnits of different game systems.
     * AS → CBT: copies pilot name + skill into the first crew member's gunnery.
     * CBT → AS: copies first crew member's name + gunnery into AS pilot fields.
     */
    private transferPilotDataCrossSystem(
        sourceUnit: ForceUnit, targetUnit: ForceUnit,
        sourceSystem: GameSystem, targetSystem: GameSystem
    ): void {
        if (sourceSystem === targetSystem) return;
        if (sourceSystem === GameSystem.ALPHA_STRIKE) {
            // AS → CBT
            const asSource = sourceUnit as ASForceUnit;
            const sourceName = asSource.alias();
            const sourceSkill = asSource.getPilotSkill();
            const newCrew = targetUnit.getCrewMembers();
            if (newCrew.length > 0) {
                if (sourceName) newCrew[0].setName(sourceName);
                newCrew[0].setSkill('gunnery', sourceSkill);
            }
        } else {
            // CBT → AS
            const asTarget = targetUnit as ASForceUnit;
            const sourceCrew = sourceUnit.getCrewMembers();
            if (sourceCrew.length > 0) {
                const name = sourceCrew[0].getName();
                const gunnery = sourceCrew[0].getSkill('gunnery');
                if (name) asTarget.setPilotName(name);
                asTarget.setPilotSkill(gunnery);
            }
        }
    }

    /**
     * Converts a ForceUnit to be compatible with a target force of a different game system.
     * Creates a new ForceUnit and transfers pilot/crew data cross-system.
     * @returns The converted ForceUnit (not yet added to any group), or null if the unit data wasn't found.
     */
    convertUnitForForce(sourceUnit: ForceUnit, sourceForce: Force, targetForce: Force): ForceUnit | null {
        const unitName = sourceUnit.getUnit()?.name;
        if (!unitName) return null;
        const allUnits = this.dataService.getUnits();
        const unitData = allUnits.find(u => u.name === unitName);
        if (!unitData) return null;
        const newUnit = targetForce.createCompatibleUnit(unitData);
        newUnit.disabledSaving = true;
        try {
            this.transferPilotDataCrossSystem(sourceUnit, newUnit, sourceForce.gameSystem, targetForce.gameSystem);
        } finally {
            newUnit.disabledSaving = false;
        }
        return newUnit;
    }

    private generateForceNameIfNeeded() {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        if (!currentForce.nameLock) {
            currentForce.setName(this.generateForceName(), false);
        }
    }

    public generateGroupNameIfNeeded(group: UnitGroup) {
        if (!group.nameLock && group.units().length > 0) {
            group.setName(this.generateGroupName(group), false);
        }
    }
    public generateForceName(): string {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return '';
        }
        return ForceNamerUtil.generateForceName({
            units: currentForce.units(),
            factions: this.dataService.getFactions(),
            eras: this.dataService.getEras()
        });
    }

    public generateGroupName(group: UnitGroup): string {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return '';
        }
        return ForceNamerUtil.generateFormationName({
            units: group.units(),
            allUnits: currentForce.units(),
            forceName: currentForce.name,
            gameSystem: currentForce.gameSystem
        });
    }

    public getAllFactionsAvailable(): Map<string, number> | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        return ForceNamerUtil.getAvailableFactions(
            currentForce.units(),
            this.dataService.getFactions(),
            this.dataService.getEras()
        );
    }

    public getAllFormationsAvailable(group: UnitGroup): string[] | null {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return null;
        }
        return ForceNamerUtil.getAvailableFormations(
            group.units(),
            currentForce.units(),
            currentForce.name,
            currentForce.gameSystem
        );
    }

    public async repairAllUnits() {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return false;
        }
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to repair all units? This will reset all damage and status effects on every unit in the force.',
            'Repair All Units',
            'info');
        if (confirmed) {
            currentForce.units().forEach(fu => {
                fu.repairAll();
            });
            return true;
        };
        return false;
    }

    public addGroup(): UnitGroup {
        const currentForce = this.currentForce();
        if (!currentForce) {
            throw new Error('No current force to add a group to.');
        }
        return currentForce.addGroup();
    }

    public removeGroup(group: UnitGroup) {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }
        currentForce.removeGroup(group);
    }

    public shareForce(): void {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        this.dialogsService.createDialog(ShareForceDialogComponent, {
            data: { force: currentForce }
        });
    }

    public showForceOverview(): void {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        this.dialogsService.createDialog(ForceOverviewDialogComponent, {
            data: { force: currentForce }
        });
    }

    public showC3NetworkForCurrentForce(): void {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        this.openC3Network(currentForce, this.readOnlyForce());
    }

    public printAll(): void {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        // Lazy-inject UI services to avoid circular dependencies
        const appRef = this.injector.get(ApplicationRef);
        if (currentForce instanceof CBTForce) {
            const sheetService = this.injector.get(SheetService);
            const optionsService = this.injector.get(OptionsService);
            CBTPrintUtil.multipagePrint(sheetService, optionsService, currentForce.units());
        } else if (currentForce instanceof ASForce) {
            const optionsService = this.injector.get(OptionsService);
            ASPrintUtil.multipagePrint(appRef, this.injector, optionsService, currentForce.groups());
        }
    }

    /* ----------------------------------------
     * Remote conflict detection and resolution
     */

    private monitorWebSocketConnection() {
        // Monitor WebSocket connection state changes
        effect(() => {
            const isConnected = this.wsService.wsConnected();
            if (isConnected) {
                // WebSocket just came online - fire and forget :D
                untracked(() => {
                    this.checkForCloudConflict();
                });
            }
        });
    }

    private async checkForCloudConflict(): Promise<void> {
        // Check all loaded forces for conflicts
        for (const slot of this.loadedForces()) {
            const force = slot.force;
            const instanceId = force.instanceId();
            if (!instanceId) continue;
            this.logger.info('Checking for cloud conflict for force with instance ID ' + instanceId);
            try {
                const cloudForce = await this.dataService.getForce(instanceId, force.owned());
                if (!cloudForce) continue;
                const localTimestamp = force.timestamp ? new Date(force.timestamp).getTime() : 0;
                const cloudTimestamp = cloudForce.timestamp ? new Date(cloudForce.timestamp).getTime() : 0;

                if (cloudTimestamp > localTimestamp) {
                    this.logger.warn(`Conflict detected for force "${force.name}" (${instanceId}).`);
                    if (!force.owned()) {
                        this.logger.info(`ForceBuilderService: Force "${force.name}" downloading cloud version.`);
                        this.urlStateInitialized.set(false);
                        try {
                            this.replaceForceInPlace(force, await this.dataService.getForce(instanceId, false) as any);
                        } finally {
                            this.urlStateInitialized.set(true);
                        }
                        this.toastService.showToast(`Cloud version of "${force.name}" loaded.`, 'success');
                        continue;
                    }
                    await this.handleCloudConflict(force, cloudForce, localTimestamp, cloudTimestamp);
                }
            } catch (error) {
                this.logger.error(`Error checking for cloud conflict on "${force.name}": ${error}`);
            }
        }
    }

    private async handleCloudConflict(localForce: Force, cloudForce: Force, localTimestamp: number, cloudTimestamp: number): Promise<void> {
        const formatDate = (timestamp: number) => {
            if (!timestamp) return 'Unknown';
            return new Date(timestamp).toLocaleString();
        };
        if (this.conflictDialogRef) {
            this.conflictDialogRef.close();
            this.conflictDialogRef = undefined;
        }
        this.conflictDialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            panelClass: 'info',
            disableClose: true,
            data: <ConfirmDialogData<string>>{
                title: 'Sync Conflict Detected',
                message: `"${localForce.name}" was modified on another device while you were offline. The cloud version is newer. (${formatDate(cloudTimestamp)} > ${formatDate(localTimestamp)})`,
                buttons: [
                    { label: 'LOAD CLOUD', value: 'cloud', class: 'primary' },
                    { label: 'KEEP LOCAL', value: 'local' },
                    { label: 'CLONE LOCAL', value: 'cloneLocal' }
                ]
            }
        });

        const result = await firstValueFrom(this.conflictDialogRef.closed);
        if (result === 'cloud') {
            // Replace the local force in-place with the cloud version
            const serialized = cloudForce.serialize();
            localForce.update(serialized);
            await this.dataService.saveForce(localForce, true);
            this.toastService.showToast(`Cloud version of "${localForce.name}" loaded.`, 'success');
        } else if (result === 'local') {
            localForce.timestamp = new Date().toISOString();
            await this.dataService.saveForce(localForce);
            this.toastService.showToast(`Local version of "${localForce.name}" kept and synced.`, 'success');
        } else if (result === 'cloneLocal') {
            const selectedIdx = localForce.units().findIndex(u => u.id === this.selectedUnit()?.id);
            const slot = this.getForceSlot(localForce);
            const alignment = slot?.alignment ?? 'friendly';
            const cloned = localForce.clone();
            cloned.setName(localForce.name + ' (Cloned)', false);

            // Unload old, load clone
            this.removeLoadedForce(localForce);
            this.addLoadedForce(cloned, alignment);
            this.setActiveForce(cloned);
            const units = cloned.units();
            if (selectedIdx >= 0 && selectedIdx < units.length) {
                this.selectUnit(units[selectedIdx]);
            }
            await this.dataService.saveForce(cloned, true);
            this.toastService.showToast('Local version has been cloned', 'success');
        }
    }


    /* ----------------------------------------
     * URL State Management
     */

    private updateUrlOnForceChange() {
        effect(() => {
            const params = this.queryParameters();
            if (!this.urlStateInitialized()) {
                return;
            }
            // Use centralized URL state service to avoid race conditions
            this.urlStateService.setParams({
                gs: params.gs,
                units: params.units,
                name: params.name,
                instance: params.instance
            });
        });
    }

    /** URL params representing ALL loaded forces. */
    queryParameters = computed<ForceQueryParams>(() => buildMultiForceQueryParams(this.loadedForces()));

    private loadUnitsFromUrlOnStartup() {
        effect(() => {
            const isDataReady = this.dataService.isDataReady();
            // This effect runs when data is ready, but we only execute the logic once.
            if (isDataReady && !this.urlStateInitialized()) {
                // Fire the async work without awaiting
                untracked(() => {
                    this.initializeFromUrl();
                });
            }
        });
    }

    private async initializeFromUrl(): Promise<void> {
        // Use UrlStateService to get initial URL params (captured before any routing effects)
        const instanceParam = this.urlStateService.getInitialParam('instance');
        let loadedAnyInstance = false;

        if (instanceParam) {
            // Support comma-separated instance IDs for multi-force URLs
            // Format: UUID1,enemy:UUID2,UUID3 — 'enemy:' prefix marks enemy alignment
            const entries = instanceParam.split(',').map(e => e.trim()).filter(e => e.length > 0);
            const loadedForces: { force: Force; alignment: ForceAlignment }[] = [];

            for (const entry of entries) {
                let alignment: ForceAlignment = 'friendly';
                let instanceId = entry;
                if (entry.startsWith('enemy:')) {
                    alignment = 'enemy';
                    instanceId = entry.substring('enemy:'.length);
                }
                const force = await this.dataService.getForce(instanceId);
                if (force) {
                    if (!loadedAnyInstance) {
                        // First instance: set as the primary force
                        this.setForce(force);
                        // Update alignment if enemy (setForce defaults to friendly)
                        if (alignment === 'enemy') {
                            const slot = this.getForceSlot(force);
                            if (slot) slot.alignment = alignment;
                        }
                        this.selectUnit(force.units()[0]);
                    } else {
                        // Additional instances: add alongside existing forces
                        this.addLoadedForce(force, alignment);
                    }
                    loadedForces.push({ force, alignment });
                    loadedAnyInstance = true;
                } else {
                    this.logger.warn(`ForceBuilderService: Instance "${instanceId}" not found, skipping.`);
                }
            }

            // Show notice only when ALL loaded forces are non-owned (no mix)
            if (loadedForces.length > 0 && loadedForces.every(f => !f.force.owned())) {
                this.dialogsService.showNotice('Reports indicate another commander owns this force. Clone to adopt it for yourself.', 'Captured Intel');
            }
            if (!loadedAnyInstance) {
                // None of the instance IDs were found — clear them from URL
                this.urlStateService.setParams({ instance: null });
            }
        }

        // Also check for an unsaved force (units param) — can coexist with saved forces
        const unitsParam = this.urlStateService.getInitialParam('units');
        if (unitsParam) {
            const forceNameParam = this.urlStateService.getInitialParam('name');
            const gameSystemParam = this.urlStateService.getInitialParam('gs') ?? GameSystem.CLASSIC;
            let newForce: Force;
            if (gameSystemParam === GameSystem.ALPHA_STRIKE) {
                newForce = new ASForce('New Force', this.dataService, this.unitInitializer, this.injector);
            } else {
                newForce = new CBTForce('New Force', this.dataService, this.unitInitializer, this.injector);
            }
            newForce.loading = true;
            try {
                if (forceNameParam) {
                    newForce.setName(forceNameParam);
                }
                const forceUnits = this.parseUnitsFromUrl(newForce, unitsParam);
                if (forceUnits.length > 0) {
                    this.logger.info(`ForceBuilderService: Loaded ${forceUnits.length} units from URL on startup.`);
                    newForce.removeEmptyGroups();
                    if (this.layoutService.isMobile()) {
                        this.layoutService.openMenu();
                    }
                }
            } finally {
                newForce.loading = false;
            }
            if (newForce.units().length > 0) {
                if (!loadedAnyInstance) {
                    // No saved forces loaded — unsaved force is the primary
                    this.setForce(newForce);
                } else {
                    // Saved forces already loaded — add unsaved alongside
                    this.addLoadedForce(newForce);
                }
                this.selectUnit(newForce.units()[0]);
            }
        }

        // Mark as initialized so the update effect can start running.
        this.urlStateInitialized.set(true);
        // Signal that we're done reading URL state
        this.urlStateService.markConsumerReady('force-builder');
    }

    /**
     * Parses units from URL parameter with group support.
     * New format: groupName~unit1,unit2|groupName2~unit3,unit4
     * Legacy format (backward compatible): unit1,unit2,unit3
     */
    private parseUnitsFromUrl(force: Force, unitsParam: string): ForceUnit[] {
        return parseForceFromUrl(force, unitsParam, this.dataService.getUnits(), this.logger);
    }


    /* ----------------------------------------
     * Force Load and Pack Dialogs
     */

    async showLoadForceDialog(): Promise<void> {
        const ref = this.dialogsService.createDialog<ForceLoadDialogResult>(ForceLoadDialogComponent);
        const envelope = await firstValueFrom(ref.closed);
        
        if (!envelope) return;
        const { result, mode } = envelope;
        const isAdd = mode === 'add';

        if (result instanceof LoadForceEntry) {
            const requestedForce = await this.dataService.getForce(result.instanceId, true);
            if (!requestedForce) {
                this.toastService.showToast('Failed to load force.', 'error');
                return;
            }
            if (isAdd) {
                await this.addForce(requestedForce);
            } else {
                await this.loadForce(requestedForce);
            }
        } else {
            // Force pack with customized units (ResolvedPack)
            const pack = result as ResolvedPack;
            
            if (pack.units && pack.units.length > 0) {
                if (isAdd) {
                    // In add mode, create a new force and add it alongside existing ones
                    const gameService = this.injector.get(GameService);
                    const gameSystem = gameService.currentGameSystem();
                    let newForce: Force;
                    if (gameSystem === GameSystem.ALPHA_STRIKE) {
                        newForce = new ASForce('New Force', this.dataService, this.unitInitializer, this.injector);
                    } else {
                        newForce = new CBTForce('New Force', this.dataService, this.unitInitializer, this.injector);
                    }
                    await this.addForce(newForce);
                    const group = this.addGroup();
                    for (const unit of pack.units) {
                        if (!unit?.unit) continue;
                        this.addUnit(unit.unit, undefined, undefined, group);
                    }
                } else {
                    await this.createNewForce();
                    const group = this.addGroup();
                    for (const unit of pack.units) {
                        if (!unit?.unit) continue;
                        this.addUnit(unit.unit, undefined, undefined, group);
                    }
                }
            }
        }
    }

    async showForcePackDialog(): Promise<void> {
        const ref = this.dialogsService.createDialog<ForcePackDialogResult>(ForcePackDialogComponent);
        const units = await firstValueFrom(ref.closed);

        if (units && units.length > 0) {
            const group = this.addGroup();
            for (const entry of units) {
                if (!entry?.unit) continue;
                this.addUnit(entry.unit, undefined, undefined, group);
            }
        }
    }

    async promptChangeForceName() {
        const targetForce = this.currentForce();
        if (!targetForce) {
            return;
        }
        const dialogRef = this.dialogsService.createDialog<string | null>(RenameForceDialogComponent, {
            data: {
                force: targetForce
            } as RenameForceDialogData
        });
        const newName = await firstValueFrom(dialogRef.closed);
        if (newName !== null && newName !== undefined) {
            if (newName === '') {
                targetForce.nameLock = false; // Unlock name if empty
                targetForce.setName(this.generateForceName());
            } else {
                targetForce.nameLock = true; // Lock name after manual change
                targetForce.setName(newName.trim());
            }
        }
    }

    /**
     * Saves the current force after prompting the user to confirm/edit the force name.
     * Shows a rename dialog first, then saves the force if the user confirms.
     * @returns true if the force was saved successfully, false otherwise
     */
    async saveForceWithNameConfirmation(): Promise<boolean> {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return false;
        }
        
        // Show rename dialog to confirm/edit force name
        const dialogRef = this.dialogsService.createDialog<string | null>(RenameForceDialogComponent, {
            data: {
                force: currentForce,
                hideUnset: true
            } as RenameForceDialogData
        });
        
        const newName = await firstValueFrom(dialogRef.closed);
        
        // User cancelled the dialog
        if (newName === null || newName === undefined) {
            return false;
        }
        
        // Update force name based on dialog result
        if (newName === '') {
            currentForce.nameLock = false;
            currentForce.setName(this.generateForceName());
        } else {
            currentForce.nameLock = true;
            currentForce.setName(newName.trim());
        }
        
        // Save the force
        try {
            await this.dataService.saveForce(currentForce);
            this.toastService.showToast('Force saved successfully.', 'success');
            return true;
        } catch (error) {
            this.logger.error('Error saving force: ' + error);
            this.toastService.showToast('Failed to save force.', 'error');
            return false;
        }
    }

    async promptChangeGroupName(group: UnitGroup) {
        const dialogRef = this.dialogsService.createDialog<string | null>(RenameGroupDialogComponent, {
            data: {
                group: group
            } as RenameGroupDialogData
        });
        const newName = await firstValueFrom(dialogRef.closed);

        if (newName !== null && newName !== undefined) {
            if (newName === '') {
                group.nameLock = false; // Unlock name if empty
                group.setName(this.generateGroupName(group));
            } else {
                group.nameLock = true; // Lock name after manual change
                group.setName(newName.trim());
            }
        }
    }

    async promptSaveForceIfNeeded() {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return true;
        }
        if (currentForce.instanceId() || currentForce.units().length == 0) {
            return true;
        }
        // We have a force without an instanceId, so we ask the user if they want to save it
        const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<string>>{
                title: 'Unsaved Force',
                message: 'You have an unsaved force. Do you want to save it before proceeding?',
                buttons: [
                    { label: 'YES', value: 'yes' },
                    { label: 'NO', value: 'no', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' }
                ]
            }
        });
        const result = await firstValueFrom(dialogRef.closed);

        if (result === 'yes') {
            this.dataService.saveForce(currentForce).catch(err => {
                this.logger.error('Error saving force: ' + err);
            });
        } else if (result === 'no') {
        } else {
            return false; // Exit if user cancels
        }
        return true;
    }


    public async editPilotOfUnit(unit: ForceUnit, pilot?: CrewMember): Promise<void> {
        if (unit.readOnly()) return;
        const baseUnit = unit.getUnit();
        if (!baseUnit) return;

        // Handle Alpha Strike units
        if (unit instanceof ASForceUnit) {
            await this.editASPilot(unit);
            return;
        }

        // Handle Classic BattleTech units
        if (!pilot) {
            const crewMembers = unit.getCrewMembers();
            if (crewMembers.length === 0) {
                this.toastService.showToast('This unit has no crew to edit.', 'error');
                return;
            }
            pilot = crewMembers[0];
        }
        const disablePiloting = baseUnit.type === 'ProtoMek' || ((baseUnit.type === 'Infantry') && (!canAntiMech(baseUnit)));
        let labelPiloting;
        if (baseUnit.type === 'Infantry') {
            labelPiloting = 'Anti-Mech';
        } else if (baseUnit.type === 'Naval' || baseUnit.type === 'Tank' || baseUnit.type === 'VTOL') {
            labelPiloting = 'Driving';
        } else {
            labelPiloting = 'Piloting';
        }
        const ref = this.dialogsService.createDialog<EditPilotResult | null, EditPilotDialogComponent, EditPilotDialogData>(
            EditPilotDialogComponent,
            {
                data: {
                    name: pilot.getName(),
                    gunnery: pilot.getSkill('gunnery'),
                    piloting: pilot.getSkill('piloting'),
                    labelGunnery: `Gunnery Skill`,
                    labelPiloting: `${labelPiloting} Skill`,
                    disablePiloting: disablePiloting,
                }
            }
        );

        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        if (result.name !== undefined && result.name !== pilot.getName()) {
            pilot.setName(result.name);
        }
        if (result.gunnery !== undefined) {
            pilot.setSkill('gunnery', result.gunnery);
        }
        if (result.piloting !== undefined) {
            pilot.setSkill('piloting', result.piloting);
        }
    };

    /**
     * Opens the edit dialog for an Alpha Strike unit's pilot.
     */
    private async editASPilot(unit: ASForceUnit): Promise<void> {
        const ref = this.dialogsService.createDialog<EditASPilotResult | null, EditASPilotDialogComponent, EditASPilotDialogData>(
            EditASPilotDialogComponent,
            {
                data: {
                    name: unit.alias() || '',
                    skill: unit.pilotSkill(),
                    abilities: unit.pilotAbilities(),
                }
            }
        );

        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        if (result.name !== undefined) {
            const newName = result.name.trim() || undefined;
            if (newName !== unit.alias()) {
                unit.setPilotName(newName);
            }
        }
        if (result.skill !== undefined && result.skill !== unit.pilotSkill()) {
            unit.setPilotSkill(result.skill);
        }
        if (result.abilities !== undefined) {
            const currentAbilities = unit.pilotAbilities();
            const abilitiesChanged = result.abilities.length !== currentAbilities.length ||
                result.abilities.some((a, i) => {
                    const current = currentAbilities[i];
                    // Both are strings (standard abilities)
                    if (typeof a === 'string' && typeof current === 'string') {
                        return a !== current;
                    }
                    // Both are objects (custom abilities)
                    if (typeof a === 'object' && typeof current === 'object') {
                        return a.name !== current.name || a.cost !== current.cost || a.summary !== current.summary;
                    }
                    // Different types
                    return true;
                });
            if (abilitiesChanged) {
                unit.setPilotAbilities(result.abilities);
            }
        }
    }

    /**
     * Opens the C3 Network dialog for configuring C3 networks.
     * @param force The force to configure networks for
     * @param readOnly Whether the dialog should be read-only
     */
    public async openC3Network(force: Force, readOnly: boolean = false): Promise<void> {
        const ref = this.dialogsService.createDialog<C3NetworkDialogResult>(C3NetworkDialogComponent, {
            data: <C3NetworkDialogData>{
                force: force,
                readOnly: readOnly
            },
            width: '100dvw',
            height: '100dvh',
            maxWidth: '100dvw',
            maxHeight: '100dvh',
            panelClass: 'c3-network-dialog-panel'
        });

        const result = await firstValueFrom(ref.closed);
        if (result?.updated) {
            force.setNetwork(result.networks);
            this.toastService.showToast('C3 network configuration changed', 'success');
        }
    }

}