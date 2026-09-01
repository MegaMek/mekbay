// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, inject } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom, takeUntil } from 'rxjs';

import type { CBTForceMember } from '../../../models/force-member.model';
import { isCBTMekForceMember } from '../../../models/force-member.model';
import type {
    NonMekRecordSheetCrewPosition,
    NonMekRecordSheetDamageTrack,
    NonMekRecordSheetSnapshot,
} from '../../../models/runtime/non-mek-record-sheet';
import type { CrewMemberState } from '../../../models/crew.model';
import type { ComponentId } from '../../../models/entity/entity-identifiers';
import type {
    EquipmentPanelComponent,
    EquipmentPanelSnapshot,
} from '../../../models/runtime/equipment-panel';
import {
    equipmentPanelRuntimeTarget,
    projectWeaponTargetPresentation,
} from '../../../models/runtime/equipment-panel';
import type { AttackerSelection } from '../../../models/runtime/attacker-targeting-state';
import type { EncounterTargetId } from '../../../models/runtime/encounter-runtime';
import { isUnitConditionKey, type UnitConditionKey } from '../../../models/unit-condition.model';
import {
    hasNonMekCrewState,
    type NonMekUnitCommand,
} from '../../../models/runtime/non-mek-unit-instance';
import {
    crewStateDefinitions,
    unitConditionControls,
} from '../../../models/unit-status-presentation';
import { LoggerService } from '../../../services/logger.service';
import { DialogsService } from '../../../services/dialogs.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { OptionsService } from '../../../services/options.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ToastService } from '../../../services/toast.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import type { PickerInstance } from '../../picker/picker.interface';
import {
    bindNonMekRecordSheet,
    type NonMekRecordSheetBinding,
    type NonMekRecordSheetInteraction,
} from '../non-mek-record-sheet-binder';
import {
    recordSheetDamageChoices,
    recordSheetEventPosition,
    type RecordSheetDamagePickerRange,
} from '../mek-record-sheet-interaction.util';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';
import { UnitStateDropdownComponent } from '../unit-state-dropdown.component';
import { InputDialogComponent } from '../../input-dialog/input-dialog.component';
import { WeaponTargetChoiceMenuComponent } from '../../equipment-dialog/weapon-target-choice-menu.component';

const ENTITY_CONDITION_OVERLAY = 'entity-sheet-unit-condition';
const ENTITY_CREW_STATE_OVERLAY = 'entity-sheet-crew-state';
const ENTITY_WEAPON_TARGET_OVERLAY = 'entity-sheet-weapon-target';

interface BoundEntitySheetPage {
    readonly svg: SVGSVGElement;
    readonly binding: NonMekRecordSheetBinding;
}

interface BoundEntitySheets {
    readonly member: CBTForceMember;
    readonly pages: Map<SVGSVGElement, BoundEntitySheetPage>;
    readonly subscription: { unsubscribe(): void };
}

interface OpenEntityPicker {
    readonly unitId: string;
    readonly instance: PickerInstance;
    readonly target: Element | null;
}

