// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject,Injectable } from '@angular/core';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom,takeUntil } from 'rxjs';
import type { CBTUnitCommand } from '../../../models/runtime/unit-command';
import { isUnitEditContextCurrent,type UnitEditContext } from '../../../models/runtime/unit-edit-context';
import type { DirectRecordSheetInteraction,RecordSheetInteraction } from '../record-sheet-interaction';

import type {
CBTEquipmentChoice,
CBTEquipmentChoiceCommand,
CBTEquipmentInteraction,
} from '../../../models/cbt-force.types';
import type { ComponentId,LocationId } from '../../../models/entity/entity-identifiers';
import { getMekLocationLabel,MEK_TORSO_LOCATIONS } from '../../../models/entity/types';
import type { CBTMekForceMember } from '../../../models/force-member.model';
import {
MEK_CREW_STATE_CONTROLS,
MEK_LOCATION_CONDITION_CONTROLS,
mekUnitConditionControls,
} from '../../../models/mek-record-sheet-controls';
import type { EquipmentPanelSnapshot } from '../../../models/runtime/equipment-panel';
import { resolveMekHitLocation } from '../../../models/runtime/mek-fall-rules';
import type { MekRecordSheetSnapshot } from '../../../models/runtime/mek-record-sheet';
import { MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION } from '../../../models/runtime/mek-movement-psr-v2';

import { hasMekRuntime } from '../../../models/cbt-unit-snapshot';
import {
attackerActionSelection,
attackerActionTargetKey,
sameAttackerSelection,
type AttackerActionSelection,
} from '../../../models/runtime/attacker-targeting-state';
import { rollD6 } from '../../../models/runtime/mek-automation-rules';
import type {
MekCriticalChanceResult,
MekCriticalMutationTarget,
} from '../../../models/runtime/mek-critical-hit-v2';
import { DialogsService } from '../../../services/dialogs.service';
import { heatAutomationPolicy, OptionsService } from '../../../services/options.service';
import { ToastService } from '../../../services/toast.service';
import { recordSheetAmmoName } from '../../../utils/record-sheet-ammo.util';
import { clusterTableForMekEntity,type MekHitArc } from '../../../utils/record-sheet-reference-table';
import { mountedAmmoDialogData, SetAmmoDialogComponent, type SetAmmoDialogResult } from '../../set-ammo-dialog/set-ammo.dialog.component';
import type { PickerChoice } from '../../picker/picker.interface';
import {
MekCriticalChanceDialogComponent,
type MekCriticalChanceDialogData,
} from '../mek-critical-chance-dialog.component';
import {
MekCriticalRollDialogComponent,
type MekCriticalRollDialogData,
} from '../mek-critical-roll-dialog.component';
import {
recordSheetCommand,
recordSheetDamageChoices,
recordSheetDamagePickerRange,
type MekRecordSheetCommandSource,
} from '../mek-record-sheet-interaction.util';
import { type UnitStateDropdownChoice } from '../unit-state-dropdown.component';
import { PageViewerOverlayService, type RecordSheetRandomHit } from './page-viewer-overlay.service';

const CRITICAL_CHANCE_ACTION = 'critical-chance';
const CRITICAL_ROLL_ACTION = 'critical-roll';
const MEK_HIT_ARCS: readonly MekHitArc[] = Object.freeze(['front', 'right', 'rear', 'left']);

/**
 * Original record-sheet interaction vocabulary backed exclusively by Entity +
 * typed runtime owner APIs. The SVG supplies targets and geometry, never facts.
 */
@Injectable()
export class PageViewerMekInteractionService {
    private readonly dialogs = inject(DialogsService);
    private readonly options = inject(OptionsService);
    private readonly overlays = inject(PageViewerOverlayService);
    private readonly toast = inject(ToastService);

    /** Kept for the tactical view, which releases a unit's sheet controls through this service. */
    cleanup(unitId: string): void {
        this.overlays.clearUnitControls(unitId);
    }

