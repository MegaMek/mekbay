// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { effect, Injectable, Injector, inject } from '@angular/core';
import {
    Force,
} from '../models/force.model';
import {
    DataService,
} from './data.service';
import { ForcePersistenceService } from './force-persistence.service';
import { Subject } from 'rxjs';
import { LoggerService } from './logger.service';
import { GameSystem } from '../models/common.model';
import {
    CBTForce,
} from '../models/cbt-force.model';
import { ASForce } from '../models/as-force.model';
import { GameService } from './game.service';
import type { ForceSlot, ForceAlignment } from '../models/force-slot.model';
import { ForceOperationService } from './force-operation.service';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { ForceUrlStateService } from './force-url-state.service';
import { ForceDialogsService } from './force-dialogs.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { ASForceUnitLoadingService } from './as-force-unit-loading.service';
import { ForceSlotLifecycleService } from './force-slot-lifecycle.service';
import { OptionsService } from './options.service';

@Injectable({
    providedIn: 'root'
})
export class ForceBuilderService {
    logger = inject(LoggerService);
    dataService = inject(DataService);
    private readonly forcePersistence = inject(ForcePersistenceService);
    private injector = inject(Injector);
    readonly operations = inject(ForceOperationService);
    private readonly opforTargets = inject(InventoryControlOpforService);
    private readonly forceUrl = inject(ForceUrlStateService);
    private readonly forceDialogs = inject(ForceDialogsService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly unitLoading = inject(ASForceUnitLoadingService);
    private readonly slotLifecycle = inject(ForceSlotLifecycleService);
    private readonly options = inject(OptionsService);

    /** Emits whenever a force is successfully loaded via loadForceEntry. */
    public readonly forceLoaded$ = new Subject<void>();


    constructor() {
        this.operations.configure({
            loadedForces: () => this.workspace.loadedForces(),
            setLoadedForces: slots => this.workspace.loadedForces.set(slots),
            saveForce: force => this.forceDialogs.saveForceWithNameConfirmation(force),
            checkForcesBeforeReplacement: () => this.forceDialogs.promptSaveAll(this.workspace.loadedForces().map(slot => slot.force)),
            removeAllForces: () => this.removeAllForces(),
            clearLoadedForcesForOperation: () => this.clearLoadedForcesForOperation(),
            addLoadedForce: (force, alignment, activate) => this.addLoadedForce(force, alignment, { activate }),
            loadAllUnits: forces => this.unitLoading.load(forces),
            setUrlInitializationPending: pending => this.forceUrl.setSynchronizationEnabled(!pending),
        });
        this.forceUrl.configure({
            loadedForces: () => this.workspace.loadedForces(),
            selectedUnit: () => this.workspace.selectedUnit(),
            selectUnit: unit => this.workspace.selectUnit(unit),
            clear: () => this.clear(),
            addLoadedForce: (force, alignment, activate) => this.addLoadedForce(force, alignment, { activate }),
            getForceSlot: force => this.workspace.getForceSlot(force),
            loadAllUnits: forces => this.unitLoading.load(forces),
        });
        this.forceUrl.start();
        this.forceDialogs.configure({
            getForceSlot: force => this.workspace.getForceSlot(force),
            loadAllUnits: forces => this.unitLoading.load(forces),
        });
        this.opforTargets.connect(this.workspace.loadedForces);
        effect(() => {
            if (!this.options.initialized()) return;
            const { forcedWithdrawal, sprinting } = this.options.options().CBTOptionalRules;
            for (const slot of this.workspace.loadedForces()) {
                if (!(slot.force instanceof CBTForce)) continue;
                void slot.force.synchronizeOptionalRules({ forcedWithdrawal, sprinting })
                    .catch(error => this.logger.error(
                        `ForceBuilderService: Optional-rule synchronization failed: ${String(error)}`,
                    ));
            }
        });
    }


    /**
     * Adds a force to the loaded forces list with the given alignment.
     * By default, selects the first unit of the added force and switches
     * the alignment filter if necessary so the new force is visible.
     * Pass `activate: false` to just add the slot without switching selection/filter.
     */
    addLoadedForce(
        force: Force,
        alignment: ForceAlignment = 'friendly',
        { activate = true, persistInUrl = true }: { activate?: boolean; persistInUrl?: boolean } = {},
    ): boolean {
        if (!force.isWholeOwnerActive()) {
            this.logger.warn(`ForceBuilderService: Refusing to load inactive owner "${force.displayName()}".`);
            return false;
        }
        // Guard against duplicate instanceIds (can occur from concurrent async loads)
        const instanceId = force.instanceId();
        if (instanceId && this.workspace.loadedForces().some(s => s.force.instanceId() === instanceId)) {
            this.logger.warn(`ForceBuilderService: Skipping duplicate force "${force.displayName()}" (instance: ${instanceId})`);
            return false;
        }
        const slot = this.slotLifecycle.setupForceSlot(force, alignment, true, persistInUrl);
        this.workspace.loadedForces.update(slots => [...slots, slot]);

        if (activate) {
            // Ensure the new force is visible under the current filter
            const filter = this.workspace.alignmentFilter();
            if (filter !== 'all' && filter !== alignment) {
                this.workspace.alignmentFilter.set(alignment);
            }

            // Activate the new force by selecting its first unit
            this.workspace.selectUnit(force.members()[0] ?? null);
        }
        return true;
    }

    /**
     * Removes a specific force from the loaded forces list and cleans up its resources.
     */
    async removeLoadedForce(force: Force, options: { skipPrompt?: boolean } = {}): Promise<boolean> {
        const slot = this.workspace.getForceSlot(force);
        if (!slot) return false;

        const shouldProceed = options.skipPrompt ? true : await this.forceDialogs.promptSaveForceIfNeeded(force);
        if (!shouldProceed) {
            return false;
        }

        const expectedSlots = this.workspace.loadedForces();
        if (this.workspace.getForceSlot(force) !== slot || !expectedSlots.includes(slot)) return false;

        // Determine switch targets BEFORE teardown (which destroys units)
        const selectedUnit = this.workspace.selectedUnit();
        const selectionWasInForce = selectedUnit?.force === force;
        const remaining = expectedSlots.filter(s => s !== slot);
        const nextUnit = remaining.length > 0 ? remaining[0].force.members()[0] ?? null : null;

        const removed = await this.slotLifecycle.retireAndPublishSlotRemoval(
            expectedSlots,
            [slot],
            remaining,
            () => {
                if (selectionWasInForce) this.workspace.selectedUnit.set(nextUnit);
            },
        );
        if (!removed) return false;

        // If the last force was removed, silently clear the operation
        // (no save prompt, there are no forces left to save)
        if (this.workspace.loadedForces().length === 0) {
            this.operations.clearIfNoForces();
        }
        return true;
    }

    async clear(): Promise<boolean> {
        // Prompt to save/update operation BEFORE removing forces
        const opProceed = await this.operations.promptSaveIfChanged();
        if (!opProceed) return false;

        const cleared = await this.removeAllForces();
        if (cleared) {
            this.operations.clear();
        }
        return cleared;
    }

    async removeAllForces(): Promise<boolean> {
        const shouldProceed = await this.forceDialogs.promptSaveAll(this.workspace.loadedForces().map(slot => slot.force));
        if (!shouldProceed) {
            return false;
        }
        const expectedSlots = this.workspace.loadedForces();
        const removed = await this.slotLifecycle.retireAndPublishSlotRemoval(
            expectedSlots,
            expectedSlots,
            [],
            () => this.workspace.selectedUnit.set(null),
        );
        if (!removed) return false;
        this.forceUrl.clearQuery();
        this.logger.info('ForceBuilderService: All forces removed.');
        return true;
    }

    /**
     * Reorders the loaded forces by moving a force from one index to another.
     */
    reorderLoadedForces(previousIndex: number, currentIndex: number): void {
        if (previousIndex === currentIndex) return;
        this.workspace.loadedForces.update(slots => {
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
        const removed = await this.removeLoadedForce(force, { skipPrompt: true });
        if (!removed) return;
        if (forceInstanceId) {
            await this.forcePersistence.deleteForce(forceInstanceId);
            this.logger.info(`ForceBuilderService: Force with instance ID ${forceInstanceId} deleted.`);
        }
        if (this.workspace.loadedForces().length === 0) {
            // Silently clear, no forces left, nothing to save
            this.operations.clearIfNoForces();
            this.forceUrl.clearQuery();
        }
    }

    /** Atomically narrows the workspace to one exact force owner, or clears it. */
    private async replaceWorkspaceForce(newForce: Force | null): Promise<void> {
        const expectedSlots = this.workspace.loadedForces();
        const sameIdSlots = newForce?.instanceId()
            ? expectedSlots.filter(slot => slot.force.instanceId() === newForce.instanceId())
            : [];
        if (newForce && sameIdSlots.some(slot => slot.force !== newForce)) {
            throw new Error('A different loaded force already owns this instance ID.');
        }
        const preservedSlot = newForce
            ? expectedSlots.find(slot => slot.force === newForce)
            : undefined;
        const retiringSlots = preservedSlot
            ? expectedSlots.filter(slot => slot !== preservedSlot)
            : expectedSlots;
        let replacementSlot: ForceSlot | null = null;
        let published = false;
        try {
            if (newForce && !preservedSlot) {
                if (!newForce.isWholeOwnerActive()) {
                    throw new Error('The replacement force owner is inactive.');
                }
                replacementSlot = this.slotLifecycle.setupForceSlot(newForce, 'friendly', false);
            }
            const publishedSlots = preservedSlot
                ? [preservedSlot]
                : replacementSlot
                    ? [replacementSlot]
                    : [];
            const selectionBefore = this.workspace.selectedUnit();
            published = await this.slotLifecycle.retireAndPublishSlotRemoval(
                expectedSlots,
                retiringSlots,
                publishedSlots,
                () => {
                    const survivingForce = preservedSlot?.force ?? replacementSlot?.force ?? null;
                    if (selectionBefore !== null
                        && selectionBefore.force === survivingForce) return;
                    this.workspace.selectedUnit.set(survivingForce ? survivingForce.members()[0] ?? null : null);
                },
            );
            if (!published) {
                throw new Error('The current force changed before it could be replaced.');
            }
            if (replacementSlot) this.slotLifecycle.activateForceSlot(replacementSlot);
            if (!newForce) this.forceUrl.clearQuery();
        } finally {
            if (!published && replacementSlot) this.slotLifecycle.disposeDetachedForceSlot(replacementSlot);
        }
    }

    /** Deletes a stored force, retiring its exact loaded owner first when present. */
    async deleteForceByInstanceId(instanceId: string): Promise<boolean> {
        const matches = this.workspace.loadedForces().filter(slot => slot.force.instanceId() === instanceId);
        if (matches.length > 1) return false;
        if (matches.length === 1) {
            await this.deleteAndRemoveForce(matches[0].force);
            return this.workspace.getForceSlot(matches[0].force) === undefined;
        }
        await this.forcePersistence.deleteForce(instanceId);
        return true;
    }

    private async clearLoadedForcesForOperation(): Promise<boolean> {
        const expectedSlots = this.workspace.loadedForces();
        return this.slotLifecycle.retireAndPublishSlotRemoval(
            expectedSlots,
            expectedSlots,
            [],
            () => this.workspace.selectedUnit.set(null),
        );
    }

    /**
     * Loads a force by replacing all currently loaded forces with the new one.
     */
    async loadForce(force: Force): Promise<boolean> {
        this.forceUrl.setSynchronizationEnabled(false);
        try {
            const exactSlot = this.workspace.getForceSlot(force);
            if (exactSlot) {
                const opProceed = await this.operations.promptSaveIfChanged();
                if (!opProceed) return false;
                const shouldProceed = await this.forceDialogs.promptSaveAll(this.workspace.loadedForces().map(slot => slot.force));
                if (!shouldProceed) return false;
                await this.replaceWorkspaceForce(force);
                exactSlot.alignment = 'friendly';
                this.workspace.selectUnit(force.members()[0] ?? null);
            } else {
                const instanceId = force.instanceId();
                if (instanceId && this.workspace.loadedForces().some(slot => slot.force.instanceId() === instanceId)) {
                    this.logger.error(`Cannot load a detached duplicate owner for force ${instanceId}.`);
                    return false;
                }
                const cleared = await this.clear();
                if (!cleared) return false; // User cancelled operation/force save prompt
                if (!this.addLoadedForce(force, 'friendly', { activate: true })) {
                    return false;
                }
            }
            await this.unitLoading.load([force]);
        } finally {
            this.forceUrl.setSynchronizationEnabled(true);
        }
        return true;
    }

    /**
     * Adds a force to the loaded forces without replacing existing ones.
     * Unlike loadForce(), this preserves currently loaded forces.
     */
    async addForce(force: Force, alignment: ForceAlignment = 'friendly', { activate = true }: { activate?: boolean } = {}): Promise<boolean> {
        this.forceUrl.setSynchronizationEnabled(false);
        try {
            if (!this.addLoadedForce(force, alignment, { activate })) {
                return false;
            }
            await this.unitLoading.load([force]);
        } finally {
            this.forceUrl.setSynchronizationEnabled(true);
        }
        return true;
    }

    async createNewForce(name: string = '', gameSystemOverride?: GameSystem): Promise<Force | null> {
        // Lazy inject GameService to avoid circular dependency
        const gameService = this.injector.get(GameService);
        const gameSystem = gameSystemOverride ?? gameService.currentGameSystem();
        let newForce: Force | null = null;
        if (gameSystem === GameSystem.AS) {
            newForce = new ASForce(name, this.dataService, this.injector);
        } else {
            newForce = new CBTForce(name, this.dataService, this.injector);
        }
        if (newForce && !await this.loadForce(newForce)) {
            return null;
        }
        return newForce;
    }

}