/** Direct non-Mek Entity + sparse-runtime binding for a supplied record sheet. */
@Injectable()
export class PageViewerNonMekRuntimeService {
    private readonly logger = inject(LoggerService);
    private readonly dialogs = inject(DialogsService);
    private readonly injector = inject(Injector);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly options = inject(OptionsService);
    private readonly pickerFactory = inject(PickerFactoryService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
    private readonly toast = inject(ToastService);
    private readonly zoomPan = inject(PageViewerZoomPanService);
    private readonly bound = new Map<string, BoundEntitySheets>();
    private picker: OpenEntityPicker | null = null;

    isPickerOpen(unitId: string): boolean {
        return this.picker?.unitId === unitId;
    }

    bind(member: CBTForceMember, svg: SVGSVGElement): boolean {
        if (isCBTMekForceMember(member)) return false;
        let current = this.bound.get(member.id);
        if (current?.member !== member) {
            this.destroyBinding(member.id);
            current = undefined;
        }
        if (current?.pages.has(svg)) return true;

        const snapshot = this.snapshot(member);
        if (!snapshot) return false;
        svg.classList.toggle('read-only', member.force.readOnly());
        const equipment = member.force.getEquipmentPanelSnapshot(member.id);
        const binding = bindNonMekRecordSheet(
            svg,
            snapshot,
            member.force.readOnly()
                ? undefined
                : (interaction, event) => this.handle(member, interaction, event),
            equipment,
        );
        if (!current) {
            current = {
                member,
                pages: new Map(),
                subscription: member.force.changed.subscribe(changedUnitIds => {
                    if (changedUnitIds?.includes(member.id) ?? true) this.render(member);
                }),
            };
            this.bound.set(member.id, current);
        }
        current.pages.set(svg, { svg, binding });
        this.renderPage(current.pages.get(svg)!, snapshot, equipment);
        return true;
    }

    cleanupUnused(keepUnitIds: ReadonlySet<string>): void {
        if (this.picker && !keepUnitIds.has(this.picker.unitId)) this.closePicker();
        for (const unitId of [...this.bound.keys()]) {
            if (!keepUnitIds.has(unitId)) this.destroyBinding(unitId);
        }
    }

    clear(): void {
        this.closePicker();
        for (const unitId of [...this.bound.keys()]) this.destroyBinding(unitId);
    }

    private snapshot(member: CBTForceMember): NonMekRecordSheetSnapshot | null {
        return member.nonMekRecordSheetSnapshot();
    }

    private render(member: CBTForceMember): void {
        const current = this.bound.get(member.id);
        const snapshot = this.snapshot(member);
        if (!current || current.member !== member || !snapshot) return;
        const equipment = member.force.getEquipmentPanelSnapshot(member.id);
        for (const page of current.pages.values()) this.renderPage(page, snapshot, equipment);
    }

    private renderPage(
        page: BoundEntitySheetPage,
        snapshot: NonMekRecordSheetSnapshot,
        equipment: EquipmentPanelSnapshot | null,
    ): void {
        const issues = page.binding.render(snapshot, equipment);
        if (issues.length > 0 && page.svg.dataset['mekbayPartialSheet'] !== '1') {
            this.logger.warn(`Record-sheet layout omissions for ${snapshot.displayName}: ${issues.join('; ')}`);
        }
    }

    handle(member: CBTForceMember, interaction: NonMekRecordSheetInteraction, event: Event): void {
        const snapshot = this.snapshot(member);
        if (!snapshot || snapshot.stateRevision !== interaction.expectedRevision) return;
        if (interaction.kind === 'heat') {
            void this.setHeat(member, interaction.heat);
            return;
        }
        if (interaction.kind === 'heat-overflow') {
            void this.promptHeat(member, snapshot);
            return;
        }
        if (interaction.kind === 'apply-heat') {
            void this.applyHeat(member);
            return;
        }
        if (interaction.kind === 'heat-sinks-off') {
            this.openHeatSinksPicker(member, snapshot, event);
            return;
        }
        if (interaction.kind === 'inventory-selection') {
            void this.selectInventory(member, interaction, event);
            return;
        }
        if (interaction.kind === 'soldier') {
            void this.applySoldierSelection(member, interaction, snapshot);
            return;
        }
        if (interaction.kind === 'damage-track') {
            void this.handleDamageTrack(member, interaction, snapshot, event);
            return;
        }
        if (interaction.kind === 'condition') {
            void this.setCondition(member, interaction.condition, !snapshot.conditions.includes(interaction.condition));
            return;
        }
        if (interaction.kind === 'condition-menu') {
            this.openConditionMenu(member, snapshot, event);
            return;
        }
        if (interaction.kind === 'crew-wounds') {
            void this.setCrewWounds(member, interaction.positionId, interaction.wounds);
            return;
        }
        if (interaction.kind === 'crew-state-menu') {
            this.openCrewStateMenu(member, interaction.positionId, snapshot, event);
            return;
        }
        if (interaction.kind === 'crew-profile') {
            void this.pilotEditor.editCBTMember(member.force, member.id);
            return;
        }
        this.openDamagePicker(member, interaction, snapshot, event);
    }

    private async selectInventory(
        member: CBTForceMember,
        interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'inventory-selection' }>,
        event: Event,
    ): Promise<void> {
        let panel = member.force.getEquipmentPanelSnapshot(member.id);
        if (!panel || panel.stateRevision !== interaction.expectedRevision) return;
        if (interaction.mode !== undefined) {
            const modeAccepted = await this.setInventoryModes(
                member,
                interaction.componentIds,
                interaction.mode,
                panel,
            );
            if (!modeAccepted) return;
            panel = member.force.getEquipmentPanelSnapshot(member.id);
            if (!panel) return;
        }
        const weapons = [...new Set(interaction.componentIds
            .map(componentId => equipmentPanelComponentById(panel, componentId)))]
            .filter((row): row is NonNullable<typeof row> & {
                readonly weapon: NonNullable<NonNullable<typeof row>['weapon']>;
            } => row?.weapon !== undefined);
        if (weapons.length === 0 || weapons.every(row => !row.weapon.selectable)) return;
        if (panel.targets.length > 1) {
            this.openWeaponTargetMenu(member, interaction.componentIds, panel, event);
            return;
        }
        const desired: AttackerSelection = panel.targets.length === 1
            ? { kind: 'target', targetId: panel.targets[0].targetId }
            : interaction.range !== undefined
                ? { kind: 'manual-range', range: interaction.range }
                : { kind: 'selected' };
        const allSelected = weapons.every(row => sameAttackerSelection(row.weapon.selection, desired));
        const selection = allSelected ? null : desired;
        await this.setComponentSelections(
            member,
            equipmentPanelSelectionComponentIds(panel, interaction.componentIds, selection),
            selection,
        );
    }

