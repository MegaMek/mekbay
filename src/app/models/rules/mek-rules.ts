// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed } from '@angular/core';
import type { CBTForceUnit, EquipmentAction } from '../cbt-force-unit.model';
import type { CrewMember, SkillType } from '../crew-member.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import type { CriticalSlot, RuleCheckOutcome } from '../force-serialization';
import { CrewStateControlDefinition, CrewStateDefinition, crewStateDefinitions, NARC_CONDITION_COLOR, sortPSRModifiers, UnitConditionControl, unitConditionControls, UnitTypeRulesBase, type ChargeDamage, type LocationConditionControl, type PSRCheck, type PSRCheckKind, type UnitHeatSource, type UnitModifierBreakdownEntry, type UnitRuleModifier } from './unit-type-rules';
import type { EquipmentStatus, EquipmentStatusFacts } from '../equipment-status.model';
import type { TurnState } from '../turn-state.model';
import { type HeatScaleEntry, HeatManagement, getHeatEffects } from './heat-management';
import type { MotiveModes } from '../motiveModes.model';
import { getDefaultAttackerMovementModifier, TN_PRONE, TN_PRONE_ADJACENT, TN_PRONE_ATTACKER } from '../target-number-calculator.model';
import {
    getMekLegLocations,
    getMekLimbLocations,
    inferMekConfigFromLocations,
    isMekLegLocation,
    LEG_LOCATIONS,
    MEK_TORSO_LOCATIONS,
    QUAD_LEG_LOCATIONS,
    type MekConfig,
} from '../entity/types';
import { resolveShieldProfile, type ShieldProfile } from '../entity/utils/physical-weapon';
import type { Equipment } from '../equipment.model';
import type { EquipmentFlag } from '../equipment-flags.type';

export { LEG_LOCATIONS } from '../entity/types';
import type { InventoryControlDisplayData } from '../../utils/inventory-control.util';
import type { ToHitModifierBreakdownEntry } from './game-rules';
import { uuidv7 } from '../../utils/uuid.util';

type ArmLocation = 'LA' | 'RA';

const LEG_DAMAGE_MOVEMENT_CRITICAL_NAMES: Record<PSRCheckKind, readonly string[]> = {
    'damaged-leg-actuator-movement': ['Leg', 'Foot', 'Hip'],
    'damaged-hip-movement': ['Hip'],
};

interface MekArmStatus {
    destroyedShoulder: boolean;
    destroyedHand: boolean;
    destroyedUpperArms: boolean;
    destroyedLowerArms: boolean;
    missingHand: boolean;
    missingLowerArm: boolean;
    canPunch: boolean;
    canPhysWeapon: boolean;
    pushMod: number;
    punchMod: number;
    fireMod: number;
    physWeaponMod: number;
    hasAES: boolean;
    hasFunctionalAES: boolean;
    singleArmMod: number;
}

interface MekMobilityEquipmentState {
    modularArmorInstalled: boolean;
    modularArmorActive: boolean;
    mediumShieldsInstalled: number;
    mediumShieldsActive: number;
    largeShieldsInstalled: number;
    largeShieldsActive: number;
}

const TORSO_CRIPPLE_CHECK_KEY = 'core.torso-crippling';

export const MEK_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['shutdown', 'prone', 'swarmed', 'tagged', 'ecm-shielded', 'skidding', 'jammed']);
export const MEK_CREW_STATE_CONTROLS: readonly CrewStateControlDefinition[] = crewStateDefinitions(['unconscious', 'ejected']) as readonly CrewStateControlDefinition[];
export const MEK_CREW_STATE_DISPLAYS: readonly CrewStateDefinition[] = crewStateDefinitions(['unconscious', 'ejected', 'dead']);
export const MEK_LOCATION_CONDITION_CONTROLS: readonly LocationConditionControl[] = [
    { key: 'flooded', label: 'Flooded', color: '#66f' },
    { key: 'blown-off', label: 'Blown Off', color: '#808080' },
    { key: 'narc', label: 'NARC', color: NARC_CONDITION_COLOR, counted: true },
];

export interface MekLegDamageState {
    destroyedHipsCount: number;
    destroyedLegsCount: number;
}

export interface MekLegMovementResult {
    walk: number;
    runDisabled: boolean;
    runCap: number | null;
    moveImpaired: boolean;
    applyActuatorDamage: boolean;
}

/**
 * Mek-specific game rules: destruction evaluation, systems status,
 * Piloting Skill Roll modifiers, and PSR target roll.
 */
export class MekRules extends UnitTypeRulesBase {
    static readonly ENGINE_DESTRUCTION_HITS = 3;
    override readonly standingUpPSRModifier: number = -1;
    protected get gyroHitPSRModifier(): number { return 2; }
    protected get hipPSRModifier(): number { return 1; }
    protected get lowerArmFireModifier(): number { return 0; }
    protected get footHitsCausePSR(): boolean { return false; }
    protected get shieldBashPunchBonusEnabled(): boolean { return true; }
    protected get standaloneShieldDamageEnabled(): boolean { return false; }


    protected override supportsDroneOperatingSystem(): boolean {
        return true;
    }

    protected override readonly baseConditionControls = MEK_UNIT_CONDITION_CONTROLS;
    protected override readonly baseCrewStateControls = MEK_CREW_STATE_CONTROLS;
    override readonly locationConditionControls = MEK_LOCATION_CONDITION_CONTROLS;
    protected override readonly crewStateDisplayDefinitions = MEK_CREW_STATE_DISPLAYS;

    override get crewStateControls(): readonly CrewStateControlDefinition[] {
        const controls = super.crewStateControls;
        return this.hasTorsoMountedCockpit()
            ? controls.filter(control => control.key !== 'ejected')
            : controls;
    }

    override canSwapCrewMembers(leftCrewId = 0, rightCrewId = 1): boolean {
        const crew = this.unit.getCrewMembers();
        if (!crew[leftCrewId] || !crew[rightCrewId]) return false;
        if (!this.hasMainCockpit() || !this.hasCommandConsole()) return false;
        return !this.isCrewCockpitDestroyed(leftCrewId) && !this.isCrewCockpitDestroyed(rightCrewId);
    }

    override swapCrewMembers(leftCrewId = 0, rightCrewId = 1): boolean {
        if (!this.canSwapCrewMembers(leftCrewId, rightCrewId)) return false;
        const leftCrew = this.unit.getCrewMember(leftCrewId);
        const rightCrew = this.unit.getCrewMember(rightCrewId);
        const leftData = leftCrew.serialize();
        const rightData = rightCrew.serialize();

        leftCrew.update(rightData);
        rightCrew.update(leftData);
        this.unit.setCrewMember(leftCrewId, leftCrew);
        this.unit.setCrewMember(rightCrewId, rightCrew);
        return true;
    }

    protected override readonly abandoned = computed<boolean>(() => {
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.every(crewMember => {
            const state = crewMember.getState();
            return state === 'dead' || state === 'ejected';
        });
    });

