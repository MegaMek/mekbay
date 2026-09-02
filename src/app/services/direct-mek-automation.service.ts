// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type { AutomationCheck, AutomationCheckResolution } from '../models/automation-check.model';
import { orderedAutomationChecks } from '../models/automation-check.model';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import {
    cbtUnitCheckAutomaticMessage,
    cbtUnitCheckPresentation,
    cbtUnitCheckReviewDescription,
} from '../models/cbt-unit-check-presentation';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTMekUnitCommandResult } from '../models/cbt-force.types';
import { hasMekRuntime, type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { structureConstructionKind } from '../models/construction-equipment.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { ComponentId, CrewPositionId, LocationId } from '../models/entity/entity-identifiers';
import { MAX_CREW_WOUNDS } from '../models/crew-member.model';
import { getMekLocationLabel, getTopologyFor, MEK_TORSO_LOCATIONS } from '../models/entity/types';
import { gameRulesFor, type MekExplosionProtection } from '../models/rules/game-rules';
import {
    ammoExplosionDamagePerShot,
    ammoRackSize,
    mekExplosionProtection,
    resolveMekCriticalChance,
    type MekCriticalChanceModifier,
    type MekCriticalChanceResult,
    type MekCriticalRollPlanV2,
} from '../models/runtime/mek-critical-hit-v2';
import {
    mekConsciousnessTarget,
    mekHeatAutomationChecks,
    roll2D6,
    twoD6Total,
    type MekHeatAutomationCheck,
} from '../models/runtime/mek-automation-rules';
import {
    resolveMekFallArmorDamage,
    resolveMekFallDamage,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    resolveMekStructureDamage,
} from '../models/runtime/mek-fall-rules';
import {
    MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
    type MekRuleCheckTokenV2,
} from '../models/runtime/mek-destruction-state-v2';
import { projectMekLifeSupportPilotDamage } from '../models/runtime/mek-life-support';
import type { MekRuntimeIndex } from '../models/runtime/mek-runtime-index';
import { resolveMekUnitWaterState } from '../models/runtime/mek-targeting-rules';
import type { MekUnitRuntimeState } from '../models/runtime/runtime-state';
import { uuidv4 } from '../utils/uuid.util';
import { selectedManualEndTurnHeat } from '../models/runtime/end-turn-heat-selection';
import type {
    MekPendingCriticalChanceResultV2,
    MekPendingCriticalChanceV2,
    MekPendingCriticalEventV2,
    MekPendingCriticalHitV2,
    MekPendingFallConsequencesV2,
} from '../models/runtime/mek-turn-state-v2';
import type { CBTUnitCommand, MekHitArcV2, MekUnitQueryPort } from '../models/runtime/unit-instance';
import { isModularArmorEquipment } from '../models/modular-armor.model';
import type { MekHitLocationTable } from '../utils/record-sheet-reference-table';
import { buildHeatSummaryRows } from '../utils/heat-summary.util';
import { CBTAutomationService } from './cbt-automation.service';
import {
    automationCheckEvidenceDice,
    CBTAutomationCheckService,
    resolveAutomationChecksAutomatically,
} from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import {
    automaticConsciousnessNotifications,
    automaticConsciousnessRecoveryNotification,
    CBTCrewHitAutomationService,
    type ResolvedCrewHits,
} from './cbt-crew-hit-automation.service';
import { OptionsService } from './options.service';
import { directAutomationSubject } from './direct-automation-subject';
import { MekFallingAutomationService } from './mek-falling-automation.service';
import type { Toast } from './toast.service';

type MekSnapshot = Omit<CBTUnitSnapshot, 'entity' | 'index' | 'state' | 'query'> & Readonly<{
    entity: MekEntity;
    index: MekRuntimeIndex;
    state: MekUnitRuntimeState;
    query: MekUnitQueryPort;
}>;

export type DirectMekAutomationDispatch = (
    command: CBTUnitCommand,
    automate?: boolean,
) => Promise<CBTMekUnitCommandResult>;

export interface PreparedDirectMekAutomationCommand {
    readonly command: CBTUnitCommand;
    readonly deferredPilotHits: number;
    readonly cancelled?: true;
    readonly criticalPlan?: Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>;
    readonly heatEffects?: PreparedMekHeatEffects;
    readonly phaseBoundary?: PreparedMekPhaseBoundary;
    readonly pilotCheckFall?: PreparedMekFall;
}

export interface DirectMekEndTurnAutomationRequest {
    readonly instanceId: string;
    readonly command: Extract<CBTUnitCommand, { readonly type: 'end-turn' }>;
}

export interface DirectMekEndPhaseAutomationRequest {
    readonly instanceId: string;
    readonly command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>;
}

export interface PreparedDirectMekEndPhaseAutomation {
    readonly instanceId: string;
    readonly prepared: PreparedDirectMekAutomationCommand;
}

export interface PreparedDirectMekEndTurnAutomation {
    readonly instanceId: string;
    readonly prepared: PreparedDirectMekAutomationCommand;
}

export interface DirectMekAutomationReviewOptions {
    readonly interactive?: boolean;
    readonly phaseWork?: 'all' | 'unit-checks' | 'pilot-checks';
}

interface DirectCriticalChanceContext {
    /** Used only by table-C/through-armor chances; ordinary penetration never floats. */
    readonly floatingHitArc?: MekHitArcV2;
    /** Exact armor-facing decision captured when this hit reached structure. */
    readonly hardenedArmorApplies?: boolean;
    /** Internal-explosion protection carried into the resulting critical sequence. */
    readonly explosionProtection?: MekExplosionProtection;
    /** A hit that consumed this location's last structure pip. */
    readonly locationDestroyed?: boolean;
}

interface StagedMekHeatCheck {
    readonly id: string;
    readonly check: MekHeatAutomationCheck;
}

interface RolledMekHeatCheck extends StagedMekHeatCheck {
    readonly total: number | null;
    readonly outcome: 'success' | 'failed';
}

interface StagedMekHeatEffects {
    readonly id: string;
    readonly heat: number;
    readonly checks: readonly StagedMekHeatCheck[];
    readonly heatLifeHits: number;
    readonly drowningHits: number;
    readonly ammoCandidates: readonly MekAmmoExplosionCandidate[];
}

interface ResolvedMekHeatEffects extends Omit<StagedMekHeatEffects, 'checks'> {
    readonly checks: readonly RolledMekHeatCheck[];
    readonly ammoComponentId?: ComponentId;
}

interface MekAmmoExplosionCandidate {
    readonly componentId: ComponentId;
    readonly equipment: string;
    readonly location?: string;
    readonly damagePerShot: number;
    readonly shots: number;
}

interface PreparedMekHeatEffects {
    readonly staged: ResolvedMekHeatEffects;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
    readonly interactive: boolean;
}

interface AppliedMekLifeSupportDamage {
    readonly kind: 'life-support-damage' | 'life-support-drowning';
    readonly hits: number;
}

interface MekEndTurnDecision {
    readonly request: DirectMekEndTurnAutomationRequest;
    readonly snapshot: MekSnapshot | null;
    readonly staged: StagedMekHeatEffects | null;
    readonly heatAccepted: boolean;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
}

interface StagedMekPilotCheck {
    readonly checkId: string;
    readonly reason: string;
    readonly targetNumber: number;
    readonly triggerKind: string;
}

interface PreparedMekPilotCheck extends StagedMekPilotCheck {
    readonly dice: readonly [number, number];
    readonly total: number;
    readonly failed: boolean;
    readonly automaticFailure?: boolean;
}

interface StagedMekRuleCheck {
    readonly eventId: string;
    readonly token: MekRuleCheckTokenV2;
    readonly targetNumber: number;
}

interface PreparedMekRuleCheck extends StagedMekRuleCheck {
    readonly dice: readonly [number, number];
    readonly total: number;
    readonly outcome: 'success' | 'failed';
}

interface PreparedMekFall {
    readonly eventId: string;
    readonly accepted: boolean;
    readonly ruleset: MekSnapshot['ruleset'];
    readonly damage: ReturnType<typeof resolveMekFallDamage>;
    readonly orientation: ReturnType<typeof resolveMekFallOrientation>;
    readonly locations: readonly Readonly<{
        damage: number;
        result: ReturnType<typeof resolveMekFallHitLocation>;
    }>[];
    readonly applyPilotHits: boolean;
    readonly forceSeatbeltFailure: boolean;
    readonly interactive: boolean;
    /** Eligible crew positions; targets and rolls use the post-fall runtime. */
    readonly seatbelts: readonly Readonly<{
        positionId: CrewPositionId;
    }>[];
}

interface PreparedMekConsciousnessRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly total: number;
    readonly targetNumber: number;
    readonly recovered: boolean;
    readonly accepted: boolean;
}

interface StagedMekConsciousnessRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly targetNumber: number;
    readonly event: AutomationReviewEvent;
}

interface StagedMekPhaseBoundaryReview {
    readonly snapshot: MekSnapshot;
    readonly command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>;
    readonly checks: readonly StagedMekPilotCheck[];
    readonly ruleCheck: StagedMekRuleCheck | null;
    readonly hadAutomaticFall: boolean;
    readonly recoveries: readonly StagedMekConsciousnessRecovery[];
}

interface PreparedMekPhaseBoundary {
    readonly work: 'all' | 'unit-checks' | 'pilot-checks';
    readonly checks: readonly PreparedMekPilotCheck[];
    readonly ruleCheck: PreparedMekRuleCheck | null;
    readonly acceptedCheckIds: ReadonlySet<string>;
    readonly hadAutomaticFall: boolean;
    readonly fall: PreparedMekFall | null;
    readonly recoveries: readonly PreparedMekConsciousnessRecovery[];
    /** The first reduction deliberately leaves phase movement state open. */
    readonly needsSettlement: boolean;
}

/**
 * Coordinates user-selected automations around the direct Entity + runtime owner.
 * Rules remain pure or reducer-owned; this service only rolls, reviews, and emits typed commands.
 */
@Injectable({ providedIn: 'root' })
export class DirectMekAutomationService {
    private readonly automation = inject(CBTAutomationService);
    private readonly automationChecks = inject(CBTAutomationCheckService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly crewHitAutomation = inject(CBTCrewHitAutomationService);
    private readonly fallingAutomation = inject(MekFallingAutomationService);
    private readonly options = inject(OptionsService);
    private readonly resolvingCriticalEvents = new WeakMap<CBTForce, Map<string, boolean>>();

    async prepareCommand(
        force: CBTForce,
        instanceId: string,
        command: CBTUnitCommand,
    ): Promise<PreparedDirectMekAutomationCommand> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return Object.freeze({ command, deferredPilotHits: 0 });
        if (command.type === 'set-crew-state'
            && command.unconscious
            && !snapshot.query.crewState(command.positionId).unconscious) {
            return Object.freeze({
                command: Object.freeze({
                    ...command,
                    recoveryReadyTurn: this.options.cbtAutomationMode(
                        'pilotHitsAndConsciousnessCheck',
                    ) === 'no'
                        ? null
                        : snapshot.state.turn.turnCounter + 1,
                }),
                deferredPilotHits: 0,
            });
        }
        if (command.type === 'end-turn') {
            const batch = await this.prepareEndTurnCommands(force, [{ instanceId, command }]);
            return batch?.[0]?.prepared
                ?? Object.freeze({ command, deferredPilotHits: 0, cancelled: true });
        }
        if (command.type === 'end-phase') {
            const batch = await this.prepareEndPhaseCommands(force, [{ instanceId, command }]);
            return batch?.[0]?.prepared
                ?? Object.freeze({ command, deferredPilotHits: 0, cancelled: true });
        }
        if (command.type === 'resolve-mek-pilot-check') {
            const check = snapshot.query.mekPilotChecks()
                .find(candidate => candidate.checkId === command.checkId);
            const failed = check?.status === 'pending'
                && command.evidence.dice.length === 2
                && command.evidence.dice.every(die => Number.isSafeInteger(die) && die >= 1 && die <= 6)
                && twoD6Total(command.evidence.dice) < check.targetNumber;
            if (!failed || check.source.triggerKind === 'get-up'
                || snapshot.query.hasCondition('prone')) {
                return Object.freeze({ command, deferredPilotHits: 0 });
            }
            const fall = await this.prepareFall(snapshot, check.reason, true);
            return fall === null
                ? Object.freeze({ command, deferredPilotHits: 0, cancelled: true })
                : Object.freeze({ command, deferredPilotHits: 0, pilotCheckFall: fall });
        }
        if (command.type !== 'apply-mek-critical-roll') {
            return Object.freeze({ command, deferredPilotHits: 0 });
        }

        const plan = snapshot.query.mekCriticalRoll(
            command.locationId,
            command.results,
            command.target,
        );
        if (plan.kind !== 'applied' || (!plan.explosion && !plan.pendingExplosion)) {
            return Object.freeze({ command, deferredPilotHits: 0 });
        }
        const rawDamage = plan.explosion?.rawDamage ?? plan.pendingExplosion?.rawDamage ?? 0;
        const reviewId = uuidv4();
        const event: AutomationReviewEvent = Object.freeze({
            id: `explosion:${reviewId}`,
            subject: this.subject(snapshot),
            event: `${plan.equipment} Explosion`,
            description: `Apply ${rawDamage} points of internal explosion damage.`,
            delta: rawDamage,
            effects: Object.freeze(plan.explosion?.locations.map(location =>
                `${getMekLocationLabel(location.locationCode) ?? location.locationCode}: `
                + `${location.internalDamage} internal, ${location.armorDamage} armor`) ?? []),
        });
        const explosionAccepted = await this.automation.resolve(
            'internalExplosionsCheck',
            [event],
            { title: 'Review Internal Explosion', allowCancel: true },
        );
        if (explosionAccepted === null) {
            return Object.freeze({ command, deferredPilotHits: 0, cancelled: true });
        }
        const applyExplosion = explosionAccepted.has(event.id);
        const potentialPilotHits = plan.explosion?.pilotHits
            ?? gameRulesFor(snapshot.ruleset).getMekInternalExplosionPilotHits();
        // origin/next treats the explosion decision as the authority for its
        // intrinsic pilot hits. The pilot-hit setting controls the resulting
        // consciousness checks, not whether an accepted explosion wounds the
        // crew in the first place.
        const reviewedPilotHits = applyExplosion ? potentialPilotHits : 0;
        return Object.freeze({
            command: {
                ...command,
                applyExplosion,
                applyPilotHits: false,
                settlePendingExplosion: true,
            },
            deferredPilotHits: reviewedPilotHits,
            criticalPlan: plan,
        });
    }

