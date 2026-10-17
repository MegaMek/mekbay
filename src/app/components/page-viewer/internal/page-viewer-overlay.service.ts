// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ApplicationRef, Injectable, inject, Injector, createComponent, signal, type ComponentRef } from '@angular/core';

import type { CBTForce } from '../../../models/cbt-force.model';
import type { PageViewerMember } from './types';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';
import { PageCanvasOverlayComponent } from '../canvas';
import { PageInteractionOverlayComponent } from '../overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom, takeUntil } from 'rxjs';
import type { ComponentId, CrewPositionId } from '../../../models/entity/entity-identifiers';
import type { CBTForceMember } from '../../../models/force-member.model';
import { gameRulesFor } from '../../../models/rules/game-rules';
import { sameAttackerSelection, type AttackerSelection } from '../../../models/runtime/attacker-targeting-state';
import type { EncounterTargetId } from '../../../models/runtime/encounter-runtime';
import type { EquipmentPanelComponent, EquipmentPanelSnapshot } from '../../../models/runtime/equipment-panel';
import { projectTargetingTarget, projectWeaponTargetPresentation } from '../../../models/runtime/equipment-panel';
import type { CBTUnitCommand } from '../../../models/runtime/unit-command';
import { isUnitEditContextCurrent, type UnitEditContext } from '../../../models/runtime/unit-edit-context';
import { isUnitConditionKey, type UnitConditionKey } from '../../../models/unit-condition.model';
import { DialogsService } from '../../../services/dialogs.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ToastService } from '../../../services/toast.service';
import { ClusterTableDialogComponent } from '../../cluster-table-dialog/cluster-table-dialog.component';
import { WeaponTargetChoiceMenuComponent } from '../../equipment-dialog/weapon-target-choice-menu.component';
import { InputDialogComponent } from '../../input-dialog/input-dialog.component';
import { isChoicePickerInstance, type PickerChoice, type PickerInstance, type PickerTargetType } from '../../picker/picker.interface';
import { recordSheetEventPosition } from '../mek-record-sheet-interaction.util';
import type { RecordSheetInteraction } from '../record-sheet-interaction';
import { RecordSheetRandomHitResult } from '../record-sheet-random-hit-result';
import { UnitStateDropdownComponent } from '../unit-state-dropdown.component';

function applyAbsoluteFillLayout(element: HTMLElement): void {
    element.style.position = 'absolute';
    element.style.top = '0';
    element.style.left = '0';
    element.style.width = '100%';
    element.style.height = '100%';
}

/** A unit's heat scale being dragged to a value, shown as a difference marker beside the scale. */
export interface RecordSheetHeatPreview {
    readonly element: SVGElement;
    readonly heat: number;
    readonly baselineHeat: number;
}

/** Sheet menus; each is open at most once, for the unit that opened it. */
export type RecordSheetMenu = 'unit-condition' | 'location-condition' | 'crew-state' | 'weapon-target';

/** Where a rolled random hit landed, for the paperdoll badge. */
export interface RecordSheetRandomHit {
    readonly locationCode: string;
    readonly rear: boolean;
    readonly throughArmorCritical: boolean;
    readonly transferredFrom?: string;
}

export type CrewSkillField = 'gunnery' | 'piloting' | 'aeroGunnery' | 'aeroPiloting';

type InventorySelection = Extract<RecordSheetInteraction, { readonly kind: 'inventory-selection' }>;

const REJECTED_EDIT = 'This edit is no longer current, or the force is read-only.';
const CREW_SKILL_TITLES: Readonly<Record<CrewSkillField, string>> = Object.freeze({
    gunnery: 'Gunnery',
    piloting: 'Piloting',
    aeroGunnery: 'Aerospace Gunnery',
    aeroPiloting: 'Aerospace Piloting',
});

interface OpenPicker {
    readonly unitId: string;
    readonly instance: PickerInstance;
    readonly target: Element | null;
}

/**
 * Everything floating over the record sheets: page canvas and interaction overlays, and the sheet controls every unit
 * family shares — one open picker, the sheet menus, prompts, the random-hit badge, the heat drag preview, and the edit
 * flows whose rules do not depend on the family.
 */