    private async setInventoryModes(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        mode: string,
        initialPanel: EquipmentPanelSnapshot,
    ): Promise<boolean> {
        for (const componentId of componentIds) {
            const panel = member.force.getEquipmentPanelSnapshot(member.id) ?? initialPanel;
            const component = equipmentPanelComponentById(panel, componentId);
            if (!component || !component.modes.includes(mode)) return false;
            if (component.mode === mode) continue;
            const snapshot = this.snapshot(member);
            if (!snapshot) return false;
            const result = await member.force.dispatchNonMekUnitCommand(member.id, {
                kind: 'set-component-mode',
                componentId,
                mode,
            });
            if (!result.accepted) {
                this.showRejectedEdit();
                return false;
            }
        }
        return true;
    }

    private openWeaponTargetMenu(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        panel: EquipmentPanelSnapshot,
        event: Event,
    ): void {
        const anchor = event.currentTarget;
        if (!(anchor instanceof Element)) return;
        const selectedIds = componentIds.map(componentId => equipmentPanelComponentById(
            panel,
            componentId,
        )?.weapon?.selection)
            .filter((selection): selection is { readonly kind: 'target'; readonly targetId: EncounterTargetId } =>
                selection?.kind === 'target')
            .map(selection => selection.targetId);
        const selectedTargetId = selectedIds.length === componentIds.length
            && selectedIds.every(targetId => targetId === selectedIds[0])
            ? selectedIds[0]
            : null;
        const weapon = componentIds
            .map(componentId => equipmentPanelComponentById(panel, componentId))
            .find(row => row?.weapon !== undefined);
        const targetNumberTexts = weapon === undefined
            ? {}
            : Object.fromEntries(panel.targets.map(target => [
                target.targetId,
                projectWeaponTargetPresentation(
                    weapon,
                    equipmentPanelRuntimeTarget(target, panel.ruleset),
                    panel.crew.gunnery,
                    null,
                    panel.ruleset,
                ).targetNumberText,
            ]));

        this.closePicker();
        const portal = new ComponentPortal(WeaponTargetChoiceMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(
            ENTITY_WEAPON_TARGET_OVERLAY,
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
            const selection = resolved === null ? null : { kind: 'target' as const, targetId: resolved };
            void this.setComponentSelections(
                member,
                equipmentPanelSelectionComponentIds(panel, componentIds, selection),
                selection,
            );
            this.overlayManager.closeManagedOverlay(ENTITY_WEAPON_TARGET_OVERLAY);
        });
    }

    private async setComponentSelections(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        selection: AttackerSelection | null,
    ): Promise<void> {
        const uniqueIds = [...new Set(componentIds)];
        if (uniqueIds.length === 0) return;
        const targeting = member.force.getAttackerTargeting(member.id);
        if (!targeting) return;
        const result = await member.force.dispatchAttackerTargeting(member.id, {
            type: 'edit-attacker-targeting',
            edit: uniqueIds.length === 1
                ? { kind: 'set-component-selection', componentId: uniqueIds[0], selection }
                : { kind: 'set-component-selections', componentIds: uniqueIds, selection },
        });
        if (!result.accepted) {
            this.showRejectedEdit();
        }
    }

