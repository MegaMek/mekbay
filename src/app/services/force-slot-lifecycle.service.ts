// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, inject, Injectable } from '@angular/core';

import { Force } from '../models/force.model';
import { CBTForce } from '../models/cbt-force.model';
import type { ForceAlignment, ForceSlot } from '../models/force-slot.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { SerializedForce } from '../models/force-serialization';
import { DataService } from './data.service';
import { ForceRemoteSyncService } from './force-remote-sync.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { LoggerService } from './logger.service';
import { WsService, type ForceUpdateSource } from './ws.service';

interface ForceSlotActivationPlan {
    enabled: boolean;
    readonly onRemoteUpdate: (
        serializedForce: SerializedForce,
        source: ForceUpdateSource,
    ) => void | Promise<void>;
}

/** Owns force-slot subscriptions, authority activation, replacement, and retirement. */
@Injectable({ providedIn: 'root' })
export class ForceSlotLifecycleService {
    private readonly dataService = inject(DataService);
    private readonly logger = inject(LoggerService);
    private readonly remoteSync = inject(ForceRemoteSyncService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly wsService = inject(WsService);
    private readonly activationPlans = new WeakMap<ForceSlot, ForceSlotActivationPlan>();

    constructor() {
        this.remoteSync.configure({
            loadedForces: this.workspace.loadedForces,
            selectedUnit: this.workspace.selectedUnit,
            followLastModifiedUnit: () => this.workspace.followLastModifiedUnit(),
            getForceSlot: force => this.workspace.getForceSlot(force),
            setupForceSlot: (force, alignment, activate) => this.setupForceSlot(force, alignment, activate),
            activateForceSlot: slot => this.activateForceSlot(slot),
            teardownForceSlot: slot => this.teardownForceSlot(slot),
            disposeDetachedForceSlot: slot => this.disposeDetachedForceSlot(slot),
            destroyDetachedForceUnits: force => this.destroyDetachedForceUnits(force),
            selectUnit: unit => this.workspace.selectUnit(unit),
        });
        this.dataService.forceNeedsAdoption.subscribe(force => {
            const slot = this.workspace.getForceSlot(force);
            if (!slot) return;
            void this.adoptForce(slot).catch(error => {
                this.logger.error(`Could not adopt force ${force.instanceId()}: ${error}`);
            });
        });
        inject(DestroyRef).onDestroy(() => {
            for (const slot of this.workspace.loadedForces()) this.teardownForceSlot(slot);
        });
    }

    setupForceSlot(
        force: Force,
        alignment: ForceAlignment,
        activate: boolean = true,
    ): ForceSlot {
        const slot: ForceSlot = { force, alignment, changeSub: null };
        const instanceId = force.instanceId();
        this.logger.info(`ForceSlotLifecycleService: setting up "${force.displayName()}"${instanceId ? ` (${instanceId})` : ''}`);
        const activation: ForceSlotActivationPlan = {
            enabled: false,
            onRemoteUpdate: (serializedForce, source) => {
                if (serializedForce.instanceId !== force.instanceId()) {
                    this.logger.warn(`Ignoring force update for ${serializedForce.instanceId}; slot owns ${force.instanceId()}.`);
                    return;
                }
                return this.remoteSync.reconcileRemoteForce(force, serializedForce, source);
            },
        };
        slot.changeSub = force.changed.subscribe(() => {
            if (!activation.enabled) return;
            if (!force.owned()) {
                void this.adoptForce(slot).catch(error => {
                    this.logger.error(`Could not adopt force ${force.instanceId()}: ${error}`);
                });
                return;
            }
            this.dataService.queueForceAutosave(force);
            this.dataService.activateForceAuthority(force);
        });
        this.activationPlans.set(slot, activation);
        if (!activate) return slot;
        try {
            this.activateForceSlot(slot);
            return slot;
        } catch (error) {
            activation.enabled = false;
            this.activationPlans.delete(slot);
            slot.changeSub.unsubscribe();
            slot.changeSub = null;
            throw error;
        }
    }

    activateForceSlot(slot: ForceSlot): void {
        const force = slot.force;
        const activation = this.activationPlans.get(slot);
        if (!activation) throw new Error('Force slot has no prepared activation plan');
        if (!this.dataService.activateForceAuthority(force)) {
            throw new Error(`Force authority for ${force.instanceId() ?? force.displayName()} is already claimed or inactive`);
        }
        activation.enabled = true;
        const instanceId = force.instanceId();
        if (!instanceId) return;
        try {
            void Promise.resolve(this.wsService.subscribeToForceUpdates(
                instanceId,
                activation.onRemoteUpdate,
            )).catch(error => {
                this.logger.error(`Could not subscribe to remote updates for force ${instanceId}: ${error}`);
            });
        } catch (error) {
            this.logger.error(`Could not subscribe to remote updates for force ${instanceId}: ${error}`);
        }
    }

    teardownForceSlot(slot: ForceSlot): void {
        const activation = this.activationPlans.get(slot);
        if (activation) activation.enabled = false;
        this.activationPlans.delete(slot);
        try {
            slot.force.flushPendingChanges();
        } catch (error) {
            this.logger.warn(`Could not flush retired force ${slot.force.instanceId()}: ${error}`);
        }
        try {
            slot.changeSub?.unsubscribe();
        } catch (error) {
            this.logger.warn(`Could not unsubscribe retired force changes ${slot.force.instanceId()}: ${error}`);
        }
        slot.changeSub = null;
        const instanceId = slot.force.instanceId();
        if (instanceId) {
            try {
                void Promise.resolve(this.wsService.unsubscribeFromForceUpdates(instanceId)).catch(error => {
                    this.logger.warn(`Could not unsubscribe retired force updates ${instanceId}: ${error}`);
                });
            } catch (error) {
                this.logger.warn(`Could not unsubscribe retired force updates ${instanceId}: ${error}`);
            }
        }
        try {
            this.dataService.deactivateForceAuthority(slot.force);
        } catch (error) {
            this.logger.warn(`Could not deactivate retired force ${instanceId}: ${error}`);
        }
        if (slot.force instanceof CBTForce) return;
        let retiredUnits: readonly ForceUnit[];
        try {
            retiredUnits = slot.force.units();
        } catch (error) {
            this.logger.warn(`Could not enumerate retired force units ${instanceId}: ${error}`);
            return;
        }
        for (const unit of retiredUnits) {
            try {
                unit.destroy();
            } catch (error) {
                this.logger.warn(`Could not destroy retired force unit ${unit.id}: ${error}`);
            }
        }
    }

    disposeDetachedForceSlot(slot: ForceSlot): void {
        const activation = this.activationPlans.get(slot);
        if (activation) activation.enabled = false;
        this.activationPlans.delete(slot);
        try {
            slot.changeSub?.unsubscribe();
        } catch {
            // Detached cleanup is best-effort.
        }
        slot.changeSub = null;
    }

    destroyDetachedForceUnits(force: Force): void {
        if (force instanceof CBTForce) return;
        let units: readonly ForceUnit[];
        try {
            units = force.units();
        } catch {
            return;
        }
        for (const unit of units) {
            try {
                unit.destroy();
            } catch {
                // Detached cleanup is best-effort.
            }
        }
    }

    async retireAndPublishSlotRemoval(
        expectedSlots: ForceSlot[],
        retiringSlots: readonly ForceSlot[],
        publishedSlots: ForceSlot[],
        beforePublication: () => void = () => undefined,
    ): Promise<boolean> {
        if (retiringSlots.length === 0) {
            if (this.workspace.loadedForces() !== expectedSlots) return false;
            beforePublication();
            this.workspace.loadedForces.set(publishedSlots);
            return true;
        }
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (this.workspace.loadedForces() !== expectedSlots
                || retiringSlots.some(slot => !expectedSlots.includes(slot)
                    || this.workspace.getForceSlot(slot.force) !== slot)) return false;

            const retirements: Array<{
                readonly slot: ForceSlot;
                readonly handle: NonNullable<ReturnType<Force['beginWholeOwnerRetirement']>>;
            }> = [];
            let acquisitionFailed = false;
            for (const slot of retiringSlots) {
                const handle = slot.force.beginWholeOwnerRetirement();
                if (!handle) {
                    acquisitionFailed = true;
                    break;
                }
                retirements.push({ slot, handle });
            }
            if (acquisitionFailed) {
                for (const entry of retirements) entry.slot.force.cancelWholeOwnerRetirement(entry.handle.token);
                return false;
            }

            const readiness = await Promise.all(retirements.map(entry => entry.handle.ready));
            if (readiness.some(ready => !ready)) {
                for (const entry of retirements) entry.slot.force.cancelWholeOwnerRetirement(entry.handle.token);
                if (attempt + 1 < maxAttempts && this.workspace.loadedForces() === expectedSlots) continue;
                return false;
            }
            if (this.workspace.loadedForces() !== expectedSlots
                || retiringSlots.some(slot => this.workspace.getForceSlot(slot.force) !== slot)) {
                for (const entry of retirements) entry.slot.force.cancelWholeOwnerRetirement(entry.handle.token);
                return false;
            }

            const fingerprints = retirements.map(entry => ({
                entry,
                fingerprint: entry.slot.force.captureWholeOwnerAuthorityFingerprint(),
            }));
            const persistenceResults = await Promise.allSettled(fingerprints.map(({ entry, fingerprint }) =>
                this.dataService.drainForceAuthorityPersistence(entry.slot.force, fingerprint)));
            const persistenceDrained = persistenceResults.every(result => result.status === 'fulfilled' && result.value);
            const slotsStillCurrent = this.workspace.loadedForces() === expectedSlots
                && retiringSlots.every(slot => this.workspace.getForceSlot(slot.force) === slot);
            const persistenceRejected = persistenceResults.some(result => result.status === 'rejected');
            if (!persistenceDrained || !slotsStillCurrent) {
                for (const result of persistenceResults) {
                    if (result.status === 'rejected') {
                        this.logger.error(`Could not drain force persistence before removal: ${result.reason}`);
                    }
                }
                for (const entry of retirements) entry.slot.force.cancelWholeOwnerRetirement(entry.handle.token);
                if (!persistenceRejected && slotsStillCurrent && attempt + 1 < maxAttempts) continue;
                return false;
            }
            if (fingerprints.some(({ entry, fingerprint }) =>
                !entry.slot.force.isWholeOwnerAuthorityFingerprintCurrent(fingerprint))) {
                for (const entry of retirements) entry.slot.force.cancelWholeOwnerRetirement(entry.handle.token);
                return false;
            }

            let published = false;
            const committed = Force.commitWholeOwnerRetirements(
                retirements.map(entry => ({ force: entry.slot.force, token: entry.handle.token })),
                authorities => {
                    if (this.workspace.loadedForces() !== expectedSlots
                        || retiringSlots.some(slot => this.workspace.getForceSlot(slot.force) !== slot)) return null;
                    const finalizers: Array<() => void> = [];
                    for (let index = 0; index < retirements.length; index += 1) {
                        const finalize = this.dataService.prepareForceAuthorityRemoval(
                            retirements[index].slot.force,
                            authorities[index],
                        );
                        if (!finalize) return null;
                        finalizers.push(finalize);
                    }
                    return () => {
                        for (const finalize of finalizers) finalize();
                        this.workspace.loadedForces.set(publishedSlots);
                        published = true;
                        try {
                            beforePublication();
                        } catch {
                            // Selection cosmetics cannot roll back committed retirement.
                        }
                    };
                },
            );
            if (!committed || !published) {
                for (const entry of retirements) entry.slot.force.cancelWholeOwnerRetirement(entry.handle.token);
                return false;
            }
            for (const slot of retiringSlots) {
                try {
                    this.teardownForceSlot(slot);
                } catch (error) {
                    this.logger.warn(`Could not tear down retired force ${slot.force.instanceId()}: ${error}`);
                }
            }
            return true;
        }
        return false;
    }

