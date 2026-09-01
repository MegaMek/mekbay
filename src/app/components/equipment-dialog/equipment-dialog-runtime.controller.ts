// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { Subscription } from 'rxjs';

import {
    isCBTMekForceMember,
    type CBTForceMember,
} from '../../models/force-member.model';
import type {
    MekEquipmentChoice,
    MekEquipmentChoiceToken,
    MekEquipmentInteraction,
} from '../../models/cbt-force.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import type {
    EquipmentPanelComponent,
    EquipmentPanelSnapshot,
    MekPhysicalAttackRow,
} from '../../models/runtime/equipment-panel';
import { selectedWeaponHeat } from '../../models/runtime/equipment-panel';
import type { EncounterTargetId } from '../../models/runtime/encounter-runtime';
import type {
    AttackerAmmoSelection,
    AttackerSelection,
} from '../../models/runtime/attacker-targeting-state';
import type { CBTUnitCommand } from '../../models/runtime/unit-instance';
import {
    projectNonMekEscalatingFailureInteractions,
    type NonMekUnitCommand,
} from '../../models/runtime/non-mek-unit-instance';
import { canSwitchNonMekAirGroundState } from '../../models/runtime/non-mek-airborne-state';
import type { OptionsService } from '../../services/options.service';
import type { ToastService } from '../../services/toast.service';
import type { DialogsService } from '../../services/dialogs.service';
import {
    canChangeAirborneGround,
    getMotiveModeLabel,
    getMotiveModesByUnit,
    motiveModeFactsForEntity,
    type MotiveModes,
} from '../../models/motiveModes.model';
import type { EquipmentRowOrderGroup } from '../../models/runtime/equipment-row-order';
import type { UnitModifierBreakdownEntry } from '../../models/combat-modifier';
import {
    ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY,
    type C3DegradationSource,
} from '../../models/rules/game-rules';
import { getDefaultAttackerMovementModifier } from '../../models/target-number-calculator.model';
import { hasNonMekRuntime } from '../../models/cbt-unit-snapshot';
import { formatEquipmentLocationCodes } from '../../utils/equipment-location-display.util';
import {
    prototypeLaserMaximumExtraHeat,
    type PrototypeLaserHeatResult,
    type PrototypeLaserHeatRoll,
} from '../../models/prototype-laser-heat.model';
import { isBoobyTrapEquipment } from '../../models/aerospace-support-equipment.model';
import {
    BOOBY_TRAP_DETONATED_MODE,
    isBoobyTrapDetonated,
} from '../../models/runtime/component-booby-trap';
import {
    ESCALATING_FAILURE_DISABLED_CHOICE_VALUE,
    ESCALATING_FAILURE_HANDLER_ID,
} from '../../models/runtime/component-escalating-failure';

type MekEquipmentCommand = CBTUnitCommand extends infer Command
    ? Command extends CBTUnitCommand
        ? Omit<Command, 'expectedRevision'>
        : never
    : never;

type EntityEquipmentCommand = NonMekUnitCommand extends infer Command
    ? Command extends NonMekUnitCommand
        ? Omit<Command, 'expectedRevision'>
        : never
    : never;

type EntityEscalatingFailureEdit = Extract<
    NonMekUnitCommand,
    { readonly kind: 'edit-escalating-failure' }
>['edit'];

/**
 * Runtime adapter for the established equipment-dialog panels. It owns no
 * presentation and exposes only detached Entity + runtime rows and
 * typed force commands.
 */
export class EquipmentDialogRuntimeController {
    public readonly busy = signal(false);
    public readonly member: CBTForceMember;
    public readonly snapshot: WritableSignal<EquipmentPanelSnapshot>;
    public readonly weapons: Signal<readonly EquipmentPanelComponent[]>;
    public readonly equipment: Signal<readonly EquipmentPanelComponent[]>;
    public readonly ammo: Signal<readonly EquipmentPanelComponent[]>;
    public readonly interactions: WritableSignal<readonly MekEquipmentInteraction[]>;

    private readonly options: OptionsService;
    private readonly toast: ToastService;
    private readonly dialogs?: Pick<DialogsService, 'requestConfirmation' | 'showNoticeHtml'>;
    private readonly forceChanges: Subscription;
    private readonly entityInteractionBindings = new Map<MekEquipmentChoiceToken, Readonly<{
        componentId: ComponentId;
        edit: EntityEscalatingFailureEdit;
    }>>();

