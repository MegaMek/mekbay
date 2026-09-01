// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, inject, Injectable, signal } from '@angular/core';

import {
    ForceLoadingOverlayComponent,
    type ForceLoadingOverlayData,
    type ForceLoadingProgress,
} from '../components/force-loading-overlay/force-loading-overlay.component';
import { C3NetworkEditor } from '../models/c3-network-editor';
import { CBTForce } from '../models/cbt-force.model';
import { getFactionImg } from '../models/factions.model';
import type { Force, ForceOwnerAuthorityFingerprint } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { ForceSlot } from '../models/force-slot.model';
import { DialogsService } from './dialogs.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';

interface LoadingOwnerCapture {
    readonly force: Force;
    readonly slot: ForceSlot | undefined;
    readonly units: readonly ForceUnit[];
    readonly authorityFingerprint: ForceOwnerAuthorityFingerprint;
}

/** Loads one captured workspace generation and owns its retry overlay. */
@Injectable({ providedIn: 'root' })
export class ASForceUnitLoadingService {
    private readonly dialogs = inject(DialogsService);
    private readonly workspace = inject(ForceWorkspaceStateService);

    async load(forces: readonly Force[]): Promise<void> {
        const captures: LoadingOwnerCapture[] = [];
        const seenForces = new Set<Force>();
        for (const force of forces) {
            if (seenForces.has(force)) continue;
            seenForces.add(force);
            // Direct CBT runtimes are materialized by the V2 load transaction.
            if (force instanceof CBTForce) continue;
            captures.push(Object.freeze({
                force,
                slot: this.workspace.getForceSlot(force),
                units: Object.freeze([...force.units()]),
                authorityFingerprint: force.captureWholeOwnerAuthorityFingerprint(),
            }));
        }

        const entries: Array<{ capture: LoadingOwnerCapture; progress: ForceLoadingProgress }> = [];
        for (const capture of captures) {
            const { force, units } = capture;
            if (units.every(unit => unit.isLoaded())) continue;
            const faction = force.faction();
            entries.push({
                capture,
                progress: {
                    forceName: force.displayName(),
                    factionImg: faction ? getFactionImg(faction) || null : null,
                    loadedUnits: computed(() => units.filter(unit => unit.isLoaded()).length),
                    totalUnits: units.length,
                },
            });
        }
        if (entries.length === 0) return;

        const failedCount = signal(0);
        const loading = signal(true);
        let resume: (() => void) | null = null;
        let skipped = false;
        const overlayData: ForceLoadingOverlayData = {
            forces: entries.map(entry => entry.progress),
            failedCount,
            loading,
            onRetry: () => resume?.(),
            onSkip: () => {
                skipped = true;
                resume?.();
            },
        };
        const dialog = this.dialogs.createDialog<void>(ForceLoadingOverlayComponent, {
            data: overlayData,
            disableClose: true,
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
            panelClass: 'force-loading-overlay-panel',
        });

        const units = entries.flatMap(entry => entry.capture.units);
        let unloaded = units.filter(unit => !unit.isLoaded());
        while (unloaded.length > 0) {
            loading.set(true);
            failedCount.set(0);
            await Promise.allSettled(unloaded.map(unit => unit.load()));
            unloaded = units.filter(unit => !unit.isLoaded());
            if (unloaded.length === 0) break;

            failedCount.set(unloaded.length);
            loading.set(false);
            await new Promise<void>(resolve => { resume = resolve; });
            resume = null;
            if (skipped) break;
        }

        for (const capture of captures) {
            const { force, slot, units: capturedUnits, authorityFingerprint } = capture;
            const currentUnits = force.units();
            if (!slot
                || this.workspace.getForceSlot(force) !== slot
                || slot.force !== force
                || !force.isWholeOwnerActive()
                || force.readOnly()
                || !force.isWholeOwnerAuthorityFingerprintCurrent(authorityFingerprint)
                || currentUnits.length !== capturedUnits.length
                || currentUnits.some((unit, index) => unit !== capturedUnits[index])
                || capturedUnits.some(unit => !unit.isLoaded())) continue;
            const unitsById = new Map(capturedUnits.map(unit => [unit.id, unit]));
            const currentNetworks = force.c3Networks();
            const validatedNetworks = C3NetworkEditor.clean(currentNetworks, unitsById);
            if (JSON.stringify(validatedNetworks) !== JSON.stringify(currentNetworks)) {
                force.setNetworkIfWholeOwnerAuthorityCurrent(authorityFingerprint, validatedNetworks);
            }
        }

        dialog.close();
    }
}