    private async setHeat(member: CBTForceMember, heat: number): Promise<void> {
        const snapshot = this.snapshot(member);
        if (!snapshot?.heat.tracked) return;
        const result = await member.force.dispatchNonMekUnitCommand(member.id, {
            kind: 'set-heat',
            heat: Math.max(0, Math.trunc(heat)),
            target: this.options.options().trackPhaseAndTurn ? 'pending' : 'committed',
        });
        if (!result.accepted) this.showRejectedEdit();
    }

    private async applyHeat(member: CBTForceMember): Promise<void> {
        const snapshot = this.snapshot(member);
        if (!snapshot?.heat.tracked || snapshot.heat.pending === null) return;
        const result = await member.force.dispatchNonMekUnitCommand(member.id, {
            kind: 'apply-heat',
        });
        if (!result.accepted) this.showRejectedEdit();
    }

    private async promptHeat(
        member: CBTForceMember,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const current = snapshot.heat.pending ?? snapshot.heat.current;
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
        await this.setHeat(member, Number(value));
    }

    private openHeatSinksPicker(
        member: CBTForceMember,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const count = snapshot.heat.heatSinkCount;
        const active = Math.max(0, count - snapshot.heat.heatsinksOff);
        const apply = (value: number): void => {
            this.closePicker();
            const current = this.snapshot(member);
            if (!current?.heat.tracked) return;
            void member.force.dispatchNonMekUnitCommand(member.id, {
                kind: 'set-heatsinks-off',
                heatsinksOff: count - value,
            }).then(result => {
                if (!result.accepted) this.showRejectedEdit();
            });
        };
        this.closePicker();
        this.zoomPan.cancelGesture();
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        target?.classList.add('picker-active');
        const common = {
            selected: active,
            position: recordSheetEventPosition(event),
            title: 'Active Heatsinks',
            lightTheme: this.options.options().colorScheme === 'night',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onCancel: () => this.closePicker(),
        };
        const instance = this.options.options().pickerStyle === 'linear'
            ? this.pickerFactory.createChoicePicker({
                ...common,
                values: Array.from({ length: count + 1 }, (_, value) => ({
                    label: String(value),
                    value,
                })),
                suggestedStyle: 'linear',
                targetType: 'heatsinks',
                onPick: choice => apply(Number(choice.value)),
            })
            : this.pickerFactory.createNumericPicker({
                ...common,
                min: 0,
                max: count,
                onPick: result => apply(result.value),
            });
        this.picker = { unitId: member.id, instance, target };
    }

    private async setCondition(member: CBTForceMember, condition: UnitConditionKey, active: boolean): Promise<void> {
        const snapshot = this.snapshot(member);
        if (!snapshot) return;
        const result = await member.force.dispatchNonMekUnitCommand(member.id, {
            kind: 'set-condition',
            condition,
            active,
        });
        if (!result.accepted) this.showRejectedEdit();
    }

    private openConditionMenu(
        member: CBTForceMember,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const anchor = event.currentTarget;
        if (!(anchor instanceof Element)) return;
        const controls = unitConditionControls(snapshot.conditionControlKeys)
            .filter(control => control.placement === 'menu');
        if (controls.length === 0) return;
        const { componentRef, closed } = this.openStateDropdown(
            ENTITY_CONDITION_OVERLAY,
            anchor,
            event,
        );
        componentRef.setInput('choices', controls.map(control => ({
            key: control.key,
            label: control.label,
            color: control.color,
            active: snapshot.conditions.includes(control.key),
        })));
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(condition => {
            if (!isUnitConditionKey(condition)) return;
            const current = this.snapshot(member);
            if (current) void this.setCondition(member, condition, !current.conditions.includes(condition));
            this.overlayManager.closeManagedOverlay(ENTITY_CONDITION_OVERLAY);
        });
        this.bindDropdownClose(componentRef.instance, closed, ENTITY_CONDITION_OVERLAY);
    }

