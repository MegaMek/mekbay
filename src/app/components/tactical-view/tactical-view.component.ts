// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    Injector,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';

import {
    type CBTForceMember,
    isCBTForceMember,
    isCBTMekForceMember,
} from '../../models/force-member.model';
import type {
    MekEquipmentChoice,
    MekEquipmentInteraction,
} from '../../models/cbt-force.model';
import type {
    EquipmentPanelComponent,
    EquipmentPanelTarget,
    MekPhysicalAttackRow,
} from '../../models/runtime/equipment-panel';
import type {
    MekRecordSheetArmorFace,
    MekRecordSheetCriticalSlot,
    MekRecordSheetCrewPosition,
    MekRecordSheetLocation,
    MekRecordSheetSnapshot,
} from '../../models/runtime/mek-record-sheet';
import type {
    NonMekRecordSheetArmorFace,
    NonMekRecordSheetComponent,
    NonMekRecordSheetCrewPosition,
    NonMekRecordSheetDamageTrack,
    NonMekRecordSheetLocation,
    NonMekRecordSheetSnapshot,
} from '../../models/runtime/non-mek-record-sheet';
import {
    hasNonMekCrewState,
    type NonMekUnitCommand,
} from '../../models/runtime/non-mek-unit-instance';
import type { CBTUnitCommand } from '../../models/runtime/unit-instance';
import { hasMekRuntime } from '../../models/cbt-unit-snapshot';
import { MAX_MEK_CREW_WOUNDS } from '../../models/runtime/runtime-state';
import {
    MEK_CREW_STATE_CONTROLS,
    MEK_UNIT_CONDITION_CONTROLS,
} from '../../models/mek-record-sheet-controls';
import {
    crewStateDefinitions,
    getUnitConditionDefinition,
    unitConditionControls,
    type UnitConditionControl,
} from '../../models/unit-status-presentation';
import type { CrewMemberState } from '../../models/crew.model';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { OptionsService } from '../../services/options.service';
import { ToastService } from '../../services/toast.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForcePilotEditorService } from '../../services/force-pilot-editor.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ClassicUnitViewModeService } from '../../services/classic-unit-view-mode.service';
import { CBTAutomationToastService } from '../../services/cbt-automation-toast.service';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { formatEquipmentLocationCodes } from '../../utils/equipment-location-display.util';
import {
    mekCriticalLocationCells,
    mekDamageLocationOrder,
} from '../../utils/mek-location-layout.util';
import { EquipmentDialogRuntimeController } from '../equipment-dialog/equipment-dialog-runtime.controller';
import { WeaponTargetsOverlayController } from '../equipment-dialog/weapon-targets-overlay.controller';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { composeMekPsrDisplayModifiers } from '../page-viewer/overlay/page-turn-summary.util';
import { PageViewerStateService } from '../page-viewer/internal/page-viewer-state.service';
import { PageViewerMekInteractionService } from '../page-viewer/internal/page-viewer-mek-interaction.service';
import { PageViewerNonMekRuntimeService } from '../page-viewer/internal/page-viewer-non-mek-runtime.service';
import { PageViewerOverlayService } from '../page-viewer/internal/page-viewer-overlay.service';
import { PageViewerZoomPanService } from '../page-viewer/page-viewer-zoom-pan.service';
import type { MekRecordSheetInteraction } from '../page-viewer/mek-record-sheet-binder';
import type { NonMekRecordSheetInteraction } from '../page-viewer/non-mek-record-sheet-binder';
import { recordSheetCommand } from '../page-viewer/mek-record-sheet-interaction.util';
import type { UnitConditionKey } from '../../models/unit-condition.model';
import type { MekLocation } from '../../models/entity/types';
import { TacticalArmorLayoutDirective } from './tactical-armor-layout.directive';
import { TacticalPipMatrixDirective } from './tactical-pip-matrix.directive';
import { TacticalTurnTrackerComponent } from './tactical-turn-tracker.component';

interface MekCriticalGroup {
    readonly code: MekLocation;
    readonly slots: readonly MekRecordSheetCriticalSlot[];
}

type TacticalInventoryGroupId = 'ranged' | 'physical' | 'equipment';

interface TacticalInventoryRow {
    readonly id: string;
    readonly component?: EquipmentPanelComponent;
    readonly physical?: MekPhysicalAttackRow;
    readonly interaction?: MekEquipmentInteraction;
    readonly label: string;
    readonly location: string;
    readonly damage: string;
    readonly heat: string;
    readonly range: string;
    readonly status: string;
    readonly mode?: string;
    readonly ammo?: Readonly<{ remaining: number; capacity: number }>;
}

interface TacticalInventoryGroup {
    readonly id: TacticalInventoryGroupId;
    readonly title: string;
    readonly skill?: Readonly<{ label: string; value: number }>;
    readonly rows: readonly TacticalInventoryRow[];
}

interface TacticalConditionStatus {
    readonly key: string;
    readonly label: string;
    readonly color: string;
}

const TACTICAL_DAMAGE_PIP_THRESHOLD = 100;

const CREW_WOUND_STEPS = Object.freeze([
    Object.freeze({ wounds: 1, label: '3+' }),
    Object.freeze({ wounds: 2, label: '5+' }),
    Object.freeze({ wounds: 3, label: '7+' }),
    Object.freeze({ wounds: 4, label: '10+' }),
    Object.freeze({ wounds: 5, label: '11+' }),
    Object.freeze({ wounds: 6, label: 'X' }),
] as const);

