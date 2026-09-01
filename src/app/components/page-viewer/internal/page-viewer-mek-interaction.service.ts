// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, inject, signal } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom, takeUntil } from 'rxjs';

import type { CBTMekForceMember } from '../../../models/force-member.model';
import type {
    MekEquipmentChoice,
    MekEquipmentChoiceToken,
    MekEquipmentInteraction,
} from '../../../models/cbt-force.model';
import type { ComponentId, LocationId } from '../../../models/entity/entity-identifiers';
import { getMekLocationLabel, MEK_TORSO_LOCATIONS } from '../../../models/entity/types';
import { gameRulesFor } from '../../../models/rules/game-rules';
import {
    MEK_CREW_STATE_CONTROLS,
    MEK_LOCATION_CONDITION_CONTROLS,
    MEK_UNIT_CONDITION_CONTROLS,
} from '../../../models/mek-record-sheet-controls';
import type { EquipmentPanelSnapshot } from '../../../models/runtime/equipment-panel';
import {
    projectWeaponTargetPresentation,
    equipmentPanelRuntimeTarget,
} from '../../../models/runtime/equipment-panel';
import type { MekRecordSheetSnapshot } from '../../../models/runtime/mek-record-sheet';
import type { CBTUnitCommand } from '../../../models/runtime/unit-instance';
import type {
    MekCriticalChanceResult,
    MekCriticalMutationTarget,
} from '../../../models/runtime/mek-critical-hit-v2';
import type { EncounterTargetId } from '../../../models/runtime/encounter-runtime';
import { isUnitConditionKey } from '../../../models/unit-condition.model';
import {
    attackerActionSelection,
    attackerActionTargetKey,
    type AttackerActionSelection,
} from '../../../models/runtime/attacker-targeting-state';
import { DialogsService } from '../../../services/dialogs.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import { ToastService } from '../../../services/toast.service';
import { ClusterTableDialogComponent } from '../../cluster-table-dialog/cluster-table-dialog.component';
import { hasMekRuntime } from '../../../models/cbt-unit-snapshot';
import { recordSheetAmmoName } from '../../../utils/record-sheet-ammo.util';
import { WeaponTargetChoiceMenuComponent } from '../../equipment-dialog/weapon-target-choice-menu.component';
import { InputDialogComponent } from '../../input-dialog/input-dialog.component';
import {
    MekCriticalChanceDialogComponent,
    type MekCriticalChanceDialogData,
} from '../mek-critical-chance-dialog.component';
import {
    MekCriticalRollDialogComponent,
    type MekCriticalRollDialogData,
} from '../mek-critical-roll-dialog.component';
import type { PickerChoice, PickerInstance, PickerTargetType } from '../../picker/picker.interface';
import { isChoicePickerInstance } from '../../picker/picker.interface';
import { UnitStateDropdownComponent, type UnitStateDropdownChoice } from '../unit-state-dropdown.component';
import type { MekRecordSheetInteraction } from '../mek-record-sheet-binder';
import {
    recordSheetCommand,
    recordSheetDamageChoices,
    recordSheetDamagePickerRange,
    recordSheetEventPosition,
    type MekRecordSheetCommandSource,
} from '../mek-record-sheet-interaction.util';
import { PageViewerOverlayService } from './page-viewer-overlay.service';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';

const UNIT_CONDITION_OVERLAY = 'mek-sheet-unit-condition';
const LOCATION_CONDITION_OVERLAY = 'mek-sheet-location-condition';
const CREW_STATE_OVERLAY = 'mek-sheet-crew-state';
const TARGET_OVERLAY = 'mek-sheet-target';
const CRITICAL_CHANCE_ACTION = 'critical-chance';
const CRITICAL_ROLL_ACTION = 'critical-roll';

interface OpenPicker {
    readonly unitId: string;
    readonly instance: PickerInstance;
    readonly target: Element | null;
}

export interface MekHeatPreview {
    readonly element: SVGElement;
    readonly heat: number;
    readonly baselineHeat: number;
}

/**
 * Original record-sheet interaction vocabulary backed exclusively by Entity +
 * typed runtime owner APIs. The SVG supplies targets and geometry, never facts.
 */
