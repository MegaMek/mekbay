// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ComponentPortal } from '@angular/cdk/portal';
import { Injectable,Injector,inject } from '@angular/core';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom,merge,takeUntil } from 'rxjs';
import type { CBTUnitCommand } from '../../../models/runtime/unit-command';
import { isUnitEditContextCurrent,type UnitEditContext } from '../../../models/runtime/unit-edit-context';
import type { RecordSheetInteraction } from '../record-sheet-interaction';

import { CrewMember,type CrewMemberState } from '../../../models/crew-member.model';
import type { ComponentId } from '../../../models/entity/entity-identifiers';
import type { CBTForceMember } from '../../../models/force-member.model';
import { isCBTMekForceMember } from '../../../models/force-member.model';
import type { AttackerSelection } from '../../../models/runtime/attacker-targeting-state';
import type { EncounterTargetId } from '../../../models/runtime/encounter-runtime';
import type {
EquipmentPanelComponent,
EquipmentPanelSnapshot,
} from '../../../models/runtime/equipment-panel';
import {
projectTargetingTarget,
projectWeaponTargetPresentation,
} from '../../../models/runtime/equipment-panel';
import type {
NonMekRecordSheetCrewPosition,
NonMekRecordSheetDamageTrack,
NonMekRecordSheetSnapshot,
} from '../../../models/runtime/non-mek-record-sheet';
import { isUnitConditionKey,type UnitConditionKey } from '../../../models/unit-condition.model';