    public hasSelections(): boolean {
        return this.weapons().some(row => row.weapon?.selection !== undefined)
            || this.snapshot().physicalAttacks.some(row => row.selection !== undefined);
    }

    public selectedHeatProjection(): Readonly<{
        current: number;
        sources: number;
        selection: number;
        pending: number;
        dissipation: number;
        final: number;
        pendingWidth: number;
        dissipationWidth: number;
        retainedWidth: number;
    }> | null {
        if (!this.snapshot().tracksHeat) return null;
        const selection = selectedWeaponHeat(this.snapshot()).value;
        let current: number;
        let sources: number;
        let dissipation: number;
        if (isCBTMekForceMember(this.member)) {
            const turn = this.member.force.getMekTurnPanelSnapshot(
                this.member.id,
                this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
                    ? 'automatic'
                    : 'manual',
            );
            if (!turn || turn.heatProjection.kind !== 'supported') return null;
            const projection = turn.heatProjection.projection;
            current = turn.heat.pendingOverride ?? turn.heat.current;
            sources = projection.sources.reduce((sum, source) => sum + Math.max(0, source.value), 0);
            dissipation = projection.dissipated;
        } else {
            const unit = this.entityRuntime();
            const sheet = this.member.force.getNonMekRecordSheetSnapshot(this.member.id);
            if (!unit || !sheet?.heat.tracked) return null;
            current = unit.state.heat.pendingOverride ?? unit.state.heat.current;
            sources = unit.state.turn.weaponsHeat;
            dissipation = sheet.heat.dissipation;
        }
        const final = Math.max(0, current + sources + selection - dissipation);
        const percent = (value: number): number => Math.max(0, Math.min(100, value / 30 * 100));
        return Object.freeze({
            current,
            sources,
            selection,
            pending: current + sources + selection,
            dissipation,
            final,
            pendingWidth: percent(current + sources + selection),
            dissipationWidth: percent(dissipation),
            retainedWidth: percent(final),
        });
    }

    public constructor(
        member: CBTForceMember,
        options: OptionsService,
        toast: ToastService,
        dialogs?: Pick<DialogsService, 'requestConfirmation' | 'showNoticeHtml'>,
    ) {
        this.member = member;
        this.options = options;
        this.toast = toast;
        this.dialogs = dialogs;
        this.snapshot = signal(this.requiredSnapshot());
        this.interactions = signal(this.interactionRows());
        this.weapons = computed(() => this.snapshot().components.filter(row => row.weapon !== undefined));
        this.equipment = computed(() => {
            const actionable = new Set(this.interactions().map(row => row.componentId));
            return this.snapshot().components.filter(row => row.weapon === undefined
                && row.ammo === undefined
                && row.equipment !== undefined
                && actionable.has(row.componentId));
        });
        this.ammo = computed(() => this.snapshot().components.filter(row => row.ammo !== undefined));
        this.forceChanges = member.force.changed.subscribe(() => this.refresh());
    }

    /** Releases the one force subscription owned by this dialog adapter. */
    public dispose(): void {
        this.forceChanges.unsubscribe();
    }

    public locations(row: EquipmentPanelComponent): string {
        return formatEquipmentLocationCodes(
            row.locations.map(location => location.code),
            ', ',
            'Unallocated',
        );
    }

    public weaponDamage(row: EquipmentPanelComponent): string {
        const damage = row.weapon?.damage;
        return Array.isArray(damage) ? damage.join('/') : String(damage ?? '—');
    }

    public physicalDamage(row: MekPhysicalAttackRow): string {
        const effect = row.effect;
        if (effect.kind === 'none') return '—';
        if (effect.kind === 'modifier') {
            return `${effect.modifier >= 0 ? '+' : ''}${effect.modifier}`;
        }
        if (effect.displayFormula !== undefined) return effect.displayFormula;
        if (effect.alternateDamage !== undefined) {
            return `${effect.damage} [${effect.alternateDamage}]`;
        }
        return effect.damage === effect.maximumDamage
            ? `${effect.damage}`
            : `${effect.damage} [${effect.maximumDamage}]`;
    }

    public rangeValue(row: EquipmentPanelComponent, index: number): string {
        return row.weapon?.ranges[index]?.toString() ?? '—';
    }