    private async setCrewWounds(
        member: CBTForceMember,
        positionId: NonMekRecordSheetSnapshot['crew'][number]['positionId'],
        wounds: number,
    ): Promise<void> {
        const snapshot = this.snapshot(member);
        const position = snapshot?.crew.find(row => row.positionId === positionId);
        if (!snapshot || !position) return;
        const result = await member.force.dispatchNonMekUnitCommand(member.id, {
            kind: 'set-crew-state',
            positionId,
            wounds,
            unconscious: position.state.unconscious,
            ejected: position.state.ejected,
            killed: position.state.killed === true,
            stunned: position.state.stunned === true,
        });
        if (!result.accepted) this.showRejectedEdit();
    }

    private openCrewStateMenu(
        member: CBTForceMember,
        positionId: NonMekRecordSheetSnapshot['crew'][number]['positionId'],
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const position = snapshot.crew.find(row => row.positionId === positionId);
        const anchor = event.currentTarget;
        if (!position || !(anchor instanceof Element)) return;
        const controls = crewStateDefinitions(snapshot.crewStateControlKeys);
        if (controls.length === 0) return;
        const { componentRef, closed } = this.openStateDropdown(
            ENTITY_CREW_STATE_OVERLAY,
            anchor,
            event,
        );
        componentRef.setInput('choices', controls.map(control => ({
            key: control.key,
            label: control.label,
            color: control.color,
            active: hasNonMekCrewState(position.state, control.key),
        })));
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(selected => {
            const current = this.snapshot(member);
            const currentPosition = current?.crew.find(row => row.positionId === positionId);
            const command = current && currentPosition
                ? nonMekCrewStateCommand(
                    currentPosition,
                    current.crewStateControlKeys,
                    selected,
                )
                : null;
            if (command) void member.force.dispatchNonMekUnitCommand(member.id, command);
            this.overlayManager.closeManagedOverlay(ENTITY_CREW_STATE_OVERLAY);
        });
        this.bindDropdownClose(componentRef.instance, closed, ENTITY_CREW_STATE_OVERLAY);
    }