@Injectable()
export class PageViewerOverlayService {
    private readonly zoomPan = inject(PageViewerZoomPanService);
    private readonly dialogs = inject(DialogsService);
    private readonly injector = inject(Injector);
    private readonly options = inject(OptionsService);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly pickerFactory = inject(PickerFactoryService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
    private readonly toast = inject(ToastService);
    private picker: OpenPicker | null = null;
    private readonly menuOwners = new Map<RecordSheetMenu, string>();
    private readonly randomHitResult = new RecordSheetRandomHitResult();
    private readonly heatPreviews = signal<ReadonlyMap<string, RecordSheetHeatPreview>>(new Map());

    private canvasOverlayRefs = new Map<string, ComponentRef<PageCanvasOverlayComponent>>();
    private canvasOverlaySubscriptions = new Map<string, { unsubscribe: () => void }>();
    private interactionOverlayRefs = new Map<string, ComponentRef<PageInteractionOverlayComponent>>();
    private interactionOverlayModes = new Map<string, 'fixed' | 'page'>();

    heatPreview(unitId: string): RecordSheetHeatPreview | null {
        return this.heatPreviews().get(unitId) ?? null;
    }

    setHeatPreview(unitId: string, preview: RecordSheetHeatPreview): void {
        const { element, heat, baselineHeat } = preview;
        this.heatPreviews.update(current => new Map(current).set(unitId, Object.freeze({ element, heat, baselineHeat })));
    }

    /** Clears one unit's heat preview, or every preview without a unit. */
    clearHeatPreview(unitId?: string): void {
        if (unitId === undefined ? this.heatPreviews().size === 0 : !this.heatPreviews().has(unitId)) return;
        this.heatPreviews.update(current => {
            if (unitId === undefined) return new Map();
            const next = new Map(current);
            next.delete(unitId);
            return next;
        });
    }

    getOrCreateCanvasOverlay(options: {
        appRef: ApplicationRef;
        injector: Injector;
        pageWrapper: HTMLDivElement;
        unit: PageViewerMember;
        onDrawingStarted: (unit: PageViewerMember) => void;
    }): ComponentRef<PageCanvasOverlayComponent> {
        const { appRef, injector, pageWrapper, unit, onDrawingStarted } = options;
        const existingRef = this.canvasOverlayRefs.get(unit.id);
        if (existingRef) {
            existingRef.setInput('unit', unit);
            existingRef.setInput('width', this.zoomPan.pageWidth());
            existingRef.setInput('height', this.zoomPan.pageHeight());
            const canvasElement = existingRef.location.nativeElement as HTMLElement;
            if (canvasElement.parentElement !== pageWrapper) pageWrapper.appendChild(canvasElement);
            return existingRef;
        }

        const componentRef = createComponent(PageCanvasOverlayComponent, {
            environmentInjector: appRef.injector,
            elementInjector: injector
        });

        componentRef.setInput('unit', unit);
        componentRef.setInput('width', this.zoomPan.pageWidth());
        componentRef.setInput('height', this.zoomPan.pageHeight());

        const subscription = componentRef.instance.drawingStarted.subscribe((drawnUnit) => {
            onDrawingStarted(drawnUnit as PageViewerMember);
        });

        this.canvasOverlaySubscriptions.set(unit.id, subscription);
        appRef.attachView(componentRef.hostView);

        const canvasElement = componentRef.location.nativeElement as HTMLElement;
        applyAbsoluteFillLayout(canvasElement);
        pageWrapper.appendChild(canvasElement);

        this.canvasOverlayRefs.set(unit.id, componentRef);
        return componentRef;
    }

    cleanupUnusedCanvasOverlays(appRef: ApplicationRef, keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];

        this.canvasOverlayRefs.forEach((ref, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                const subscription = this.canvasOverlaySubscriptions.get(unitId);
                if (subscription) {
                    subscription.unsubscribe();
                    this.canvasOverlaySubscriptions.delete(unitId);
                }
                appRef.detachView(ref.hostView);
                ref.destroy();
                toRemove.push(unitId);
            }
        });