    protected override readonly immobile = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        if (this.unit.getCondition('shutdown')) return true;
        if (!this.hasDroneOperatingSystem() && !this.hasFunctionalCrew()) return true;
        const movement = this.computeBaseMovementProfile();
        if (!movement) return false;
        const canUseJumpingMovement = !this.unit.getCondition('prone');
        const damageAvailableModes = [
            movement.baselineWalk > 0 ? movement.walk : null,
            movement.baselineJump > 0 && canUseJumpingMovement ? movement.jump : null,
            movement.baselineUMU > 0 && canUseJumpingMovement ? movement.UMU : null,
        ].filter((value): value is number => value !== null);
        return damageAvailableModes.length > 0 && damageAvailableModes.every(value => value <= 0);
    });

    protected override readonly crippled = computed<boolean>(() => {
        if (!this.unit.usesForcedWithdrawal()) return false;
        if (!this.unit.isLoaded()) return false;
        const critSlots = this.unit.getCritSlots();
        const engineHits = critSlots.filter(slot =>
            this.isNamedCrit(slot, 'Engine') && this.isDestroyedOrDestroyingCrit(slot)
        ).length;
        if (engineHits >= 2) return true;

        const internalLocations = this.unit.locations?.internal;
        if (!internalLocations) return false;

        const config = inferMekConfigFromLocations(internalLocations.keys());
        const destroyedLimbs = getMekLimbLocations(config).filter(loc =>
            internalLocations.has(loc) && this.unit.isInternalLocDestroyed(loc)
        );
        if (destroyedLimbs.length >= 2 && destroyedLimbs.some(loc => isMekLegLocation(config, loc))) {
            return true;
        }

        const destroyedTorsoCount = this.destroyedTorsoCount();
        if (destroyedTorsoCount >= 2) return true;
        if (destroyedTorsoCount === 0) return false;
        if (!this.requiresTorsoCripplingCheck()) return true;
        const trigger = this.destroyedTorsoLocations()[0];
        const check = this.unit.getRuleCheck(TORSO_CRIPPLE_CHECK_KEY);
        return check?.trigger === trigger && check.status === 'failed';
    });

    private readonly heatMgmt: HeatManagement;

    constructor(unit: CBTForceUnit) {
        super(unit);
        this.heatMgmt = new HeatManagement(unit);
    }

    // ── Cripple Check Utilities ──────────────────────────────────────────────

    protected allLimbsDestroyed(): boolean {
        const internalLocations = this.unit.locations?.internal;
        if (!internalLocations) return false;

        const config = inferMekConfigFromLocations(internalLocations.keys());
        const limbLocations = getMekLimbLocations(config);
        const isDestroyed = (loc: string) => this.unit.isInternalLocCommittedDestroyed(loc);
        if (config !== 'Tripod') return limbLocations.every(isDestroyed);

        const armsDestroyed = limbLocations
            .filter(loc => !isMekLegLocation(config, loc))
            .every(isDestroyed);
        // A tripod with two destroyed legs follows the biped both-legs-destroyed state.
        const destroyedLegs = getMekLegLocations(config)
            .filter(isDestroyed)
            .length;
        return armsDestroyed && destroyedLegs >= 2;
    }

    protected isDestroyedOrDestroyingCrit(slot: CriticalSlot): boolean {
        return !!slot.destroying || this.isCritUnavailable(slot);
    }

    protected usesTorsoCripplingRules(): boolean {
        return true;
    }

    private destroyedTorsoCount(): number {
        return this.destroyedTorsoLocations().length;
    }

    private destroyedTorsoLocations(): string[] {
        const internalLocations = this.unit.locations?.internal;
        if (!internalLocations) return [];
        return Array.from(MEK_TORSO_LOCATIONS).filter(loc =>
            internalLocations.has(loc) && this.unit.isInternalLocDestroyed(loc)
        );
    }

    private requiresTorsoCripplingCheck(): boolean {
        if (!this.unit.usesForcedWithdrawal() || !this.usesTorsoCripplingRules()) return false;
        const engine = (this.unit.getUnit().engine ?? '').trim().toLowerCase();
        return engine === 'fusion' || engine === 'compact';
    }

    override reconcileRuleChecks(): void {
        const check = this.unit.getRuleCheck(TORSO_CRIPPLE_CHECK_KEY);
        if (!this.requiresTorsoCripplingCheck()) {
            this.unit.setRuleCheck(TORSO_CRIPPLE_CHECK_KEY, undefined, false);
            return;
        }

        const destroyedTorsos = this.destroyedTorsoLocations();
        if (destroyedTorsos.length === 0) {
            this.unit.setRuleCheck(TORSO_CRIPPLE_CHECK_KEY, undefined, false);
            return;
        }
        if (destroyedTorsos.length >= 2) {
            if (check && !destroyedTorsos.includes(check.trigger)) {
                this.unit.setRuleCheck(TORSO_CRIPPLE_CHECK_KEY, undefined, false);
            }
            return;
        }

        const trigger = destroyedTorsos[0];
        if (check?.trigger === trigger) return;
        this.unit.setRuleCheck(TORSO_CRIPPLE_CHECK_KEY, {
            token: uuidv7(),
            trigger,
            status: 'pending',
        }, false);
    }

    override resolveRuleCheck(key: string, token: string, outcome: RuleCheckOutcome): boolean {
        if (key !== TORSO_CRIPPLE_CHECK_KEY) return super.resolveRuleCheck(key, token, outcome);
        const destroyedTorsos = this.destroyedTorsoLocations();
        const check = this.unit.getRuleCheck(key);
        if (destroyedTorsos.length !== 1
            || !check
            || check.status !== 'pending'
            || check.token !== token
            || check.trigger !== destroyedTorsos[0]) {
            return false;
        }
        return this.unit.setRuleCheck(key, { ...check, status: outcome });
    }

    private isCritUnavailable(slot: CriticalSlot): boolean {
        return !this.unit.isEquipmentOperational(slot);
    }

    private isCritStructurallyDestroyed(slot: CriticalSlot): boolean {
        return !!slot.destroyed || this.locationPhysicallyDestroyed(slot.loc) ||
            (!!slot.loc && this.unit.isInternalLocCommittedPhysicallyDestroyed(slot.loc));
    }

    // ── Destruction ──────────────────────────────────────────────────────────

    /**
    * Mek destruction: propagate crit destruction from structurally destroyed locations,
    * then check engine.
     */
    evaluateDestroyed(): void {
        // Build set of destroyed internal locations, including linked
        const locationsToDestroy = new Set<string>();
        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (this.unit.isInternalLocStructurallyDestroyed(loc)) {
                locationsToDestroy.add(loc);
            }
        });

        // Propagate destruction to crits in destroyed locations (batch update)
        const crits = this.unit.getCritSlots();
        let critsChanged = false;
        for (const crit of crits) {
            if (!crit.loc || !this.unit.locations?.internal?.has(crit.loc)) continue;
            const locDestroyed = locationsToDestroy.has(crit.loc);
            const maxHits = crit.armored ? 2 : 1;
            const shouldDestroy = locDestroyed || (crit.hits ?? 0) >= maxHits;
            if (!!shouldDestroy !== !!crit.destroying) {
                crit.destroying = shouldDestroy ? Date.now() : undefined;
                if (!crit.destroying && crit.destroyed) {
                    crit.destroyed = crit.destroying;
                }
                critsChanged = true;
            }
        }
        if (critsChanged) {
            this.unit.writeCrits([...crits]);
        }

        // Check engine and cockpit destruction (committed state only)
        const destroyedEngineSlots = crits.filter(slot => this.isNamedCrit(slot, "Engine") && this.isCritUnavailable(slot)).length;
        const engineBlown = destroyedEngineSlots >= MekRules.ENGINE_DESTRUCTION_HITS;
        const cockpitDestroyed = this.allCrewCockpitsUnavailable(crits);

        const destroyed = engineBlown || cockpitDestroyed;
        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    protected readonly currentLegState = computed(() => {
        const internalLocations = this.unit.locations?.internal;
        const config = inferMekConfigFromLocations(internalLocations?.keys() ?? []);
        const legs = getMekLegLocations(config);
        const destroyedLegs = legs.filter(loc =>
            internalLocations?.has(loc) && this.unit.isInternalLocDestroyed(loc)
        );
        const hasIntactLeg = legs.some(loc =>
            internalLocations?.has(loc) && !this.unit.isInternalLocDestroyed(loc)
        );
        const allLegsIntact = legs.every(loc =>
            internalLocations?.has(loc) && !this.unit.isInternalLocDestroyed(loc)
        );
        const destroyedArms = ['LA', 'RA'].filter(loc =>
            internalLocations?.has(loc) && this.unit.isInternalLocDestroyed(loc)
        );
        return { config, destroyedLegs, destroyedArms, hasIntactLeg, allLegsIntact };
    });

    // ── PSR ──────────────────────────────────────────────────────────────────

    override readonly autoFall = computed<boolean>(() => {
        const psr = this.unit.turnState().getPSRCheckState();
        return (psr.legsDestroyed?.size ?? 0) > 0
            || psr.gyroDestroyed === true;
    });

    override getPSRChecks(turnState: TurnState): PSRCheck[] {
        const checks: PSRCheck[] = [];
        const psr = turnState.getPSRCheckState();

        const torsoCheck = this.unit.getRuleCheck(TORSO_CRIPPLE_CHECK_KEY);
        const destroyedTorsos = this.destroyedTorsoLocations();
        if (this.requiresTorsoCripplingCheck()
            && destroyedTorsos.length === 1
            && torsoCheck?.trigger === destroyedTorsos[0]
            && torsoCheck.status === 'pending') {
            checks.push({
                fallCheck: 0,
                pilotCheck: 0,
                loc: destroyedTorsos[0],
                reason: 'Torso destroyed',
                failureOutcome: 'Crippled',
                resolution: {
                    key: TORSO_CRIPPLE_CHECK_KEY,
                    token: torsoCheck.token,
                },
            });
        }

        if (psr.gyroDestroyed) {
            const destroyedGyroCheck = this.destroyedGyroPSRCheck();
            if (destroyedGyroCheck) checks.push(this.withPSRLocation(destroyedGyroCheck, this.getGyroDamageLocation()));
        } else if ((psr.legsDestroyed?.size || 0) > 0) {
            const isQuadruped = this.isQuadrupedMek();
            const check = this.destroyedLegPSR(isQuadruped);
            psr.legsDestroyed?.forEach((loc => {
                checks.push({
                    fallCheck: check.fallCheck,
                    pilotCheck: check.pilotCheck,
                    loc: loc,
                    legFilter: loc,
                    reason: 'Leg destroyed'
                });
            }));
        } else {
            if (psr.shutdown) {
                checks.push({
                    fallCheck: 3,
                    pilotCheck: 3,
                    reason: 'Shutdown'
                });
            }
            if (turnState.dmgReceived() >= 20) {
                checks.push({
                    fallCheck: 1,
                    pilotCheck: 1,
                    reason: `Received ${turnState.dmgReceived()} damage`
                });
            }
            const movementCheck = turnState.applyMovePSR()
                && !this.isMovementPSRFoldedIntoStandAttempt(turnState)
                ? this.getCommittedDamageMovementModePSRCheck(turnState.effectiveMoveMode(), turnState.moveDistance())
                : null;
            checks.push(...this.getLegActuatorPSRChecks(turnState, movementCheck));
            const gyroHits = (psr.gyroHit || 0);
            if (gyroHits > 0) {
                const gyroHitCheck = this.gyroHitPSRCheck(gyroHits);
                if (gyroHitCheck) checks.push(this.withPSRLocation(gyroHitCheck, this.getGyroDamageLocation()));
            }
            if (movementCheck && this.getLegActuatorMovementPSRChecks(movementCheck) === null) {
                checks.push(movementCheck);
            }
        }
        return checks;
    }

    private getGyroDamageLocation(): string | undefined {
        const gyroSlots = this.unit.getCritSlots().filter(slot => this.isNamedCrit(slot, 'Gyro'));
        return gyroSlots.find(slot => this.isDestroyedOrDestroyingCrit(slot))?.loc ?? gyroSlots[0]?.loc;
    }

    private withPSRLocation(check: PSRCheck, location: string | undefined): PSRCheck {
        return location && !check.loc ? { ...check, loc: location } : check;
    }

    protected getLegActuatorPSRChecks(
        turnState: TurnState,
        movementCheck: PSRCheck | null,
    ): PSRCheck[] {
        const checks: PSRCheck[] = [];
        const psr = turnState.getPSRCheckState();
        psr.legActuators?.forEach((count, loc) => {
            if (count <= 0) return;
            checks.push({
                fallCheck: count,
                pilotCheck: count,
                loc,
                reason: 'Leg Actuator hit',
                modifierReason: this.formatLegActuatorModifierReason('Leg Actuator hit', count),
            });
        });
        psr.hipsHit?.forEach(loc => {
            checks.push({
                fallCheck: this.hipPSRModifier,
                pilotCheck: this.hipPSRModifier,
                loc,
                reason: 'Hip hit',
            });
        });
        if (movementCheck) {
            checks.push(...(this.getLegActuatorMovementPSRChecks(movementCheck) ?? []));
        }

        const checksByLeg = new Map<string, PSRCheck>();
        for (const check of checks) {
            if (!check.loc) continue;
            const existing = checksByLeg.get(check.loc);
            if (!existing) {
                checksByLeg.set(check.loc, check);
                continue;
            }
            checksByLeg.set(check.loc, {
                ...existing,
                fallCheck: (existing.fallCheck ?? 0) + (check.fallCheck ?? 0),
                pilotCheck: (existing.pilotCheck ?? 0) + (check.pilotCheck ?? 0),
                legFilter: existing.legFilter ?? check.legFilter,
                reason: this.formatLegActuatorPSRReasons(existing.reason, check.reason),
                modifierReason: this.formatLegActuatorModifierReason(
                    this.formatLegActuatorPSRReasons(existing.reason, check.reason),
                    psr.legActuators?.get(check.loc),
                ),
            });
        }
        return Array.from(checksByLeg.values());
    }

    protected isLegDamageMovementPSRCheck(
        check: PSRCheck | null,
    ): check is PSRCheck & { kind: PSRCheckKind } {
        return check?.kind !== undefined
            && LEG_DAMAGE_MOVEMENT_CRITICAL_NAMES[check.kind] !== undefined;
    }

    private getLegActuatorMovementPSRChecks(check: PSRCheck): PSRCheck[] | null {
        const criticalNames = check.kind === undefined
            ? undefined
            : LEG_DAMAGE_MOVEMENT_CRITICAL_NAMES[check.kind];
        if (!criticalNames) return null;

        const reasonsByLeg = new Map<string, Set<string>>();
        this.unit.getCritSlots().forEach(slot => {
            if (!slot.loc
                || !LEG_LOCATIONS.has(slot.loc)
                || !this.isCritUnavailable(slot)
                || !criticalNames.some(name => this.isNamedCrit(slot, name))) return;
            const reasons = reasonsByLeg.get(slot.loc) ?? new Set<string>();
            if (this.isNamedCrit(slot, 'Hip')) reasons.add('Hip hit');
            else if (this.isNamedCrit(slot, 'Foot')) reasons.add('Foot hit');
            else reasons.add('Leg Actuator hit');
            reasonsByLeg.set(slot.loc, reasons);
        });
        const movementChecks = Array.from(reasonsByLeg, ([loc, reasons]) => ({
            ...check,
            loc,
            reason: this.formatLegActuatorPSRReasons(...reasons),
        }));
        return movementChecks.length > 0 ? movementChecks : null;
    }

    private formatLegActuatorPSRReasons(...reasons: string[]): string {
        const included = new Set(reasons.flatMap(reason => reason.split(', ')));
        return ['Hip hit', 'Leg Actuator hit', 'Foot hit']
            .filter(reason => included.has(reason))
            .join(', ');
    }

    private formatLegActuatorModifierReason(reason: string, actuatorHits: number | undefined): string {
        if (!actuatorHits || actuatorHits <= 1) return reason;
        return reason.replace('Leg Actuator hit', `Leg Actuators hit (${actuatorHits})`);
    }

    protected gyroHitPSRCheck(_gyroHits: number): PSRCheck | null {
        if (this.hasHeavyDutyGyro()) return null;
        return {
            fallCheck: this.gyroHitPSRModifier,
            pilotCheck: this.gyroHitPSRModifier,
            reason: 'Gyro hit',
            ignorePreExistingGyro: true,
        };
    }

    protected destroyedGyroPSRCheck(): PSRCheck | null {
        if (this.hasHeavyDutyGyro()) return null;
        return {
            fallCheck: this.gyroHitPSRModifier,
            pilotCheck: this.gyroHitPSRModifier,
            reason: 'Gyro hit',
            ignorePreExistingGyro: true,
        };
    }

    protected destroyedLegPSR(isQuadruped: boolean): { fallCheck: number; pilotCheck: number } {
        return isQuadruped
            ? { fallCheck: 1, pilotCheck: 1 }
            : { fallCheck: 100, pilotCheck: 4 };
    }

    override getCommittedDamageMovementModePSRCheck(moveMode: MotiveModes | null, moveDistance?: number | null): PSRCheck | null {
        if (moveMode !== 'run' && moveMode !== 'jump') return null;
        if (moveDistance === null) return null;
        if (moveMode === 'run'
            && moveDistance !== undefined
            && moveDistance < 1
            && this.runningDamageCheckRequiresHexMovement()) return null;

        const critSlots = this.unit.getCritSlots();
        const damagedGyro = critSlots.find(slot => this.isCritUnavailable(slot) && this.isNamedCrit(slot, 'Gyro'));

        const damagedLegLocations: string[] = [];
        this.unit.locations?.internal?.forEach((_value, loc) => {
            if (!LEG_LOCATIONS.has(loc)) return;
            if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                damagedLegLocations.push(loc);
            }
        });
        const hasDamagedLeg = damagedLegLocations.length > 0;
        const damagedLegLocation = damagedLegLocations.length === 1 ? damagedLegLocations[0] : undefined;

        const hasDamagedLegActuators = critSlots.some(slot => {
            if (!slot.name || !slot.loc || !this.isCritUnavailable(slot)) return false;
            if (!LEG_LOCATIONS.has(slot.loc)) return false;
            if (this.unit.isInternalLocCommittedDestroyed(slot.loc)) return false;
            return this.isNamedCrit(slot, 'Leg')
                || this.isNamedCrit(slot, 'Foot')
                || this.isNamedCrit(slot, 'Hip');
        });

        const internalLocations = this.systemsStatus().internalLocations;
        const isQuadruped = QUAD_LEG_LOCATIONS.some(loc => internalLocations.has(loc));
        const destroyedLegsCount = this.systemsStatus().destroyedLegsCount;
        const damagedLegRequiresCheck = this.damagedLegRequiresMovementCheck(isQuadruped, destroyedLegsCount);
        const destroyedLegsApplyHipCheck = this.destroyedLegsApplyHipMovementCheck(
            isQuadruped,
            destroyedLegsCount,
        );

        if (moveMode === 'jump') {
            if (damagedGyro) {
                const check = this.damagedGyroMovementPSRCheck(moveMode);
                return check ? this.withPSRLocation(check, damagedGyro.loc) : null;
            }
            if (destroyedLegsApplyHipCheck) {
                return {
                    fallCheck: 0,
                    pilotCheck: 0,
                    reason: 'Jumping with damaged hip',
                };
            }
            if (hasDamagedLeg && damagedLegRequiresCheck) {
                const modifier = this.destroyedLegMovementPSRModifier(
                    moveMode,
                    isQuadruped,
                    destroyedLegsCount,
                );
                return {
                    fallCheck: modifier,
                    pilotCheck: modifier,
                    ...(modifier === 0 && damagedLegLocation && { loc: damagedLegLocation }),
                    reason: 'Jumping with damaged leg'
                };
            }
            if (hasDamagedLegActuators) {
                return {
                    fallCheck: 0,
                    pilotCheck: 0,
                    kind: 'damaged-leg-actuator-movement',
                    reason: 'Jumping with damaged leg actuator'
                };
            }
            return null;
        }

        if (damagedGyro) {
            const gyroMovementCheck = this.damagedGyroMovementPSRCheck(moveMode);
            if (gyroMovementCheck) return this.withPSRLocation(gyroMovementCheck, damagedGyro.loc);
        }
        if (destroyedLegsApplyHipCheck) {
            return {
                fallCheck: 0,
                pilotCheck: 0,
                reason: 'Running with damaged hip',
            };
        }
        if (this.runningWithDestroyedLegRequiresCheck()
            && hasDamagedLeg
            && damagedLegRequiresCheck) {
            return {
                fallCheck: 0,
                pilotCheck: 0,
                ...(damagedLegLocation && { loc: damagedLegLocation }),
                reason: 'Running with damaged leg'
            };
        }
        if (hasDamagedLegActuators) {
            const hasDamagedHip = critSlots.some(slot => {
                if (!slot.name || !slot.loc || !this.isCritUnavailable(slot)) return false;
                if (!LEG_LOCATIONS.has(slot.loc)) return false;
                return this.isNamedCrit(slot, 'Hip');
            });
            if (hasDamagedHip) {
                return {
                    fallCheck: 0,
                    pilotCheck: 0,
                    kind: 'damaged-hip-movement',
                    reason: 'Running with damaged hip'
                };
            }
        }
        return null;
    }

    protected damagedGyroMovementPSRCheck(moveMode: 'run' | 'jump'): PSRCheck | null {
        if (this.hasHeavyDutyGyro()) {
            if (moveMode === 'run') return null;
            return {
                fallCheck: 2,
                pilotCheck: 2,
                reason: 'Jumping with damaged HD gyro',
                ignorePreExistingGyro: true,
            };
        }
        return {
            fallCheck: 0,
            pilotCheck: 0,
            reason: `${moveMode === 'jump' ? 'Jumping' : 'Running'} with damaged gyro`,
        };
    }

    protected damagedLegRequiresMovementCheck(isQuadruped: boolean, destroyedLegsCount: number): boolean {
        return isQuadruped ? destroyedLegsCount >= 2 : destroyedLegsCount >= 1;
    }

    protected destroyedLegMovementPSRModifier(
        _moveMode: 'run' | 'jump',
        _isQuadruped: boolean,
        _destroyedLegsCount: number,
    ): number {
        return 0;
    }

    protected runningWithDestroyedLegRequiresCheck(): boolean {
        return true;
    }

    protected runningDamageCheckRequiresHexMovement(): boolean {
        return true;
    }

    protected destroyedLegsApplyHipMovementCheck(isQuadruped: boolean, destroyedLegsCount: number): boolean {
        return isQuadruped && destroyedLegsCount === 2;
    }

    override evaluateLegDestroyed(location: string, hits: number): void {
        if (!LEG_LOCATIONS.has(location)) return;
        const turnState = this.unit.turnState();
        const destroyed = this.unit.isInternalLocDestroyed(location);
        let isPsrRelevant = false;
        const psr = turnState.getPSRCheckState();
        if (destroyed) {
            if (!psr.legsDestroyed) {
                psr.legsDestroyed = new Set<string>();
            }
            if (hits > 0) {
                psr.legsDestroyed.add(location);
                isPsrRelevant = true;
            }
        } else {
            if (psr.legsDestroyed && psr.legsDestroyed.has(location) && hits < 0) {
                psr.legsDestroyed.delete(location);
                isPsrRelevant = true;
            }
        }
        if (isPsrRelevant) {
            turnState.setPSRCheckState(psr);
        }
    }

    override evaluateCritSlotHit(crit: CriticalSlot): void {
        if (!crit.loc) return;
        let isPsrRelevant = false;
        const delta = (crit.destroying) ? 1 : -1;
        const turnState = this.unit.turnState();
        const psr = turnState.getPSRCheckState();
        if (LEG_LOCATIONS.has(crit.loc)) {
            if ((this.footHitsCausePSR && crit.name?.includes('Foot')) || crit.name?.includes('Leg')) {
                if (!psr.legActuators) {
                    psr.legActuators = new Map<string, number>();
                }
                psr.legActuators.set(crit.loc, Math.max(0, (psr.legActuators.get(crit.loc) || 0) + delta));
                isPsrRelevant = true;
            } else if (crit.name?.includes('Hip')) {
                if (!psr.hipsHit) {
                    psr.hipsHit = new Set<string>();
                }
                if (delta > 0) {
                    psr.hipsHit.add(crit.loc);
                } else {
                    psr.hipsHit.delete(crit.loc);
                }
                isPsrRelevant = true;
            }
        } else if (crit.name?.includes('Gyro')) {
            psr.gyroHit = Math.max(0, (psr.gyroHit || 0) + delta);
            isPsrRelevant = true;
            const critSlots = this.unit.getCritSlots();
            const gyroHits = critSlots.filter(slot => {
                if (!this.isDestroyedOrDestroyingCrit(slot)) return false;
                if (!this.isNamedCrit(slot, 'Gyro')) return false;
                return true;
            }).length;
            if (gyroHits >= this.gyroDestructionHitThreshold()) {
                psr.gyroDestroyed = true;
            } else {
                psr.gyroDestroyed = false;
            }
        }
        if (isPsrRelevant) {
            turnState.setPSRCheckState(psr);
        }
    }

    protected gyroDestructionHitThreshold(): number {
        return this.hasHeavyDutyGyro() ? 4 : 2;
    }

    override heatSources(turnState: TurnState): UnitHeatSource[] {
        const sources: UnitHeatSource[] = [
            {
                id: 'movement',
                label: 'Movement',
                value: this.computeMovementHeat(turnState),
            }
        ];
        const damagedEngineHeat = this.computeDamagedEngineHeat();
        if (damagedEngineHeat > 0) {
            sources.push({
                id: 'damaged-engine',
                label: 'Damaged Engine',
                value: damagedEngineHeat,
                signature: this.damagedEngineSignature(),
            });
        }
        sources.push(...super.heatSources(turnState));
        return sources;
    }

    private computeMovementHeat(turnState: TurnState): number {
        const moveMode = turnState.effectiveMoveMode();
        const hasXXLEngine = this.hasXXLEngine();
        const superCooledMyomerActive = this.hasActiveSuperCooledMyomer();
        if (moveMode === 'stationary') {
            if (superCooledMyomerActive) return 0;
            return hasXXLEngine ? 2 : 0;
        } else if (moveMode === 'walk') {
            if (superCooledMyomerActive) return 0;
            return hasXXLEngine ? 4 : 1;
        } else if (moveMode === 'run') {
            if (superCooledMyomerActive) return 0;
            return hasXXLEngine ? 6 : 2;
        } else if (moveMode === 'jump') {
            const distance = turnState.moveDistance() || 0;
            return this.computeJumpHeat(distance, hasXXLEngine);
        }
        return 0;
    }

    private computeJumpHeat(distance: number, hasXXLEngine: boolean): number {
        const partialWingBonus = this.partialWingJumpBonus();
        const heatDistance = Math.max(0, distance - partialWingBonus);
        const jumpJetType = this.getWorkingJumpJetType();
        const engineMultiplier = hasXXLEngine ? 2 : 1;
        if (jumpJetType === 'improved') {
            return Math.max(3, Math.ceil((heatDistance * engineMultiplier) / 2));
        }
        const prototypeMultiplier = jumpJetType === 'prototypeImproved' ? 2 : 1;
        const multiplier = engineMultiplier * prototypeMultiplier;
        const heat = heatDistance * multiplier;
        const minimum = 3 * multiplier;
        return Math.max(minimum, heat);
    }

    private partialWingJumpBonus(destroyedCriticals = this.systemsStatus().destroyedPartialWingsCount): number {
        const systemsStatus = this.systemsStatus();
        if (!systemsStatus.hasPartialWings) return 0;
        const maximumBonus = this.unit.getUnit().tons <= 55 ? 2 : 1;
        return Math.max(0, maximumBonus - destroyedCriticals);
    }

    private getWorkingJumpJetType(): 'standard' | 'improved' | 'prototypeImproved' {
        for (const slot of this.unit.getCritSlots()) {
            const equipment = slot.eq;
            if (this.isCritUnavailable(slot) || !equipment?.hasFlag('F_JUMP_JET')) continue;
            if (equipment.hasFlag('S_PROTOTYPE')) {
                return 'prototypeImproved';
            }
            if (equipment.hasFlag('S_IMPROVED')) return 'improved';
        }
        return 'standard';
    }

    private hasXXLEngine(): boolean {
        return this.unit.getUnit().engine?.startsWith('XXL ') ?? false;
    }

    private hasActiveSuperCooledMyomer(): boolean {
        const superCooledMyomerSlots = this.unit.getCritSlots().filter(slot => this.isSuperCooledMyomerSlot(slot));
        return superCooledMyomerSlots.length > 0
            && superCooledMyomerSlots.some(slot => !this.isCritUnavailable(slot));
    }

    private isSuperCooledMyomerSlot(slot: CriticalSlot): boolean {
        return slot.eq?.hasFlag('F_SCM') === true;
    }

    private computeDamagedEngineHeat(): number {
        if (this.unit.destroyed || this.unit.shutdown) return 0;
        const critSlots = this.unit.getCritSlots();
        const engineHits = critSlots.filter(slot => this.isNamedCrit(slot, 'Engine') && this.isDestroyedOrDestroyingCrit(slot)).length;
        return Math.min(10, engineHits * 5);
    }

    private damagedEngineSignature(): string {
        return this.unit.getCritSlots()
            .filter(slot => this.isNamedCrit(slot, 'Engine') && this.isDestroyedOrDestroyingCrit(slot))
            .map(slot => slot.id)
            .sort()
            .join('|');
    }

    override isCrewCockpitDestroyed(crewId: number): boolean {
        if (!this.hasCommandConsole()) return this.isCockpitDestroyed();
        if (crewId === 0) {
            return this.unit.getCritSlots().some(slot => this.isMainCockpitSlot(slot) && this.isCrewSeatDestroyed(slot));
        }
        if (crewId === 1) {
            return this.unit.getCritSlots().some(slot => this.isCommandConsoleSlot(slot) && this.isCrewSeatDestroyed(slot));
        }
        return false;
    }

    private isCockpitDestroyed(): boolean {
        return this.unit.getCritSlots().some(slot => this.isMainCockpitSlot(slot) && this.isCrewSeatDestroyed(slot));
    }

    private allCrewCockpitsUnavailable(crits: readonly CriticalSlot[]): boolean {
        const mainCockpitUnavailable = crits.some(slot => this.isMainCockpitSlot(slot) && this.isCritUnavailable(slot));
        if (!this.hasCommandConsole()) return mainCockpitUnavailable;
        const commandConsoleUnavailable = crits.some(slot => this.isCommandConsoleSlot(slot) && this.isCritUnavailable(slot));
        return mainCockpitUnavailable && commandConsoleUnavailable;
    }

    private hasMainCockpit(): boolean {
        return this.unit.getCritSlots().some(slot => this.isMainCockpitSlot(slot));
    }

    private hasCommandConsole(): boolean {
        return this.unit.getCritSlots().some(slot => this.isCommandConsoleSlot(slot));
    }

    private isMainCockpitSlot(slot: CriticalSlot): boolean {
        return this.isNamedCrit(slot, 'Cockpit') && !this.isCommandConsoleSlot(slot);
    }

    private isCommandConsoleSlot(slot: CriticalSlot): boolean {
        return slot.name === 'Command Console';
    }

    private isCrewSeatDestroyed(slot: CriticalSlot): boolean {
        if (slot.destroyed) return true;
        return slot.loc ? this.unit.isInternalLocCommittedDestroyed(slot.loc) : false;
    }

    protected hasTorsoMountedCockpit(): boolean {
        return this.unit.getCritSlots().some(slot => !!slot.loc && MEK_TORSO_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'Cockpit'));
    }

    override hasDamagedLifeSupport(): boolean {
        return this.unit.getCritSlots().some(slot =>
            this.isNamedCrit(slot, 'Life Support')
            && (!!slot.destroyed
                || !!slot.destroying
                || (slot.loc ? this.unit.isInternalLocDestroyed(slot.loc) : false)));
    }

    // ── Systems Status ───────────────────────────────────────────────────────

    /** Mek systems status computed from crit slots and locations */
    readonly systemsStatus = computed(() => {
        const critSlots = this.unit.getCritSlots();
        const hasMASC = critSlots.some(slot => this.isNamedCrit(slot, 'MASC'));
        const destroyedMASC = critSlots.some(slot => this.isNamedCrit(slot, 'MASC') && this.isCritUnavailable(slot));
        const hasSupercharger = critSlots.some(slot => this.isNamedCrit(slot, 'Supercharger'));
        const destroyedSupercharger = critSlots.some(slot => this.isNamedCrit(slot, 'Supercharger') && this.isCritUnavailable(slot));
        const jumpJetSlots = critSlots.filter(slot =>
            this.isNamedCrit(slot, 'Jump Jet') || this.isNamedCrit(slot, 'JumpJet'));
        const UMUSlots = critSlots.filter(slot => this.isNamedCrit(slot, 'UMU'));
        const jumpJetsCount = new Set(jumpJetSlots.map(slot => slot.id)).size;
        const destroyedJumpJetsCount = new Set(jumpJetSlots
            .filter(slot => this.isCritUnavailable(slot))
            .map(slot => slot.id)).size;
        const UMUCount = new Set(UMUSlots.map(slot => slot.id)).size;
        const destroyedUMUCount = new Set(UMUSlots
            .filter(slot => this.isCritUnavailable(slot))
            .map(slot => slot.id)).size;
        const hasPartialWings = critSlots.some(slot => slot.eq?.hasFlag('F_PARTIAL_WING'));
        const destroyedPartialWingsCount = hasPartialWings ? critSlots.filter(slot => slot.eq?.hasFlag('F_PARTIAL_WING') && this.isCritUnavailable(slot)).length : 0;
        const partialWingsHeatBonus = hasPartialWings ? Math.max(0, 3 - destroyedPartialWingsCount) : 0;
        const hasTripleStrengthMyomer = critSlots.some(slot => slot.eq?.hasFlag('F_TSM') && !slot.eq?.hasFlag('F_PROTOTYPE'));
        const cockpitLoc = critSlots.find(slot => this.isNamedCrit(slot, "Cockpit"))?.loc ?? 'HD';
        const destroyedSensorsCountInHD = critSlots.filter(slot => slot.loc === 'HD' && this.isNamedCrit(slot, 'Sensor') && this.isCritUnavailable(slot)).length;
        const destroyedSensorsCount = critSlots.filter(slot => this.isNamedCrit(slot, 'Sensor') && this.isCritUnavailable(slot)).length;

        const internalLocations = new Set<string>(this.unit.locations?.internal?.keys() || []);

        let destroyedLegsCount = 0;
        let destroyedHipsCount = 0;
        let destroyedLegActuatorsCount = 0;
        let destroyedFeetCount = 0;
        let destroyedLegAES = false;

        const checkLeg = (loc: string) => {
            if (!destroyedLegAES) {
                destroyedLegAES = critSlots.some(slot => slot.loc == loc && this.isNamedCrit(slot, 'AES') && this.isCritUnavailable(slot));
            }
            if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                destroyedLegsCount++;
            } else {
                destroyedHipsCount += critSlots.filter(slot => slot.loc === loc && this.isNamedCrit(slot, 'Hip') && this.isCritUnavailable(slot)).length;
                destroyedLegActuatorsCount += critSlots.filter(slot => slot.loc === loc && (this.isNamedCrit(slot, 'Upper Leg') || this.isNamedCrit(slot, 'Lower Leg')) && this.isCritUnavailable(slot)).length;
                destroyedFeetCount += critSlots.filter(slot => slot.loc === loc && this.isNamedCrit(slot, 'Foot') && this.isCritUnavailable(slot)).length;
            }
        };

        if (internalLocations.has('LL') && internalLocations.has('RL')) {
            // Biped and Tripods
            checkLeg('LL');
            checkLeg('RL');
            if (internalLocations.has('CL')) { // Tripods
                checkLeg('CL');
            }
        } else if (internalLocations.has('RLL') && internalLocations.has('FLL') && internalLocations.has('RRL') && internalLocations.has('FRL')) {
            // Quadrupeds
            checkLeg('RLL');
            checkLeg('FLL');
            checkLeg('RRL');
            checkLeg('FRL');
        }

        const legLocations = Array.from(internalLocations).filter(loc => LEG_LOCATIONS.has(loc));
        const legAESLocations = new Set(critSlots
            .filter(slot => slot.loc && LEG_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'AES'))
            .map(slot => slot.loc!));
        const hasLegAES = legLocations.length > 0 && legLocations.every(loc => legAESLocations.has(loc));
        const hasFunctionalLegAES = hasLegAES && !destroyedLegAES;

        let destroyedArmActuatorsCount = { 'LA': 0, 'RA': 0 };

        // Capabilities
        const getArmsModifiers = (loc: string) => {
            const armAESSlots = critSlots.filter(slot => slot.loc === loc && this.isNamedCrit(slot, 'AES'));
            const hasAES = armAESSlots.length > 0;
            const hasFunctionalAES = hasAES && armAESSlots.every(slot => !this.isCritUnavailable(slot));
            if (!this.unit.locations?.armor?.has(loc)) {
                return null;
            }

            const armSlots = critSlots.filter(slot => slot.loc === loc);
            const shoulderSlots = armSlots.filter(slot => this.isNamedCrit(slot, 'Shoulder'));
            const handSlots = armSlots.filter(slot => this.isNamedCrit(slot, 'Hand'));
            const upperArmSlots = armSlots.filter(slot => this.isNamedCrit(slot, 'Upper Arm'));
            const lowerArmSlots = armSlots.filter(slot => this.isNamedCrit(slot, 'Lower Arm'));
            // Shoulder and upper-arm actuators are mandatory on an arm. Their presence
            // confirms that the runtime critical-slot layout is complete enough for an
            // absent optional hand/lower-arm actuator to mean "missing by design".
            const hasCompleteArmLayout = shoulderSlots.length > 0 && upperArmSlots.length > 0;
            const missingHand = hasCompleteArmLayout && handSlots.length === 0;
            const missingLowerArm = hasCompleteArmLayout && lowerArmSlots.length === 0;
            const destroyedShoulder = shoulderSlots.some(slot => this.isCritUnavailable(slot));
            const destroyedHand = handSlots.some(slot => this.isCritUnavailable(slot));
            const destroyedUpperArmsCount = upperArmSlots.filter(slot => this.isCritUnavailable(slot)).length;
            const destroyedLowerArmsCount = lowerArmSlots.filter(slot => this.isCritUnavailable(slot)).length;
            const destroyedUpperArms = destroyedUpperArmsCount > 0;
            const destroyedLowerArms = destroyedLowerArmsCount > 0;
            destroyedArmActuatorsCount[loc as 'LA' | 'RA'] += destroyedUpperArmsCount + destroyedLowerArmsCount;

            return {
                destroyedShoulder,
                destroyedHand,
                destroyedUpperArms,
                destroyedLowerArms,
                missingHand,
                missingLowerArm,
                canPunch: !destroyedShoulder,
                canPhysWeapon: !destroyedShoulder && !destroyedHand,
                pushMod: destroyedShoulder ? 2 : 0,
                punchMod: ((destroyedHand || missingHand) ? 1 : 0)
                    + (destroyedUpperArms ? 2 : 0)
                    + ((destroyedLowerArms || missingLowerArm) ? 2 : 0),
                fireMod: destroyedShoulder ? 4 : (destroyedUpperArms ? 1 : 0)
                    + (destroyedLowerArms ? this.lowerArmFireModifier : 0), // lowerArmFireModifier is 0 in Core2026, 1 in TW
                physWeaponMod: (destroyedHand ? 2 : 0) + (destroyedUpperArms ? 2 : 0) + (destroyedLowerArms ? 2 : 0)
                    - (hasFunctionalAES ? 1 : 0),
                hasAES,
                hasFunctionalAES,
                singleArmMod: hasFunctionalAES ? -1 : 0,
            };
        };
        const locationModifiers: Record<string, MekArmStatus | null> = {
            'LA': getArmsModifiers('LA'),
            'RA': getArmsModifiers('RA'),
        };

        return {
            hasMASC,
            destroyedMASC,
            hasSupercharger,
            destroyedSupercharger,
            jumpJetsCount,
            destroyedJumpJetsCount,
            UMUCount,
            destroyedUMUCount,
            hasPartialWings,
            destroyedPartialWingsCount,
            partialWingsHeatBonus,
            internalLocations,
            hasTripleStrengthMyomer,
            tripleStrengthMyomerMoveBonusActive: (this.unit.getHeat().current >= 9 && hasTripleStrengthMyomer),
            cockpitLoc,
            destroyedSensorsCountInHD,
            destroyedSensorsCount,
            destroyedLegAES,
            hasLegAES,
            hasFunctionalLegAES,
            destroyedLegsCount,
            destroyedHipsCount,
            destroyedLegActuatorsCount,
            destroyedFeetCount,
            destroyedArmActuatorsCount,
            locationModifiers: locationModifiers,
        };
    });

    // ── PSR ──────────────────────────────────────────────────────────────────

    override readonly PSRModifiers = computed<{ modifier: number; modifiers: PSRCheck[] }>(() => {
        const ignoreLeg = new Set<string>();
        let preExisting = 0;
        const modifiers: PSRCheck[] = [];

        const { config, destroyedLegs } = this.currentLegState();
        const undamagedLegs = destroyedLegs.length === 0;
        // Calculate pre-existing leg destruction modifiers. If a leg is gone, is gone.
        for (const loc of destroyedLegs) {
            ignoreLeg.add(loc); // Track destroyed legs, we ignore further modifiers on that leg
        }
        const destroyedLegModifiers = this.getPreExistingDestroyedLegPSRModifiers(config, destroyedLegs);
        preExisting += destroyedLegModifiers.reduce((total, modifier) => total + (modifier.pilotCheck ?? 0), 0);
        modifiers.push(...destroyedLegModifiers);
        if (undamagedLegs) {
            if (config === 'Tripod') {
                preExisting -= 1; // Tripod unit with all legs intact gets -1 modifier
                modifiers.push({
                    pilotCheck: -1,
                    reason: "No Destroyed Legs"
                });
            } else
            if (config === 'Quad') {
                preExisting -= 2; // Four-legged unit with all legs intact gets -2 modifier
                modifiers.push({
                    pilotCheck: -2,
                    reason: "No Destroyed Legs"
                });
            }
        }
        // Calculate current turn modifiers
        let ignorePreExistingGyro = false;
        let currentModifiers = 0;
        const turnState = this.unit.turnState();
        const phasePSRs = turnState.getPSRChecks();
        phasePSRs.forEach((check) => {
            if (check.pilotCheck === undefined) return; // No fall check, skip
            if (check.loc) {
                if (ignoreLeg.has(check.loc)) {
                    return; // Ignore this leg for further calculations
                }
            }
            currentModifiers += check.pilotCheck;
            if (check.legFilter) {
                ignoreLeg.add(check.legFilter); // Ignore this leg for further calculations
            }
            if (check.ignorePreExistingGyro) {
                ignorePreExistingGyro = true;
            }
            modifiers.push(check);
        });

        // Calculate pre-existing modifiers for hips and leg actuators destroyed the previous turns
        const critSlots = this.unit.getCritSlots();
        const hasAESinLegs = critSlots.some(slot => slot.name && slot.loc && !this.isCritUnavailable(slot) && LEG_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'AES'));
        const hasAESinLegsDestroyed = critSlots.some(slot => slot.name && slot.loc && this.isCritUnavailable(slot) && LEG_LOCATIONS.has(slot.loc) && this.isNamedCrit(slot, 'AES'));
        if (hasAESinLegs && !hasAESinLegsDestroyed) {
            preExisting -= 2; // AES in legs intact gives -2 modifier
            modifiers.push({
                pilotCheck: -2,
                reason: "Mounts AES in its legs"
            });
        }
        const hardenedArmor = this.unit.getUnit().armorType === 'Hardened';
        if (hardenedArmor) {
            preExisting += 1; // Hardened armor gives +1 modifier
            modifiers.push({
                pilotCheck: 1,
                reason: "Mounts Hardened Armor"
            });
        }
        if (this.modularArmorState().active) {
            preExisting += 1; // Modular armor gives +1 modifier (until destroyed or fully consumed)
            modifiers.push({
                pilotCheck: 1,
                reason: "Mounts Modular Armor"
            });
        }
        const hasSmallOrTorsoCockpit = critSlots.some(slot => slot.loc
            && ((this.isNamedCrit(slot, 'Cockpit') && this.isNamedCrit(slot, 'Small'))
                || (this.isNamedCrit(slot, 'Command') && this.isNamedCrit(slot, 'Small'))))
            || this.hasTorsoMountedCockpit();
        if (hasSmallOrTorsoCockpit && !this.hasDroneOperatingSystem()) {
            preExisting += 1; // Small or Torso cockpit gives +1 modifier
            modifiers.push({
                pilotCheck: +1,
                reason: "Mounts small or torso cockpit"
            });
        }
        for (const pilotingModifier of this.psrModifiers()) {
            preExisting += pilotingModifier.modifier;
            modifiers.push({
                pilotCheck: pilotingModifier.modifier,
                reason: pilotingModifier.label
            });
        }
        const legActuatorModifiers = this.getPreExistingLegActuatorPSRModifiers(critSlots, ignoreLeg);
        preExisting += legActuatorModifiers.modifier;
        modifiers.push(...legActuatorModifiers.modifiers);
        if (!ignorePreExistingGyro) {
            const gyroModifier = this.preExistingGyroPSRModifier(this.gyroPSRModifierHitCount());
            if (gyroModifier) {
                preExisting += gyroModifier.pilotCheck ?? 0;
                modifiers.push(gyroModifier);
            }
        }
        const finalModifier = preExisting + currentModifiers;
        return { modifier: finalModifier, modifiers: sortPSRModifiers(modifiers) };
    });

    protected getPreExistingDestroyedLegPSRModifiers(
        config: MekConfig,
        destroyedLegs: readonly string[],
    ): PSRCheck[] {
        if (config !== 'Quad') {
            const modifier = this.destroyedLegPSR(false).pilotCheck;
            return destroyedLegs.map(loc => ({
                pilotCheck: modifier,
                loc,
                reason: 'Leg Destroyed',
            }));
        }

        let modifier = 0;
        if (destroyedLegs.length <= 2) {
            modifier = destroyedLegs.length;
        } else if (destroyedLegs.length === 3) {
            modifier = this.destroyedLegPSR(false).pilotCheck;
        }
        if (modifier === 0) return [];
        return [{
            pilotCheck: modifier,
            ...(destroyedLegs.length === 1 && { loc: destroyedLegs[0] }),
            reason: 'Leg Destroyed',
            ...(destroyedLegs.length > 1 && { modifierReason: `Legs Destroyed (${destroyedLegs.length})` }),
        }];
    }

    protected getPreExistingLegActuatorPSRModifiers(
        critSlots: readonly CriticalSlot[],
        ignoreLeg: Set<string>,
    ): { modifier: number; modifiers: PSRCheck[] } {
        const relevantSlots = critSlots.filter(slot => slot.loc
            && LEG_LOCATIONS.has(slot.loc)
            && !ignoreLeg.has(slot.loc)
            && this.isCritUnavailable(slot));
        const slotsByLocation = new Map<string, CriticalSlot[]>();
        for (const slot of relevantSlots) {
            const slots = slotsByLocation.get(slot.loc!) ?? [];
            slots.push(slot);
            slotsByLocation.set(slot.loc!, slots);
        }
        const modifiers: PSRCheck[] = [];
        for (const [loc, slots] of slotsByLocation) {
            const destroyedHipsCount = slots.filter(slot => this.isNamedCrit(slot, 'Hip')).length;
            const destroyedLegActuatorsCount = slots.filter(slot => this.isNamedCrit(slot, 'Leg')).length;
            if (destroyedHipsCount > 0) {
                modifiers.push({
                    pilotCheck: destroyedHipsCount * this.hipPSRModifier,
                    loc,
                    reason: 'Hip Destroyed',
                });
            }
            if (destroyedLegActuatorsCount > 0) {
                modifiers.push({
                    pilotCheck: destroyedLegActuatorsCount,
                    loc,
                    reason: 'Leg Actuator(s) Destroyed',
                    modifierReason: destroyedLegActuatorsCount === 1
                        ? 'Leg Actuator Destroyed'
                        : `Leg Actuators Destroyed (${destroyedLegActuatorsCount})`,
                });
            }
        }
        return {
            modifier: modifiers.reduce((total, modifier) => total + (modifier.pilotCheck ?? 0), 0),
            modifiers,
        };
    }

    protected gyroPSRModifierHitCount(): number {
        const countPendingHits = this.hasHeavyDutyGyro();
        return this.unit.getCritSlots().filter(slot => {
            if (!this.isNamedCrit(slot, 'Gyro')) return false;
            return countPendingHits
                ? this.isDestroyedOrDestroyingCrit(slot)
                : this.isCritUnavailable(slot);
        }).length;
    }

    protected preExistingGyroPSRModifier(destroyedGyroCount: number): PSRCheck | null {
        if (destroyedGyroCount === 0) return null;
        if (this.hasHeavyDutyGyro()) {
            return {
                pilotCheck: destroyedGyroCount,
                reason: 'Heavy-Duty Gyro damaged',
            };
        }
        return {
            pilotCheck: this.gyroHitPSRModifier,
            reason: 'Gyro damaged',
        };
    }

    override readonly PSRTargetRoll = computed<number>(() => {
        const modifiers = this.PSRModifiers();
        return this.getBasePilotingSkill() + modifiers.modifier;
    });

    override getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null {
        const movement = this.movementState();
        if (moveMode === 'walk') return movement?.maxWalk ?? 0;
        if (moveMode === 'run') return movement?.maxRun ?? 0;
        if (moveMode === 'jump') return movement?.jump ?? 0;
        if (moveMode === 'UMU') return movement?.UMU ?? 0;
        return null;
    }

    override isMotiveModeAvailable(moveMode: MotiveModes): boolean {
        if (this.immobile()) return moveMode === 'stationary';
        const movement = this.movementState();
        if (moveMode === 'walk') return (movement?.walk ?? 0) > 0;
        if (moveMode === 'run') {
            return (movement?.run ?? 0) > 0 || this.getRunningMinimumMovementDistance() > 0;
        }
        if (moveMode === 'jump') return (movement?.jump ?? 0) > 0;
        if (moveMode === 'UMU') return (movement?.UMU ?? 0) > 0;
        return true;
    }

    protected getRunningMinimumMovementDistance(): number {
        return 0;
    }

    protected destroyedLegStandThreshold(config: MekConfig): number {
        return config === 'Quad' ? 3 : 1;
    }

    protected isMovementPSRFoldedIntoStandAttempt(_turnState: TurnState): boolean {
        return false;
    }

    protected isDestroyedLegStandException(config: MekConfig, destroyedLegs: number): boolean {
        return destroyedLegs === this.destroyedLegStandThreshold(config);
    }

    override canStandUp(turnState: TurnState): boolean {
        if (turnState.carefulStand()) return false;
        if (!turnState.unitState.hasCondition('prone')) return false;
        if (this.immobile()) return false;
        if (this.gyroPSRModifierHitCount() >= this.gyroDestructionHitThreshold()) return false;
        // Standing normally costs MP, and Minimum Movement can only reduce that
        // cost when the Mek still has at least 1 usable Walking MP.
        if ((this.movementState()?.walk ?? 0) < 1) return false;
        const { config, destroyedLegs, destroyedArms, hasIntactLeg } = this.currentLegState();
        if (!hasIntactLeg || destroyedLegs.length > this.destroyedLegStandThreshold(config)) return false;
        return config === 'Quad' || destroyedLegs.length !== 1 || destroyedArms.length !== 2;
    }

    override canStandWithoutPSR(_turnState: TurnState): boolean {
        const { config, allLegsIntact } = this.currentLegState();
        return config === 'Quad' && allLegsIntact;
    }

    override canCarefulStand(turnState: TurnState): boolean {
        if (!this.supportsCarefulStand) return false;
        if (!this.canStandUp(turnState)) return false;
        const walkingMp = this.movementState()?.walk ?? 0;
        const standAttemptMp = Math.max(0, turnState.standAttempts() ?? 0) * 2;
        return walkingMp - standAttemptMp >= 3;
    }

    override getStandAttemptMovementMode(turnState: TurnState): MotiveModes | null {
        const { config, destroyedLegs } = this.currentLegState();
        if (this.isDestroyedLegStandException(config, destroyedLegs.length)
            || this.movementState()?.walk === 1) {
            return 'run';
        }
        return turnState.moveMode() === 'run' ? 'run' : 'walk';
    }

    override getMovementPointsSpent(turnState: TurnState): number {
        const standAttemptMp = Math.max(0, turnState.standAttempts() ?? 0) * 2;
        const moveMode = turnState.moveMode();
        const movementCapacity = moveMode === null
            ? 0
            : this.getEffectiveMaxDistanceForMoveMode(moveMode, turnState) ?? 0;
        return turnState.carefulStand()
            ? movementCapacity
            : standAttemptMp; // We return the full value so the user can clearly see they over-attempted
    }

    override getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, turnState: TurnState): number | null {
        if (moveMode !== 'run') return this.getMaxDistanceForMoveMode(moveMode);
        const movement = this.movementState();
        if (!movement) return 0;
        if (movement.run === 0) return this.getRunningMinimumMovementDistance();

        const runValueCoeff = 1.5 + this.unit.getRunMovementMultiplierBonus(turnState);
        const armorModifierOnRun = (this.unit.getUnit().armorType === 'Hardened') ? -1 : 0;
        return Math.max(0, Math.round(movement.walk * runValueCoeff) + armorModifierOnRun);
    }

    override getAttackMovementModifier(moveMode: MotiveModes | null | undefined, airborne: boolean = false): number {
        const baseUnit = this.unit.getUnit();
        // LAM have different movement modifiers when airborne
        if (baseUnit.subtype === 'Land-Air BattleMek' && airborne) { 
            if (moveMode === 'walk') return 3;
            if (moveMode === 'run') return 4;
        }
        return getDefaultAttackerMovementModifier(moveMode);
    }

    override getSpottingModifier(): number {
        return this.canUseCommandConsole() ? 0 : 1;
    }

    override getBaseGunnerySkill(): number {
        const gunnerCrewId = this.isTripodMek() ? 1 : 0;
        return this.getTargetNumberCrewSkill('gunnery', gunnerCrewId) ?? super.getBaseGunnerySkill();
    }

    override getBasePilotingSkill(): number {
        return this.getTargetNumberCrewSkill('piloting', 0) ?? super.getBasePilotingSkill();
    }

    override getActivePilotCrewId(): number | null {
        return this.getActiveCrewMember(0)?.getId()
            ?? this.getFirstActiveAlternateCrewMember(0)?.getId()
            ?? null;
    }

    protected override buildRuleModifiers(): UnitRuleModifier[] {
        const modifiers: UnitRuleModifier[] = [];
        if (this.isTripodMek()) {
            const dedicatedGunneryOfficer = this.unit.getCrewMember(1);
            if (dedicatedGunneryOfficer && !this.isActiveCrewMember(dedicatedGunneryOfficer)) {
                modifiers.push({ label: 'Dedicated Gunnery Officer disabled', values: { ranged: 2 }, weakened: true });
            }
            const dedicatedPilot = this.unit.getCrewMember(0);
            if (dedicatedPilot) {
                const modifier = this.isActiveCrewMember(dedicatedPilot) ? -1 : 2;
                modifiers.push({
                    label: modifier < 0 ? 'Dedicated Pilot' : 'Dedicated Pilot disabled',
                    ...(modifier > 0 && { weakened: true }),
                    values: { physical: modifier, psr: modifier },
                });
            }
        }
        const proneModifier = this.proneAttackerModifier();
        if (proneModifier !== null) modifiers.push(proneModifier);
        if (this.isSuperheavy()) {
            modifiers.push({ label: 'Superheavy', values: { physical: 1 } });
        }
        const fire = this.fireControl();
        if (fire?.torsoCockpitHeadSensorModifier) {
            modifiers.push({
                label: 'Head Sensors Destroyed (Torso-Mounted Cockpit)',
                values: { ranged: fire.torsoCockpitHeadSensorModifier },
                weakened: true,
            });
        }
        if (fire?.heatFireModifier) {
            modifiers.push({
                label: 'Heat - Fire Modifier',
                values: { ranged: fire.heatFireModifier },
                weakened: true,
                kind: 'heat',
            });
        }
        if (fire?.rangedSensorModifier) {
            modifiers.push({ label: 'Sensors Destroyed', values: { ranged: fire.rangedSensorModifier }, weakened: true });
        }
        return modifiers;
    }

    protected isSuperheavy(): boolean {
        return this.unit.getUnit().tons > 100;
    }

    private isTripodMek(): boolean {
        return this.unit.getUnit().subtype.startsWith('Tripod');
    }

    private isQuadrupedMek(): boolean {
        return QUAD_LEG_LOCATIONS.some(loc => this.unit.locations?.internal?.has(loc));
    }

    private canUseCommandConsole(): boolean {
        return this.hasMainCockpit()
            && this.hasCommandConsole()
            && this.getActiveCrewMember(0) !== null // Pilot can pilot...
            && this.getActiveCrewMember(1) !== null // ... and commander can command!
            && !this.isCrewCockpitDestroyed(1);
    }

    private getActiveCrewMember(crewId: number): CrewMember | null {
        const crewMember = this.unit.getCrewMember(crewId);
        return crewMember && this.isActiveCrewMember(crewMember) ? crewMember : null;
    }

    private isActiveCrewMember(crewMember: CrewMember): boolean {
        return crewMember.getState() === 'healthy';
    }

    private getTargetNumberCrewSkill(skillType: SkillType, primaryCrewId: number): number | null {
        const primaryCrewMember = this.getActiveCrewMember(primaryCrewId);
        if (primaryCrewMember) return primaryCrewMember.getSkill(skillType);
        return this.getFirstActiveAlternateCrewMember(primaryCrewId)?.getSkill(skillType) ?? null;
    }

    private getFirstActiveAlternateCrewMember(primaryCrewId: number): CrewMember | null {
        return this.unit.getCrewMembers()
            .filter(crewMember => crewMember.getId() !== primaryCrewId && this.isActiveCrewMember(crewMember))[0] ?? null;
    }

    private proneAttackerModifier(): UnitRuleModifier | null {
        if (!this.unit.getCondition('prone')) return null;
        const subtype = this.unit.getUnit().subtype;
        const isTripod = subtype.startsWith('Tripod');
        const isQuad = subtype.startsWith('Quad');
        if (!isTripod && !isQuad) {
            return { label: 'Prone', values: { ranged: TN_PRONE_ATTACKER }, weakened: true };
        }

        const config = isTripod ? 'Tripod' : 'Quad';
        let modifier = isTripod ? 1 : 0;
        for (const loc of getMekLegLocations(config)) {
            if (!this.unit.locations?.internal?.has(loc) || this.unit.isInternalLocCommittedDestroyed(loc)) {
                modifier = TN_PRONE_ATTACKER;
            }
        }
        const hasCommittedHipHit = this.unit.getCritSlots().some(slot => {
            if (!slot.loc || !isMekLegLocation(config, slot.loc)) return false;
            if (!this.isNamedCrit(slot, 'Hip')) return false;
            return this.isCritUnavailable(slot);
        });
        return {
            label: isTripod ? 'Prone Tripod' : 'Prone Quad',
            values: { ranged: hasCommittedHipHit ? TN_PRONE_ATTACKER : modifier },
            weakened: true,
        };
    }

    override getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries = [...super.getDefenseModifierBreakdown(turnState)];
        if (turnState.unitState.hasCondition('prone')) {
            entries.push({
                label: 'Prone',
                modifier: Math.max(TN_PRONE, TN_PRONE_ADJACENT),
                alternateModifier: Math.min(TN_PRONE, TN_PRONE_ADJACENT),
                alternateModifierLabel: 'adjacent',
            });
        }
        return entries;
    }

    // ── Heat Scale ───────────────────────────────────────────────────────────

    /**
     * BattleTech Heat Scale
     * Sorted by heat level. Each entry carries the cumulative effect at that threshold.
     * - move:     MP penalty (negative)
     * - fire:     to-hit modifier (positive)
     * - shutdown: target number to avoid shutdown (100 = virtually automatic, no roll)
     * - ammoExp:  target number to avoid ammo explosion
     */
    static readonly HEAT_SCALE: readonly HeatScaleEntry[] = [
        { heat: 5,  move: -1 },
        { heat: 8,  fire: 1 },
        { heat: 10, move: -2 },
        { heat: 13, fire: 2 },
        { heat: 14, shutdown: 4 },
        { heat: 15, move: -3 },
        { heat: 17, fire: 3 },
        { heat: 18, shutdown: 6 },
        { heat: 19, ammoExp: 4 },
        { heat: 20, move: -4 },
        { heat: 22, shutdown: 8 },
        { heat: 23, ammoExp: 6 },
        { heat: 24, fire: 4 },
        { heat: 25, move: -5 },
        { heat: 26, shutdown: 10 },
        { heat: 28, ammoExp: 8 },
        { heat: 30, shutdown: 100 }, // always fails
    ];
    override readonly heatScale = MekRules.HEAT_SCALE;

    override heatLifeSupportPilotHits(heat: number): number {
        if (!this.hasDamagedLifeSupport() || heat <= 0) return 0;

        if (this.hasTorsoMountedCockpit()) return heat >= 15 ? 2 : 1;
        if (heat >= 20) return 2;
        return heat >= 10 ? 1 : 0;
    }

    override headHitPilotHits(): number {
        return this.hasTorsoMountedCockpit() ? 0 : 1;
    }

    override submergedLifeSupportPilotHits(): number {
        return this.hasDamagedLifeSupport() && this.unit.turnState().submerged() ? 1 : 0;
    }

    /** Compute heat-based move/fire modifiers from current heat level. */
    static getHeatEffects(heat: number): { moveModifier: number; fireModifier: number } {
        return getHeatEffects(MekRules.HEAT_SCALE, heat);
    }

    // ── Heat Dissipation ─────────────────────────────────────────────────────

    /**
     * Mek heat dissipation: extends base with SuperCooledMyomer and partial wing bonus.
     */
    override readonly heatDissipation = computed(() => {
        const base = this.heatMgmt.baseDissipation();
        if (!base) return null;

        const profile = this.heatMgmt.heatsinkProfile();
        const critSlots = this.unit.getCritSlots();

        // SuperCooledMyomer destroyed reduces dissipation
        const destroyedSuperCooledMyomer = critSlots.filter(
            slot => this.isSuperCooledMyomerSlot(slot) && this.isCritUnavailable(slot)
        ).length;

        let totalDissipation = base.totalDissipation;
        if (destroyedSuperCooledMyomer > 0 && profile) {
            totalDissipation -= destroyedSuperCooledMyomer * profile.engineDissipationPer;
            totalDissipation = Math.max(0, totalDissipation);
        }

        totalDissipation += this.unit.getEquipmentHeatDissipationBonus?.(base) ?? 0;

        // Partial wing heat bonus
        const partialWingBonus = this.systemsStatus().hasPartialWings
            ? Math.max(0, 3 - this.systemsStatus().destroyedPartialWingsCount)
            : 0;

        return {
            ...base,
            totalDissipation,
            destroyedSuperCooledMyomer,
            /** Total dissipation including partial wing bonus (for heat profile display). */
            totalDissipationWithWings: totalDissipation + partialWingBonus,
            partialWingBonus,
        };
    });

    // ── Movement State ───────────────────────────────────────────────────────

    // Derive movement profile from the unit conditions, before any heat effect or other modifiers are applied.
    private computeBaseMovementProfile() {
        if (!this.unit.isLoaded()) return null;
        const unit = this.unit.getUnit();
        if (!unit) return null;

        const systemsStatus = this.systemsStatus();
        const mobilityEquipment = this.mobilityEquipmentState();
        const restoredWalk = unit.walk + this.restoredEquipmentWalkMP(mobilityEquipment);
        const restoredRun = Math.max(
            0,
            Math.round(restoredWalk * 1.5) + (unit.armorType === 'Hardened' ? -1 : 0),
        );
        const baselineJump = this.equipmentAdjustedJumpBaseline(
            unit.jump,
            this.installedComponentQuantity('F_JUMP_JET'),
            mobilityEquipment,
        );
        const baselineUMU = this.equipmentAdjustedUMUBaseline(
            unit.umu,
            this.installedComponentQuantity('F_UMU'),
            mobilityEquipment,
        );
        let walkValue = restoredWalk;
        let jumpValue = baselineJump;
        let UMUValue = baselineUMU;
        let moveImpaired = false;

        const internalLocations = systemsStatus.internalLocations;
        const isBiped = internalLocations.has('LL') && internalLocations.has('RL');
        const isQuadruped = internalLocations.has('RLL') && internalLocations.has('FLL')
            && internalLocations.has('RRL') && internalLocations.has('FRL');
        const legMovement = this.applyLegDamageToMovement(
            walkValue,
            restoredRun,
            systemsStatus,
            isBiped,
            isQuadruped,
        );
        walkValue = legMovement.walk;
        moveImpaired = legMovement.moveImpaired;
        const actuatorMovementReduction = this.legActuatorMovementReduction();
        if (legMovement.applyActuatorDamage) {
            walkValue -= actuatorMovementReduction;
        }
        walkValue = Math.max(
            this.legDamageMinimumWalk(restoredWalk, systemsStatus.destroyedLegsCount, isBiped, isQuadruped),
            Math.min(restoredWalk, walkValue),
        );
        if (actuatorMovementReduction !== 0) {
            moveImpaired = true;
        }
        
        // Jump MP
        if (systemsStatus.destroyedJumpJetsCount === systemsStatus.jumpJetsCount) {
            jumpValue = 0;
        } else {
            jumpValue = Math.max(0, jumpValue - systemsStatus.destroyedJumpJetsCount);
            if (systemsStatus.hasPartialWings) {
                jumpValue = Math.max(
                    0,
                    jumpValue - (this.partialWingJumpBonus(0) - this.partialWingJumpBonus()),
                );
            }
        }

        if (systemsStatus.destroyedUMUCount === systemsStatus.UMUCount) {
            UMUValue = 0;
        } else {
            UMUValue = Math.max(0, UMUValue - systemsStatus.destroyedUMUCount);
        }

        return {
            baselineWalk: restoredWalk,
            baselineJump,
            baselineUMU,
            walk: walkValue,
            runDisabled: legMovement.runDisabled,
            runCap: legMovement.runCap,
            jump: jumpValue,
            UMU: UMUValue,
            moveImpaired,
            jumpImpaired: jumpValue < baselineJump,
            UMUImpaired: UMUValue < baselineUMU,
        };
    }

    protected legActuatorMovementReduction(): number {
        const systemsStatus = this.systemsStatus();
        return systemsStatus.destroyedLegActuatorsCount + systemsStatus.destroyedFeetCount;
    }

    protected legDamageMinimumWalk(
        preDamageWalk: number,
        destroyedLegsCount: number,
        isBiped: boolean,
        isQuadruped: boolean,
    ): number {
        if (preDamageWalk < 1 || (!isBiped && !isQuadruped)) return 0;
        const allLegsDestroyed = isQuadruped
            ? destroyedLegsCount >= 4
            : destroyedLegsCount >= 2;
        return allLegsDestroyed ? 0 : 1;
    }

    private restoredEquipmentWalkMP(equipment: MekMobilityEquipmentState): number {
        return (equipment.modularArmorInstalled && !equipment.modularArmorActive ? 1 : 0)
            + equipment.mediumShieldsInstalled - equipment.mediumShieldsActive
            + equipment.largeShieldsInstalled - equipment.largeShieldsActive;
    }

    private installedComponentQuantity(flag: EquipmentFlag): number {
        return this.unit.getUnit().comp.reduce((total, component) =>
            total + (component.eq?.hasFlag(flag) ? component.q : 0), 0);
    }

    private equipmentAdjustedJumpBaseline(
        storedJump: number,
        installedJumpJets: number,
        equipment: MekMobilityEquipmentState,
    ): number {
        if (equipment.largeShieldsActive > 0) return 0;

        const hasInstalledPenalty = equipment.modularArmorInstalled
            || equipment.mediumShieldsInstalled > 0
            || equipment.largeShieldsInstalled > 0;
        if (!hasInstalledPenalty) return storedJump;
        if (installedJumpJets === 0) return 0;

        const partialWingBonus = this.partialWingJumpBonus(0);
        const activePenalty = equipment.mediumShieldsActive
            + (equipment.modularArmorActive ? 1 : 0);
        return Math.max(0, installedJumpJets + partialWingBonus - activePenalty);
    }

    private equipmentAdjustedUMUBaseline(
        storedUMU: number,
        installedUMUs: number,
        equipment: MekMobilityEquipmentState,
    ): number {
        if (equipment.largeShieldsActive > 0) return 0;
        if (equipment.largeShieldsInstalled === 0) return storedUMU;
        return installedUMUs;
    }

    private mobilityEquipmentState(): MekMobilityEquipmentState {
        const modularArmor = this.modularArmorState();
        const config = inferMekConfigFromLocations(this.unit.locations?.internal.keys() ?? []);
        const shields = config === 'Quad'
            ? []
            : this.unit.getInventory().filter(entry =>
                entry.equipment?.hasFlag('F_SHIELD')
                && entry.equipment.hasAnyFlag(['S_SHIELD_LARGE', 'S_SHIELD_MEDIUM']));
        const mediumShields = shields.filter(entry => entry.equipment?.hasFlag('S_SHIELD_MEDIUM'));
        const largeShields = shields.filter(entry => entry.equipment?.hasFlag('S_SHIELD_LARGE'));
        return {
            modularArmorInstalled: modularArmor.installed,
            modularArmorActive: modularArmor.active,
            mediumShieldsInstalled: mediumShields.length,
            mediumShieldsActive: mediumShields.filter(entry => this.shieldRetainsMobilityPenalty(entry)).length,
            largeShieldsInstalled: largeShields.length,
            largeShieldsActive: largeShields.filter(entry => this.shieldRetainsMobilityPenalty(entry)).length,
        };
    }

    private modularArmorState(): { installed: boolean; active: boolean } {
        const panels = this.unit.getCritSlots().filter(slot =>
            slot.eq?.hasFlag('F_MODULAR_ARMOR') || this.isNamedCrit(slot, 'Modular Armor'));
        return {
            installed: panels.length > 0,
            active: panels.some(slot => !this.isCritUnavailable(slot) && (slot.consumed ?? 0) < 10),
        };
    }

    protected shieldRetainsMobilityPenalty(entry: MountedEquipment): boolean {
        // Core removes the Mobility Modifier as soon as either live shield
        // track reaches 0, or when the shield itself has no surviving slot.
        if (entry.committedDestroyed() || this.allShieldCriticalsUnavailable(entry)) return false;
        const state = this.getShieldDamageState(entry);
        return state !== null && state.absorption > 0 && state.capacity > 0;
    }

    protected allShieldCriticalsUnavailable(entry: MountedEquipment): boolean {
        const criticals = this.entryCriticalSlots(entry);
        return criticals.length > 0 && criticals.every(slot => !this.unit.isEquipmentOperational(slot));
    }

    protected applyLegDamageToMovement(
        walk: number,
        unitRun: number,
        damage: MekLegDamageState,
        isBiped: boolean,
        isQuadruped: boolean
    ): MekLegMovementResult {
        let runDisabled = false;
        let runCap: number | null = null;
        let moveImpaired = false;
        let applyActuatorDamage = true;

        if (isBiped) {
            if (damage.destroyedLegsCount === 1) {
                walk = Math.min(walk, 1);
                runCap = Math.min(unitRun, 2);
                moveImpaired = true;
                applyActuatorDamage = false;
            } else if (damage.destroyedLegsCount >= 2) {
                walk = 0;
                runDisabled = true;
                moveImpaired = true;
            } else {
                walk -= damage.destroyedHipsCount;
            }
        } else if (isQuadruped) {
            if (damage.destroyedHipsCount !== 0) {
                walk -= damage.destroyedHipsCount;
                moveImpaired = true;
            }
            if (damage.destroyedLegsCount <= 2) {
                walk -= damage.destroyedLegsCount;
            } else if (damage.destroyedLegsCount === 3) {
                walk = Math.min(walk, 1);
                runCap = Math.min(unitRun, 2);
                applyActuatorDamage = false;
            } else {
                walk = 0;
                runDisabled = true;
            }
        }

        return { walk, runDisabled, runCap, moveImpaired, applyActuatorDamage };
    }

    private baseRunValue(movement: { walk: number; runDisabled: boolean; runCap: number | null }): number {
        if (movement.walk <= 0 || movement.runDisabled) return 0;
        const run = Math.round(movement.walk * 1.5);
        return movement.runCap === null ? run : Math.min(run, movement.runCap);
    }

    // Returns the movement capabilities of the unit after applying heat, damage and other modifiers.
    private computeMovementState() {
        const unit = this.unit.getUnit();
        if (!unit) return null;
        const baseMovement = this.computeBaseMovementProfile();
        if (!baseMovement) return null;

        if (this.unit.getCondition('disconnected') || this.allCrewUnconscious()) {
            return {
                moveImpaired: true,
                walk: 0,
                maxWalk: 0,
                run: 0,
                maxRun: 0,
                jumpImpaired: baseMovement.baselineJump > 0,
                jump: 0,
                UMUImpaired: baseMovement.baselineUMU > 0,
                UMU: 0,
            };
        }

        const systemsStatus = this.systemsStatus();
        let walkValue = baseMovement?.walk ?? 0;

        // Heat effects
        const heat = this.unit.getHeat().current;
        const heatMoveModifier = MekRules.getHeatEffects(heat).moveModifier;

        walkValue += heatMoveModifier;
        walkValue = Math.max(0, walkValue);
        let maxWalkValue = walkValue;
        if (systemsStatus.destroyedLegsCount === 0) {
            if (systemsStatus.tripleStrengthMyomerMoveBonusActive) {
                walkValue += 2;
                maxWalkValue += 2;
            } else if (systemsStatus.hasTripleStrengthMyomer) {
                maxWalkValue += 1 - heatMoveModifier; // Simulate heat at 9+
            }
            walkValue = Math.max(0, walkValue);
        }

        // Run MP
        const hasWorkingMASC = systemsStatus.hasMASC && !systemsStatus.destroyedMASC;
        const hasWorkingSupercharger = systemsStatus.hasSupercharger && !systemsStatus.destroyedSupercharger;
        const armorModifierOnRun = (unit.armorType === 'Hardened') ? -1 : 0;
        let runValue: number;
        let maxRunValue: number;
        if (walkValue === 0 || baseMovement.runDisabled) {
            runValue = 0;
            maxRunValue = 0;
        } else {
            runValue = Math.round(walkValue * 1.5) + armorModifierOnRun;
            let runValueCoeff = 1.5;
            if (hasWorkingMASC && hasWorkingSupercharger) {
                runValueCoeff = 2.5;
            } else if (hasWorkingMASC || hasWorkingSupercharger) {
                runValueCoeff = 2;
            }
            maxRunValue = Math.round(walkValue * runValueCoeff) + armorModifierOnRun;
            if (systemsStatus.hasTripleStrengthMyomer && !systemsStatus.tripleStrengthMyomerMoveBonusActive) {
                maxRunValue = Math.round((walkValue + (1 - heatMoveModifier)) * runValueCoeff) + armorModifierOnRun;
            }
            if (baseMovement.runCap !== null) {
                runValue = Math.min(runValue, baseMovement.runCap);
                maxRunValue = Math.min(maxRunValue, baseMovement.runCap);
            }
        }

        return {
            moveImpaired: baseMovement.moveImpaired || (walkValue < baseMovement.baselineWalk),
            walk: walkValue,
            maxWalk: maxWalkValue,
            run: runValue,
            maxRun: maxRunValue,
            jumpImpaired: baseMovement.jumpImpaired,
            jump: baseMovement.jump,
            UMUImpaired: baseMovement.UMUImpaired,
            UMU: baseMovement.UMU
        };
    };

    readonly movementState = computed(() => {
        return this.computeMovementState();
    });

    // ── Physical Combat State ────────────────────────────────────────────────

    /**
     * Derived physical combat capabilities: kick/punch/push/club availability
     * and hit modifiers from actuator/arm damage.
     */
    readonly physicalCombat = computed(() => {
        if (!this.unit.isLoaded()) return null;

        const systemsStatus = this.systemsStatus();
        const destroyedLA = this.unit.isInternalLocCommittedDestroyed('LA');
        const destroyedRA = this.unit.isInternalLocCommittedDestroyed('RA');
        const locationModifiers = systemsStatus.locationModifiers;

        const chargeDamage = this.chargeDamage();

        return {
            canKick: systemsStatus.destroyedLegsCount === 0 && systemsStatus.destroyedHipsCount === 0,
            kickMod: (systemsStatus.destroyedLegActuatorsCount * 2) + systemsStatus.destroyedFeetCount
                - (systemsStatus.hasFunctionalLegAES ? 1 : 0),
            canPunch: {
                'LA': (locationModifiers['LA']?.canPunch && !destroyedLA) || false,
                'RA': (locationModifiers['RA']?.canPunch && !destroyedRA) || false,
            },
            punchMod: {
                'LA': locationModifiers['LA']?.punchMod || 0,
                'RA': locationModifiers['RA']?.punchMod || 0,
            },
            canPhysWeapon: {
                'LA': (locationModifiers['LA']?.canPhysWeapon && !destroyedLA) || false,
                'RA': (locationModifiers['RA']?.canPhysWeapon && !destroyedRA) || false,
            },
            physWeaponMod: {
                'LA': locationModifiers['LA']?.physWeaponMod || 0,
                'RA': locationModifiers['RA']?.physWeaponMod || 0,
            },
            canPush: !destroyedLA && !destroyedRA,
            pushMod: (locationModifiers['LA']?.pushMod || 0) + (locationModifiers['RA']?.pushMod || 0)
                - (locationModifiers['LA']?.hasFunctionalAES && locationModifiers['RA']?.hasFunctionalAES ? 1 : 0),
            canClub: (locationModifiers['LA']?.canPhysWeapon && !destroyedLA) && (locationModifiers['RA']?.canPhysWeapon && !destroyedRA),
            clubMod: (locationModifiers['LA']?.physWeaponMod || 0) + (locationModifiers['RA']?.physWeaponMod || 0)
                + (locationModifiers['LA']?.hasFunctionalAES && locationModifiers['RA']?.hasFunctionalAES ? 1 : 0),
            chargeDamage,
        };
    });

    override chargeDamage(): ChargeDamage {
        const critSlots = this.unit.getCritSlots();
        const totalSpikes = critSlots.filter(slot => this.isNamedCrit(slot, 'Spikes')).length;
        const workingSpikes = critSlots.filter(slot => this.isNamedCrit(slot, 'Spikes') && !this.isCritStructurallyDestroyed(slot)).length;
        return this.computeChargeDamage(workingSpikes * 2, totalSpikes * 2);
    }

    override applyInventoryControlDisplayEffects(entry: MountedEquipment, display: InventoryControlDisplayData): InventoryControlDisplayData {
        if (entry.equipment?.hasFlag('F_SHIELD')) {
            return { ...display, damage: this.resolveShieldDamageDisplay(entry).text };
        }
        const chargeDisplay = super.applyInventoryControlDisplayEffects(entry, display);
        if (chargeDisplay !== display) return chargeDisplay;

        let attackType: 'punch' | 'kick' | 'club' | 'physWeapon' | null = null;
        let location: string | undefined;
        let ignoreMyomer = false;
        if (entry.isIntrinsicPhysicalAttack()) {
            switch (entry.name.toLowerCase()) {
                case 'punch':
                    attackType = 'punch';
                    location = Array.from(entry.locations ?? [])[0];
                    break;
                case 'club':
                    attackType = 'club';
                    break;
                case 'kick':
                case 'kick [talons]':
                    attackType = 'kick';
                    break;
            }
        } else if (entry.isPhysicalWeapon()) {
            attackType = 'physWeapon';
            ignoreMyomer = !!entry.equipment?.flags.has('S_FLAIL');
        }
        if (!attackType) return display;
        const resolved = this.resolveInventoryMeleeDamageDisplay(
            entry,
            display.damage,
            attackType,
            location,
            ignoreMyomer,
        );
        return resolved ? { ...display, damage: resolved.text } : display;
    }

    resolveInventoryMeleeDamageDisplay(
        entry: MountedEquipment,
        displayedDamage: string,
        attackType: 'punch' | 'kick' | 'club' | 'physWeapon',
        location?: string,
        ignoreMyomer = false,
    ): { damage: number; text: string; weakened: boolean } | undefined {
        const resolvedAttackType = attackType === 'physWeapon' && entry.equipment?.hasFlag('S_CLAW')
            ? 'claw'
            : attackType;
        const resolvedLocation = resolvedAttackType === 'claw'
            ? location ?? Array.from(entry.locations ?? [])[0]
            : location;
        // Punches are derived from unit facts so a Core-generated sheet cannot bake in a shield bonus that is then
        // applied again, and changing to TW can remove that bonus without regenerating the SVG.
        const baseDamage = resolvedAttackType === 'punch'
            ? this.basePunchDamage()
            : Number.parseInt(displayedDamage, 10);
        if (!Number.isFinite(baseDamage)) return undefined;
        return this.resolveMeleeDamageDisplay(entry, baseDamage, resolvedAttackType, resolvedLocation, ignoreMyomer);
    }

    resolveMeleeDamageDisplay(
        entry: MountedEquipment,
        baseDamage: number,
        attackType: 'punch' | 'kick' | 'club' | 'physWeapon' | 'claw',
        location?: string,
        ignoreMyomer = false,
    ): { damage: number; text: string; weakened: boolean } {
        const effect = this.unit.getEffectivePhysicalDamageEffect(entry, {
            baseDamage,
            ignoreMyomer,
        });
        const designBaselineDamage = attackType === 'punch'
            ? this.getPunchDesignBaselineDamage(effect.baseDamage, location)
            : effect.baseDamage;
        const { damage, maxDamage } = this.computeMeleeDamage(
            effect.baseDamage,
            attackType,
            location,
            effect.ignoreMyomer,
        );
        return {
            damage,
            text: damage === maxDamage ? `${damage}` : `${damage} [${maxDamage}]`,
            weakened: damage < designBaselineDamage,
        };
    }

    resolveShieldDamageDisplay(entry: MountedEquipment): { damage: number | null; text: string; weakened: boolean } {
        const profile = resolveShieldProfile(entry.equipment);
        if (!profile) {
            return { damage: null, text: '—', weakened: false };
        }
        const location = this.shieldArmLocation(entry);
        if (!this.standaloneShieldDamageEnabled) {
            const damage = location ? this.getShieldBashDamageBonus(location) : 0;
            return damage > 0
                ? { damage, text: `+${damage}`, weakened: false }
                : { damage: null, text: '—', weakened: false };
        }
        const damage = this.getShieldDamageState(entry)?.absorption ?? 0;
        return {
            damage,
            text: `${damage}`,
            weakened: damage < profile.damageAbsorption,
        };
    }

    // ── Fire Control State ───────────────────────────────────────────────────

    /**
     * Derived fire control: weapon-fire availability, sensor damage modifiers,
     * heat-based to-hit penalties, and per-arm fire modifiers.
     */
    readonly fireControl = computed(() => {
        if (!this.unit.isLoaded()) return null;

        const systemsStatus = this.systemsStatus();
        const heat = this.unit.getHeat().current;
        const heatFireModifier = MekRules.getHeatEffects(heat).fireModifier;

        let canFire = true;
        if (systemsStatus.cockpitLoc === 'HD' && systemsStatus.destroyedSensorsCount >= 2) {
            canFire = false;
        } else if (systemsStatus.destroyedSensorsCount >= 3) {
            canFire = false;
        }

        let rangedSensorModifier = 0;
        if (systemsStatus.cockpitLoc === 'HD' && systemsStatus.destroyedSensorsCount > 0) {
            rangedSensorModifier = systemsStatus.destroyedSensorsCount * 2;
        } else if (systemsStatus.cockpitLoc !== 'HD' && systemsStatus.destroyedSensorsCountInHD < 2 && systemsStatus.destroyedSensorsCount >= 1) {
            rangedSensorModifier = systemsStatus.destroyedSensorsCount * 2;
        }

        let torsoCockpitHeadSensorModifier = 0;
        if (systemsStatus.cockpitLoc !== 'HD' && systemsStatus.destroyedSensorsCountInHD >= 2) {
            torsoCockpitHeadSensorModifier = 4;
        }

        const locationModifiers = systemsStatus.locationModifiers;
        return {
            canFire,
            heatFireModifier,
            rangedSensorModifier,
            fireMod: {
                'LA': locationModifiers['LA']?.fireMod || 0,
                'RA': locationModifiers['RA']?.fireMod || 0,
            },
            torsoCockpitHeadSensorModifier,
            singleArmMod: {
                'LA': locationModifiers['LA']?.singleArmMod || 0,
                'RA': locationModifiers['RA']?.singleArmMod || 0,
            },
        };
    });

    override canPerformEquipmentAction(entry: MountedEquipment, action: EquipmentAction): boolean {
        if (action === 'fire') return this.fireControl()?.canFire ?? true;
        if (action !== 'physical-attack') return true;
        if (entry.equipment?.hasFlag('F_SHIELD') && !this.standaloneShieldDamageEnabled) return false;

        const physical = this.physicalCombat();
        if (!physical) return true;
        if (entry.isIntrinsicPhysicalAttack()) {
            switch (entry.name.toLowerCase()) {
                case 'punch': {
                    const loc = Array.from(entry.locations ?? [])[0] as ArmLocation | undefined;
                    return loc === undefined || !(loc in physical.canPunch) || physical.canPunch[loc] === true;
                }
                case 'club':
                    return physical.canClub === true;
                case 'push':
                    return physical.canPush;
                case 'kick [talons]':
                case 'kick':
                    return physical.canKick;
                default:
                    return true;
            }
        }
        if (!entry.isPhysicalWeapon()) return true;
        return Array.from(entry.locations ?? []).every(location =>
            !(location in physical.canPhysWeapon) || physical.canPhysWeapon[location as ArmLocation] === true
        );
    }

    override hasIndependentInventoryControlAction(entry: MountedEquipment): boolean {
        return !entry.equipment?.hasFlag('F_SHIELD') || this.standaloneShieldDamageEnabled;
    }

    override getMountedCriticalStatusContribution(facts: EquipmentStatusFacts): EquipmentStatus {
        const destroyedCriticalCount = facts.criticals.filter(critical => critical.status === 'destroyed').length;
        if (facts.equipmentFlags.has('F_SHIELD')) {
            const profile = resolveShieldProfile(facts.equipment ?? undefined);
            if (!profile) return destroyedCriticalCount > 0 ? 'destroyed' : 'available';
            const location = facts.criticals
                .map(critical => critical.location)
                .find((candidate): candidate is ArmLocation => candidate === 'LA' || candidate === 'RA')
                ?? Array.from(facts.locationStates.keys())
                    .find((candidate): candidate is ArmLocation => candidate === 'LA' || candidate === 'RA');
            const { absorption, capacity } = this.shieldDamageState(profile, destroyedCriticalCount, location);
            return absorption > 0 && capacity > 0 ? 'available' : 'destroyed';
        }
        const threshold = this.mountedCriticalDamageDestructionThreshold(facts.equipment);
        const singleCritical = facts.criticals.length === 1 ? facts.criticals[0] : null;
        const criticalDamage = threshold > 1 && singleCritical
            ? Math.max(0, singleCritical.committedHits - (singleCritical.armored ? 1 : 0))
            : destroyedCriticalCount;
        return criticalDamage >= threshold ? 'destroyed' : 'available';
    }

    override mountedCriticalDamageDestructionThreshold(equipment: Equipment | null): number {
        return equipment?.hasFlag('F_AC') ? 2 : 1;
    }

    override getEquipmentToHitModifiers(entry: MountedEquipment): readonly ToHitModifierBreakdownEntry[] {
        const hitModifierBreakdown: ToHitModifierBreakdownEntry[] = [];
        const physical = this.physicalCombat();
        const fire = this.fireControl();
        const systemsStatus = this.systemsStatus();
        if (!physical || !fire) {
            return [...hitModifierBreakdown, ...this.getUnitEquipmentToHitModifiers(entry)];
        }

        if (entry.isIntrinsicPhysicalAttack()) {
            switch (entry.name.toLowerCase()) {
                case 'punch': {
                    const loc = Array.from(entry.locations!)[0] as ArmLocation;
                    if (loc in physical.punchMod) {
                        this.addArmActuatorBreakdown(hitModifierBreakdown, systemsStatus.locationModifiers[loc], loc, {
                            hand: 1,
                            upperArm: 2,
                            lowerArm: 2
                        }, true);
                    }
                    const aesModifier = fire.singleArmMod[loc] ?? 0;
                    this.addArmAESBreakdown(hitModifierBreakdown, systemsStatus.locationModifiers[loc], loc, aesModifier);
                    break;
                }
                case 'club':
                    this.addTwoArmPhysicalBreakdown(hitModifierBreakdown, systemsStatus.locationModifiers, 'club');
                    break;
                case 'push':
                    this.addTwoArmPhysicalBreakdown(hitModifierBreakdown, systemsStatus.locationModifiers, 'push');
                    break;
                case 'kick [talons]':
                case 'kick':
                    if (systemsStatus.destroyedLegActuatorsCount > 0) {
                        hitModifierBreakdown.push({
                            label: this.countedDestroyedLabel('Leg Actuator', systemsStatus.destroyedLegActuatorsCount),
                            modifier: systemsStatus.destroyedLegActuatorsCount * 2,
                            weakened: true
                        });
                    }
                    if (systemsStatus.destroyedFeetCount > 0) {
                        hitModifierBreakdown.push({
                            label: this.countedDestroyedLabel('Foot Actuator', systemsStatus.destroyedFeetCount),
                            modifier: systemsStatus.destroyedFeetCount,
                            weakened: true
                        });
                    }
                    if (systemsStatus.hasFunctionalLegAES) {
                        hitModifierBreakdown.push({ label: 'Leg AES', modifier: -1 });
                    } else if (systemsStatus.hasLegAES) {
                        hitModifierBreakdown.push({ label: 'Leg AES Destroyed', modifier: 0, weakened: true });
                    }
                    break;
            }
        } else if (entry.isPhysicalWeapon()) {
            entry.locations?.forEach(loc => {
                if (loc in physical.physWeaponMod) {
                    const armLoc = loc as ArmLocation;
                    const armStatus = systemsStatus.locationModifiers[armLoc];
                    this.addArmActuatorBreakdown(hitModifierBreakdown, armStatus, armLoc, {
                        hand: 2,
                        upperArm: 2,
                        lowerArm: 2
                    });
                    this.addArmAESBreakdown(hitModifierBreakdown, armStatus, armLoc, armStatus?.singleArmMod ?? 0);
                }
            });
        } else {
            if (entry.locations?.size === 1) {
                const singleLoc = Array.from(entry.locations)[0];
                if (singleLoc in fire.singleArmMod) {
                    const armStatus = systemsStatus.locationModifiers[singleLoc];
                    if (armStatus?.hasAES) {
                        hitModifierBreakdown.push(armStatus.hasFunctionalAES
                            ? { label: `Arm AES (${singleLoc})`, modifier: -1 }
                            : { label: `Arm AES Destroyed (${singleLoc})`, modifier: 0, weakened: true });
                    }
                }
            }
            entry.locations?.forEach(loc => {
                if (!(loc in fire.fireMod)) return;
                const armStatus = systemsStatus.locationModifiers[loc];
                const armModifier = fire.fireMod[loc as ArmLocation];
                if (!armStatus || armModifier === 0) return;
                if (armStatus.destroyedShoulder) {
                    hitModifierBreakdown.push({ label: `Shoulder Destroyed (${loc})`, modifier: armModifier, weakened: true });
                    return;
                }
                if (armStatus.destroyedUpperArms) {
                    hitModifierBreakdown.push({ label: `Upper Arm Actuator Destroyed (${loc})`, modifier: 1, weakened: true });
                }
                if (armStatus.destroyedLowerArms && this.lowerArmFireModifier !== 0) {
                    hitModifierBreakdown.push({ label: `Lower Arm Actuator Destroyed (${loc})`, modifier: this.lowerArmFireModifier, weakened: true });
                }
            });
            const tarcompWeapon = entry.parent ?? entry;
            hitModifierBreakdown.push(...this.getMountedTargetingComputerModifiers(tarcompWeapon));
        }
        return [...hitModifierBreakdown, ...this.getUnitEquipmentToHitModifiers(entry)];
    }

    private addArmActuatorBreakdown(
        breakdown: ToHitModifierBreakdownEntry[],
        armStatus: ReturnType<MekRules['systemsStatus']>['locationModifiers'][string],
        loc: ArmLocation,
        modifiers: { hand: number; upperArm: number; lowerArm: number },
        includeMissing = false
    ): void {
        if (!armStatus) return;
        if (armStatus.destroyedHand) {
            breakdown.push({ label: `Hand Actuator Destroyed (${loc})`, modifier: modifiers.hand, weakened: true });
        } else if (includeMissing && armStatus.missingHand) {
            breakdown.push({ label: `Hand Actuator Missing (${loc})`, modifier: modifiers.hand });
        }
        if (armStatus.destroyedUpperArms) {
            breakdown.push({ label: `Upper Arm Actuator Destroyed (${loc})`, modifier: modifiers.upperArm, weakened: true });
        }
        if (armStatus.destroyedLowerArms) {
            breakdown.push({ label: `Lower Arm Actuator Destroyed (${loc})`, modifier: modifiers.lowerArm, weakened: true });
        } else if (includeMissing && armStatus.missingLowerArm) {
            breakdown.push({ label: `Lower Arm Actuator Missing (${loc})`, modifier: modifiers.lowerArm });
        }
    }

    private addArmAESBreakdown(
        breakdown: ToHitModifierBreakdownEntry[],
        armStatus: ReturnType<MekRules['systemsStatus']>['locationModifiers'][string],
        loc: ArmLocation,
        modifier: number
    ): void {
        if (!armStatus?.hasAES) return;
        breakdown.push(armStatus.hasFunctionalAES
            ? { label: `Arm AES (${loc})`, modifier }
            : { label: `Arm AES Destroyed (${loc})`, modifier: 0, weakened: true });
    }

    private addTwoArmPhysicalBreakdown(
        breakdown: ToHitModifierBreakdownEntry[],
        locationModifiers: ReturnType<MekRules['systemsStatus']>['locationModifiers'],
        attack: 'club' | 'push'
    ): void {
        const arms = (['LA', 'RA'] as const).map(loc => ({ loc, status: locationModifiers[loc] }));
        if (attack === 'push') {
            for (const { loc, status } of arms) {
                if (status?.destroyedShoulder) {
                    breakdown.push({ label: `Shoulder Destroyed (${loc})`, modifier: 2, weakened: true });
                }
            }
        } else {
            for (const { loc, status } of arms) {
                this.addArmActuatorBreakdown(breakdown, status, loc, { hand: 2, upperArm: 2, lowerArm: 2 });
            }
        }

        const functionalAES = arms.filter(arm => arm.status?.hasFunctionalAES);
        if (attack === 'push' && functionalAES.length === 2) {
            breakdown.push({ label: 'Paired Arm AES', modifier: -1 });
        } else if (attack === 'club' && functionalAES.length > 0) {
            breakdown.push({
                label: functionalAES.length === 2 ? 'Paired Arm AES' : `Arm AES (${functionalAES[0].loc})`,
                modifier: -1
            });
        } else if ((attack === 'push' && this.hasBrokenPairedArmAES(locationModifiers))
            || (attack === 'club' && this.hasLostClubAESBonus(locationModifiers))) {
            breakdown.push({ label: 'Arm AES Destroyed', modifier: 0, weakened: true });
        }
    }

    private countedDestroyedLabel(name: string, count: number): string {
        return count === 1 ? `${name} Destroyed` : `${name}s Destroyed ×${count}`;
    }

    private hasBrokenArmAES(
        locationModifiers: ReturnType<MekRules['systemsStatus']>['locationModifiers'],
        loc: string
    ): boolean {
        const armStatus = locationModifiers[loc];
        return !!armStatus?.hasAES && !armStatus.hasFunctionalAES;
    }

    private hasBrokenPairedArmAES(locationModifiers: ReturnType<MekRules['systemsStatus']>['locationModifiers']): boolean {
        const left = locationModifiers['LA'];
        const right = locationModifiers['RA'];
        return !!left?.hasAES && !!right?.hasAES && (!left.hasFunctionalAES || !right.hasFunctionalAES);
    }

    private hasLostClubAESBonus(locationModifiers: ReturnType<MekRules['systemsStatus']>['locationModifiers']): boolean {
        const arms = [locationModifiers['LA'], locationModifiers['RA']];
        return arms.some(arm => arm?.hasAES) && arms.every(arm => !arm?.hasFunctionalAES);
    }

    private entryInPhysicallyDestroyedLocation(entry: MountedEquipment): boolean {
        if (this.entryCriticalSlots(entry).some(slot => this.locationPhysicallyDestroyed(slot.loc))) return true;
        return Array.from(entry.locations ?? []).some(loc => this.locationPhysicallyDestroyed(loc));
    }

    private entryInFunctionallyDestroyedLocation(entry: MountedEquipment): boolean {
        if (this.entryCriticalSlots(entry).some(slot => this.locationFunctionallyDestroyed(slot.loc))) return true;
        return Array.from(entry.locations ?? []).some(loc => this.locationFunctionallyDestroyed(loc));
    }

    private locationPhysicallyDestroyed(loc: string | undefined): boolean {
        if (!loc) return false;
        return this.unit.isInternalLocCommittedStructurallyDestroyed(loc);
    }

    private locationFunctionallyDestroyed(loc: string | undefined): boolean {
        if (!loc) return false;
        return this.unit.isInternalLocCommittedDestroyed(loc);
    }

    /**
     * Compute melee damage after actuator losses and TSM modifiers.
     * @param baseDamage   - unmodified base damage for the attack
     * @param attackType   - which melee attack (determines which actuators matter)
     * @param loc          - arm location (for punch/claw)
     * @param ignoreMyomer - true for weapons immune to TSM bonus (e.g. flails)
     */
    computeMeleeDamage(
        baseDamage: number,
        attackType: 'punch' | 'kick' | 'club' | 'physWeapon' | 'claw',
        loc?: string,
        ignoreMyomer?: boolean
    ): { damage: number; maxDamage: number } {
        const ss = this.systemsStatus();
        let damage = baseDamage;

        if (attackType === 'punch' && loc) {
            damage += this.getShieldBashDamageBonus(loc);
        }

        // Punch and claw damage are halved for each destroyed upper/lower arm actuator. A lower-arm actuator absent by
        // design is also applied to fact-derived punch damage, but not to claw damage.
        if ((attackType === 'punch' || attackType === 'claw') && loc) {
            const armStatus = ss.locationModifiers[loc];
            const unavailableActuators = ss.destroyedArmActuatorsCount[loc as ArmLocation]
                + (attackType === 'punch' && armStatus?.missingLowerArm ? 1 : 0);
            for (let i = 0; i < unavailableActuators; i++) {
                damage = Math.floor(damage * 0.5);
                if (damage < 1) damage = 1;
            }
        } else if (attackType === 'kick') {
            for (let i = 0; i < ss.destroyedLegActuatorsCount; i++) {
                damage = Math.floor(damage * 0.5);
                if (damage < 1) damage = 1;
            }
        }

        // TSM modifier
        let maxDamage = damage;
        if (!ignoreMyomer) {
            if (ss.hasTripleStrengthMyomer) maxDamage *= 2;
            if (ss.tripleStrengthMyomerMoveBonusActive) damage *= 2;
        }

        return { damage, maxDamage };
    }

    private basePunchDamage(): number {
        const baseDamage = Math.ceil(this.unit.getUnit().tons / 10);
        return this.unit.getUnit().subtype === 'Land-Air BattleMek' ? Math.ceil(baseDamage / 2) : baseDamage;
    }

    private getPunchDesignBaselineDamage(baseDamage: number, loc?: string): number {
        if (!loc || !this.systemsStatus().locationModifiers[loc]?.missingLowerArm) return baseDamage;
        return Math.max(Math.floor(baseDamage * 0.5), 1);
    }

    private getShieldBashDamageBonus(loc: string): number {
        if (!this.shieldBashPunchBonusEnabled || (loc !== 'LA' && loc !== 'RA')) return 0;
        for (const entry of this.unit.getMountedEquipmentByFlag('F_SHIELD')) {
            const profile = resolveShieldProfile(entry.equipment);
            if (!profile || !this.shieldMountsAt(entry, loc)) continue;
            // Pending damage must not remove the committed bonus early.
            const state = this.getShieldDamageState(entry);
            if (!state || state.absorption === 0 || state.capacity === 0) continue;
            return profile.bashBonus;
        }
        return 0;
    }

    /**
     * Effective damage shown on a shield DA/DC track. Critical-slot and arm
     * actuator losses are derived rather than persisted as ordinary shield
     * hits, so repairing a critical cannot accidentally repair combat damage.
     */
    getShieldTrackHits(trackLocation: string, includePending = false): number | null {
        const match = /^(DA|DC)(LA|RA)$/.exec(trackLocation);
        if (!match) return null;

        const track = match[1] as 'DA' | 'DC';
        const loc = match[2] as ArmLocation;
        const entry = this.unit.getMountedEquipmentByFlag('F_SHIELD')
            .find(candidate => this.shieldMountsAt(candidate, loc));
        if (!entry) return null;

        const profile = resolveShieldProfile(entry.equipment);
        const state = this.getShieldDamageState(entry, includePending);
        if (!profile || !state) return null;
        const maximum = track === 'DA' ? profile.damageAbsorption : profile.damageCapacity;
        const remaining = track === 'DA' ? state.absorption : state.capacity;
        return Math.min(maximum, Math.max(0, maximum - remaining));
    }

    private getShieldDamageState(
        entry: MountedEquipment,
        includePending = false,
    ): { absorption: number; capacity: number } | null {
        const profile = resolveShieldProfile(entry.equipment);
        if (!profile) return null;

        const loc = this.shieldArmLocation(entry);
        const mountUnavailable = entry.committedDestroyed() || (includePending && entry.isDestroying());
        const locationUnavailable = loc !== undefined && (includePending
            ? this.unit.isInternalLocDestroyed(loc)
            : this.unit.isInternalLocCommittedDestroyed(loc));
        if (mountUnavailable || locationUnavailable) return { absorption: 0, capacity: 0 };

        const destroyedCriticalCount = this.shieldCriticalSlots(entry, loc)
            .filter(slot => includePending ? this.isDestroyedOrDestroyingCrit(slot) : !!slot.destroyed)
            .length;
        return this.shieldDamageState(profile, destroyedCriticalCount, loc, includePending);
    }

    private shieldDamageState(
        profile: ShieldProfile,
        destroyedCriticalCount: number,
        loc: ArmLocation | undefined,
        includePending = false,
    ): { absorption: number; capacity: number } {
        const actuatorPenalty = loc ? this.shieldActuatorPenalty(loc, includePending) : 0;
        const absorptionHits = loc
            ? (includePending ? this.unit.getArmorHits(`DA${loc}`) : this.unit.getCommittedArmorHits(`DA${loc}`))
            : 0;
        const capacityHits = loc
            ? (includePending ? this.unit.getArmorHits(`DC${loc}`) : this.unit.getCommittedArmorHits(`DC${loc}`))
            : 0;
        return {
            absorption: Math.max(0, profile.damageAbsorption - destroyedCriticalCount - actuatorPenalty - absorptionHits),
            capacity: Math.max(0, profile.damageCapacity - (destroyedCriticalCount * 5) - actuatorPenalty - capacityHits),
        };
    }

    private shieldActuatorPenalty(loc: ArmLocation, includePending: boolean): number {
        if (!includePending) {
            const armStatus = this.systemsStatus().locationModifiers[loc];
            return (armStatus?.destroyedShoulder ? 2 : 0)
                + (armStatus?.destroyedUpperArms ? 1 : 0)
                + (armStatus?.destroyedLowerArms ? 1 : 0)
                + (armStatus?.destroyedHand ? 1 : 0);
        }

        const unavailable = (name: string) => this.unit.getCritSlots().some(slot =>
            slot.loc === loc && this.isNamedCrit(slot, name) && this.isDestroyedOrDestroyingCrit(slot));
        return (unavailable('Shoulder') ? 2 : 0)
            + (unavailable('Upper Arm') ? 1 : 0)
            + (unavailable('Lower Arm') ? 1 : 0)
            + (unavailable('Hand') ? 1 : 0);
    }

    private shieldCriticalSlots(entry: MountedEquipment, loc?: string): CriticalSlot[] {
        return this.entryCriticalSlots(entry).filter(slot => !loc || slot.loc === loc);
    }

    private shieldArmLocation(entry: MountedEquipment): ArmLocation | undefined {
        return Array.from(entry.locations ?? []).find((loc): loc is ArmLocation => loc === 'LA' || loc === 'RA')
            ?? this.entryCriticalSlots(entry)
                .map(slot => slot.loc)
                .find((loc): loc is ArmLocation => loc === 'LA' || loc === 'RA');
    }

    private shieldMountsAt(entry: MountedEquipment, loc: ArmLocation): boolean {
        return entry.locations?.has(loc) === true || this.entryCriticalSlots(entry).some(slot => slot.loc === loc);
    }

    protected isNamedCrit(slot: CriticalSlot, name: string): boolean {
        return (slot.name && slot.name.includes(name)) ? true : false;
    }

    protected hasHeavyDutyGyro(): boolean {
        return this.unit.getCritSlots().some(slot => {
            const normalizedName = slot.name?.replace(/[\s-]/g, '').toLowerCase() ?? '';
            return normalizedName.includes('heavydutygyro');
        });
    }
}
