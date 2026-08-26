// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { Force } from '../models/force.model';
import type { ForceSlot } from '../models/force-slot.model';
import type { ForceAlignment } from '../models/force-slot.model';
import {
    LoadOperationEntry,
    type OperationForceRef,
    type SerializedOperation,
} from '../models/operation.model';
import type { OpPreviewForce } from '../components/op-preview/op-preview.component';
import {
    SaveOperationDialogComponent,
    type OperationDialogData,
    type OperationDialogResult,
} from '../components/save-operation-dialog/save-operation-dialog.component';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { ToastService } from './toast.service';
import { uuidv7 } from '../utils/uuid.util';

export interface ForceOperationHost {
    loadedForces(): ForceSlot[];
    setLoadedForces(slots: ForceSlot[]): void;
    saveForce(force: Force): Promise<boolean>;
    checkForcesBeforeReplacement(): Promise<boolean>;
    removeAllForces(): Promise<boolean>;
    clearLoadedForcesForOperation(): Promise<boolean>;
    addLoadedForce(force: Force, alignment: ForceAlignment, activate: boolean): boolean;
    destroyDetachedForce(force: Force): void;
    loadAllUnits(forces: Force[]): Promise<void>;
    setUrlInitializationPending(pending: boolean): void;
}

/**
 * Owns multi-force operation persistence and composition. ForceBuilder owns
 * live force slots; this service owns operation state and orchestration. The
 * explicit host contract prevents either service from forwarding the other's
 * public API or growing a circular dependency.
 */
@Injectable({ providedIn: 'root' })
export class ForceOperationService {
    private readonly data = inject(DataService);
    private readonly dialogs = inject(DialogsService);
    private readonly logger = inject(LoggerService);
    private readonly toast = inject(ToastService);
    private host: ForceOperationHost | null = null;

    readonly currentOperation = signal<LoadOperationEntry | null>(null);
    readonly hasOperation = computed(() => this.currentOperation() !== null);
    readonly canSaveOperation = computed(() => {
        const host = this.host;
        if (!host || host.loadedForces().length < 2) return false;
        const operation = this.currentOperation();
        return !operation || !operation.owned;
    });
    readonly canUpdateOperation = computed(() => {
        const host = this.host;
        const operation = this.currentOperation();
        return !!host && !!operation && operation.owned && host.loadedForces().length >= 2;
    });

    configure(host: ForceOperationHost): void {
        if (this.host && this.host !== host) throw new Error('Force operation host is already configured');
        this.host = host;
    }

    clearIfNoForces(): void {
        if (this.requireHost().loadedForces().length === 0) this.currentOperation.set(null);
    }

    clear(): void {
        this.currentOperation.set(null);
    }