    private openStateDropdown(key: string, anchor: Element, event: Event) {
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
        result.componentRef.setInput('closeOnSelect', true);
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

    private async handleDamageTrack(
        member: CBTForceMember,
        interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'damage-track' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): Promise<void> {
        const track = snapshot.damageTracks.find(candidate =>
            candidate.damageTrackId === interaction.damageTrackId);
        if (!track) return;
        const sensorLevel = sensorDamageLevel(track.sheetId);
        if (sensorLevel !== null) {
            await this.setSensorDamageLevel(member, snapshot, sensorLevel);
            return;
        }
        if (track.maximumHits === 1) {
            const pending = this.options.options().trackPhaseAndTurn;
            const hits = pending ? track.previewHits : track.committedHits;
            await this.dispatchDamageTrackDelta(member, track, hits > 0 ? -1 : 1);
            return;
        }
        this.openDamageTrackPicker(member, track, event);
    }

    private openDamageTrackPicker(
        member: CBTForceMember,
        track: NonMekRecordSheetDamageTrack,
        event: Event,
    ): void {
        const pending = this.options.options().trackPhaseAndTurn;
        const hits = pending ? track.previewHits : track.committedHits;
        const range = nonMekDamageTrackPickerRange(track, hits);
        const pick = (delta: number): void => {
            this.closePicker();
            if (delta !== 0) void this.dispatchDamageTrackDelta(member, track, delta);
        };
        this.closePicker();
        this.zoomPan.cancelGesture();
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        target?.classList.add('picker-active');
        const common = {
            selected: range.max >= 1 ? 1 : 0,
            position: recordSheetEventPosition(event),
            title: track.label,
            lightTheme: this.options.options().colorScheme === 'night',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onCancel: () => this.closePicker(),
        };
        const instance = this.options.options().pickerStyle === 'linear'
            ? this.pickerFactory.createChoicePicker({
                ...common,
                values: recordSheetDamageChoices(range.min, range.max),
                suggestedStyle: 'linear',
                targetType: 'motive',
                onPick: choice => pick(Number(choice.value)),
            })
            : this.pickerFactory.createNumericPicker({
                ...common,
                min: range.min,
                max: range.max,
                onPick: result => pick(result.value),
            });
        this.picker = { unitId: member.id, instance, target };
    }

    private async setSensorDamageLevel(
        member: CBTForceMember,
        snapshot: NonMekRecordSheetSnapshot,
        selectedLevel: number,
    ): Promise<void> {
        const pending = this.options.options().trackPhaseAndTurn;
        const sensorLevels = snapshot.damageTracks
            .map(track => ({ track, level: sensorDamageLevel(track.sheetId) }))
            .filter((entry): entry is { track: NonMekRecordSheetDamageTrack; level: number } => entry.level !== null);
        const activeLevel = sensorLevels.reduce((highest, entry) => {
            const hits = pending ? entry.track.previewHits : entry.track.committedHits;
            return hits > 0 ? Math.max(highest, entry.level) : highest;
        }, 0);
        const selected = sensorLevels.find(entry => entry.level === selectedLevel)?.track;
        if (!selected) return;
        const selectedHits = pending ? selected.previewHits : selected.committedHits;
        const level = activeLevel > selectedLevel
            ? selectedLevel
            : selectedHits > 0 ? selectedLevel - 1 : selectedLevel;
        const current = this.snapshot(member);
        if (!current) return;
        const result = await member.force.dispatchNonMekUnitCommand(member.id, {
            kind: 'set-sensor-damage-level',
            level,
            target: pending ? 'pending' : 'committed',
            timestamp: Date.now(),
        });
        if (!result.accepted) this.showRejectedEdit();
    }

    private async dispatchDamageTrackDelta(
        member: CBTForceMember,
        track: NonMekRecordSheetDamageTrack,
        delta: number,
    ): Promise<boolean> {
        const startedAt = performance.now();
        const snapshot = this.snapshot(member);
        if (!snapshot || delta === 0) return false;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        const command: NonMekUnitCommand = delta > 0
            ? {
                kind: 'damage-track',
                damageTrackId: track.damageTrackId,
                amount: delta,
                target,
                timestamp: Date.now(),
            }
            : {
                kind: 'repair-damage-track',
                damageTrackId: track.damageTrackId,
                amount: -delta,
                target,
            };
        const result = await member.force.dispatchNonMekUnitCommand(member.id, command);
        requestAnimationFrame(() => console.info(
            `[damage-track-frame-perf] ${track.label} ${(performance.now() - startedAt).toFixed(1)}ms`,
        ));
        setTimeout(() => console.info(
            `[damage-track-task-perf] ${track.label} ${(performance.now() - startedAt).toFixed(1)}ms`,
        ), 0);
        if (!result.accepted) {
            this.showRejectedEdit();
            return false;
        }
        return true;
    }

    private openDamagePicker(
        member: CBTForceMember,
        interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): void {
        const range = nonMekDamagePickerRange(
            interaction,
            snapshot,
            this.options.options().trackPhaseAndTurn,
        );
        const pick = (delta: number): void => {
            this.closePicker();
            if (delta !== 0) void this.dispatchDamage(member, interaction, delta);
        };
        this.closePicker();
        this.zoomPan.cancelGesture();
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        target?.classList.add('picker-active');
        const common = {
            selected: 0,
            position: recordSheetEventPosition(event),
            title: range.title,
            lightTheme: this.options.options().colorScheme === 'night',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onCancel: () => this.closePicker(),
        };
        const instance = this.options.options().pickerStyle === 'linear'
            ? this.pickerFactory.createChoicePicker({
                ...common,
                values: recordSheetDamageChoices(range.min, range.max),
                suggestedStyle: 'linear',
                targetType: 'armor',
                onPick: choice => pick(Number(choice.value)),
            })
            : this.pickerFactory.createNumericPicker({
                ...common,
                min: range.min,
                max: range.max,
                threshold: range.threshold,
                onPick: result => pick(result.value),
            });
        this.picker = { unitId: member.id, instance, target };
    }

    private async applySoldierSelection(
        member: CBTForceMember,
        interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'soldier' }>,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
        if (!location || interaction.soldierNumber < 1 || interaction.soldierNumber > location.maximumInternal) return;
        const pending = this.options.options().trackPhaseAndTurn;
        const remaining = pending ? location.previewRemainingInternal : location.remainingInternal;
        const currentDamage = location.maximumInternal - remaining;
        const clickedDamage = location.maximumInternal - interaction.soldierNumber + 1;
        const nextDamage = currentDamage >= clickedDamage ? clickedDamage - 1 : clickedDamage;
        const delta = nextDamage - currentDamage;
        if (delta === 0) return;
        const accepted = await this.dispatchDelta(member, {
            kind: 'internal',
            locationId: interaction.locationId,
            expectedRevision: snapshot.stateRevision,
        }, delta, pending ? 'pending' : 'committed');
        if (accepted) this.showDamageToast(member, interaction.locationId, delta);
    }