    /** Reviews the complete force-wide Mek end-turn plan before any turn is committed. */
    async prepareEndTurnCommands(
        force: CBTForce,
        requests: readonly DirectMekEndTurnAutomationRequest[],
        review: DirectMekAutomationReviewOptions = {},
    ): Promise<readonly PreparedDirectMekEndTurnAutomation[] | null> {
        const rows = requests.map(request => {
            const snapshot = this.snapshot(force, request.instanceId);
            const projection = snapshot?.query.heatProjection('automatic');
            const automaticHeat = snapshot === null
                ? 0
                : projection?.kind === 'supported'
                    ? projection.projection.projected
                    : snapshot.state.heat.current;
            const staged = snapshot
                ? this.stageMekHeatEffects(snapshot, automaticHeat)
                : null;
            const effects = staged
                ? this.reviewableMekHeatEffectDescriptions(staged)
                : Object.freeze([]);
            const hasHeatWork = snapshot !== null
                && projection?.kind === 'supported'
                && (
                    projection.projection.projected !== projection.projection.current
                    || projection.projection.sources.some(source => source.value !== 0)
                    || projection.projection.dissipated > 0
                    || snapshot.state.heat.pendingOverride !== undefined
                );
            const event: AutomationReviewEvent | null = snapshot
                && projection?.kind === 'supported'
                && hasHeatWork
                ? Object.freeze({
                id: `heat:${uuidv4()}`,
                subject: this.subject(snapshot),
                event: 'Heat and dissipation',
                description: `Heat ${projection.projection.current} → ${projection.projection.projected}`,
                delta: projection.projection.delta,
                breakdown: Object.freeze(buildHeatSummaryRows(
                    projection.projection.sources,
                    projection.projection.capacity
                        - projection.projection.previouslyConsumedDissipation,
                    projection.projection.dissipated,
                    projection.projection.projected,
                ).map(row => Object.freeze({
                    id: row.id,
                    label: row.label,
                    value: row.value,
                }))),
                ...(effects.length > 0 ? { effects } : {}),
            }) : null;
            return Object.freeze({ request, snapshot, event, staged });
        });
        const heatMode = this.options.cbtAutomationMode('heatAndDissipationResolution');
        const effectsMode = this.options.cbtAutomationMode('heatEffectsCheck');
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');

        if (heatMode === 'ask' && effectsMode === 'ask') {
            const events = rows.flatMap(row => {
                const effects = row.staged
                    ? this.reviewableMekHeatEffectDescriptions(row.staged)
                    : Object.freeze([]);
                if (!row.snapshot || (!row.event && effects.length === 0)) return [];
                return [Object.freeze({
                    id: this.combinedHeatEventId(row.request),
                    subject: this.subject(row.snapshot),
                    event: pilotHitsMode === 'ask'
                        ? 'Heat, dissipation, effects, and pilot hits'
                        : 'Heat, dissipation, and effects',
                    ...(row.event
                        ? {
                            description: row.event.description,
                            ...(row.event.delta === undefined ? {} : { delta: row.event.delta }),
                            ...(row.event.breakdown === undefined ? {} : { breakdown: row.event.breakdown }),
                        }
                        : { description: `Heat ${row.staged?.heat ?? row.snapshot.state.heat.current}` }),
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
                    interactive: review.interactive,
                },
            );
            if (accepted === null) return null;
            return this.resolveMekEndTurnDecisions(rows.map(row => {
                const selected = accepted.has(this.combinedHeatEventId(row.request));
                return Object.freeze({
                    request: row.request,
                    snapshot: row.snapshot,
                    staged: row.staged,
                    heatAccepted: row.event !== null && selected,
                    applyEffects: selected,
                    applyPilotHits: selected && pilotHitsMode !== 'no',
                } satisfies MekEndTurnDecision);
            }), review.interactive);
        }

        const acceptedHeat = await this.automation.resolve(
            'heatAndDissipationResolution',
            rows.flatMap(row => row.event ? [row.event] : []),
            {
                title: 'Review Heat and Dissipation',
                message: 'Choose which heat and dissipation results to apply.',
                allowCancel: true,
                interactive: review.interactive,
            },
        );
        if (acceptedHeat === null) return null;

        const finalRows = rows.map(row => {
            const heatAccepted = row.event !== null && acceptedHeat.has(row.event.id);
            const finalProjection = row.snapshot?.query.heatProjection('automatic');
            const finalHeat = heatAccepted && finalProjection?.kind === 'supported'
                ? finalProjection.projection.projected
                : row.snapshot?.state.heat.pendingOverride
                    ?? row.snapshot?.state.heat.current
                    ?? 0;
            const staged = row.snapshot
                ? this.stageMekHeatEffects(
                    row.snapshot,
                    finalHeat,
                )
                : null;
            return Object.freeze({ ...row, heatAccepted, staged });
        });
        const combinesEffectsAndPilotHits = effectsMode === 'ask' && pilotHitsMode === 'ask';
        const effectEvents = finalRows.flatMap(row => {
            if (!row.snapshot || !row.staged) return [];
            const effects = this.reviewableMekHeatEffectDescriptions(row.staged);
            if (effects.length === 0) return [];
            return [Object.freeze({
                id: row.staged.id,
                subject: this.subject(row.snapshot),
                event: combinesEffectsAndPilotHits ? 'Heat effects and pilot hits' : 'Heat effects',
                ...(row.heatAccepted && row.event
                    ? {
                        description: row.event.description,
                        ...(row.event.delta === undefined ? {} : { delta: row.event.delta }),
                        ...(row.event.breakdown === undefined ? {} : { breakdown: row.event.breakdown }),
                    }
                    : { description: `Heat ${row.staged.heat}` }),
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
                interactive: review.interactive,
            },
        );
        if (acceptedEffects === null) return null;

        let acceptedPilotHits = new Set<string>();
        if (combinesEffectsAndPilotHits) {
            acceptedPilotHits = new Set(finalRows
                .filter(row => row.staged && acceptedEffects.has(row.staged.id))
                .map(row => this.pilotHitEventId(row.request)));
        } else if (pilotHitsMode === 'yes') {
            acceptedPilotHits = new Set(finalRows
                .filter(row => row.staged && mekLifeSupportHits(row.staged) > 0)
                .filter(row => row.staged && acceptedEffects.has(row.staged.id))
                .map(row => this.pilotHitEventId(row.request)));
        } else if (pilotHitsMode === 'ask') {
            const pilotEvents = finalRows.flatMap(row => {
                if (!row.snapshot || !row.staged || mekLifeSupportHits(row.staged) === 0
                    || !acceptedEffects.has(row.staged.id)) return [];
                return [Object.freeze({
                    id: this.pilotHitEventId(row.request),
                    subject: this.subject(row.snapshot),
                    event: 'Pilot hits and consciousness',
                    description: `Heat ${row.staged.heat}`,
                    effects: lifeSupportReviewDescriptions(row.staged),
                } satisfies AutomationReviewEvent)];
            });
            const decision = await this.automation.resolve(
                'pilotHitsAndConsciousnessCheck',
                pilotEvents,
                {
                    title: 'Review Pilot Hits',
                    message: 'Choose which units\' pilot-hit effects to apply. Accepted hits continue directly into any required Consciousness Rolls.',
                    allowCancel: true,
                    interactive: review.interactive,
                },
            );
            if (decision === null) return null;
            acceptedPilotHits = new Set(decision);
        }

        return this.resolveMekEndTurnDecisions(finalRows.map(row => Object.freeze({
            request: row.request,
            snapshot: row.snapshot,
            staged: row.staged,
            heatAccepted: row.heatAccepted,
            applyEffects: row.staged !== null && acceptedEffects.has(row.staged.id),
            applyPilotHits: acceptedPilotHits.has(this.pilotHitEventId(row.request)),
        } satisfies MekEndTurnDecision)), review.interactive);
    }

    /** Applies the reviewed heat/consequence chain before the turn reset. */
    async settleBeforeCommand(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedDirectMekAutomationCommand,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<PreparedDirectMekAutomationCommand | null> {
        const resumedFall = await this.resumePendingFallConsequences(
            force,
            instanceId,
            dispatch,
        );
        if (resumedFall === false) return null;
        const phaseWork = prepared.phaseBoundary?.work;
        if (phaseWork !== 'unit-checks'
            && !await this.resumePendingCriticalEvents(force, instanceId, dispatch, false)) {
            return null;
        }
        if (prepared.command.type === 'end-phase' && prepared.phaseBoundary) {
            if (!await this.applyPhaseBoundary(
                force,
                instanceId,
                prepared.phaseBoundary,
                dispatch,
                resumedFall ?? undefined,
            )) return null;
            // A fall or other phase consequence can create a critical chain
            // after the opening drain. Never commit the phase over that work.
            if (phaseWork !== 'unit-checks'
                && !await this.resumePendingCriticalEvents(force, instanceId, dispatch, false)) {
                return null;
            }
            const settled = this.snapshot(force, instanceId);
            if (!settled) return null;
            return Object.freeze({
                ...prepared,
                command: Object.freeze({
                    ...prepared.command,
                }),
                phaseBoundary: undefined,
            });
        }
        if (prepared.command.type !== 'end-turn') return prepared;
        const initial = this.snapshot(force, instanceId);
        if (!initial) return null;
        const automaticHeat = prepared.command.policy === 'automatic';
        const finalHeat = prepared.command.policy === 'automatic'
            ? prepared.heatEffects?.staged.heat ?? initial.state.heat.current
            : selectedManualEndTurnHeat(
                this.options.cbtAutomationMode('heatAndDissipationResolution'),
                initial.state.heat.current,
                initial.state.heat.pendingOverride,
            );
        const heat = await dispatch({
            type: 'set-heat',
            heat: finalHeat,
        }, false);
        if (!heat.accepted) return null;
        if (automaticHeat
            && this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes') {
            this.toast(
                initial,
                `Heat and dissipation: Heat ${initial.state.heat.current} → ${finalHeat}`,
                'info',
            );
        }
        if (prepared.heatEffects) {
            if (!await this.applyMekHeatEffects(
                force,
                instanceId,
                prepared.heatEffects,
                dispatch,
            )) return null;
        }
        const settled = this.snapshot(force, instanceId);
        if (!settled) return null;
        return Object.freeze({
            ...prepared,
            command: Object.freeze({
                ...prepared.command,
                policy: 'manual' as const,
            }),
        });
    }

    async afterCommand(
        force: CBTForce,
        instanceId: string,
        before: CBTUnitSnapshot | null,
        prepared: PreparedDirectMekAutomationCommand,
        result: CBTMekUnitCommandResult,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        if (!result.accepted || !result.changed) return true;
        const command = prepared.command;
        if (command.type === 'set-crew-state' && before && hasMekRuntime(before)) {
            const after = this.snapshot(force, instanceId);
            if (after && !await this.recordCrewRecoveryTransition(
                before as MekSnapshot,
                after,
                command.positionId,
                dispatch,
            )) return false;
        }
        if (prepared.deferredPilotHits > 0) {
            if (!await this.applyPilotHits(
                force,
                instanceId,
                prepared.deferredPilotHits,
                dispatch,
            )) return false;
        }
        if (prepared.pilotCheckFall?.accepted
            && !await this.applyPreparedFall(
                force,
                instanceId,
                prepared.pilotCheckFall,
                dispatch,
            )) return false;
        if (command.type === 'damage-internal') {
            const after = this.snapshot(force, instanceId);
            const perspective = command.target === 'pending' ? 'preview' as const : 'committed' as const;
            await this.resolveCriticalChance(
                force,
                instanceId,
                command.locationId,
                command.target,
                {
                    hardenedArmorApplies: command.hardenedArmorApplies,
                    locationDestroyed: after?.query.remainingInternal(
                        command.locationId,
                        perspective,
                    ) === 0,
                },
                dispatch,
            );
            if (!command.armorDamagedBySameHit) {
                await this.resolveBreachOrFloodLocation(
                    force, instanceId, command.locationId, command.target, dispatch,
                );
            }
        } else if (command.type === 'damage-armor') {
            await this.resolveBreachOrFlood(force, instanceId, command, dispatch);
        } else if (command.type === 'apply-mek-critical-roll'
            && prepared.criticalPlan
            && before
            && hasMekRuntime(before)
            && command.applyExplosion !== false) {
            await this.resolveExplosionConsequences(
                force,
                instanceId,
                before as MekSnapshot,
                prepared.criticalPlan,
                command.target,
                dispatch,
                this.resolvingCriticalEvents.get(force)?.get(instanceId) === true,
            );
        }
        return true;
    }

    /** Groups every Mek's boundary checks before the first phase is committed. */
    async prepareEndPhaseCommands(
        force: CBTForce,
        requests: readonly DirectMekEndPhaseAutomationRequest[],
        review: DirectMekAutomationReviewOptions = {},
    ): Promise<readonly PreparedDirectMekEndPhaseAutomation[] | null> {
        const phaseWork = review.phaseWork ?? 'all';
        const includeRecoveries = phaseWork !== 'pilot-checks';
        const includePilotChecks = phaseWork !== 'unit-checks';
        const pilotSkillMode = this.options.cbtAutomationMode('pilotSkillCheck');
        // `no` skips PSRs only at the phase boundary. Clicking their badge is an
        // explicit request to resolve them and therefore uses the manual workflow.
        const pilotChecksEnabled = pilotSkillMode !== 'no' || review.interactive === true;
        const rows = requests.map(request => {
            const snapshot = this.snapshot(force, request.instanceId);
            return Object.freeze({
                request,
                staged: snapshot ? this.stagePhaseBoundary(snapshot, request.command) : null,
            });
        });
        // Origin/next resolves every eligible recovery before presenting PSRs.
        // Project that ordering during preflight so cancellation remains atomic.
        const recoveryCandidates = includeRecoveries ? rows.flatMap(row =>
            row.staged?.recoveries.map(recovery => {
                const assignment = row.staged!.snapshot.crewAssignment.positions.find(position =>
                    position.positionId === recovery.positionId);
                return Object.freeze({
                    id: recovery.eventId,
                    subject: recovery.event.subject,
                    ...cbtUnitCheckPresentation('consciousness-recovery', {
                        crewName: assignment?.name.trim() || undefined,
                    }),
                    targetNumber: recovery.targetNumber,
                } satisfies AutomationCheck);
            }) ?? []) : [];
        const recoveryResults = await this.automationChecks.resolve(
            'pilotHitsAndConsciousnessCheck',
            recoveryCandidates,
            { title: 'Recover Consciousness', interactive: review.interactive },
        );
        if (recoveryResults === null) return null;
        const recoveryById = new Map(recoveryResults.map(result => [result.id, result]));

        const initiallyFailedGroups = new Set<string>();
        const automaticallyResolvedChecks: AutomationCheckResolution[] = [];
        const checkCandidates = includePilotChecks ? rows.flatMap(row => {
            const staged = row.staged;
            if (!staged) return [];
            const fallGroup = `fall:${row.request.instanceId}`;
            const rowInitiallyFailedGroups = new Set<string>();
            if (staged.hadAutomaticFall) {
                rowInitiallyFailedGroups.add(fallGroup);
                initiallyFailedGroups.add(fallGroup);
            }
            const recoveredPositions = new Set(staged.recoveries
                .filter(recovery => recoveryById.get(recovery.eventId)?.outcome === 'success')
                .map(recovery => recovery.positionId));
            const movement = staged.snapshot.query.mekMovementPsr();
            const pilotCanControl = this.activePilot(staged.snapshot, recoveredPositions) !== null
                || movement.kind === 'supported' && movement.controlledByDrone;
            const result: AutomationCheck[] = [];
            if (staged.ruleCheck) result.push(Object.freeze({
                id: staged.ruleCheck.eventId,
                subject: this.subject(staged.snapshot),
                label: 'Crippling Destruction Check',
                description: 'Check whether the Mek becomes crippled.',
                failureOutcome: 'Mek becomes crippled',
                targetNumber: staged.ruleCheck.targetNumber,
                ...(!pilotCanControl
                    || staged.snapshot.query.hasCondition('shutdown')
                    ? { automaticOutcome: 'failed' as const }
                    : {}),
            }));
            result.push(...staged.checks.map(check => Object.freeze({
                id: check.checkId,
                subject: this.subject(staged.snapshot),
                label: 'Piloting Skill Check',
                description: check.reason,
                failureOutcome: check.triggerKind === 'get-up' ? 'Remain prone' : 'Fall',
                targetNumber: check.targetNumber,
                ...(check.triggerKind === 'shutdown' || check.triggerKind === 'get-up'
                    ? {}
                    : {
                        failureGroup: fallGroup,
                        cascadeFailureLabel: 'FAILED — PREVIOUS FALL CHECK FAILED',
                    }),
                ...(!pilotCanControl
                    || staged.snapshot.query.hasCondition('shutdown')
                        && check.triggerKind !== 'shutdown'
                    ? { automaticOutcome: 'failed' as const }
                    : {}),
            } satisfies AutomationCheck)));
            // origin/next bypasses the PSR panel when a unit has no rollable
            // checks (no active pilot, shutdown, or an already-forced fall).
            // Resolve that unit now so other units' actionable rows can still
            // share one force-wide dialog without displaying automatic-only rows.
            if (pilotChecksEnabled
                && automationCheckBatchIsFullyAutomatic(result, rowInitiallyFailedGroups)) {
                automaticallyResolvedChecks.push(...resolveAutomationChecksAutomatically(
                    result,
                    rowInitiallyFailedGroups,
                ));
                return [];
            }
            return result;
        }) : [];
        const reviewedCheckResults = await this.automationChecks.resolve(
            'pilotSkillCheck',
            checkCandidates,
            {
                title: 'Piloting Skill Rolls',
                initiallyFailedGroups,
                interactive: review.interactive,
                manualResolution: review.interactive,
            },
        );
        if (reviewedCheckResults === null) return null;
        const checkResults = Object.freeze([
            ...automaticallyResolvedChecks,
            ...reviewedCheckResults,
        ]);
        const checkById = new Map(checkResults.map(result => [result.id, result]));
        const acceptedCheckIds = new Set(checkResults.map(result => result.id));

        const falls = new Map<string, PreparedMekFall | null>();
        // Disabled PSRs pass the boundary and are discarded; a badge-driven
        // manual resolution still applies the selected roll and its consequences.
        for (const row of includePilotChecks && pilotChecksEnabled ? rows : []) {
            const staged = row.staged;
            if (!staged) continue;
            const failedCheck = staged.checks.find(check =>
                check.triggerKind !== 'get-up'
                && checkById.get(check.checkId)?.outcome === 'failed');
            if (!failedCheck && !staged.hadAutomaticFall) continue;
            const fall = await this.prepareFall(
                staged.snapshot,
                failedCheck?.reason ?? 'Automatic fall',
                true,
                false,
                review.interactive === true,
            );
            if (fall === null) return null;
            falls.set(row.request.instanceId, fall);
        }

        return Object.freeze(rows.map(row => {
            const { request, staged } = row;
            if (!staged) return Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({ command: request.command, deferredPilotHits: 0 }),
            });
            return Object.freeze({
                instanceId: request.instanceId,
                prepared: Object.freeze({
                    command: request.command,
                    deferredPilotHits: 0,
                    phaseBoundary: Object.freeze({
                        work: phaseWork,
                        checks: Object.freeze((includePilotChecks ? staged.checks : []).map(check => {
                            const resolution = checkById.get(check.checkId);
                            return resolution
                                ? this.resolvedPilotCheck(check, resolution)
                                : this.skippedPilotCheck(check);
                        })),
                        ruleCheck: includePilotChecks && staged.ruleCheck
                            && checkById.has(staged.ruleCheck.eventId)
                            ? this.resolvedRuleCheck(
                                staged.ruleCheck,
                                checkById.get(staged.ruleCheck.eventId)!,
                            )
                            : includePilotChecks && staged.ruleCheck
                                ? this.skippedRuleCheck(staged.ruleCheck)
                                : null,
                        acceptedCheckIds: new Set(acceptedCheckIds),
                        hadAutomaticFall: includePilotChecks && staged.hadAutomaticFall,
                        fall: falls.get(request.instanceId) ?? null,
                        recoveries: Object.freeze((includeRecoveries ? staged.recoveries : []).map(recovery => {
                            const resolution = recoveryById.get(recovery.eventId);
                            const dice = resolution
                                ? automationCheckEvidenceDice(resolution, recovery.targetNumber)
                                : null;
                            return Object.freeze({
                                eventId: recovery.eventId,
                                positionId: recovery.positionId,
                                total: dice === null ? 0 : twoD6Total(dice),
                                targetNumber: recovery.targetNumber,
                                recovered: resolution?.outcome === 'success',
                                accepted: resolution !== undefined,
                            } satisfies PreparedMekConsciousnessRecovery);
                        })),
                        needsSettlement: includePilotChecks && (
                            staged.checks.length > 0
                            || staged.ruleCheck !== null
                            || staged.hadAutomaticFall
                        ),
                    }),
                }),
            });
        }));
    }

    private stagePhaseBoundary(
        snapshot: MekSnapshot,
        command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>,
    ): StagedMekPhaseBoundaryReview | null {
        const preview = snapshot.query.previewEndPhase();
        if (!preview.accepted) return null;

        const checks = Object.freeze(preview.state.movementPsr.checks
            .filter(check => check.status === 'pending')
            .map(check => Object.freeze({
                checkId: check.checkId,
                reason: check.reason,
                targetNumber: check.targetNumber,
                triggerKind: check.source.triggerKind,
            } satisfies StagedMekPilotCheck)));
        const movement = snapshot.query.mekMovementPsr();
        const torsoCheck = preview.state.ruleChecks.get(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
        const ruleCheck = torsoCheck?.status === 'pending'
            ? Object.freeze({
                eventId: `rule-check:${torsoCheck.token}`,
                token: torsoCheck.token,
                targetNumber: movement.kind === 'supported'
                    ? movement.pilotingTargetNumber
                    : 7,
            } satisfies StagedMekRuleCheck)
            : null;
        const hadAutomaticFall = preview.state.movementPsr.automaticFalls.length > 0;
        const crewPositions = [...snapshot.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        const recoveryMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
        const recoveries = recoveryMode === 'no' ? [] : crewPositions.flatMap(position => {
            const state = snapshot.query.crewState(position.id);
            const target = mekConsciousnessTarget(state.wounds);
            const readyTurn = state.recoveryReadyTurn;
            if (!state.unconscious || state.ejected || target === undefined
                || readyTurn === null
                || readyTurn !== undefined && readyTurn > snapshot.state.turn.turnCounter) return [];
            const eventId = `consciousness:${snapshot.instanceId}:${snapshot.query.stateRevision}:${position.id}`;
            return [Object.freeze({
                eventId,
                positionId: position.id,
                targetNumber: target,
                event: Object.freeze({
                    id: eventId,
                    subject: this.subject(snapshot),
                    event: 'Consciousness Recovery',
                    description: `Target ${target}+.`,
                    effects: Object.freeze(['Success: pilot regains consciousness']),
                } satisfies AutomationReviewEvent),
            } satisfies StagedMekConsciousnessRecovery)];
        });
        return Object.freeze({
            snapshot,
            command,
            checks,
            ruleCheck,
            hadAutomaticFall,
            recoveries: Object.freeze(recoveries),
        });
    }

    private resolvedPilotCheck(
        check: StagedMekPilotCheck,
        resolution: AutomationCheckResolution,
    ): PreparedMekPilotCheck {
        const dice = automationCheckEvidenceDice(resolution, check.targetNumber);
        return Object.freeze({
            ...check,
            dice,
            total: twoD6Total(dice),
            failed: resolution.outcome === 'failed',
            automaticFailure: resolution.automatic && resolution.outcome === 'failed',
        });
    }

    private resolvedRuleCheck(
        check: StagedMekRuleCheck,
        resolution: AutomationCheckResolution,
    ): PreparedMekRuleCheck {
        const dice = automationCheckEvidenceDice(resolution, check.targetNumber);
        return Object.freeze({
            ...check,
            dice,
            total: twoD6Total(dice),
            outcome: resolution.outcome,
        });
    }

    private skippedPilotCheck(check: StagedMekPilotCheck): PreparedMekPilotCheck {
        return Object.freeze({ ...check, dice: [1, 1] as const, total: 2, failed: false });
    }

    private skippedRuleCheck(check: StagedMekRuleCheck): PreparedMekRuleCheck {
        return Object.freeze({ ...check, dice: [1, 1] as const, total: 2, outcome: 'success' });
    }

    private async applyPhaseBoundary(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedMekPhaseBoundary,
        dispatch: DirectMekAutomationDispatch,
        resumedFallEventId?: string,
    ): Promise<boolean> {
        const opening = this.snapshot(force, instanceId);
        if (!opening) return false;
        if (prepared.needsSettlement && opening.query.hasPendingCombat()) {
            const committed = await dispatch({
                type: 'commit-pending',
            }, false);
            if (!committed.accepted) return false;
        }
        // Recovery is an end-phase check that resolves before PSRs and their
        // consequences. A recovered pilot must be conscious for a later fall.
        if (!await this.applyPhaseRecoveries(
            force,
            instanceId,
            opening,
            prepared.recoveries,
            dispatch,
        )) return false;
        if (prepared.ruleCheck
            && prepared.acceptedCheckIds.has(prepared.ruleCheck.eventId)) {
            const result = await dispatch({
                type: 'resolve-mek-rule-check',
                key: MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
                token: prepared.ruleCheck.token,
                outcome: prepared.ruleCheck.outcome,
            }, false);
            if (!result.accepted) return false;
            if (this.options.cbtAutomationMode('pilotSkillCheck') === 'yes') {
                this.toast(
                    opening,
                    `Crippling Destruction Check: ${prepared.ruleCheck.outcome === 'success' ? 'PASSED' : 'FAILED'} (${prepared.ruleCheck.total} vs ${prepared.ruleCheck.targetNumber}+)`,
                    prepared.ruleCheck.outcome === 'success' ? 'success' : 'error',
                );
            }
        }
        const dismissed = prepared.checks
            .filter(check => !prepared.acceptedCheckIds.has(check.checkId)
                || check.automaticFailure)
            .map(check => check.checkId);
        if (dismissed.length > 0) {
            const result = await dispatch({
                type: 'dismiss-mek-pilot-checks',
                checkIds: dismissed,
            }, false);
            if (!result.accepted) return false;
        }
        for (const check of prepared.checks.filter(row =>
            prepared.acceptedCheckIds.has(row.checkId) && !row.automaticFailure)) {
            const result = await dispatch({
                type: 'resolve-mek-pilot-check',
                checkId: check.checkId,
                evidence: { dice: check.dice },
            }, false);
            if (!result.accepted) return false;
            if (this.options.cbtAutomationMode('pilotSkillCheck') === 'yes') {
                this.toast(
                    opening,
                    `Piloting Skill Check: ${check.failed ? 'FAILED' : 'PASSED'} (${check.total} vs ${check.targetNumber}+) — ${check.reason}`,
                    check.failed ? 'error' : 'success',
                );
            }
        }
        for (const check of prepared.checks.filter(row => row.automaticFailure)) {
            if (this.options.cbtAutomationMode('pilotSkillCheck') === 'yes') {
                this.toast(
                    opening,
                    `Piloting Skill Check: FAILED (automatic) — ${check.reason}`,
                    'error',
                );
            }
        }
        if (prepared.fall) {
            // A manual failed roll makes the reducer prone itself. Automatic
            // failures and rules-level automatic falls have no dice command,
            // so establish the same state before resolving (or skipping) damage.
            const prone = await dispatch({
                type: 'set-condition', condition: 'prone', active: true,
            }, false);
            if (!prone.accepted) return false;
            if (prepared.fall.accepted && prepared.fall.eventId !== resumedFallEventId
                && !await this.applyPreparedFall(
                    force,
                    instanceId,
                    prepared.fall,
                    dispatch,
                )) return false;
        }
        if (prepared.hadAutomaticFall) {
            const result = await dispatch({
                type: 'dismiss-mek-automatic-falls',
            }, false);
            if (!result.accepted) return false;
        }
        return true;
    }

    private async applyPhaseRecoveries(
        force: CBTForce,
        instanceId: string,
        opening: MekSnapshot,
        recoveries: readonly PreparedMekConsciousnessRecovery[],
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'yes') {
            const notification = automaticConsciousnessRecoveryNotification(
                recoveries.filter(recovery => recovery.accepted).map(recovery => ({
                    id: recovery.positionId,
                    targetNumber: recovery.targetNumber,
                    total: recovery.total,
                    recovered: recovery.recovered,
                })),
                id => {
                    const positionId = id as CrewPositionId;
                    const occurrence = opening.index.crewPositions.get(positionId)?.occurrence ?? 0;
                    const assignment = opening.crewAssignment.positions.find(position =>
                        position.positionId === positionId);
                    return assignment?.name.trim() || `Crew ${occurrence + 1}`;
                },
            );
            if (notification) this.toast(opening, notification.message, notification.type);
        }
        for (const recovery of recoveries) {
            if (!recovery.accepted) continue;
            if (!recovery.recovered) {
                if (!await this.deferCrewRecovery(
                    force,
                    instanceId,
                    recovery.positionId,
                    opening.state.turn.turnCounter,
                    dispatch,
                )) return false;
                continue;
            }
            const snapshot = this.snapshot(force, instanceId);
            const state = snapshot?.query.crewState(recovery.positionId);
            if (!snapshot || !state || state.ejected || !state.unconscious) continue;
            const result = await dispatch({
                type: 'set-crew-state',
                positionId: recovery.positionId,
                wounds: state.wounds,
                unconscious: false,
                ejected: false,
            }, false);
            if (!result.accepted) return false;
        }
        return true;
    }

    private async resolveCriticalChance(
        force: CBTForce,
        instanceId: string,
        sourceLocationId: LocationId,
        target: 'committed' | 'pending',
        context: DirectCriticalChanceContext,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<void> {
        // Match origin/next's queue boundary: disabling critical automation
        // prevents rules-generated chances from becoming pending work at all.
        // A chance that was already persisted is still manually resumable via
        // resumePendingCriticalChance (for example after changing the option).
        if (this.options.cbtAutomationMode('criticalHitChanceCheck') === 'no') return;
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        let locationId = sourceLocationId;
        let floatingDescription: string | undefined;
        if (this.options.options().CBTOptionalRules.floatingCriticals && context.floatingHitArc) {
            const floating = this.rollHitLocation(snapshot, context.floatingHitArc);
            const location = [...snapshot.index.locations.values()].find(row => row.code === floating.location);
            if (location) {
                locationId = location.id;
                floatingDescription = `Floating critical moved to ${floating.locationLabel}.`;
            }
        }
        const profile = snapshot.query.mekCriticalChance(locationId, target);
        if (context.locationDestroyed
            && explosiveCriticalRolls(snapshot, locationId, target).length === 0) return;
        const modifiers: MekCriticalChanceModifier[] = profile.modifiers.flatMap(row => {
            if (row.label !== 'Hardened armor in damaged facing') return [row];
            if (context.hardenedArmorApplies === false) return [];
            return context.hardenedArmorApplies === true
                ? [Object.freeze({ label: row.label, value: row.value })]
                : [row];
        });
        if (snapshot.ruleset === 'core-2026' && context.explosionProtection === 'case-ii') {
            modifiers.push(Object.freeze({ label: 'CASE II internal explosion', value: -1 }));
        }
        const dice = roll2D6();
        const modifier = modifiers.reduce((total, row) =>
            total + (!row.optional || row.enabled ? row.value : 0), 0);
        const total = Math.min(profile.industrialMek ? 14 : 12, twoD6Total(dice) + modifier);
        const outcome = resolveMekCriticalChance(total, profile.canBlowOff, profile.industrialMek);
        const caseIIChecks = snapshot.ruleset === 'total-warfare'
            && context.explosionProtection === 'case-ii'
            && outcome.kind === 'critical-hits'
            ? Array.from({ length: outcome.count }, () => {
                const checkDice = roll2D6();
                const checkTotal = twoD6Total(checkDice);
                return Object.freeze({ dice: checkDice, total: checkTotal, discarded: checkTotal >= 8 });
            })
            : [];
        const pending: MekPendingCriticalChanceV2 = Object.freeze({
            type: 'critical-chance',
            eventId: `critical:${instanceId}:${snapshot.query.stateRevision}:${locationId}`,
            locationId,
            target,
            ...(context.locationDestroyed ? { locationDestroyed: true as const } : {}),
            roll: dice,
            modifier,
            total,
            result: criticalChanceResult(outcome),
            breakdown: Object.freeze(modifiers
                .filter(row => !row.optional || row.enabled)
                .map(row => Object.freeze({ label: row.label, value: row.value }))),
            effects: Object.freeze([
                floatingDescription,
                context.locationDestroyed
                    ? 'Destroyed location: only critical slots that would explode can be hit.'
                    : undefined,
                describeCriticalChance(outcome),
                ...caseIIChecks.map((check, index) =>
                    `CASE II check ${index + 1}: ${check.total} vs 8+ — ${check.discarded ? 'critical discarded' : 'critical applies'}`),
            ].filter((row): row is string => row !== undefined)),
            caseIIDiscards: Object.freeze(outcome.kind === 'critical-hits'
                ? Array.from(
                    { length: outcome.count },
                    (_, index) => caseIIChecks[index]?.discarded ?? false,
                )
                : []),
        });
        if (!await this.appendPendingCriticalEvent(force, instanceId, pending, dispatch)) return;
        await this.resumePendingCriticalEvents(force, instanceId, dispatch, interactive);
    }

    /** Resumes the ordered durable critical chain advertised by the unit badge. */
    async resumePendingAutomation(
        force: CBTForce,
        instanceId: string,
        dispatch: DirectMekAutomationDispatch,
        interactive = true,
    ): Promise<boolean> {
        return this.resumePendingCriticalEvents(force, instanceId, dispatch, interactive);
    }

    /** Resumes durable fall consequences before lower-priority badge work. */
    async resumePendingFallAutomation(
        force: CBTForce,
        instanceId: string,
        dispatch: DirectMekAutomationDispatch,
        interactive = true,
    ): Promise<boolean> {
        return (await this.resumePendingFallConsequences(
            force,
            instanceId,
            dispatch,
            interactive,
        )) !== false;
    }

    private async resumePendingCriticalEvents(
        force: CBTForce,
        instanceId: string,
        dispatch: DirectMekAutomationDispatch,
        interactive: boolean,
    ): Promise<boolean> {
        let active = this.resolvingCriticalEvents.get(force);
        if (!active) {
            active = new Map<string, boolean>();
            this.resolvingCriticalEvents.set(force, active);
        }
        if (active.has(instanceId)) return true;
        active.set(instanceId, interactive);
        try {
            while (true) {
                const pending = this.snapshot(force, instanceId)
                    ?.state.turn.pendingCriticalEvents?.[0];
                if (!pending) return true;
                const advanced = pending.type === 'critical-chance'
                    ? await this.resumePendingCriticalChance(
                        force, instanceId, pending, dispatch, interactive,
                    )
                    : await this.resumePendingCriticalHit(
                        force, instanceId, pending, dispatch, interactive,
                    );
                if (!advanced) return false;
            }
        } finally {
            active.delete(instanceId);
            if (active.size === 0) this.resolvingCriticalEvents.delete(force);
        }
    }

    private async resumePendingCriticalChance(
        force: CBTForce,
        instanceId: string,
        pending: MekPendingCriticalChanceV2,
        dispatch: DirectMekAutomationDispatch,
        interactive: boolean,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const event: AutomationReviewEvent = Object.freeze({
            id: pending.eventId,
            subject: this.subject(snapshot),
            event: 'Critical Hit Chance',
            description: `Rolled ${twoD6Total(pending.roll)}`
                + `${pending.modifier === 0 ? '' : ` ${pending.modifier > 0 ? '+' : '−'} ${Math.abs(pending.modifier)}`}`
                + ` = ${pending.total}.`,
            breakdown: Object.freeze(pending.breakdown.map((row, index) => Object.freeze({
                id: String(index), label: row.label, value: row.value,
            }))),
            effects: pending.effects,
        });
        const accepted = await this.automation.resolve(
            'criticalHitChanceCheck',
            [event],
            {
                title: 'Review Critical Hit Chance',
                interactive,
                // origin/next treats "no" as the manual critical workflow,
                // never as permission to throw the queued chance away.
                manualResolution: this.options.cbtAutomationMode(
                    'criticalHitChanceCheck',
                ) === 'no',
            },
        );
        if (accepted === null) return false;
        if (!accepted.has(event.id) || pending.result === 'none') {
            return this.discardPendingCriticalEvent(force, instanceId, pending.eventId, dispatch);
        }
        if (pending.result === 'blown-off') {
            const result = await dispatch({
                type: 'apply-mek-blow-off',
                locationId: pending.locationId,
                target: pending.target,
            }, false);
            return result.accepted
                && this.discardPendingCriticalEvent(force, instanceId, pending.eventId, dispatch);
        }
        const hit: MekPendingCriticalHitV2 = Object.freeze({
            type: 'critical-hit',
            eventId: pending.eventId,
            locationId: pending.locationId,
            target: pending.target,
            ...(pending.locationDestroyed ? { locationDestroyed: true as const } : {}),
            remainingHits: pending.result,
            caseIIDiscards: pending.caseIIDiscards,
        });
        return this.replacePendingCriticalEvent(force, instanceId, hit, dispatch);
    }

    private async resumePendingCriticalHit(
        force: CBTForce,
        instanceId: string,
        pending: MekPendingCriticalHitV2,
        dispatch: DirectMekAutomationDispatch,
        interactive: boolean,
    ): Promise<boolean> {
        if (pending.caseIIDiscards[0]) {
            return this.consumePendingCriticalHit(force, instanceId, pending, dispatch);
        }
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const rollProfile = snapshot.query.mekCriticalRollProfile(pending.locationId, pending.target);
        if (rollProfile.validRolls.length === 0) {
            return this.consumePendingCriticalHit(force, instanceId, pending, dispatch);
        }
        let results = pending.roll;
        if (!results) {
            results = pending.locationDestroyed
                ? Object.freeze(Array.from({ length: rollProfile.diceCount }, () => randomD6()))
                : rollProfile.validRolls[randomIndex(rollProfile.validRolls.length)]!;
            if (!await this.replacePendingCriticalEvent(
                force,
                instanceId,
                Object.freeze({ ...pending, roll: Object.freeze([...results]) }),
                dispatch,
            )) return false;
            snapshot = this.snapshot(force, instanceId);
            if (!snapshot) return false;
        }
        if (pending.locationDestroyed) {
            const plan = snapshot.query.mekCriticalRoll(pending.locationId, results, pending.target);
            if (plan.kind !== 'applied' || (!plan.explosion && !plan.pendingExplosion)) {
                return this.consumePendingCriticalHit(force, instanceId, {
                    ...pending,
                    roll: results,
                }, dispatch);
            }
        }
        const plan = snapshot.query.mekCriticalRoll(pending.locationId, results, pending.target);
        if (plan.kind !== 'applied') {
            return this.consumePendingCriticalHit(force, instanceId, {
                ...pending,
                roll: results,
            }, dispatch);
        }
        const targetLabel = getMekLocationLabel(plan.targetLocationCode)
            ?? plan.targetLocationCode;
        const event: AutomationReviewEvent = Object.freeze({
            id: `${pending.eventId}:hit:${pending.remainingHits}`,
            subject: this.subject(snapshot),
            event: 'Critical Hit',
            description: `${targetLabel} · roll ${results.join(', ')} · slot ${plan.slotNumber}: ${plan.equipment}`,
            effects: Object.freeze([
                plan.armoredAbsorption
                    ? 'Component armor absorbs the critical hit'
                    : 'Critical slot is destroyed',
                plan.explosion
                    ? `${plan.explosion.equipment} explodes for ${plan.explosion.rawDamage} damage`
                    : undefined,
                plan.pendingExplosion
                    ? `${plan.pendingExplosion.equipment} explosion is pending until phase end`
                    : undefined,
            ].filter((effect): effect is string => effect !== undefined)),
        });
        const accepted = await this.automation.resolve(
            'criticalHitChanceCheck',
            [event],
            {
                title: 'Review Critical Hit',
                interactive,
                manualResolution: this.options.cbtAutomationMode(
                    'criticalHitChanceCheck',
                ) === 'no',
            },
        );
        // Closing retains both the cursor and its exact dice. Skipping consumes
        // only this hit so a multi-hit sequence can continue in order.
        if (accepted === null) return false;
        if (!accepted.has(event.id)) {
            return this.consumePendingCriticalHit(force, instanceId, {
                ...pending,
                roll: results,
            }, dispatch);
        }
        const result = await dispatch({
            type: 'apply-mek-critical-roll',
            locationId: pending.locationId,
            results,
            target: pending.target,
        }, true);
        if (!result.accepted || !result.changed) return false;
        return this.consumePendingCriticalHit(force, instanceId, {
            ...pending,
            roll: results,
        }, dispatch);
    }

    private async appendPendingCriticalEvent(
        force: CBTForce,
        instanceId: string,
        event: MekPendingCriticalEventV2,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const current = this.snapshot(force, instanceId)?.state.turn.pendingCriticalEvents ?? [];
        if (current.some(candidate => candidate.eventId === event.eventId)) return true;
        return this.replacePendingCriticalEvents(force, instanceId, [...current, event], dispatch);
    }

    private async replacePendingCriticalEvent(
        force: CBTForce,
        instanceId: string,
        event: MekPendingCriticalEventV2,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const current = this.snapshot(force, instanceId)?.state.turn.pendingCriticalEvents ?? [];
        const index = current.findIndex(candidate => candidate.eventId === event.eventId);
        if (index < 0) return false;
        const next = [...current];
        next[index] = event;
        return this.replacePendingCriticalEvents(force, instanceId, next, dispatch);
    }

    private async consumePendingCriticalHit(
        force: CBTForce,
        instanceId: string,
        pending: MekPendingCriticalHitV2,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        if (pending.remainingHits <= 1) {
            return this.discardPendingCriticalEvent(force, instanceId, pending.eventId, dispatch);
        }
        return this.replacePendingCriticalEvent(force, instanceId, Object.freeze({
            ...pending,
            remainingHits: pending.remainingHits - 1,
            caseIIDiscards: Object.freeze(pending.caseIIDiscards.slice(1)),
            roll: undefined,
        }), dispatch);
    }

    private async discardPendingCriticalEvent(
        force: CBTForce,
        instanceId: string,
        eventId: string,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const current = this.snapshot(force, instanceId)?.state.turn.pendingCriticalEvents ?? [];
        return this.replacePendingCriticalEvents(
            force,
            instanceId,
            current.filter(event => event.eventId !== eventId),
            dispatch,
        );
    }

    private async replacePendingCriticalEvents(
        force: CBTForce,
        instanceId: string,
        events: readonly MekPendingCriticalEventV2[],
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const { pendingCriticalEvents: _discarded, ...baseTurn } = snapshot.state.turn;
        const result = await dispatch({
            type: 'replace-turn-state',
            turn: events.length === 0
                ? baseTurn
                : Object.freeze({
                    ...baseTurn,
                    pendingCriticalEvents: Object.freeze(events),
                }),
        }, false);
        return result.accepted;
    }

    private async resolveBreachOrFlood(
        force: CBTForce,
        instanceId: string,
        command: Readonly<{
            faceId: Extract<CBTUnitCommand, { readonly type: 'damage-armor' }>['faceId'];
            target: Extract<CBTUnitCommand, { readonly type: 'damage-armor' }>['target'];
        }>,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        const face = snapshot?.index.armorFaces.get(command.faceId);
        if (!snapshot || !face) return;
        await this.resolveBreachOrFloodLocation(
            force,
            instanceId,
            face.locationId,
            command.target,
            dispatch,
        );
    }

    private async resolveBreachOrFloodLocation(
        force: CBTForce,
        instanceId: string,
        locationId: LocationId,
        target: 'committed' | 'pending',
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        // Disabled breach automation must not even consume a hidden dice roll;
        // origin/next leaves the whole check to the tabletop workflow.
        if (this.options.cbtAutomationMode('breachAndFloodCheck') === 'no') return;
        const snapshot = this.snapshot(force, instanceId);
        const location = snapshot?.index.locations.get(locationId);
        if (!snapshot || !location || !this.locationUnderwater(snapshot, location.code)) return;
        const perspective = target === 'pending' ? 'preview' as const : 'committed' as const;
        if (snapshot.query.locationCondition(location.id, 'flooded', perspective) > 0
            || snapshot.query.locationCondition(location.id, 'blown-off', perspective) > 0) return;
        const remainingByFacing = location.armorFaceIds.map(faceId =>
            snapshot.query.remainingArmor(faceId, perspective));
        const armorDepleted = remainingByFacing.length === 0
            || remainingByFacing.some(remaining => remaining === 0);
        const rules = gameRulesFor(snapshot.ruleset);
        const dice = armorDepleted ? null : roll2D6();
        const total = dice ? twoD6Total(dice) : null;
        const breached = total !== null && rules.hullBreachCheckSucceeds(total);
        const event: AutomationReviewEvent = Object.freeze({
            id: `breach:${instanceId}:${snapshot.query.stateRevision}:${location.id}`,
            subject: this.subject(snapshot),
            event: armorDepleted ? 'Flood Location' : 'Hull Breach Check',
            description: armorDepleted
                ? `${getMekLocationLabel(location.code) ?? location.code} armor is depleted underwater.`
                : `Rolled ${total} (${rules.getHullBreachCheckRangeLabel()} breaches).`,
            effects: Object.freeze([
                armorDepleted || breached ? 'Location floods' : 'Hull remains intact',
            ]),
        });
        const accepted = await this.automation.resolve(
            'breachAndFloodCheck',
            [event],
            { title: 'Review Breach and Flooding' },
        );
        if (!accepted?.has(event.id) || (!armorDepleted && !breached)) return;
        await dispatch({
            type: 'set-location-condition',
            locationId: location.id,
            condition: 'flooded',
            value: 1,
            target,
        }, false);
    }

    private async resolveExplosionConsequences(
        force: CBTForce,
        instanceId: string,
        before: MekSnapshot,
        plan: Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>,
        target: 'committed' | 'pending',
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<void> {
        const after = this.snapshot(force, instanceId);
        if (!after) return;
        const perspective = target === 'pending' ? 'preview' as const : 'committed' as const;
        const armorDamagedLocations = new Set<LocationId>();
        for (const face of before.index.armorFaces.values()) {
            if (before.query.remainingArmor(face.id, perspective)
                <= after.query.remainingArmor(face.id, perspective)) continue;
            armorDamagedLocations.add(face.locationId);
        }
        for (const locationId of armorDamagedLocations) {
            await this.resolveBreachOrFloodLocation(force, instanceId, locationId, target, dispatch);
        }

        const internalDamageLocations = [...before.index.locations.values()].filter(location =>
            before.query.remainingInternal(location.id, perspective)
                > after.query.remainingInternal(location.id, perspective));
        for (const location of internalDamageLocations) {
            const planned = plan.explosion?.locations.find(candidate =>
                candidate.locationId === location.id);
            const directHitSlot = location.id === plan.targetLocationId
                ? before.index.slots.get(plan.slotId)
                : undefined;
            const protection = planned?.protection ?? mekExplosionProtection(
                before.index,
                before.ruleset,
                before.query,
                location.id,
                target,
                directHitSlot,
            );
            await this.resolveCriticalChance(
                force,
                instanceId,
                location.id,
                target,
                {
                    explosionProtection: protection,
                    locationDestroyed: after.query.remainingInternal(
                        location.id,
                        perspective,
                    ) === 0,
                },
                dispatch,
                interactive,
            );
            if (!armorDamagedLocations.has(location.id)) {
                await this.resolveBreachOrFloodLocation(
                    force, instanceId, location.id, target, dispatch,
                );
            }
        }
    }

    private async resolveMekEndTurnDecisions(
        decisions: readonly MekEndTurnDecision[],
        interactive?: boolean,
    ): Promise<readonly PreparedDirectMekEndTurnAutomation[] | null> {
        const checks = orderedAutomationChecks(decisions.flatMap(decision => {
            if (!decision.snapshot || !decision.staged || !decision.applyEffects) return [];
            const staged = decision.staged;
            const rows: AutomationCheck[] = staged.checks.map(row => Object.freeze({
                id: row.id,
                subject: this.subject(decision.snapshot!),
                ...cbtUnitCheckPresentation(row.check.kind, {
                    targetNumber: row.check.target,
                    heat: staged.heat,
                }),
                ...(row.check.target === undefined ? {} : { targetNumber: row.check.target }),
                ...(row.check.automaticOutcome === undefined
                    ? {}
                    : { automaticOutcome: row.check.automaticOutcome }),
                ...(row.check.kind !== 'ammo-explosion'
                    ? {}
                    : {
                        failureChoices: Object.freeze(staged.ammoCandidates.map(candidate => Object.freeze({
                            id: candidate.componentId,
                            label: `${candidate.equipment}${candidate.location ? ` · ${candidate.location}` : ''}`,
                            detail: `${candidate.damagePerShot}/shot · ${candidate.shots} shots`,
                        }))),
                    }),
            }));
            return rows;
        }));
        const resolutions = await this.automationChecks.resolve(
            'heatEffectsCheck',
            checks,
            { title: 'Resolve Pending Checks', interactive },
        );
        if (resolutions === null) return null;
        const resolutionById = new Map(resolutions.map(result => [result.id, result]));
        return Object.freeze(decisions.map(decision => {
            let staged: ResolvedMekHeatEffects | null = null;
            if (decision.staged !== null) {
                const ammoCheck = decision.staged.checks.find(row => row.check.kind === 'ammo-explosion');
                const selectedAmmoId = ammoCheck
                    ? resolutionById.get(ammoCheck.id)?.selectionId
                    : undefined;
                const fallbackAmmoId = decision.staged.ammoCandidates.length === 1
                    ? decision.staged.ammoCandidates[0]!.componentId
                    : undefined;
                staged = Object.freeze({
                    ...decision.staged,
                    checks: Object.freeze(decision.staged.checks.map(row => {
                        const resolution = resolutionById.get(row.id);
                        return resolution
                            ? Object.freeze({
                                ...row,
                                total: resolution.dice === null
                                    ? null
                                    : twoD6Total(resolution.dice),
                                outcome: resolution.outcome,
                            })
                            : Object.freeze({
                                ...row,
                                total: null,
                                outcome: row.check.automaticOutcome ?? 'success',
                            });
                    })),
                    ...(selectedAmmoId ?? fallbackAmmoId
                        ? { ammoComponentId: (selectedAmmoId ?? fallbackAmmoId)! as ComponentId }
                        : {}),
                });
            }
            return this.preparedMekEndTurn(
                decision.request,
                decision.heatAccepted,
                staged,
                decision.applyEffects,
                decision.applyPilotHits,
                interactive === true,
            );
        }));
    }

    private preparedMekEndTurn(
        request: DirectMekEndTurnAutomationRequest,
        heatAccepted: boolean,
        staged: ResolvedMekHeatEffects | null,
        applyEffects: boolean,
        applyPilotHits: boolean,
        interactive: boolean,
    ): PreparedDirectMekEndTurnAutomation {
        return Object.freeze({
            instanceId: request.instanceId,
            prepared: Object.freeze({
                command: Object.freeze({
                    ...request.command,
                    policy: heatAccepted ? 'automatic' as const : 'manual' as const,
                }),
                deferredPilotHits: 0,
                ...(staged === null ? {} : {
                    heatEffects: Object.freeze({
                        staged,
                        applyEffects,
                        applyPilotHits,
                        interactive,
                    }),
                }),
            }),
        });
    }

    private combinedHeatEventId(request: DirectMekEndTurnAutomationRequest): string {
        return `end-turn-heat:${request.instanceId}`;
    }

    private pilotHitEventId(request: DirectMekEndTurnAutomationRequest): string {
        return `pilot-hits:${request.instanceId}`;
    }

    private stageMekHeatEffects(
        snapshot: MekSnapshot,
        heat: number,
    ): StagedMekHeatEffects {
        const revision = snapshot.query.stateRevision;
        const ammoCandidates = this.preferredExplosiveAmmoCandidates(snapshot);
        const pilot = this.activePilot(snapshot);
        const checks = mekHeatAutomationChecks({
            heat,
            shutdown: snapshot.query.hasCondition('shutdown'),
            consciousPilot: pilot !== null,
            hasExplosiveAmmo: ammoCandidates.length > 0,
        }).map((check, index): StagedMekHeatCheck => Object.freeze({
            id: `heat-effect:${snapshot.instanceId}:${revision}:${index}`,
            check,
        }));
        const lifeSupport = projectMekLifeSupportPilotDamage(
            snapshot.entity,
            snapshot.index,
            snapshot.ruleset,
            snapshot.query,
            heat,
        );
        return Object.freeze({
            id: `heat-effects:${snapshot.instanceId}:${revision}`,
            heat,
            checks: Object.freeze(checks),
            heatLifeHits: lifeSupport.heatHits,
            drowningHits: lifeSupport.oxygenHits,
            ammoCandidates,
        });
    }

    private reviewableMekHeatEffectDescriptions(
        staged: StagedMekHeatEffects,
    ): readonly string[] {
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
        return Object.freeze([
            ...staged.checks.map(row => cbtUnitCheckReviewDescription(row.check.kind, {
                targetNumber: row.check.target,
                heat: staged.heat,
            })),
            ...(pilotHitsMode === 'no' ? [] : lifeSupportReviewDescriptions(staged)),
        ]);
    }

    private async applyMekHeatEffects(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedMekHeatEffects,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        if (!prepared.applyEffects) return true;
        for (const row of prepared.staged.checks) {
            let appliedEffect: string | undefined;
            if (row.check.kind === 'shutdown' && row.outcome === 'failed') {
                const wasShutdown = snapshot.query.hasCondition('shutdown');
                if (!wasShutdown && snapshot.ruleset === 'total-warfare'
                    && !await this.resolveShutdownFall(
                        force,
                        instanceId,
                        dispatch,
                        prepared.interactive,
                    )) {
                    return false;
                }
                const result = await dispatch({
                    type: 'set-mek-shutdown-state', shutdown: true,
                }, false);
                if (!result.accepted) return false;
            } else if (row.check.kind === 'startup' && row.outcome === 'success') {
                const result = await dispatch({
                    type: 'set-mek-shutdown-state', shutdown: false,
                }, false);
                if (!result.accepted) return false;
            } else if (row.check.kind === 'ammo-explosion' && row.outcome === 'failed'
                && prepared.staged.ammoComponentId) {
                const explosion = await this.explodeAmmo(
                    force,
                    instanceId,
                    prepared.staged.ammoComponentId,
                    dispatch,
                    prepared.interactive,
                );
                if (explosion === null) return false;
                appliedEffect = explosion;
            }
            snapshot = this.snapshot(force, instanceId) ?? snapshot;
            if (this.options.cbtAutomationMode('heatEffectsCheck') === 'yes') {
                this.toast(
                    snapshot,
                    cbtUnitCheckAutomaticMessage(row.check.kind, {
                        outcome: row.outcome,
                        total: row.total,
                        targetNumber: row.check.target,
                        ...(appliedEffect === undefined ? {} : { effect: appliedEffect }),
                    }),
                    row.outcome === 'success' ? 'success' : 'error',
                );
            }
        }
        if (prepared.applyPilotHits && mekLifeSupportHits(prepared.staged) > 0) {
            const applied = await this.applyLifeSupportHits(
                force,
                instanceId,
                prepared.staged,
                dispatch,
                prepared.interactive,
            );
            if (applied === null) return false;
            const settled = this.snapshot(force, instanceId);
            if (settled
                && this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'yes') {
                for (const damage of applied) {
                    this.toast(
                        settled,
                        cbtUnitCheckAutomaticMessage(damage.kind, {
                            outcome: 'failed',
                            total: null,
                        }, { hits: damage.hits }),
                        'error',
                    );
                }
            }
        }
        return true;
    }

    private async resolveShutdownFall(
        force: CBTForce,
        instanceId: string,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        const movement = snapshot?.query.mekMovementPsr();
        if (!snapshot) return false;
        if (movement?.kind !== 'supported' || snapshot.query.hasCondition('prone')) return true;
        const check: AutomationCheck = Object.freeze({
            id: `shutdown-psr:${instanceId}:${snapshot.query.stateRevision}`,
            subject: this.subject(snapshot),
            label: 'Piloting Skill Check',
            description: 'Involuntary shutdown.',
            failureOutcome: 'Fall',
            targetNumber: movement.pilotingTargetNumber,
        });
        const resolutions = await this.automationChecks.resolve(
            'pilotSkillCheck',
            [check],
            { title: 'Piloting Skill Rolls', interactive },
        );
        if (resolutions === null) return false;
        const resolution = resolutions[0];
        if (!resolution) return true;
        if (this.options.cbtAutomationMode('pilotSkillCheck') === 'yes') {
            const total = resolution.dice ? twoD6Total(resolution.dice) : null;
            this.toast(
                snapshot,
                `Piloting Skill Check: ${resolution.outcome === 'success' ? 'PASSED' : 'FAILED'}`
                    + `${total === null ? ' (automatic)' : ` (${total} vs ${movement.pilotingTargetNumber}+)`}`
                    + ' — Involuntary shutdown',
                resolution.outcome === 'success' ? 'success' : 'error',
            );
        }
        if (resolution.outcome !== 'failed') return true;
        const fall = await this.prepareFall(
            snapshot,
            'Involuntary shutdown',
            true,
            true,
            interactive,
        );
        if (fall === null) return false;
        const prone = await dispatch({
            type: 'set-condition', condition: 'prone', active: true,
        }, false);
        if (!prone.accepted) return false;
        if (!fall.accepted) return true;
        return this.applyPreparedFall(force, instanceId, fall, dispatch);
    }

    private async prepareFall(
        snapshot: MekSnapshot,
        reason: string,
        allowCancel: boolean,
        forceSeatbeltFailure = false,
        interactive = false,
    ): Promise<PreparedMekFall | null> {
        const waterDepth = coverWaterDepth(snapshot.query.turnState().cover);
        const table = hitLocationTable(snapshot);
        const eventId = `fall:${snapshot.instanceId}:${snapshot.query.stateRevision}`;
        const result = await this.fallingAutomation.resolve(Object.freeze({
            unitName: this.subject(snapshot),
            sourceMessage: /stand|get.?up/i.test(reason)
                ? 'The stand-up attempt failed, so the Mek falls again.'
                : reason === 'Automatic fall'
                    ? 'The Mek falls automatically.'
                    : 'A failed Piloting Skill Roll caused the Mek to fall.',
            ruleset: snapshot.ruleset,
            tons: snapshot.entity.tonnage(),
            levelsFallen: 0,
            waterDepth,
            hitLocationTable: table,
            ...(snapshot.entity.armorLocations.some(location =>
                snapshot.entity.armorAt(location).type === 'IMPACT_RESISTANT')
                ? { armorNote: 'Impact-Resistant Armor is resolved against the armor in each struck location.' }
                : {}),
        }), { interactive });
        if (result === null || result.action === 'close') return null;
        const applyFall = result.action === 'accept';
        const damage = applyFall
            ? result.damage
            : resolveMekFallDamage(snapshot.ruleset, snapshot.entity.tonnage(), 0, waterDepth);
        const orientation = applyFall
            ? result.orientation
            : resolveMekFallOrientation(snapshot.ruleset, 1);
        const locations = applyFall
            ? result.groups.map(group => Object.freeze({ damage: group.damage, result: group }))
            : Object.freeze([]);
        const headHits = applyFall
            ? locations.filter(row => row.result.location === 'HD').length
            : 0;
        const reviewedPilotHits = headHits > 0
            ? await this.reviewPilotHits(
                snapshot,
                headHits,
                `${eventId}:head`,
                allowCancel,
            )
            : 0;
        if (reviewedPilotHits === null) return null;
        const seatbelts = applyFall
            ? this.prepareFallSeatbelts(snapshot)
            : Object.freeze([]);
        return Object.freeze({
            eventId,
            accepted: applyFall,
            ruleset: snapshot.ruleset,
            damage,
            orientation,
            locations: Object.freeze(locations),
            applyPilotHits: reviewedPilotHits > 0,
            forceSeatbeltFailure,
            interactive,
            seatbelts,
        });
    }

    private prepareFallSeatbelts(snapshot: MekSnapshot): PreparedMekFall['seatbelts'] {
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'no') {
            return Object.freeze([]);
        }
        return Object.freeze(this.crewPositions(snapshot).flatMap(position => {
            const state = snapshot.query.crewState(position.id);
            if (state.ejected || state.wounds >= MAX_CREW_WOUNDS) return [];
            return [Object.freeze({ positionId: position.id })];
        }));
    }

    private async applyPreparedFall(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedMekFall,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        let headHits = 0;
        for (const row of prepared.locations) {
            if (!row.result.location) continue;
            const applied = await this.applyFallDamageGroup(
                force,
                instanceId,
                row.result.location,
                row.result.rear,
                row.damage,
                prepared.orientation.hitArc,
                row.result.critical,
                dispatch,
                prepared.interactive,
            );
            if (row.result.location === 'HD' && applied) headHits += 1;
        }
        const settled = this.snapshot(force, instanceId);
        if (!settled) return false;
        const pending: MekPendingFallConsequencesV2 = Object.freeze({
            eventId: prepared.eventId,
            totalDamage: prepared.damage.totalDamage,
            hitArcLabel: prepared.orientation.hitArcLabel,
            applyPilotHits: prepared.applyPilotHits,
            forceSeatbeltFailure: prepared.forceSeatbeltFailure,
            seatbeltPositionIds: Object.freeze(prepared.seatbelts
                .map(row => row.positionId)
                .sort()),
            headHits,
            stage: 'head-hits',
        });
        if (!await this.setPendingFallConsequences(force, instanceId, pending, dispatch)) {
            return false;
        }
        return (await this.resumePendingFallConsequences(
            force,
            instanceId,
            dispatch,
            prepared.interactive,
        )) !== false;
    }

    /** Continues only the unapplied post-fall stage after CLOSE/reopen. */
    private async resumePendingFallConsequences(
        force: CBTForce,
        instanceId: string,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<string | null | false> {
        let snapshot = this.snapshot(force, instanceId);
        let pending = snapshot?.state.turn.pendingFallConsequences;
        if (!snapshot || !pending) return null;
        const headHits = pending.headHits;
        if (pending.stage === 'head-hits') {
            if (snapshot.ruleset === 'total-warfare'
                && pending.applyPilotHits
                && headHits > 0
                && !await this.applyPilotHits(
                    force,
                    instanceId,
                    headHits,
                    dispatch,
                    interactive,
                )) return false;
            pending = Object.freeze({ ...pending, stage: 'seatbelts' });
            if (!await this.setPendingFallConsequences(force, instanceId, pending, dispatch)) {
                return false;
            }
        }
        if (pending.stage === 'seatbelts') {
            const seatbeltFailures = await this.resolveFallSeatbelts(
                force,
                instanceId,
                pending.seatbeltPositionIds.map(positionId => ({ positionId })),
                pending.forceSeatbeltFailure,
                interactive,
            );
            if (seatbeltFailures === null) return false;
            pending = Object.freeze({
                ...pending,
                stage: 'crew-hits',
                seatbeltFailures: Object.freeze([...seatbeltFailures].sort()),
            });
            if (!await this.setPendingFallConsequences(force, instanceId, pending, dispatch)) {
                return false;
            }
        }
        const hitsByPosition = new Map<CrewPositionId, number>();
        snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        for (const position of this.crewPositions(snapshot)) {
            const hits = (snapshot.ruleset === 'core-2026' && pending.applyPilotHits ? headHits : 0)
                + (pending.seatbeltFailures?.includes(position.id) ? 1 : 0);
            if (hits > 0) hitsByPosition.set(position.id, hits);
        }
        if (!await this.applyCrewHitsByPosition(
            force,
            instanceId,
            hitsByPosition,
            dispatch,
            `fall:${instanceId}:${snapshot.query.stateRevision}`,
            interactive,
        )) return false;

        if (!await this.setPendingFallConsequences(force, instanceId, null, dispatch)) return false;
        const completed = this.snapshot(force, instanceId);
        if (completed && this.options.cbtAutomationMode('fallingCheck') === 'yes') {
            this.toast(
                completed,
                `Fall resolved: ${pending.totalDamage} damage from the ${pending.hitArcLabel.toLowerCase()} arc`,
                'error',
            );
        }
        if (completed && pending.applyPilotHits && headHits > 0
            && this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'yes') {
            this.toast(
                completed,
                `Falling head hit: ${headHits} pilot hit${headHits === 1 ? '' : 's'} applied`,
                'error',
            );
        }
        return pending.eventId;
    }

    private async setPendingFallConsequences(
        force: CBTForce,
        instanceId: string,
        pending: MekPendingFallConsequencesV2 | null,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const result = await dispatch({
            type: 'set-pending-fall-consequences', pending,
        }, false);
        return result.accepted;
    }

    private async resolveFallSeatbelts(
        force: CBTForce,
        instanceId: string,
        seatbelts: PreparedMekFall['seatbelts'],
        forceFailure: boolean,
        interactive = false,
    ): Promise<ReadonlySet<CrewPositionId> | null> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot || seatbelts.length === 0) return new Set<CrewPositionId>();
        const movement = snapshot.query.mekMovementPsr();
        const byCheckId = new Map<string, CrewPositionId>();
        const checks = seatbelts.flatMap(seatbelt => {
            const crew = snapshot.query.crewState(seatbelt.positionId);
            if (crew.ejected || crew.wounds >= MAX_CREW_WOUNDS) return [];
            const assignment = snapshot.crewAssignment.positions.find(position =>
                position.positionId === seatbelt.positionId);
            const targetNumber = (assignment?.piloting ?? 5)
                + (snapshot.ruleset === 'total-warfare' && movement.kind === 'supported'
                    ? movement.permanentPsrModifier
                    : 0);
            const automaticFailure = forceFailure
                || crew.unconscious
                || snapshot.query.hasCondition('shutdown')
                || movement.kind !== 'supported'
                || movement.immobile
                || targetNumber > 12;
            const id = `seatbelt:${instanceId}:${snapshot.query.stateRevision}:${seatbelt.positionId}`;
            byCheckId.set(id, seatbelt.positionId);
            return [Object.freeze({
                id,
                subject: this.subject(snapshot),
                ...cbtUnitCheckPresentation('seatbelt', {
                    targetNumber: automaticFailure ? undefined : targetNumber,
                }),
                ...(automaticFailure
                    ? { automaticOutcome: 'failed' as const }
                    : { targetNumber }),
            } satisfies AutomationCheck)];
        });
        const resolutions = await this.automationChecks.resolve(
            'pilotHitsAndConsciousnessCheck',
            checks,
            { title: 'Resolve Pending Checks', interactive },
        );
        if (resolutions === null) return null;
        return new Set(resolutions.flatMap(result => {
            const positionId = byCheckId.get(result.id);
            return result.outcome === 'failed' && positionId !== undefined ? [positionId] : [];
        }));
    }

    private async applyFallDamageGroup(
        force: CBTForce,
        instanceId: string,
        sourceCode: string,
        rearArc: boolean,
        incomingDamage: number,
        hitArc: MekHitArcV2,
        throughArmorCritical: boolean,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<boolean> {
        let damage = incomingDamage;
        let code: string | null = sourceCode;
        let applied = false;
        let groupDamaged = false;
        let sharedCompositePip = false;
        const initial = this.snapshot(force, instanceId);
        if (!initial) return false;
        const topology = getTopologyFor([...initial.index.locations.values()].map(location => location.code));
        const initialLocation = [...initial.index.locations.values()].find(row => row.code === sourceCode);
        const initialRear = rearArc && MEK_TORSO_LOCATIONS.has(sourceCode);
        const initialFace = initialLocation?.armorFaceIds
            .map(faceId => initial.index.armorFaces.get(faceId))
            .find(candidate => candidate?.face === (initialRear ? 'rear' : 'front'));
        const initialArmor = initialFace ? initial.query.remainingArmor(initialFace.id) : 0;
        const initialArmorType = initialLocation?.armor.type ?? null;
        const visited = new Set<string>();
        while (code && (damage > 0 || sharedCompositePip) && !visited.has(code)) {
            visited.add(code);
            let snapshot = this.snapshot(force, instanceId);
            const location = snapshot && [...snapshot.index.locations.values()].find(row => row.code === code);
            if (!snapshot || !location) break;
            const rear = rearArc && MEK_TORSO_LOCATIONS.has(code);
            const nextCode: string | null = topology[code as keyof typeof topology]?.transfersTo ?? null;
            const face = location.armorFaceIds
                .map(faceId => snapshot!.index.armorFaces.get(faceId))
                .find(candidate => candidate?.face === (rear ? 'rear' : 'front'));
            if (!face) break;
            let modularDamage = 0;
            if (damage > 0) {
                const modular = [...snapshot.index.components.entries()]
                    .filter(([, component]) => component.kind === 'equipment'
                        && isModularArmorEquipment(component.mount.equipment))
                    .filter(([componentId]) => [...snapshot!.index.slots.values()].some(slot =>
                        slot.locationId === location.id && slot.componentIds.includes(componentId)))
                    .reduce((sum, [componentId]) =>
                        sum + snapshot!.query.modularArmorRemaining(componentId), 0);
                modularDamage = Math.min(damage, modular);
                damage -= modularDamage;
            }
            const remainingArmor = snapshot.query.remainingArmor(face.id);
            const hardenedArmorApplies = location.armor.type === 'HARDENED' && remainingArmor > 0;
            const armor = resolveMekFallArmorDamage(
                snapshot.ruleset,
                damage,
                remainingArmor,
                location.armor.type,
            );
            const armorPips = modularDamage + armor.armorDamage;
            if (armorPips > 0) {
                const armorCommand: CBTUnitCommand = {
                    type: 'damage-armor', faceId: face.id, amount: armorPips, target: 'committed',
                };
                const result = await dispatch(armorCommand, false);
                applied ||= result.accepted;
                groupDamaged ||= result.accepted;
                if (result.accepted) {
                    await this.resolveBreachOrFlood(force, instanceId, {
                        faceId: face.id,
                        target: 'committed',
                    }, dispatch);
                }
            }
            damage = armor.remainingDamage;
            snapshot = this.snapshot(force, instanceId);
            if (!snapshot) break;
            const remainingInternal = snapshot.query.remainingInternal(location.id);
            const receivedSharedCompositePip: boolean = sharedCompositePip;
            const sharedInternalDamage: number = receivedSharedCompositePip && remainingInternal > 0 ? 1 : 0;
            sharedCompositePip = false;
            const construction = structureConstructionKind(location.structure.structure);
            const structureIncomingDamage = damage;
            const structure = resolveMekStructureDamage(
                damage,
                Math.max(0, remainingInternal - sharedInternalDamage),
                construction === 'composite' ? 'composite'
                    : construction === 'reinforced' ? 'reinforced' : 'standard',
            );
            const internalDamage: number = sharedInternalDamage + structure.internalDamage;
            if (internalDamage > 0) {
                const result = await dispatch({
                    type: 'damage-internal',
                    locationId: location.id,
                    amount: internalDamage,
                    target: 'committed',
                    hardenedArmorApplies,
                    armorDamagedBySameHit: armorPips > 0,
                }, false);
                applied ||= result.accepted;
                groupDamaged ||= result.accepted;
                if (result.accepted) {
                    await this.resolveCriticalChance(
                        force,
                        instanceId,
                        location.id,
                        'committed',
                        { hardenedArmorApplies },
                        dispatch,
                        interactive,
                    );
                }
            }
            damage = structure.overflowDamage;
            sharedCompositePip = !receivedSharedCompositePip
                && snapshot.ruleset === 'core-2026'
                && structureIncomingDamage > 0
                && remainingInternal % 2 === 1
                && construction === 'composite'
                && internalDamage === remainingInternal
                && this.canShareCompositePip(force, instanceId, nextCode, rearArc);
            code = nextCode;
        }
        const blockedAblativeCritical = initial?.ruleset === 'core-2026'
            && initialArmorType === 'ANTI_PENETRATIVE_ABLATION'
            && initialArmor > 0;
        if (throughArmorCritical && groupDamaged && !blockedAblativeCritical) {
            const latest = this.snapshot(force, instanceId);
            const location = latest && [...latest.index.locations.values()].find(row => row.code === sourceCode);
            if (location) {
                await this.resolveCriticalChance(
                    force,
                    instanceId,
                    location.id,
                    'committed',
                    {
                        floatingHitArc: hitArc,
                        hardenedArmorApplies: initialArmorType === 'HARDENED' && initialArmor > 0,
                    },
                    dispatch,
                    interactive,
                );
            }
        }
        return applied;
    }

    private canShareCompositePip(
        force: CBTForce,
        instanceId: string,
        locationCode: string | null,
        rearArc: boolean,
    ): boolean {
        if (!locationCode) return false;
        const snapshot = this.snapshot(force, instanceId);
        const location = snapshot && [...snapshot.index.locations.values()]
            .find(candidate => candidate.code === locationCode);
        if (!snapshot || !location
            || structureConstructionKind(location.structure.structure) !== 'composite') return false;
        const rear = rearArc && MEK_TORSO_LOCATIONS.has(locationCode);
        const face = location.armorFaceIds
            .map(faceId => snapshot.index.armorFaces.get(faceId))
            .find(candidate => candidate?.face === (rear ? 'rear' : 'front'));
        if (!face || snapshot.query.remainingArmor(face.id) > 0
            || snapshot.query.remainingInternal(location.id) <= 0) return false;
        return [...snapshot.index.components.entries()]
            .filter(([, component]) => component.kind === 'equipment'
                && isModularArmorEquipment(component.mount.equipment))
            .filter(([componentId]) => [...snapshot.index.slots.values()].some(slot =>
                slot.locationId === location.id && slot.componentIds.includes(componentId)))
            .every(([componentId]) => snapshot.query.modularArmorRemaining(componentId) === 0);
    }

    private async reviewPilotHits(
        snapshot: MekSnapshot,
        hits: number,
        eventId: string,
        allowCancel = false,
        interactive = false,
    ): Promise<number | null> {
        if (hits <= 0) return 0;
        const event: AutomationReviewEvent = Object.freeze({
            id: eventId,
            subject: this.subject(snapshot),
            event: 'Pilot Hits and Consciousness',
            description: `Apply ${hits} pilot hit${hits === 1 ? '' : 's'} and resolve consciousness.`,
            delta: hits,
        });
        const accepted = await this.automation.resolve(
            'pilotHitsAndConsciousnessCheck',
            [event],
            { title: 'Review Pilot Injury', allowCancel, interactive },
        );
        if (accepted === null) return null;
        return accepted?.has(event.id) ? hits : 0;
    }

    private async applyPilotHits(
        force: CBTForce,
        instanceId: string,
        hits: number,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<boolean> {
        if (hits <= 0) return true;
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        return this.applyCrewHitsByPosition(
            force,
            instanceId,
            new Map(this.crewPositions(snapshot).map(position => [position.id, hits])),
            dispatch,
            `pilot-hits:${instanceId}:${snapshot.query.stateRevision}`,
            interactive,
        );
    }

    /**
     * Heat and submerged-Life-Support damage are separate origin/next damage
     * groups. Resolve both consciousness sequences before mutating crew state
     * so CLOSE cannot leave a half-applied group that is duplicated on retry.
     */
    private async applyLifeSupportHits(
        force: CBTForce,
        instanceId: string,
        staged: ResolvedMekHeatEffects,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<readonly AppliedMekLifeSupportDamage[] | null> {
        const initial = this.snapshot(force, instanceId);
        if (!initial) return null;
        let projected = new Map(this.crewPositions(initial).map(position => {
            const state = initial.query.crewState(position.id);
            return [position.id, Object.freeze({
                wounds: state.wounds,
                unconscious: state.unconscious,
            })] as const;
        }));
        const groups: readonly [AppliedMekLifeSupportDamage['kind'], string, number][] = [
            ['life-support-damage', 'heat', staged.heatLifeHits],
            ['life-support-drowning', 'drowning', staged.drowningHits],
        ];
        const resolvedGroups: Readonly<{
            readonly resolved: readonly ResolvedCrewHits[];
            readonly notification: AppliedMekLifeSupportDamage;
        }>[] = [];

        for (const [presentationKind, eventKind, hits] of groups) {
            if (hits <= 0) continue;
            const beforeGroup = projected;
            const resolved = await this.resolveCrewHits(
                initial,
                new Map(this.crewPositions(initial).map(position => [position.id, hits])),
                `life-support:${eventKind}:${instanceId}:${initial.query.stateRevision}`,
                projected,
                interactive,
            );
            if (resolved === null) return null;
            const appliedHits = resolved.reduce((total, plan) => total + Math.max(
                0,
                plan.wounds - (beforeGroup.get(plan.id as CrewPositionId)?.wounds ?? plan.wounds),
            ), 0);
            resolvedGroups.push(Object.freeze({
                resolved,
                notification: Object.freeze({ kind: presentationKind, hits: appliedHits }),
            }));
            projected = new Map(resolved.map(plan => [plan.id as CrewPositionId, Object.freeze({
                wounds: plan.wounds,
                unconscious: plan.unconscious,
            })]));
        }
        const finalPlans = resolvedGroups.at(-1)?.resolved ?? [];
        if (!await this.applyResolvedCrewHits(
            initial,
            finalPlans,
            dispatch,
        )) return null;
        this.showAutomaticConsciousnessToasts(
            initial,
            resolvedGroups.flatMap(group => group.resolved),
        );
        return Object.freeze(resolvedGroups.map(group => group.notification));
    }

    private async applyCrewHitsByPosition(
        force: CBTForce,
        instanceId: string,
        hitsByPosition: ReadonlyMap<CrewPositionId, number>,
        dispatch: DirectMekAutomationDispatch,
        eventPrefix: string,
        interactive = false,
    ): Promise<boolean> {
        if (![...hitsByPosition.values()].some(hits => hits > 0)) return true;
        const initial = this.snapshot(force, instanceId);
        if (!initial) return false;
        const resolved = await this.resolveCrewHits(
            initial,
            hitsByPosition,
            eventPrefix,
            undefined,
            interactive,
        );
        if (resolved === null) return false;
        if (!await this.applyResolvedCrewHits(
            initial,
            resolved,
            dispatch,
        )) return false;
        this.showAutomaticConsciousnessToasts(initial, resolved);
        return true;
    }

    private resolveCrewHits(
        initial: MekSnapshot,
        hitsByPosition: ReadonlyMap<CrewPositionId, number>,
        eventPrefix: string,
        projected?: ReadonlyMap<CrewPositionId, Readonly<{
            readonly wounds: number;
            readonly unconscious: boolean;
        }>>,
        interactive = false,
    ): Promise<readonly ResolvedCrewHits[] | null> {
        const positions = this.crewPositions(initial);
        return this.crewHitAutomation.resolve(
            this.subject(initial),
            initial.ruleset,
            eventPrefix,
            positions.flatMap(position => {
                const hits = hitsByPosition.get(position.id) ?? 0;
                if (hits <= 0) return [];
                const state = initial.query.crewState(position.id);
                const current = projected?.get(position.id) ?? state;
                const assignment = initial.crewAssignment.positions.find(candidate =>
                    candidate.positionId === position.id);
                const name = positions.length > 1
                    ? assignment?.name.trim() || assignment?.role.trim()
                    : undefined;
                return [Object.freeze({
                    id: position.id,
                    ...(name ? { name } : {}),
                    wounds: current.wounds,
                    unconscious: current.unconscious,
                    unavailable: state.ejected || current.wounds >= MAX_CREW_WOUNDS,
                    hits,
                })];
            }),
            { interactive },
        );
    }

    private async applyResolvedCrewHits(
        initial: MekSnapshot,
        resolved: readonly ResolvedCrewHits[],
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        for (const position of this.crewPositions(initial)) {
            const plan = resolved.find(candidate => candidate.id === position.id);
            const state = initial.query.crewState(position.id);
            if (!plan || state.ejected || (plan.wounds === state.wounds
                && plan.unconscious === state.unconscious)) continue;
            const result = await dispatch({
                type: 'set-crew-state',
                positionId: position.id,
                wounds: plan.wounds,
                unconscious: plan.unconscious,
                ejected: false,
                ...(plan.unconscious && !state.unconscious
                    ? {
                        recoveryReadyTurn: this.options.cbtAutomationMode(
                            'pilotHitsAndConsciousnessCheck',
                        ) === 'no'
                            ? null
                            : initial.state.turn.turnCounter + 1,
                    }
                    : {}),
            }, false);
            if (!result.accepted) return false;
        }
        return true;
    }

    private async deferCrewRecovery(
        force: CBTForce,
        instanceId: string,
        positionId: CrewPositionId,
        currentTurn: number,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        const state = snapshot?.query.crewState(positionId);
        if (!snapshot || !state || !state.unconscious || state.ejected
            || state.wounds >= MAX_CREW_WOUNDS) return true;
        const result = await dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: state.wounds,
            unconscious: true,
            ejected: false,
            recoveryReadyTurn: currentTurn + 1,
        }, false);
        return result.accepted;
    }

    private async recordCrewRecoveryTransition(
        before: MekSnapshot,
        after: MekSnapshot,
        positionId: CrewPositionId,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        const previous = before.query.crewState(positionId);
        const current = after.query.crewState(positionId);
        if (previous.unconscious || !current.unconscious || current.ejected
            || current.wounds >= MAX_CREW_WOUNDS) return true;
        const recoveryReadyTurn = this.options.cbtAutomationMode(
            'pilotHitsAndConsciousnessCheck',
        ) === 'no' ? null : before.state.turn.turnCounter + 1;
        if (current.recoveryReadyTurn === recoveryReadyTurn) return true;
        const result = await dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: current.wounds,
            unconscious: true,
            ejected: false,
            recoveryReadyTurn,
        }, false);
        return result.accepted;
    }

    private showAutomaticConsciousnessToasts(
        initial: MekSnapshot,
        resolved: readonly ResolvedCrewHits[],
    ): void {
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') !== 'yes') return;
        const crewLabel = (id: string): string => {
            const positionId = id as CrewPositionId;
            const occurrence = initial.index.crewPositions.get(positionId)?.occurrence ?? 0;
            const assignment = initial.crewAssignment.positions.find(position =>
                position.positionId === positionId);
            return assignment?.name.trim() || `Crew ${occurrence + 1}`;
        };
        for (const notification of automaticConsciousnessNotifications(resolved, crewLabel)) {
            this.toast(
                initial,
                notification.message,
                notification.type,
            );
        }
    }

    private crewPositions(snapshot: MekSnapshot) {
        return [...snapshot.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
    }

    private async explodeAmmo(
        force: CBTForce,
        instanceId: string,
        componentId: ComponentId,
        dispatch: DirectMekAutomationDispatch,
        interactive = false,
    ): Promise<string | null> {
        const initial = this.snapshot(force, instanceId);
        if (!initial) return null;
        const slot = [...initial.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(componentId));
        if (!slot) return 'no eligible ammunition remains; no explosion applied';
        const profile = initial.query.mekCriticalRollProfile(slot.locationId, 'committed');
        const results = profile.validRolls.find(dice => {
            const plan = initial.query.mekCriticalRoll(slot.locationId, dice, 'committed');
            return plan.kind === 'applied' && plan.slotId === slot.id;
        });
        if (!results) return 'no eligible ammunition remains; no explosion applied';
        const plan = initial.query.mekCriticalRoll(slot.locationId, results, 'committed');
        if (plan.kind !== 'applied' || (!plan.explosion && !plan.pendingExplosion)) {
            return 'no ammunition explosion applied';
        }

        // The heat check is the explosion gate. Preflight its unavoidable crew injury,
        // then bypass generic critical-hit automation so one accepted heat event cannot
        // open a second internal-explosion review for the same ammunition bin.
        const pilotHits = plan.explosion?.pilotHits
            ?? gameRulesFor(initial.ruleset).getMekInternalExplosionPilotHits();
        const resolvedCrew = await this.resolveCrewHits(
            initial,
            new Map(this.crewPositions(initial).map(position => [position.id, pilotHits])),
            `heat-ammo:${instanceId}:${initial.query.stateRevision}`,
            undefined,
            interactive,
        );
        if (resolvedCrew === null) return null;

        const result = await dispatch({
            type: 'apply-mek-critical-roll',
            locationId: slot.locationId,
            results,
            target: 'committed',
            applyExplosion: true,
            applyPilotHits: false,
            settlePendingExplosion: true,
        }, false);
        if (!result.accepted) return null;
        if (!await this.applyResolvedCrewHits(
            initial,
            resolvedCrew,
            dispatch,
        )) return null;
        this.showAutomaticConsciousnessToasts(initial, resolvedCrew);
        await this.resolveExplosionConsequences(
            force,
            instanceId,
            initial,
            plan,
            'committed',
            dispatch,
            interactive,
        );

        const explosion = plan.explosion;
        const rawDamage = explosion?.rawDamage ?? plan.pendingExplosion?.rawDamage ?? 0;
        const details = [
            `${plan.equipment} exploded for ${rawDamage} damage in `
                + `${getMekLocationLabel(plan.targetLocationCode) ?? plan.targetLocationCode}`,
        ];
        const appliedPilotHits = resolvedCrew.reduce((total, crew) => {
            const before = initial.query.crewState(crew.id as CrewPositionId).wounds;
            return total + Math.max(0, crew.wounds - before);
        }, 0);
        if (appliedPilotHits > 0) {
            details.push(`${appliedPilotHits} pilot hit${appliedPilotHits === 1 ? '' : 's'} applied`);
        }
        if (explosion?.automaticCritical) {
            details.push(
                `automatic critical: ${explosion.automaticCritical.equipment} in `
                    + `${getMekLocationLabel(explosion.automaticCritical.locationCode)
                        ?? explosion.automaticCritical.locationCode} `
                    + `(slot ${explosion.automaticCritical.slotNumber})`,
            );
        }
        return details.join('; ');
    }

    private preferredExplosiveAmmoCandidates(
        snapshot: MekSnapshot,
    ): readonly MekAmmoExplosionCandidate[] {
        const candidates = [...snapshot.index.components.entries()].flatMap(([componentId, component]) => {
            const ammo = component.kind === 'equipment' ? component.mount.equipment : null;
            if (!(ammo instanceof AmmoEquipment)
                || !ammo.isExplosive()
                || snapshot.query.componentStatus(componentId, 'committed') !== 'available') return [];
            const shots = snapshot.query.remainingAmmo(componentId);
            const damagePerShot = ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo);
            const slot = [...snapshot.index.slots.values()].find(candidate =>
                candidate.componentIds.includes(componentId));
            const locationCode = slot
                ? snapshot.index.locations.get(slot.locationId)?.code
                : undefined;
            return shots > 0 && damagePerShot > 0
                ? [Object.freeze({
                    componentId,
                    equipment: component.mount?.displayName() ?? ammo.name,
                    ...(locationCode === undefined
                        ? {}
                        : { location: getMekLocationLabel(locationCode) ?? locationCode }),
                    damagePerShot,
                    shots,
                })]
                : [];
        });
        if (candidates.length <= 1) return Object.freeze(candidates);
        const highestDamage = Math.max(...candidates.map(candidate => candidate.damagePerShot));
        const mostDestructive = candidates.filter(candidate =>
            candidate.damagePerShot === highestDamage);
        const mostShots = Math.max(...mostDestructive.map(candidate => candidate.shots));
        return Object.freeze(mostDestructive.filter(candidate => candidate.shots === mostShots));
    }

    private activePilot(
        snapshot: MekSnapshot,
        recoveredPositions: ReadonlySet<CrewPositionId> = new Set<CrewPositionId>(),
    ): Readonly<{
        positionId: CrewPositionId;
        occurrence: number;
        piloting: number;
        state: ReturnType<MekSnapshot['query']['crewState']>;
    }> | null {
        const candidates = [...snapshot.index.crewPositions.values()].flatMap(position => {
            const state = snapshot.query.crewState(position.id);
            if (state.ejected || state.wounds >= MAX_CREW_WOUNDS
                || state.unconscious && !recoveredPositions.has(position.id)) return [];
            const assignment = snapshot.crewAssignment.positions.find(candidate =>
                candidate.positionId === position.id);
            return [Object.freeze({
                positionId: position.id,
                occurrence: position.occurrence,
                piloting: assignment?.piloting ?? 5,
                state,
            })];
        });
        return candidates.find(candidate => candidate.occurrence === 0)
            ?? candidates.sort((left, right) =>
                left.piloting - right.piloting
                || left.occurrence - right.occurrence
                || left.positionId.localeCompare(right.positionId))[0]
            ?? null;
    }

    private rollHitLocation(snapshot: MekSnapshot, hitArc: MekHitArcV2) {
        const dice = roll2D6();
        let result = resolveMekFallHitLocation(
            hitLocationTable(snapshot), hitArc, twoD6Total(dice),
        );
        if (result.location === null) {
            result = resolveMekFallHitLocation(
                hitLocationTable(snapshot), hitArc, twoD6Total(dice), randomD6(),
            );
        }
        return result;
    }

    private locationUnderwater(snapshot: MekSnapshot, locationCode: string): boolean {
        const water = resolveMekUnitWaterState(
            snapshot.entity,
            snapshot.query.turnState().cover,
            snapshot.query.hasCondition('prone'),
        );
        return water.submerged || (water.partiallyUnderwater && snapshot.entity.locationIsLeg(locationCode));
    }

    private snapshot(force: CBTForce, instanceId: string): MekSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasMekRuntime(snapshot) ? snapshot as MekSnapshot : null;
    }

    private subject(snapshot: MekSnapshot): string {
        return directAutomationSubject(snapshot);
    }

    private toast(snapshot: MekSnapshot, message: string, type: Toast['type']): void {
        this.automationToasts.show(
            String(snapshot.instanceId),
            this.subject(snapshot),
            message,
            type,
        );
    }
}

/** True when applying the batch cannot require dice or a manual outcome. */
function automationCheckBatchIsFullyAutomatic(
    checks: readonly AutomationCheck[],
    initiallyFailedGroups: ReadonlySet<string>,
): boolean {
    if (checks.length === 0) return false;
    const failedGroups = new Set(initiallyFailedGroups);
    for (const check of checks) {
        const cascaded = check.failureGroup !== undefined
            && failedGroups.has(check.failureGroup);
        if (!cascaded
            && check.automaticOutcome === undefined
            && check.targetNumber !== undefined) return false;
        const outcome = cascaded ? 'failed' : check.automaticOutcome ?? 'failed';
        if (outcome === 'failed' && check.failureGroup) {
            failedGroups.add(check.failureGroup);
        }
    }
    return true;
}

function describeCriticalChance(result: MekCriticalChanceResult): string {
    if (result.kind === 'none') return 'No critical hit';
    if (result.kind === 'blown-off') return 'Location blown off';
    return `${result.count} critical hit${result.count === 1 ? '' : 's'}`;
}

function criticalChanceResult(result: MekCriticalChanceResult): MekPendingCriticalChanceResultV2 {
    if (result.kind === 'none') return 'none';
    if (result.kind === 'blown-off') return 'blown-off';
    return result.count;
}

function mekLifeSupportHits(staged: StagedMekHeatEffects): number {
    return staged.heatLifeHits + staged.drowningHits;
}

function lifeSupportReviewDescriptions(staged: StagedMekHeatEffects): readonly string[] {
    return Object.freeze([
        ...(staged.heatLifeHits > 0
            ? [cbtUnitCheckReviewDescription('life-support-damage', {
                hits: staged.heatLifeHits,
            })]
            : []),
        ...(staged.drowningHits > 0
            ? [cbtUnitCheckReviewDescription('life-support-drowning', {
                hits: staged.drowningHits,
            })]
            : []),
    ]);
}

function hitLocationTable(snapshot: MekSnapshot): MekHitLocationTable {
    return snapshot.entity.chassisConfig === 'Tripod' ? 'tripod'
        : snapshot.entity.chassisConfig === 'Quad' || snapshot.entity.chassisConfig === 'QuadVee'
            ? 'quad' : 'biped';
}

function coverWaterDepth(cover: string | null): number {
    if (!cover?.startsWith('underwater-depth-')) return 0;
    return Math.max(0, Number(cover.slice('underwater-depth-'.length)) || 0);
}

function randomD6(): number {
    return Math.floor(Math.random() * 6) + 1;
}

function randomIndex(length: number): number {
    return Math.max(0, Math.min(length - 1, Math.floor(Math.random() * length)));
}

function explosiveCriticalRolls(
    snapshot: MekSnapshot,
    locationId: LocationId,
    target: 'committed' | 'pending',
): readonly (readonly number[])[] {
    return snapshot.query.mekCriticalRollProfile(locationId, target).validRolls.filter(results => {
        const plan = snapshot.query.mekCriticalRoll(locationId, results, target);
        return plan.kind === 'applied' && (plan.explosion !== undefined || plan.pendingExplosion !== undefined);
    });
}
