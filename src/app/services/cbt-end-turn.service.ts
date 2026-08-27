// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { AutomationReviewBreakdownItem, AutomationReviewEvent } from '../models/automation-review.model';
import type { AutomationMode } from '../models/options.model';
import type { PendingEventInput, SerializedPendingUnitCheck } from '../models/force-serialization';
import {
    unitCheckIsPilotHitHeatEffect,
    unitCheckPilotDamagePhase,
    type HeatEffectDescriptor,
} from '../models/unit-check.model';
import { getHeatEffectDescriptors } from '../utils/heat-effects.util';
import { pendingUnitCheckReviewDescription } from '../utils/unit-check.util';
import { uuidv7 } from '../utils/uuid.util';
import { createPilotDamageGroup } from '../utils/pilot-damage-group.util';
import { buildHeatSummaryRows } from '../utils/heat-summary.util';
import { CBTAutomationService } from './cbt-automation.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { CBTPhaseResolutionService } from './cbt-phase-resolution.service';
import { OptionsService } from './options.service';

const HEAT_EVENT_PREFIX = 'heat-and-dissipation';
const HEAT_EFFECT_EVENT_PREFIX = 'heat-effects';
const COMBINED_HEAT_EVENT_PREFIX = 'end-turn-heat';
const PILOT_HIT_EVENT_PREFIX = 'pilot-hits';

function heatEventId(unit: CBTForceUnit): string {
    return `${HEAT_EVENT_PREFIX}:${unit.id}`;
}

function heatEffectEventId(unit: CBTForceUnit): string {
    return `${HEAT_EFFECT_EVENT_PREFIX}:${unit.id}`;
}

function combinedHeatEventId(unit: CBTForceUnit): string {
    return `${COMBINED_HEAT_EVENT_PREFIX}:${unit.id}`;
}

function pilotHitEventId(unit: CBTForceUnit): string {
    return `${PILOT_HIT_EVENT_PREFIX}:${unit.id}`;
}

interface StagedHeatEffect {
    readonly id: string;
    readonly descriptor: HeatEffectDescriptor;
}

interface StagedUnitHeatEffects {
    readonly id: string;
    readonly unit: CBTForceUnit;
    readonly heat: number;
    readonly effects: readonly StagedHeatEffect[];
}