        toRemove.forEach((unitId) => this.canvasOverlayRefs.delete(unitId));
    }

    cleanupCanvasOverlays(appRef: ApplicationRef): void {
        this.canvasOverlaySubscriptions.forEach((subscription) => subscription.unsubscribe());
        this.canvasOverlaySubscriptions.clear();

        this.canvasOverlayRefs.forEach((ref) => {
            appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.canvasOverlayRefs.clear();
    }

    getOrCreateInteractionOverlay(options: {
        appRef: ApplicationRef;
        injector: Injector;
        pageWrapper: HTMLDivElement;
        fixedOverlayContainer: HTMLDivElement;
        unit: PageViewerMember;
        force: CBTForce | null;
        mode: 'fixed' | 'page';
        showTopRightControls: boolean;
    }): ComponentRef<PageInteractionOverlayComponent> {
        const { appRef, injector, pageWrapper, fixedOverlayContainer, unit, force, mode, showTopRightControls } = options;
        const targetContainer = mode === 'fixed' ? fixedOverlayContainer : pageWrapper;
        const existingRef = this.interactionOverlayRefs.get(unit.id);
        const existingMode = this.interactionOverlayModes.get(unit.id);

        if (existingRef) {
            existingRef.setInput('member', unit);
            existingRef.setInput('force', force);
            existingRef.setInput('showTopRightControls', showTopRightControls);
            if (existingMode !== mode) {
                existingRef.setInput('mode', mode);
                this.interactionOverlayModes.set(unit.id, mode);
            }

            const overlayElement = existingRef.location.nativeElement as HTMLElement;
            if (overlayElement.parentElement !== targetContainer) targetContainer.appendChild(overlayElement);
            return existingRef;
        }

        const componentRef = createComponent(PageInteractionOverlayComponent, {
            environmentInjector: appRef.injector,
            elementInjector: injector
        });

        componentRef.setInput('member', unit);
        componentRef.setInput('force', force);
        componentRef.setInput('mode', mode);
        componentRef.setInput('showTopRightControls', showTopRightControls);

        appRef.attachView(componentRef.hostView);

        const overlayElement = componentRef.location.nativeElement as HTMLElement;
        applyAbsoluteFillLayout(overlayElement);
        targetContainer.appendChild(overlayElement);

        this.interactionOverlayRefs.set(unit.id, componentRef);
        this.interactionOverlayModes.set(unit.id, mode);
        return componentRef;
    }

    cleanupUnusedInteractionOverlays(appRef: ApplicationRef, keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];

        this.interactionOverlayRefs.forEach((ref, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                appRef.detachView(ref.hostView);
                ref.destroy();
                toRemove.push(unitId);
            }
        });

        toRemove.forEach((unitId) => {
            this.interactionOverlayRefs.delete(unitId);
            this.interactionOverlayModes.delete(unitId);
        });
    }

    cleanupInteractionOverlays(appRef: ApplicationRef): void {
        this.interactionOverlayRefs.forEach((ref) => {
            appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.interactionOverlayRefs.clear();
        this.interactionOverlayModes.clear();
    }

    closeInteractionOverlays(): void {
        this.interactionOverlayRefs.forEach((ref) => {
            ref.instance.closeAllOverlays();
        });
    }

    openEquipment(unitId: string, event: Event, tab: 'weapons' | 'ammo'): void {
        this.interactionOverlayRefs.get(unitId)?.instance.openWeaponEquipmentDialog(event, tab);
    }

    getCanvasOverlayElements(unitIds: readonly string[]): HTMLElement[] {
        return unitIds
            .map((unitId) => this.canvasOverlayRefs.get(unitId)?.location.nativeElement as HTMLElement | undefined)
            .filter((element): element is HTMLElement => !!element && element.isConnected);
    }

    /** Releases everything one unit holds open over its sheets. */
    clearUnitControls(unitId: string): void {
        if (this.picker?.unitId === unitId) this.closePicker();
        if (this.randomHitResult.unitId === unitId) this.randomHitResult.clear();
        this.clearHeatPreview(unitId);
        for (const [menu, owner] of this.menuOwners) {
            if (owner === unitId) this.closeMenu(menu);
        }
    }

    /** Releases every picker, menu, badge and preview over the sheets. */
    clearSheetControls(): void {
        this.closePicker();
        this.randomHitResult.clear();
        this.clearHeatPreview();
        for (const menu of [...this.menuOwners.keys()]) this.closeMenu(menu);
    }

    closePicker(): void {
        this.picker?.target?.classList.remove('picker-active');
        this.picker?.instance.destroy();
        this.picker = null;
    }

    /** Opens a choice picker beside the control that was used. */
    openChoicePicker(
        unitId: string,
        event: Event,
        options: Readonly<{
            values: PickerChoice[];
            selected: string | number | null;
            title: string;
            style?: 'linear' | 'radial' | 'auto';
            suggestedStyle?: 'linear' | 'radial' | 'auto';
            targetType?: PickerTargetType;
            onPick: (choice: PickerChoice) => void;
        }>,
    ): void {
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        const rect = target?.getBoundingClientRect();
        const inventory = options.targetType === 'inventory';
        const critical = options.targetType === 'crit';
        const position = rect
            ? inventory ? { x: rect.right + 4, y: rect.top + rect.height / 2 }
                : critical ? { x: rect.left, y: rect.top }
                    : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : recordSheetEventPosition(event);
        this.openPicker(unitId, target, () => this.pickerFactory.createChoicePicker({
            values: options.values,
            selected: options.selected,
            position,
            title: options.title,
            lightTheme: this.lightTheme(),
            style: options.style,
            suggestedStyle: options.suggestedStyle,
            targetType: options.targetType,
            horizontal: inventory || critical,
            align: critical ? 'topleft' : inventory ? 'left' : 'center',
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onPick: options.onPick,
            onCancel: () => this.closePicker(),
        }));
    }

    /**
     * Picks a number in the user's picker style: the dial, or a list of `choices` (every value by default) when linear.
     * The picker closes before `pick` runs.
     */
    openNumberPicker(
        unitId: string,
        event: Event,
        options: Readonly<{
            min: number;
            max: number;
            selected: number;
            title: string;
            threshold?: number;
            targetType?: PickerTargetType;
            choices?: readonly PickerChoice[];
        }>,
        pick: (value: number) => void,
    ): void {
        const apply = (value: number): void => {
            this.closePicker();
            pick(value);
        };
        if (this.options.options().pickerStyle === 'linear') {
            this.openChoicePicker(unitId, event, {
                values: options.choices
                    ? [...options.choices]
                    : Array.from({ length: options.max - options.min + 1 }, (_, offset) => ({
                        label: String(options.min + offset),
                        value: options.min + offset,
                    })),
                selected: options.selected,
                title: options.title,
                targetType: options.targetType,
                onPick: choice => apply(Number(choice.value)),
            });
            return;
        }
        const target = event.currentTarget instanceof Element ? event.currentTarget : null;
        this.openPicker(unitId, target, () => this.pickerFactory.createNumericPicker({
            min: options.min,
            max: options.max,
            threshold: options.threshold,
            selected: options.selected,
            position: recordSheetEventPosition(event),
            title: options.title,
            lightTheme: this.lightTheme(),
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onPick: result => apply(result.value),
            onCancel: () => this.closePicker(),
        }));
    }

    /** Picks how many heat sinks are active; `apply` receives how many are then switched off. */
    openActiveHeatSinksPicker(
        unitId: string,
        event: Event,
        count: number,
        heatsinksOff: number,
        apply: (heatsinksOff: number) => void,
    ): void {
        this.openNumberPicker(unitId, event, {
            min: 0,
            max: count,
            selected: Math.max(0, count - heatsinksOff),
            title: 'Active Heatsinks',
            targetType: 'heatsinks',
        }, active => apply(count - active));
    }

    /** Reports a damage or repair on one location's armor or internal structure. */
    showDamageToast(
        unitId: string,
        delta: number,
        hits: Readonly<{
            part: 'armor' | 'rear armor' | 'internal';
            locationCode: string;
            remaining: number;
            maximum: number;
            key: string;
        }>,
    ): void {
        this.toast.showToast(
            `${delta > 0 ? `+${delta}` : delta} ${hits.part} hits in ${hits.locationCode} (${hits.remaining}/${hits.maximum})`,
            delta > 0 ? 'error' : 'success',
            `${unitId}-${hits.key}`,
        );
    }

    /** Replaces the open choice picker's values after a keep-open choice changed them. */
    refreshChoicePicker(unitId: string, values: PickerChoice[]): void {
        if (this.picker?.unitId === unitId && isChoicePickerInstance(this.picker.instance)) {
            this.picker.instance.component.values.set(values);
        }
    }

    /**
     * Asks for the attack direction (the compass for four arcs, a list otherwise), then shows where `roll` lands the
     * hit on the button's sheet.
     */
    openRandomHitPicker(
        unitId: string,
        button: SVGElement,
        event: Event,
        arcs: readonly string[],
        roll: (arc: string) => RecordSheetRandomHit | null,
    ): void {
        this.randomHitResult.clear();
        const rect = button.getBoundingClientRect();
        const config = {
            position: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            lightTheme: this.lightTheme(),
            initialEvent: event instanceof PointerEvent ? event : undefined,
            onPick: (choice: PickerChoice): void => {
                this.closePicker();
                const svg = button.ownerSVGElement;
                const hit = svg ? roll(String(choice.value)) : null;
                if (svg && hit) {
                    this.randomHitResult.show(unitId, svg, button, hit.locationCode, hit.rear,
                        hit.throughArmorCritical, hit.transferredFrom);
                }
            },
            onCancel: () => this.closePicker(),
        };
        this.openPicker(unitId, button, () => arcs.length === 4
            ? this.pickerFactory.createDirectionalPicker(config)
            : this.pickerFactory.createChoicePicker({
                ...config,
                title: 'Attack direction',
                values: arcs.map(arc => ({
                    label: arc.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '),
                    value: arc,
                })),
            }));
    }

    /** Opens a sheet state menu on its control, closing any other picker or menu; a cancel closes it. */
    openStateMenu(unitId: string, menu: RecordSheetMenu, anchor: Element, event: Event, closeOnSelect = true) {
        this.closePicker();
        this.overlayManager.closeAllManagedOverlays();
        const portal = new ComponentPortal(UnitStateDropdownComponent, null, this.injector);
        const result = this.overlayManager.createManagedOverlay(menuOverlayKey(menu), anchor, portal, {
            hasBackdrop: false,
            panelClass: 'unit-state-dropdown-overlay-panel',
            closeOnOutsideClick: true,
        });
        this.menuOwners.set(menu, unitId);
        result.componentRef.setInput('closeOnSelect', closeOnSelect);
        result.componentRef.setInput('initialEvent', event instanceof PointerEvent ? event : null);
        outputToObservable(result.componentRef.instance.cancelled).pipe(takeUntil(result.closed))
            .subscribe(() => this.closeMenu(menu));
        return result;
    }

    closeMenu(menu: RecordSheetMenu): void {
        this.overlayManager.closeManagedOverlay(menuOverlayKey(menu));
        this.menuOwners.delete(menu);
    }

    /** Toggles one of the unit's menu conditions. */
    openConditionMenu(
        member: CBTForceMember,
        event: Event,
        controls: readonly Readonly<{ key: UnitConditionKey; label: string; color: string }>[],
        active: (condition: UnitConditionKey) => boolean,
        context: UnitEditContext,
    ): void {
        const anchor = event.currentTarget;
        if (!(anchor instanceof Element) || controls.length === 0) return;
        const { componentRef, closed } = this.openStateMenu(member.id, 'unit-condition', anchor, event);
        componentRef.setInput('choices', controls.map(control => ({
            key: control.key,
            label: control.label,
            color: control.color,
            active: active(control.key),
        })));
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed)).subscribe(condition => {
            if (!isUnitConditionKey(condition)) return;
            void this.dispatch(member, { type: 'set-condition', condition, active: !active(condition) }, context);
            this.closeMenu('unit-condition');
        });
    }

    /** Asks for a heat value; resolves to a whole, non-negative heat, or null when cancelled. */
    async promptHeat(current: number): Promise<number | null> {
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
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
        return Math.max(0, Math.trunc(Number(value)));
    }

    /** Dispatches one sheet edit, reporting a rejection; resolves to the next edit context, or null. */
    async dispatch(member: CBTForceMember, command: CBTUnitCommand, context: UnitEditContext): Promise<UnitEditContext | null> {
        const result = await member.force.dispatchUnitCommand(member.id, command, context);
        if (!result.accepted) {
            this.rejected();
            return null;
        }
        return result.state ? { owner: context.owner, state: result.state } : null;
    }

    rejected(message = REJECTED_EDIT): void {
        this.toast.showToast(message, 'error');
    }

    /** Edits the person in one crew seat, or the unit's crew when nobody is assigned to it. */
    editCrewPosition(member: CBTForceMember, positionId: CrewPositionId): void {
        const person = member.force.getAssignedPerson(member.id, positionId);
        if (person) void this.pilotEditor.editPerson(member.force, person.id);
        else void this.pilotEditor.editCBTMember(member.force, member.id);
    }

    /** Picks one crew skill and saves it to the seat's crew profile. */
    openCrewSkillPicker(
        member: CBTForceMember,
        event: Event,
        positionId: CrewPositionId,
        field: CrewSkillField,
        context: UnitEditContext,
    ): void {
        const assigned = member.force.getUnitCrewProfile(member.id)?.positions
            .find(position => position.positionId === positionId);
        if (!assigned) return;
        const gunnery = field === 'gunnery' || field === 'aeroGunnery';
        this.openChoicePicker(member.id, event, {
            values: [8, 7, 6, 5, 4, 3, 2, 1, 0].map(value => ({ label: String(value), value })),
            selected: assigned[field] ?? (gunnery ? 4 : 5),
            title: CREW_SKILL_TITLES[field],
            suggestedStyle: 'radial',
            targetType: 'skill',
            onPick: choice => {
                this.closePicker();
                const profile = member.force.getUnitCrewProfile(member.id);
                if (!profile || !this.isCurrent(member, context)) return;
                const positions = profile.positions.map(position => position.positionId === positionId
                    ? { ...position, [field]: Number(choice.value) }
                    : position);
                void member.force.replaceUnitCrewProfile(member.id, positions, context).then(saved => {
                    if (!saved) this.rejected('The crew profile could not be saved.');
                });
            },
        });
    }

    openReferenceTable(member: CBTForceMember): void {
        const runtime = member.force.getUnitSnapshot(member.id);
        if (!runtime) return;
        this.dialogs.createDialog(ClusterTableDialogComponent, {
            data: {
                unit: member.entity,
                gameRules: gameRulesFor(runtime.ruleset),
                hasHotLoadedAmmo: [...runtime.state.ammo.keys()].some(id => runtime.query.ammoHotLoaded(id)),
            },
        });
    }

    /**
     * Selects inventory weapons the same way for every unit: a mode button applies its mode and keeps the weapons
     * selected, a range button selects that range, and several targets offer a target menu. Rows without weapons go to
     * `openEquipment` when the family has other equipment actions.
     */
    async selectInventory(
        member: CBTForceMember,
        interaction: InventorySelection,
        event: Event,
        openEquipment?: (context: UnitEditContext) => void,
    ): Promise<void> {
        let context = interaction.context;
        const registryRevision = member.force.getAttackerTargeting(member.id)?.registryRevision;
        let panel = member.force.getEquipmentPanelSnapshot(member.id);
        if (registryRevision === undefined || !panel || !this.isCurrent(member, context)) return;
        const mode = interaction.mode;
        const changesMode = mode !== undefined && interaction.componentIds
            .some(componentId => equipmentPanelComponentById(panel!, componentId)?.mode !== mode);
        if (mode !== undefined) {
            for (const componentId of interaction.componentIds) {
                const row = equipmentPanelComponentById(member.force.getEquipmentPanelSnapshot(member.id) ?? panel,
                    componentId);
                if (!row?.modes.includes(mode) || row.mode === mode) continue;
                const next = await this.dispatch(member, { type: 'set-component-mode', componentId, mode }, context);
                if (!next) return;
                context = next;
            }
            panel = member.force.getEquipmentPanelSnapshot(member.id);
            if (!panel) return;
        }
        if (member.force.getAttackerTargeting(member.id)?.registryRevision !== registryRevision) return;
        const weapons = [...new Set(interaction.componentIds
            .map(componentId => equipmentPanelComponentById(panel!, componentId)))]
            .filter((row): row is EquipmentPanelComponent & {
                readonly weapon: NonNullable<EquipmentPanelComponent['weapon']>;
            } => row?.weapon !== undefined);
        if (weapons.length === 0) {
            openEquipment?.(context);
            return;
        }
        if (weapons.every(row => !row.weapon.selectable)) return;
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
        const selection = !changesMode && allSelected ? null : desired;
        await this.setComponentSelections(
            member,
            equipmentPanelSelectionComponentIds(panel, interaction.componentIds, selection),
            selection,
            context,
            registryRevision,
        );
    }

    /** Offers the force's targets, each with the selected weapons' target number. */
    openTargetMenu(
        member: CBTForceMember,
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
            menuOverlayKey('weapon-target'),
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
        this.menuOwners.set('weapon-target', member.id);
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
            select(targetId === null
                ? null
                : panel.targets.find(row => row.targetId === targetId)?.targetId ?? null);
            this.closeMenu('weapon-target');
        });
    }

    private openWeaponTargetMenu(
        member: CBTForceMember,
        componentIds: readonly ComponentId[],
        panel: EquipmentPanelSnapshot,
        event: Event,
        context: UnitEditContext,
        registryRevision: number,
    ): void {
        const selectedIds = componentIds
            .map(componentId => equipmentPanelComponentById(panel, componentId)?.weapon?.selection)
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
        const attack = member.force.getWeaponAttackContext(member.id);
        const targetNumberTexts = weapon === undefined || attack === null
            ? {}
            : Object.fromEntries(panel.targets.map(target => [
                target.targetId,
                projectWeaponTargetPresentation(
                    weapon,
                    projectTargetingTarget(target, panel.ruleset),
                    attack,
                    panel.ruleset,
                ).targetNumberText,
            ]));
        this.openTargetMenu(member, panel, event, selectedTargetId, targetNumberTexts, targetId => {
            const selection = targetId === null ? null : { kind: 'target' as const, targetId };
            void this.setComponentSelections(
                member,
                equipmentPanelSelectionComponentIds(panel, componentIds, selection),
                selection,
                context,
                registryRevision,
            );
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
        if (uniqueIds.length === 0 || !this.isCurrent(member, context)) return;
        const result = await member.force.dispatchAttackerTargeting(member.id, {
            type: 'edit-attacker-targeting',
            edit: uniqueIds.length === 1
                ? { kind: 'set-component-selection', componentId: uniqueIds[0], selection }
                : { kind: 'set-component-selections', componentIds: uniqueIds, selection },
        }, context, registryRevision);
        if (!result.accepted) this.rejected();
    }

    private isCurrent(member: CBTForceMember, context: UnitEditContext): boolean {
        const current = member.force.getUnitSnapshot(member.id)?.editContext;
        return current !== undefined && isUnitEditContextCurrent(context, current);
    }

    private openPicker(unitId: string, target: Element | null, create: () => PickerInstance): void {
        this.closePicker();
        this.zoomPan.cancelGesture();
        target?.classList.add('picker-active');
        this.picker = { unitId, instance: create(), target };
    }

    private lightTheme(): boolean {
        return this.options.options().colorScheme === 'night';
    }
}

function menuOverlayKey(menu: RecordSheetMenu): string {
    return `record-sheet-${menu}`;
}

/** The panel row for a component, including a member of a grouped attack. */
export function equipmentPanelComponentById(
    panel: EquipmentPanelSnapshot,
    componentId: ComponentId,
): EquipmentPanelComponent | undefined {
    return panel.components.find(row => row.componentId === componentId
        || row.attack?.members.some(member => member.componentId === componentId) === true);
}

/** The components a selection applies to: every selectable member of a grouped attack, or the row itself. */
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
