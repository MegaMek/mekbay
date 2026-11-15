// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
    AttackResolutionDialogComponent,
    type AttackResolution,
    type AttackResolutionDialogData,
    type AttackResolutionTarget,
    type PhysicalAttackOutcome,
} from '../components/attack-resolution-dialog/attack-resolution-dialog.component';
import {
    IncomingAttackDialogComponent,
    type IncomingAttackDialogData,
} from '../components/incoming-attack-dialog/incoming-attack-dialog.component';
import { CBTForce } from '../models/cbt-force.model';
import { WeaponEquipment } from '../models/equipment.model';
import { gameRulesFor } from '../models/rules/game-rules';
import { isCBTMekForceMember, type CBTForceMember } from '../models/force-member.model';
import { hasMekRuntime } from '../models/cbt-unit-snapshot';
import { mekUnitWaterState } from '../models/runtime/mek-targeting-rules';
import { attackDamageSource, PHYSICAL_DAMAGE, type DamageSource } from '../models/rules/armor-damage-rules';
import {
    hitTableDice,
    physicalAttackPilotChecks,
    physicalStrike,
    physicalStrikesRandomSide,
    physicalSelfDamage,
} from '../models/rules/physical-attack-rules';
import type { MekPhysicalAttackCheckTriggerKindV2 } from '../models/runtime/mek-movement-psr-v2';
import {
    damageGroups,
    attackHeatWeapon,
    physicalAttackProfile,
    platoonAttackProfile,
    toHitSucceeds,
    weaponAttackProfile,
    type WeaponAttackProfile,
} from '../models/rules/weapon-attack-resolution';
import { isInfantryFamilyEntity, isMekEntity, isVehicleEntity } from '../models/entity/utils/entity-type-guards';
import {
    aimedShotLocations,
    readAttackHeat,
    readAttackHitLocation,
    readInfernoMissiles,
    type AttackHitLocation,
} from '../models/runtime/attack-hit-location';
import type { InfernoMissile } from '../models/rules/inferno-rules';
import { heatWeaponTarget } from '../models/rules/heat-weapon-rules';
import { aimedShotDice } from '../models/rules/aimed-shot-rules';
import { isAntiMekAttack, splitSwarmedHits } from '../models/rules/anti-mek-attack-rules';
import { aimedShotChoices, targetMekConfig } from '../models/runtime/aimed-shot-choices';
import { activeTargetCalculator, type TargetingTarget } from '../models/runtime/targeting-target';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import {
    AimedShotDialogComponent,
    type AimedShotDialogData,
} from '../components/aimed-shot-dialog/aimed-shot-dialog.component';
import { ATTACK_ARC_LABELS } from '../components/attack-report/attack-report.component';
import { MekPaperdollGenerator } from '../utils/sheets/mek-paperdoll-generator';
import { isNavalRecordSheetEntity } from '../utils/sheets/layouts/naval-record-sheet-layout';
import { combatVehiclePaperdollAsset, navalPaperdollAsset } from '../utils/sheets/layouts/vehicle-paperdoll-asset';
import { roll2D6, rollD6 } from '../models/runtime/mek-automation-rules';
import type { WeaponHits } from '../models/runtime/cbt-force-unit-command-dispatcher';
import { TURN_STEPS } from '../models/rules/turn-sequence';
import type { MekHitArc } from '../utils/record-sheet-reference-table';
import {
    physicalAttackMeetsPartialCover,
    physicalAttackTargetNumber,
    physicalRowTargetIssue,
    projectTargetingTarget,
    projectWeaponTargetPresentation,
    resolveEffectiveWeaponTypes,
    selectedAmmoEquipment,
    type EquipmentPanelComponent,
    type EquipmentPanelSnapshot,
    type WeaponAttackContext,
} from '../models/runtime/equipment-panel';
import { uuidv4 } from '../utils/uuid.util';
import { DialogsService } from './dialogs.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService, type AttackEvent, type AttackWeaponReport } from './game-events.service';
import { SwarmService } from './swarm.service';
import { MEK_TORSO_LOCATIONS } from '../models/entity/types';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { UnitNameService } from './unit-name.service';