    handle(member: CBTMekForceMember, interaction: RecordSheetInteraction, event: Event): void {
        switch (interaction.kind) {
            case 'movement':
                void this.selectMovement(member, interaction);
                return;
            case 'open-equipment':
                this.overlays.openEquipment(member.id, event, interaction.tab);
                return;
            case 'armor':
            case 'internal':
            case 'shield':
                this.openDamagePicker(member, interaction, event);
                return;
            case 'critical':
                this.openCriticalPicker(member, interaction, event);
                return;
            case 'system-critical':
                void this.toggleSystemCritical(member, interaction);
                return;
            case 'heat-preview':
                this.overlays.setHeatPreview(member.id, interaction);
                return;
            case 'heat-preview-end':
                this.overlays.clearHeatPreview(member.id);
                return;
            case 'heat-sinks-off':
                this.openHeatSinksPicker(member, interaction, event);
                return;
            case 'heat-overflow':
                void this.promptHeat(member, interaction);
                return;
            case 'condition-menu':
                this.openUnitConditionMenu(member, interaction, event);
                return;
            case 'location-condition-menu':
                this.openLocationConditionMenu(member, interaction, event);
                return;
            case 'crew-skill':
                this.openCrewSkillPicker(member, interaction, event);
                return;
            case 'crew-profile':
                if (this.currentSnapshot(member, interaction.context)) {
                    this.overlays.editCrewPosition(member, interaction.positionId);
                }
                return;
            case 'crew-state-menu':
                this.openCrewStateMenu(member, interaction, event);
                return;
            case 'inventory-selection':
                void this.overlays.selectInventory(member, interaction, event, context =>
                    this.openEquipmentChoices(member, interaction.componentIds, event, context));
                return;
            case 'action-selection':
                void this.selectAction(member, interaction, event);
                return;
            case 'reference-table':
                if (this.currentSnapshot(member, interaction.context)) this.overlays.openReferenceTable(member);
                return;
            case 'random-hit':
                this.openRandomHitPicker(member, interaction, event);
                return;
            case 'crew-wounds':
            case 'heat':
            case 'apply-heat':
            case 'condition':
            case 'shutdown':
                if (interaction.kind === 'heat') this.overlays.clearHeatPreview(member.id);
                void this.dispatchDirect(member, interaction);
                return;
        }
    }