    private async adoptForce(slot: ForceSlot): Promise<void> {
        const oldForce = slot.force;
        const expectedSlots = this.workspace.loadedForces();
        if (this.workspace.getForceSlot(oldForce) !== slot || !expectedSlots.includes(slot)) return;
        const sourceFingerprint = oldForce.captureWholeOwnerAuthorityFingerprint();
        const selectedBefore = this.workspace.selectedUnit();
        const selectedIndex = selectedBefore === null
            ? -1
            : oldForce.members().indexOf(selectedBefore);
        const cloned = await oldForce.cloneForPersistence();
        if (this.workspace.loadedForces() !== expectedSlots
            || this.workspace.getForceSlot(oldForce) !== slot
            || !oldForce.isWholeOwnerAuthorityFingerprintCurrent(sourceFingerprint)) {
            this.destroyDetachedForceUnits(cloned);
            return;
        }
        let newSlot: ForceSlot | null = null;
        let published = false;
        try {
            newSlot = this.setupForceSlot(cloned, slot.alignment, false);
            const publishedSlots = expectedSlots.map(candidate => candidate === slot ? newSlot! : candidate);
            const clonedUnits = cloned.members();
            const selectedAfter = selectedIndex >= 0
                ? clonedUnits[selectedIndex] ?? clonedUnits[0] ?? null
                : selectedBefore;
            published = await this.retireAndPublishSlotRemoval(
                expectedSlots,
                [slot],
                publishedSlots,
                () => {
                    if (this.workspace.selectedUnit() === selectedBefore && selectedIndex >= 0) {
                        this.workspace.selectedUnit.set(selectedAfter);
                    }
                },
            );
            if (!published) return;
            this.activateForceSlot(newSlot);

            const oldInstanceId = oldForce.instanceId();
            if (oldInstanceId) await this.dataService.deleteLocalForce(oldInstanceId);
            await this.dataService.saveForceAndWaitForCloud(cloned);
        } finally {
            if (!published) {
                if (newSlot) this.disposeDetachedForceSlot(newSlot);
                this.destroyDetachedForceUnits(cloned);
            }
        }
    }
}