const MAX_REMEMBERED_ATTACKS = 200;

/**
 * Optional attack resolution: after FIRE the attacker rolls every weapon against its target, hits on linked
 * OPFOR units go to their owner, and the owner accepts them onto the struck unit's sheet.
 */
@Injectable({ providedIn: 'root' })
export class AttackResolutionService {
    private readonly options = inject(OptionsService);
    private readonly dialogs = inject(DialogsService);
    private readonly gameEvents = inject(GameEventsService);
    private readonly opfor = inject(InventoryControlOpforService);
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly injector = inject(Injector);
    private readonly unitNames = inject(UnitNameService);
    private readonly toast = inject(ToastService);
    private readonly receivedAttacks = new Set<string>();
    private incoming: Promise<void> = Promise.resolve();

    constructor() {
        this.gameEvents.received.subscribe(({ toForce, event, fromDisplayName }) => {
            if (event.kind !== 'attack' || this.receivedAttacks.has(event.id)) return;
            this.receivedAttacks.add(event.id);
            // Duplicates arrive close together, so only recent ids are remembered.
            if (this.receivedAttacks.size > MAX_REMEMBERED_ATTACKS) {
                this.receivedAttacks.delete(this.receivedAttacks.values().next().value!);
            }
            // One incoming attack at a time, in arrival order; a failed one must not stall the rest.
            this.incoming = this.incoming.then(() => this.receive(toForce, event, fromDisplayName)).catch(() => {
                this.receivedAttacks.delete(event.id);
                this.toast.showToast(`Could not show ${event.attacker}'s attack`, 'error');
            });
        });
    }

    /** Whether FIRE rolls the attacks: declared physical attacks then resolve even without weapon fire. */
    resolvesAttacks(): boolean {
        return this.options.options().attackResolution === true;
    }

    /** With real phases, a unit in the Physical Attack Phase makes only physical attacks. */
    inPhysicalPhase(member: CBTForceMember): boolean {
        const turnStep = member.force.getUnitSnapshot(member.id)?.state.turn.turnStep ?? 0;
        return this.options.options().realPhases && TURN_STEPS[turnStep]?.phase === 'physical';
    }

    /**
     * Whether the unit may declare aimed shots now: attacks are resolved here, and under the full phase system the
     * unit is declaring its weapon attacks (Core p. 70: an aimed shot is announced at attack declaration).
     */
    declaresAimedShots(member: CBTForceMember): boolean {
        if (!this.resolvesAttacks()) return false;
        if (!this.options.options().realPhases) return true;
        const step = TURN_STEPS[member.force.getUnitSnapshot(member.id)?.state.turn.turnStep ?? 0];
        return step?.phase === 'weapons' && step.kind === 'declaration';
    }

    /**
     * Shows the target's paperdoll for one weapon. Resolves the location to aim at, null for a normal attack, and
     * undefined when the player dismisses it.
     */
    async pickAim(
        row: EquipmentPanelComponent,
        target: TargetingTarget,
        attack: WeaponAttackContext,
        ruleset: CBTRuleset,
    ): Promise<string | null | undefined> {
        const defender = this.opfor.resolveOpforTarget(target.id)?.member ?? null;
        const arc = activeTargetCalculator(target)?.attackDirection ?? 'front';
        const choices = aimedShotChoices(row, target, attack, ruleset,
            defender ? aimedShotLocations(defender, arc) : null, arc);
        if (choices.locations.length === 0) {
            this.toast.showToast('Add the vehicle to the OPFOR to aim at its locations', 'info');
            return undefined;
        }
        const entity = defender?.entity;
        const mekConfig = !entity ? targetMekConfig(target.unitType) : isMekEntity(entity) ? entity.chassisConfig : null;
        const assetUrl = mekConfig !== null ? MekPaperdollGenerator.armorAsset(mekConfig)
            : isNavalRecordSheetEntity(entity!) ? navalPaperdollAsset(entity!) : combatVehiclePaperdollAsset(entity!);
        const ref = this.dialogs.createDialog<string | null, AimedShotDialogComponent, AimedShotDialogData>(
            AimedShotDialogComponent, {
                data: {
                    weapon: row.label,
                    target: defender ? this.unitNames.name(defender.entity) : target.name,
                    direction: ATTACK_ARC_LABELS[arc],
                    assetUrl,
                    ...(mekConfig === null ? {} : { rearAssetUrl: MekPaperdollGenerator.armorAsset(mekConfig, true) }),
                    choices,
                },
            });
        return firstValueFrom(ref.closed);
    }