    private async dispatchDamage(
        member: CBTForceMember,
        interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        delta: number,
    ): Promise<void> {
        const snapshot = this.snapshot(member);
        if (!snapshot) return;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        if (interaction.kind === 'internal' || delta < 0) {
            const currentInteraction = { ...interaction, expectedRevision: snapshot.stateRevision };
            const accepted = await this.dispatchDelta(member, currentInteraction, delta, target);
            if (accepted) this.showDamageToast(
                member,
                interaction.locationId,
                delta,
                interaction.kind === 'armor' ? interaction.faceId : undefined,
            );
            return;
        }
        const face = snapshot.locations.flatMap(location => location.armor)
            .find(candidate => candidate.faceId === interaction.faceId);
        if (!face) return;
        const armorRemaining = target === 'pending' ? face.previewRemaining : face.remaining;
        const armorDamage = Math.min(delta, armorRemaining);
        if (armorDamage > 0) {
            const accepted = await this.dispatchDelta(
                member,
                { ...interaction, expectedRevision: snapshot.stateRevision },
                armorDamage,
                target,
            );
            if (!accepted) return;
        }
        const internalDamage = delta - armorDamage;
        if (internalDamage > 0) {
            const current = this.snapshot(member);
            if (!current) return;
            const accepted = await this.dispatchDelta(member, {
                kind: 'internal',
                locationId: interaction.locationId,
                expectedRevision: current.stateRevision,
            }, internalDamage, target);
            if (!accepted) return;
        }
        this.showDamageToast(member, interaction.locationId, delta, interaction.faceId);
    }

    private async dispatchDelta(
        member: CBTForceMember,
        interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        delta: number,
        target: 'committed' | 'pending',
    ): Promise<boolean> {
        const command: NonMekUnitCommand = interaction.kind === 'armor'
            ? {
                kind: delta > 0 ? 'damage-armor' : 'repair-armor',
                faceId: interaction.faceId,
                amount: Math.abs(delta),
                target,
            }
            : {
                kind: delta > 0 ? 'damage-internal' : 'repair-internal',
                locationId: interaction.locationId,
                amount: Math.abs(delta),
                target,
            };
        const result = await member.force.dispatchNonMekUnitCommand(member.id, command);
        if (result.accepted) return true;
        this.showRejectedEdit();
        return false;
    }

    private showRejectedEdit(): void {
        this.toast.showToast('This force is read-only.', 'error');
    }

    private showDamageToast(
        member: CBTForceMember,
        locationId: string,
        delta: number,
        armorFaceId?: string,
    ): void {
        const snapshot = this.snapshot(member);
        const location = snapshot?.locations.find(candidate => candidate.locationId === locationId);
        if (!location) return;
        const pending = this.options.options().trackPhaseAndTurn;
        const face = armorFaceId === undefined
            ? undefined
            : location.armor.find(candidate => candidate.faceId === armorFaceId);
        const remaining = face
            ? pending ? face.previewRemaining : face.remaining
            : pending ? location.previewRemainingInternal : location.remainingInternal;
        const maximum = face?.maximum ?? location.maximumInternal;
        const amount = delta > 0 ? `+${delta}` : String(delta);
        this.toast.showToast(
            `${amount} ${face ? `${face.face === 'rear' ? 'rear ' : ''}armor` : 'internal'} hits in ${location.sheetCode || location.code} (${remaining}/${maximum})`,
            delta > 0 ? 'error' : 'success',
            `${member.id}-${face ? `armor-${face.faceId}` : `internal-${location.locationId}`}`,
        );
    }

    private closePicker(): void {
        this.picker?.target?.classList.remove('picker-active');
        this.picker?.instance.destroy();
        this.picker = null;
    }

