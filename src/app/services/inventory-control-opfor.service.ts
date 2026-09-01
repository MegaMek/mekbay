// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DestroyRef, effect, inject, Injectable, Injector, type EffectRef, type Signal, untracked } from '@angular/core';
import { CBTForce } from '../models/cbt-force.model';
import type { InventoryControlTargetRosterRow } from '../models/cbt-force.types';
import type { ForceSlot } from '../models/force-slot.model';
import {
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
    getInventoryControlTargetLetter,
} from '../models/inventory-control-runtime-state.model';
import type { EncounterTarget, TargetRegistryCommandResult } from '../models/runtime/encounter-runtime';
import { LoggerService } from './logger.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class InventoryControlOpforService {
    private readonly injector = inject(Injector);
    private readonly logger = inject(LoggerService);
    private readonly toastService = inject(ToastService);
    private loadedForces: () => readonly ForceSlot[] = () => [];
    private monitor: EffectRef | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => this.monitor?.destroy());
    }

    connect(loadedForces: Signal<readonly ForceSlot[]>): void {
        this.monitor?.destroy();
        this.loadedForces = loadedForces;
        this.monitor = effect(() => this.synchronizeLoadedForces(), { injector: this.injector });
    }

    isAvailable(force: CBTForce): boolean {
        return this.opposingCBTForces(force).length > 0;
    }

    setEnabled(force: CBTForce, enabled: boolean): boolean {
        const nextEnabled = enabled && this.isAvailable(force);
        const result = this.synchronize(
            force,
            this.opposingCBTTargetRoster(force),
            nextEnabled,
            true,
        );
        if (result && !result.accepted) return false;
        force.inventoryControlOpforEnabled.set(nextEnabled);
        return true;
    }

    private synchronizeLoadedForces(): void {
        const cbtForces = this.loadedForces()
            .filter(slot => slot.force instanceof CBTForce)
            .map(slot => slot.force as CBTForce);
        for (const force of cbtForces) {
            force.targetRegistryVersion();
            const available = this.isAvailable(force);
            // Persisted OPFOR facts are the durable enabled witness. During
            // incremental force loading, transient absence is not deletion authority.
            if (!available && force.inventoryControlOpforEnabled()) continue;
            const enabled = force.inventoryControlOpforEnabled() && available;
            const roster = this.opposingCBTTargetRoster(force);
            untracked(() => {
                const result = this.synchronize(force, roster, enabled, false);
                if (!available && (!result || result.accepted)) {
                    force.inventoryControlOpforEnabled.set(false);
                }
            });
        }
    }

    private opposingCBTForces(force: CBTForce): CBTForce[] {
        const sourceSlot = this.loadedForces().find(slot => slot.force === force);
        if (!sourceSlot) return [];
        return this.loadedForces()
            .filter(slot => slot.force instanceof CBTForce && (
                sourceSlot.alignment === 'enemy'
                    ? slot.alignment !== 'enemy'
                    : slot.alignment === 'enemy'
            ))
            .map(slot => slot.force as CBTForce);
    }

    private opposingCBTTargetRoster(force: CBTForce): InventoryControlTargetRosterRow[] {
        const rows = this.opposingCBTForces(force)
            .flatMap(opposingForce => opposingForce.getInventoryControlTargetRoster())
            .sort((left, right) => String(left.targetId).localeCompare(String(right.targetId)));
        const seen = new Set<string>();
        for (const row of rows) {
            const targetId = String(row.targetId);
            if (seen.has(targetId)) throw new Error(`Duplicate opposing target-roster ID ${targetId}`);
            seen.add(targetId);
        }
        return rows;
    }

    private synchronize(
        force: CBTForce,
        enemyRoster: readonly InventoryControlTargetRosterRow[],
        enabled = force.inventoryControlOpforEnabled(),
        surfaceError = false,
    ): TargetRegistryCommandResult | null {
        const snapshot = force.queryInventoryControlTargetRegistry();
        const currentTargets = snapshot.targets;
        const manualTargets = currentTargets.filter(target => target.source !== 'opfor');
        const existingById = new Map(currentTargets.map(target => [target.id, target]));
        const usedLetters = new Set(manualTargets.map(target => target.letter));
        const manualTargetIds = new Set(manualTargets.map(target => target.id));
        const capacity = Math.max(0, INVENTORY_CONTROL_TARGET_MAX_COUNT - manualTargets.length);
        const opforTargets = (enabled
            ? enemyRoster.filter(row => !manualTargetIds.has(row.targetId)).slice(0, capacity)
            : [])
            .map((row, enemyIndex): EncounterTarget => {
                const existing = existingById.get(row.targetId);
                const letter = existing && !usedLetters.has(existing.letter)
                    ? existing.letter
                    : this.firstUnusedLetter(usedLetters);
                usedLetters.add(letter);
                return {
                    id: row.targetId,
                    letter,
                    name: row.name,
                    color: existing?.color
                        ?? INVENTORY_CONTROL_TARGET_COLORS[enemyIndex % INVENTORY_CONTROL_TARGET_COLORS.length],
                    source: 'opfor',
                    readOnly: true,
                    unitType: row.unitType,
                    tnCalculator: row.tnCalculator,
                };
            });
        const currentOpforTargets = currentTargets.filter(target => target.source === 'opfor');
        if (targetsEqual(currentOpforTargets, opforTargets)) return null;
        const result = force.dispatchInventoryControlTargetRegistry({
            kind: 'replace-targets',
            targets: opforTargets,
        }, 'opfor-sync');
        if (!result.accepted) this.reportRejection(surfaceError);
        return result;
    }

    private firstUnusedLetter(usedLetters: ReadonlySet<string>): string {
        for (let index = 0; ; index++) {
            const letter = getInventoryControlTargetLetter(index);
            if (!usedLetters.has(letter)) return letter;
        }
    }

    private reportRejection(surfaceError: boolean): void {
        const message = 'OPFOR synchronization was rejected because the force is read-only.';
        this.logger.error(`Target registry: ${message}`);
        if (surfaceError) this.toastService.showToast(message, 'error');
    }
}

function targetsEqual(currentTargets: readonly EncounterTarget[], nextTargets: readonly EncounterTarget[]): boolean {
    if (currentTargets.length !== nextTargets.length) return false;
    const nextById = new Map(nextTargets.map(target => [target.id, target]));
    return currentTargets.every(current => {
        const next = nextById.get(current.id);
        return !!next
            && current.letter === next.letter
            && current.name === next.name
            && current.color === next.color
            && current.source === next.source
            && current.readOnly === next.readOnly
            && current.unitType === next.unitType
            && shallowRecordsEqual(current.tnCalculator, next.tnCalculator);
    });
}

function shallowRecordsEqual(current: object | undefined, next: object | undefined): boolean {
    if (current === next) return true;
    if (!current || !next) return false;
    const currentEntries = Object.entries(current).filter(([, value]) => value !== undefined);
    const nextEntries = Object.entries(next).filter(([, value]) => value !== undefined);
    const nextRecord = Object.fromEntries(nextEntries);
    return currentEntries.length === nextEntries.length
        && currentEntries.every(([key, value]) => value === nextRecord[key]);
}