    /** Resolves a completed FIRE from the selections it fired (the snapshot taken before firing). */
    async resolveFired(
        member: CBTForceMember,
        fired: EquipmentPanelSnapshot,
        attack: WeaponAttackContext | null,
    ): Promise<void> {
        if (!this.options.options().attackResolution || !attack) return;
        if (attack.missingMovementModifier) {
            // Without the attacker's movement there is no target number to roll against.
            if (fired.components.some(row => row.weapon?.selection?.kind === 'target')
                || fired.physicalAttacks.some(row => row.selection?.kind === 'target')) {
                this.toast.showToast('Declare movement to resolve attacks', 'info');
            }
            return;
        }
        // A swarm on a unit no longer among the targets can only be let go.
        if (fired.physicalAttacks.some(row => row.kind === 'end-swarm' && row.selection !== undefined && row.available
            && !fired.targets.some(target => target.targetId === row.onlyTarget))) {
            await member.force.dispatchUnitCommand(member.id, { type: 'set-swarming', target: null });
        }
        const targets = this.attackTargets(member, fired, attack);
        if (targets.length === 0) return;
        const attacker = this.unitNames.name(member.entity);
        const ref = this.dialogs.createDialog<AttackResolution, AttackResolutionDialogComponent,
            AttackResolutionDialogData>(AttackResolutionDialogComponent, { data: { attacker, targets } });
        const resolution = await firstValueFrom(ref.closed);
        if (!resolution) return;
        for (const componentId of resolution.jammed) {
            await member.force.dispatchUnitCommand(member.id, { type: 'set-component-jammed', componentId, jammed: true });
        }
        if (resolution.jammed.length > 0) {
            this.toast.showToast(`${resolution.jammed.length} weapon${resolution.jammed.length === 1 ? '' : 's'} jammed`, 'error');
        }
        const attackId = uuidv4();
        await this.settlePhysicalAttacks(member, resolution.physical, attackId);
        const deliveries = resolution.deliveries;
        const fromForce = member.force.instanceId();
        if (!deliveries.length || !fromForce) return;
        const turn = member.force.getUnitSnapshot(member.id)?.state.turn.turnCounter ?? 0;
        const sent = await Promise.all(deliveries.map((delivery, index) => this.gameEvents.send(delivery.toForce, Object.freeze({
            kind: 'attack',
            id: `${attackId}:${index}`,
            fromForce,
            fromUnit: member.id,
            attacker,
            toUnit: delivery.toUnit,
            turn,
            arc: delivery.arc,
            weapons: delivery.weapons,
        }))));
        const names = (delivered: boolean) => deliveries.filter((_, index) => sent[index] === delivered)
            .map(delivery => delivery.name).join(', ');
        if (sent.includes(true)) this.toast.showToast(`Hits sent to ${names(true)}`, 'success');
        if (sent.includes(false)) {
            this.toast.showToast(`Hits could not be delivered to ${names(false)}`, 'error');
        }
    }

