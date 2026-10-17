// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import { orderedAutomationChecks, type AutomationCheck } from '../models/automation-check.model';
import type { AutomationReviewBreakdownItem, AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnitCommandDispatch } from '../models/cbt-force.types';
import {
    cbtUnitCheckPresentation,
    cbtUnitCheckReviewDescription,
    type CBTUnitCheckPresentationContext,
} from '../models/cbt-unit-check-presentation';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { getMekLocationLabel, type EntityMountedEquipment } from '../models/entity/types';
import type { AeroHeatAutomationCheck } from '../models/runtime/aero-heat-automation-rules';
import { selectedManualEndTurnHeat } from '../models/runtime/end-turn-heat-selection';
import { twoD6Total, type HeatAmmoExplosionCandidate } from '../models/runtime/mek-automation-rules';
import type { CBTUnitCommand } from '../models/runtime/unit-command';
import { buildHeatSummaryRows, type HeatSummarySource } from '../utils/heat-summary.util';
import { CBTAutomationCheckService } from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { CBTAutomationService } from './cbt-automation.service';
import { directAutomationSubject } from './direct-automation-subject';
import { OptionsService } from './options.service';

type EndTurnCommand = Extract<CBTUnitCommand, { readonly type: 'end-turn' }>;

/** Every end-turn heat check; aerospace adds its control checks to the shared heat core. */
export type EndTurnHeatCheck = AeroHeatAutomationCheck;

export interface StagedHeatCheck {
    readonly id: string;
    readonly check: EndTurnHeatCheck;
}

export interface RolledHeatCheck extends StagedHeatCheck {
    readonly total: number | null;
    readonly outcome: 'success' | 'failed';
}

/** Heat consequences staged for one unit at a settled heat value. */
export interface StagedEndTurnHeat {
    readonly id: string;
    readonly heat: number;
    readonly checks: readonly StagedHeatCheck[];
    readonly ammoCandidates: readonly HeatAmmoExplosionCandidate[];
}

export type ResolvedEndTurnHeat<Staged extends StagedEndTurnHeat> = Omit<Staged, 'checks'> & Readonly<{
    checks: readonly RolledHeatCheck[];
    ammo: HeatAmmoExplosionCandidate | null;
}>;

export interface PreparedEndTurnHeatEffects<Staged extends StagedEndTurnHeat> {
    readonly staged: ResolvedEndTurnHeat<Staged>;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
    readonly interactive: boolean;
}

export interface PreparedEndTurnHeat<Staged extends StagedEndTurnHeat> {
    readonly command: EndTurnCommand;
    readonly heatEffects?: PreparedEndTurnHeatEffects<Staged>;
}

export interface EndTurnHeatRequest {
    readonly instanceId: string;
    readonly command: EndTurnCommand;
}

/** A family's end-turn heat projection, in the terms of the heat summary. */
export interface EndTurnHeatProjection {
    readonly current: number;
    readonly projected: number;
    readonly sources: readonly HeatSummarySource[];
    readonly dissipationBalance: number;
    readonly consumedDissipation: number;
}