@Injectable()
export class PageViewerMekInteractionService {
    private readonly dialogs = inject(DialogsService);
    private readonly injector = inject(Injector);
    private readonly options = inject(OptionsService);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly overlays = inject(PageViewerOverlayService);
    private readonly pickerFactory = inject(PickerFactoryService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
    private readonly toast = inject(ToastService);
    private readonly zoomPan = inject(PageViewerZoomPanService);
    private picker: OpenPicker | null = null;
    private readonly heatPreviews = signal<ReadonlyMap<string, MekHeatPreview>>(new Map());

    isPickerOpen(unitId: string): boolean {
        return this.picker?.unitId === unitId || this.heatPreviews().has(unitId);
    }

    heatPreview(unitId: string): MekHeatPreview | null {
        return this.heatPreviews().get(unitId) ?? null;
    }

    cleanup(unitId: string): void {
        if (this.picker?.unitId === unitId) this.closePicker();
        this.clearHeatPreview(unitId);
        this.closeSheetOverlays();
    }

    clear(): void {
        this.closePicker();
        this.heatPreviews.set(new Map());
        this.closeSheetOverlays();
    }

    handle(member: CBTMekForceMember, interaction: MekRecordSheetInteraction, event: Event): void {
        switch (interaction.kind) {
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
                this.setHeatPreview(member.id, interaction);
                return;
            case 'heat-preview-end':
                this.clearHeatPreview(member.id);
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
            case 'crew-name':
                void this.promptCrewName(member, interaction);
                return;
            case 'crew-state-menu':
                this.openCrewStateMenu(member, interaction, event);
                return;
            case 'inventory-selection':
                void this.selectInventory(member, interaction, event);
                return;
            case 'action-selection':
                void this.selectAction(member, interaction, event);
                return;
            case 'reference-table':
                this.openReferenceTable(member, interaction);
                return;
            case 'crew-wounds':
            case 'heat':
            case 'apply-heat':
            case 'condition':
            case 'shutdown':
                if (interaction.kind === 'heat') this.clearHeatPreview(member.id);
                void this.dispatchDirect(member, interaction);
                return;
        }
    }

    private async toggleSystemCritical(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'system-critical' }>,
    ): Promise<void> {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
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
            });
            return;
        }
        await this.dispatchDirect(member, interaction, hits > 0 ? -1 : 1);
    }

    private setHeatPreview(
        unitId: string,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'heat-preview' }>,
    ): void {
        this.heatPreviews.update(current => {
            const next = new Map(current);
            next.set(unitId, Object.freeze({
                element: interaction.element,
                heat: interaction.heat,
                baselineHeat: interaction.baselineHeat,
            }));
            return next;
        });
    }

    private clearHeatPreview(unitId: string): void {
        if (!this.heatPreviews().has(unitId)) return;
        this.heatPreviews.update(current => {
            const next = new Map(current);
            next.delete(unitId);
            return next;
        });
    }

    private openDamagePicker(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' | 'shield' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
        if (!snapshot) return;
        const range = recordSheetDamagePickerRange(
            interaction,
            snapshot,
            this.options.options().trackPhaseAndTurn,
        );
        const pick = (value: number): void => {
            this.closePicker();
            if (value !== 0) void this.dispatchDamage(member, interaction, value, snapshot);
        };
        if (this.options.options().pickerStyle === 'linear') {
            this.openChoicePicker(member.id, event, {
                values: recordSheetDamageChoices(range.min, range.max),
                selected: 0,
                title: range.title,
                targetType: 'armor',
                onPick: choice => pick(Number(choice.value)),
            });
            return;
        }
        this.openNumericPicker(member.id, event, {
            min: range.min,
            max: range.max,
            threshold: range.threshold,
            selected: 0,
            title: range.title,
            onPick: value => pick(value),
        });
    }

    private async dispatchDamage(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' | 'shield' }>,
        delta: number,
        snapshot: MekRecordSheetSnapshot,
    ): Promise<void> {
        if (interaction.kind !== 'armor' || delta <= 0) {
            await this.dispatchDirect(member, { ...interaction, expectedRevision: snapshot.stateRevision }, delta);
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
        if (armorDamage > 0) {
            const accepted = await this.dispatchDirect(
                member,
                { ...interaction, expectedRevision: snapshot.stateRevision },
                armorDamage,
            );
            if (!accepted) return;
        }
        const internalDamage = delta - armorDamage;
        if (internalDamage <= 0) return;
        const current = this.currentMekUnit(member);
        if (!current) return;
        await this.dispatchCommand(member, {
            type: 'damage-internal',
            locationId: interaction.locationId,
            amount: internalDamage,
            target: pending ? 'pending' : 'committed',
            hardenedArmorApplies,
            armorDamagedBySameHit: armorDamage > 0,
        });
    }

    private openCriticalPicker(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'critical' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
        if (!snapshot) return;
        const handlers = new Map<string, Parameters<typeof member.force.dispatchMekEquipmentChoice>[0]>();
        const values = this.criticalChoices(member, interaction, snapshot, handlers);
        if (values.length === 0) return;
        const ammo = snapshot.criticalSlots
            .find(candidate => candidate.slotId === interaction.slotId)
            ?.components.find(component => component.ammo !== undefined)
            ?.ammo;
        this.openChoicePicker(member.id, event, {
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
            onPick: choice => void this.applyCriticalChoice(member, interaction, choice, handlers),
        });
    }

    private criticalChoices(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'critical' }>,
        snapshot: MekRecordSheetSnapshot,
        handlers: Map<string, Parameters<typeof member.force.dispatchMekEquipmentChoice>[0]>,
    ): PickerChoice[] {
        const slot = snapshot.criticalSlots.find(candidate => candidate.slotId === interaction.slotId);
        if (!slot) return [];
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
            values.push({ label: 'Set Ammo', value: 'open-ammo' });
        }
        for (const handler of member.force.getMekEquipmentInteractions()) {
            if (handler.instanceId !== member.id || !interaction.componentIds.includes(handler.componentId)) continue;
            this.appendEquipmentPickerChoices(handler, values, handlers, 'handler');
        }
        return values;
    }

    private async applyCriticalChoice(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'critical' }>,
        choice: PickerChoice,
        handlers: Map<string, Parameters<typeof member.force.dispatchMekEquipmentChoice>[0]>,
    ): Promise<void> {
        if (!choice.keepOpen) this.closePicker();
        const value = String(choice.value);
        if (value === 'hit' || value === 'repair') {
            const current = this.currentMekUnit(member);
            if (current) await this.dispatchDirect(
                member,
                { ...interaction, expectedRevision: current.state.stateRevision },
                value === 'hit' ? 1 : -1,
            );
        } else if (value === 'open-ammo') {
            this.overlays.openEquipment(member.id, new Event('click'), 'ammo');
        } else if (value.startsWith('ammo-add:') || value.startsWith('ammo-spend:')) {
            const componentId = value.slice(value.indexOf(':') + 1) as ComponentId;
            const current = this.currentMekUnit(member);
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
                    return;
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
                await this.dispatchCommand(member, command);
            }
        } else {
            const token = handlers.get(value);
            if (token) {
                const result = await member.force.dispatchMekEquipmentChoice(token);
                if (!result.accepted) this.rejected(`Equipment action rejected: ${result.reason}`);
            }
        }
        if (choice.keepOpen && this.picker?.unitId === member.id && isChoicePickerInstance(this.picker.instance)) {
            const current = member.mekRecordSheetSnapshot();
            if (current) {
                handlers.clear();
                this.picker.instance.component.values.set(this.criticalChoices(member, interaction, current, handlers));
            }
        }
    }

    private openHeatSinksPicker(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'heat-sinks-off' }>,
        event: Event,
    ): void {
        const unit = this.currentMekUnit(member, interaction.expectedRevision);
        if (!unit) return;
        const heatSinkCount = unit.entity.totalHeatSinks();
        const heatsinksOff = Math.max(0, Math.min(heatSinkCount, unit.query.heatState().heatsinksOff));
        const min = heatsinksOff - heatSinkCount;
        const max = heatsinksOff;
        const apply = (delta: number): void => {
            this.closePicker();
            const current = this.currentMekUnit(member);
            if (!current) return;
            void this.dispatchDirect(
                member,
                { ...interaction, expectedRevision: current.state.stateRevision },
                current.query.heatState().heatsinksOff - delta,
            );
        };
        if (this.options.options().pickerStyle === 'linear') {
            this.openChoicePicker(member.id, event, {
                values: Array.from({ length: max - min + 1 }, (_, offset) => {
                    const value = min + offset;
                    return { label: String(value), value };
                }),
                selected: 0,
                title: 'Active Heatsinks',
                targetType: 'heatsinks',
                onPick: choice => apply(Number(choice.value)),
            });
            return;
        }
        this.openNumericPicker(member.id, event, {
            min,
            max,
            selected: 0,
            title: 'Active Heatsinks',
            onPick: apply,
        });
    }

    private async promptHeat(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'heat-overflow' }>,
    ): Promise<void> {
        const unit = this.currentMekUnit(member, interaction.expectedRevision);
        if (!unit) return;
        const heat = unit.query.heatState();
        const current = this.options.options().trackPhaseAndTurn
            ? heat.pendingOverride ?? heat.current
            : heat.current;
        const ref = this.dialogs.createDialog<number | null>(InputDialogComponent, {
                data: {
                    title: 'Heat',
                    message: 'Heat',
                    inputType: 'number',
                    minimumValue: 0,
                    defaultValue: current,
                    placeholder: 'Heat value',
                    centerInput: true,
                },
        });
        const value = await firstValueFrom(ref.closed);
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
        const latest = this.currentMekUnit(member);
        if (!latest) return;
        await this.dispatchDirect(member, {
            kind: 'heat',
            heat: Math.max(0, Number(value)),
            expectedRevision: latest.state.stateRevision,
        });
    }

    private openUnitConditionMenu(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'condition-menu' }>,
        event: Event,
    ): void {
        const unit = this.currentMekUnit(member, interaction.expectedRevision);
        const anchor = event.currentTarget;
        if (!unit || !(anchor instanceof Element)) return;
        const { componentRef, closed } = this.openStateDropdown(UNIT_CONDITION_OVERLAY, anchor, event, true);
        componentRef.setInput('choices', MEK_UNIT_CONDITION_CONTROLS
            .filter(control => control.placement === 'menu')
            .map(control => ({
                key: control.key,
                label: control.label,
                color: control.color,
                active: unit.query.hasCondition(control.key),
            })));
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(condition => {
            if (!isUnitConditionKey(condition)) return;
            const current = this.currentMekUnit(member);
            if (current) void this.dispatchDirect(member, {
                kind: 'condition',
                condition,
                expectedRevision: current.state.stateRevision,
            });
            this.overlayManager.closeManagedOverlay(UNIT_CONDITION_OVERLAY);
        });
        this.bindDropdownClose(componentRef.instance, closed, UNIT_CONDITION_OVERLAY);
    }

    private openLocationConditionMenu(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'location-condition-menu' }>,
        event: Event,
    ): void {
        const unit = this.currentMekUnit(member, interaction.expectedRevision);
        const anchor = event.currentTarget;
        const location = unit?.index.locations.get(interaction.locationId);
        if (!unit || !location || !(anchor instanceof Element)) return;
        const { componentRef, closed } = this.openStateDropdown(LOCATION_CONDITION_OVERLAY, anchor, event, false);
        const update = (): void => {
            const current = this.currentMekUnit(member);
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
            const current = this.currentMekUnit(member);
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
            await this.dispatchCommand(member, {
                type: 'set-location-condition',
                locationId: interaction.locationId,
                condition: conditionKey,
                value: next,
                target: pending ? 'pending' : 'committed',
            });
            update();
        };
        update();
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed))
            .subscribe(condition => {
                if (condition === CRITICAL_CHANCE_ACTION || condition === CRITICAL_ROLL_ACTION) {
                    this.overlayManager.closeManagedOverlay(LOCATION_CONDITION_OVERLAY);
                    if (condition === CRITICAL_CHANCE_ACTION) {
                        this.openMekCriticalChanceDialog(member, interaction.locationId);
                    } else {
                        this.openMekCriticalRollDialog(member, interaction.locationId);
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
            .subscribe(() => this.overlayManager.closeManagedOverlay(LOCATION_CONDITION_OVERLAY));
        this.bindDropdownClose(componentRef.instance, closed, LOCATION_CONDITION_OVERLAY);
    }

    private openMekCriticalChanceDialog(member: CBTMekForceMember, locationId: LocationId): void {
        const unit = member.force.getUnitSnapshot(member.id);
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
                void this.applyMekBlowOff(member, locationId, target);
                return;
            }
            this.openMekCriticalRollDialog(member, locationId, result.count, target);
        });
    }

    private async applyMekBlowOff(
        member: CBTMekForceMember,
        locationId: LocationId,
        target: MekCriticalMutationTarget,
    ): Promise<void> {
        const unit = member.force.getUnitSnapshot(member.id);
        if (!unit || !hasMekRuntime(unit)) return;
        const plan = unit.query.mekBlowOff(locationId, target);
        const applied = await this.dispatchCommand(member, {
            type: 'apply-mek-blow-off',
            locationId,
            target,
        });
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
        requiredHits?: number,
        target = this.criticalMutationTarget(),
    ): void {
        this.dialogs.createDialog(MekCriticalRollDialogComponent, {
            data: {
                member,
                locationId,
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
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'crew-skill' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
        const position = snapshot?.crew.find(row => row.positionId === interaction.positionId);
        if (!snapshot || !position) return;
        this.openChoicePicker(member.id, event, {
            values: [8, 7, 6, 5, 4, 3, 2, 1, 0].map(value => ({ label: String(value), value })),
            selected: position[interaction.skill],
            title: interaction.skill,
            suggestedStyle: 'radial',
            targetType: 'skill',
            onPick: choice => {
                this.closePicker();
                void this.replaceCrewField(member, interaction.positionId, interaction.skill, Number(choice.value));
            },
        });
    }

    private async promptCrewName(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'crew-name' }>,
    ): Promise<void> {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
        const position = snapshot?.crew.find(row => row.positionId === interaction.positionId);
        if (!position) return;
        await this.pilotEditor.editCBTMember(member.force, member.id);
    }

    private openCrewStateMenu(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'crew-state-menu' }>,
        event: Event,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
        const position = snapshot?.crew.find(row => row.positionId === interaction.positionId);
        const anchor = event.currentTarget;
        if (!snapshot || !position || !(anchor instanceof Element)) return;
        const { componentRef, closed } = this.openStateDropdown(CREW_STATE_OVERLAY, anchor, event, true);
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
            const current = member.mekRecordSheetSnapshot();
            const row = current?.crew.find(candidate => candidate.positionId === interaction.positionId);
            if (current && row) {
                if (choice === 'swap') {
                    void this.swapCrewPositions(member, row.occurrence);
                } else if (choice === 'unconscious' || choice === 'ejected') {
                    const active = choice === 'unconscious' ? row.state.unconscious : row.state.ejected;
                    void this.dispatchCommand(member, {
                        type: 'set-crew-state',
                        positionId: interaction.positionId,
                        wounds: row.state.wounds,
                        unconscious: choice === 'unconscious' ? !active : row.state.unconscious,
                        ejected: choice === 'ejected' ? !active : row.state.ejected,
                    });
                }
            }
            this.overlayManager.closeManagedOverlay(CREW_STATE_OVERLAY);
        });
        this.bindDropdownClose(componentRef.instance, closed, CREW_STATE_OVERLAY);
    }

    private async replaceCrewField(
        member: CBTMekForceMember,
        positionId: MekRecordSheetSnapshot['crew'][number]['positionId'],
        field: 'gunnery' | 'piloting' | 'name',
        value: string | number,
    ): Promise<void> {
        const profile = member.force.getUnitCrewProfile(member.id);
        if (!profile) return;
        const positions = profile.positions.map(position => position.positionId === positionId
            ? { ...position, [field]: value }
            : position);
        const result = await member.force.replaceUnitCrewProfile(member.id, positions);
        if (!result) this.rejected('The crew profile could not be saved.');
    }

    private async swapCrewPositions(member: CBTMekForceMember, occurrence: number): Promise<void> {
        const snapshot = member.mekRecordSheetSnapshot();
        const profile = member.force.getUnitCrewProfile(member.id);
        const source = snapshot?.crew.find(position => position.occurrence === occurrence);
        const target = snapshot?.crew.find(position => position.occurrence === (occurrence === 0 ? 1 : 0));
        if (!snapshot || !profile || !source || !target) return;
        const byId = new Map(profile.positions.map(position => [position.positionId, position] as const));
        const sourceProfile = byId.get(source.positionId);
        const targetProfile = byId.get(target.positionId);
        if (!sourceProfile || !targetProfile) return;
        const positions = profile.positions.map(position => {
            const replacement = position.positionId === source.positionId
                ? targetProfile
                : position.positionId === target.positionId ? sourceProfile : null;
            return replacement === null ? position : {
                ...replacement,
                positionId: position.positionId,
            };
        });
        const result = await member.force.replaceUnitCrewProfile(member.id, positions);
        if (!result) this.rejected('The crew profile could not be saved.');
    }

    private async selectInventory(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'inventory-selection' }>,
        event: Event,
    ): Promise<void> {
        let panel = member.force.getEquipmentPanelSnapshot(member.id);
        if (!panel || panel.stateRevision !== interaction.expectedRevision) return;
        const rows = interaction.componentIds
            .map(componentId => panel?.components.find(row => row.componentId === componentId))
            .filter((row): row is NonNullable<typeof row> => row !== undefined);
        const forceSelected = interaction.mode !== undefined && rows.some(row => row.mode !== interaction.mode);
        if (interaction.mode !== undefined) {
            for (const row of rows) {
                if (!row.modes.includes(interaction.mode) || row.mode === interaction.mode) continue;
                const snapshot = member.mekRecordSheetSnapshot();
                if (!snapshot || !await this.dispatchCommand(member, {
                    type: 'set-component-mode',
                    componentId: row.componentId,
                    mode: interaction.mode,
                })) return;
            }
            panel = member.force.getEquipmentPanelSnapshot(member.id);
            if (!panel) return;
        }
        const weapons = interaction.componentIds
            .map(componentId => panel?.components.find(row => row.componentId === componentId))
            .filter((row): row is NonNullable<typeof row> => row?.weapon !== undefined);
        if (weapons.length === 0) {
            this.openEquipmentChoices(member, interaction.componentIds, event);
            return;
        }
        if (panel.targets.length > 1) {
            this.openTargetMenu(member, interaction.componentIds, panel, event);
            return;
        }
        const desired = panel.targets.length === 1
            ? { kind: 'target' as const, targetId: panel.targets[0].targetId }
            : interaction.range
                ? { kind: 'manual-range' as const, range: interaction.range }
                : { kind: 'selected' as const };
        const allSelected = weapons.every(row => sameSelection(row.weapon?.selection, desired));
        await this.setComponentSelections(
            member,
            weapons.map(row => row.componentId),
            !forceSelected && allSelected ? null : desired,
        );
    }

    private async selectAction(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'action-selection' }>,
        event: Event,
    ): Promise<void> {
        const panel = member.force.getEquipmentPanelSnapshot(member.id);
        if (!panel || panel.stateRevision !== interaction.expectedRevision) return;
        const actionKey = attackerActionTargetKey(interaction.target);
        const attack = panel.physicalAttacks.find(candidate =>
            attackerActionTargetKey(candidate.target) === actionKey);
        if (!attack?.available || !attack.selectable) return;
        if (panel.targets.length > 1) {
            this.openActionTargetMenu(member, interaction.target, panel, event);
            return;
        }
        const desired: AttackerActionSelection = panel.targets.length === 1
            ? { kind: 'target', targetId: panel.targets[0].targetId }
            : { kind: 'selected' };
        await this.setActionSelection(
            member,
            interaction.target,
            sameSelection(attack.selection, desired) ? null : desired,
        );
    }

    private openTargetMenu(
        member: CBTMekForceMember,
        componentIds: readonly ComponentId[],
        panel: EquipmentPanelSnapshot,
        event: Event,
    ): void {
        const targetIds = componentIds.map(componentId => panel.components.find(row => row.componentId === componentId)?.weapon?.selection)
            .filter((selection): selection is { readonly kind: 'target'; readonly targetId: EncounterTargetId } => selection?.kind === 'target')
            .map(selection => selection.targetId);
        const selectedTargetId = targetIds.length === componentIds.length && targetIds.every(id => id === targetIds[0])
            ? targetIds[0]
            : null;
        const component = componentIds
            .map(componentId => panel.components.find(row => row.componentId === componentId))
            .find(row => row?.weapon !== undefined);
        const recordSheet = member.mekRecordSheetSnapshot();
        const targetNumberTexts = component === undefined || recordSheet === null
            ? {}
            : Object.fromEntries(panel.targets.map(target => [
                target.targetId,
                projectWeaponTargetPresentation(
                    component,
                    equipmentPanelRuntimeTarget(target, panel.ruleset),
                    panel.crew.gunnery,
                    recordSheet.movement.declared.kind === 'supported'
                        ? recordSheet.movement.declared.mode
                        : null,
                    panel.ruleset,
                ).targetNumberText,
            ]));
        this.openTargetChoiceMenu(panel, event, selectedTargetId, targetNumberTexts, targetId => {
            void this.setComponentSelections(
                member,
                componentIds,
                targetId === null ? null : { kind: 'target', targetId },
            );
        });
    }

    private openActionTargetMenu(
        member: CBTMekForceMember,
        target: Extract<MekRecordSheetInteraction, { readonly kind: 'action-selection' }>['target'],
        panel: EquipmentPanelSnapshot,
        event: Event,
    ): void {
        const targeting = member.force.getAttackerTargeting(member.id);
        if (!targeting) return;
        const selection = attackerActionSelection(targeting.state, target);
        this.openTargetChoiceMenu(
            panel,
            event,
            selection?.kind === 'target' ? selection.targetId : null,
            {},
            targetId => void this.setActionSelection(
                member,
                target,
                targetId === null ? null : { kind: 'target', targetId },
            ),
        );
    }

    private openTargetChoiceMenu(
        panel: EquipmentPanelSnapshot,
        event: Event,
        selectedTargetId: EncounterTargetId | null,
        targetNumberTexts: Readonly<Record<string, string>>,
        select: (targetId: EncounterTargetId | null) => void,
    ): void {
        const anchor = event.currentTarget;
        if (!(anchor instanceof Element)) return;
        this.closePicker();
        const portal = new ComponentPortal(WeaponTargetChoiceMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(
            TARGET_OVERLAY,
            anchor,
            portal,
            {
                hasBackdrop: false,
                panelClass: 'weapon-target-choice-overlay-panel',
                closeOnOutsideClick: true,
                positions: [
                    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
                    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
                ],
            },
        );
        componentRef.setInput('targets', panel.targets.map(row => ({
            id: row.targetId,
            letter: row.letter,
            name: row.name,
            color: row.color,
        })));
        componentRef.setInput('selectedTargetId', selectedTargetId);
        componentRef.setInput('targetNumberTexts', targetNumberTexts);
        componentRef.changeDetectorRef.detectChanges();
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(targetId => {
            const resolved = targetId === null
                ? null
                : panel.targets.find(row => row.targetId === targetId)?.targetId ?? null;
            select(resolved);
            this.overlayManager.closeManagedOverlay(TARGET_OVERLAY);
        });
    }

    private openEquipmentChoices(member: CBTMekForceMember, componentIds: readonly ComponentId[], event: Event): void {
        const tokenByValue = new Map<string, MekEquipmentChoiceToken>();
        const values = this.equipmentPickerChoices(member, componentIds, tokenByValue);
        if (values.length === 0) return;
        this.openChoicePicker(member.id, event, {
            values,
            selected: null,
            title: values.length === 1 ? values[0].label : 'Equipment',
            targetType: 'inventory',
            style: 'linear',
            onPick: choice => {
                if (!choice.keepOpen) this.closePicker();
                const token = tokenByValue.get(String(choice.value));
                if (token) void member.force.dispatchMekEquipmentChoice(token).then(result => {
                    if (!result.accepted) this.rejected(`Equipment action rejected: ${result.reason}`);
                    if (choice.keepOpen && this.picker?.unitId === member.id
                        && isChoicePickerInstance(this.picker.instance)) {
                        tokenByValue.clear();
                        this.picker.instance.component.values.set(
                            this.equipmentPickerChoices(member, componentIds, tokenByValue),
                        );
                    }
                });
            },
        });
    }

    private equipmentPickerChoices(
        member: CBTMekForceMember,
        componentIds: readonly ComponentId[],
        tokenByValue: Map<string, MekEquipmentChoiceToken>,
    ): PickerChoice[] {
        const values: PickerChoice[] = [];
        for (const interaction of member.force.getMekEquipmentInteractions()) {
            if (interaction.instanceId !== member.id || !componentIds.includes(interaction.componentId)) continue;
            this.appendEquipmentPickerChoices(interaction, values, tokenByValue, 'equipment');
        }
        return values;
    }

    /** Reconstructs the original picker vocabulary from opaque command tokens. */
    private appendEquipmentPickerChoices(
        interaction: MekEquipmentInteraction,
        values: PickerChoice[],
        tokenByValue: Map<string, MekEquipmentChoiceToken>,
        prefix: string,
    ): void {
        const emittedDropdowns = new Set<string>();
        for (const choice of interaction.choices) {
            if (choice.displayType === 'dropdown') {
                const groupLabel = choice.groupLabel ?? choice.label;
                const groupKey = `${choice.handlerId}\0${groupLabel}`;
                if (emittedDropdowns.has(groupKey)) continue;
                emittedDropdowns.add(groupKey);
                const options = interaction.choices.filter(candidate => candidate.displayType === 'dropdown'
                    && candidate.handlerId === choice.handlerId
                    && (candidate.groupLabel ?? candidate.label) === groupLabel);
                const selected = options.find(candidate => candidate.active) ?? options[0];
                if (!selected) continue;
                const selectedValue = this.registerEquipmentPickerToken(prefix, selected, tokenByValue);
                values.push({
                    label: groupLabel,
                    value: selectedValue,
                    active: options.some(candidate => candidate.active),
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
                            : this.registerEquipmentPickerToken(prefix, option, tokenByValue),
                        disabled: option.disabled,
                    })),
                });
                continue;
            }
            values.push({
                label: choice.label,
                ...(choice.shortLabel === undefined ? {} : { shortLabel: choice.shortLabel }),
                value: this.registerEquipmentPickerToken(prefix, choice, tokenByValue),
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

    private registerEquipmentPickerToken(
        prefix: string,
        choice: MekEquipmentChoice,
        tokenByValue: Map<string, MekEquipmentChoiceToken>,
    ): string {
        const key = `${prefix}:${tokenByValue.size}`;
        tokenByValue.set(key, choice.token);
        return key;
    }

    private async setComponentSelections(
        member: CBTMekForceMember,
        componentIds: readonly ComponentId[],
        selection: { readonly kind: 'selected' }
            | { readonly kind: 'target'; readonly targetId: EncounterTargetId }
            | { readonly kind: 'manual-range'; readonly range: 'short' | 'medium' | 'long' | 'extreme' }
            | null,
    ): Promise<void> {
        for (const componentId of componentIds) {
            const targeting = member.force.getAttackerTargeting(member.id);
            if (!targeting) return;
            const result = await member.force.dispatchAttackerTargeting(member.id, {
                type: 'edit-attacker-targeting',
                edit: { kind: 'set-component-selection', componentId, selection },
            });
            if (!result.accepted) {
                this.rejected('This force is read-only.');
                return;
            }
        }
    }

    private async setActionSelection(
        member: CBTMekForceMember,
        target: Extract<MekRecordSheetInteraction, { readonly kind: 'action-selection' }>['target'],
        selection: AttackerActionSelection | null,
    ): Promise<void> {
        const targeting = member.force.getAttackerTargeting(member.id);
        if (!targeting) return;
        const result = await member.force.dispatchAttackerTargeting(member.id, {
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-action-selection', target, selection },
        });
        if (!result.accepted) this.rejected('This force is read-only.');
    }

    private openReferenceTable(
        member: CBTMekForceMember,
        interaction: Extract<MekRecordSheetInteraction, { readonly kind: 'reference-table' }>,
    ): void {
        const snapshot = this.currentSnapshot(member, interaction.expectedRevision);
        if (!snapshot) return;
        this.dialogs.createDialog(ClusterTableDialogComponent, {
            data: {
                unit: member.entity,
                gameRules: gameRulesFor(snapshot.ruleset),
            },
        });
    }

    private openStateDropdown(
        key: string,
        anchor: Element,
        event: Event,
        closeOnSelect: boolean,
    ) {
        this.closePicker();
        this.overlayManager.closeAllManagedOverlays();
        const portal = new ComponentPortal(UnitStateDropdownComponent, null, this.injector);
        const result = this.overlayManager.createManagedOverlay(
            key,
            anchor,
            portal,
            {
                hasBackdrop: false,
                panelClass: 'unit-state-dropdown-overlay-panel',
                closeOnOutsideClick: true,
            },
        );
        result.componentRef.setInput('closeOnSelect', closeOnSelect);
        result.componentRef.setInput('initialEvent', event instanceof PointerEvent ? event : null);
        return result;
    }

    private bindDropdownClose(
        instance: UnitStateDropdownComponent,
        closed: ReturnType<OverlayManagerService['createManagedOverlay']>['closed'],
        key: string,
    ): void {
        outputToObservable(instance.cancelled).pipe(takeUntil(closed))
            .subscribe(() => this.overlayManager.closeManagedOverlay(key));
    }

    private openNumericPicker(
        unitId: string,
        event: Event,
        options: {
            readonly min: number;
            readonly max: number;
            readonly threshold?: number;
            readonly selected: number;
            readonly title: string;
            readonly onPick: (value: number) => void;
        },
    ): void {
        this.closePicker();
        this.zoomPan.cancelGesture();
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        target?.classList.add('picker-active');
        const instance = this.pickerFactory.createNumericPicker({
            min: options.min,
            max: options.max,
            threshold: options.threshold,
            selected: options.selected,
            position: recordSheetEventPosition(event),
            title: options.title,
            lightTheme: this.options.options().colorScheme === 'night',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onPick: result => options.onPick(result.value),
            onCancel: () => this.closePicker(),
        });
        this.picker = { unitId, instance, target };
    }

    private openChoicePicker(
        unitId: string,
        event: Event,
        options: {
            readonly values: PickerChoice[];
            readonly selected: string | number | null;
            readonly title: string;
            readonly style?: 'linear' | 'radial' | 'auto';
            readonly suggestedStyle?: 'linear' | 'radial' | 'auto';
            readonly targetType?: PickerTargetType;
            readonly onPick: (choice: PickerChoice) => void;
        },
    ): void {
        this.closePicker();
        this.zoomPan.cancelGesture();
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        target?.classList.add('picker-active');
        const rect = target?.getBoundingClientRect();
        const inventory = options.targetType === 'inventory';
        const critical = options.targetType === 'crit';
        const position = rect
            ? inventory ? { x: rect.right + 4, y: rect.top + rect.height / 2 }
                : critical ? { x: rect.left, y: rect.top }
                    : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : recordSheetEventPosition(event);
        const instance = this.pickerFactory.createChoicePicker({
            values: options.values,
            selected: options.selected,
            position,
            title: options.title,
            lightTheme: this.options.options().colorScheme === 'night',
            style: options.style,
            suggestedStyle: options.suggestedStyle,
            targetType: options.targetType,
            horizontal: inventory || critical,
            align: critical ? 'topleft' : inventory ? 'left' : 'center',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onPick: options.onPick,
            onCancel: () => this.closePicker(),
        });
        this.picker = { unitId, instance, target };
    }

    private async dispatchDirect(
        member: CBTMekForceMember,
        interaction: MekRecordSheetInteraction,
        delta?: number,
    ): Promise<boolean> {
        const source = this.currentCommandSource(member, interaction.expectedRevision);
        if (!source) return false;
        const command = recordSheetCommand(
            interaction,
            source,
            this.options.options().trackPhaseAndTurn,
            delta,
        );
        return this.dispatchCommand(member, command);
    }

    private async dispatchCommand(member: CBTMekForceMember, command: CBTUnitCommand): Promise<boolean> {
        const result = await member.force.dispatchMekUnitCommand(member.id, command);
        if (!result.accepted) {
            this.rejected('This force is read-only.');
            return false;
        }
        return true;
    }

    private currentSnapshot(member: CBTMekForceMember, expectedRevision: number): MekRecordSheetSnapshot | null {
        const snapshot = member.mekRecordSheetSnapshot();
        return snapshot?.stateRevision === expectedRevision ? snapshot : null;
    }

    private currentCommandSource(
        member: CBTMekForceMember,
        expectedRevision: number,
    ): MekRecordSheetCommandSource | null {
        const unit = this.currentMekUnit(member, expectedRevision);
        if (!unit) return null;
        return Object.freeze({
            query: unit.query,
            heatSinkCount: unit.entity.totalHeatSinks(),
            heatPolicy: this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
                ? 'automatic'
                : 'manual',
        });
    }

    private currentMekUnit(member: CBTMekForceMember, expectedRevision?: number) {
        const unit = member.force.getUnitSnapshot(member.id);
        if (!unit || !hasMekRuntime(unit)) return null;
        return expectedRevision === undefined || unit.state.stateRevision === expectedRevision
            ? unit
            : null;
    }

    private closePicker(): void {
        this.picker?.target?.classList.remove('picker-active');
        this.picker?.instance.destroy();
        this.picker = null;
    }

    private closeSheetOverlays(): void {
        this.overlayManager.closeManagedOverlay(UNIT_CONDITION_OVERLAY);
        this.overlayManager.closeManagedOverlay(LOCATION_CONDITION_OVERLAY);
        this.overlayManager.closeManagedOverlay(CREW_STATE_OVERLAY);
        this.overlayManager.closeManagedOverlay(TARGET_OVERLAY);
    }

    private rejected(message: string): void {
        this.toast.showToast(message, 'error');
    }
}

function sameSelection(
    left: unknown,
    right: unknown,
): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