    async promptSaveIfChanged(): Promise<boolean> {
        const operation = this.currentOperation();
        if (!operation || !this.hasChanges(operation)) return true;
        const host = this.requireHost();
        if (operation.owned && host.loadedForces().length >= 2) {
            const result = await this.dialogs.choose(
                'Unsaved Operation Changes',
                `The operation "${operation.name}" has been modified. Do you want to update it before proceeding?`,
                [
                    { label: 'UPDATE', value: 'update', class: 'primary' },
                    { label: 'DISCARD', value: 'discard', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' },
                ],
                'cancel',
            );
            if (result === 'update') return this.updateOperation();
            return result !== 'cancel';
        }
        if (host.loadedForces().length >= 2) {
            const result = await this.dialogs.choose(
                'Unsaved Operation Changes',
                'The operation has been modified. Do you want to save it as a new operation before proceeding?',
                [
                    { label: 'SAVE AS NEW', value: 'save', class: 'primary' },
                    { label: 'DISCARD', value: 'discard', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' },
                ],
                'cancel',
            );
            if (result === 'save') return this.saveOperation();
            return result !== 'cancel';
        }
        return true;
    }

    async saveOperation(): Promise<boolean> {
        const host = this.requireHost();
        let slots = host.loadedForces();
        if (slots.length < 2) {
            this.toast.showToast('Need at least 2 forces to save an operation.', 'error');
            return false;
        }
        const current = this.currentOperation();
        const result = await this.editOperation({
            title: 'Save Operation',
            name: current?.name ?? 'Operation',
            note: current?.note ?? '',
            forces: operationPreview(slots),
        });
        if (!result) return false;
        slots = applyDialogForceOrder(host, slots, result);
        if (!await this.ensureSavedForces(slots)) return false;
        await this.cacheForcesLocally(slots);
        const serialized: SerializedOperation = {
            operationId: uuidv7(),
            name: result.name,
            note: result.note,
            timestamp: Date.now(),
            forces: operationForceRefs(slots),
        };
        try {
            await this.data.saveOperation(serialized);
            this.currentOperation.set(operationEntry(serialized, slots));
            this.toast.showToast('Operation saved.', 'success');
            return true;
        } catch (error) {
            this.logger.error(`Failed to save operation: ${String(error)}`);
            this.toast.showToast('Failed to save operation.', 'error');
            return false;
        }
    }

    async updateOperation(): Promise<boolean> {
        const host = this.requireHost();
        const current = this.currentOperation();
        if (!current) {
            this.toast.showToast('No operation loaded to update.', 'error');
            return false;
        }
        let slots = host.loadedForces();
        if (slots.length < 2) {
            this.toast.showToast('Need at least 2 forces to update an operation.', 'error');
            return false;
        }
        const result = await this.editOperation({
            title: 'Update Operation',
            name: current.name ?? '',
            note: current.note ?? '',
            forces: operationPreview(slots),
        });
        if (!result) return false;
        slots = applyDialogForceOrder(host, slots, result);
        if (!await this.ensureSavedForces(slots)) return false;
        if (current.owned) await this.cacheForcesLocally(slots);
        const serialized: SerializedOperation = {
            operationId: current.operationId,
            name: result.name,
            note: result.note,
            timestamp: Date.now(),
            forces: operationForceRefs(slots),
        };
        try {
            await this.data.saveOperation(serialized);
            this.currentOperation.set(operationEntry(serialized, slots));
            this.toast.showToast('Operation updated.', 'success');
            return true;
        } catch (error) {
            this.logger.error(`Failed to update operation: ${String(error)}`);
            this.toast.showToast('Failed to update operation.', 'error');
            return false;
        }
    }

    async closeOperation(): Promise<void> {
        if (!this.currentOperation() || !await this.promptSaveIfChanged()) return;
        const result = await this.dialogs.choose(
            'Exit Operation',
            'Do you want to keep the currently loaded forces or unload everything?',
            [
                { label: 'KEEP FORCES', value: 'keep', class: 'primary' },
                { label: 'UNLOAD ALL', value: 'unload', class: 'danger' },
                { label: 'CANCEL', value: 'cancel' },
            ],
            'cancel',
        );
        if (result === 'keep') this.currentOperation.set(null);
        if (result === 'unload' && await this.requireHost().removeAllForces()) this.currentOperation.set(null);
    }

    async loadOperation(operationId: string, options: { skipPrompts?: boolean } = {}): Promise<boolean> {
        const host = this.requireHost();
        if (!options.skipPrompts) {
            const current = this.currentOperation();
            if ((!current || current.operationId !== operationId)
                && (!await this.promptSaveIfChanged() || !await host.checkForcesBeforeReplacement())) return false;
        }
        const entry = await this.data.getOperation(operationId);
        if (!entry) return false;
        if (entry.owned) {
            try {
                await this.data.cacheForcesLocally(entry.forces.map(force => force.instanceId));
            } catch (error) {
                this.logger.warn(`Failed to cache operation forces locally: ${String(error)}`);
            }
        }
        host.setUrlInitializationPending(true);
        try {
            if (!await host.clearLoadedForcesForOperation()) return false;
            let loadedAny = false;
            const failedForces: string[] = [];
            for (const forceInfo of entry.forces) {
                const force = await this.data.getForce(forceInfo.instanceId);
                if (!force) {
                    failedForces.push(forceInfo.name || forceInfo.instanceId);
                    continue;
                }
                const added = host.addLoadedForce(force, forceInfo.alignment, !loadedAny);
                if (added) loadedAny = true;
                else {
                    if (!host.loadedForces().some(slot => slot.force === force)) host.destroyDetachedForce(force);
                    failedForces.push(forceInfo.name || forceInfo.instanceId);
                }
            }
            if (failedForces.length > 0) {
                this.toast.showToast(`Could not find force(s): ${failedForces.join(', ')}`, 'error');
            }
            if (!loadedAny) {
                this.toast.showToast('No forces from this operation could be loaded.', 'error');
                return false;
            }
            if (!entry.owned) await this.offerOwnedEnemySideSwitch(host);
            await host.loadAllUnits(host.loadedForces().map(slot => slot.force));
            this.currentOperation.set(entry);
            return true;
        } finally {
            host.setUrlInitializationPending(false);
        }
    }

    private hasChanges(operation: LoadOperationEntry): boolean {
        const slots = this.requireHost().loadedForces();
        return slots.length !== operation.forces.length || slots.some((slot, index) => {
            const saved = operation.forces[index];
            return slot.force.instanceId() !== saved?.instanceId || slot.alignment !== saved.alignment;
        });
    }

    private async editOperation(data: OperationDialogData): Promise<OperationDialogResult | null> {
        const ref = this.dialogs.createDialog<OperationDialogResult | null>(SaveOperationDialogComponent, { data });
        return (await firstValueFrom(ref.closed)) ?? null;
    }

    private async ensureSavedForces(slots: readonly ForceSlot[]): Promise<boolean> {
        for (const slot of slots) {
            if (slot.force.instanceId()) continue;
            if (!await this.requireHost().saveForce(slot.force)) {
                this.toast.showToast('All forces must be saved before saving an operation.', 'info');
                return false;
            }
        }
        return true;
    }

    private async cacheForcesLocally(slots: readonly ForceSlot[]): Promise<void> {
        for (const slot of slots) {
            if (!slot.force.readOnly()) await this.data.saveForce(slot.force, true);
        }
    }

    private async offerOwnedEnemySideSwitch(host: ForceOperationHost): Promise<void> {
        const slots = host.loadedForces();
        const owned = slots.filter(slot => slot.force.owned());
        if (owned.length === 0 || !owned.every(slot => slot.alignment === 'enemy')) return;
        const switchSides = await this.dialogs.requestConfirmation(
            'Your forces are currently assigned to the hostile side in this operation. Would you like to switch sides?',
            'Switch Sides?',
            'info',
        );
        if (!switchSides) return;
        host.setLoadedForces(slots.map(slot => ({
            ...slot,
            alignment: slot.alignment === 'friendly' ? 'enemy' : 'friendly',
        })));
    }

    private requireHost(): ForceOperationHost {
        if (!this.host) throw new Error('Force operation host is not configured');
        return this.host;
    }
}

function operationPreview(slots: readonly ForceSlot[]): OpPreviewForce[] {
    return slots.map(slot => ({
        name: slot.force.displayName(),
        instanceId: slot.force.instanceId() || '',
        alignment: slot.alignment,
        type: slot.force.gameSystem,
        factionId: slot.force.faction()?.id,
        eraId: slot.force.era()?.id,
        bv: slot.force.gameSystem !== 'as' ? slot.force.totalBv() : undefined,
        pv: slot.force.gameSystem === 'as' ? slot.force.totalBv() : undefined,
    }));
}

function applyDialogForceOrder(
    host: ForceOperationHost,
    slots: ForceSlot[],
    result: OperationDialogResult,
): ForceSlot[] {
    if (!result.forces) return slots;
    const ordered = result.forces.flatMap(force => {
        const slot = slots.find(candidate => candidate.force.instanceId() === force.instanceId);
        if (!slot) return [];
        slot.alignment = force.alignment;
        return [slot];
    });
    for (const slot of slots) if (!ordered.includes(slot)) ordered.push(slot);
    host.setLoadedForces(ordered);
    return ordered;
}

function operationForceRefs(slots: readonly ForceSlot[]): OperationForceRef[] {
    return slots.map(slot => ({
        instanceId: slot.force.instanceId()!,
        alignment: slot.alignment,
        timestamp: slot.force.timestamp || new Date().toISOString(),
    }));
}

function operationEntry(serialized: SerializedOperation, slots: readonly ForceSlot[]): LoadOperationEntry {
    return new LoadOperationEntry({
        operationId: serialized.operationId,
        name: serialized.name,
        note: serialized.note,
        timestamp: serialized.timestamp,
        forces: slots.map(slot => ({
            instanceId: slot.force.instanceId()!,
            alignment: slot.alignment,
            timestamp: slot.force.timestamp || new Date().toISOString(),
            name: slot.force.displayName(),
            type: slot.force.gameSystem,
            factionId: slot.force.faction()?.id,
            eraId: slot.force.era()?.id,
            bv: slot.force.gameSystem !== 'as' ? slot.force.totalBv() : undefined,
            pv: slot.force.gameSystem === 'as' ? slot.force.totalBv() : undefined,
        })),
        local: true,
        cloud: true,
        owned: true,
    });
}
