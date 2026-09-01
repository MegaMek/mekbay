// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CriticalSlot } from '../models/force-serialization';
import { getMekLocationLabel } from '../models/entity/types';
import {
    applyMekCriticalRoll,
    applyMekCriticalSlotHit,
    previewMekCriticalRoll,
    previewMekCriticalSlotHit,
    type MekCriticalExplosionPreview,
    type MekCriticalHitPreview,
    type MekCriticalHitOptions,
    type MekCriticalRollOutcome,
} from '../utils/mek-critical-hit.util';
import { uuidv7 } from '../utils/uuid.util';
import { CBTAutomationService } from './cbt-automation.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';

export interface MekCriticalHitAutomationResolution {
    readonly cancelled: boolean;
    readonly outcome: MekCriticalRollOutcome | null;
}

@Injectable({ providedIn: 'root' })
export class MekCriticalHitAutomationService {
    private readonly automations = inject(CBTAutomationService);
    private readonly automationToasts = inject(CBTAutomationToastService);

    previewRoll(
        unit: CBTForceUnit,
        location: string,
        results: readonly number[],
        options: MekCriticalHitOptions = {},
    ): MekCriticalHitPreview | null {
        return previewMekCriticalRoll(unit, location, results, options);
    }

    previewSlot(
        unit: CBTForceUnit,
        slot: CriticalSlot,
        options: Pick<MekCriticalHitOptions, 'explosiveSlotsOnly'> = {},
    ): MekCriticalHitPreview | null {
        return previewMekCriticalSlotHit(unit, slot, options);
    }

    async applyRoll(
        unit: CBTForceUnit,
        location: string,
        results: readonly number[],
        consolidateImmediately: boolean,
        options: MekCriticalHitOptions = {},
    ): Promise<MekCriticalHitAutomationResolution> {
        const preview = this.previewRoll(unit, location, results, options);
        return this.resolve(unit, location, preview, applyExplosion => applyMekCriticalRoll(
            unit,
            location,
            results,
            consolidateImmediately,
            { ...options, applyExplosion },
        ));
    }

    async applySlot(
        unit: CBTForceUnit,
        slot: CriticalSlot,
        consolidateImmediately: boolean,
    ): Promise<MekCriticalHitAutomationResolution> {
        const location = slot.loc ?? '';
        const preview = this.previewSlot(unit, slot);
        return this.resolve(unit, location, preview, applyExplosion => applyMekCriticalSlotHit(
            unit,
            slot,
            consolidateImmediately,
            { applyExplosion },
        ));
    }

    private async resolve(
        unit: CBTForceUnit,
        location: string,
        preview: MekCriticalHitPreview | null,
        apply: (applyExplosion: boolean) => MekCriticalRollOutcome | null,
    ): Promise<MekCriticalHitAutomationResolution> {
        if (!preview?.explosion) {
            return { cancelled: false, outcome: apply(false) };
        }

        const event = this.createExplosionEvent(unit, location, preview.explosion);
        const accepted = await this.automations.resolve('internalExplosionsCheck', [event], {
            title: 'Review Internal Explosion',
            message: 'Choose whether to resolve this explosion automatically. SKIP applies only the critical hit.',
        });
        if (accepted === null) return { cancelled: true, outcome: null };

        const applyExplosion = accepted.has(event.id);
        const outcome = apply(applyExplosion);
        if (applyExplosion
            && outcome
            && unit.automationMode('internalExplosionsCheck') === 'yes') {
            const explosion = outcome.explosion ?? outcome.pendingExplosion;
            if (explosion) {
                const pilotHits = outcome.explosion?.pilotHits ?? 0;
                this.automationToasts.show(
                    unit,
                    `Internal explosion: ${explosion.equipment}, ${explosion.rawDamage} damage in ${getMekLocationLabel(location) ?? location}${outcome.pendingExplosion ? ' queued for phase end' : ''}${pilotHits > 0 ? `; ${pilotHits} pilot hit${pilotHits === 1 ? '' : 's'} applied` : ''}`,
                    'error',
                );
            }
            const automaticCritical = outcome.explosion?.automaticCritical;
            if (automaticCritical) {
                this.automationToasts.show(
                    unit,
                    `Critical hit in ${getMekLocationLabel(automaticCritical.location) ?? automaticCritical.location}: ${automaticCritical.equipment} (slot ${automaticCritical.slotNumber})`,
                    'error',
                );
            }
        }

        return {
            cancelled: false,
            outcome,
        };
    }

    private createExplosionEvent(
        unit: CBTForceUnit,
        location: string,
        explosion: MekCriticalExplosionPreview,
    ): AutomationReviewEvent {
        const locationLabel = getMekLocationLabel(location) ?? location;
        const effects = explosion.locations
            .filter(damage => damage.internalDamage > 0 || damage.armorDamage > 0)
            .map(damage => {
                const parts: string[] = [];
                if (damage.internalDamage > 0) {
                    parts.push(`${damage.internalDamage} internal`);
                }
                if (damage.armorDamage > 0) {
                    parts.push(`${damage.armorDamage} ${damage.armorRear ? 'rear ' : ''}armor`);
                }
                if (damage.protection !== 'none') {
                    parts.push(damage.protection === 'case-ii' ? 'CASE II' : 'CASE');
                }
                return `${getMekLocationLabel(damage.location) ?? damage.location}: ${parts.join(' · ')}`;
            });
        if (explosion.pilotHits > 0) {
            effects.push(`MechWarrior feedback: ${explosion.pilotHits} hit${explosion.pilotHits === 1 ? '' : 's'}`);
        }
        if (explosion.automaticCriticalEquipment) {
            effects.push(`Automatic critical: ${explosion.automaticCriticalEquipment}`);
        }
        if (explosion.timing === 'phase-end') {
            effects.push('Resolves at phase end unless firing or discharging prevents it');
        }

        return {
            id: uuidv7(),
            subject: unit.getNotificationDisplayName(),
            event: 'Internal explosion',
            description: `${explosion.equipment} in ${locationLabel} · ${explosion.rawDamage} damage`,
            ...(effects.length > 0 ? { effects } : {}),
        };
    }
}