    private destroyBinding(unitId: string): void {
        const current = this.bound.get(unitId);
        if (!current) return;
        current.subscription.unsubscribe();
        for (const page of current.pages.values()) page.binding.destroy();
        this.bound.delete(unitId);
    }
}

/** Map one shared crew-state menu selection to the sparse Entity command shape. */
export function nonMekCrewStateCommand(
    position: NonMekRecordSheetCrewPosition,
    controls: readonly CrewMemberState[],
    selected: string,
): NonMekUnitCommand | null {
    const control = controls.find(key => key === selected);
    if (control !== 'unconscious'
        && control !== 'ejected'
        && control !== 'killed'
        && control !== 'stunned') return null;
    const active = hasNonMekCrewState(position.state, control);
    return Object.freeze({
        kind: 'set-crew-state',
        positionId: position.positionId,
        wounds: position.state.wounds,
        unconscious: control === 'unconscious' ? !active : position.state.unconscious,
        ejected: control === 'ejected' ? !active : position.state.ejected,
        killed: control === 'killed' ? !active : position.state.killed === true,
        stunned: control === 'stunned' ? !active : position.state.stunned === true,
    });
}

export function nonMekDamageTrackPickerRange(
    track: NonMekRecordSheetDamageTrack,
    currentHits: number,
): Readonly<{ readonly min: number; readonly max: number }> {
    const maximumAddition = track.visibleHitPips ?? track.maximumHits;
    return Object.freeze({
        min: -currentHits,
        max: Math.min(maximumAddition, track.maximumHits - currentHits),
    });
}

function sensorDamageLevel(sheetId: string): number | null {
    const match = /^sensor_hit_(\d+)$/u.exec(sheetId);
    return match ? Number(match[1]) : null;
}

function equipmentPanelComponentById(
    panel: EquipmentPanelSnapshot,
    componentId: ComponentId,
): EquipmentPanelComponent | undefined {
    return panel.components.find(row => row.componentId === componentId
        || row.attack?.members.some(member => member.componentId === componentId) === true);
}

function equipmentPanelSelectionComponentIds(
    panel: EquipmentPanelSnapshot,
    componentIds: readonly ComponentId[],
    selection: AttackerSelection | null,
): readonly ComponentId[] {
    const rows = [...new Set(componentIds.flatMap(componentId => {
        const row = equipmentPanelComponentById(panel, componentId);
        return row ? [row] : [];
    }))];
    return Object.freeze([...new Set(rows.flatMap(row => {
        if (row.attack === undefined) {
            return row.weapon?.selectable === true || selection === null
                ? [row.componentId]
                : [];
        }
        return row.attack.members
            .filter(member => selection === null || member.selectable)
            .map(member => member.componentId);
    }))]);
}

function sameAttackerSelection(
    left: AttackerSelection | undefined,
    right: AttackerSelection | undefined,
): boolean {
    if (left === undefined || right === undefined) return left === right;
    if (left.kind !== right.kind) return false;
    if (left.kind === 'target' && right.kind === 'target') return left.targetId === right.targetId;
    if (left.kind === 'manual-range' && right.kind === 'manual-range') return left.range === right.range;
    return true;
}

export function nonMekDamagePickerRange(
    interaction: Extract<NonMekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
    snapshot: NonMekRecordSheetSnapshot,
    pending: boolean,
): RecordSheetDamagePickerRange {
    const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
    if (!location) throw new Error(`Unknown Entity location ${interaction.locationId}`);
    if (interaction.kind === 'internal') {
        const remaining = pending ? location.previewRemainingInternal : location.remainingInternal;
        return {
            min: -(location.maximumInternal - remaining),
            max: remaining,
            title: `${location.sheetCode || location.code} Internal`,
        };
    }
    const face = location.armor.find(candidate => candidate.faceId === interaction.faceId);
    if (!face) throw new Error(`Unknown Entity armor face ${interaction.faceId}`);
    const remaining = pending ? face.previewRemaining : face.remaining;
    const internalRemaining = pending ? location.previewRemainingInternal : location.remainingInternal;
    return {
        min: -(face.maximum - remaining),
        max: remaining + internalRemaining,
        threshold: remaining,
        title: `${location.sheetCode || location.code}${face.face === 'rear' ? ' (Rear)' : ''} Armor`,
    };
}