    private attackTargets(
        member: CBTForceMember,
        fired: EquipmentPanelSnapshot,
        attack: WeaponAttackContext,
    ): readonly AttackResolutionTarget[] {
        const profiles = new Map<string, WeaponAttackProfile[]>();
        // With real phases, FIRE resolves the attacks of the unit's current phase.
        const physicalPhase = this.inPhysicalPhase(member);
        const realPhases = this.options.options().realPhases;
        const optionalRules = this.options.options().CBTOptionalRules;
        for (const row of fired.physicalAttacks) {
            // Infantry's anti-'Mech attacks resolve with the weapons, physical attacks in their own phase.
            if (realPhases && physicalPhase === isAntiMekAttack(row.kind)) continue;
            const selection = row.selection;
            // A swarming unit attacks the one unit it clings to, whatever target its row was selected with.
            const targetId = selection === undefined ? undefined
                : row.onlyTarget ?? (selection.kind === 'target' ? selection.targetId : undefined);
            const target = fired.targets.find(candidate => candidate.targetId === targetId);
            const kind = target && row.available && row.selectable ? row.kind ?? null : null;
            if (!target || !kind || row.effect.kind === 'modifier') continue;
            const defender = this.opfor.resolveOpforTarget(target.targetId)?.member;
            const defenderSnapshot = defender?.force.getUnitSnapshot(defender.id);
            const targeting = projectTargetingTarget(target, fired.ruleset);
            if (physicalRowTargetIssue(row, targeting) !== null) continue;
            // Charges and DFAs compare both pilots; the defender's skill is known only for a linked unit.
            const defenderPiloting = defender?.force.getWeaponAttackContext(defender.id)?.pilotingSkill;
            const targetNumber = physicalAttackTargetNumber(row, fired.crew.piloting, attack, targeting,
                defenderPiloting === undefined ? undefined : {
                    piloting: defenderPiloting,
                    immobile: defenderSnapshot?.query.conditions().includes('immobile') === true,
                });
            if (targetNumber === null) continue;
            // An unlinked target is what its declared type and calculator say; one of no declared type is a Mek.
            const mek = defender ? isMekEntity(defender.entity) : targeting.unitType?.startsWith('mek-') ?? true;
            // A leg attack reads the front of the kick table, swarm damage the swarm table on a 'Mech and a random
            // side of any other unit's own table (TW pp. 220, 223).
            const { table, arc } = kind === 'leg-attack' ? { table: 'kick' as const, arc: 'front' as const }
                : kind === 'swarm-damage' ? { table: mek ? 'swarm' as const : 'standard' as const, arc: undefined }
                    : physicalStrike(kind, row.hitTable ?? 'standard', {
                        mek,
                        prone: defenderSnapshot
                            ? defenderSnapshot.query.conditions().includes('prone')
                            : targeting.tnCalculator?.prone === true,
                    });
            const profile = physicalAttackProfile({
                name: row.label,
                kind,
                damage: row.effect.kind === 'damage' ? row.effect.damage : 0,
                targetNumber,
                table,
                partialCover: table === 'standard' && !isAntiMekAttack(kind) && physicalAttackMeetsPartialCover(row, targeting),
                ...(arc === undefined ? {} : { arc }),
                randomSide: physicalStrikesRandomSide(kind, targeting) || (kind === 'swarm-damage' && !mek),
                ...(targeting.unitType === undefined ? {} : { targetUnitType: targeting.unitType }),
                ...(row.damageGroupSize === undefined ? {} : { groupSize: row.damageGroupSize }),
                ...(row.critical ? { critical: true } : {}),
            });
            profiles.set(target.targetId, [...profiles.get(target.targetId) ?? [], profile]);
        }
        for (const row of !realPhases || !physicalPhase ? fired.components : []) {
            const weapon = row.weapon;
            const selection = weapon?.selection;
            const target = selection?.kind === 'target'
                ? fired.targets.find(candidate => candidate.targetId === selection.targetId)
                : undefined;
            // A weapon that cannot fire (already fired this turn, jammed) stays selected but is not resolved again.
            if (!weapon?.selectable || !target || !(row.equipment instanceof WeaponEquipment)) continue;
            const targeting = projectTargetingTarget(target, fired.ruleset);
            const presentation = projectWeaponTargetPresentation(row, targeting, attack, fired.ruleset);
            const range = presentation.damageRange;
            const damage = range ? weapon.damageByRange?.[range] : null;
            const targetNumber = presentation.targetNumberBreakdown?.total;
            // A heat weapon's effect depends on what it strikes: the linked unit, or the target's declared type. A
            // platoon's attack, declared on its primary weapon's row, takes its heat from whichever weapon is a flamer.
            const heatEquipment = weapon.platoon ? weapon.platoon.heatOrDamageWeapon : row.equipment;
            const struck = heatWeaponTarget(this.opfor.resolveOpforTarget(target.targetId)?.member.entity, targeting.unitType);
            const heatWeapon = heatEquipment === null ? undefined : attackHeatWeapon(heatEquipment, row.mode,
                fired.ruleset, optionalRules, struck);
            const targetFacts = struck === null ? {} : { targetTracksHeat: struck.tracksHeat };
            if (presentation.outOfRange || (!damage && !heatWeapon) || targetNumber === undefined) continue;
            const ammo = selectedAmmoEquipment(weapon.ammoSources, weapon.ammoSelection);
            // The calculator's partial-cover modifier is the one source for whether this weapon meets cover.
            const partialCover = presentation.targetModifierBreakdown?.some(modifier =>
                modifier.id === 'partial-cover' && modifier.modifier > 0) === true;
            const profile = weapon.platoon ? platoonAttackProfile({
                componentId: row.componentId,
                name: row.label,
                targetNumber,
                types: resolveEffectiveWeaponTypes(row, ammo),
                partialCover,
                attack: weapon.platoon,
                ...(heatWeapon === undefined ? {} : { heatWeapon }),
                ...targetFacts,
            }, gameRulesFor(fired.ruleset)) : weaponAttackProfile({
                componentId: row.componentId,
                equipment: row.equipment,
                mode: row.mode,
                damage: damage ?? Object.freeze({ values: Object.freeze([0]), maximum: 0 }),
                ...(heatWeapon === undefined ? {} : { heatWeapon }),
                ammo,
                types: resolveEffectiveWeaponTypes(row, ammo),
                name: row.label,
                targetNumber,
                partialCover,
                ...targetFacts,
                ...(presentation.aim === null ? {} : {
                    aim: Object.freeze({ location: presentation.aim.location, dice: aimedShotDice(fired.ruleset) }),
                }),
            }, gameRulesFor(fired.ruleset));
            if (!profile) continue;
            profiles.set(target.targetId, [...profiles.get(target.targetId) ?? [], profile]);
        }
        return [...profiles].map(([targetId, weapons]) => {
            const target = fired.targets.find(candidate => candidate.targetId === targetId)!;
            const defender = this.opfor.resolveOpforTarget(targetId);
            return Object.freeze({
                targetId,
                name: defender ? this.unitNames.name(defender.member.entity) : target.name,
                letter: target.letter,
                color: target.color,
                arc: target.local?.calculator?.attackDirection ?? 'front',
                defender: defender?.member ?? null,
                delivery: defender ? Object.freeze({ toForce: defender.forceId, toUnit: defender.member.id }) : null,
                ruleset: fired.ruleset,
                ...(defender ? {} : { unitType: projectTargetingTarget(target, fired.ruleset).unitType }),
                profiles: Object.freeze(weapons),
            });
        });
    }