import {
crewStateDefinitions,
unitConditionControls,
} from '../../../models/unit-status-presentation';
import { DialogsService } from '../../../services/dialogs.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ToastService } from '../../../services/toast.service';
import { UnitNameService } from '../../../services/unit-name.service';
import { WeaponTargetChoiceMenuComponent } from '../../equipment-dialog/weapon-target-choice-menu.component';
import { InputDialogComponent } from '../../input-dialog/input-dialog.component';
import type { PickerChoice,PickerInstance } from '../../picker/picker.interface';
import {
recordSheetDamageChoices,
recordSheetEventPosition,
type RecordSheetDamagePickerRange,
} from '../mek-record-sheet-interaction.util';
import {
bindNonMekRecordSheet,
type NonMekRecordSheetBinding,
} from '../non-mek-record-sheet-binder';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';
import { nonMekHitArcs,resolveNonMekHitLocation,type NonMekHitArc } from '../non-mek-hit-location';
import { RecordSheetRandomHitResult } from '../record-sheet-random-hit-result';
import { UnitStateDropdownComponent } from '../unit-state-dropdown.component';
import { PageViewerOverlayService } from './page-viewer-overlay.service';

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
    private readonly unitNames = inject(UnitNameService);
    private readonly logger = inject(LoggerService);
    private readonly dialogs = inject(DialogsService);
    private readonly injector = inject(Injector);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly overlays = inject(PageViewerOverlayService);
    private readonly options = inject(OptionsService);
    private readonly pickerFactory = inject(PickerFactoryService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
    private readonly toast = inject(ToastService);
    private readonly zoomPan = inject(PageViewerZoomPanService);
    private readonly bound = new Map<string, BoundEntitySheets>();
    private picker: OpenEntityPicker | null = null;
    private readonly randomHitResult = new RecordSheetRandomHitResult();

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
                subscription: merge(member.force.changed, member.force.sessionChanged).subscribe(changedUnitIds => {
                    if (changedUnitIds?.includes(member.id) ?? true) this.render(member);
                }),
            };
            this.bound.set(member.id, current);
        }
        current.pages.set(svg, { svg, binding });
        this.unitNames.applyToRecordSheet(svg, member.entity);
        this.reportLayoutIssues(svg, snapshot, binding.initialIssues);
        return true;
    }

    cleanupUnused(keepUnitIds: ReadonlySet<string>): void {
        if (this.picker && !keepUnitIds.has(this.picker.unitId)) this.closePicker();
        if (this.randomHitResult.unitId && !keepUnitIds.has(this.randomHitResult.unitId)) this.randomHitResult.clear();
        for (const unitId of [...this.bound.keys()]) {
            if (!keepUnitIds.has(unitId)) this.destroyBinding(unitId);
        }
    }

    clear(): void {
        this.closePicker();
        this.randomHitResult.clear();
        for (const unitId of [...this.bound.keys()]) this.destroyBinding(unitId);
    }

    private snapshot(member: CBTForceMember, context?: UnitEditContext): NonMekRecordSheetSnapshot | null {
        const snapshot = member.nonMekRecordSheetSnapshot();
        return snapshot && (!context || isUnitEditContextCurrent(context, snapshot.editContext)) ? snapshot : null;
    }

    private render(member: CBTForceMember): void {
        const current = this.bound.get(member.id);
        const snapshot = this.snapshot(member);
        if (!current || current.member !== member || !snapshot) return;
        const equipment = member.force.getEquipmentPanelSnapshot(member.id);
        for (const page of current.pages.values()) this.renderPage(page, snapshot, equipment, member);
    }

    private renderPage(
        page: BoundEntitySheetPage,
        snapshot: NonMekRecordSheetSnapshot,
        equipment: EquipmentPanelSnapshot | null,
        member: CBTForceMember,
    ): void {
        const issues = page.binding.render(snapshot, equipment);
        this.unitNames.applyToRecordSheet(page.svg, member.entity);
        this.reportLayoutIssues(page.svg, snapshot, issues);
    }

    private reportLayoutIssues(svg: SVGSVGElement, snapshot: NonMekRecordSheetSnapshot, issues: readonly string[]): void {
        if (issues.length > 0 && svg.dataset['mekbayPartialSheet'] !== '1') {
            this.logger.warn(`Record-sheet layout omissions for ${snapshot.displayName}: ${issues.join('; ')}`);
        }
    }

    handle(member: CBTForceMember, interaction: RecordSheetInteraction, event: Event): void {
        const snapshot = this.snapshot(member);
        if (!snapshot || !isUnitEditContextCurrent(interaction.context, snapshot.editContext)) return;
        if (interaction.kind === 'open-equipment') {
            this.overlays.openEquipment(member.id, event, interaction.tab);
            return;
        }
        if (interaction.kind === 'random-hit') {
            this.openRandomHitPicker(member, interaction, event);
            return;
        }
        if (interaction.kind === 'heat') {
            void this.setHeat(member, interaction.heat, interaction.context);
            return;
        }
        if (interaction.kind === 'heat-overflow') {
            void this.promptHeat(member, snapshot);
            return;
        }
        if (interaction.kind === 'apply-heat') {
            void this.applyHeat(member, interaction.context);
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
        if (interaction.kind === 'infantry-strength') {
            void this.applyInfantryStrengthSelection(member, interaction, snapshot);
            return;
        }
        if (interaction.kind === 'damage-track') {
            void this.handleDamageTrack(member, interaction, snapshot, event);
            return;
        }
        if (interaction.kind === 'condition') {
            void this.setCondition(member, interaction.condition, !snapshot.conditions.includes(interaction.condition), interaction.context);
            return;
        }
        if (interaction.kind === 'condition-menu') {
            this.openConditionMenu(member, snapshot, event);
            return;
        }
        if (interaction.kind === 'crew-wounds') {
            void this.setCrewWounds(member, interaction.positionId, interaction.wounds, snapshot);
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
        if (interaction.kind === 'armor' || interaction.kind === 'internal') {
            this.openDamagePicker(member, interaction, snapshot, event);
        }
    }

    private openRandomHitPicker(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'random-hit' }>,
        event: Event,
    ): void {
        this.randomHitResult.clear();
        this.closePicker();
        this.zoomPan.cancelGesture();
        interaction.element.classList.add('picker-active');
        const rect = interaction.element.getBoundingClientRect();
        const config = {
            position: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            lightTheme: this.options.options().colorScheme === 'night',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onPick: (choice: PickerChoice): void => {
                this.closePicker();
                const snapshot = this.snapshot(member, interaction.context);
                const svg = interaction.element.ownerSVGElement;
                if (!snapshot || !svg) return;
                const d6 = (): number => Math.floor(Math.random() * 6) + 1;
                const hit = resolveNonMekHitLocation(member.entity, snapshot, choice.value as NonMekHitArc,
                    d6() + d6(), d6);
                if (hit) this.randomHitResult.show(member.id, svg, interaction.element, hit.locationCode,
                    false, false, hit.transferredFrom);
            },
            onCancel: () => this.closePicker(),
        };
        const arcs = nonMekHitArcs(member.entity);
        const instance = arcs.length === 4
            ? this.pickerFactory.createDirectionalPicker(config)
            : this.pickerFactory.createChoicePicker({
                ...config,
                title: 'Attack direction',
                values: arcs.map(arc => ({ label: arc.split('-').map(word =>
                    word[0].toUpperCase() + word.slice(1)).join(' '), value: arc })),
            });
        this.picker = { unitId: member.id, instance, target: interaction.element };
    }

    private async selectInventory(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'inventory-selection' }>,
        event: Event,
    ): Promise<void> {
        let panel = member.force.getEquipmentPanelSnapshot(member.id);
        if (!panel || !this.snapshot(member, interaction.context)) return;
        let context = interaction.context;
        const registryRevision = member.force.getAttackerTargeting(member.id)?.registryRevision;
        if (registryRevision === undefined) return;
        if (interaction.mode !== undefined) {
            const afterModes = await this.setInventoryModes(
                member,
                interaction.componentIds,
                interaction.mode,
                panel,
                context,
            );
            if (!afterModes) return;
            context = afterModes;
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
            this.openWeaponTargetMenu(member, interaction.componentIds, panel, event, context, registryRevision);
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
            context,
            registryRevision,
        );
    }

    private async setInventoryModes(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        mode: string,
        initialPanel: EquipmentPanelSnapshot,
        context: UnitEditContext,
    ): Promise<UnitEditContext | null> {
        for (const componentId of componentIds) {
            const panel = member.force.getEquipmentPanelSnapshot(member.id) ?? initialPanel;
            const component = equipmentPanelComponentById(panel, componentId);
            if (!component || !component.modes.includes(mode)) return null;
            if (component.mode === mode) continue;
            if (!this.snapshot(member, context)) return null;
            const result = await member.force.dispatchUnitCommand(member.id, {
                type: 'set-component-mode',
                componentId,
                mode,
            }, context);
            if (!result.accepted) {
                this.showRejectedEdit();
                return null;
            }
            if (!result.state) return null;
            context = { owner: context.owner, state: result.state };
        }
        return context;
    }

    private openWeaponTargetMenu(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        panel: EquipmentPanelSnapshot,
        event: Event,
        context: UnitEditContext,
        registryRevision: number,
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
                    projectTargetingTarget(target, panel.ruleset),
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
                context,
                registryRevision,
            );
            this.overlayManager.closeManagedOverlay(ENTITY_WEAPON_TARGET_OVERLAY);
        });
    }

    private async setComponentSelections(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        selection: AttackerSelection | null,
        context: UnitEditContext,
        registryRevision: number,
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
        }, context, registryRevision);
        if (!result.accepted) {
            this.showRejectedEdit();
        }
    }

    private async setHeat(member: CBTForceMember, heat: number, context: UnitEditContext): Promise<void> {
        const snapshot = this.snapshot(member, context);
        if (!snapshot?.heat.tracked) return;
        const result = await member.force.dispatchUnitCommand(member.id, {
            type: this.options.options().trackPhaseAndTurn ? 'set-pending-heat' : 'set-heat',
            heat: Math.max(0, Math.trunc(heat)),
        }, context);
        if (!result.accepted) this.showRejectedEdit();
    }

    private async applyHeat(member: CBTForceMember, context: UnitEditContext): Promise<void> {
        const snapshot = this.snapshot(member, context);
        if (!snapshot?.heat.tracked || snapshot.heat.pending === null) return;
        const result = await member.force.dispatchUnitCommand(member.id, {
            type: 'apply-heat', policy: 'automatic',
        }, context);
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
        await this.setHeat(member, Number(value), snapshot.editContext);
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
            if (!this.snapshot(member, snapshot.editContext)?.heat.tracked) return;
            void member.force.dispatchUnitCommand(member.id, {
                type: 'set-heatsinks-off',
                heatsinksOff: count - value,
            }, snapshot.editContext).then(result => {
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

    private async setCondition(member: CBTForceMember, condition: UnitConditionKey, active: boolean, context: UnitEditContext): Promise<void> {
        const snapshot = this.snapshot(member, context);
        if (!snapshot) return;
        const result = await member.force.dispatchUnitCommand(member.id, {
            type: 'set-condition',
            condition,
            active,
        }, context);
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
            void this.setCondition(member, condition, !snapshot.conditions.includes(condition), snapshot.editContext);
            this.overlayManager.closeManagedOverlay(ENTITY_CONDITION_OVERLAY);
        });
        this.bindDropdownClose(componentRef.instance, closed, ENTITY_CONDITION_OVERLAY);
    }

    private async setCrewWounds(
        member: CBTForceMember,
        positionId: NonMekRecordSheetSnapshot['crew'][number]['positionId'],
        wounds: number,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const position = snapshot?.crew.find(row => row.positionId === positionId);
        if (!snapshot || !position) return;
        const result = await member.force.dispatchUnitCommand(member.id, {
            type: 'set-crew-state',
            positionId,
            wounds,
            unconscious: position.state.unconscious,
            ejected: position.state.ejected,
        }, snapshot.editContext);
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
            active: CrewMember.from(position.state).hasState(control.key),
        })));
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(selected => {
            const command = nonMekCrewStateCommand(position, snapshot.crewStateControlKeys, selected);
            if (command) void member.force.dispatchUnitCommand(member.id, command, snapshot.editContext);
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
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'damage-track' }>,
        snapshot: NonMekRecordSheetSnapshot,
        event: Event,
    ): Promise<void> {
        const track = snapshot.damageTracks.find(candidate =>
            candidate.damageTrackId === interaction.damageTrackId);
        if (!track) return;
        const sensorLevel = track.system === 'sensors' ? track.stage ?? null : null;
        if (sensorLevel !== null) {
            await this.setSensorDamageLevel(member, snapshot, sensorLevel);
            return;
        }
        if (track.maximumHits === 1) {
            const pending = this.options.options().trackPhaseAndTurn;
            const hits = pending ? track.previewHits : track.committedHits;
            await this.dispatchDamageTrackDelta(member, track, hits > 0 ? -1 : 1, interaction.context);
            return;
        }
        this.openDamageTrackPicker(member, track, event, interaction.context);
    }

    private openDamageTrackPicker(
        member: CBTForceMember,
        track: NonMekRecordSheetDamageTrack,
        event: Event,
        context: UnitEditContext,
    ): void {
        const pending = this.options.options().trackPhaseAndTurn;
        const hits = pending ? track.previewHits : track.committedHits;
        const range = nonMekDamageTrackPickerRange(track, hits);
        const pick = (delta: number): void => {
            this.closePicker();
            if (delta !== 0) void this.dispatchDamageTrackDelta(member, track, delta, context);
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
            .map(track => ({ track, level: track.system === 'sensors' ? track.stage ?? null : null }))
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
        const result = await member.force.dispatchUnitCommand(member.id, {
            type: 'set-sensor-damage-level',
            level,
            target: pending ? 'pending' : 'committed',
            timestamp: Date.now(),
        }, snapshot.editContext);
        if (!result.accepted) this.showRejectedEdit();
    }

    private async dispatchDamageTrackDelta(
        member: CBTForceMember,
        track: NonMekRecordSheetDamageTrack,
        delta: number,
        context: UnitEditContext,
    ): Promise<boolean> {
        const snapshot = this.snapshot(member, context);
        if (!snapshot || delta === 0) return false;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        const command: CBTUnitCommand = delta > 0
            ? {
                type: 'damage-track',
                damageTrackId: track.damageTrackId,
                amount: delta,
                target,
                timestamp: Date.now(),
            }
            : {
                type: 'repair-damage-track',
                damageTrackId: track.damageTrackId,
                amount: -delta,
                target,
            };
        const result = await member.force.dispatchUnitCommand(member.id, command, context);
        if (!result.accepted) {
            this.showRejectedEdit();
            return false;
        }
        return true;
    }

    private openDamagePicker(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
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

    private async applyInfantryStrengthSelection(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'infantry-strength' }>,
        snapshot: NonMekRecordSheetSnapshot,
    ): Promise<void> {
        const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
        const strength = interaction.strength;
        if (!location || !Number.isSafeInteger(strength)
            || strength < 1 || strength > location.maximumInternal) return;
        const pending = this.options.options().trackPhaseAndTurn;
        const remaining = pending ? location.previewRemainingInternal : location.remainingInternal;
        const nextRemaining = remaining >= strength ? strength - 1 : strength;
        const delta = remaining - nextRemaining;
        if (delta === 0) return;
        const accepted = await this.dispatchDelta(member, {
            kind: 'internal',
            locationId: interaction.locationId,
            context: snapshot.editContext,
        }, delta, pending ? 'pending' : 'committed');
        if (accepted) this.showDamageToast(member, interaction.locationId, delta);
    }

    private async dispatchDamage(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        delta: number,
    ): Promise<void> {
        const snapshot = this.snapshot(member, interaction.context);
        if (!snapshot) return;
        const target = this.options.options().trackPhaseAndTurn ? 'pending' : 'committed';
        if (interaction.kind === 'internal' || delta < 0) {
            const accepted = await this.dispatchDelta(member, interaction, delta, target);
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
        let context = interaction.context;
        if (armorDamage > 0) {
            const accepted = await this.dispatchDelta(
                member,
                interaction,
                armorDamage,
                target,
            );
            if (!accepted) return;
            context = accepted;
        }
        const internalDamage = delta - armorDamage;
        if (internalDamage > 0) {
            const current = this.snapshot(member, context);
            if (!current) return;
            const accepted = await this.dispatchDelta(member, {
                kind: 'internal',
                locationId: interaction.locationId,
                context,
            }, internalDamage, target);
            if (!accepted) return;
        }
        this.showDamageToast(member, interaction.locationId, delta, interaction.faceId);
    }

    private async dispatchDelta(
        member: CBTForceMember,
        interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
        delta: number,
        target: 'committed' | 'pending',
    ): Promise<UnitEditContext | null> {
        const command: CBTUnitCommand = interaction.kind === 'armor'
            ? {
                type: delta > 0 ? 'damage-armor' : 'repair-armor',
                faceId: interaction.faceId,
                amount: Math.abs(delta),
                target,
            }
            : {
                type: delta > 0 ? 'damage-internal' : 'repair-internal',
                locationId: interaction.locationId,
                amount: Math.abs(delta),
                target,
            };
        const result = await member.force.dispatchUnitCommand(member.id, command, interaction.context);
        if (result.accepted && result.state) return { owner: interaction.context.owner, state: result.state };
        this.showRejectedEdit();
        return null;
    }

    private showRejectedEdit(): void {
        this.toast.showToast('This edit is no longer current, or the force is read-only.', 'error');
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
        if (this.randomHitResult.unitId === unitId) this.randomHitResult.clear();
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
): CBTUnitCommand | null {
    const control = controls.find(key => key === selected);
    if (control !== 'unconscious'
        && control !== 'ejected'
        && control !== 'killed'
        && control !== 'stunned') return null;
    const active = CrewMember.from(position.state).hasState(control);
    return Object.freeze({
        type: 'set-crew-state',
        positionId: position.positionId,
        wounds: position.state.wounds,
        unconscious: control === 'unconscious' || control === 'stunned'
            ? !active
            : position.state.unconscious,
        ejected: control === 'ejected' ? !active : position.state.ejected,
        ...(control === 'killed' ? { dead: !active } : {}),
    });
}

export function nonMekDamageTrackPickerRange(
    track: NonMekRecordSheetDamageTrack,
    currentHits: number,
): Readonly<{ readonly min: number; readonly max: number }> {
    return Object.freeze({
        min: -currentHits,
        max: track.maximumHits - currentHits,
    });
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
    interaction: Extract<RecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>,
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
