// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    FallingDamageDialogComponent,
    type AcceptedFallingDamageDialogResult,
    type FallingAutomationTrigger,
    type FallingDamageDialogData,
    type FallingDamageDialogResult,
} from '../components/falling-damage-dialog/falling-damage-dialog.component';
import {
    FallingNoticeDialogComponent,
    type FallingNoticeDialogData,
} from '../components/falling-notice-dialog/falling-notice-dialog.component';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForceUnit, CBTMekFallDamageRoll } from '../models/cbt-force-unit.model';
import { getMekLocationLabel } from '../models/entity/types';
import {
    applyMekFallDamage,
    isResolvedMekFallHitLocation,
    mekFallDamage,
    mekFallDamageGroups,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    twoD6Total,
    type ResolvedMekFallDamageGroup,
} from '../utils/mek-falling.util';
import { clusterTableForUnit } from '../utils/record-sheet-reference-table';
import { uuidv7 } from '../utils/uuid.util';
import { CBTAutomationService } from './cbt-automation.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { DialogsService } from './dialogs.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class FallingResolutionService {
    private readonly dialogs = inject(DialogsService);
    private readonly automations = inject(CBTAutomationService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly toasts = inject(ToastService);
    private readonly activeUnits = new WeakSet<CBTForceUnit>();

    async resume(
        unit: CBTForceUnit,
        consolidateImmediately: boolean,
        manualResolution = false,
    ): Promise<void> {
        const pending = unit.getPendingFall();
        if (!pending) return;
        await this.open(unit, {
            kind: 'falling',
            id: pending.id,
            source: pending.source,
            levelsFallen: pending.levelsFallen,
        }, consolidateImmediately, manualResolution);
    }

    async open(
        unit: CBTForceUnit,
        trigger: FallingAutomationTrigger,
        consolidateImmediately: boolean,
        manualResolution = false,
    ): Promise<void> {
        if (this.activeUnits.has(unit) || unit.getUnit().type !== 'Mek') return;
        const pending = unit.getPendingFall();
        if (!pending || pending.id !== trigger.id) return;
        if (unit.automationMode('fallingCheck') === 'no') {
            unit.skipPendingFall(pending.id);
            return;
        }
        const currentTrigger: FallingAutomationTrigger = {
            kind: 'falling',
            id: pending.id,
            source: pending.source,
            levelsFallen: pending.levelsFallen,
        };
        this.activeUnits.add(unit);
        try {
            if (!manualResolution && unit.automationMode('fallingCheck') === 'yes') {
                const result = this.resolveAutomatically(unit, currentTrigger);
                const notice = this.dialogs.createDialog<
                    void,
                    FallingNoticeDialogComponent,
                    FallingNoticeDialogData
                >(
                    FallingNoticeDialogComponent,
                    {
                        disableClose: true,
                        data: {
                            unitName: unit.getNotificationDisplayName(),
                            orientation: result.orientation,
                        },
                    },
                );
                await firstValueFrom(notice.closed);
                await this.applyAcceptedFall(
                    unit,
                    currentTrigger,
                    result,
                    consolidateImmediately,
                    false,
                );
                return;
            }

            const ref = this.dialogs.createDialog<FallingDamageDialogResult | undefined>(
                FallingDamageDialogComponent,
                {
                    disableClose: false,
                    data: <FallingDamageDialogData>{ unit, trigger: currentTrigger },
                },
            );
            const result = await firstValueFrom(ref.closed);
            if (!result || result.action === 'close') return;
            if (result.action === 'ignore') {
                // IGNORE discards the entire automated fall resolution. Only
                // ACCEPT advances the sequence to a seatbelt check.
                unit.skipPendingFall(currentTrigger.id);
                return;
            }
            if (result.action !== 'accept') return;
            await this.applyAcceptedFall(
                unit,
                currentTrigger,
                result,
                consolidateImmediately,
                manualResolution,
            );
        } finally {
            this.activeUnits.delete(unit);
        }
    }

    private resolveAutomatically(
        unit: CBTForceUnit,
        trigger: FallingAutomationTrigger,
    ): AcceptedFallingDamageDialogResult {
        const pending = unit.getPendingFall(trigger.id);
        const orientationRoll = pending?.orientationRoll ?? this.rollD6();
        const orientation = resolveMekFallOrientation(unit.gameRules.id, orientationRoll);
        const damageGroups = mekFallDamageGroups(mekFallDamage(
            unit.getUnit().tons,
            trigger.levelsFallen,
        ));
        const hitLocationTable = clusterTableForUnit(unit.getUnit()).hitLocationTable ?? 'biped';
        const damageRolls: CBTMekFallDamageRoll[] = [];
        const groups: ResolvedMekFallDamageGroup[] = [];

        damageGroups.forEach((damage, index) => {
            const saved = pending?.damageRolls[index];
            const hitLocationDice = saved?.hitLocationDice
                ?? [this.rollD6(), this.rollD6()] as const;
            const hitLocationRoll = twoD6Total(hitLocationDice);
            const preliminary = resolveMekFallHitLocation(
                hitLocationTable,
                orientation.hitArc,
                hitLocationRoll,
            );
            const needsTripodLeg = preliminary.location === null
                && preliminary.tripodLegModifier !== undefined;
            const tripodLegRoll = !needsTripodLeg
                ? null
                : saved?.tripodLegRoll ?? this.rollD6();
            const result = resolveMekFallHitLocation(
                hitLocationTable,
                orientation.hitArc,
                hitLocationRoll,
                tripodLegRoll ?? undefined,
            );
            if (!isResolvedMekFallHitLocation(result)) {
                throw new Error('Automatic falling resolution did not produce a hit location.');
            }

            damageRolls.push({
                hitLocationDice,
                tripodLegRoll,
            });
            groups.push({ ...result, damage });
        });

        unit.setPendingFallRolls(
            trigger.id,
            orientationRoll,
            damageRolls,
        );
        return { action: 'accept', orientation, groups };
    }

    private async applyAcceptedFall(
        unit: CBTForceUnit,
        trigger: FallingAutomationTrigger,
        result: AcceptedFallingDamageDialogResult,
        consolidateImmediately: boolean,
        manualResolution: boolean,
    ): Promise<void> {
        const acceptedHeadHits = await this.reviewHeadHits(
            unit,
            result.groups.filter(group => group.location === 'HD').length,
        );
        if (acceptedHeadHits === null) return;

        const applied = applyMekFallDamage(unit, result.groups, consolidateImmediately);
        const automaticFall = !manualResolution
            && unit.automationMode('fallingCheck') === 'yes';
        if (automaticFall) {
            const damageByLocation = new Map<string, number>();
            for (const location of applied.locations) {
                damageByLocation.set(
                    location.location,
                    (damageByLocation.get(location.location) ?? 0) + location.appliedDamage,
                );
            }
            const locations = Array.from(damageByLocation, ([location, damage]) =>
                `${damage} to ${getMekLocationLabel(location) ?? location}`,
            ).join('; ');
            this.automationToasts.show(
                unit,
                `Fall resolved: ${applied.appliedDamage} damage applied${locations ? ` — ${locations}` : ''}`,
                applied.appliedDamage > 0 ? 'error' : 'info',
            );
        } else {
            this.toasts.showToast(
                `${result.orientation.facingInstruction}; ${applied.appliedDamage} falling damage applied`,
                applied.appliedDamage > 0 ? 'error' : 'info',
            );
        }
        const appliedHeadHits = Math.min(acceptedHeadHits, applied.headHits);
        let appliedPilotHits = 0;
        for (let index = 0; index < appliedHeadHits; index++) {
            appliedPilotHits += unit.applyHeadHitCrewHits();
        }
        if (appliedHeadHits > 0
            && unit.automationMode('pilotHitsAndConsciousnessCheck') === 'yes') {
            this.automationToasts.show(
                unit,
                `Pilot hits from falling: ${appliedPilotHits > 0 ? `${appliedPilotHits} applied` : 'none applied'}`,
                appliedPilotHits > 0 ? 'error' : 'info',
            );
        }
        unit.completePendingFall(trigger.id);
    }

    private rollD6(): number {
        return Math.floor(Math.random() * 6) + 1;
    }

    private async reviewHeadHits(unit: CBTForceUnit, count: number): Promise<number | null> {
        if (count <= 0) return 0;
        const events: AutomationReviewEvent[] = Array.from({ length: count }, (_unused, index) => ({
            id: uuidv7(),
            subject: unit.getNotificationDisplayName(),
            event: count === 1 ? 'Head hit from falling' : `Head hit from falling ${index + 1}`,
            description: 'Apply the resulting pilot hit',
            effects: ['Queue any required Consciousness Roll'],
        }));
        const accepted = await this.automations.resolve('pilotHitsAndConsciousnessCheck', events, {
            title: 'Review Falling Head Hits',
            message: 'Choose which pilot hits to apply.',
        });
        return accepted === null
            ? null
            : events.reduce((total, event) => total + (accepted.has(event.id) ? 1 : 0), 0);
    }
}