const CREW_POSITION_LABELS = Object.freeze(['Pilot', 'Gunner', 'Officer'] as const);

@Component({
    selector: 'tactical-view',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        PageViewerStateService,
        PageViewerOverlayService,
        PageViewerZoomPanService,
        PageViewerMekInteractionService,
        PageViewerNonMekRuntimeService,
    ],
    imports: [TacticalArmorLayoutDirective, TacticalPipMatrixDirective, TacticalTurnTrackerComponent, UnitIconComponent, TooltipDirective],
    templateUrl: './tactical-view.component.html',
    styleUrl: './tactical-view.component.scss',
})
export class TacticalViewComponent {
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly forceCommands = inject(ForceWorkspaceCommandsService);
    private readonly keyboardShortcuts = inject(KeyboardShortcutService);
    private readonly options = inject(OptionsService);
    private readonly toast = inject(ToastService);
    private readonly dialogs = inject(DialogsService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly injector = inject(Injector);
    private readonly overlay = inject(Overlay);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly unitViewMode = inject(ClassicUnitViewModeService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly automationToastVisibilityOwner = {};
    private readonly mekInteractions = inject(PageViewerMekInteractionService);
    private readonly nonMekInteractions = inject(PageViewerNonMekRuntimeService);
    private readonly targetsOverlay = new WeaponTargetsOverlayController({
        overlay: this.overlay,
        overlayManager: this.overlayManager,
        injector: this.injector,
        destroyRef: this.destroyRef,
    });

    protected readonly mekCrewStateControls = MEK_CREW_STATE_CONTROLS;
    protected readonly crewWoundSteps = CREW_WOUND_STEPS;
    protected readonly damagePipThreshold = TACTICAL_DAMAGE_PIP_THRESHOLD;

    protected readonly member = computed<CBTForceMember | null>(() => {
        const selected = this.workspace.selectedUnit();
        return isCBTForceMember(selected) ? selected : null;
    });
    protected readonly force = computed(() => this.member()?.force ?? null);
    protected readonly readOnly = computed(() => this.force()?.readOnly() ?? true);
    protected readonly forceMembers = computed(() => this.force()?.members()
        .filter(isCBTForceMember) ?? []);
    protected readonly unitIndex = computed(() => {
        const member = this.member();
        return member ? this.forceMembers().findIndex(candidate => candidate.id === member.id) : -1;
    });
    protected readonly canNavigate = computed(() => this.forceMembers().length > 1);
    protected readonly pendingDamage = computed(() => this.options.options().trackPhaseAndTurn);
    protected readonly equipmentRuntime = signal<EquipmentDialogRuntimeController | null>(null);
    protected readonly conditionMenuExpanded = signal(false);

    protected readonly mekSnapshot = computed<MekRecordSheetSnapshot | null>(() => {
        this.equipmentRuntime()?.snapshot();
        const member = this.member();
        return isCBTMekForceMember(member) ? member.mekRecordSheetSnapshot() : null;
    });
    protected readonly nonMekSnapshot = computed<NonMekRecordSheetSnapshot | null>(() => {
        this.equipmentRuntime()?.snapshot();
        const member = this.member();
        return member && !isCBTMekForceMember(member) ? member.nonMekRecordSheetSnapshot() : null;
    });
    protected readonly mekPsrModifiers = computed(() => {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return Object.freeze([]);
        const permanent = snapshot.movement.projection.kind === 'supported'
            ? snapshot.movement.projection.permanentPsrModifiers
            : [];
        return composeMekPsrDisplayModifiers(permanent, snapshot.movement.psr.checks);
    });
    protected readonly mekPsrModifierTotal = computed(() => this.mekPsrModifiers()
        .reduce((total, modifier) => total + modifier.modifier, 0));
    protected readonly mekPsrModifierTooltip = computed<readonly TooltipLine[]>(() => {
        const modifiers = this.mekPsrModifiers();
        return Object.freeze([
            Object.freeze({ value: 'Piloting Skill Roll Modifier', isHeader: true }),
            ...(modifiers.length > 0
                ? modifiers.map(modifier => Object.freeze({
                    label: modifier.reason,
                    value: this.formatModifier(modifier.modifier),
                }))
                : [Object.freeze({ label: 'No active modifiers', value: '+0' })]),
            Object.freeze({ isBreak: true }),
            Object.freeze({ label: 'Final modifier', value: this.formatModifier(this.mekPsrModifierTotal()) }),
        ]);
    });
    protected readonly nonMekConditionControls = computed(() => {
        const snapshot = this.nonMekSnapshot();
        return snapshot && !this.readOnly() ? unitConditionControls(snapshot.conditionControlKeys) : [];
    });
    protected readonly mekConditionControls = computed(() =>
        this.mekSnapshot() && !this.readOnly() ? MEK_UNIT_CONDITION_CONTROLS : []);
    protected readonly activeConditionControls = computed<readonly UnitConditionControl[]>(() =>
        this.mekSnapshot() ? this.mekConditionControls() : this.nonMekConditionControls());
    protected readonly primaryConditionControls = computed(() => Object.freeze(
        this.activeConditionControls().filter(control => control.placement === 'button'),
    ));
    protected readonly menuConditionControls = computed(() => Object.freeze(
        this.activeConditionControls().filter(control => control.placement === 'menu'),
    ));
    protected readonly hasExpandableConditionMenu = computed(() =>
        this.primaryConditionControls().length > 0 && this.menuConditionControls().length > 0);
    protected readonly visibleConditionControls = computed<readonly UnitConditionControl[]>(() => {
        const primary = this.primaryConditionControls();
        const menu = this.menuConditionControls();
        if (primary.length === 0) return menu;
        if (menu.length === 0) return primary;
        if (this.conditionMenuExpanded()) return Object.freeze([...primary, ...menu]);
        return Object.freeze([
            ...primary,
            ...menu.filter(control => this.unitConditionActive(control.key)),
        ]);
    });
    protected readonly passiveConditionStatuses = computed<readonly TacticalConditionStatus[]>(() => {
        const mek = this.mekSnapshot();
        const snapshot = mek ?? this.nonMekSnapshot();
        if (!snapshot) return Object.freeze([]);

        const statuses: TacticalConditionStatus[] = [];
        const added = new Set<string>();
        const add = (status: TacticalConditionStatus): void => {
            if (added.has(status.key)) return;
            added.add(status.key);
            statuses.push(Object.freeze(status));
        };

        if (snapshot.destroyed) add({ key: 'destroyed', label: 'DESTROYED', color: '#db4d43' });
        if (mek?.crippled) {
            const crippled = getUnitConditionDefinition('crippled');
            add({ key: crippled.key, label: crippled.label, color: crippled.color });
        }

        const controllable = new Set(this.activeConditionControls().map(control => control.key));
        for (const key of snapshot.conditions) {
            if (controllable.has(key)) continue;
            const condition = getUnitConditionDefinition(key);
            add({ key: condition.key, label: condition.label, color: condition.color });
        }
        return Object.freeze(statuses);
    });
    protected readonly nonMekCrewStateControls = computed(() => {
        const snapshot = this.nonMekSnapshot();
        return snapshot ? crewStateDefinitions(snapshot.crewStateControlKeys) : [];
    });
    protected readonly mekCriticalGroups = computed<readonly MekCriticalGroup[]>(() => {
        const groups = new Map<MekLocation, MekRecordSheetCriticalSlot[]>();
        for (const slot of this.mekSnapshot()?.criticalSlots ?? []) {
            if (slot.components.length === 0 && slot.committedHits === 0 && slot.previewHits === 0) continue;
            const slots = groups.get(slot.locationCode) ?? [];
            slots.push(slot);
            groups.set(slot.locationCode, slots);
        }
        return [...groups].map(([code, slots]) => Object.freeze({
            code,
            slots: Object.freeze(slots),
        }));
    });
    protected readonly orderedMekLocations = computed<readonly MekRecordSheetLocation[]>(() => {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return Object.freeze([]);
        const order = mekDamageLocationOrder(snapshot.identity.form);
        const priority = new Map(order.map((code, index) => [code, index]));
        return Object.freeze([...snapshot.locations].sort((left, right) =>
            (priority.get(left.code) ?? Number.MAX_SAFE_INTEGER)
            - (priority.get(right.code) ?? Number.MAX_SAFE_INTEGER)));
    });
    protected readonly mekCriticalCells = computed<readonly (MekCriticalGroup | null)[]>(() => {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return Object.freeze([]);
        const groups = this.mekCriticalGroups();
        const byCode = new Map(groups.map(group => [group.code, group]));
        const cells = mekCriticalLocationCells(snapshot.identity.form)
            .map(code => code === null ? null : byCode.get(code) ?? null);
        const standardCodes = new Set(mekCriticalLocationCells(snapshot.identity.form));
        const extras = groups.filter(group => !standardCodes.has(group.code));
        while (extras.length > 0) {
            cells.push(extras.shift() ?? null, extras.shift() ?? null, extras.shift() ?? null);
        }
        return Object.freeze(cells);
    });
    protected readonly inventoryGroups = computed<readonly TacticalInventoryGroup[]>(() => {
        const runtime = this.equipmentRuntime();
        if (!runtime) return Object.freeze([]);
        const snapshot = runtime.snapshot();
        const groups: TacticalInventoryGroup[] = [
            {
                id: 'ranged',
                title: 'Ranged',
                skill: Object.freeze({ label: 'Gunnery', value: snapshot.crew.gunnery }),
                rows: Object.freeze(runtime.weapons().map(component => this.inventoryComponentRow(runtime, component))),
            },
            {
                id: 'physical',
                title: 'Physical',
                skill: Object.freeze({ label: 'Piloting', value: snapshot.crew.piloting }),
                rows: Object.freeze(snapshot.physicalAttacks.map(attack => this.inventoryPhysicalRow(runtime, attack))),
            },
            {
                id: 'equipment',
                title: 'Equipment',
                rows: Object.freeze(runtime.equipment().map(component => this.inventoryComponentRow(runtime, component))),
            },
        ];
        return Object.freeze(groups.filter(group => group.rows.length > 0));
    });
    protected readonly inventoryRowCount = computed(() => this.inventoryGroups()
        .reduce((count, group) => count + group.rows.length, 0));
    protected readonly targets = computed<readonly EquipmentPanelTarget[]>(() =>
        this.equipmentRuntime()?.snapshot().targets ?? Object.freeze([]));
    protected readonly supportsTargeting = computed(() => {
        this.equipmentRuntime()?.snapshot();
        const member = this.member();
        return member !== null && member.force.getAttackerTargeting(member.id) !== null;
    });
    protected readonly inventoryDetailRowIds = computed(() => this.inventoryGroups()
        .flatMap(group => group.rows)
        .filter(row => this.rowHasNestedControls(row))
        .map(row => row.id));
    protected readonly allInventoryRowsExpanded = computed(() => {
        const ids = this.inventoryDetailRowIds();
        const member = this.member();
        return member !== null
            && ids.length > 0
            && ids.every(id => member.isTacticalInventoryRowExpanded(id));
    });

    constructor() {
        effect(() => {
            const member = this.member();
            this.conditionMenuExpanded.set(false);
            this.automationToasts.setVisibleUnitIds(
                this.automationToastVisibilityOwner,
                member ? [member.id] : [],
            );
        });
        this.destroyRef.onDestroy(() => this.automationToasts.clearVisibleUnitIds(
            this.automationToastVisibilityOwner,
        ));
        effect(onCleanup => {
            const member = this.member();
            this.overlayManager.closeManagedOverlay('tactical-targets');
            this.targetsOverlay.clearRef();
            if (!member) {
                this.equipmentRuntime.set(null);
                return;
            }
            const runtime = new EquipmentDialogRuntimeController(
                member,
                this.options,
                this.toast,
                this.dialogs,
            );
            this.equipmentRuntime.set(runtime);
            onCleanup(() => {
                runtime.dispose();
                if (isCBTMekForceMember(member)) this.mekInteractions.cleanup(member.id);
                else this.nonMekInteractions.clear();
            });
        });
        this.keyboardShortcuts.register({
            id: 'tactical-view',
            active: () => this.member() !== null,
            handle: event => this.handleShortcut(event),
        }, this.destroyRef);
    }

    protected previousUnit(): void {
        this.forceCommands.selectPreviousUnit();
    }

    protected nextUnit(): void {
        this.forceCommands.selectNextUnit();
    }

    protected toggleConditionMenu(): void {
        if (!this.hasExpandableConditionMenu()) return;
        this.conditionMenuExpanded.update(expanded => !expanded);
    }

    protected unitConditionActive(key: UnitConditionKey): boolean {
        const snapshot = this.mekSnapshot() ?? this.nonMekSnapshot();
        return snapshot?.conditions.includes(key) ?? false;
    }

    protected toggleUnitCondition(key: UnitConditionKey): void {
        if (this.mekSnapshot()) {
            void this.toggleMekCondition(key);
            return;
        }
        void this.toggleNonMekCondition(key);
    }

    protected showSheetView(): void {
        this.overlayManager.closeAllManagedOverlays();
        this.unitViewMode.showSheet();
    }

    protected openTargets(event: MouseEvent): void {
        event.stopPropagation();
        const member = this.member();
        if (!member || !this.supportsTargeting()) return;
        const key = 'tactical-targets';
        if (this.targetsOverlay.has(key)) {
            this.targetsOverlay.close(key);
            return;
        }
        this.overlayManager.closeAllManagedOverlays();
        this.targetsOverlay.open({
            overlayKey: key,
            target: event.currentTarget as HTMLElement,
            member,
            sensitiveAreaReferenceElement: this.host.nativeElement,
        });
    }

    protected canUndo(): boolean {
        return this.force()?.getRuntimeUndoState().canUndo === true && !this.readOnly();
    }

    protected canRedo(): boolean {
        return this.force()?.getRuntimeUndoState().canRedo === true && !this.readOnly();
    }

    protected async undoRuntimeCommand(): Promise<void> {
        const force = this.force();
        if (!force || !this.canUndo()) return;
        const result = await force.undoRuntimeCommand();
        if (!result.accepted) this.showRejectedEdit(result.reason);
    }

    protected async redoRuntimeCommand(): Promise<void> {
        const force = this.force();
        if (!force || !this.canRedo()) return;
        const result = await force.redoRuntimeCommand();
        if (!result.accepted) this.showRejectedEdit(result.reason);
    }

    protected pips(maximum: number): readonly number[] {
        return Array.from({ length: Math.max(0, Math.trunc(maximum)) }, (_, index) => index + 1);
    }

    protected pipGroups(maximum: number): readonly (readonly number[])[] {
        const renderedMaximum = Math.min(
            TACTICAL_DAMAGE_PIP_THRESHOLD,
            Math.max(0, Math.trunc(maximum)),
        );
        const groups: number[][] = [];
        for (let first = 1; first <= renderedMaximum; first += 5) {
            groups.push(Array.from(
                { length: Math.min(5, renderedMaximum - first + 1) },
                (_value, index) => first + index,
            ));
        }
        return groups;
    }

    protected damageTrackValue(remaining: number, maximum: number): string {
        return remaining === maximum ? `${remaining}` : `${remaining}/${maximum}`;
    }

    protected formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }

    protected crewPositionLabel(index: number): string {
        return CREW_POSITION_LABELS[index] ?? `Crew ${index + 1}`;
    }

    protected editCrew(): void {
        const member = this.member();
        if (!member || this.readOnly()) return;
        void this.pilotEditor.editClassicMember(member.force, member.id);
    }

    protected percentage(remaining: number, maximum: number): number {
        return maximum <= 0 ? 0 : Math.max(0, Math.min(100, remaining / maximum * 100));
    }

    protected formatStatus(status: string): string {
        return status.replaceAll('-', ' ').toUpperCase();
    }

    protected mekArmorRemaining(face: MekRecordSheetArmorFace): number {
        return this.pendingDamage() ? face.previewRemaining : face.committedRemaining;
    }

    protected mekInternalRemaining(location: MekRecordSheetLocation): number {
        return this.pendingDamage()
            ? location.previewRemainingInternal
            : location.committedRemainingInternal;
    }

    protected mekCriticalHits(slot: MekRecordSheetCriticalSlot): number {
        return this.pendingDamage() ? slot.previewHits : slot.committedHits;
    }

    protected mekHeat(snapshot: MekRecordSheetSnapshot): number {
        return Math.max(0, snapshot.heat.pendingOverride ?? snapshot.heat.current);
    }

    protected nonMekArmorRemaining(face: NonMekRecordSheetArmorFace): number {
        return this.pendingDamage() ? face.previewRemaining : face.remaining;
    }

    protected nonMekInternalRemaining(location: NonMekRecordSheetLocation): number {
        return this.pendingDamage() ? location.previewRemainingInternal : location.remainingInternal;
    }

    protected nonMekTrackHits(track: NonMekRecordSheetDamageTrack): number {
        return this.pendingDamage() ? track.previewHits : track.committedHits;
    }

    protected nonMekHeat(snapshot: NonMekRecordSheetSnapshot): number {
        return Math.max(0, snapshot.heat.pending ?? snapshot.heat.current);
    }

    protected equipmentLocation(component: MekRecordSheetSnapshot['equipment'][number]): string {
        return formatEquipmentLocationCodes(component.locations.map(location => location.code));
    }

    protected equipmentRanges(component: MekRecordSheetSnapshot['equipment'][number]): string {
        return component.weapon?.ranges.slice(0, 4).join('/') ?? '—';
    }

    protected criticalLabel(slot: MekRecordSheetCriticalSlot): string {
        return slot.components.map(component => component.label).join(' / ') || `Slot ${slot.slotIndex + 1}`;
    }

    protected rowHasNestedControls(row: TacticalInventoryRow): boolean {
        return row.interaction?.choices.some(choice => choice.displayType !== 'label') === true
            || (this.supportsTargeting() && (
                row.component?.weapon?.selectable === true
                || (row.physical?.available === true && row.physical.selectable)
            ));
    }

    protected inventoryRowExpanded(row: TacticalInventoryRow): boolean {
        return this.rowHasNestedControls(row)
            && this.member()?.isTacticalInventoryRowExpanded(row.id) === true;
    }

    protected toggleInventoryRow(row: TacticalInventoryRow): void {
        const member = this.member();
        if (!member || !this.rowHasNestedControls(row)) return;
        member.setTacticalInventoryRowExpanded(
            row.id,
            !member.isTacticalInventoryRowExpanded(row.id),
        );
    }

    protected toggleAllInventoryRows(): void {
        const member = this.member();
        if (!member) return;
        const ids = this.inventoryDetailRowIds();
        member.setTacticalInventoryRowsExpanded(this.allInventoryRowsExpanded() ? [] : ids);
    }

    protected inventoryTargetSelection(row: TacticalInventoryRow): string {
        const runtime = this.equipmentRuntime();
        if (!runtime) return '';
        if (row.component) return runtime.selectedTarget(row.component);
        const selection = row.physical?.selection;
        if (!selection) return '';
        return selection.kind === 'target' ? selection.targetId : 'selected';
    }

    protected async selectInventoryTarget(row: TacticalInventoryRow, targetId: string): Promise<void> {
        const runtime = this.equipmentRuntime();
        if (!runtime || this.readOnly()) return;
        if (row.component) await runtime.selectTarget(row.component, targetId);
        else if (row.physical) await runtime.selectPhysicalTarget(row.physical, targetId);
    }

    protected async chooseEquipmentInteraction(
        row: TacticalInventoryRow,
        choice: MekEquipmentChoice,
    ): Promise<void> {
        const runtime = this.equipmentRuntime();
        if (!runtime || !row.interaction || choice.disabled) return;
        await runtime.chooseInteraction(row.interaction, choice.token);
    }

    protected choiceBackground(choice: MekEquipmentChoice): string | null {
        if (choice.disabled) return choice.colors?.disabled ?? null;
        if (!choice.active) return choice.colors?.normal ?? null;
        return choice.selectionTone === 'muted'
            ? choice.colors?.mutedSelected ?? null
            : choice.colors?.selected ?? null;
    }

    protected choiceTextColor(choice: MekEquipmentChoice): string | null {
        if (choice.disabled) return choice.colors?.disabledText ?? null;
        if (!choice.active) return choice.colors?.normalText ?? null;
        return choice.selectionTone === 'muted'
            ? choice.colors?.mutedSelectedText ?? null
            : choice.colors?.selectedText ?? null;
    }

    protected criticalIntermediatePips(slot: MekRecordSheetCriticalSlot): readonly number[] {
        const componentCapacity = slot.hitCapacity - (slot.armored ? 1 : 0);
        return this.pips(Math.max(0, componentCapacity - 1));
    }

    protected criticalArmorHit(slot: MekRecordSheetCriticalSlot): boolean {
        return slot.armored && this.mekCriticalHits(slot) > 0;
    }

    protected criticalIntermediateHit(slot: MekRecordSheetCriticalSlot, index: number): boolean {
        return this.mekCriticalHits(slot) > (slot.armored ? 1 : 0) + index - 1;
    }

    protected criticalDestroyed(slot: MekRecordSheetCriticalSlot): boolean {
        return this.mekCriticalHits(slot) >= slot.hitCapacity;
    }

    protected activateMekCritical(slot: MekRecordSheetCriticalSlot, event: MouseEvent): void {
        if (this.readOnly() || !slot.hittable) return;
        const member = this.member();
        const snapshot = isCBTMekForceMember(member) ? member.mekRecordSheetSnapshot() : null;
        if (!isCBTMekForceMember(member) || !snapshot) return;
        const componentIds = slot.components.map(component => component.componentId);
        const hasHandler = this.equipmentRuntime()?.interactions()
            .some(interaction => componentIds.includes(interaction.componentId)) === true;
        const needsPicker = slot.hitCapacity > 1
            || slot.components.some(component => component.ammo !== undefined)
            || hasHandler;
        if (!needsPicker) {
            void this.adjustMekCritical(slot, this.mekCriticalHits(slot) > 0 ? -1 : 1);
            return;
        }
        this.mekInteractions.handle(member, {
            kind: 'critical',
            slotId: slot.slotId,
            componentIds,
            button: 'primary',
            expectedRevision: snapshot.stateRevision,
        }, event);
    }

    protected openMekArmorPicker(face: MekRecordSheetArmorFace, event: MouseEvent): void {
        const member = this.member();
        const snapshot = isCBTMekForceMember(member) ? member.mekRecordSheetSnapshot() : null;
        if (!isCBTMekForceMember(member) || !snapshot || this.readOnly()) return;
        this.mekInteractions.handle(member, {
            kind: 'armor',
            faceId: face.faceId,
            locationId: face.locationId,
            button: 'primary',
            expectedRevision: snapshot.stateRevision,
        }, event);
    }

    protected openMekInternalPicker(location: MekRecordSheetLocation, event: MouseEvent): void {
        const member = this.member();
        const snapshot = isCBTMekForceMember(member) ? member.mekRecordSheetSnapshot() : null;
        if (!isCBTMekForceMember(member) || !snapshot || this.readOnly()) return;
        this.mekInteractions.handle(member, {
            kind: 'internal',
            locationId: location.locationId,
            button: 'primary',
            expectedRevision: snapshot.stateRevision,
        }, event);
    }

    protected openNonMekDamagePicker(
        interaction: Readonly<{
            readonly kind: 'armor';
            readonly faceId: NonMekRecordSheetArmorFace['faceId'];
            readonly locationId: NonMekRecordSheetArmorFace['locationId'];
        }> | Readonly<{
            readonly kind: 'internal';
            readonly locationId: NonMekRecordSheetLocation['locationId'];
        }>,
        event: MouseEvent,
    ): void {
        const member = this.member();
        const snapshot = member && !isCBTMekForceMember(member)
            ? member.nonMekRecordSheetSnapshot()
            : null;
        if (!member || isCBTMekForceMember(member) || !snapshot || this.readOnly()) return;
        if (interaction.kind === 'internal' && member.entity.entityType === 'BattleArmor') {
            const location = snapshot.locations.find(candidate => candidate.locationId === interaction.locationId);
            if (location?.maximumInternal === 1) {
                void this.adjustNonMekInternal(
                    location,
                    this.nonMekInternalRemaining(location) > 0 ? 1 : -1,
                );
                return;
            }
        }
        this.nonMekInteractions.handle(member, {
            ...interaction,
            expectedRevision: snapshot.stateRevision,
        } as Extract<NonMekRecordSheetInteraction, { readonly kind: 'armor' | 'internal' }>, event);
    }

    protected openNonMekTrackPicker(track: NonMekRecordSheetDamageTrack, event: MouseEvent): void {
        const member = this.member();
        const snapshot = this.nonMekSnapshot();
        if (!member || isCBTMekForceMember(member) || !snapshot || this.readOnly()) return;
        this.nonMekInteractions.handle(member, {
            kind: 'damage-track',
            damageTrackId: track.damageTrackId,
            expectedRevision: snapshot.stateRevision,
        }, event);
    }

    protected async toggleMekCondition(key: UnitConditionKey): Promise<void> {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return;
        await this.dispatchMekInteraction(key === 'shutdown'
            ? { kind: 'shutdown', expectedRevision: snapshot.stateRevision }
            : { kind: 'condition', condition: key, expectedRevision: snapshot.stateRevision });
    }

    protected async adjustMekArmor(face: MekRecordSheetArmorFace, delta: 1 | -1): Promise<void> {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return;
        await this.dispatchMekInteraction({
            kind: 'armor',
            faceId: face.faceId,
            locationId: face.locationId,
            button: delta > 0 ? 'primary' : 'secondary',
            expectedRevision: snapshot.stateRevision,
        }, delta);
    }

    protected async adjustMekInternal(location: MekRecordSheetLocation, delta: 1 | -1): Promise<void> {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return;
        await this.dispatchMekInteraction({
            kind: 'internal',
            locationId: location.locationId,
            button: delta > 0 ? 'primary' : 'secondary',
            expectedRevision: snapshot.stateRevision,
        }, delta);
    }

    protected async adjustMekCritical(slot: MekRecordSheetCriticalSlot, delta: 1 | -1): Promise<void> {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return;
        await this.dispatchMekInteraction({
            kind: 'critical',
            slotId: slot.slotId,
            componentIds: slot.components.map(component => component.componentId),
            button: delta > 0 ? 'primary' : 'secondary',
            expectedRevision: snapshot.stateRevision,
        }, delta);
    }

    protected async adjustMekHeat(delta: 1 | -1): Promise<void> {
        const snapshot = this.mekSnapshot();
        if (!snapshot) return;
        await this.dispatchMekInteraction({
            kind: 'heat',
            heat: Math.max(0, this.mekHeat(snapshot) + delta),
            expectedRevision: snapshot.stateRevision,
        });
    }

    protected async setMekCrewWounds(position: MekRecordSheetCrewPosition, wounds: number): Promise<void> {
        const snapshot = this.mekSnapshot();
        const current = snapshot?.crew.find(candidate => candidate.positionId === position.positionId);
        if (!snapshot || !current || !Number.isSafeInteger(wounds)) return;
        const boundedWounds = Math.max(1, Math.min(MAX_MEK_CREW_WOUNDS, wounds));
        await this.dispatchMekInteraction({
            kind: 'crew-wounds',
            positionId: current.positionId,
            wounds: current.state.wounds === boundedWounds ? boundedWounds - 1 : boundedWounds,
            expectedRevision: snapshot.stateRevision,
        });
    }

    protected async toggleMekCrewState(
        position: MekRecordSheetCrewPosition,
        state: CrewMemberState,
    ): Promise<void> {
        if (state !== 'unconscious' && state !== 'ejected') return;
        const snapshot = this.mekSnapshot();
        if (!snapshot) return;
        const current = snapshot.crew.find(candidate => candidate.positionId === position.positionId);
        if (!current) return;
        await this.sendMekCommand({
            type: 'set-crew-state',
            positionId: current.positionId,
            wounds: current.state.wounds,
            unconscious: state === 'unconscious' ? !current.state.unconscious : current.state.unconscious,
            ejected: state === 'ejected' ? !current.state.ejected : current.state.ejected,
        });
    }

    protected async adjustMekAmmo(
        component: MekRecordSheetSnapshot['equipment'][number],
        deltaRemaining: 1 | -1,
    ): Promise<void> {
        const snapshot = this.mekSnapshot();
        const current = snapshot?.equipment.find(candidate => candidate.componentId === component.componentId);
        if (!snapshot || !current?.ammo) return;
        await this.sendMekCommand(deltaRemaining < 0
            ? {
                type: 'spend-ammo',
                componentId: current.componentId,
                amount: 1,
            }
            : {
                type: 'configure-ammo-source',
                componentId: current.componentId,
                munitionKey: current.ammo.munitionKey,
                remaining: Math.min(current.ammo.capacity, current.ammo.remaining + 1),
            });
    }

    protected async toggleNonMekCondition(key: UnitConditionKey): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        if (!snapshot) return;
        await this.sendNonMekCommand({
            kind: 'set-condition',
            condition: key,
            active: !snapshot.conditions.includes(key),
        });
    }

