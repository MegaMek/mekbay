// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, effect, Injectable, Injector, inject, untracked } from '@angular/core';
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
import type { CBTScenarioRebind, CBTScenarioRebindDrops } from '../models/cbt-force.types';
import { ASForce } from '../models/as-force.model';
import { GameService } from './game.service';
import type { ForceSlot, ForceAlignment } from '../models/force-slot.model';
import { ForceOperationService } from './force-operation.service';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { ForceUrlStateService } from './force-url-state.service';
import { ForceDialogsService } from './force-dialogs.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { ForceSlotLifecycleService } from './force-slot-lifecycle.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { CBT_RULESET_LABELS, type CBTRuleset } from '../models/cbt-ruleset.model';
import { scenarioRuleset, scenarioRulesFromOptions, type ScenarioRules } from '../models/runtime/unit-state-initializer';
import { jsonValuesEqual } from '../utils/json-value.util';

/** A loaded force's rebind, prepared and not yet installed. */
type PreparedForceRebind = Readonly<{ force: CBTForce; rebind: Extract<CBTScenarioRebind, { readonly bound: true }> }>;

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
    private readonly slotLifecycle = inject(ForceSlotLifecycleService);
    private readonly options = inject(OptionsService);
    private readonly toast = inject(ToastService);

    /** The rules every loaded CBT force plays: the options are their one source. */
    private readonly scenarioRules = computed(
        () => scenarioRulesFromOptions(this.options.options()),
        { equal: jsonValuesEqual },
    );
    private scenarioRebind: Promise<unknown> = Promise.resolve();

    private readonly forceLoaded = new Subject<void>();
    /** Emits whenever ForceImportService successfully applies a force entry. */
    readonly forceLoaded$ = this.forceLoaded.asObservable();


    constructor() {
        this.operations.configure({
            loadedForces: () => this.workspace.loadedForces(),
            setLoadedForces: slots => this.workspace.loadedForces.set(slots),
            saveForce: force => this.forceDialogs.saveForceWithNameConfirmation(force),
            checkForcesBeforeReplacement: () => this.forceDialogs.promptSaveAll(this.workspace.loadedForces().map(slot => slot.force)),
            removeAllForces: () => this.removeAllForces(),
            clearLoadedForcesForOperation: () => this.clearLoadedForcesForOperation(),
            addLoadedForce: (force, alignment, activate) => this.addLoadedForce(force, alignment, { activate }),
            setUrlInitializationPending: pending => this.forceUrl.setSynchronizationEnabled(!pending),
        });
        this.forceUrl.configure({
            loadedForces: () => this.workspace.loadedForces(),
            selectedUnit: () => this.workspace.selectedUnit(),
            selectUnit: unit => this.workspace.selectUnit(unit),
            clear: () => this.clear(),
            addLoadedForce: (force, alignment, activate) => this.addLoadedForce(force, alignment, { activate }),
            getForceSlot: force => this.workspace.getForceSlot(force),
        });
        this.forceUrl.start();
        this.opforTargets.connect(this.workspace.loadedForces);
        // Every loaded force, one loaded later included, plays the rules in the options.
        effect(() => {
            if (!this.options.initialized()) return;
            this.scenarioRules();
            this.workspace.loadedForces();
            untracked(() => void this.queueRebind(() => this.bindLoadedForces(this.scenarioRules())));
        });
    }

    /**
     * Switches the CBT rules live, all or nothing: every loaded force prepares its rebind first,
     * and only when every one can switch are they installed and the choice saved. Otherwise
     * nothing changes, the player is told which force cannot switch, and this resolves false.
     *
     * A force that changes between preparing and installing installs nothing; the switch still
     * completes and that force is bound again from its current state, the player being told if it
     * still cannot switch. Choosing the rules every force already plays changes nothing.
     */
    switchCBTRules(ruleset: CBTRuleset): Promise<boolean> {
        return this.queueRebind(async () => {
            const scenario = scenarioRulesFromOptions({ ...this.options.options(), CBTRules: ruleset });
            const prepared = await this.prepareLoadedForces(scenario);
            if (prepared.failed.length > 0) {
                this.toast.showToast(
                    `${prepared.failed.join(', ')} could not switch to ${CBT_RULESET_LABELS[ruleset]}, so every force keeps ${CBT_RULESET_LABELS[this.options.options().CBTRules]}.`,
                    'error',
                );
                return false;
            }
            const stale = await this.installPrepared(prepared.rebinds);
            if (this.options.options().CBTRules !== ruleset) await this.options.setOption('CBTRules', ruleset);
            if (stale.length > 0) await this.bindLoadedForces(scenario);
            return true;
        });
    }

    /**
     * Binds every loaded force to `scenario` independently: a force that cannot switch keeps its
     * rules, and the player is told which.
     */
    private async bindLoadedForces(scenario: ScenarioRules): Promise<void> {
        const failed: string[] = [];
        const dropped: CBTScenarioRebindDrops[number][] = [];
        for (const slot of this.workspace.loadedForces()) {
            if (!(slot.force instanceof CBTForce)) continue;
            const result = await slot.force.rebindScenarioRules(scenario).catch(error => {
                this.logger.error(`ForceBuilderService: Rule rebinding failed: ${String(error)}`);
                return null;
            });
            if (result?.bound) dropped.push(...result.dropped);
            else failed.push(slot.force.displayName());
        }
        this.reportDropped(dropped);
        if (failed.length > 0) {
            this.toast.showToast(
                `${failed.join(', ')} could not switch to ${CBT_RULESET_LABELS[scenarioRuleset(scenario)]} and keep${failed.length === 1 ? 's' : ''} ${failed.length === 1 ? 'its' : 'their'} previous rules.`,
                'error',
            );
        }
    }

    /** Rebinds run one at a time, so the forces always end on the latest requested rules. */
    private queueRebind<T>(job: () => Promise<T>): Promise<T> {
        const next = this.scenarioRebind.then(job, job);
        this.scenarioRebind = next.catch(() => undefined);
        return next;
    }

    /** Prepares every loaded CBT force's rebind to `scenario`; nothing is installed. */
    private async prepareLoadedForces(scenario: ScenarioRules): Promise<Readonly<{
        rebinds: readonly PreparedForceRebind[];
        failed: readonly string[];
    }>> {
        const rebinds: PreparedForceRebind[] = [];
        const failed: string[] = [];
        for (const slot of this.workspace.loadedForces()) {
            if (!(slot.force instanceof CBTForce)) continue;
            const force = slot.force;
            const rebind = await force.prepareScenarioRebind(scenario).catch(error => {
                this.logger.error(`ForceBuilderService: Rule rebinding failed: ${String(error)}`);
                return null;
            });
            if (rebind?.bound) rebinds.push({ force, rebind });
            else failed.push(force.displayName());
        }
        return Object.freeze({ rebinds: Object.freeze(rebinds), failed: Object.freeze(failed) });
    }

    /**
     * Installs prepared rebinds and tells the player what the installed rules could not keep.
     * Resolves the forces that changed since preparing and so installed nothing.
     */
    private async installPrepared(
        rebinds: readonly PreparedForceRebind[],
    ): Promise<readonly string[]> {
        const stale: string[] = [];
        const dropped: CBTScenarioRebindDrops[number][] = [];
        for (const { force, rebind } of rebinds) {
            const installed = await rebind.install().catch(error => {
                this.logger.error(`ForceBuilderService: Rule rebinding failed: ${String(error)}`);
                return false;
            });
            if (installed) dropped.push(...rebind.dropped);
            else stale.push(force.displayName());
        }
        this.reportDropped(dropped);
        return Object.freeze(stale);
    }

    /** Tells the player what installed rules could not keep. */
    private reportDropped(dropped: CBTScenarioRebindDrops): void {
        if (dropped.length === 0) return;
        this.toast.showToast(
            `The new rules could not keep: ${dropped.map(unit => `${unit.unit} (${unit.items.join(', ')})`).join('; ')}.`,
            'info',
        );
    }

    /** Import workflow notification used by UI that outlives nested force dialogs. */
    notifyForceLoaded(): void {
        this.forceLoaded.next();
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
