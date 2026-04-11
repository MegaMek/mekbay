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
import type { Unit } from '../models/units.model';
import { type Force, type UnitGroup, MAX_GROUPS, MAX_UNITS } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import { DataService } from './data.service';
import { LayoutService } from './layout.service';
import { ForceNamerUtil } from '../utils/force-namer.util';
import { getFactionImg, type Faction } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { firstValueFrom, Subject } from 'rxjs';
import { RenameForceDialogComponent, type RenameForceDialogData, type RenameForceDialogResult } from '../components/rename-force-dialog/rename-force-dialog.component';
import { RenameGroupDialogComponent, type RenameGroupDialogData, type RenameGroupDialogResult } from '../components/rename-group-dialog/rename-group-dialog.component';
import { UnitInitializerService } from './unit-initializer.service';
import { DialogsService, type DialogRef } from './dialogs.service';
import { generateUUID, WsService } from './ws.service';
import { ToastService } from './toast.service';
import { LoggerService } from './logger.service';
import { SheetService } from './sheet.service';
import { OptionsService } from './options.service';
import { LoadForceEntry, type LoadForceUnit } from '../models/load-force-entry.model';
import { ForceLoadDialogComponent, type ForceLoadDialogResult } from '../components/force-load-dialog/force-load-dialog.component';
import { ForcePackDialogComponent, type ForcePackDialogResult } from '../components/force-pack-dialog/force-pack-dialog.component';
import type { SearchForceGeneratorDialogResult } from '../components/search-force-generator-dialog/search-force-generator-dialog.component';
import type { SerializedForce } from '../models/force-serialization';
import { EditPilotDialogComponent, type EditPilotDialogData, type EditPilotResult } from '../components/edit-pilot-dialog/edit-pilot-dialog.component';
import { EditASPilotDialogComponent, type EditASPilotDialogData, type EditASPilotResult } from '../components/edit-as-pilot-dialog/edit-as-pilot-dialog.component';
import { ShareForceDialogComponent } from '../components/share-force-dialog/share-force-dialog.component';
import { FormationInfoDialogComponent, type FormationInfoDialogData } from '../components/formation-info-dialog/formation-info-dialog.component';
import type { CrewMember } from '../models/crew-member.model';
import { GameSystem } from '../models/common.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { GameService } from './game.service';
import { UrlStateService } from './url-state.service';
import { canAntiMech } from '../utils/infantry.util';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';
import type { ResolvedPack } from '../utils/force-pack.util';
import { buildMultiForceQueryParams, parseForceFromUrl, type ForceQueryParams, type ForceUrlUnitLookupMode } from '../utils/force-url.util';
import { CBTPrintUtil } from '../utils/cbtprint.util';
import { ASPrintUtil } from '../utils/asprint.util';
import type { ForceSlot, ForceAlignment } from '../models/force-slot.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { FormationAbilityAssignmentUtil } from '../utils/formation-ability-assignment.util';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { getPositiveFactionNamesFromFilter } from '../utils/faction-filter.util';
import { getSelectedPositiveDropdownNames } from '../utils/unit-search-shared.util';
import { type SerializedOperation, LoadOperationEntry, type OperationForceRef } from '../models/operation.model';
import { SaveOperationDialogComponent, type OperationDialogData, type OperationDialogResult } from '../components/save-operation-dialog/save-operation-dialog.component';
import type { OpPreviewForce } from '../components/op-preview/op-preview.component';
import { ForceLoadingOverlayComponent, type ForceLoadingOverlayData, type ForceLoadingProgress } from '../components/force-loading-overlay/force-loading-overlay.component';
import type { PrintAllOptions } from '../models/print-options.model';

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

    public selectedUnit = signal<ForceUnit | null>(null, { equal: () => false });
    public loadedForces = signal<ForceSlot[]>([]);

    /** Emits whenever a force is successfully loaded via loadForceEntry. */
    public readonly forceLoaded$ = new Subject<void>();

    /** Derived from selectedUnit: the force that owns the currently selected unit. */
    public currentForce = computed<Force | null>(() => {
        return this.selectedUnit()?.force ?? null;
    });
    /** Return the currently targettable owned force, if any. */
    public smartCurrentForce = computed<Force | null>(() => {
        const ownedSlots = this.loadedForces().filter(s => s.force.owned());
        if (ownedSlots.length === 1) return ownedSlots[0].force;
        return this.currentForce();
    });
    private urlStateInitialized = signal(false);
    /** Guards initializeFromUrl so it only runs once (at startup). */
    private urlInitRan = false;
    private conflictDialogRef: any;

    /** Current alignment filter: 'all' shows everything, 'friendly'/'enemy' filters by alignment. */
    public alignmentFilter = signal<'friendly' | 'enemy' | 'all'>('friendly');

    /** Remembers the last selected unit per filter mode so switching back restores it. */
    private savedSelectionByFilter = new Map<'friendly' | 'enemy' | 'all', string | null>();
    followLastModifiedUnit = signal(false); // If true, selection will follow the last modified unit

    /** True when loaded forces have a mix of friendly and enemy alignments (>1 slot). */
    hasMixedAlignments = computed<boolean>(() => {
        const slots = this.loadedForces();
        if (slots.length < 2) return false;
        const alignments = new Set(slots.map(s => s.alignment));
        return alignments.has('friendly') && alignments.has('enemy');
    });

    /** Emits when a force is updated remotely via WS, with the force and its alignment. */
    public remoteForceUpdated$ = new Subject<{ force: Force; alignment: ForceAlignment }>();

    /** The currently loaded operation, if any. */
    public currentOperation = signal<LoadOperationEntry | null>(null);

    /** Whether an operation is currently loaded. */
    hasOperation = computed<boolean>(() => this.currentOperation() !== null);

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

        // Auto-reset alignment filter when mixed alignments no longer apply
        effect(() => {
            if (!this.hasMixedAlignments()) {
                const slots = this.loadedForces();
                const onlyAlignment = slots.length > 0 ? slots[0].alignment : 'friendly';
                this.alignmentFilter.set(onlyAlignment);
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


    /** All units across all loaded forces (flat list). */
    allLoadedUnits = computed<ForceUnit[]>(() => {
        return this.loadedForces().flatMap(s => s.force.units());
    });
    /** True when a force is loaded (non-null). */
    hasForces = computed<boolean>(() => this.loadedForces().length > 0);
    /** Current force's game system, or null. */
    forceGameSystem = computed<GameSystem | null>(() => this.smartCurrentForce()?.gameSystem ?? null);

    /** Cycles the alignment filter: all → friendly → enemy → all. Auto-resets if conditions no longer apply. */
    cycleAlignmentFilter(): void {
        const current = this.alignmentFilter();

        // Save the current selection for this filter mode
        this.savedSelectionByFilter.set(current, this.selectedUnit()?.id ?? null);

        // Determine next filter
        let next: 'friendly' | 'enemy';
        if (current === 'enemy') {
            next = 'friendly';
        } else {
            next = 'enemy';
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
        this.logger.info(`ForceBuilderService: Setting up force slot for "${force.displayName()}"${instanceId ? ` (instance: ${instanceId})` : ''}`);
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
            this.logger.info(`ForceBuilderService: Auto-saved force "${force.displayName()}"`);
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
            const units = cloned.units();
            if (selectedIdx >= 0 && selectedIdx < units.length) {
                this.selectUnit(units[selectedIdx]);
            } else {
                this.selectUnit(units[0] ?? null);
            }
        }

        await this.dataService.saveForce(cloned);
        this.logger.info(`ForceBuilderService: Adopted force "${cloned.displayName()}" with fresh IDs.`);
    }

    /**
     * Tears down a ForceSlot: unsubscribes WS, change subscription, and destroys units.
     */
    private teardownForceSlot(slot: ForceSlot): void {
        // Flush any pending debounced save while the subscription is still alive
        slot.force.flushPendingChanges();
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
     * By default, selects the first unit of the added force and switches
     * the alignment filter if necessary so the new force is visible.
     * Pass `activate: false` to just add the slot without switching selection/filter.
     */
    addLoadedForce(force: Force, alignment: ForceAlignment = 'friendly', { activate = true }: { activate?: boolean } = {}): void {
        // Guard against duplicate instanceIds (can occur from concurrent async loads)
        const instanceId = force.instanceId();
        if (instanceId && this.loadedForces().some(s => s.force.instanceId() === instanceId)) {
            this.logger.warn(`ForceBuilderService: Skipping duplicate force "${force.displayName()}" (instance: ${instanceId})`);
            return;
        }
        const slot = this.setupForceSlot(force, alignment);
        this.loadedForces.update(slots => [...slots, slot]);

        if (activate) {
            // Ensure the new force is visible under the current filter
            const filter = this.alignmentFilter();
            if (filter !== 'all' && filter !== alignment) {
                this.alignmentFilter.set(alignment);
            }

            // Activate the new force by selecting its first unit
            this.selectUnit(force.units()[0] ?? null);
        }
    }

    /**
     * Removes a specific force from the loaded forces list and cleans up its resources.
     */
    async removeLoadedForce(force: Force, options: { skipPrompt?: boolean } = {}): Promise<void> {
        const slot = this.loadedForces().find(s => s.force === force);
        if (!slot) return;

        const shouldProceed = options.skipPrompt ? true : await this.promptSaveForceIfNeeded(force);
        if (!shouldProceed) {
            return;
        }

        // Determine switch targets BEFORE teardown (which destroys units)
        const selectedUnit = this.selectedUnit();
        const selectionWasInForce = selectedUnit && force.units().some(u => u.id === selectedUnit.id);
        const remaining = this.loadedForces().filter(s => s !== slot);
        const nextUnit = remaining.length > 0 ? remaining[0].force.units()[0] ?? null : null;

        // Switch selection before teardown
        if (selectionWasInForce) {
            this.selectedUnit.set(nextUnit);
        }

        // Now safe to tear down and remove from the list
        this.teardownForceSlot(slot);
        this.loadedForces.update(slots => slots.filter(s => s !== slot));

        // If the last force was removed, silently clear the operation
        // (no save prompt, there are no forces left to save)
        if (this.loadedForces().length === 0) {
            this.currentOperation.set(null);
        }
    }

    async clear(): Promise<boolean> {
        // Prompt to save/update operation BEFORE removing forces
        const opProceed = await this.promptSaveOperationIfNeeded();
        if (!opProceed) return false;

        const cleared = await this.removeAllForces();
        if (cleared) {
            this.currentOperation.set(null);
        }
        return cleared;
    }

    async removeAllForces(): Promise<boolean> {
        const shouldProceed = await this.checkAllForcesPromptSaveForceIfNeeded();
        if (!shouldProceed) {
            return false;
        }
        for (const slot of this.loadedForces()) {
            this.teardownForceSlot(slot);
        }
        this.selectedUnit.set(null);
        this.loadedForces.set([]);
        this.clearForceUrlParams();
        this.logger.info('ForceBuilderService: All forces removed.');
        return true;
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
        await this.removeLoadedForce(force, { skipPrompt: true });
        if (this.loadedForces().length === 0) {
            // Silently clear, no forces left, nothing to save
            this.currentOperation.set(null);
            this.clearForceUrlParams();
        }
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
        this.toastService.showToast(`Force "${force.displayName()}" added.`, 'success');
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
            // Not a valid URL: treat as a plain instance ID
        }
        return input;
    }

    /**
     * Load force(s) from URL parameters (instance= and/or units=).
     * Used for in-app URL handling when the PWA receives a captured link.
     *
     * @param params The URLSearchParams containing instance/units/name/gs params
     * @param mode How to handle existing forces: 'replace' removes all first, 'add' keeps them
     * @param alignment Alignment for added forces (only used when mode is 'add')
     * @returns true if any force was loaded
     */
    async loadForceFromUrlParams(
        params: URLSearchParams,
        mode: 'replace' | 'add' = 'replace',
        alignment: ForceAlignment = 'friendly'
    ): Promise<boolean> {
        if (mode === 'replace') {
            await this.clear();
        }
        return this.loadForceParamsCore(params, alignment);
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
        if (newForce) {
            this.addLoadedForce(newForce, 'friendly', { activate: false });
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

            // If follow mode is on, jump to the most recently modified unit
            if (this.followLastModifiedUnit()) {
                const allUnits = targetForce.units();
                if (allUnits.length > 0) {
                    const latest = allUnits.reduce((best, u) =>
                        (u.updatedTs ?? 0) > (best.updatedTs ?? 0) ? u : best, allUnits[0]);
                    if ((latest.updatedTs ?? 0) > 0) {
                        this.selectUnit(latest);
                    }
                }
            } else if (wasInThisForce) {
                // Restore selected unit if it was in this force
                const newSelectedUnit = targetForce.units().find(u => u.id === selectedUnitId);
                this.selectUnit(newSelectedUnit || targetForce.units()[selectedIndex] || targetForce.units()[0] || null);
            }
            // Notify subscribers of the remote update
            const slot = this.getForceSlot(targetForce);
            if (slot) {
                this.remoteForceUpdated$.next({ force: targetForce, alignment: slot.alignment });
            }
        } finally {
            this.urlStateInitialized.set(true);
        }
    }

    /**
     * Loads a force by replacing all currently loaded forces with the new one.
     */
    async loadForce(force: Force): Promise<boolean> {
        this.urlStateInitialized.set(false);
        try {
            const cleared = await this.clear();
            if (!cleared) return false; // User cancelled operation/force save prompt
            this.addLoadedForce(force, 'friendly', { activate: true });
            this.loadAllUnitsWithOverlay([force]);
        } finally {
            this.urlStateInitialized.set(true);
        }
        return true;
    }

    /**
     * Adds a force to the loaded forces without replacing existing ones.
     * Unlike loadForce(), this preserves currently loaded forces.
     */
    async addForce(force: Force, alignment: ForceAlignment = 'friendly', { activate = true }: { activate?: boolean } = {}): Promise<boolean> {
        this.urlStateInitialized.set(false);
        try {
            this.addLoadedForce(force, alignment, { activate });
            this.loadAllUnitsWithOverlay([force]);
        } finally {
            this.urlStateInitialized.set(true);
        }
        return true;
    }

    /**
     * Loads or adds a force from a LoadForceEntry.
     * @param entry The saved force entry to load
     * @param mode 'load' replaces all forces, 'add' adds alongside, 'insert' copies into current force
     * @param alignment Alignment when adding (default: 'friendly')
     */
    async loadForceEntry(entry: LoadForceEntry, mode: 'load' | 'add' | 'insert', alignment: ForceAlignment = 'friendly', { activate = true }: { activate?: boolean } = {}): Promise<boolean> {
        if (mode === 'insert') {
            const targetForce = this.smartCurrentForce();
            if (!targetForce || targetForce.readOnly()) {
                this.toastService.showToast('No editable force to insert into.', 'error');
                return false;
            }
            const sourceForce = await this.dataService.getForce(entry.instanceId, false);
            if (!sourceForce) {
                this.toastService.showToast('Failed to load force.', 'error');
                return false;
            }
            const inserted = await this.insertForceInto(sourceForce, targetForce);
            if (inserted) this.forceLoaded$.next();
            return inserted;
        }

        const requestedForce = await this.dataService.getForce(entry.instanceId, false);
        if (!requestedForce) {
            this.toastService.showToast('Failed to load force.', 'error');
            return false;
        }
        let result: boolean;
        if (mode === 'add') {
            result = await this.addForce(requestedForce, alignment, { activate });
        } else {
            result = await this.loadForce(requestedForce);
        }
        if (result) this.forceLoaded$.next();
        return result;
    }

    private clearForceUrlParams() {
        this.urlStateService.setParams({
            units: null,
            name: null,
            instance: null,
            operation: null,
            factionId: null,
            eraId: null,
            sel: null
        });
    }

    async createNewForce(name: string = '', gameSystemOverride?: GameSystem): Promise<Force | null> {
        // Lazy inject GameService to avoid circular dependency
        const gameService = this.injector.get(GameService);
        const gameSystem = gameSystemOverride ?? gameService.currentGameSystem();
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

    async createGeneratedForce(entry: LoadForceEntry): Promise<Force | null> {
        const loadUnits = entry.groups.flatMap((group) => group.units).filter((loadUnit) => loadUnit.unit !== undefined);
        if (loadUnits.length === 0) {
            return null;
        }

        const force = await this.createNewForce(entry.name, entry.type);
        if (!force) {
            return null;
        }

        force.faction.set(entry.faction ?? null);
        force.era.set(entry.era ?? null);
        force.groups.set([]);

        let firstCreatedUnit: ForceUnit | null = null;
        for (const groupEntry of entry.groups) {
            const targetGroup = force.addGroup(groupEntry.name || undefined);
            for (const loadUnit of groupEntry.units) {
                if (!loadUnit.unit) {
                    continue;
                }

                const createdUnit = await this.addUnit(
                    loadUnit.unit,
                    entry.type === GameSystem.ALPHA_STRIKE ? (loadUnit.skill ?? loadUnit.gunnery) : loadUnit.gunnery,
                    loadUnit.piloting,
                    targetGroup,
                    entry.type,
                );
                if (!createdUnit) {
                    continue;
                }

                this.applyGeneratedUnitOverrides(createdUnit, loadUnit);

                firstCreatedUnit ??= createdUnit;
            }
        }

        force.removeEmptyGroups();
        this.selectUnit(firstCreatedUnit ?? null);
        return force;
    }

    private applyGeneratedUnitOverrides(createdUnit: ForceUnit, loadUnit: LoadForceUnit): void {
        if (loadUnit.alias) {
            if (createdUnit instanceof ASForceUnit) {
                createdUnit.setPilotName(loadUnit.alias);
            } else if (createdUnit instanceof CBTForceUnit) {
                createdUnit.getCrewMembers()[0]?.setName(loadUnit.alias);
            }
        }

        if (loadUnit.commander) {
            createdUnit.setFormationCommander(true, false);
        }
    }

    /**
     * Adds a new unit to the force. The unit is cloned to prevent
     * modifications to the original object, and it's set as the
     * currently selected unit.
     * @param unit The unit to add.
     * @param gunnerySkill Optional gunnery skill to set for the crew
     * @param pilotingSkill Optional piloting skill to set for the crew
     */
    async addUnit(unit: Unit, gunnerySkill?: number, pilotingSkill?: number, group?: UnitGroup, gameSystemOverride?: GameSystem): Promise<ForceUnit | null> {
        let targetForce = this.smartCurrentForce();
        if (!targetForce) {
            targetForce = await this.createNewForce('', gameSystemOverride);
            if (!targetForce) {
                return null;
            }
        }
        let newForceUnit;
        const selectedUnit = this.selectedUnit();
        const targetGroup = group ?? (targetForce === selectedUnit?.force ? selectedUnit?.getGroup() : undefined) ?? undefined;
        try {
            newForceUnit = targetForce.addUnit(unit, targetGroup);
        } catch (error) {
            this.toastService.showToast(error instanceof Error ? error.message : (error as string), 'error');
            return null;
        }

        // Set crew skills if provided
        if (gunnerySkill !== undefined || pilotingSkill !== undefined) {
            newForceUnit.disabledSaving = true;
            try {
                if (newForceUnit instanceof ASForceUnit) {
                    if (typeof gunnerySkill === 'number') {
                        newForceUnit.setPilotSkill(gunnerySkill);
                    }
                } else if (newForceUnit instanceof CBTForceUnit) {
                    const crewMembers = newForceUnit.getCrewMembers();
                    const effectivePilotingSkill = pilotingSkill === undefined
                        ? undefined
                        : getEffectivePilotingSkill(unit, pilotingSkill);
                    for (const crew of crewMembers) {
                        if (gunnerySkill !== undefined) {
                            crew.setSkill('gunnery', gunnerySkill);
                        }
                        if (effectivePilotingSkill !== undefined) {
                            crew.setSkill('piloting', effectivePilotingSkill);
                        }
                    }
                }
            } finally {
                newForceUnit.disabledSaving = false;
            }
        }

        this.selectUnit(newForceUnit);
        const firstUnit = targetForce.units().length === 1;
        if (firstUnit) {
            this.layoutService.openMenu();
        }
        const unitGroup = group ?? targetForce.groups().find(group => {
            return group.units().some(u => u.id === newForceUnit.id);
        });
        this.generateFactionAndForceNameIfNeeded(targetForce, firstUnit);
        if (unitGroup) {
            this.assignFormationIfNeeded(unitGroup);
        }
        return newForceUnit;
    }

    /**
     * Sets the provided unit as the currently selected one.
     * @param unit The unit to select, or null to deselect.
     */
    selectUnit(unit: ForceUnit | null) {
        this.selectedUnit.set(unit);
    }

    /**
     * Clones a unit and inserts the clone immediately after the original unit
     * in the same group. Pilot/crew data is not copied.
     */
    async cloneUnit(sourceUnit: ForceUnit): Promise<ForceUnit | null> {
        const force = sourceUnit.force;
        if (!force || force.readOnly()) return null;
        const unitData = sourceUnit.getUnit();
        if (!unitData) return null;

        const group = sourceUnit.getGroup();
        if (!group) return null;

        const units = group.units();
        const sourceIndex = units.findIndex(u => u.id === sourceUnit.id);
        if (sourceIndex === -1) return null;

        try {
            const newForceUnit = force.addUnit(unitData, group);
            // addUnit appends to end — move it to right after the source
            const updatedUnits = group.units();
            const newIndex = updatedUnits.findIndex(u => u.id === newForceUnit.id);
            if (newIndex !== sourceIndex + 1) {
                group.reorderUnit(newIndex, sourceIndex + 1);
            }

            this.selectUnit(newForceUnit);
            return newForceUnit;
        } catch (error) {
            if (error instanceof Error && error.message === `Cannot add more than ${MAX_UNITS} units to a single force`) {
                this.toastService.showToast(`Cannot clone unit. A force cannot contain more than ${MAX_UNITS} units.`, 'error');
                return null;
            }

            throw error;
        }
    }

    getNextUnit(forceUnit: ForceUnit | null): ForceUnit | null {
        if (!forceUnit?.force) {
            return null;
        }
        const units = forceUnit.force.units();
        if (!forceUnit || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === forceUnit.id);
        if (idx === -1) return null;

        const nextIndex = (idx + 1) % units.length;
        return units[nextIndex] ?? null;
    }

    getPreviousUnit(forceUnit: ForceUnit | null): ForceUnit | null {
        if (!forceUnit?.force) {
            return null;
        }
        const units = forceUnit.force.units();
        if (!forceUnit || units.length < 2) return null;

        const idx = units.findIndex(u => u.id === forceUnit.id);
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
    async removeUnit(unitToRemove: ForceUnit, skipConfirmation = false) {
        const targetForce = unitToRemove.force;
        if (!targetForce) {
            return;
        }
        if (unitToRemove.modified && !skipConfirmation) {
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

        const currentUnits = targetForce.units();
        const isLastUnit = currentUnits.length === 1;
        const idx = currentUnits.findIndex(u => u.id === unitToRemove.id);
        const unitGroup = targetForce.groups().find(group => {
            return group.units().some(u => u.id === unitToRemove.id);
        });

        // If this is the last unit, switch force/selection BEFORE removal
        if (isLastUnit) {
            await this.deleteAndRemoveForce(targetForce);
            return;
        }

        targetForce.removeUnit(unitToRemove);
        this.dataService.deleteCanvasDataOfUnit(unitToRemove);

        if (this.selectedUnit()?.id === unitToRemove.id) {
            const updatedUnits = targetForce.units();
            let newSelected: ForceUnit | null = null;
            if (updatedUnits.length > 0) {
                newSelected = updatedUnits[Math.max(0, idx - 1)] ?? updatedUnits[0];
            }
            this.selectedUnit.set(newSelected);
        }

        this.generateFactionAndForceNameIfNeeded(targetForce);
        if (unitGroup) {
            this.assignFormationIfNeeded(unitGroup);
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
        const targetForce = originalUnit.force;
        if (!targetForce) {
            return null;
        }

        // Check if the original unit belongs to this force
        const allUnits = targetForce.units();
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
        const replaceResult = targetForce.replaceUnit(originalUnit, newUnitData);

        if (!replaceResult) {
            this.toastService.showToast('Failed to replace unit.', 'error');
            return null;
        }

        const { newUnit: newForceUnit, group: originalGroup } = replaceResult;

        // Select the new unit if the old one was selected
        if (wasSelected) {
            this.selectUnit(newForceUnit);
        }

        this.generateFactionAndForceNameIfNeeded(targetForce);
        if (originalGroup) {
            this.assignFormationIfNeeded(originalGroup);
        }

        return newForceUnit;
    }

    public async requestCloneForce(force: Force): Promise<void> {
        if (!force) return;
        
        const isAlphaStrike = force.gameSystem === GameSystem.ALPHA_STRIKE;
        const targetSystemLabel = isAlphaStrike ? 'CBT' : 'AS';
        
        const dialogRef = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
            data: {
                title: 'Clone/Convert Force',
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
            this.cloneForce(force);
        } else if (result === 'convert') {
            this.convertForce(force);
        }
    }

    private async cloneForce(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }

        const forceSlot = this.getForceSlot(force);
        const alignment = forceSlot?.alignment || 'friendly';

        const selectedIdx = force.units().findIndex(u => u.id === this.selectedUnit()?.id);
        const cloned = force.clone();
        cloned.loading = true;
        try {
            await this.dataService.saveForce(cloned);
        } finally {
            cloned.loading = false;
        }
        
        // Unload old, load clone
        this.removeLoadedForce(force, { skipPrompt: true });
        // Load the new force (this handles URL state and other housekeeping)
        this.addLoadedForce(cloned, alignment, { activate: true });
        const units = cloned.units();
        this.selectUnit(selectedIdx >= 0 && selectedIdx < units.length ? units[selectedIdx] : units[0] ?? null);

        this.toastService.showToast(`A copy of this force was created and saved. You can now edit the copy without affecting the original.`, 'success');
        return true;
    }

    /**
     * Converts the current force to the opposite game system (CBT <-> Alpha Strike).
     * Creates a new force with the same name and groups, but fresh units without state.
     */
    private async convertForce(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }

        const isAlphaStrike = force.gameSystem === GameSystem.ALPHA_STRIKE;
        const targetSystemLabel = isAlphaStrike ? 'Classic BattleTech' : 'Alpha Strike';

        const forceSlot = this.getForceSlot(force);
        const alignment = forceSlot?.alignment || 'friendly';

        // Create new force with opposite game system
        const newForce = isAlphaStrike
            ? new CBTForce(force.name, this.dataService, this.unitInitializer, this.injector)
            : new ASForce(force.name, this.dataService, this.unitInitializer, this.injector);

        newForce.faction.set(force.faction());
        newForce.factionLock = force.factionLock;
        newForce.loading = true;

        try {
            // First, clear any default groups
            newForce.groups.set([]);

            // Recreate groups and units - process one group at a time
            for (const sourceGroup of force.groups()) {
                const newGroup = newForce.addGroup();
                newGroup.name.set(sourceGroup.name());
                newGroup.formation.set(sourceGroup.formation());
                newGroup.formationLock = sourceGroup.formationLock;
                if (!newGroup.formationLock && sourceGroup.formation()) {
                    newGroup.formationHistory.add(sourceGroup.formation()!.id);
                }

                for (const sourceUnit of sourceGroup.units()) {
                    const unitName = sourceUnit.getUnit().name;
                    const unit = this.dataService.getUnitByName(unitName);
                    if (!unit) {
                        this.logger.warn(`Unit "${unitName}" not found during conversion`);
                        continue;
                    }

                    // addUnit adds to the last group, which is newGroup since we just created it
                    const newForceUnit = newForce.addUnit(unit);

                    // Transfer pilot data cross-system
                    newForceUnit.disabledSaving = true;
                    try {
                        this.transferPilotDataCrossSystem(sourceUnit, newForceUnit, force.gameSystem, newForce.gameSystem);
                    } finally {
                        newForceUnit.disabledSaving = false;
                    }
                }

                this.assignFormationIfNeeded(newGroup); // we re-evaluate all formations after conversion since unit changes may affect validity
            }

            // Set a new instance ID and save
            newForce.instanceId.set(generateUUID());
        } finally {
            newForce.loading = false;
        }

        this.removeLoadedForce(force);
        // Load the new force (this handles URL state and other housekeeping)
        this.addLoadedForce(newForce, alignment, { activate: true });
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
            const cbtTarget = targetUnit as CBTForceUnit;
            const sourceName = asSource.alias();
            const sourceSkill = asSource.getPilotSkill();
            const newCrew = targetUnit.getCrewMembers();
            if (newCrew.length > 0) {
                if (sourceName) newCrew[0].setName(sourceName);
                newCrew[0].setSkill('gunnery', sourceSkill);
            }
            cbtTarget.setFormationCommander(asSource.commander());
        } else {
            // CBT → AS
            const asTarget = targetUnit as ASForceUnit;
            const cbtSource = sourceUnit as CBTForceUnit;
            const sourceCrew = sourceUnit.getCrewMembers();
            if (sourceCrew.length > 0) {
                const name = sourceCrew[0].getName();
                const gunnery = sourceCrew[0].getSkill('gunnery');
                if (name) asTarget.setPilotName(name);
                asTarget.setPilotSkill(gunnery);
            }
            asTarget.setFormationCommander(cbtSource.commander());
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
        const unitData = this.dataService.getUnitByName(unitName);
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

    generateFactionAndForceNameIfNeeded(force: Force, respectFilter: boolean = false): void {
        if (!force) {
            return;
        }

        // Pick era from filter if not locked
        if (!force.eraLock && respectFilter) {
            const era = this.pickEraFromFilter();
            if (era && era.id !== force.era()?.id) {
                force.era.set(era);
            }
        }

        if (force.factionLock) {
            return;
        }

        // If respectFilter is true and a faction filter is active, prefer picking from those factions
        let faction = respectFilter ? this.pickFactionFromFilter() : null;

        if (!faction) {
            faction = ForceNamerUtil.pickBestFaction(
                force.units(),
                this.dataService.getFactions(),
                this.dataService.getEras(),
                force.faction()
            );
        }
        if (faction?.id === force.faction()?.id) {
            return; // No change needed
        }
        force.faction.set(faction);
        force.setName(
            ForceNamerUtil.generateForceNameForFaction(faction),
            false
        );
    }

    /**
     * Checks the active unit search era filter and picks the first era from it.
     * Returns null if no era filter is active or no matching eras are found.
     */
    private pickEraFromFilter(): Era | null {
        try {
            const filtersService = this.injector.get(UnitSearchFiltersService);
            const filterState = filtersService.effectiveFilterState();
            const eraFilter = filterState['era'];
            if (!eraFilter?.interactedWith || !eraFilter.value) {
                return null;
            }
            const selectedEraNames = getSelectedPositiveDropdownNames(eraFilter.value);
            if (selectedEraNames.length === 0) {
                return null;
            }
            return this.dataService.getEraByName(selectedEraNames[0]) ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Checks the active unit search faction filter and picks a random faction from it.
     * Returns null if no faction filter is active or no matching factions are found.
     */
    private pickFactionFromFilter(): Faction | null {
        try {
            const filtersService = this.injector.get(UnitSearchFiltersService);
            const filterState = filtersService.effectiveFilterState();
            const factionFilter = filterState['faction'];
            if (!factionFilter?.interactedWith || !factionFilter.value) {
                return null;
            }
            const allFactionNames = this.dataService.getFactions().map(f => f.name);
            const positiveFactions = getPositiveFactionNamesFromFilter(
                factionFilter.value as MultiStateSelection,
                allFactionNames,
                factionFilter.wildcardPatterns
            );
            const candidateFactions = positiveFactions
                .map((name) => this.dataService.getFactionByName(name))
                .filter((faction): faction is Faction => !!faction && faction.id !== MULFACTION_EXTINCT);
            if (candidateFactions.length === 0) {
                return this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null;
            }

            return candidateFactions[Math.floor(Math.random() * candidateFactions.length)] ?? null;
        } catch {
            // UnitSearchFiltersService not available, fall through
            return null;
        }
    }

    public assignFormationIfNeeded(group: UnitGroup) {
        if (group.units().length === 0) {
            group.formation.set(null);
            group.formationLock = false; // Unlock name so it can update with new formation name
            return;
        }
        if (group.formationLock) {
            this.reconcileASFormationAssignments(group);
            return;
        }
        // Pick the best formation (deterministic, most specific wins),
        // upgrading when a better match becomes available.
        const best = LanceTypeIdentifierUtil.getBestMatchForGroup(group);
        if (best?.definition.id !== group.formation()?.id) {
            group.formation.set(best?.definition ?? null);
            if (best) {
                group.formationHistory.add(best.definition.id);
            }
        }
        this.reconcileASFormationAssignments(group);
    }

    private reconcileASFormationAssignments(group: UnitGroup | null | undefined): void {
        if (!group || group.force.gameSystem !== GameSystem.ALPHA_STRIKE) {
            return;
        }

        FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group as UnitGroup<ASForceUnit>);
    }

    public showFormationInfo(group: UnitGroup): void {
        const targetForce = group.force;
        if (!targetForce) return;
        const formation = group.activeFormation();
        if (!formation) return;
        this.dialogsService.createDialog(FormationInfoDialogComponent, {
            data: {
                formation,
                gameSystem: targetForce.gameSystem,
                formationDisplayName: group.formationDisplayName(),
                unitCount: group.units().length,
                isValid: group.hasValidFormation(),
                requirementsFiltered: group.isFormationRequirementsFiltered(),
                requirementsFilterNotice: group.formationRequirementsFilterNotice(),
            } as FormationInfoDialogData
        });
    }

    public async repairAllUnits(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to repair all units? This will reset all damage and status effects on every unit in the force.',
            'Repair All Units',
            'info');
        if (confirmed) {
            force.units().forEach(fu => {
                fu.repairAll();
            });
            return true;
        };
        return false;
    }

    public async removeGroup(group: UnitGroup): Promise<void> {
        const force = group.force;
        if (!force) {
            return;
        }
        const unitCount = group.units().length;
        if (unitCount > 0) {       
            const groupLabel = group.name() || group.formationDisplayName() || 'this group';
            const confirmed = await this.dialogsService.requestConfirmation(
                `"${groupLabel}" contains ${unitCount} unit${unitCount > 1 ? 's' : ''}. Removing the group will permanently delete all units inside it.`,
                'Remove Group',
                'danger'
            );
            if (!confirmed) {
                return;
            }
        }
        // If selected unit is in this group, move selection
        const selectedUnit = this.selectedUnit();
        if (selectedUnit && group.units().some(u => u.id === selectedUnit.id)) {
            const otherUnits = force.units().filter(u => !group.units().some(gu => gu.id === u.id));
            this.selectedUnit.set(otherUnits[0] ?? null);
        }
        force.removeGroup(group);
    }

    public shareForce(): void {
        const currentForce = this.currentForce();
        if (!currentForce) return;
        this.dialogsService.createDialog(ShareForceDialogComponent, {
            data: { force: currentForce }
        });
    }

    public async showForceOverview(force: Force): Promise<void> {
        if (!force) return;
        const { ForceOverviewDialogComponent } = await import('../components/force-overview-dialog/force-overview-dialog.component');
        this.dialogsService.createDialog(ForceOverviewDialogComponent, {
            data: { force }
        });
    }

    public showC3Network(force: Force): void {
        if (!force) return;
        this.openC3Network(force, force.readOnly());
    }

    public async showForceOrgDialog(organizationId?: string): Promise<DialogRef> {
        const { ForceOrgDialogComponent } = await import('../components/force-org-dialog/force-org-dialog.component');
        return this.dialogsService.createDialog(ForceOrgDialogComponent, {
            data: organizationId ? { organizationId } : undefined,
            width: '100dvw',
            height: '100dvh',
            maxWidth: '100dvw',
            maxHeight: '100dvh',
            panelClass: 'force-org-dialog-panel'
        });
    }

    public async printAll(): Promise<void> {
        const currentForce = this.currentForce();
        if (!currentForce) return;

        const optionsService = this.injector.get(OptionsService);
        const { PrintOptionsDialogComponent } = await import('../components/print-options-dialog/print-options-dialog.component');
        const ref = this.dialogsService.createDialog<PrintAllOptions | null>(PrintOptionsDialogComponent, {
            disableClose: false,
            data: {
                gameSystem: currentForce instanceof CBTForce ? GameSystem.CLASSIC : GameSystem.ALPHA_STRIKE
            }
        });
        const printOptions = await firstValueFrom(ref.closed);
        if (!printOptions) return;

        // Lazy-inject UI services to avoid circular dependencies
        if (currentForce instanceof CBTForce) {
            const sheetService = this.injector.get(SheetService);
            await CBTPrintUtil.multipagePrint(sheetService, currentForce.units(), printOptions);
        } else if (currentForce instanceof ASForce) {
            const appRef = this.injector.get(ApplicationRef);
            await ASPrintUtil.multipagePrint(appRef, this.injector, optionsService, currentForce.groups(), printOptions, true, currentForce);
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
                    this.logger.warn(`Conflict detected for force "${force.displayName()}" (${instanceId}).`);
                    if (!force.owned()) {
                        this.logger.info(`ForceBuilderService: Force "${force.displayName()}" downloading cloud version.`);
                        this.urlStateInitialized.set(false);
                        try {
                            this.replaceForceInPlace(force, await this.dataService.getForce(instanceId, false) as any);
                        } finally {
                            this.urlStateInitialized.set(true);
                        }
                        this.toastService.showToast(`Cloud version of "${force.displayName()}" loaded.`, 'success');
                        continue;
                    }
                    await this.handleCloudConflict(force, cloudForce, localTimestamp, cloudTimestamp);
                }
            } catch (error) {
                this.logger.error(`Error checking for cloud conflict on "${force.displayName()}": ${error}`);
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
                message: `"${localForce.displayName()}" was modified on another device while you were offline. The cloud version is newer. (${formatDate(cloudTimestamp)} > ${formatDate(localTimestamp)})`,
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
            this.toastService.showToast(`Cloud version of "${localForce.displayName()}" loaded.`, 'success');
        } else if (result === 'local') {
            localForce.timestamp = new Date().toISOString();
            await this.dataService.saveForce(localForce);
            this.toastService.showToast(`Local version of "${localForce.displayName()}" kept and synced.`, 'success');
        } else if (result === 'cloneLocal') {
            const selectedIdx = localForce.units().findIndex(u => u.id === this.selectedUnit()?.id);
            const slot = this.getForceSlot(localForce);
            const alignment = slot?.alignment ?? 'friendly';
            const cloned = localForce.clone();
            cloned.setName(localForce.displayName() + ' (Cloned)', false);

            // Unload old, load clone
            await this.removeLoadedForce(localForce);
            this.addLoadedForce(cloned, alignment, { activate: false });
            const units = cloned.units();
            if (selectedIdx >= 0 && selectedIdx < units.length) {
                this.selectUnit(units[selectedIdx]);
            } else {
                this.selectUnit(units[0] ?? null);
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
            const selectedUnit = this.selectedUnit();
            
            const sel = selectedUnit?.force?.instanceId ? selectedUnit?.id : null;
            if (!this.urlStateInitialized()) {
                return;
            }
            // Use centralized URL state service to avoid race conditions
            this.urlStateService.setParams({
                gs: params.gs,
                units: params.units,
                name: params.name,
                instance: params.instance,
                operation: params.operation,
                factionId: params.factionId,
                eraId: params.eraId,
                sel
            });
        });
    }

    /** URL params representing ALL loaded forces, including the operation ID. */
    queryParameters = computed<ForceQueryParams>(() => {
        const op = this.currentOperation();
        if (op) {
            // Operation loaded: only emit the operation ID, no force-level params
            return { gs: null, units: null, name: null, instance: null, operation: op.operationId, factionId: null, eraId: null };
        }
        const params = buildMultiForceQueryParams(this.loadedForces());
        return { ...params, operation: null };
    });

    private loadUnitsFromUrlOnStartup() {
        effect(() => {
            const isDataReady = this.dataService.isDataReady();
            // This effect runs when data is ready, but we only execute the logic once.
            if (!this.urlInitRan && isDataReady && !this.urlStateInitialized()) {
                this.urlInitRan = true;
                // Fire the async work without awaiting
                untracked(() => {
                    this.initializeFromUrl();
                });
            }
        });
    }

    private async initializeFromUrl(): Promise<void> {
        const params = this.urlStateService.initialState.params;

        // Handle operation= param (load entire operation by ID)
        const operationId = params.get('operation');
        if (operationId) {
            const loaded = await this.loadOperationFromUrl(operationId);
            if (loaded) {
                this.urlStateInitialized.set(true);
                this.urlStateService.markConsumerReady('force-builder');
                return;
            }
            // Operation not found: fall through to normal force loading
            this.logger.warn(`ForceBuilderService: Operation "${operationId}" not found, falling back to force params.`);
        }

        const loadedAny = await this.loadForceParamsCore(params);

        // Restore selected unit from URL
        this.restoreSelectionFromUrl(params);

        // Show notice when ALL loaded forces are non-owned
        if (loadedAny) {
            const allNonOwned = this.loadedForces().every(s => !s.force.owned());
            if (allNonOwned) {
                this.dialogsService.showNotice(
                    'Reports indicate another commander owns this force. Clone to adopt it for yourself.',
                    'Captured Intel'
                );
            }
        } else if (params.has('instance')) {
            // None of the instance IDs were found: clear them from URL
            this.urlStateService.setParams({ instance: null });
        }

        // Mark as initialized so the update effect can start running.
        this.urlStateInitialized.set(true);
        this.urlStateService.markConsumerReady('force-builder');
    }

    /**
     * Restores the selected unit from the `sel` URL parameter.
     * Looks up the unit by ID across all loaded forces and selects it if found.
     */
    private restoreSelectionFromUrl(params: URLSearchParams): void {
        const selParam = params.get('sel');
        if (!selParam) return;
        const allUnits = this.allLoadedUnits();
        const unit = allUnits.find(u => u.id === selParam);
        if (unit) {
            this.selectUnit(unit);
        }
    }

    /**
     * Load an operation by ID from the local DB or cloud.
     * Used during URL-based initialization (no unsaved-changes prompt).
     */
    private async loadOperationFromUrl(operationId: string): Promise<boolean> {
        const loaded = await this.loadOperation(operationId, { skipPrompts: true });
        if (loaded) {
            this.restoreSelectionFromUrl(this.urlStateService.initialState.params);
        }
        return loaded;
    }

    /**
     * Core logic for loading forces from URLSearchParams.
     * Shared between startup initialization and in-app captured URL handling.
     *
    * Handles:
    * - instance= (comma-separated cloud force IDs, with optional 'enemy:' prefix)
    * - units= (inline unsaved force using unit names)
    * - mul_ids= (inline unsaved force using MUL IDs)
     *
     * @param params The URLSearchParams to read from
     * @param defaultAlignment Alignment for forces without an explicit prefix
     * @returns true if any force was loaded
     */
    private async loadForceParamsCore(
        params: URLSearchParams,
        defaultAlignment: ForceAlignment = 'friendly'
    ): Promise<boolean> {
        let loadedAny = false;
        const isFirst = !this.hasForces();

        // Handle instance= param (cloud-saved forces)
        const instanceParam = params.get('instance');
        if (instanceParam) {
            const entries = instanceParam.split(',').map(e => e.trim()).filter(e => e.length > 0);
            for (const entry of entries) {
                let entryAlignment = defaultAlignment;
                let instanceId = entry;
                if (entry.startsWith('enemy:')) {
                    entryAlignment = 'enemy';
                    instanceId = entry.substring('enemy:'.length);
                }
                // Skip if already loaded
                if (this.loadedForces().some(s => s.force.instanceId() === instanceId)) {
                    continue;
                }
                const force = await this.dataService.getForce(instanceId);
                if (force) {
                    this.addLoadedForce(force, entryAlignment, { activate: !loadedAny && isFirst });
                    loadedAny = true;
                } else {
                    this.logger.warn(`ForceBuilderService: Instance "${instanceId}" not found, skipping.`);
                }
            }
        }

        // Handle units=/mul_ids= params (unsaved inline force)
        const unitsParam = params.get('units');
        const mulIdsParam = params.get('mul_ids');
        const inlineUnitsParam = unitsParam || mulIdsParam;
        const unitLookupMode: ForceUrlUnitLookupMode = unitsParam ? 'name' : 'mulId';
        if (inlineUnitsParam) {
            const forceNameParam = params.get('name');
            const gameSystemParam = params.get('gs') ?? GameSystem.CLASSIC;
            let newForce: Force;
            if (gameSystemParam === GameSystem.ALPHA_STRIKE) {
                newForce = new ASForce('', this.dataService, this.unitInitializer, this.injector);
            } else {
                newForce = new CBTForce('', this.dataService, this.unitInitializer, this.injector);
            }
            newForce.loading = true;
            try {
                if (forceNameParam) {
                    newForce.setName(forceNameParam);
                }
                // Restore faction from URL param
                const factionIdParam = params.get('factionId');
                if (factionIdParam) {
                    const factionId = parseInt(factionIdParam, 10);
                    if (!isNaN(factionId)) {
                        const faction = this.dataService.getFactionById(factionId) ?? null;
                        newForce.faction.set(faction);
                        if (faction) {

                            newForce.factionLock = true; // lock faction since it was explicitly set in URL
                        }
                    }
                }
                // Restore era from URL param
                const eraIdParam = params.get('eraId');
                if (eraIdParam) {
                    const eraId = parseInt(eraIdParam, 10);
                    if (!isNaN(eraId)) {
                        const era = this.dataService.getEraById(eraId) ?? null;
                        newForce.era.set(era);
                        if (era) {
                            newForce.eraLock = true;
                        }
                    }
                }
                const forceUnits = this.parseUnitsFromUrl(newForce, inlineUnitsParam, unitLookupMode);
                if (forceUnits.length > 0) {
                    this.logger.info(`ForceBuilderService: Loaded ${forceUnits.length} units from URL.`);
                    newForce.removeEmptyGroups();
                    if (this.layoutService.isMobile()) {
                        this.layoutService.openMenu();
                    }
                }
            } finally {
                newForce.loading = false;
            }
            if (newForce.units().length > 0) {
                this.addLoadedForce(newForce, defaultAlignment, { activate: !loadedAny && isFirst });
                loadedAny = true;
            }
        }

        // Load all units across all forces added during this call
        if (loadedAny) {
            const allForces = this.loadedForces().map(s => s.force);
            this.loadAllUnitsWithOverlay(allForces);
        }

        return loadedAny;
    }

    /**
     * Parses inline force units from URL parameters with group support.
     * New format: groupName~unit1,unit2|groupName2~unit3,unit4
     * Legacy format (backward compatible): unit1,unit2,unit3
     */
    private parseUnitsFromUrl(force: Force, unitsParam: string, lookupMode: ForceUrlUnitLookupMode = 'name'): ForceUnit[] {
        return parseForceFromUrl(force, unitsParam, this.dataService.getUnits(), this.logger, lookupMode);
    }


    /* ----------------------------------------
     * Force Load and Pack Dialogs
     */

    async showLoadForceDialog(options?: { initialTab?: string }): Promise<void> {
        const ref = this.dialogsService.createDialog<ForceLoadDialogResult>(ForceLoadDialogComponent, {
            data: options ?? undefined,
        });
        const envelope = await firstValueFrom(ref.closed);
        
        if (!envelope) return;
        const { result, mode, alignment } = envelope;

        // Handle operation loading (multi-force composition)
        if (mode === 'operation' && result instanceof LoadOperationEntry) {
            await this.loadOperation(result.operationId);
            return;
        }

        // Handle insert mode: copy groups/units into the current force
        if (mode === 'insert') {
            const targetForce = this.smartCurrentForce();
            if (!targetForce || targetForce.readOnly()) {
                this.toastService.showToast('No editable force to insert into.', 'error');
                return;
            }
            if (result instanceof LoadForceEntry) {
                const sourceForce = await this.dataService.getForce(result.instanceId, false);
                if (!sourceForce) {
                    this.toastService.showToast('Failed to load force.', 'error');
                    return;
                }
                await this.insertForceInto(sourceForce, targetForce);
            } else {
                const pack = result as ResolvedPack;
                if (pack.units && pack.units.length > 0) {
                    await this.insertPackInto(pack, targetForce);
                }
            }
            return;
        }

        const isAdd = mode === 'add';
        const addAlignment: ForceAlignment = alignment ?? 'friendly';

        if (result instanceof LoadForceEntry) {
            const requestedForce = await this.dataService.getForce(result.instanceId, false);
            if (!requestedForce) {
                this.toastService.showToast('Failed to load force.', 'error');
                return;
            }
            if (isAdd) {
                await this.addForce(requestedForce, addAlignment);
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
                        newForce = new ASForce('', this.dataService, this.unitInitializer, this.injector);
                    } else {
                        newForce = new CBTForce('', this.dataService, this.unitInitializer, this.injector);
                    }
                    await this.addForce(newForce, addAlignment);
                    const group = newForce.addGroup();
                    for (const unit of pack.units) {
                        if (!unit?.unit) continue;
                        newForce.addUnit(unit.unit, group);
                    }
                    this.loadAllUnitsWithOverlay([newForce]);
                    this.selectedUnit.set(newForce.units()[0] ?? null);
                } else {
                    const newForce = await this.createNewForce();
                    if (!newForce) {
                        this.toastService.showToast('Failed to create new force.', 'error');
                        return;
                    }
                    const group = newForce.addGroup();
                    for (const unit of pack.units) {
                        if (!unit?.unit) continue;
                        newForce.addUnit(unit.unit, group);
                    }
                    this.loadAllUnitsWithOverlay([newForce]);
                    this.selectedUnit.set(newForce.units()[0] ?? null);
                }
            }
        }
    }

    async showForcePackDialog(): Promise<void> {
        const targetForce = this.smartCurrentForce();
        if (!targetForce) {
            this.toastService.showToast('No active force to add units to.', 'error');
            return;
        }
        const ref = this.dialogsService.createDialog<ForcePackDialogResult>(ForcePackDialogComponent);
        const units = await firstValueFrom(ref.closed);

        if (units && units.length > 0) {
            const group = targetForce.addGroup();
            if (!group) {
                throw new Error('No current force to add a group to.');
            }
            for (const entry of units) {
                if (!entry?.unit) continue;
                this.addUnit(entry.unit, undefined, undefined, group);
            }
        }
    }

    async showForceGeneratorDialog(): Promise<void> {
        await this.showSearchForceGeneratorDialog();
    }

    async showSearchForceGeneratorDialog(): Promise<void> {
        if (!this.dataService.isDataReady()) {
            this.toastService.showToast('Data is still loading.', 'info');
            return;
        }

        const { SearchForceGeneratorDialogComponent } = await import('../components/search-force-generator-dialog/search-force-generator-dialog.component');
        const dialogRef = this.dialogsService.createDialog<SearchForceGeneratorDialogResult | null>(SearchForceGeneratorDialogComponent);

        await this.finalizeGeneratedForceDialog((await firstValueFrom(dialogRef.closed)) ?? null);
    }

    private async finalizeGeneratedForceDialog(
        result: { forceEntry: LoadForceEntry; config: { gameSystem: GameSystem }; totalCost: number } | null,
    ): Promise<void> {
        const unitCount = result?.forceEntry.groups.reduce(
            (sum, group) => sum + group.units.filter((unitEntry) => unitEntry.unit).length,
            0,
        ) ?? 0;
        if (!result || unitCount === 0) {
            return;
        }

        const force = await this.createGeneratedForce(result.forceEntry);
        if (!force) {
            this.toastService.showToast('Failed to generate a new force.', 'error');
            return;
        }

        const budgetMetric = result.config.gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
        this.toastService.showToast(
            `Generated ${unitCount} units for ${result.forceEntry.faction?.name ?? 'Unknown Faction'} (${budgetMetric} ${result.totalCost.toLocaleString()}).`,
            'info',
        );
    }

    /**
     * Copies groups and units from a source force into the target force.
     * If the game systems differ, units are converted automatically.
     * Validates MAX_GROUPS and MAX_UNITS limits before inserting.
     */
    private async insertForceInto(sourceForce: Force, targetForce: Force): Promise<boolean> {
        const sourceGroups = sourceForce.groups();
        const sourceUnitCount = sourceForce.units().length;
        const targetGroupCount = targetForce.groups().length;
        const targetUnitCount = targetForce.units().length;

        const newGroupCount = targetGroupCount + sourceGroups.length;
        const newUnitCount = targetUnitCount + sourceUnitCount;

        if (newGroupCount > MAX_GROUPS) {
            await this.dialogsService.showError(
                `Cannot insert: the result would have ${newGroupCount} groups, exceeding the limit of ${MAX_GROUPS}.`,
                'Insert Failed',
            );
            return false;
        }
        if (newUnitCount > MAX_UNITS) {
            await this.dialogsService.showError(
                `Cannot insert: the result would have ${newUnitCount} units, exceeding the limit of ${MAX_UNITS}.`,
                'Insert Failed',
            );
            return false;
        }

        const needsConversion = sourceForce.gameSystem !== targetForce.gameSystem;
        let insertedCount = 0;

        const newGroups: UnitGroup[] = [];

        for (const sourceGroup of sourceGroups) {
            const newGroup = targetForce.addGroup(sourceGroup.name());
            newGroup.formation.set(sourceGroup.formation());
            newGroup.formationLock = sourceGroup.formationLock;
            if (!newGroup.formationLock && sourceGroup.formation()) {
                newGroup.formationHistory.add(sourceGroup.formation()!.id);
            }

            for (const sourceUnit of sourceGroup.units()) {
                if (needsConversion) {
                    const converted = this.convertUnitForForce(sourceUnit, sourceForce, targetForce);
                    if (converted) {
                        newGroup.insertUnit(converted);
                        insertedCount++;
                    }
                } else {
                    // Same game system: look up fresh unit data and copy pilot info
                    const unitName = sourceUnit.getUnit()?.name;
                    if (!unitName) continue;
                    const unitData = this.dataService.getUnitByName(unitName);
                    if (!unitData) continue;

                    const newForceUnit = targetForce.addUnit(unitData, newGroup);
                    newForceUnit.disabledSaving = true;
                    try {
                        this.transferPilotDataSameSystem(sourceUnit, newForceUnit, targetForce.gameSystem);
                    } finally {
                        newForceUnit.disabledSaving = false;
                    }
                    insertedCount++;
                }
            }
            newGroups.push(newGroup);
        }

        this.generateFactionAndForceNameIfNeeded(targetForce);
        for (const group of newGroups) {
            this.assignFormationIfNeeded(group);
        }
        const systemNote = needsConversion ? ' (units were converted)' : '';
        this.toastService.showToast(
            `Inserted ${insertedCount} unit(s) from "${sourceForce.displayName()}" into "${targetForce.displayName()}"${systemNote}.`,
            'success'
        );
        return true;
    }

    /**
     * Inserts units from a force pack into the target force as a new group.
     * Validates MAX_UNITS limit before inserting.
     */
    private async insertPackInto(pack: ResolvedPack, targetForce: Force): Promise<boolean> {
        const packUnitCount = pack.units.filter(u => !!u?.unit).length;
        const targetUnitCount = targetForce.units().length;
        const targetGroupCount = targetForce.groups().length;

        if (targetGroupCount + 1 > MAX_GROUPS) {
            await this.dialogsService.showError(
                `Cannot insert: the force already has ${targetGroupCount} groups, adding another would exceed the limit of ${MAX_GROUPS}.`,
                'Insert Failed'
            );
            return false;
        }
        if (targetUnitCount + packUnitCount > MAX_UNITS) {
            await this.dialogsService.showError(
                `Cannot insert: the result would have ${targetUnitCount + packUnitCount} units, exceeding the limit of ${MAX_UNITS}.`,
                'Insert Failed'
            );
            return false;
        }

        const newGroup = targetForce.addGroup();
        for (const entry of pack.units) {
            if (!entry?.unit) continue;
            targetForce.addUnit(entry.unit, newGroup);
        }

        this.generateFactionAndForceNameIfNeeded(targetForce);
        this.assignFormationIfNeeded(newGroup);
        this.toastService.showToast(
            `Inserted ${packUnitCount} unit(s) from pack "${pack.name}" into "${targetForce.displayName()}".`,
            'success'
        );
        return true;
    }

    /**
     * Transfers pilot/crew data between ForceUnits of the same game system.
     * CBT: copies crew names, gunnery, and piloting skills.
     * AS:  copies pilot name, skill, and abilities.
     */
    private transferPilotDataSameSystem(sourceUnit: ForceUnit, targetUnit: ForceUnit, gameSystem: GameSystem): void {
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            const asSource = sourceUnit as ASForceUnit;
            const asTarget = targetUnit as ASForceUnit;
            const pilotName = asSource.alias();
            if (pilotName) {
                asTarget.setPilotName(pilotName);
            }
            asTarget.setPilotSkill(asSource.pilotSkill());
            const abilities = asSource.manualPilotAbilities();
            if (abilities && abilities.length > 0) {
                asTarget.setPilotAbilities([...abilities]);
            }
            asTarget.setFormationAbilities([...asSource.formationAbilities()]);
            asTarget.setFormationCommander(asSource.commander());
        } else {
            // Classic BattleTech
            const cbtSource = sourceUnit as CBTForceUnit;
            const cbtTarget = targetUnit as CBTForceUnit;
            const fromCrew = sourceUnit.getCrewMembers();
            const toCrew = targetUnit.getCrewMembers();
            const crewCount = Math.min(fromCrew.length, toCrew.length);
            for (let i = 0; i < crewCount; i++) {
                const fromMember = fromCrew[i];
                const toMember = toCrew[i];
                if (fromMember && toMember) {
                    const name = fromMember.getName();
                    if (name) {
                        toMember.setName(name);
                    }
                    toMember.setSkill('gunnery', fromMember.getSkill('gunnery'));
                    toMember.setSkill('piloting', fromMember.getSkill('piloting'));
                }
            }
            cbtTarget.setFormationCommander(cbtSource.commander());
        }
    }

    /* ----------------------------------------
     * Operations (multi-force compositions)
     */

    /**
     * Whether we can save a new operation (need at least 2 loaded forces,
     * and either no operation loaded or the loaded one is not ours).
     */
    canSaveOperation = computed<boolean>(() => {
        if (this.loadedForces().length < 2) return false;
        const op = this.currentOperation();
        // Allow save-as-new when no operation, or when viewing someone else's
        return !op || !op.owned;
    });

    /**
     * Checks whether the currently loaded forces/alignments differ from those
     * stored in the current operation snapshot.
     */
    private operationHasChanges(): boolean {
        const op = this.currentOperation();
        if (!op) return false;
        const slots = this.loadedForces();
        const savedForces = op.forces;
        // Different number of forces
        if (slots.length !== savedForces.length) return true;
        // Compare each force by instanceId + alignment (order-sensitive)
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const saved = savedForces[i];
            if (slot.force.instanceId() !== saved.instanceId) return true;
            if (slot.alignment !== saved.alignment) return true;
        }
        return false;
    }

    /**
     * If an operation is loaded and has unsaved changes, prompts the user
     * to save/update before proceeding.
     * @returns true if the caller should proceed, false to cancel.
     */
    private async promptSaveOperationIfNeeded(): Promise<boolean> {
        const op = this.currentOperation();
        if (!op) return true;
        if (!this.operationHasChanges()) return true;

        if (op.owned && this.loadedForces().length >= 2) {
            // Owned operation with changes → offer update
            const result = await this.dialogsService.choose(
                'Unsaved Operation Changes',
                `The operation "${op.name}" has been modified. Do you want to update it before proceeding?`,
                [
                    { label: 'UPDATE', value: 'update', class: 'primary' },
                    { label: 'DISCARD', value: 'discard', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' }
                ],
                'cancel'
            );
            if (result === 'update') {
                const saved = await this.updateOperation();
                if (!saved) return false;
            } else if (result === 'cancel') {
                return false;
            }
        } else if (this.loadedForces().length >= 2) {
            // Non-owned or new-able, offer save-as-new
            const result = await this.dialogsService.choose(
                'Unsaved Operation Changes',
                `The operation has been modified. Do you want to save it as a new operation before proceeding?`,
                [
                    { label: 'SAVE AS NEW', value: 'save', class: 'primary' },
                    { label: 'DISCARD', value: 'discard', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' }
                ],
                'cancel'
            );
            if (result === 'save') {
                const saved = await this.saveOperation();
                if (!saved) return false;
            } else if (result === 'cancel') {
                return false;
            }
        }
        return true;
    }

    /**
     * Whether we can update the currently loaded operation (must be owned).
     */
    canUpdateOperation = computed<boolean>(() => {
        const op = this.currentOperation();
        return !!op && op.owned && this.loadedForces().length >= 2;
    });

    /**
     * Saves the current loaded force composition as an Operation.
     * Each force must already be saved (have an instanceId).
     * Opens a dialog for name, note, and a preview of the operation.
     */
    async saveOperation(): Promise<boolean> {
        let slots = this.loadedForces();
        if (slots.length < 2) {
            this.toastService.showToast('Need at least 2 forces to save an operation.', 'error');
            return false;
        }

        // Build force preview data for the dialog
        const dialogForces: OpPreviewForce[] = slots.map(slot => ({
            name: slot.force.displayName(),
            instanceId: slot.force.instanceId() || '',
            alignment: slot.alignment,
            type: slot.force.gameSystem,
            factionId: slot.force.faction()?.id,
            bv: slot.force.gameSystem !== 'as' ? slot.force.totalBv() : undefined,
            pv: slot.force.gameSystem === 'as' ? slot.force.totalBv() : undefined,
        }));

        // Open the save-operation dialog
        const currentOp = this.currentOperation();
        const dialogData: OperationDialogData = {
            title: 'Save Operation',
            name: currentOp ? currentOp.name : 'Operation',
            note: currentOp?.note || '',
            forces: dialogForces,
        };
        const ref = this.dialogsService.createDialog<OperationDialogResult | null>(
            SaveOperationDialogComponent,
            { data: dialogData }
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return false; // User cancelled

        if (result.forces) {
            const newSlots: ForceSlot[] = [];
            for (const f of result.forces) {
                const slot = slots.find(s => s.force.instanceId() === f.instanceId);
                if (slot) {
                    if (slot.alignment !== f.alignment) {
                        slot.alignment = f.alignment;
                    }
                    newSlots.push(slot);
                }
            }
            for (const slot of slots) {
                if (!newSlots.includes(slot)) {
                    newSlots.push(slot);
                }
            }
            this.loadedForces.set(newSlots);
            slots = newSlots;
        }

        // Ensure all forces are saved first
        for (const slot of slots) {
            if (!slot.force.instanceId()) {
                const saved = await this.saveForceWithNameConfirmation(slot.force);
                if (!saved) {
                    this.toastService.showToast('All forces must be saved before saving an operation.', 'info');
                    return false;
                }
            }
        }

        await this.cacheLoadedOperationForcesLocally(slots);

        const forces: OperationForceRef[] = slots.map(slot => ({
            instanceId: slot.force.instanceId()!,
            alignment: slot.alignment,
            timestamp: slot.force.timestamp || new Date().toISOString(),
        }));

        const op: SerializedOperation = {
            operationId: generateUUID(),
            name: result.name,
            note: result.note,
            timestamp: Date.now(),
            forces,
        };

        try {
            await this.dataService.saveOperation(op);
            // Track the newly saved operation
            this.currentOperation.set(new LoadOperationEntry({
                operationId: op.operationId,
                name: op.name,
                note: op.note,
                timestamp: op.timestamp,
                forces: forces.map(f => ({
                    instanceId: f.instanceId,
                    alignment: f.alignment,
                    timestamp: f.timestamp,
                })),
                local: true,
                cloud: true,
                owned: true,
            }));
            this.toastService.showToast('Operation saved.', 'success');
            return true;
        } catch (error) {
            this.logger.error('Failed to save operation: ' + error);
            this.toastService.showToast('Failed to save operation.', 'error');
            return false;
        }
    }

    /**
     * Updates the currently loaded operation with the current forces, name, and note.
     * Opens the save-operation dialog pre-filled with the current operation's data.
     */
    async updateOperation(): Promise<boolean> {
        const currentOp = this.currentOperation();
        if (!currentOp) {
            this.toastService.showToast('No operation loaded to update.', 'error');
            return false;
        }

        let slots = this.loadedForces();
        if (slots.length < 2) {
            this.toastService.showToast('Need at least 2 forces to update an operation.', 'error');
            return false;
        }

        // Build force preview data from currently loaded forces
        const dialogForces: OpPreviewForce[] = slots.map(slot => ({
            name: slot.force.displayName(),
            instanceId: slot.force.instanceId() || '',
            alignment: slot.alignment,
            type: slot.force.gameSystem,
            factionId: slot.force.faction()?.id,
            bv: slot.force.gameSystem !== 'as' ? slot.force.totalBv() : undefined,
            pv: slot.force.gameSystem === 'as' ? slot.force.totalBv() : undefined,
        }));

        // Open the dialog pre-filled with current operation data
        const dialogData: OperationDialogData = {
            title: 'Update Operation',
            name: currentOp.name || '',
            note: currentOp.note || '',
            forces: dialogForces,
        };
        const ref = this.dialogsService.createDialog<OperationDialogResult | null>(
            SaveOperationDialogComponent,
            { data: dialogData }
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return false; // User cancelled

        if (result.forces) {
            const newSlots: ForceSlot[] = [];
            for (const f of result.forces) {
                const slot = slots.find(s => s.force.instanceId() === f.instanceId);
                if (slot) {
                    if (slot.alignment !== f.alignment) {
                        slot.alignment = f.alignment;
                    }
                    newSlots.push(slot);
                }
            }
            for (const slot of slots) {
                if (!newSlots.includes(slot)) {
                    newSlots.push(slot);
                }
            }
            this.loadedForces.set(newSlots);
            slots = newSlots;
        }

        // Ensure all forces are saved first
        for (const slot of slots) {
            if (!slot.force.instanceId()) {
                const saved = await this.saveForceWithNameConfirmation(slot.force);
                if (!saved) {
                    this.toastService.showToast('All forces must be saved before updating an operation.', 'info');
                    return false;
                }
            }
        }

        if (currentOp.owned) {
            await this.cacheLoadedOperationForcesLocally(slots);
        }

        const forces: OperationForceRef[] = slots.map(slot => ({
            instanceId: slot.force.instanceId()!,
            alignment: slot.alignment,
            timestamp: slot.force.timestamp || new Date().toISOString(),
        }));

        const op: SerializedOperation = {
            operationId: currentOp.operationId,
            name: result.name,
            note: result.note,
            timestamp: Date.now(),
            forces,
        };

        try {
            await this.dataService.saveOperation(op);
            // Update the tracked operation with the new data
            currentOp.name = result.name;
            currentOp.note = result.note;
            currentOp.timestamp = op.timestamp;
            currentOp.forces = forces.map(f => ({
                instanceId: f.instanceId,
                alignment: f.alignment,
                timestamp: f.timestamp,
            }));
            this.currentOperation.set(currentOp);
            this.toastService.showToast('Operation updated.', 'success');
            return true;
        } catch (error) {
            this.logger.error('Failed to update operation: ' + error);
            this.toastService.showToast('Failed to update operation.', 'error');
            return false;
        }
    }

    /**
     * Closes the current operation. Asks the user whether to keep the
     * loaded forces or unload everything.
     */
    async closeOperation(): Promise<void> {
        if (!this.currentOperation()) return;

        // Check for unsaved operation changes first
        const opProceed = await this.promptSaveOperationIfNeeded();
        if (!opProceed) return;

        const result = await this.dialogsService.choose(
            'Exit Operation',
            'Do you want to keep the currently loaded forces or unload everything?',
            [
                { label: 'KEEP FORCES', value: 'keep', class: 'primary' },
                { label: 'UNLOAD ALL', value: 'unload', class: 'danger' },
                { label: 'CANCEL', value: 'cancel' }
            ],
            'cancel'
        );

        if (result === 'keep') {
            this.currentOperation.set(null);
        } else if (result === 'unload') {
            await this.removeAllForces();
            this.currentOperation.set(null);
        }
    }

    /**
     * Loads an operation: clears all current forces and loads each force
     * from the operation with its saved alignment.
     * Falls back to local storage if cloud doesn't have a force.
     */
    /**
     * Loads an operation by ID: fetches it (syncing to cloud if needed),
     * loads all its forces, offers side-switching for non-owned operations,
     * and sets it as the current operation.
     */
    async loadOperation(
        operationId: string,
        options: { skipPrompts?: boolean } = {}
    ): Promise<boolean> {
        if (!options.skipPrompts) {
            const currentOp = this.currentOperation();
            const isSameOp = currentOp && currentOp.operationId === operationId;
            if (!isSameOp) {
                const opProceed = await this.promptSaveOperationIfNeeded();
                if (!opProceed) return false;
                const shouldContinue = await this.checkAllForcesPromptSaveForceIfNeeded();
                if (!shouldContinue) return false;
            }
        }

        // Fetch operation (also syncs local-only operations/forces to cloud)
        const entry = await this.dataService.getOperation(operationId);
        if (!entry) return false;

        if (entry.owned) {
            try {
                await this.dataService.cacheForcesLocally(entry.forces.map((forceInfo) => forceInfo.instanceId));
            } catch (error) {
                this.logger.warn(`Failed to cache operation forces locally: ${error}`);
            }
        }

        this.urlStateInitialized.set(false);
        try {
            // Clear everything
            for (const slot of this.loadedForces()) {
                this.teardownForceSlot(slot);
            }
            this.selectedUnit.set(null);
            this.loadedForces.set([]);

            let loadedAny = false;
            const failedForces: string[] = [];

            for (const forceInfo of entry.forces) {
                const force = await this.dataService.getForce(forceInfo.instanceId);
                if (force) {
                    this.addLoadedForce(force, forceInfo.alignment, { activate: !loadedAny });
                    loadedAny = true;
                } else {
                    failedForces.push(forceInfo.name || forceInfo.instanceId);
                }
            }

            if (failedForces.length > 0) {
                this.toastService.showToast(
                    `Could not find force(s): ${failedForces.join(', ')}`,
                    'error'
                );
            }

            if (!loadedAny) {
                this.toastService.showToast('No forces from this operation could be loaded.', 'error');
                return false;
            }

            // Offer to switch sides when:
            // a) we don't own the operation
            // b) we own at least one force
            // c) ALL our owned forces are on the enemy side
            if (!entry.owned) {
                const slots = this.loadedForces();
                const ownedSlots = slots.filter(s => s.force.owned());
                if (ownedSlots.length > 0 && ownedSlots.every(s => s.alignment === 'enemy')) {
                    const switchSides = await this.dialogsService.requestConfirmation(
                        'Your forces are currently assigned to the opposing side in this operation. Would you like to switch sides?',
                        'Switch Sides?',
                        'info'
                    );
                    if (switchSides) {
                        this.loadedForces.update(slots =>
                            slots.map(s => ({
                                ...s,
                                alignment: s.alignment === 'friendly' ? 'enemy' as ForceAlignment : 'friendly' as ForceAlignment
                            }))
                        );
                    }
                }
            }

            // Load all units across all loaded forces
            const allForces = this.loadedForces().map(s => s.force);
            this.loadAllUnitsWithOverlay(allForces);

            this.currentOperation.set(entry);
            return true;
        } finally {
            this.urlStateInitialized.set(true);
        }
    }

    private async cacheLoadedOperationForcesLocally(slots: readonly ForceSlot[]): Promise<void> {
        for (const slot of slots) {
            await this.dataService.saveSerializedForceToLocalStorage(slot.force.serialize());
        }
    }


    async promptChangeForceName(force: Force) {
        if (!force) {
            return;
        }
        const dialogRef = this.dialogsService.createDialog<RenameForceDialogResult | null>(RenameForceDialogComponent, {
            data: {
                force: force
            } as RenameForceDialogData
        });
        const result = await firstValueFrom(dialogRef.closed);
        if (result) {
            this.applyRenameForceDialogResult(force, result);
        }
    }

    /**
     * Saves the current force after prompting the user to confirm/edit the force name.
     * Shows a rename dialog first, then saves the force if the user confirms.
     * @returns true if the force was saved successfully, false otherwise
     */
    async saveForceWithNameConfirmation(force: Force): Promise<boolean> {
        if (!force) {
            return false;
        }
        
        // Show rename dialog to confirm/edit force name
        const dialogRef = this.dialogsService.createDialog<RenameForceDialogResult | null>(RenameForceDialogComponent, {
            data: {
                force: force,
                hideUnset: true
            } as RenameForceDialogData
        });
        
        const result = await firstValueFrom(dialogRef.closed);
        
        // User cancelled the dialog
        if (!result) {
            return false;
        }
        
        this.applyRenameForceDialogResult(force, result);
        
        // Save the force
        try {
            await this.dataService.saveForce(force);
            this.toastService.showToast('Force saved successfully.', 'success');
            return true;
        } catch (error) {
            this.logger.error('Error saving force: ' + error);
            this.toastService.showToast('Failed to save force.', 'error');
            return false;
        }
    }

    /**
     * Applies the result of a rename-force dialog to a force.
     * When the user clears the name (empty string), picks a random faction
     * and generates a random name. Faction is set without triggering a save;
     * the caller decides whether to save.
     */
    private applyRenameForceDialogResult(force: Force, result: RenameForceDialogResult): void {
        if (result.action === 'unset') {
            force.factionLock = false;
            force.faction.set(null);
            force.eraLock = false;
            force.era.set(null);
            force.setName('');
            this.generateFactionAndForceNameIfNeeded(force);
        } else {
            force.factionLock = true;
            force.faction.set(result.faction);
            force.eraLock = result.era != null;
            force.era.set(result.era);
            force.setName(result.name);
        }
    }

    async promptChangeGroupName(group: UnitGroup) {
        const dialogRef = this.dialogsService.createDialog<RenameGroupDialogResult | null>(RenameGroupDialogComponent, {
            data: {
                group: group,
            } as RenameGroupDialogData
        });
        const result = await firstValueFrom(dialogRef.closed);
        if (result !== null && result !== undefined) {
            if (result.action === 'unset') {
                group.formationHistory.clear(); // We unset, we reset!
                group.formationLock = false;
                group.formation.set(null);
                group.setName(undefined);
                this.assignFormationIfNeeded(group);
            } else
            if (result.action === 'confirm') {
                if (result.formation) {
                    group.formationHistory.clear(); // We locked it, so we don't care about previous formations
                    group.formationLock = true;
                    group.formation.set(result.formation);
                } else {
                    group.formationLock = false; // This is Automatic formation!
                    group.formation.set(null);
                    this.assignFormationIfNeeded(group);
                }
                if (!result.name) {
                    group.setName(undefined);
                } else {
                    group.setName(result.name);
                }
                this.assignFormationIfNeeded(group);
            }
        }
    }

    async checkAllForcesPromptSaveForceIfNeeded(): Promise<boolean> {
        // Check all forces loaded
        for (const slot of this.loadedForces()) {
            const force = slot.force;
            const canContinue = await this.promptSaveForceIfNeeded(force);
            if (!canContinue) {
                return false; // User cancelled
            }
        }
        return true;
    }
    
    async promptSaveForceIfNeeded(force: Force): Promise<boolean> {
        if (!force) {
            return true;
        }
        if (force.instanceId() || force.units().length == 0) {
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
            this.dataService.saveForce(force).catch(err => {
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

        if (!(unit instanceof CBTForceUnit)) {
            return;
        }

        const cbtUnit = unit;

        // Handle Classic BattleTech units
        if (!pilot) {
            const crewMembers = cbtUnit.getCrewMembers();
            if (crewMembers.length === 0) {
                this.toastService.showToast('This unit has no crew to edit.', 'error');
                return;
            }
            pilot = crewMembers[0];
        }
        const group = cbtUnit.getGroup() as UnitGroup<CBTForceUnit> | null;
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
                    unitId: cbtUnit.id,
                    name: pilot.getName(),
                    gunnery: pilot.getSkill('gunnery'),
                    piloting: pilot.getSkill('piloting'),
                    labelGunnery: `Gunnery Skill`,
                    labelPiloting: `${labelPiloting} Skill`,
                    disablePiloting: disablePiloting,
                    commander: cbtUnit.commander(),
                    group,
                    preSkillBv: cbtUnit.getBaseBv() + cbtUnit.tagBV() + cbtUnit.c3Tax(),
                    unit: baseUnit,
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

        if (group) {
            const commanderUnitId = result.commander
                ? cbtUnit.id
                : group.units().find((candidate) => candidate.id !== cbtUnit.id && candidate.commander())?.id ?? null;
            for (const candidate of group.units()) {
                candidate.setFormationCommander(candidate.id === commanderUnitId);
            }
        } else {
            cbtUnit.setFormationCommander(result.commander);
        }
    };

    /**
     * Opens the edit dialog for an Alpha Strike unit's pilot.
     */
    private async editASPilot(unit: ASForceUnit): Promise<void> {
        const group = unit.getGroup() as UnitGroup<ASForceUnit> | null;
        const ref = this.dialogsService.createDialog<EditASPilotResult | null, EditASPilotDialogComponent, EditASPilotDialogData>(
            EditASPilotDialogComponent,
            {
                data: {
                    unitId: unit.id,
                    name: unit.alias() || '',
                    skill: unit.pilotSkill(),
                    abilities: unit.manualPilotAbilities(),
                    formationAbilities: unit.formationAbilities(),
                    commander: unit.commander(),
                    group,
                    unitTypeCode: unit.getUnit().as?.TP,
                    basePv: unit.getUnit().pv,
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
            const currentAbilities = unit.manualPilotAbilities();
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

        if (group) {
            FormationAbilityAssignmentUtil.reconcileGroupFormationAssignments(group, {
                abilityOverrides: result.formationAbilityOverrides ?? new Map([[unit.id, result.formationAbilities]]),
                commanderUnitId: result.commander
                    ? unit.id
                    : group.units().find((candidate) => candidate.id !== unit.id && candidate.commander())?.id ?? null,
            });
        } else {
            unit.setFormationAbilities(result.formationAbilities);
            unit.setFormationCommander(result.commander);
        }
    }

    /**
     * Opens the C3 Network dialog for configuring C3 networks.
     * @param force The force to configure networks for
     * @param readOnly Whether the dialog should be read-only
     */
    public async openC3Network(force: Force, readOnly: boolean = false): Promise<void> {
        const { C3NetworkDialogComponent, } = await import('../components/c3-network-dialog/c3-network-dialog.component');
        type C3NetworkDialogData = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogData;
        type C3NetworkDialogResult = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogResult;
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

    /* ----------------------------------------
     * Unit Bulk Loading with Overlay
     * Loads all unloaded units across the given forces, showing a progress overlay.
     * All unit loads fire in parallel. Each unit.load() sets the isLoaded signal,
     * which the overlay picks up reactively via computed counts.
     * If any units fail, the overlay shows a retry button; the user can retry or skip.
     *
     * @param forces The forces whose units should be loaded.
     */
    public async loadAllUnitsWithOverlay(forces: Force[]): Promise<void> {
        // Collect forces that have unloaded units, with reactive progress
        const entries: { force: Force; progress: ForceLoadingProgress }[] = [];
        for (const force of forces) {
            const units = force.units();
            if (units.some(u => !u.isLoaded())) {
                const faction = force.faction();
                entries.push({
                    force,
                    progress: {
                        forceName: force.displayName(),
                        factionImg: faction ? getFactionImg(faction) || null : null,
                        loadedUnits: computed(() => units.filter(u => u.isLoaded()).length),
                        totalUnits: units.length
                    }
                });
            }
        }

        // Nothing to load — skip overlay entirely
        if (entries.length === 0) return;

        const failedCount = signal(0);
        const loading = signal(true);
        let retryResolve: (() => void) | null = null;
        let skipped = false;

        const overlayData: ForceLoadingOverlayData = {
            forces: entries.map(e => e.progress),
            failedCount,
            loading,
            onRetry: () => {
                if (retryResolve) retryResolve();
            },
            onSkip: () => {
                skipped = true;
                if (retryResolve) retryResolve();
            }
        };

        const dialogRef = this.dialogsService.createDialog<void>(ForceLoadingOverlayComponent, {
            data: overlayData,
            disableClose: true,
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'force-loading-overlay-panel'
        });

        // Collect all unloaded units across all forces
        const allUnits = entries.flatMap(e => e.force.units());
        let unloaded = allUnits.filter(u => !u.isLoaded());

        while (unloaded.length > 0) {
            loading.set(true);
            failedCount.set(0);

            // Fire all loads in parallel
            await Promise.allSettled(unloaded.map(u => u.load()));

            // Re-check which units are still not loaded
            unloaded = allUnits.filter(u => !u.isLoaded());
            if (unloaded.length === 0) break;

            // Some units failed — show retry/skip and wait for user action
            failedCount.set(unloaded.length);
            loading.set(false);

            await new Promise<void>(resolve => {
                retryResolve = resolve;
            });
            retryResolve = null;

            if (skipped) break;
        }

        dialogRef.close();
    }

}