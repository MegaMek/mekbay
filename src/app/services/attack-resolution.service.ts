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
import { PHYSICAL_DAMAGE, type DamageSource } from '../models/rules/armor-damage-rules';
import {
    PHYSICAL_ATTACK_KINDS,
    physicalAttackPilotChecks,
    physicalHitTable,
    physicalSelfDamage,
    type PhysicalAttackKind,
} from '../models/rules/physical-attack-rules';
import type { MekPhysicalAttackCheckTriggerKindV2 } from '../models/runtime/mek-movement-psr-v2';
import {
    damageGroups,
    physicalAttackProfile,
    toHitSucceeds,
    weaponAttackProfile,
    type WeaponAttackProfile,
} from '../models/rules/weapon-attack-resolution';
import { isHandClawFlags } from '../models/entity/utils/physical-weapon-kernel';
import { isMekEntity } from '../models/entity/utils/entity-type-guards';
import { readAttackHitLocation, type AttackHitLocation } from '../models/runtime/attack-hit-location';
import { roll2D6, rollD6 } from '../models/runtime/mek-automation-rules';
import type { WeaponHits } from '../models/runtime/cbt-force-unit-command-dispatcher';
import { activeTargetCalculator } from '../models/runtime/targeting-target';
import { TURN_STEPS } from '../models/rules/turn-sequence';
import type { MekHitArc } from '../utils/record-sheet-reference-table';
import {
    physicalAttackTargetNumber,
    projectTargetingTarget,
    projectWeaponTargetPresentation,
    resolveEffectiveWeaponTypes,
    selectedAmmoEquipment,
    type EquipmentPanelSnapshot,
    type WeaponAttackContext,
} from '../models/runtime/equipment-panel';
import { uuidv4 } from '../utils/uuid.util';
import { DialogsService } from './dialogs.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService, type AttackEvent } from './game-events.service';
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
        for (const row of !realPhases || physicalPhase ? fired.physicalAttacks : []) {
            const selection = row.selection;
            const target = selection?.kind === 'target'
                ? fired.targets.find(candidate => candidate.targetId === selection.targetId)
                : undefined;
            const kind = target && row.available && row.selectable ? this.physicalKind(member, row.target) : null;
            if (!target || !kind || row.effect.kind === 'modifier') continue;
            const defender = this.opfor.resolveOpforTarget(target.targetId)?.member;
            const defenderSnapshot = defender?.force.getUnitSnapshot(defender.id);
            const targeting = projectTargetingTarget(target, fired.ruleset);
            // Charges and DFAs compare both pilots; the defender's skill is known only for a linked unit.
            const defenderPiloting = defender?.force.getWeaponAttackContext(defender.id)?.pilotingSkill;
            const targetNumber = physicalAttackTargetNumber(row, fired.crew.piloting, attack, targeting,
                defenderPiloting === undefined ? undefined : {
                    piloting: defenderPiloting,
                    immobile: defenderSnapshot?.query.conditions().includes('immobile') === true,
                });
            if (targetNumber === null) continue;
            // The punch and kick tables are for standing Meks; anything else is struck on its standard table.
            // A DFA strikes a prone Mek's rear column and a vehicle's front column (TW p.150; Core p.80).
            const prone = defenderSnapshot?.query.conditions().includes('prone') === true;
            const standingMek = !defender || (isMekEntity(defender.entity) && !prone);
            const table = standingMek ? physicalHitTable(kind, this.physicalClaws(member, row.target)) : 'standard';
            const arc = kind !== 'death-from-above' || standingMek ? undefined
                : isMekEntity(defender!.entity) ? 'rear' as const : 'front' as const;
            const profile = physicalAttackProfile({
                name: row.label,
                kind,
                damage: row.effect.kind === 'damage' ? row.effect.damage : 0,
                targetNumber,
                table,
                partialCover: table === 'standard' && kind !== 'charge'
                    && activeTargetCalculator(targeting)?.partialCover === true,
                ...(arc === undefined ? {} : { arc }),
            });
            profiles.set(target.targetId, [...profiles.get(target.targetId) ?? [], profile]);
        }
        for (const row of !realPhases || !physicalPhase ? fired.components : []) {
            const weapon = row.weapon;
            const selection = weapon?.selection;
            const target = selection?.kind === 'target'
                ? fired.targets.find(candidate => candidate.targetId === selection.targetId)
                : undefined;
            if (!weapon || !target || !(row.equipment instanceof WeaponEquipment)) continue;
            const presentation = projectWeaponTargetPresentation(
                row, projectTargetingTarget(target, fired.ruleset), attack, fired.ruleset);
            const range = presentation.damageRange;
            const damage = range ? weapon.damageByRange?.[range] : null;
            const targetNumber = presentation.targetNumberBreakdown?.total;
            if (presentation.outOfRange || !damage || targetNumber === undefined) continue;
            const ammo = selectedAmmoEquipment(weapon.ammoSources, weapon.ammoSelection);
            const profile = weaponAttackProfile({
                componentId: row.componentId,
                equipment: row.equipment,
                mode: row.mode,
                damage,
                ammo,
                types: resolveEffectiveWeaponTypes(row, ammo),
                name: row.label,
                targetNumber,
                // The calculator's partial-cover modifier is the one source for whether this weapon meets cover.
                partialCover: presentation.targetModifierBreakdown?.some(modifier =>
                    modifier.id === 'partial-cover' && modifier.modifier > 0) === true,
            }, gameRulesFor(fired.ruleset));
            if (!profile) continue;
            profiles.set(target.targetId, [...profiles.get(target.targetId) ?? [], profile]);
        }
        return [...profiles].map(([targetId, weapons]) => {
            const target = fired.targets.find(candidate => candidate.targetId === targetId)!;
            const defender = this.opfor.resolveOpforTarget(targetId);
            return Object.freeze({
                name: defender ? this.unitNames.name(defender.member.entity) : target.name,
                letter: target.letter,
                color: target.color,
                arc: target.local?.calculator?.attackDirection ?? 'front',
                defender: defender?.member ?? null,
                delivery: defender ? Object.freeze({ toForce: defender.forceId, toUnit: defender.member.id }) : null,
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
        const hits = event.weapons.flatMap(weapon => {
            const source: DamageSource = weapon.physical
                ? PHYSICAL_DAMAGE
                : Object.freeze({ kind: 'weapon' as const, types: weapon.types });
            const natural12 = weapon.toHit[0] + weapon.toHit[1] === 12;
            const struck = new Set<string>();
            return weapon.groups.flatMap(group => {
                const location = readAttackHitLocation(
                    member, weapon.arc ?? event.arc, group.location, group.aux, weapon.partialCover === true, weapon.table);
                if (!location) return [];
                const key = location.kind === 'non-mek' ? location.locationId : location.label;
                const luckyHit = natural12 && !struck.has(key);
                struck.add(key);
                return [{ location, damage: group.damage, source, luckyHit }];
            });
        });
        const applied = await member.force.applyWeaponHits(member.id, weaponHits(member, event.arc, hits), target);
        const ruleset = member.force.getUnitSnapshot(member.id)?.ruleset;
        const checks = ruleset ? event.weapons.flatMap(weapon => weapon.physical === undefined ? []
            : physicalAttackPilotChecks(ruleset, weapon.physical, toHitSucceeds(weapon.toHit, weapon.targetNumber)).target) : [];
        return await this.recordPilotChecks(member, event.id, checks, false) && applied;
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
        const ruleset = member.force.getUnitSnapshot(member.id)?.ruleset;
        if (!ruleset || outcomes.length === 0) return;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        const notes: string[] = [];
        const settled = await member.force.runAsOneUndoStep(async () => {
            let applied = true;
            for (const outcome of outcomes) {
                const self = outcome.hit
                    ? physicalSelfDamage(outcome.kind, member.entity.tonnage(), outcome.targetTons ?? 0)
                    : null;
                if (!self) continue;
                if (outcome.kind === 'charge' && outcome.targetTons === null) {
                    notes.push('Apply the charge damage to your unit on its sheet: the target\'s tonnage is unknown here');
                    continue;
                }
                const hits = damageGroups(self.damage, 5).flatMap(damage => {
                    const location = readAttackHitLocation(member, 'front',
                        self.table === 'standard' ? roll2D6() : Object.freeze([rollD6()] as const), rollD6(), false, self.table);
                    return location ? [{ location, damage, source: PHYSICAL_DAMAGE }] : [];
                });
                applied = await member.force.applyWeaponHits(member.id, weaponHits(member, 'front', hits), target) && applied;
                notes.push(`${outcome.kind === 'charge' ? 'Charge' : 'Death from above'}: ${self.damage} damage to your unit`);
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

    /** The resolvable kind of a declared physical attack: an intrinsic attack, or a mounted physical weapon. */
    private physicalKind(member: CBTForceMember, action: EquipmentPanelSnapshot['physicalAttacks'][number]['target']): PhysicalAttackKind | null {
        if (action.kind === 'component') return 'weapon';
        const kind = member.entity.intrinsicWeapons().find(weapon => weapon.id === action.actionId)?.kind;
        return PHYSICAL_ATTACK_KINDS.find(candidate => candidate === kind) ?? null;
    }

    private physicalClaws(member: CBTForceMember, action: EquipmentPanelSnapshot['physicalAttacks'][number]['target']): boolean {
        if (action.kind !== 'component') return false;
        const equipment = member.force.getUnitSnapshot(member.id)?.index.components.get(action.componentId)?.mount?.equipment;
        return equipment !== undefined && isHandClawFlags(equipment.flags);
    }
}

/** Hits read on the struck unit's own tables, in the shape its family's damage automation takes. */
function weaponHits(
    member: CBTForceMember,
    arc: MekHitArc,
    hits: readonly Readonly<{ location: AttackHitLocation; damage: number; source: DamageSource; luckyHit?: boolean }>[],
): WeaponHits {
    return isCBTMekForceMember(member)
        ? {
            family: 'mek',
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