    private async receive(toForce: string, event: AttackEvent, fromDisplayName: string | null): Promise<void> {
        const force = this.workspace.loadedForces().map(slot => slot.force).find((candidate): candidate is CBTForce =>
            candidate instanceof CBTForce && candidate.instanceId() === toForce && !candidate.readOnly());
        const member = force?.getCBTMembers().find(candidate => candidate.id === event.toUnit);
        if (!member) return;
        // Show the struck unit behind the popup, so accepted damage lands in view. The workspace commands
        // are resolved on use: they depend on the force builder.
        this.injector.get(ForceWorkspaceCommandsService).selectUnit(member);
        const pending = this.options.options().trackPhaseAndTurn;
        const ref = this.dialogs.createDialog<boolean, IncomingAttackDialogComponent, IncomingAttackDialogData>(
            IncomingAttackDialogComponent, {
                data: { event, member, unitName: this.unitNames.name(member.entity), fromDisplayName, pending },
                disableClose: true,
            });
        if (await firstValueFrom(ref.closed) !== true) return;
        // One undo takes the whole hit back: damage, crew wounds and any owed consciousness roll.
        const applied = await member.force.runAsOneUndoStep(() =>
            this.applyAttack(member, event, pending ? 'pending' : 'committed'));
        this.toast.showToast(applied
            ? `${event.attacker}'s hits applied to ${this.unitNames.name(member.entity)}`
            : `Could not apply all of ${event.attacker}'s hits; finish them on the sheet`, applied ? 'success' : 'error');
    }