    protected async adjustNonMekArmor(face: NonMekRecordSheetArmorFace, delta: 1 | -1): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        if (!snapshot) return;
        await this.sendNonMekCommand(delta > 0
            ? {
                kind: 'damage-armor',
                faceId: face.faceId,
                amount: delta,
                target: this.damageTarget(),
            }
            : {
                kind: 'repair-armor',
                faceId: face.faceId,
                amount: Math.abs(delta),
                target: this.damageTarget(),
            });
    }

    protected async adjustNonMekInternal(location: NonMekRecordSheetLocation, delta: 1 | -1): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        if (!snapshot) return;
        await this.sendNonMekCommand(delta > 0
            ? {
                kind: 'damage-internal',
                locationId: location.locationId,
                amount: delta,
                target: this.damageTarget(),
            }
            : {
                kind: 'repair-internal',
                locationId: location.locationId,
                amount: Math.abs(delta),
                target: this.damageTarget(),
            });
    }

    protected async adjustNonMekTrack(track: NonMekRecordSheetDamageTrack, delta: 1 | -1): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        if (!snapshot) return;
        await this.sendNonMekCommand(delta > 0
            ? {
                kind: 'damage-track',
                damageTrackId: track.damageTrackId,
                amount: delta,
                target: this.damageTarget(),
                timestamp: Date.now(),
            }
            : {
                kind: 'repair-damage-track',
                damageTrackId: track.damageTrackId,
                amount: Math.abs(delta),
                target: this.damageTarget(),
            });
    }

    protected async adjustNonMekHeat(delta: 1 | -1): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        if (!snapshot?.heat.tracked) return;
        await this.sendNonMekCommand({
            kind: 'set-heat',
            heat: Math.max(0, this.nonMekHeat(snapshot) + delta),
            target: this.damageTarget(),
        });
    }

    protected async adjustNonMekAmmo(component: NonMekRecordSheetComponent, deltaRemaining: 1 | -1): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        const current = snapshot?.components.find(candidate => candidate.componentId === component.componentId);
        if (!snapshot || !current?.ammo) return;
        const remaining = Math.max(0, Math.min(current.ammo.capacity, current.ammo.remaining + deltaRemaining));
        await this.sendNonMekCommand({
            kind: 'set-ammo-spent',
            componentId: current.componentId,
            shotsSpent: current.ammo.capacity - remaining,
        });
    }

    protected async toggleNonMekComponent(component: NonMekRecordSheetComponent): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        const current = snapshot?.components.find(candidate => candidate.componentId === component.componentId);
        if (!snapshot || !current) return;
        await this.sendNonMekCommand({
            kind: 'set-component-status',
            componentId: current.componentId,
            status: current.previewStatus === 'available' ? 'destroyed' : 'available',
            target: this.damageTarget(),
        });
    }

    protected async setNonMekCrewWounds(
        position: NonMekRecordSheetCrewPosition,
        wounds: number,
    ): Promise<void> {
        const snapshot = this.nonMekSnapshot();
        const current = snapshot?.crew.find(candidate => candidate.positionId === position.positionId);
        if (!snapshot || !current || !Number.isSafeInteger(wounds)) return;
        const boundedWounds = Math.max(1, Math.min(CREW_WOUND_STEPS.length, wounds));
        await this.sendNonMekCommand({
            kind: 'set-crew-state',
            positionId: current.positionId,
            wounds: current.state.wounds === boundedWounds ? boundedWounds - 1 : boundedWounds,
            unconscious: current.state.unconscious,
            ejected: current.state.ejected,
            killed: current.state.killed === true,
            stunned: current.state.stunned === true,
        });
    }

    protected async toggleNonMekCrewState(
        position: NonMekRecordSheetCrewPosition,
        selected: CrewMemberState,
    ): Promise<void> {
        if (selected !== 'unconscious'
            && selected !== 'ejected'
            && selected !== 'killed'
            && selected !== 'stunned') return;
        const snapshot = this.nonMekSnapshot();
        const current = snapshot?.crew.find(candidate => candidate.positionId === position.positionId);
        if (!snapshot || !current) return;
        const active = hasNonMekCrewState(current.state, selected);
        await this.sendNonMekCommand({
            kind: 'set-crew-state',
            positionId: current.positionId,
            wounds: current.state.wounds,
            unconscious: selected === 'unconscious' ? !active : current.state.unconscious,
            ejected: selected === 'ejected' ? !active : current.state.ejected,
            killed: selected === 'killed' ? !active : current.state.killed === true,
            stunned: selected === 'stunned' ? !active : current.state.stunned === true,
        });
    }

    private inventoryComponentRow(
        runtime: EquipmentDialogRuntimeController,
        component: EquipmentPanelComponent,
    ): TacticalInventoryRow {
        const ammoSources = component.weapon?.ammoSources ?? [];
        const ammo = ammoSources.length === 0
            ? undefined
            : Object.freeze({
                remaining: ammoSources.reduce((total, source) => total + source.remaining, 0),
                capacity: ammoSources.reduce((total, source) => total + source.capacity, 0),
            });
        const ranges = component.weapon?.ranges.slice(0, 3) ?? [];
        return Object.freeze({
            id: component.componentId,
            component,
            ...(runtime.interaction(component) === undefined
                ? {}
                : { interaction: runtime.interaction(component) }),
            label: component.label,
            location: runtime.locations(component),
            damage: component.weapon?.damageText ?? '—',
            heat: component.weapon === undefined
                ? '—'
                : `${component.weapon.heat}${component.weapon.heatSuffix ?? ''}`,
            range: ranges.length === 0 ? '—' : ranges.join('/'),
            status: component.previewStatus,
            ...(component.mode === undefined || component.mode === component.defaultMode
                ? {}
                : { mode: component.mode }),
            ...(ammo === undefined ? {} : { ammo }),
        });
    }

    private inventoryPhysicalRow(
        runtime: EquipmentDialogRuntimeController,
        attack: MekPhysicalAttackRow,
    ): TacticalInventoryRow {
        return Object.freeze({
            id: `physical:${attack.target.kind === 'component'
                ? attack.target.componentId
                : attack.target.actionId}`,
            physical: attack,
            label: attack.label,
            location: formatEquipmentLocationCodes(attack.locationCodes, ', '),
            damage: runtime.physicalDamage(attack),
            heat: attack.firingHeat > 0 ? String(attack.firingHeat) : '—',
            range: '—',
            status: attack.available ? 'available' : 'disabled',
        });
    }

    private handleShortcut(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.altKey || event.metaKey || !this.canNavigate()) return false;
        if (event.key === 'ArrowLeft') {
            this.previousUnit();
            return true;
        }
        if (event.key === 'ArrowRight') {
            this.nextUnit();
            return true;
        }
        return false;
    }

    private damageTarget(): 'committed' | 'pending' {
        return this.pendingDamage() ? 'pending' : 'committed';
    }

    private async dispatchMekInteraction(
        interaction: MekRecordSheetInteraction,
        delta?: number,
    ): Promise<void> {
        const member = this.member();
        const snapshot = this.mekSnapshot();
        const unit = member?.force.getUnitSnapshot(member.id);
        if (!isCBTMekForceMember(member) || !snapshot || !unit || !hasMekRuntime(unit)) return;
        const command = recordSheetCommand(interaction, {
            query: unit.query,
            heatSinkCount: snapshot.heatSinks.count,
            heatPolicy: snapshot.heatPolicy,
        }, this.pendingDamage(), delta);
        await this.sendMekCommand(command);
    }

    private async sendMekCommand(command: CBTUnitCommand): Promise<void> {
        const member = this.member();
        if (!isCBTMekForceMember(member) || this.readOnly()) return;
        const result = await member.force.dispatchMekUnitCommand(member.id, command);
        if (!result.accepted) this.showRejectedEdit('This force is read-only.');
    }

    private async sendNonMekCommand(command: NonMekUnitCommand): Promise<void> {
        const member = this.member();
        if (!member || isCBTMekForceMember(member) || this.readOnly()) return;
        const result = await member.force.dispatchNonMekUnitCommand(member.id, command);
        if (!result.accepted) this.showRejectedEdit('This force is read-only.');
    }

    private showRejectedEdit(reason: unknown): void {
        this.toast.showToast(`Tactical edit rejected: ${String(reason ?? 'unknown reason')}`, 'error');
    }
}
