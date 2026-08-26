// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { Subscription } from 'rxjs';

import {
    isCBTMekForceMember,
    type CBTForceMember,
} from '../../models/force-member.model';
import type { MekEquipmentInteraction } from '../../models/cbt-force.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import type {
    EquipmentPanelComponent,
    EquipmentPanelSnapshot,
    MekPhysicalAttackRow,
} from '../../models/runtime/equipment-panel';
import { selectedWeaponHeat } from '../../models/runtime/equipment-panel';
import type { EncounterTargetId } from '../../models/runtime/encounter-runtime';
import { createCommandId } from '../../models/runtime/runtime-state';
import type { CBTUnitCommand } from '../../models/runtime/unit-instance';
import type { NonMekUnitCommand } from '../../models/runtime/non-mek-unit-instance';
import type { OptionsService } from '../../services/options.service';
import type { ToastService } from '../../services/toast.service';
import {
    canChangeAirborneGround,
    getMotiveModeLabel,
    getMotiveModesByUnit,
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
import { isHeatSinkEquipment } from '../../models/heat-equipment.model';

type MekEquipmentCommand = CBTUnitCommand extends infer Command
    ? Command extends CBTUnitCommand
        ? Omit<Command, 'commandId' | 'expectedRevision'>
        : never
    : never;

type EntityEquipmentCommand = NonMekUnitCommand extends infer Command
    ? Command extends NonMekUnitCommand
        ? Omit<Command, 'expectedRevision'>
        : never
    : never;

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
    private readonly forceChanges: Subscription;

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
                this.options.options().cbtAutomations ? 'automatic' : 'manual',
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
    ) {
        this.member = member;
        this.options = options;
        this.toast = toast;
        this.snapshot = signal(this.requiredSnapshot());
        this.weapons = computed(() => this.snapshot().components.filter(row => row.weapon !== undefined));
        this.equipment = computed(() => this.snapshot().components.filter(
            row => row.weapon === undefined
                && row.ammo === undefined
                && row.equipment !== undefined
                && !isHeatSinkEquipment(row.equipment),
        ));
        this.ammo = computed(() => this.snapshot().components.filter(row => row.ammo !== undefined));
        this.interactions = signal(this.interactionRows());
        this.forceChanges = member.force.changed.subscribe(() => this.refresh());
    }

    /** Releases the one force subscription owned by this dialog adapter. */
    public dispose(): void {
        this.forceChanges.unsubscribe();
    }

    public locations(row: EquipmentPanelComponent): string {
        return row.locations.map(location => location.code).join(', ') || 'Unallocated';
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
        if (this.busy() || !isCBTMekForceMember(this.member)) return;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchMekEquipmentChoice(token);
            if (!result.accepted) this.reject(result.reason);
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    public async selectTarget(row: EquipmentPanelComponent, value: string): Promise<void> {
        if (!row.weapon || this.busy()) return;
        if (value !== '' && row.weapon.ammoSources.length > 0 && row.weapon.ammoSelection === undefined) {
            const source = row.weapon.ammoSources.find(candidate =>
                candidate.status === 'available' && candidate.remaining > 0)
                ?? row.weapon.ammoSources.find(candidate => candidate.status === 'available');
            if (source) {
                await this.dispatchTargeting({
                    kind: 'set-component-ammo',
                    componentId: row.componentId,
                    ammo: {
                        preferredSourceId: source.componentId,
                        munitionKey: source.munitionKey,
                    },
                });
            }
        }
        const selection = value === ''
            ? null
            : value === 'selected'
                ? { kind: 'selected' as const }
                : value.startsWith('range:')
                    ? { kind: 'manual-range' as const, range: value.slice(6) as 'short' | 'medium' | 'long' | 'extreme' }
                    : { kind: 'target' as const, targetId: value as EncounterTargetId };
        await this.dispatchTargeting({
            kind: 'set-component-selection',
            componentId: row.componentId,
            selection,
        });
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
        const ammo = separator < 0 || value === ''
            ? null
            : {
                preferredSourceId: value.slice(0, separator) as ComponentId,
                munitionKey: value.slice(separator + 1),
            };
        await this.dispatchTargeting({
            kind: 'set-component-ammo',
            componentId: row.componentId,
            ammo,
        });
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
        } else {
            await this.dispatchEntityUnit({
                kind: 'set-component-status',
                componentId: row.componentId,
                status,
                target,
            });
        }
    }

    public async changeMode(row: EquipmentPanelComponent, mode: string): Promise<void> {
        if (!row.modes.includes(mode)) return;
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

    public async fire(): Promise<void> {
        if (this.busy()) return;
        const current = this.snapshot();
        this.busy.set(true);
        try {
            const result = await this.member.force.fireSelectedWeapons(this.member.id, {
                type: 'fire-selected-weapons',
                commandId: createCommandId(),
                expectedRevision: current.stateRevision,
                expectedRegistryRevision: current.targetRegistryRevision,
                heatPolicy: this.options.options().cbtAutomations ? 'automatic' : 'manual',
            });
            if (!result.accepted) this.reject(result.reason);
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    public async resetSelections(): Promise<void> {
        if (this.busy()) return;
        const selected = this.weapons().filter(row => row.weapon?.selection !== undefined);
        for (const row of selected) {
            await this.dispatchTargeting({
                kind: 'set-component-selection',
                componentId: row.componentId,
                selection: null,
            });
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
                expectedRevision: this.snapshot().stateRevision,
                group,
                permutation,
            });
            if (!result.accepted) this.reject(result.reason);
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
        return Object.freeze([Object.freeze({
            label: getMotiveModeLabel(mode, this.member.summary, airborne),
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
        const airborneStates = canChangeAirborneGround(this.member.summary)
            ? [false, true]
            : [airborne];
        return airborneStates.some(isAirborne => getMotiveModesByUnit(this.member.summary, isAirborne)
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
        return this.weapons().some(component => component.weapon?.selection !== undefined);
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
                commandId: createCommandId(),
                expectedRevision: current.stateRevision,
                expectedRegistryRevision: current.targetRegistryRevision,
                edit,
            });
            if (!result.accepted) this.reject(result.reason);
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private async dispatchMekUnit(command: MekEquipmentCommand): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchMekUnitCommand(this.member.id, {
                ...command,
                commandId: createCommandId(),
                expectedRevision: this.snapshot().stateRevision,
            } as CBTUnitCommand);
            if (!result.accepted) this.reject(result.reason);
        } finally {
            this.busy.set(false);
            this.refresh();
        }
    }

    private async dispatchEntityUnit(command: EntityEquipmentCommand): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try {
            const result = await this.member.force.dispatchNonMekUnitCommand(this.member.id, {
                ...command,
                expectedRevision: this.snapshot().stateRevision,
            } as NonMekUnitCommand);
            if (!result.accepted) this.reject(result.reason);
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
        if (!isCBTMekForceMember(this.member)) return Object.freeze([]);
        return this.member.force.getMekEquipmentInteractions()
            .filter(row => row.instanceId === this.member.id);
    }

    private reject(reason: string): void {
        this.toast.showToast(`Equipment action rejected: ${reason}`, 'error');
    }
}