    /**
     * Applies each hit where the struck unit's own table puts it, as a sheet edit would, then the Piloting Skill
     * Rolls its physical attacks force on a Mek.
     */
    private async applyAttack(
        member: CBTForceMember,
        event: AttackEvent,
        target: 'committed' | 'pending',
    ): Promise<boolean> {
        const inferno = readInfernoMissiles(member, event.arc, event.weapons);
        const heat = readAttackHeat(member, event.arc, event.weapons);
        const read = event.weapons.filter(weapon => !weapon.inferno).flatMap(weapon => {
            const source = attackDamageSource(weapon);
            if (weapon.swarmStrike) return swarmStrikeHits(member, weapon, source);
            const natural12 = weapon.toHit[0] + weapon.toHit[1] === 12;
            const struck = new Set<string>();
            return weapon.groups.flatMap(group => {
                const read = readAttackHitLocation(member, weapon.arc ?? event.arc, group.location, group.aux,
                    weapon.partialCover === true, weapon.table, weapon.aim);
                // A leg attack and battle armor's swarm damage also roll for a critical hit where they strike.
                const location = weapon.critical && read?.kind === 'mek'
                    ? Object.freeze({ ...read, throughArmorCritical: true }) : read;
                if (!location || group.damage === 0) return [];
                const key = location.kind === 'non-mek' ? location.locationId : location.label;
                const luckyHit = natural12 && !struck.has(key);
                struck.add(key);
                return [{ weapon, location, damage: group.damage, source, luckyHit }];
            });
        });
        const hits = this.strikeSwarmer(member, event, read);
        let applied = await member.force.applyWeaponHits(member.id, weaponHits(member, event.arc, hits, inferno, heat), target);
        // Infantry that took hold of this unit, or let go of it; infantry this attack knocked off the unit it swarmed.
        const swarmed = attackSwarms(event.weapons);
        if (swarmed !== null) {
            applied = (await member.force.dispatchUnitCommand(member.id, {
                type: 'set-condition', condition: 'swarmed', active: swarmed,
            })).accepted && applied;
        }
        if (attackReleasesSwarm(event.weapons) && isInfantryFamilyEntity(member.entity)) {
            applied = (await member.force.dispatchUnitCommand(member.id, { type: 'set-swarming', target: null }))
                .accepted && applied;
        }
        const ruleset = member.force.getUnitSnapshot(member.id)?.ruleset;
        const checks = ruleset ? event.weapons.flatMap(weapon => weapon.physical === undefined ? []
            : physicalAttackPilotChecks(ruleset, weapon.physical, toHitSucceeds(weapon.toHit, weapon.targetNumber)).target) : [];
        return await this.recordPilotChecks(member, event.id, checks, false) && applied;
    }

    /**
     * The hits on a swarmed unit that strike the swarming infantry instead (`splitSwarmedHits`): sent to the infantry,
     * and what stays on the unit returned. The infantry's own attacks on the unit strike only the unit.
     */
    private strikeSwarmer<T extends Readonly<{ weapon: AttackWeaponReport; location: AttackHitLocation; damage: number }>>(
        member: CBTForceMember,
        event: AttackEvent,
        hits: readonly T[],
    ): readonly T[] {
        if (!member.force.getUnitSnapshot(member.id)?.query.hasCondition('swarmed')) return hits;
        const swarm = this.injector.get(SwarmService);
        const vehicle = isVehicleEntity(member.entity);
        const split = splitSwarmedHits(hits.map(({ weapon, location, damage }) => ({
            damage,
            eligible: weapon.table !== 'swarm' && !isAntiMekAttack(weapon.physical)
                && (location.kind === 'mek' ? MEK_TORSO_LOCATIONS.has(location.location) : vehicle && location.kind === 'non-mek'),
        })), swarm.swarmerTroopers(member), { d6: rollD6, pick: count => Math.floor(Math.random() * count) });
        swarm.strikeSwarmer(member, event, hits.flatMap((hit, index) => split[index]!.infantry === 0 ? [] : [{
            weapon: hit.weapon,
            damage: split[index]!.infantry,
            ...(split[index]!.trooper === undefined ? {} : { trooper: split[index]!.trooper }),
        }]));
        return hits.flatMap((hit, index) => split[index]!.carrier === 0 ? [] : [{ ...hit, damage: split[index]!.carrier }]);
    }