    public selectedTarget(row: EquipmentPanelComponent): string {
        const selection = row.weapon?.selection;
        if (!selection) return '';
        if (selection.kind === 'selected') return 'selected';
        if (selection.kind === 'target') return selection.targetId;
        return `range:${selection.range}`;
    }

    public selectedAmmo(row: EquipmentPanelComponent): string {
        const selection = row.weapon?.ammoSelection;
        return selection
            ? `${selection.preferredSourceId ?? ''}\u0000${selection.munitionKey}`
            : '';
    }

    public interaction(row: EquipmentPanelComponent): MekEquipmentInteraction | undefined {
        return this.interactions().find(candidate => candidate.componentId === row.componentId);
    }

    public async chooseInteraction(
        interaction: MekEquipmentInteraction,
        token: MekEquipmentInteraction['choices'][number]['token'],
    ): Promise<void> {
        if (this.busy()) return;
        if (!isCBTMekForceMember(this.member)) {
            const binding = this.entityInteractionBindings.get(token);
            if (!binding || binding.componentId !== interaction.componentId) {
                this.reject('CHOICE_UNAVAILABLE');
                return;
            }
            await this.dispatchEntityUnit({
                kind: 'edit-escalating-failure',
                componentId: binding.componentId,
                edit: binding.edit,
            });
            return;
        }
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchMekEquipmentChoice(token);
            if (!result.accepted) this.rejectCommand();
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    public async selectTarget(row: EquipmentPanelComponent, value: string): Promise<void> {
        if (!row.weapon || this.busy()) return;
        const allMembers = attackMembers(row);
        const members = value === '' ? allMembers : allMembers.filter(member => member.selectable);
        if (members.length === 0) return;
        if (value !== '') {
            const reservations = new Map<ComponentId, number>();
            const updates = members.flatMap(member => {
                if (member.ammoSources.length === 0 || member.ammoSelection !== undefined) return [];
                const available = member.ammoSources
                    .filter(candidate => candidate.status === 'available')
                    .sort((left, right) =>
                        (right.remaining - (reservations.get(right.componentId) ?? 0))
                        - (left.remaining - (reservations.get(left.componentId) ?? 0)));
                const source = available.find(candidate =>
                    candidate.remaining > (reservations.get(candidate.componentId) ?? 0))
                    ?? available[0];
                if (!source) return [];
                reservations.set(source.componentId, (reservations.get(source.componentId) ?? 0) + 1);
                return [Object.freeze({
                    componentId: member.componentId,
                    ammo: Object.freeze({
                        preferredSourceId: source.componentId,
                        munitionKey: source.munitionKey,
                    }),
                })];
            });
            if (updates.length > 0) await this.dispatchAmmoUpdates(updates);
        }
        const selection = value === ''
            ? null
            : value === 'selected'
                ? { kind: 'selected' as const }
                : value.startsWith('range:')
                    ? { kind: 'manual-range' as const, range: value.slice(6) as 'short' | 'medium' | 'long' | 'extreme' }
                    : { kind: 'target' as const, targetId: value as EncounterTargetId };
        await this.dispatchComponentSelections(
            members.map(member => member.componentId),
            selection,
        );
    }

    public async selectPhysicalTarget(row: MekPhysicalAttackRow, value: string): Promise<void> {
        if (!row.available || !row.selectable || this.busy()
            || !isCBTMekForceMember(this.member)) return;
        const selection = value === ''
            ? null
            : value === 'selected'
                ? { kind: 'selected' as const }
                : { kind: 'target' as const, targetId: value as EncounterTargetId };
        await this.dispatchTargeting({
            kind: 'set-action-selection',
            target: row.target,
            selection,
        });
    }

    public async selectWeaponAmmo(row: EquipmentPanelComponent, value: string): Promise<void> {
        if (!row.weapon || this.busy()) return;
        const separator = value.indexOf('\u0000');
        const preferredSourceId = separator < 0 ? null : value.slice(0, separator) as ComponentId;
        const munitionKey = separator < 0 ? null : value.slice(separator + 1);
        if (row.attack === undefined) {
            await this.dispatchTargeting({
                kind: 'set-component-ammo',
                componentId: row.componentId,
                ammo: preferredSourceId === null || munitionKey === null || value === ''
                    ? null
                    : { preferredSourceId, munitionKey },
            });
            return;
        }
        const updates: Array<Readonly<{
            readonly componentId: ComponentId;
            readonly ammo: AttackerAmmoSelection | null;
        }>> = [];
        for (const member of attackMembers(row)) {
            if (munitionKey === null || value === '') {
                updates.push(Object.freeze({ componentId: member.componentId, ammo: null }));
                continue;
            }
            const source = member.ammoSources.find(candidate =>
                candidate.componentId === preferredSourceId
                && candidate.loadouts.some(loadout => loadout.munitionKey === munitionKey))
                ?? member.ammoSources.find(candidate =>
                    candidate.loadouts.some(loadout => loadout.munitionKey === munitionKey));
            if (!source) continue;
            updates.push(Object.freeze({
                componentId: member.componentId,
                ammo: Object.freeze({ preferredSourceId: source.componentId, munitionKey }),
            }));
        }
        if (updates.length > 0) await this.dispatchAmmoUpdates(updates);
    }

    public async selectAmmoLoadout(row: EquipmentPanelComponent, munitionKey: string): Promise<void> {
        const loadout = row.ammo?.loadouts.find(candidate => candidate.munitionKey === munitionKey);
        if (loadout) await this.configureAmmo(row, munitionKey, loadout.capacity);
    }

    public async changeAmmo(row: EquipmentPanelComponent, delta: number): Promise<void> {
        if (!row.ammo) return;
        await this.configureAmmo(row, row.ammo.munitionKey, row.ammo.remaining + delta);
    }

    public async changeStatus(row: EquipmentPanelComponent): Promise<void> {
        const status = row.previewStatus === 'destroyed' ? 'available' : 'destroyed';
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        if (isCBTMekForceMember(this.member)) {
            await this.dispatchMekUnit({
                type: 'set-component-status',
                componentId: row.componentId,
                status,
                target,
            });
        } else if (row.attack === undefined) {
            await this.dispatchEntityUnit({
                kind: 'set-component-status',
                componentId: row.componentId,
                status,
                target,
            });
        } else {
            await this.dispatchEntityUnit({
                kind: 'set-component-statuses',
                componentIds: row.attack.members.map(member => member.componentId),
                status,
                target,
            });
        }
    }

    public async changeMode(row: EquipmentPanelComponent, mode: string): Promise<void> {
        if (!row.modes.includes(mode)) return;
        if (isBoobyTrapEquipment(row.equipment) && mode === BOOBY_TRAP_DETONATED_MODE) {
            await this.detonateBoobyTrap(row);
            return;
        }
        if (isCBTMekForceMember(this.member)) {
            await this.dispatchMekUnit({
                type: 'set-component-mode',
                componentId: row.componentId,
                mode,
            });
        } else {
            await this.dispatchEntityUnit({
                kind: 'set-component-mode',
                componentId: row.componentId,
                mode,
            });
        }
    }

    private async detonateBoobyTrap(row: EquipmentPanelComponent): Promise<void> {
        if (!this.dialogs
            || !isBoobyTrapEquipment(row.equipment)
            || isBoobyTrapDetonated(row.mode)
            || row.status !== 'available') return;
        const confirmed = await this.dialogs.requestConfirmation(
            `Detonate ${this.snapshot().displayName}'s Booby Trap? `
                + 'The unit will be completely destroyed. Ejection and blast damage must be resolved on the battlefield.',
            'Detonate Booby Trap',
            'danger',
        );
        if (!confirmed) return;
        const accepted = isCBTMekForceMember(this.member)
            ? await this.dispatchMekUnit({
                type: 'detonate-booby-trap',
                componentId: row.componentId,
            })
            : await this.dispatchEntityUnit({
                kind: 'detonate-booby-trap',
                componentId: row.componentId,
            });
        if (!accepted) return;
        await this.dialogs.showNoticeHtml(
            '<p>The unit has been destroyed.</p>'
                + '<p>Resolve the Booby Trap blast, any +4 ejection modifier, and resulting fire manually on the battlefield.</p>',
            'Booby Trap Detonated',
        );
    }

    public async fire(): Promise<void> {
        if (this.busy()) return;
        const current = this.snapshot();
        this.busy.set(true);
        try {
            const prototypeHeatRolls = this.prototypeHeatRolls(current);
            const result = await this.member.force.fireSelectedWeapons(this.member.id, {
                type: 'fire-selected-weapons',
                heatPolicy: this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
                    ? 'automatic'
                    : 'manual',
                ...(prototypeHeatRolls.length === 0 ? {} : { prototypeHeatRolls }),
            });
            if (!result.accepted) this.rejectCommand();
            else this.reportPrototypeHeat(current, result.prototypeHeat ?? Object.freeze([]));
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private prototypeHeatRolls(snapshot: EquipmentPanelSnapshot): readonly PrototypeLaserHeatRoll[] {
        if (!snapshot.tracksHeat || snapshot.unitType === 'Aero') return Object.freeze([]);
        return Object.freeze(snapshot.components
            .filter(row => row.equipment !== undefined
                && prototypeLaserMaximumExtraHeat(row.equipment.internalName) > 0)
            .sort((left, right) => left.componentId.localeCompare(right.componentId))
            .map(row => Object.freeze({
                weaponId: row.componentId,
                roll: Math.floor(Math.random() * 6) + 1,
            })));
    }

    private reportPrototypeHeat(
        snapshot: EquipmentPanelSnapshot,
        results: readonly PrototypeLaserHeatResult[],
    ): void {
        if (results.length === 0) return;
        const labels = new Map(snapshot.components.map(row => [row.componentId, row.label]));
        this.toast.showToast(results.map(result =>
            `${labels.get(result.weaponId) ?? result.weaponId}: +${result.additionalHeat} heat (${result.detail})`)
            .join('; '), 'info');
    }

    public async resetSelections(): Promise<void> {
        if (this.busy()) return;
        const selected = this.weapons().filter(row => row.weapon?.selection !== undefined);
        if (!isCBTMekForceMember(this.member) && selected.length > 0) {
            await this.dispatchComponentSelections(
                selected.flatMap(row => attackMembers(row).map(member => member.componentId)),
                null,
            );
        } else {
            for (const row of selected) {
                await this.dispatchTargeting({
                    kind: 'set-component-selection',
                    componentId: row.componentId,
                    selection: null,
                });
            }
        }
        if (isCBTMekForceMember(this.member)) {
            for (const row of this.snapshot().physicalAttacks.filter(attack => attack.selection !== undefined)) {
                await this.dispatchTargeting({
                    kind: 'set-action-selection',
                    target: row.target,
                    selection: null,
                });
            }
        }
    }

    /** Persists presentation order without creating a gameplay history entry. */
    public async reorderEquipmentRows(
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
    ): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchEquipmentRowOrder(this.member.id, {
                group,
                permutation,
            });
            if (!result.accepted) this.rejectCommand();
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    public refresh(): void {
        const snapshot = this.member.force.getEquipmentPanelSnapshot(this.member.id);
        if (snapshot) this.snapshot.set(snapshot);
        this.interactions.set(this.interactionRows());
    }

    public async configureAmmo(
        row: EquipmentPanelComponent,
        munitionKey: string,
        remaining: number,
    ): Promise<void> {
        const loadout = row.ammo?.loadouts.find(candidate => candidate.munitionKey === munitionKey);
        if (!row.ammo || !loadout || this.busy()) return;
        const boundedRemaining = Math.max(0, Math.min(loadout.capacity, remaining));
        if (isCBTMekForceMember(this.member)) {
            await this.dispatchMekUnit({
                type: 'configure-ammo-source',
                componentId: row.componentId,
                munitionKey,
                remaining: boundedRemaining,
            });
        } else {
            await this.dispatchEntityUnit({
                kind: 'configure-ammo-source',
                componentId: row.componentId,
                munitionKey,
                remaining: boundedRemaining,
            });
        }
    }

    public attackerMovementMode(): MotiveModes | null {
        if (isCBTMekForceMember(this.member)) {
            return this.member.force.getMekTurnPanelSnapshot(this.member.id, 'manual')
                ?.movementState.movement?.mode ?? null;
        }
        return this.entityRuntime()?.state.turn.movement?.mode ?? null;
    }

    /** Exact rules-owned attacker movement shown in hit and target-number cells. */
    public attackModifierBreakdown(): readonly UnitModifierBreakdownEntry[] {
        const mode = this.attackerMovementMode();
        if (mode === null) return Object.freeze([]);
        const turn = isCBTMekForceMember(this.member)
            ? this.member.force.getMekTurnPanelSnapshot(this.member.id, 'manual')
            : null;
        const airborne = turn?.turn.airborne === true
            || this.entityRuntime()?.state.turn.airborne === true;
        const modifier = turn?.attackMovementModifiers[mode as keyof typeof turn.attackMovementModifiers]
            ?? getDefaultAttackerMovementModifier(mode);
        if (modifier === 0) return Object.freeze([]);
        const entity = this.member.force.getUnitSnapshot(this.member.id)?.entity;
        if (!entity) return Object.freeze([]);
        return Object.freeze([Object.freeze({
            label: getMotiveModeLabel(mode, motiveModeFactsForEntity(entity), airborne),
            modifier,
            priority: ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY,
        })]);
    }

    public missingAttackMovementModifier(): boolean {
        if (this.attackerMovementMode() !== null) return false;
        const entityState = this.entityRuntime()?.state;
        const mekTurn = isCBTMekForceMember(this.member)
            ? this.member.force.getMekTurnPanelSnapshot(this.member.id, 'manual')
            : null;
        const airborne = mekTurn?.turn.airborne === true || entityState?.turn.airborne === true;
        const entity = this.member.force.getUnitSnapshot(this.member.id)?.entity;
        if (!entity) return false;
        const facts = motiveModeFactsForEntity(entity);
        const canSelectAirborne = entity.entityType === 'Mek'
            ? canChangeAirborneGround(facts)
            : canSwitchNonMekAirGroundState(entity);
        const airborneStates = canSelectAirborne
            ? [false, true]
            : [airborne];
        return airborneStates.some(isAirborne => getMotiveModesByUnit(facts, isAirborne)
            .some(mode => getDefaultAttackerMovementModifier(mode) !== 0));
    }

    private entityRuntime() {
        const snapshot = this.member.force.getUnitSnapshot(this.member.id);
        return snapshot && hasNonMekRuntime(snapshot) ? snapshot : null;
    }

    public c3Available(): boolean {
        return this.member.force.getC3State(this.member.id) !== 'none';
    }

    public c3DegradationSource(): C3DegradationSource {
        return this.member.force.getC3State(this.member.id) === 'degraded' ? 'unit' : 'none';
    }

    public supportsMekTurnTools(): boolean {
        return isCBTMekForceMember(this.member);
    }

    public supportsTargetingTools(): boolean {
        return this.member.force.getAttackerTargeting(this.member.id) !== null;
    }

    public canFireSelectedWeapons(): boolean {
        return selectedWeaponHeat(this.snapshot()).hasSelection;
    }

    public allowsExtremeRangeAttacks(): boolean {
        return this.options.options().CBTOptionalRules?.extremeRange ?? false;
    }

    private async dispatchTargeting(
        edit: Parameters<CBTForceMember['force']['dispatchAttackerTargeting']>[1]['edit'],
    ): Promise<void> {
        const current = this.snapshot();
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchAttackerTargeting(this.member.id, {
                type: 'edit-attacker-targeting',
                edit,
            });
            if (!result.accepted) this.rejectCommand();
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private async dispatchComponentSelections(
        componentIds: readonly ComponentId[],
        selection: AttackerSelection | null,
    ): Promise<void> {
        const uniqueIds = [...new Set(componentIds)];
        if (uniqueIds.length === 0) return;
        await this.dispatchTargeting(uniqueIds.length === 1
            ? { kind: 'set-component-selection', componentId: uniqueIds[0], selection }
            : { kind: 'set-component-selections', componentIds: uniqueIds, selection });
    }

    private async dispatchAmmoUpdates(
        updates: readonly Readonly<{
            readonly componentId: ComponentId;
            readonly ammo: AttackerAmmoSelection | null;
        }>[],
    ): Promise<void> {
        if (updates.length === 0) return;
        await this.dispatchTargeting(updates.length === 1
            ? { kind: 'set-component-ammo', ...updates[0] }
            : { kind: 'set-component-ammos', updates });
    }

    private async dispatchMekUnit(command: MekEquipmentCommand): Promise<boolean> {
        if (this.busy()) return false;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchMekUnitCommand(this.member.id, {
                ...command,
            } as CBTUnitCommand);
            if (!result.accepted) this.rejectCommand();
            return result.accepted;
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private async dispatchEntityUnit(command: EntityEquipmentCommand): Promise<boolean> {
        if (this.busy()) return false;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchNonMekUnitCommand(this.member.id, {
                ...command,
            } as NonMekUnitCommand);
            if (!result.accepted) this.rejectCommand();
            return result.accepted;
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private requiredSnapshot(): EquipmentPanelSnapshot {
        const snapshot = this.member.force.getEquipmentPanelSnapshot(this.member.id);
        if (!snapshot) throw new Error('The selected Classic unit is no longer admitted');
        return snapshot;
    }

    private interactionRows(): readonly MekEquipmentInteraction[] {
        this.entityInteractionBindings.clear();
        if (isCBTMekForceMember(this.member)) {
            return this.member.force.getMekEquipmentInteractions('inventory')
                .filter(row => row.instanceId === this.member.id);
        }
        // A few lightweight presentation hosts deliberately omit the Entity;
        // without it there is no direct-runtime interaction to project.
        if (!this.member.entity) return Object.freeze([]);
        const snapshot = this.entityRuntime();
        if (!snapshot) return Object.freeze([]);
        return Object.freeze(projectNonMekEscalatingFailureInteractions(
            snapshot.entity,
            snapshot.index,
            snapshot.state,
            snapshot.ruleset,
            'inventory',
        ).map(interaction => Object.freeze({
            instanceId: snapshot.instanceId,
            unitLabel: this.snapshot().displayName,
            componentId: interaction.componentId,
            componentLabel: interaction.componentLabel,
            stateRevision: snapshot.state.stateRevision,
            choices: Object.freeze(interaction.choices.map((choice, choiceIndex) => {
                const token = JSON.stringify([
                    'non-mek-escalating-failure',
                    snapshot.instanceId,
                    snapshot.state.stateRevision,
                    interaction.componentId,
                    choiceIndex,
                ]) as MekEquipmentChoiceToken;
                const edit: EntityEscalatingFailureEdit = choice.value
                    === ESCALATING_FAILURE_DISABLED_CHOICE_VALUE
                    ? Object.freeze({
                        kind: 'set-status',
                        status: interaction.status === 'disabled' ? 'available' : 'disabled',
                    })
                    : Object.freeze({ kind: 'select-sequence', index: Number(choice.value) });
                this.entityInteractionBindings.set(token, Object.freeze({
                    componentId: interaction.componentId,
                    edit,
                }));
                return Object.freeze({
                    token,
                    handlerId: ESCALATING_FAILURE_HANDLER_ID,
                    interactionKind: 'escalating-failure',
                    label: choice.label,
                    ...(choice.shortLabel === undefined ? {} : { shortLabel: choice.shortLabel }),
                    active: choice.active ?? false,
                    disabled: choice.disabled ?? false,
                    ...(choice.selectionTone === undefined ? {} : { selectionTone: choice.selectionTone }),
                    ...(choice.colors === undefined ? {} : { colors: choice.colors }),
                    ...(choice.keepOpen === undefined ? {} : { keepOpen: choice.keepOpen }),
                    ...(choice.displayType === undefined ? {} : { displayType: choice.displayType }),
                    ...(choice.tooltipType === undefined ? {} : { tooltipType: choice.tooltipType }),
                    ...(choice.failureTarget === undefined ? {} : { failureTarget: choice.failureTarget }),
                } satisfies MekEquipmentChoice);
            })),
        })));
    }

    private reject(reason: string): void {
        this.toast.showToast(`Equipment action rejected: ${reason}`, 'error');
    }

    private rejectCommand(): void {
        this.toast.showToast('This force is read-only.', 'error');
    }
}

function attackMembers(row: EquipmentPanelComponent): readonly Readonly<{
    readonly componentId: ComponentId;
    readonly selectable: boolean;
    readonly selection?: AttackerSelection;
    readonly ammoSelection?: NonNullable<EquipmentPanelComponent['weapon']>['ammoSelection'];
    readonly ammoSources: NonNullable<EquipmentPanelComponent['weapon']>['ammoSources'];
}>[] {
    if (row.attack) return row.attack.members;
    return Object.freeze([Object.freeze({
        componentId: row.componentId,
        selectable: row.weapon?.selectable === true,
        ...(row.weapon?.selection === undefined ? {} : { selection: row.weapon.selection }),
        ...(row.weapon?.ammoSelection === undefined ? {} : { ammoSelection: row.weapon.ammoSelection }),
        ammoSources: row.weapon?.ammoSources ?? Object.freeze([]),
    })]);
}