@Injectable({ providedIn: 'root' })
export class CBTEndTurnService {
    private readonly automations = inject(CBTAutomationService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly phaseResolution = inject(CBTPhaseResolutionService);
    private readonly options = inject(OptionsService);
    private pendingEndTurn: Promise<boolean> | null = null;

    /** Commits a turn only after its resumable phase, heat, and consequence sequence is complete. */
    async endTurn(units: readonly CBTForceUnit[]): Promise<boolean> {
        if (this.pendingEndTurn) return this.pendingEndTurn;

        const operation = this.performEndTurn(units);
        this.pendingEndTurn = operation;
        try {
            return await operation;
        } finally {
            if (this.pendingEndTurn === operation) this.pendingEndTurn = null;
        }
    }

    private async performEndTurn(units: readonly CBTForceUnit[]): Promise<boolean> {
        const uniqueUnits = Array.from(new Map(units.map(unit => [unit.id, unit])).values());
        if (uniqueUnits.length === 0) return false;

        const phaseUnits = uniqueUnits.filter(unit =>
            unit.turnState().getEndTurnCheckpoint() === undefined);
        if (phaseUnits.length > 0) {
            if (!await this.phaseResolution.endPhase(phaseUnits)) return false;
            phaseUnits.forEach(unit => unit.turnState().markEndTurnPhaseEnded());
        }

        const heatUnits = uniqueUnits.filter(unit =>
            unit.turnState().getEndTurnCheckpoint() !== 'heat-staged');
        if (heatUnits.length > 0 && !await this.prepareEndTurnHeat(heatUnits)) return false;
        if (!await this.phaseResolution.resolvePendingChain(uniqueUnits)) return false;

        uniqueUnits.forEach(unit => unit.endTurn({
            heatAndDissipationResolution: false,
            phaseAlreadyEnded: true,
        }));
        return true;
    }

    private async prepareEndTurnHeat(units: readonly CBTForceUnit[]): Promise<boolean> {
        const heatMode = this.options.cbtAutomationMode('heatAndDissipationResolution');
        const heatEffectsMode = this.options.cbtAutomationMode('heatEffectsCheck');
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
        let acceptedHeat: ReadonlySet<string>;
        let stagedEffects: readonly StagedUnitHeatEffects[];
        let acceptedEffects: ReadonlySet<string>;
        let acceptedPilotHits: ReadonlySet<string>;

        if (heatMode === 'ask' && heatEffectsMode === 'ask') {
            const projectedHeat = new Map(units.map(unit => [
                unit.id,
                unit.hasPendingEndTurnHeat()
                    ? unit.turnState().heatProjection().projected
                    : unit.getHeat().current,
            ]));
            const projectedEffects = this.stageHeatEffects(units, projectedHeat);
            const combinedEvents = units.flatMap(unit => {
                const effects = projectedEffects.find(candidate => candidate.unit === unit);
                const reviewEffects = this.reviewableHeatEffects(effects?.effects ?? [], pilotHitsMode);
                if (!unit.hasPendingEndTurnHeat() && reviewEffects.length === 0) return [];
                return [this.createCombinedHeatEvent(
                    unit,
                    projectedHeat.get(unit.id)!,
                    reviewEffects,
                    pilotHitsMode === 'ask',
                )];
            });
            const acceptedCombined = await this.automations.resolve('heatAndDissipationResolution', combinedEvents, {
                title: 'Review End-Turn Heat',
                message: pilotHitsMode === 'ask'
                    ? 'Choose which units\' heat, dissipation, heat effects, and pilot hits to apply.'
                    : 'Choose which units\' heat, dissipation, and heat effects to apply.',
                allowCancel: true,
            });
            if (acceptedCombined === null) return false;

            acceptedHeat = new Set(units
                .filter(unit => unit.hasPendingEndTurnHeat() && acceptedCombined.has(combinedHeatEventId(unit)))
                .map(heatEventId));
            const finalHeat = this.finalHeatByUnit(units, acceptedHeat);
            stagedEffects = this.stageHeatEffects(units, finalHeat);
            acceptedEffects = new Set(stagedEffects
                .filter(group => acceptedCombined.has(combinedHeatEventId(group.unit)))
                .map(group => group.id));
            acceptedPilotHits = new Set(pilotHitsMode === 'no' ? [] : stagedEffects
                .filter(group => acceptedCombined.has(combinedHeatEventId(group.unit)))
                .filter(group => group.effects.some(effect =>
                    unitCheckIsPilotHitHeatEffect(effect.descriptor.kind)))
                .map(group => pilotHitEventId(group.unit)));
        } else {
            const heatEvents = units
                .filter(unit => unit.hasPendingEndTurnHeat())
                .map(unit => this.createHeatEvent(unit));
            const heatDecision = await this.automations.resolve('heatAndDissipationResolution', heatEvents, {
                title: 'Review Heat and Dissipation',
                message: 'Choose which heat and dissipation results to apply.',
                allowCancel: true,
            });
            if (heatDecision === null) return false;
            acceptedHeat = heatDecision;

            stagedEffects = this.stageHeatEffects(units, this.finalHeatByUnit(units, acceptedHeat));
            const reviewGroups = stagedEffects
                .map(group => ({ group, effects: this.reviewableHeatEffects(group.effects, pilotHitsMode) }))
                .filter(candidate => candidate.effects.length > 0);
            const combinesEffectsAndPilotHits = heatEffectsMode === 'ask' && pilotHitsMode === 'ask';
            const heatEffectDecision = await this.automations.resolve('heatEffectsCheck', reviewGroups
                .map(({ group, effects }) => this.createHeatEffectEvent(
                    group,
                    effects,
                    combinesEffectsAndPilotHits,
                    acceptedHeat.has(heatEventId(group.unit)),
                )), {
                title: 'Review End-Turn Heat Effects',
                message: combinesEffectsAndPilotHits
                    ? 'Choose which units\' heat effects and pilot hits to resolve.'
                    : 'Choose which units\' heat effects to resolve.',
                allowCancel: true,
            });
            if (heatEffectDecision === null) return false;
            acceptedEffects = heatEffectDecision;

            if (combinesEffectsAndPilotHits) {
                acceptedPilotHits = new Set(stagedEffects
                    .filter(group => acceptedEffects.has(group.id))
                    .filter(group => group.effects.some(effect =>
                        unitCheckIsPilotHitHeatEffect(effect.descriptor.kind)))
                    .map(group => pilotHitEventId(group.unit)));
            } else {
                const pilotHitDecision = await this.resolvePilotHitEffects(
                    stagedEffects,
                    acceptedEffects,
                    pilotHitsMode,
                );
                if (pilotHitDecision === null) return false;
                acceptedPilotHits = pilotHitDecision;
            }
        }

        const effectSequence = uuidv7();
        const heatEffectGroup = createPilotDamageGroup('heat', `end-turn:${effectSequence}`);
        const endPhaseEffectGroup = createPilotDamageGroup('immediate', `end-turn:${effectSequence}:end`);

        for (const unit of units) {
            if (acceptedHeat.has(heatEventId(unit))) {
                const previousHeat = unit.getHeat().current;
                const resolvedHeat = unit.turnState().heatProjection().projected;
                unit.resolveEndTurnHeat();
                if (heatMode === 'yes') {
                    this.automationToasts.show(
                        unit,
                        `Heat and dissipation: Heat ${previousHeat} → ${resolvedHeat}`,
                        'info',
                    );
                }
            }
            const staged = stagedEffects.find(candidate => candidate.unit === unit);
            if (staged && acceptedEffects.has(staged.id)) {
                for (const effect of staged.effects) {
                    if (unitCheckIsPilotHitHeatEffect(effect.descriptor.kind)
                        && !acceptedPilotHits.has(pilotHitEventId(unit))) continue;
                    unit.turnState().queuePendingUnitCheck({
                        id: effect.id,
                        pilotDamageGroup: unitCheckPilotDamagePhase(effect.descriptor.kind) === 'end'
                            ? endPhaseEffectGroup
                            : heatEffectGroup,
                        ...effect.descriptor,
                    } as PendingEventInput<SerializedPendingUnitCheck>);
                }
            }
            unit.turnState().markEndTurnHeatStaged();
        }
        return true;
    }

    private createHeatEvent(unit: CBTForceUnit): AutomationReviewEvent {
        const projectedHeat = unit.turnState().heatProjection().projected;
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
        const effects = getHeatEffectDescriptors(unit, projectedHeat)
            .filter(descriptor => this.isReviewableHeatEffect(descriptor, pilotHitsMode))
            .map(descriptor => pendingUnitCheckReviewDescription(unit, descriptor, projectedHeat));
        return {
            id: heatEventId(unit),
            subject: unit.getNotificationDisplayName(),
            event: 'Heat and dissipation',
            ...this.heatReviewPresentation(unit, projectedHeat),
            ...(effects.length > 0 ? { effects } : {}),
        };
    }

    private createCombinedHeatEvent(
        unit: CBTForceUnit,
        heat: number,
        effects: readonly StagedHeatEffect[],
        includesPilotHitDecision: boolean,
    ): AutomationReviewEvent {
        return {
            id: combinedHeatEventId(unit),
            subject: unit.getNotificationDisplayName(),
            event: includesPilotHitDecision
                ? 'Heat, dissipation, effects, and pilot hits'
                : 'Heat, dissipation, and effects',
            ...(unit.hasPendingEndTurnHeat()
                ? this.heatReviewPresentation(unit, heat)
                : { description: `Heat ${heat}` }),
            ...(effects.length > 0 ? {
                effects: effects.map(effect =>
                    pendingUnitCheckReviewDescription(unit, effect.descriptor, heat)),
            } : {}),
        };
    }

    private createHeatEffectEvent(
        group: StagedUnitHeatEffects,
        effects: readonly StagedHeatEffect[],
        includesPilotHitDecision: boolean,
        includesHeatResolution: boolean,
    ): AutomationReviewEvent {
        return {
            id: group.id,
            subject: group.unit.getNotificationDisplayName(),
            event: includesPilotHitDecision ? 'Heat effects and pilot hits' : 'Heat effects',
            ...(includesHeatResolution
                ? this.heatReviewPresentation(group.unit, group.heat)
                : { description: `Heat ${group.heat}` }),
            effects: effects.map(effect =>
                pendingUnitCheckReviewDescription(group.unit, effect.descriptor, group.heat)),
        };
    }

    private heatReviewPresentation(
        unit: CBTForceUnit,
        projectedHeat: number,
    ): Pick<AutomationReviewEvent, 'description' | 'delta' | 'breakdown'> {
        const currentHeat = unit.getHeat().current;
        const turnState = unit.turnState();
        const projection = turnState.heatProjection();
        const breakdown: AutomationReviewBreakdownItem[] = buildHeatSummaryRows(
            turnState.heatSources(),
            turnState.heatDissipationBalance(),
            projection.consumedDissipation,
            projection.projected,
        ).map(row => ({ id: row.id, label: row.label, value: row.value }));
        return {
            description: `Heat ${currentHeat} → ${projectedHeat}`,
            delta: projectedHeat - currentHeat,
            ...(breakdown.length > 0 ? { breakdown } : {}),
        };
    }

    private createPilotHitEvent(group: StagedUnitHeatEffects): AutomationReviewEvent {
        const effects = group.effects.filter(effect =>
            unitCheckIsPilotHitHeatEffect(effect.descriptor.kind));
        return {
            id: pilotHitEventId(group.unit),
            subject: group.unit.getNotificationDisplayName(),
            event: 'Pilot hits and consciousness',
            description: `Heat ${group.heat}`,
            effects: effects.map(effect =>
                pendingUnitCheckReviewDescription(group.unit, effect.descriptor, group.heat)),
        };
    }

    private async resolvePilotHitEffects(
        stagedEffects: readonly StagedUnitHeatEffects[],
        acceptedEffects: ReadonlySet<string>,
        mode: AutomationMode,
    ): Promise<ReadonlySet<string> | null> {
        const groups = stagedEffects
            .filter(group => acceptedEffects.has(group.id))
            .filter(group => group.effects.some(effect =>
                unitCheckIsPilotHitHeatEffect(effect.descriptor.kind)));
        if (mode === 'yes') return new Set(groups.map(group => pilotHitEventId(group.unit)));
        if (mode === 'no' || groups.length === 0) return new Set<string>();
        return this.automations.resolve('pilotHitsAndConsciousnessCheck', groups.map(group => this.createPilotHitEvent(group)), {
            title: 'Review Pilot Hits',
            message: 'Choose which units\' pilot-hit effects to apply. Accepted hits continue directly into any required Consciousness Rolls.',
            allowCancel: true,
        });
    }

    private reviewableHeatEffects(
        effects: readonly StagedHeatEffect[],
        pilotHitsMode: AutomationMode,
    ): readonly StagedHeatEffect[] {
        return effects.filter(effect => this.isReviewableHeatEffect(effect.descriptor, pilotHitsMode));
    }

    private isReviewableHeatEffect(
        descriptor: HeatEffectDescriptor,
        pilotHitsMode: AutomationMode,
    ): boolean {
        return pilotHitsMode !== 'no' || !unitCheckIsPilotHitHeatEffect(descriptor.kind);
    }

    private stageHeatEffects(
        units: readonly CBTForceUnit[],
        heatByUnit: ReadonlyMap<string, number>,
    ): StagedUnitHeatEffects[] {
        return units.flatMap(unit => {
            const heat = heatByUnit.get(unit.id)!;
            const effects = getHeatEffectDescriptors(unit, heat)
                .map(descriptor => ({ id: uuidv7(), descriptor }));
            return effects.length > 0 ? [{
                id: heatEffectEventId(unit),
                unit,
                heat,
                effects,
            }] : [];
        });
    }

    private finalHeatByUnit(
        units: readonly CBTForceUnit[],
        acceptedHeat: ReadonlySet<string>,
    ): ReadonlyMap<string, number> {
        return new Map(units.map(unit => [
            unit.id,
            acceptedHeat.has(heatEventId(unit))
                ? unit.turnState().heatProjection().projected
                : unit.getHeat().current,
        ]));
    }

}