    /**
     * The attacker's side of its physical attacks: charge and DFA damage to itself, and its Piloting Skill Rolls
     * or the automatic fall of a missed DFA, as one undo step.
     */
    private async settlePhysicalAttacks(
        member: CBTForceMember,
        outcomes: readonly PhysicalAttackOutcome[],
        attackId: string,
    ): Promise<void> {
        const snapshot = member.force.getUnitSnapshot(member.id);
        if (!snapshot || outcomes.length === 0) return;
        const ruleset = snapshot.ruleset;
        // A submerged 'Mech charges underwater, so the damage it takes is halved as well.
        const attackerSubmerged = hasMekRuntime(snapshot) && mekUnitWaterState(snapshot.entity, snapshot.query).submerged;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        const notes: string[] = [];
        const settled = await member.force.runAsOneUndoStep(async () => {
            let applied = true;
            for (const outcome of outcomes) {
                // A successful swarm takes hold of its target; ending it lets go (TW p. 220).
                const swarming = outcome.kind === 'swarm' && outcome.hit ? outcome.targetId
                    : outcome.kind === 'end-swarm' ? null : undefined;
                if (swarming === undefined) continue;
                applied = (await member.force.dispatchUnitCommand(member.id, { type: 'set-swarming', target: swarming }))
                    .accepted && applied;
                notes.push(swarming === null ? 'Swarm ended' : 'Swarming the target');
            }
            // A brush off that hits knocks the swarming infantry off this unit (TW p. 222).
            if (outcomes.some(outcome => outcome.kind === 'brush-off' && outcome.hit)) {
                applied = (await member.force.dispatchUnitCommand(member.id, {
                    type: 'set-condition', condition: 'swarmed', active: false,
                })).accepted && applied;
                notes.push('Swarming infantry brushed off');
            }
            for (const outcome of outcomes) {
                const self = physicalSelfDamage(ruleset, outcome.kind, outcome.hit, {
                    attackerTons: member.entity.tonnage(), targetTons: outcome.targetTons ?? 0, attackDamage: outcome.damage,
                    attackerSubmerged,
                });
                if (!self) continue;
                if (outcome.kind === 'charge' && outcome.targetTons === null) {
                    notes.push('Apply the charge damage to your unit on its sheet: the target\'s tonnage is unknown here');
                    continue;
                }
                const hits = damageGroups(self.damage, self.groupSize).flatMap(damage => {
                    const location = readAttackHitLocation(member, 'front',
                        hitTableDice(self.table) === 2 ? roll2D6() : Object.freeze([rollD6()] as const), rollD6(), false,
                        self.table);
                    return location ? [{ location, damage, source: PHYSICAL_DAMAGE }] : [];
                });
                applied = await member.force.applyWeaponHits(member.id, weaponHits(member, 'front', hits), target) && applied;
                const label = outcome.kind === 'charge' ? 'Charge'
                    : outcome.kind === 'death-from-above' ? 'Death from above' : 'Missed brush off';
                notes.push(`${label}: ${self.damage} damage to your unit`);
            }
            const consequences = outcomes.map(outcome => physicalAttackPilotChecks(ruleset, outcome.kind, outcome.hit));
            if (consequences.some(consequence => consequence.attackerFalls)) notes.push('Missed death from above: your unit falls');
            return await this.recordPilotChecks(member, attackId, consequences.flatMap(consequence => consequence.attacker),
                consequences.some(consequence => consequence.attackerFalls)) && applied;
        });
        if (notes.length > 0) this.toast.showToast(notes.join('. '), settled ? 'info' : 'error');
    }