    private async selectMovement(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { kind: 'movement' }>,
    ): Promise<void> {
        const snapshot = this.currentSnapshot(member, interaction.context);
        const mode = interaction.mode;
        if (!snapshot || mode === 'VTOL') return;
        if (snapshot.movementSelection.selectedMode === mode) {
            await this.dispatchCommand(member, { type: 'clear-mek-movement' }, interaction.context);
            return;
        }
        const option = snapshot.movementSelection.options.find(option => option.mode === mode);
        if (!option?.legal) return;
        const turn = member.force.getMekTurnPanelSnapshot(member.id, snapshot.heatPolicy);
        if (!turn) return;
        await this.dispatchCommand(member, {
            type: 'declare-mek-movement',
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode, distance: option.minimumMp,
                boosterComponentIds: mode === 'run' || mode === 'sprint' ? turn.activeBoosterComponentIds : [],
            },
        }, interaction.context);
    }

    private openRandomHitPicker(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'random-hit' }>,
        event: Event,
    ): void {
        if (!this.currentMekUnit(member, interaction.context)) return;
        this.overlays.openRandomHitPicker(member.id, interaction.element, event, MEK_HIT_ARCS,
            arc => this.rollRandomHit(member, interaction.context, arc as MekHitArc));
    }

    private rollRandomHit(member: CBTMekForceMember, context: UnitEditContext, arc: MekHitArc): RecordSheetRandomHit | null {
        const unit = this.currentMekUnit(member, context);
        if (!unit) return null;
        const table = clusterTableForMekEntity(unit.entity).hitLocationTable ?? 'biped';
        const total = rollD6() + rollD6();
        let result = resolveMekHitLocation(table, arc, total);
        if (result.location === null) result = resolveMekHitLocation(table, arc, total, rollD6());
        if (result.location === null) return null;

        const sourceCode = result.location;
        let location = [...unit.index.locations.values()].find(candidate => candidate.code === sourceCode) ?? null;
        const visited = new Set<LocationId>();
        while (location && unit.query.locationStatus(location.id, 'preview') === 'destroyed'
            && !visited.has(location.id)) {
            visited.add(location.id);
            const nextId = unit.index.damageTransferLocationIdByLocation.get(location.id) ?? null;
            if (nextId === null) break;
            location = unit.index.locations.get(nextId) ?? null;
        }
        const locationCode = location?.code ?? sourceCode;
        return Object.freeze({
            locationCode,
            rear: result.rear && MEK_TORSO_LOCATIONS.has(locationCode),
            throughArmorCritical: result.throughArmorCritical,
            ...(locationCode === sourceCode ? {} : { transferredFrom: sourceCode }),
        });
    }

    private async toggleSystemCritical(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'system-critical' }>,
    ): Promise<void> {
        const snapshot = this.currentSnapshot(member, interaction.context);
        if (!snapshot) return;
        const slot = snapshot.criticalSlots.find(candidate => candidate.slotId === interaction.slotId);
        if (!slot) return;
        const hits = this.options.options().trackPhaseAndTurn ? slot.previewHits : slot.committedHits;
        if (interaction.system === 'Sensors') {
            const systemSlots = snapshot.criticalSlots.filter(candidate =>
                candidate.components.some(component => component.system === interaction.system));
            const highestActiveLevel = systemSlots.reduce((highest, candidate, index) => {
                const candidateHits = this.options.options().trackPhaseAndTurn
                    ? candidate.previewHits
                    : candidate.committedHits;
                return candidateHits > 0 ? index + 1 : highest;
            }, 0);
            const desiredLevel = hits > 0 && highestActiveLevel <= interaction.level
                ? interaction.level - 1
                : interaction.level;
            await this.dispatchCommand(member, {
                type: 'set-system-critical-level',
                system: interaction.system,
                level: desiredLevel,
                target: this.options.options().trackPhaseAndTurn ? 'pending' : 'committed',
            }, interaction.context);
            return;
        }
        await this.dispatchDirect(member, interaction, hits > 0 ? -1 : 1);
    }

    private openDamagePicker(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' | 'shield' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.context);
        if (!snapshot) return;
        const range = recordSheetDamagePickerRange(
            interaction,
            snapshot,
            this.options.options().trackPhaseAndTurn,
        );
        this.overlays.openNumberPicker(member.id, event, {
            min: range.min,
            max: range.max,
            threshold: range.threshold,
            selected: 0,
            title: range.title,
            targetType: 'armor',
            choices: recordSheetDamageChoices(range.min, range.max),
        }, value => {
            if (value !== 0) void this.dispatchDamage(member, interaction, value, snapshot);
        });
    }

    private async dispatchDamage(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' | 'shield' }>,
        delta: number,
        snapshot: MekRecordSheetSnapshot,
    ): Promise<void> {
        if (interaction.kind !== 'armor' || delta <= 0) {
            if (await this.dispatchDirect(member, interaction, delta)) this.showDamageToast(member, interaction, delta);
            return;
        }
        const face = snapshot.locations.flatMap(location => location.armor)
            .find(candidate => candidate.faceId === interaction.faceId);
        if (!face) return;
        const location = snapshot.locations.find(candidate =>
            candidate.locationId === interaction.locationId);
        const pending = this.options.options().trackPhaseAndTurn;
        const armorRemaining = (pending ? face.previewRemaining : face.committedRemaining)
            + (location?.modularArmor
                ? pending
                    ? location.modularArmor.previewRemaining
                    : location.modularArmor.committedRemaining
                : 0);
        const directSnapshot = member.force.getUnitSnapshot(member.id);
        const criticalProfile = directSnapshot && hasMekRuntime(directSnapshot)
            ? directSnapshot.query.mekCriticalChance(
                interaction.locationId,
                pending ? 'pending' : 'committed',
            )
            : undefined;
        const hardenedArmorApplies = criticalProfile?.modifiers.some(modifier =>
            modifier.label === 'Hardened armor in damaged facing') === true
            && (pending ? face.previewRemaining : face.committedRemaining) > 0;
        const armorDamage = Math.min(delta, armorRemaining);
        let context = interaction.context;
        if (armorDamage > 0) {
            const accepted = await this.dispatchDirect(
                member,
                interaction,
                armorDamage,
            );
            if (!accepted) return;
            context = accepted;
        }
        const internalDamage = delta - armorDamage;
        if (internalDamage > 0) {
            if (!this.currentMekUnit(member, context)) return;
            const accepted = await this.dispatchCommand(member, {
                type: 'damage-internal',
                locationId: interaction.locationId,
                amount: internalDamage,
                target: pending ? 'pending' : 'committed',
                hardenedArmorApplies,
                armorDamagedBySameHit: armorDamage > 0,
            }, context);
            if (!accepted) return;
        }
        this.showDamageToast(member, interaction, delta);
    }

    /** Reports a damage or repair on armor or internal structure, as every unit's sheet does. */
    private showDamageToast(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' | 'shield' }>,
        delta: number,
    ): void {
        if (interaction.kind === 'shield') return;
        const location = member.mekRecordSheetSnapshot()?.locations
            .find(candidate => candidate.locationId === interaction.locationId);
        if (!location) return;
        const pending = this.options.options().trackPhaseAndTurn;
        const face = interaction.kind === 'armor'
            ? location.armor.find(candidate => candidate.faceId === interaction.faceId)
            : undefined;
        this.overlays.showDamageToast(member.id, delta, face ? {
            part: face.face === 'rear' ? 'rear armor' : 'armor',
            locationCode: face.locationCode,
            remaining: pending ? face.previewRemaining : face.committedRemaining,
            maximum: face.maximum,
            key: `armor-${face.faceId}`,
        } : {
            part: 'internal',
            locationCode: location.code,
            remaining: pending ? location.previewRemainingInternal : location.committedRemainingInternal,
            maximum: location.maximumInternal,
            key: `internal-${location.locationId}`,
        });
    }

    private openCriticalPicker(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'critical' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.context);
        if (!snapshot) return;
        let context = interaction.context;
        const handlers = new Map<string, CBTEquipmentChoiceCommand>();
        const values = this.criticalChoices(member, interaction, snapshot, handlers);
        if (values.length === 0) return;
        const ammo = snapshot.criticalSlots
            .find(candidate => candidate.slotId === interaction.slotId)
            ?.components.find(component => component.ammo !== undefined)
            ?.ammo;
        this.overlays.openChoicePicker(member.id, event, {
            values,
            selected: null,
            title: ammo
                ? `Ammo (${recordSheetAmmoName(ammo.displayName)})`
                : recordSheetDamagePickerRange(
                    interaction,
                    snapshot,
                    this.options.options().trackPhaseAndTurn,
                ).title,
            style: 'linear',
            targetType: 'crit',
            onPick: async choice => {
                const next = await this.applyCriticalChoice(member, { ...interaction, context }, choice, handlers);
                if (next) context = next;
            },
        });
    }

    private criticalChoices(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'critical' }>,
        snapshot: MekRecordSheetSnapshot,
        handlers: Map<string, CBTEquipmentChoiceCommand>,
    ): PickerChoice[] {
        const slot = snapshot.criticalSlots.find(candidate => candidate.slotId === interaction.slotId);
        if (!slot?.hittable) return [];
        const pending = this.options.options().trackPhaseAndTurn;
        const hits = pending ? slot.previewHits : slot.committedHits;
        const capacity = slot.hitCapacity;
        const values: PickerChoice[] = [];
        if (hits < capacity) values.push({ label: 'Critical Hit', value: 'hit' });
        if (hits > 0) values.push({ label: 'Repair', value: 'repair' });
        const component = slot.components.find(candidate => candidate.ammo !== undefined);
        if (component?.ammo) {
            values.unshift({
                label: '+1',
                value: `ammo-add:${component.componentId}`,
                disabled: component.ammo.remaining >= component.ammo.capacity,
                keepOpen: true,
            });
            values.unshift({
                label: '-1',
                value: `ammo-spend:${component.componentId}`,
                disabled: component.ammo.remaining <= 0,
                keepOpen: true,
            });
            values.push({ label: 'Set Ammo', value: `set-ammo:${component.componentId}` });
        }
        for (const handler of member.force.getEquipmentInteractions(member.id)) {
            if (!interaction.componentIds.includes(handler.componentId)) continue;
            this.appendEquipmentPickerChoices(handler, values, handlers, 'handler');
        }
        return values;
    }

    private async applyCriticalChoice(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'critical' }>,
        choice: PickerChoice,
        handlers: Map<string, CBTEquipmentChoiceCommand>,
    ): Promise<UnitEditContext | null> {
        if (!this.currentMekUnit(member, interaction.context)) return null;
        let accepted: UnitEditContext | null = null;
        if (!choice.keepOpen) this.overlays.closePicker();
        const value = String(choice.value);
        if (value === 'hit' || value === 'repair') {
            const current = this.currentMekUnit(member, interaction.context);
            if (current) accepted = await this.dispatchDirect(
                member,
                interaction,
                value === 'hit' ? 1 : -1,
            );
        } else if (value.startsWith('set-ammo:')) {
            const componentId = value.slice('set-ammo:'.length) as ComponentId;
            const current = this.currentMekUnit(member, interaction.context);
            const data = current && mountedAmmoDialogData(current, componentId, member.force.era());
            if (!data) return null;
            const ref = this.dialogs.createDialog<SetAmmoDialogResult | null>(SetAmmoDialogComponent, { data });
            const selection = await firstValueFrom(ref.closed);
            if (selection && this.currentMekUnit(member, interaction.context)) accepted = await this.dispatchCommand(member, {
                type: 'configure-ammo-source', componentId, munitionKey: selection.name, remaining: selection.quantity,
                ...(selection.hotLoaded === undefined ? {} : { hotLoaded: selection.hotLoaded }),
            }, interaction.context);
        } else if (value.startsWith('ammo-add:') || value.startsWith('ammo-spend:')) {
            const componentId = value.slice(value.indexOf(':') + 1) as ComponentId;
            const current = this.currentMekUnit(member, interaction.context);
            if (current) {
                let munitionKey: string;
                let capacity: number;
                let remaining: number;
                try {
                    const loadout = current.query.ammoLoadout(componentId);
                    munitionKey = loadout.munitionKey;
                    capacity = current.query.ammoCapacity(componentId);
                    remaining = current.query.remainingAmmo(componentId);
                } catch {
                    return null;
                }
                const command: CBTUnitCommand = value.startsWith('ammo-add:')
                    ? {
                        type: 'configure-ammo-source',
                        componentId,
                        munitionKey,
                        remaining: Math.min(capacity, remaining + 1),
                    }
                    : {
                        type: 'spend-ammo',
                        componentId,
                        amount: 1,
                    };
                accepted = await this.dispatchCommand(member, command, interaction.context);
            }
        } else {
            const command = handlers.get(value);
            if (command) {
                const result = await member.force.dispatchEquipmentChoice(command, interaction.context);
                accepted = result.accepted ? result.context : null;
                if (!result.accepted) this.overlays.rejected(`Equipment action rejected: ${result.reason}`);
            }
        }
        const current = accepted && choice.keepOpen ? member.mekRecordSheetSnapshot() : null;
        if (current) {
            handlers.clear();
            this.overlays.refreshChoicePicker(member.id, this.criticalChoices(member, interaction, current, handlers));
        }
        return accepted;
    }

    private openHeatSinksPicker(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'heat-sinks-off' }>,
        event: Event,
    ): void {
        const unit = this.currentMekUnit(member, interaction.context);
        if (!unit) return;
        this.overlays.openActiveHeatSinksPicker(member.id, event, unit.entity.totalHeatSinks(),
            unit.query.heatState().heatsinksOff, heatsinksOff => void this.dispatchDirect(member, interaction, heatsinksOff));
    }

    private async promptHeat(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'heat-overflow' }>,
    ): Promise<void> {
        const unit = this.currentMekUnit(member, interaction.context);
        if (!unit) return;
        const heat = unit.query.heatState();
        const heatValue = await this.overlays.promptHeat(this.options.options().trackPhaseAndTurn
            ? heat.pendingOverride ?? heat.current
            : heat.current);
        if (heatValue === null || !this.currentMekUnit(member, interaction.context)) return;
        await this.dispatchDirect(member, { kind: 'heat', heat: heatValue, context: interaction.context });
    }

    private openUnitConditionMenu(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'condition-menu' }>,
        event: Event,
    ): void {
        const unit = this.currentMekUnit(member, interaction.context);
        if (!unit) return;
        this.overlays.openConditionMenu(
            member,
            event,
            mekUnitConditionControls(unit.ruleset).filter(control => control.placement === 'menu'),
            condition => this.currentMekUnit(member)?.query.hasCondition(condition) === true,
            interaction.context,
        );
    }

    private openLocationConditionMenu(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'location-condition-menu' }>,
        event: Event,
    ): void {
        let context = interaction.context;
        const unit = this.currentMekUnit(member, interaction.context);
        const anchor = event.currentTarget;
        const location = unit?.index.locations.get(interaction.locationId);
        if (!unit || !location || !(anchor instanceof Element)) return;
        const { componentRef, closed } = this.overlays.openStateMenu(member.id, 'location-condition', anchor, event, false);
        const update = (): void => {
            const current = this.currentMekUnit(member, context);
            const currentLocation = current?.index.locations.get(interaction.locationId);
            if (!current || !currentLocation) return;
            const perspective = this.options.options().trackPhaseAndTurn ? 'preview' : 'committed';
            const conditions = MEK_LOCATION_CONDITION_CONTROLS
                .filter(control => control.key !== 'blown-off' || !MEK_TORSO_LOCATIONS.has(currentLocation.code))
                .map(control => {
                    const value = current.query.locationCondition(
                        interaction.locationId,
                        control.key,
                        perspective,
                    );
                    return {
                        key: control.key,
                        label: control.label,
                        color: control.color,
                        active: value > 0,
                        counted: control.counted,
                        ...(control.counted ? { value } : {}),
                    } satisfies UnitStateDropdownChoice;
                });
            componentRef.setInput('choices', [
                ...conditions,
                { key: 'critical-actions-break', label: '', color: '', active: false, isBreak: true },
                { key: CRITICAL_CHANCE_ACTION, label: 'Critical Chance', color: '#444', active: false, action: true },
                { key: CRITICAL_ROLL_ACTION, label: 'Critical Roll', color: '#444', active: false, action: true },
            ] satisfies UnitStateDropdownChoice[]);
            componentRef.changeDetectorRef.detectChanges();
        };
        const set = async (selectedKey: string, operation: 'toggle' | 'increment' | 'decrement'): Promise<void> => {
            const current = this.currentMekUnit(member, context);
            const currentLocation = current?.index.locations.get(interaction.locationId);
            const control = MEK_LOCATION_CONDITION_CONTROLS.find(row => row.key === selectedKey);
            if (!current || !currentLocation || !control) return;
            const pending = this.options.options().trackPhaseAndTurn;
            const conditionKey = control.key;
            const value = current.query.locationCondition(
                interaction.locationId,
                conditionKey,
                pending ? 'preview' : 'committed',
            );
            const next = operation === 'increment' ? value + 1
                : operation === 'decrement' ? Math.max(0, value - 1)
                    : control.counted ? (value > 0 ? 0 : 1) : (value > 0 ? 0 : 1);
            const accepted = await this.dispatchCommand(member, {
                type: 'set-location-condition',
                locationId: interaction.locationId,
                condition: conditionKey,
                value: next,
                target: pending ? 'pending' : 'committed',
            }, context);
            if (!accepted) return;
            context = accepted;
            update();
        };
        update();
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed))
            .subscribe(condition => {
                if (condition === CRITICAL_CHANCE_ACTION || condition === CRITICAL_ROLL_ACTION) {
                    this.overlays.closeMenu('location-condition');
                    if (condition === CRITICAL_CHANCE_ACTION) {
                        this.openMekCriticalChanceDialog(member, interaction.locationId, context);
                    } else {
                        this.openMekCriticalRollDialog(member, interaction.locationId, context);
                    }
                    return;
                }
                void set(condition, 'toggle');
            });
        outputToObservable(componentRef.instance.incremented).pipe(takeUntil(closed))
            .subscribe(condition => void set(condition, 'increment'));
        outputToObservable(componentRef.instance.decremented).pipe(takeUntil(closed))
            .subscribe(condition => void set(condition, 'decrement'));
        outputToObservable(componentRef.instance.holdSelectionCompleted).pipe(takeUntil(closed))
            .subscribe(() => this.overlays.closeMenu('location-condition'));
    }

    private openMekCriticalChanceDialog(member: CBTMekForceMember, locationId: LocationId, context: UnitEditContext): void {
        const unit = this.currentMekUnit(member, context);
        if (!unit || !hasMekRuntime(unit)) return;
        const target = this.criticalMutationTarget();
        const profile = unit.query.mekCriticalChance(locationId, target);
        const ref = this.dialogs.createDialog<MekCriticalChanceResult | undefined>(
            MekCriticalChanceDialogComponent,
            {
                data: {
                    locationLabel: getMekLocationLabel(profile.locationCode) ?? profile.locationCode,
                    canBlowOff: profile.canBlowOff,
                    industrialMek: profile.industrialMek,
                    modifiers: profile.modifiers,
                } satisfies MekCriticalChanceDialogData,
            },
        );
        ref.closed.subscribe(result => {
            if (!result || result.kind === 'none') return;
            if (result.kind === 'blown-off') {
                void this.applyMekBlowOff(member, locationId, target, context);
                return;
            }
            this.openMekCriticalRollDialog(member, locationId, context, result.count, target);
        });
    }

    private async applyMekBlowOff(
        member: CBTMekForceMember,
        locationId: LocationId,
        target: MekCriticalMutationTarget,
        context: UnitEditContext,
    ): Promise<void> {
        const unit = this.currentMekUnit(member, context);
        if (!unit || !hasMekRuntime(unit)) return;
        const plan = unit.query.mekBlowOff(locationId, target);
        const applied = await this.dispatchCommand(member, {
            type: 'apply-mek-blow-off',
            locationId,
            target,
        }, context);
        if (!applied) return;
        if (plan.kind === 'absorbed') {
            this.toast.showToast(`Armored ${plan.equipment} absorbs the blow-off result`, 'info');
            return;
        }
        const location = unit.index.locations.get(locationId);
        const label = getMekLocationLabel(location?.code) ?? location?.code ?? String(locationId);
        this.toast.showToast(`${label} blown off`, 'error');
    }

    private openMekCriticalRollDialog(
        member: CBTMekForceMember,
        locationId: LocationId,
        context: UnitEditContext,
        requiredHits?: number,
        target = this.criticalMutationTarget(),
    ): void {
        if (!this.currentMekUnit(member, context)) return;
        this.dialogs.createDialog(MekCriticalRollDialogComponent, {
            data: {
                member,
                locationId,
                context,
                ...(requiredHits === undefined ? {} : { requiredHits }),
                target,
            } satisfies MekCriticalRollDialogData,
        });
    }

    private criticalMutationTarget(): MekCriticalMutationTarget {
        return this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
    }

    private openCrewSkillPicker(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'crew-skill' }>,
        event: Event,
    ): void {
        const position = this.currentSnapshot(member, interaction.context)?.crew
            .find(row => row.positionId === interaction.positionId);
        if (!position || position.effectiveState === 'vacant') return;
        this.overlays.openCrewSkillPicker(member, event, interaction.positionId, interaction.skill, interaction.context);
    }

    private openCrewStateMenu(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'crew-state-menu' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.context);
        const position = snapshot?.crew.find(row => row.positionId === interaction.positionId);
        const anchor = event.currentTarget;
        if (!snapshot || !position || !(anchor instanceof Element)) return;
        const { componentRef, closed } = this.overlays.openStateMenu(member.id, 'crew-state', anchor, event);
        const unit = member.force.getUnitSnapshot(member.id);
        const canEject = !unit || !hasMekRuntime(unit)
            || unit.entity.mountedCockpit().canEject !== false;
        const choices: UnitStateDropdownChoice[] = MEK_CREW_STATE_CONTROLS
            .filter(control => control.key !== 'ejected' || canEject)
            .map(control => ({
            key: control.key,
            label: control.label,
            color: control.color,
            active: control.key === 'unconscious'
                ? position.state.unconscious
                : control.key === 'ejected' && position.state.ejected,
            }));
        const swappableCrew = snapshot.crew
            .filter(candidate => candidate.occurrence === 0 || candidate.occurrence === 1);
        const swap = swappableCrew.length === 2
            && swappableCrew.every(candidate => candidate.effectiveState !== 'dead')
            && (position.occurrence === 0 || position.occurrence === 1);
        if (swap) {
            choices.push({ key: 'swap-break', label: '', color: '', active: false, isBreak: true });
            choices.push({ key: 'swap', label: 'Swap', color: '#666', active: false });
        }
        componentRef.setInput('choices', choices);
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(choice => {
            const current = this.currentSnapshot(member, interaction.context);
            const row = current?.crew.find(candidate => candidate.positionId === interaction.positionId);
            if (current && row) {
                if (choice === 'swap') {
                    void this.swapCrewPositions(member, row.occurrence, interaction.context);
                } else if (choice === 'unconscious' || choice === 'ejected') {
                    const active = choice === 'unconscious' ? row.state.unconscious : row.state.ejected;
                    void this.dispatchCommand(member, {
                        type: 'set-crew-state',
                        positionId: interaction.positionId,
                        wounds: row.state.wounds,
                        unconscious: choice === 'unconscious' ? !active : row.state.unconscious,
                        ejected: choice === 'ejected' ? !active : row.state.ejected,
                    }, interaction.context);
                }
            }
            this.overlays.closeMenu('crew-state');
        });
    }

    private async swapCrewPositions(member: CBTMekForceMember, occurrence: number, context: UnitEditContext): Promise<void> {
        const snapshot = this.currentSnapshot(member, context);
        const source = snapshot?.crew.find(position => position.occurrence === occurrence);
        const target = snapshot?.crew.find(position => position.occurrence === (occurrence === 0 ? 1 : 0));
        if (!source || !target) return;
        const person = member.force.getAssignedPerson(member.id, source.positionId);
        if (!person) return;
        const result = await member.force.assignPersonToUnit(person.id, member.id, target.positionId);
        if (!result) this.overlays.rejected('The crew profile could not be saved.');
    }

    private async selectAction(
        member: CBTMekForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'action-selection' }>,
        event: Event,
    ): Promise<void> {
        const panel = member.force.getEquipmentPanelSnapshot(member.id);
        if (!panel || !this.currentMekUnit(member, interaction.context)) return;
        const actionKey = attackerActionTargetKey(interaction.target);
        const attack = panel.physicalAttacks.find(candidate =>
            attackerActionTargetKey(candidate.target) === actionKey);
        if (!attack?.available || !attack.selectable) return;
        if (panel.targets.length > 1) {
            this.openActionTargetMenu(member, interaction.target, panel, event, interaction.context);
            return;
        }
        const desired: AttackerActionSelection = panel.targets.length === 1
            ? { kind: 'target', targetId: panel.targets[0].targetId }
            : { kind: 'selected' };
        await this.setActionSelection(
            member,
            interaction.target,
            sameAttackerSelection(attack.selection, desired) ? null : desired,
            interaction.context,
        );
    }

    private openActionTargetMenu(
        member: CBTMekForceMember,
        target: Extract<RecordSheetInteraction, { readonly kind: 'action-selection' }>['target'],
        panel: EquipmentPanelSnapshot,
        event: Event,
        context: UnitEditContext,
    ): void {
        const registryRevision = member.force.getAttackerTargeting(member.id)?.registryRevision;
        const targeting = member.force.getAttackerTargeting(member.id);
        if (!targeting) return;
        const selection = attackerActionSelection(targeting.state, target);
        this.overlays.openTargetMenu(
            member,
            panel,
            event,
            selection?.kind === 'target' ? selection.targetId : null,
            {},
            targetId => void this.setActionSelection(
                member,
                target,
                targetId === null ? null : { kind: 'target', targetId },
                context,
                registryRevision,
            ),
        );
    }

    private openEquipmentChoices(member: CBTMekForceMember, componentIds: readonly ComponentId[], event: Event, context: UnitEditContext): void {
        const commandByValue = new Map<string, CBTEquipmentChoiceCommand>();
        const values = this.equipmentPickerChoices(member, componentIds, commandByValue);
        if (values.length === 0) return;
        this.overlays.openChoicePicker(member.id, event, {
            values,
            selected: null,
            title: values.length === 1 ? values[0].label : 'Equipment',
            targetType: 'inventory',
            style: 'linear',
            onPick: choice => {
                if (!choice.keepOpen) this.overlays.closePicker();
                if (!this.currentMekUnit(member, context)) return;
                const command = commandByValue.get(String(choice.value));
                if (command) void member.force.dispatchEquipmentChoice(command, context).then(result => {
                    if (!result.accepted) {
                        this.overlays.rejected(`Equipment action rejected: ${result.reason}`);
                        return;
                    }
                    context = result.context;
                    if (!choice.keepOpen) return;
                    commandByValue.clear();
                    this.overlays.refreshChoicePicker(member.id,
                        this.equipmentPickerChoices(member, componentIds, commandByValue));
                });
            },
        });
    }

    private equipmentPickerChoices(
        member: CBTMekForceMember,
        componentIds: readonly ComponentId[],
        commandByValue: Map<string, CBTEquipmentChoiceCommand>,
    ): PickerChoice[] {
        const values: PickerChoice[] = [];
        for (const interaction of member.force.getEquipmentInteractions(member.id)) {
            if (!componentIds.includes(interaction.componentId)) continue;
            this.appendEquipmentPickerChoices(interaction, values, commandByValue, 'equipment');
        }
        return values;
    }

    private appendEquipmentPickerChoices(
        interaction: CBTEquipmentInteraction,
        values: PickerChoice[],
        commandByValue: Map<string, CBTEquipmentChoiceCommand>,
        prefix: string,
    ): void {
        const emittedDropdowns = new Set<string>();
        for (const choice of interaction.choices) {
            if (choice.displayType === 'dropdown') {
                const groupLabel = choice.groupLabel ?? choice.label;
                const groupKey = `${choice.command.handlerId}\0${groupLabel}`;
                if (emittedDropdowns.has(groupKey)) continue;
                emittedDropdowns.add(groupKey);
                const options = interaction.choices.filter(candidate => candidate.displayType === 'dropdown'
                    && candidate.command.handlerId === choice.command.handlerId
                    && (candidate.groupLabel ?? candidate.label) === groupLabel);
                const selected = options.find(candidate => candidate.active) ?? options[0];
                if (!selected) continue;
                const selectedValue = this.registerEquipmentPickerCommand(prefix, selected, commandByValue);
                values.push({
                    label: groupLabel,
                    value: selectedValue,
                    disabled: options.every(candidate => candidate.disabled),
                    displayType: 'dropdown',
                    ...(choice.selectionTone === undefined ? {} : { selectionTone: choice.selectionTone }),
                    ...(choice.colors === undefined ? {} : { colors: choice.colors }),
                    ...(choice.keepOpen === undefined ? {} : { keepOpen: choice.keepOpen }),
                    ...(choice.tooltipType === undefined ? {} : { tooltipType: choice.tooltipType }),
                    choices: options.map(option => ({
                        label: option.shortLabel ?? option.label,
                        value: option === selected
                            ? selectedValue
                            : this.registerEquipmentPickerCommand(prefix, option, commandByValue),
                        disabled: option.disabled,
                    })),
                });
                continue;
            }
            values.push({
                label: choice.label,
                ...(choice.shortLabel === undefined ? {} : { shortLabel: choice.shortLabel }),
                value: this.registerEquipmentPickerCommand(prefix, choice, commandByValue),
                active: choice.active,
                disabled: choice.disabled,
                ...(choice.selectionTone === undefined ? {} : { selectionTone: choice.selectionTone }),
                ...(choice.colors === undefined ? {} : { colors: choice.colors }),
                ...(choice.keepOpen === undefined ? {} : { keepOpen: choice.keepOpen }),
                ...(choice.displayType === undefined ? {} : { displayType: choice.displayType }),
                ...(choice.tooltipType === undefined ? {} : { tooltipType: choice.tooltipType }),
            });
        }
    }

    private registerEquipmentPickerCommand(
        prefix: string,
        choice: CBTEquipmentChoice,
        commandByValue: Map<string, CBTEquipmentChoiceCommand>,
    ): string {
        const key = `${prefix}:${commandByValue.size}`;
        commandByValue.set(key, choice.command);
        return key;
    }

    private async setActionSelection(
        member: CBTMekForceMember,
        target: Extract<RecordSheetInteraction, { readonly kind: 'action-selection' }>['target'],
        selection: AttackerActionSelection | null,
        context: UnitEditContext,
        registryRevision?: number,
    ): Promise<void> {
        if (!this.currentMekUnit(member, context)) return;
        const targeting = member.force.getAttackerTargeting(member.id);
        if (!targeting) return;
        const result = await member.force.dispatchAttackerTargeting(member.id, {
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-action-selection', target, selection },
        }, context, registryRevision);
        if (!result.accepted) this.overlays.rejected();
    }

    private async dispatchDirect(
        member: CBTMekForceMember,
        interaction: DirectRecordSheetInteraction,
        delta?: number,
    ): Promise<UnitEditContext | null> {
        const source = this.currentCommandSource(member, interaction.context);
        if (!source) return null;
        const command = recordSheetCommand(
            interaction,
            source,
            this.options.options().trackPhaseAndTurn,
            delta,
        );
        return this.dispatchCommand(member, command, interaction.context);
    }

    private dispatchCommand(member: CBTMekForceMember, command: CBTUnitCommand, context: UnitEditContext): Promise<UnitEditContext | null> {
        return this.overlays.dispatch(member, command, context);
    }

    private currentSnapshot(member: CBTMekForceMember, context: UnitEditContext): MekRecordSheetSnapshot | null {
        const snapshot = member.mekRecordSheetSnapshot();
        return snapshot && isUnitEditContextCurrent(context, snapshot.editContext) ? snapshot : null;
    }

    private currentCommandSource(
        member: CBTMekForceMember,
        context: UnitEditContext,
    ): MekRecordSheetCommandSource | null {
        const unit = this.currentMekUnit(member, context);
        if (!unit) return null;
        return Object.freeze({
            query: unit.query,
            heatSinkCount: unit.entity.totalHeatSinks(),
            heatPolicy: heatAutomationPolicy(this.options),
        });
    }

    private currentMekUnit(member: CBTMekForceMember, context?: UnitEditContext) {
        const unit = member.force.getUnitSnapshot(member.id);
        if (!unit || !hasMekRuntime(unit)) return null;
        return context === undefined || isUnitEditContextCurrent(context, unit.editContext)
            ? unit
            : null;
    }

}