/** What differs between unit families; review, resolution, and settlement are shared. */
export interface EndTurnHeatAdapter<Snapshot extends CBTUnitSnapshot, Staged extends StagedEndTurnHeat> {
    snapshot(force: CBTForce, instanceId: string): Snapshot | null;
    /** Null when the unit has no end-turn heat step. */
    projectHeat(snapshot: Snapshot): EndTurnHeatProjection | null;
    stage(snapshot: Snapshot, heat: number): Staged;
    /** Pilot-hit descriptions staged outside `pilot-damage` checks, such as Mek Life Support. */
    extraPilotHitDescriptions(staged: Staged): readonly string[];
    applyEffects(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedEndTurnHeatEffects<Staged>,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean>;
}

interface HeatEvent extends AutomationReviewEvent {
    readonly delta: number;
    readonly breakdown: readonly AutomationReviewBreakdownItem[];
}

interface EndTurnHeatDecision<Snapshot, Staged> {
    readonly request: EndTurnHeatRequest;
    readonly snapshot: Snapshot | null;
    readonly staged: Staged | null;
    readonly heatAccepted: boolean;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
}

/**
 * The end-turn heat review every unit family shares: heat, then heat effects,
 * then pilot hits, then the effect checks. Each step builds its review options
 * here, so concurrently prepared families always join the same dialogs.
 */
@Injectable({ providedIn: 'root' })
export class EndTurnHeatAutomationService {
    private readonly automation = inject(CBTAutomationService);
    private readonly automationChecks = inject(CBTAutomationCheckService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly options = inject(OptionsService);

    /** Reviews the complete end-turn heat plan before any turn is committed; null when cancelled. */
    async prepare<Snapshot extends CBTUnitSnapshot, Staged extends StagedEndTurnHeat>(
        adapter: EndTurnHeatAdapter<Snapshot, Staged>,
        force: CBTForce,
        requests: readonly EndTurnHeatRequest[],
        interactive?: boolean,
    ): Promise<readonly Readonly<{ instanceId: string; prepared: PreparedEndTurnHeat<Staged> }>[] | null> {
        const rows = requests.map(request => {
            const snapshot = adapter.snapshot(force, request.instanceId);
            const projection = snapshot ? adapter.projectHeat(snapshot) : null;
            const staged = snapshot
                ? adapter.stage(snapshot, projection?.projected ?? snapshot.state.heat.current)
                : null;
            const event = snapshot && projection && staged
                ? this.heatEvent(adapter, request, snapshot, projection, staged)
                : null;
            return Object.freeze({ request, snapshot, projection, staged, event });
        });
        const effectsMode = this.options.cbtAutomationMode('heatEffectsCheck');
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');

        if (this.options.cbtAutomationMode('heatAndDissipationResolution') === 'ask' && effectsMode === 'ask') {
            const events = rows.flatMap(row => {
                if (!row.snapshot || !row.staged) return [];
                const effects = this.effectDescriptions(adapter, row.staged);
                if (!row.event && effects.length === 0) return [];
                return [Object.freeze({
                    id: combinedHeatEventId(row.request),
                    subject: this.subject(row.snapshot),
                    event: pilotHitsMode === 'ask'
                        ? 'Heat, dissipation, effects, and pilot hits'
                        : 'Heat, dissipation, and effects',
                    ...heatDetails(row.event, row.staged.heat),
                    ...(effects.length === 0 ? {} : { effects }),
                } satisfies AutomationReviewEvent)];
            });
            const accepted = await this.automation.resolve(
                'heatAndDissipationResolution',
                events,
                {
                    title: 'Review End-Turn Heat',
                    message: pilotHitsMode === 'ask'
                        ? 'Choose which units\' heat, dissipation, heat effects, and pilot hits to apply.'
                        : 'Choose which units\' heat, dissipation, and heat effects to apply.',
                    allowCancel: true,
                    interactive,
                },
            );
            if (accepted === null) return null;
            return this.resolveDecisions(adapter, rows.map(row => {
                const selected = accepted.has(combinedHeatEventId(row.request));
                return Object.freeze({
                    request: row.request,
                    snapshot: row.snapshot,
                    staged: row.staged,
                    heatAccepted: row.event !== null && selected,
                    applyEffects: selected,
                    applyPilotHits: selected && pilotHitsMode !== 'no',
                });
            }), interactive);
        }

        const acceptedHeat = await this.automation.resolve(
            'heatAndDissipationResolution',
            rows.flatMap(row => row.event ? [row.event] : []),
            {
                title: 'Review Heat and Dissipation',
                message: 'Choose which heat and dissipation results to apply.',
                allowCancel: true,
                interactive,
            },
        );
        if (acceptedHeat === null) return null;
        const finalRows = rows.map(row => {
            const heatAccepted = row.event !== null && acceptedHeat.has(row.event.id);
            if (!row.snapshot) return Object.freeze({ ...row, heatAccepted });
            const heat = heatAccepted && row.projection
                ? row.projection.projected
                : row.snapshot.state.heat.pendingOverride ?? row.snapshot.state.heat.current;
            return Object.freeze({ ...row, heatAccepted, staged: adapter.stage(row.snapshot, heat) });
        });

        const combinesEffectsAndPilotHits = effectsMode === 'ask' && pilotHitsMode === 'ask';
        const effectEvents = finalRows.flatMap(row => {
            if (!row.snapshot || !row.staged) return [];
            const effects = this.effectDescriptions(adapter, row.staged);
            if (effects.length === 0) return [];
            return [Object.freeze({
                id: row.staged.id,
                subject: this.subject(row.snapshot),
                event: combinesEffectsAndPilotHits ? 'Heat effects and pilot hits' : 'Heat effects',
                ...heatDetails(row.heatAccepted ? row.event : null, row.staged.heat),
                effects,
            } satisfies AutomationReviewEvent)];
        });
        const acceptedEffects = await this.automation.resolve(
            'heatEffectsCheck',
            effectEvents,
            {
                title: 'Review End-Turn Heat Effects',
                message: combinesEffectsAndPilotHits
                    ? 'Choose which units\' heat effects and pilot hits to resolve.'
                    : 'Choose which units\' heat effects to resolve.',
                allowCancel: true,
                interactive,
            },
        );
        if (acceptedEffects === null) return null;
        const effectsAccepted = finalRows.filter(row =>
            row.staged !== null && acceptedEffects.has(row.staged.id));

        let acceptedPilotHits = new Set<string>();
        if (combinesEffectsAndPilotHits) {
            acceptedPilotHits = new Set(effectsAccepted.map(row => pilotHitEventId(row.request)));
        } else if (pilotHitsMode === 'yes') {
            acceptedPilotHits = new Set(effectsAccepted
                .filter(row => this.pilotHitDescriptions(adapter, row.staged!).length > 0)
                .map(row => pilotHitEventId(row.request)));
        } else if (pilotHitsMode === 'ask') {
            const pilotEvents = effectsAccepted.flatMap(row => {
                const effects = this.pilotHitDescriptions(adapter, row.staged!);
                if (!row.snapshot || effects.length === 0) return [];
                return [Object.freeze({
                    id: pilotHitEventId(row.request),
                    subject: this.subject(row.snapshot),
                    event: 'Pilot hits and consciousness',
                    description: `Heat ${row.staged!.heat}`,
                    effects,
                } satisfies AutomationReviewEvent)];
            });
            const decision = await this.automation.resolve(
                'pilotHitsAndConsciousnessCheck',
                pilotEvents,
                {
                    title: 'Review Pilot Hits',
                    message: 'Choose which units\' pilot-hit effects to apply. Accepted hits continue directly into any required Consciousness Rolls.',
                    allowCancel: true,
                    interactive,
                },
            );
            if (decision === null) return null;
            acceptedPilotHits = new Set(decision);
        }

        return this.resolveDecisions(adapter, finalRows.map(row => Object.freeze({
            request: row.request,
            snapshot: row.snapshot,
            staged: row.staged,
            heatAccepted: row.heatAccepted,
            applyEffects: row.staged !== null && acceptedEffects.has(row.staged.id),
            applyPilotHits: acceptedPilotHits.has(pilotHitEventId(row.request)),
        })), interactive);
    }

    /** Settles the reviewed heat and its consequences before the turn reset. */
    async settle<
        Snapshot extends CBTUnitSnapshot,
        Staged extends StagedEndTurnHeat,
        Prepared extends Readonly<{ command: CBTUnitCommand; heatEffects?: PreparedEndTurnHeatEffects<Staged> }>,
    >(
        adapter: EndTurnHeatAdapter<Snapshot, Staged>,
        force: CBTForce,
        instanceId: string,
        prepared: Prepared,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<Prepared | null> {
        const command = prepared.command;
        if (command.type !== 'end-turn') return prepared;
        const initial = adapter.snapshot(force, instanceId);
        if (!initial) return null;
        const heatMode = this.options.cbtAutomationMode('heatAndDissipationResolution');
        const automaticHeat = command.policy === 'automatic';
        const finalHeat = automaticHeat
            ? prepared.heatEffects?.staged.heat ?? initial.state.heat.current
            : selectedManualEndTurnHeat(
                heatMode,
                initial.state.heat.current,
                initial.state.heat.pendingOverride,
            );
        const heat = await dispatch({ type: 'set-heat', heat: finalHeat }, false);
        if (!heat.accepted) return null;
        if (automaticHeat && heatMode === 'yes') {
            this.automationToasts.show(
                String(initial.instanceId),
                this.subject(initial),
                `Heat and dissipation: Heat ${initial.state.heat.current} → ${finalHeat}`,
                'info',
            );
        }
        if (prepared.heatEffects
            && !await adapter.applyEffects(force, instanceId, prepared.heatEffects, dispatch)) return null;
        if (!adapter.snapshot(force, instanceId)) return null;
        return Object.freeze({
            ...prepared,
            command: Object.freeze({ ...command, policy: 'manual' as const }),
        });
    }

    private async resolveDecisions<Snapshot extends CBTUnitSnapshot, Staged extends StagedEndTurnHeat>(
        adapter: EndTurnHeatAdapter<Snapshot, Staged>,
        decisions: readonly EndTurnHeatDecision<Snapshot, Staged>[],
        interactive?: boolean,
    ): Promise<readonly Readonly<{ instanceId: string; prepared: PreparedEndTurnHeat<Staged> }>[] | null> {
        const checks = orderedAutomationChecks(decisions.flatMap(decision => {
            const staged = decision.staged;
            if (!decision.snapshot || !staged || !decision.applyEffects) return [];
            const subject = this.subject(decision.snapshot);
            return staged.checks
                .filter(row => row.check.kind !== 'pilot-damage' || decision.applyPilotHits)
                .map(row => Object.freeze({
                    id: row.id,
                    subject,
                    ...cbtUnitCheckPresentation(row.check.kind, heatCheckContext(row.check, staged.heat)),
                    ...(row.check.target === undefined ? {} : { targetNumber: row.check.target }),
                    ...(row.check.automaticOutcome === undefined
                        ? {}
                        : { automaticOutcome: row.check.automaticOutcome }),
                    ...(row.check.kind !== 'ammo-explosion'
                        ? {}
                        : {
                            failureChoices: Object.freeze(staged.ammoCandidates.map(candidate => Object.freeze({
                                id: candidate.componentId,
                                label: ammoChoiceLabel(candidate.mount),
                                detail: `${candidate.damagePerShot}/shot · ${candidate.shots} shots`,
                            }))),
                        }),
                } satisfies AutomationCheck));
        }));
        const resolutions = await this.automationChecks.resolve(
            'heatEffectsCheck',
            checks,
            { title: 'Resolve Pending Checks', interactive },
        );
        if (resolutions === null) return null;
        const resolutionById = new Map(resolutions.map(result => [result.id, result]));
        return Object.freeze(decisions.map(decision => {
            const staged = decision.staged;
            const ammoCheck = staged?.checks.find(row => row.check.kind === 'ammo-explosion');
            const selectedAmmoId = ammoCheck ? resolutionById.get(ammoCheck.id)?.selectionId : undefined;
            return Object.freeze({
                instanceId: decision.request.instanceId,
                prepared: Object.freeze({
                    command: Object.freeze({
                        ...decision.request.command,
                        policy: decision.heatAccepted ? 'automatic' as const : 'manual' as const,
                    }),
                    ...(staged === null ? {} : {
                        heatEffects: Object.freeze({
                            staged: Object.freeze({
                                ...staged,
                                checks: Object.freeze(staged.checks.map(row => {
                                    const resolution = resolutionById.get(row.id);
                                    return Object.freeze({
                                        ...row,
                                        total: resolution?.dice ? twoD6Total(resolution.dice) : null,
                                        outcome: resolution?.outcome ?? row.check.automaticOutcome ?? 'success',
                                    });
                                })),
                                ammo: staged.ammoCandidates.find(candidate =>
                                    candidate.componentId === selectedAmmoId)
                                    ?? (staged.ammoCandidates.length === 1 ? staged.ammoCandidates[0]! : null),
                            }),
                            applyEffects: decision.applyEffects,
                            applyPilotHits: decision.applyPilotHits,
                            interactive: interactive === true,
                        }),
                    }),
                }),
            });
        }));
    }

    private heatEvent<Snapshot extends CBTUnitSnapshot, Staged extends StagedEndTurnHeat>(
        adapter: EndTurnHeatAdapter<Snapshot, Staged>,
        request: EndTurnHeatRequest,
        snapshot: Snapshot,
        projection: EndTurnHeatProjection,
        staged: Staged,
    ): HeatEvent | null {
        const hasHeatWork = projection.projected !== projection.current
            || projection.sources.some(source => source.value !== 0)
            || snapshot.state.heat.pendingOverride !== undefined;
        if (!hasHeatWork) return null;
        const effects = this.effectDescriptions(adapter, staged);
        return Object.freeze({
            id: `heat:${request.instanceId}`,
            subject: this.subject(snapshot),
            event: 'Heat and dissipation',
            description: `Heat ${projection.current} → ${projection.projected}`,
            delta: projection.projected - projection.current,
            breakdown: Object.freeze(buildHeatSummaryRows(
                projection.sources,
                projection.dissipationBalance,
                projection.consumedDissipation,
                projection.projected,
            ).map(row => Object.freeze({ id: row.id, label: row.label, value: row.value }))),
            ...(effects.length === 0 ? {} : { effects }),
        });
    }

    /** Heat effects in review order; pilot hits follow unless their automation is off. */
    private effectDescriptions<Snapshot extends CBTUnitSnapshot, Staged extends StagedEndTurnHeat>(
        adapter: EndTurnHeatAdapter<Snapshot, Staged>,
        staged: Staged,
    ): readonly string[] {
        return Object.freeze([
            ...staged.checks
                .filter(row => row.check.kind !== 'pilot-damage')
                .map(row => describeHeatCheck(row.check, staged.heat)),
            ...(this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'no'
                ? []
                : this.pilotHitDescriptions(adapter, staged)),
        ]);
    }

    private pilotHitDescriptions<Snapshot extends CBTUnitSnapshot, Staged extends StagedEndTurnHeat>(
        adapter: EndTurnHeatAdapter<Snapshot, Staged>,
        staged: Staged,
    ): readonly string[] {
        return Object.freeze([
            ...staged.checks
                .filter(row => row.check.kind === 'pilot-damage')
                .map(row => describeHeatCheck(row.check, staged.heat)),
            ...adapter.extraPilotHitDescriptions(staged),
        ]);
    }

    private subject(snapshot: CBTUnitSnapshot): string {
        return directAutomationSubject(snapshot, this.options.options().displayUnitNameFormat);
    }
}

/** One unit's heat checks staged at a settled heat, identified by its reviewed runtime revision. */
export function stagedEndTurnHeatChecks(
    snapshot: CBTUnitSnapshot,
    heat: number,
    checks: readonly EndTurnHeatCheck[],
): Pick<StagedEndTurnHeat, 'id' | 'heat' | 'checks'> {
    const revision = `${snapshot.instanceId}:${snapshot.query.stateRevision}`;
    return {
        id: `heat-effects:${revision}`,
        heat,
        checks: Object.freeze(checks.map((check, index) => Object.freeze({
            id: `heat-effect:${revision}:${index}`,
            check,
        }))),
    };
}

function combinedHeatEventId(request: EndTurnHeatRequest): string {
    return `end-turn-heat:${request.instanceId}`;
}

function pilotHitEventId(request: EndTurnHeatRequest): string {
    return `pilot-hits:${request.instanceId}`;
}

/** The accepted heat step's figures, or just the settled heat when there is none. */
function heatDetails(event: HeatEvent | null, heat: number) {
    return event
        ? { description: event.description, delta: event.delta, breakdown: event.breakdown }
        : { description: `Heat ${heat}` };
}

/** The bin's name and, when it is placed, its location. */
function ammoChoiceLabel(mount: EntityMountedEquipment): string {
    return mount.location === 'Unallocated'
        ? mount.displayName()
        : `${mount.displayName()} · ${getMekLocationLabel(mount.location) ?? mount.location}`;
}

function heatCheckContext(check: EndTurnHeatCheck, heat: number): CBTUnitCheckPresentationContext {
    return {
        targetNumber: check.target,
        heat,
        ...(check.kind === 'pilot-damage' ? { hits: 1 } : {}),
    };
}

function describeHeatCheck(check: EndTurnHeatCheck, heat: number): string {
    return cbtUnitCheckReviewDescription(check.kind, heatCheckContext(check, heat));
}