    /** Queues a Mek's physical-attack Piloting Skill Rolls; other units make none. */
    private async recordPilotChecks(
        member: CBTForceMember,
        attackId: string,
        checks: readonly MekPhysicalAttackCheckTriggerKindV2[],
        missedDeathFromAbove: boolean,
    ): Promise<boolean> {
        if (!isCBTMekForceMember(member) || (checks.length === 0 && !missedDeathFromAbove)) return true;
        return (await member.force.dispatchUnitCommand(member.id, {
            type: 'record-mek-physical-attack-checks',
            attackId,
            checks,
            ...(missedDeathFromAbove ? { missedDeathFromAbove: true as const } : {}),
        })).accepted;
    }

}

/** Whether an attack knocks the swarming infantry it strikes off the unit it swarms. */
export function attackReleasesSwarm(weapons: readonly Pick<AttackEvent['weapons'][number], 'swarmRelease'>[]): boolean {
    return weapons.some(weapon => weapon.swarmRelease === true);
}

/** Whether an attack leaves the struck unit swarmed (true) or free of its swarm (false); null when neither. */
export function attackSwarms(
    weapons: readonly Pick<AttackEvent['weapons'][number], 'physical' | 'toHit' | 'targetNumber'>[],
): boolean | null {
    if (weapons.some(weapon => weapon.physical === 'end-swarm')) return false;
    return weapons.some(weapon => weapon.physical === 'swarm' && toHitSucceeds(weapon.toHit, weapon.targetNumber))
        ? true : null;
}

/** Hits read on the struck unit's own tables, in the shape its family's damage automation takes. */
/**
 * A hit on the unit this infantry swarms that struck it instead (TW p. 222): battle armor takes it on the named
 * trooper, a platoon on its troopers, marked off as from infantry.
 */
function swarmStrikeHits(
    member: CBTForceMember,
    weapon: AttackWeaponReport,
    source: DamageSource,
): readonly Readonly<{ weapon: AttackWeaponReport; location: AttackHitLocation; damage: number; source: DamageSource }>[] {
    const code = weapon.swarmStrike?.trooper === undefined ? 'Infantry' : `Trooper ${weapon.swarmStrike.trooper}`;
    const location = member.nonMekRecordSheetSnapshot()?.locations.find(candidate => candidate.code === code);
    if (!location) return [];
    return weapon.groups.filter(group => group.damage > 0).map(group => Object.freeze({
        weapon,
        location: Object.freeze({
            kind: 'non-mek' as const, label: location.sheetCode, locationId: location.locationId, arc: 'front' as const,
            effects: Object.freeze([]),
        }),
        damage: group.damage,
        source,
    }));
}

function weaponHits(
    member: CBTForceMember,
    arc: MekHitArc,
    hits: readonly Readonly<{ location: AttackHitLocation; damage: number; source: DamageSource; luckyHit?: boolean }>[],
    inferno: readonly InfernoMissile[] = [],
    heat = 0,
): WeaponHits {
    return isCBTMekForceMember(member)
        ? {
            family: 'mek',
            inferno,
            heat,
            groups: hits.flatMap(({ location, damage, source }) => location.kind === 'mek' ? [Object.freeze({
                location: location.location,
                rear: location.rear,
                damage,
                arc,
                throughArmorCritical: location.throughArmorCritical,
                source,
            })] : []),
        }
        : {
            family: 'non-mek',
            inferno,
            heat,
            groups: hits.flatMap(({ location, damage, source, luckyHit }) => location.kind === 'non-mek' ? [Object.freeze({
                locationId: location.locationId,
                damage,
                arc: location.arc,
                effects: location.effects,
                source,
                ...(location.aeroCritical === undefined ? {} : { aeroCritical: location.aeroCritical, luckyHit: luckyHit === true }),
            })] : []),
        };
}
