// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Injector, input, signal } from '@angular/core';
import { DragDropModule, type CdkDragDrop, type CdkDragStart, moveItemInArray } from '@angular/cdk/drag-drop';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import {
    INVENTORY_MODE_CHOICE_LABEL,
    INVENTORY_MODE_HANDLER_ID,
} from '../../models/runtime/component-inventory-mode';
import { LayoutService } from '../../services/layout.service';
import { MultilineDropdownComponent, type MultilineDropdownOption } from '../multiline-dropdown/multiline-dropdown.component';
import { WeaponTargetChoiceMenuComponent } from '../equipment-dialog/weapon-target-choice-menu.component';
import type { EncounterTargetId } from '../../models/runtime/encounter-runtime';
import type { TargetingTarget } from '../../models/runtime/targeting-target';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import {
    formatInventoryTargetSignedModifier,
    formatPhysicalHitModifier,
    type InventoryTargetRangeSelection,
} from '../../utils/inventory-target-number.util';
import type { EquipmentDialogChoice } from './equipment-dialog.model';
import type { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';
import type {
    EquipmentPanelAmmoSource,
    EquipmentPanelComponent,
    MekPhysicalAttackRow,
} from '../../models/runtime/equipment-panel';
import {
    projectWeaponTargetPresentation,
    projectTargetingTarget,
} from '../../models/runtime/equipment-panel';
import {
    STANDARD_AEROSPACE_RANGE_LIMITS,
    aerospaceRangeCaptions,
} from '../../utils/aerospace-range.util';
import { applyEquipmentRowOrder } from '../../models/runtime/equipment-row-order';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import { orderedModifierTooltipLines } from '../../utils/hit-target-tooltip.util';
import {
    SKILL_BREAKDOWN_PRIORITY,
    type ToHitResolution,
} from '../../models/rules/game-rules';
import type { UnitModifierBreakdownEntry } from '../../models/combat-modifier';
import { machineGunArrayClusterModifier } from '../../models/runtime/component-machine-gun-array';

interface RangeColumn {
    key: InventoryRangeDisplayKey;
    label: string;
    caption?: string;
}

const GROUND_RANGE_COLUMNS: readonly RangeColumn[] = [
    { key: 'short', label: 'Sht' },
    { key: 'medium', label: 'Med' },
    { key: 'long', label: 'Lng' }
];
const GROUND_EXTREME_RANGE_COLUMNS: readonly RangeColumn[] = [
    ...GROUND_RANGE_COLUMNS,
    { key: 'extreme', label: 'Ext' }
];
const AEROSPACE_RANGE_CAPTIONS = aerospaceRangeCaptions(STANDARD_AEROSPACE_RANGE_LIMITS);
const AEROSPACE_RANGE_COLUMNS: readonly RangeColumn[] = [
    { key: 'short', label: 'SRV', caption: AEROSPACE_RANGE_CAPTIONS[0] },
    { key: 'medium', label: 'MRV', caption: AEROSPACE_RANGE_CAPTIONS[1] },
    { key: 'long', label: 'LRV', caption: AEROSPACE_RANGE_CAPTIONS[2] },
    { key: 'extreme', label: 'ERV', caption: AEROSPACE_RANGE_CAPTIONS[3] },
];
const WEAPON_TARGET_CHOICE_OVERLAY_KEY = 'weapon-equipment-target-choice';

type InventoryRangeDisplayKey = 'short' | 'medium' | 'long' | 'extreme';
type EquipmentPanelGroupId = 'ranged' | 'physical' | 'equipment';

interface EquipmentPanelAmmoOption {
    readonly id: string;
    readonly munitionKey: string;
    readonly sourceIds: readonly ComponentId[];
    readonly label: string;
    readonly remaining: number;
    readonly total: number;
    readonly destroyed?: boolean;
    readonly disabled?: boolean;
}

interface EquipmentPanelDisplay {
    readonly name: string;
    readonly location: string;
    readonly heat: string;
    readonly damage: string;
    readonly hit: string;
    readonly min: string;
    readonly short: string;
    readonly medium: string;
    readonly long: string;
}

interface EquipmentPanelModifier {
    readonly name: string;
    readonly status?: 'destroyed' | 'disabled' | 'warning';
}

interface SelectedHeatProjection {
    current: number;
    base: number;
    sources: number;
    selection: number;
    pending: number;
    dissipation: number;
    final: number;
    pendingWidth: number;
    dissipationWidth: number;
    retainedWidth: number;
}

interface TargetNumberBreakdown {
    total: number;
    lines: TooltipLine[];
}

interface SectionSkillDisplay {
    label: 'Gunnery' | 'Piloting';
    value: string;
}

interface TargetRowState {
    target: TargetingTarget | null;
    invalidTarget: boolean;
    invalidTargetReason?: 'type' | 'out-of-range';
    rangeSelection: InventoryTargetRangeSelection | null;
    hitText: string;
    hitModifierTooltip: TooltipLine[] | null;
    hitModifierWeakened: boolean;
    damageText: string;
    targetNumberText: string;
    targetNumberTooltip: TooltipLine[] | null;
    breakdown: TargetNumberBreakdown | null;
}

interface AmmoRowState {
    hasAmmo: boolean;
    showDropdown: boolean;
    selectedOption: EquipmentPanelAmmoOption | undefined;
    selectedOptionId: string;
    text: string;
    depleted: boolean;
    destroyed: boolean;
    disabled: boolean;
    canDecrease: boolean;
    canIncrease: boolean;
}

interface DragPreviewCellSizing {
    path: number[];
    width: number;
}

interface DragPreviewSizing {
    sourceRow: HTMLElement;
    rowWidth: number;
    gridTemplateColumns: string;
    cells: DragPreviewCellSizing[];
}

/**
 * Presentation rows used by the weapons/equipment panel. Rows contain only
 * entity + runtime facts; no MountedEquipment or SVG-derived
 * value is synthesized for the live Mek path.
 */
interface EquipmentPanelRow {
    readonly kind: 'component' | 'physical';
    readonly component?: EquipmentPanelComponent;
    readonly physical?: MekPhysicalAttackRow;
    readonly id: string;
    /** Index in the immutable Entity/rules projection before presentation sorting. */
    readonly canonicalIndex: number;
    readonly category: EquipmentPanelGroupId;
    readonly tracksAmmo: boolean;
    readonly destroyed: boolean;
    readonly disabled: boolean;
    readonly display: EquipmentPanelDisplay;
    readonly rangePresentation: {
        readonly showMinimum: boolean;
        readonly values: Readonly<Record<InventoryRangeDisplayKey, string>>;
    };
    readonly firingHeat: number | null;
    readonly heatWeakened: boolean;
    readonly modifiers: readonly EquipmentPanelModifier[];
    readonly selectedMode: string | null;
    readonly ammo: {
        readonly tracksAmmo: boolean;
        readonly remaining: number;
        readonly total: number;
        readonly options: readonly EquipmentPanelAmmoOption[];
    };
    readonly extremeRange: number | null;
}

interface EquipmentPanelGroup {
    readonly id: EquipmentPanelGroupId;
    readonly title: string;
    readonly sortable: boolean;
    readonly rows: EquipmentPanelRow[];
}


@Component({
    selector: 'weapons-equipment-panel',
    imports: [DragDropModule, MultilineDropdownComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './weapons-equipment-panel.component.html',
    styleUrl: './weapons-equipment-panel.component.scss'
})
export class WeaponsEquipmentPanelComponent {
    readonly layoutService = inject(LayoutService);
    private readonly overlay = inject(Overlay);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    readonly outOfRangeTooltip: TooltipLine[] = [{ value: 'OUT OF RANGE', isHeader: true }];
    readonly invalidTargetTypeTooltip: TooltipLine[] = [{ value: 'INVALID TARGET', isHeader: true }];
    readonly runtime = input.required<EquipmentDialogRuntimeController>();
    private pendingDragPreviewSizing: DragPreviewSizing | null = null;
    readonly usesAerospaceWeaponValues = computed(() => this.runtime().snapshot().unitType === 'Aero');
    readonly showsGroundExtremeRange = computed(() => !this.usesAerospaceWeaponValues()
        && this.runtime().allowsExtremeRangeAttacks());
    readonly rangeColumns = computed(() => this.usesAerospaceWeaponValues()
        ? AEROSPACE_RANGE_COLUMNS
        : this.showsGroundExtremeRange() ? GROUND_EXTREME_RANGE_COLUMNS : GROUND_RANGE_COLUMNS);
    readonly gunnerySkillDisplay = computed<SectionSkillDisplay>(() => ({
        label: 'Gunnery',
        value: this.runtime().snapshot().crew.gunnery.toString(),
    }));
    readonly pilotingSkillDisplay = computed<SectionSkillDisplay>(() => ({
        label: 'Piloting',
        value: this.runtime().snapshot().crew.piloting.toString(),
    }));
    readonly groups = computed<EquipmentPanelGroup[]>(() => this.buildGroups(this.runtime()));

    sectionSkill(group: EquipmentPanelGroup): SectionSkillDisplay | null {
        if (group.id === 'ranged') return this.gunnerySkillDisplay();
        if (group.id === 'physical') return this.pilotingSkillDisplay();
        return null;
    }

    readonly targets = computed(() => {
        const snapshot = this.runtime().snapshot();
        return snapshot.targets.map(target => projectTargetingTarget(target, snapshot.ruleset));
    });
    readonly hasTargets = computed(() => this.targets().length > 0);
    readonly hasAmmoColumn = computed(() => this.groups().some(group => this.groupTracksAmmo(group)));
    readonly hasControlsColumn = computed(() => this.groups().some(group => this.groupHasControls(group)));
    readonly hasActionsColumn = computed(() => this.groups().some(group => this.groupHasActions(group)));
    readonly tracksHeat = computed(() => this.runtime().snapshot().tracksHeat);
    readonly selectedRows = computed(() => this.groups().flatMap(group => group.rows)
        .filter(row => row.component?.weapon?.selection !== undefined));
    readonly fireInFlight = signal(false);
    readonly selectedHeatTotal = computed(() => this.selectedRows()
        .reduce((total, row) => total + this.heatValue(row), 0));
    readonly selectedHeatProjection = computed<SelectedHeatProjection | null>(() => {
        const projection = this.runtime().selectedHeatProjection();
        return projection ? { ...projection, base: projection.current } : null;
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        });
    }

    private buildGroups(runtime: EquipmentDialogRuntimeController): EquipmentPanelGroup[] {
        const snapshot = runtime.snapshot();
        const ranged = this.groupMachineGunArrayRows(applyEquipmentRowOrder(
            runtime.weapons().map((row, index) => this.componentRow(row, 'ranged', index)),
            snapshot.equipmentRowOrder?.ranged,
        ));
        const physical = applyEquipmentRowOrder(
            snapshot.physicalAttacks.map((row, index) => this.physicalRow(row, index)),
            snapshot.equipmentRowOrder?.physical,
        );
        const equipment = runtime.equipment().map((row, index) => this.componentRow(row, 'equipment', index));
        return [
            { id: 'ranged' as const, title: 'Ranged Weapons', sortable: true, rows: ranged },
            { id: 'physical' as const, title: 'Physical Weapons', sortable: true, rows: physical },
            { id: 'equipment' as const, title: 'Equipment', sortable: false, rows: equipment },
        ].filter(group => group.rows.length > 0);
    }

    private componentRow(
        row: EquipmentPanelComponent,
        category: 'ranged' | 'equipment',
        canonicalIndex: number,
    ): EquipmentPanelRow {
        const weapon = row.weapon;
        const ranges = weapon?.ranges ?? [];
        const toHit = weapon?.toHitModifier ?? row.equipment?.toHitModifier;
        const hit = Array.isArray(toHit)
            ? toHit.map(value => formatInventoryTargetSignedModifier(value)).join('/')
            : typeof toHit === 'number' ? formatInventoryTargetSignedModifier(toHit) : '';
        const ammoOptions = this.ammoOptions(weapon?.ammoSources ?? []);
        const aerospace = weapon?.aerospace;
        const rangeValues = aerospace?.attackValues.map((value, index) =>
            index <= ['short', 'medium', 'long', 'extreme'].indexOf(aerospace.maximumBracket)
                ? value.toString()
                : '—') as readonly string[] | undefined;
        return {
            kind: 'component',
            component: row,
            id: row.componentId,
            canonicalIndex,
            category,
            tracksAmmo: ammoOptions.length > 0,
            destroyed: row.status === 'destroyed',
            disabled: row.status === 'disabled' || (weapon !== undefined && !weapon.selectable),
            display: {
                name: row.label,
                location: this.runtime().locations(row),
                heat: weapon === undefined ? '' : `${weapon.heat}${weapon.heatSuffix ?? ''}`,
                damage: weapon?.damageText ?? '—',
                hit,
                min: aerospace ? '—' : weapon?.minimumRange.toString() ?? '—',
                short: aerospace?.rangeLimits[0].toString() ?? ranges[0]?.toString() ?? '—',
                medium: aerospace?.rangeLimits[1].toString() ?? ranges[1]?.toString() ?? '—',
                long: aerospace?.rangeLimits[2].toString() ?? ranges[2]?.toString() ?? '—',
            },
            rangePresentation: {
                showMinimum: weapon !== undefined && aerospace === undefined,
                values: {
                    short: rangeValues?.[0] ?? ranges[0]?.toString() ?? '—',
                    medium: rangeValues?.[1] ?? ranges[1]?.toString() ?? '—',
                    long: rangeValues?.[2] ?? ranges[2]?.toString() ?? '—',
                    extreme: rangeValues?.[3] ?? ranges[3]?.toString() ?? '—',
                },
            },
            firingHeat: weapon?.firingHeat ?? null,
            heatWeakened: row.heatWeakened === true,
            modifiers: [
                ...(row.modifiers ?? []),
                ...(row.jammed ? [{ name: 'Jammed', status: 'disabled' as const }] : []),
            ],
            selectedMode: row.mode ?? null,
            ammo: {
                tracksAmmo: ammoOptions.length > 0,
                remaining: ammoOptions.reduce((total, option) => total + option.remaining, 0),
                total: ammoOptions.reduce((total, option) => total + option.total, 0),
                options: ammoOptions,
            },
            extremeRange: aerospace
                ? aerospace.rangeLimits[['short', 'medium', 'long', 'extreme'].indexOf(aerospace.maximumBracket)]
                : ranges[3] ?? null,
        };
    }

    private ammoOptions(sources: readonly EquipmentPanelAmmoSource[]): EquipmentPanelAmmoOption[] {
        const groups = new Map<string, EquipmentPanelAmmoSource[]>();
        for (const source of sources) {
            const key = `${source.munitionKey}\u0000${source.location}\u0000${source.label}`;
            const group = groups.get(key);
            if (group) group.push(source);
            else groups.set(key, [source]);
        }
        const entries = [...groups.values()];
        const locationsByName = new Map<string, Set<string>>();
        for (const group of entries) {
            const first = group[0]!;
            const locations = locationsByName.get(first.label) ?? new Set<string>();
            locations.add(first.location);
            locationsByName.set(first.label, locations);
        }
        return entries.map(group => {
            const first = group[0]!;
            const available = group.filter(source => source.status === 'available');
            const preferred = available.find(source => source.remaining > 0) ?? available[0] ?? first;
            const remaining = group.reduce((total, source) => total + source.remaining, 0);
            const total = group.reduce((sum, source) => sum + source.capacity, 0);
            return {
                id: `${preferred.componentId}\u0000${first.munitionKey}`,
                munitionKey: first.munitionKey,
                sourceIds: Object.freeze(group.map(source => source.componentId)),
                label: `${(locationsByName.get(first.label)?.size ?? 0) > 1 && first.location
                    ? `[${first.location}] `
                    : ''}${first.label} (${remaining}/${total})`,
                remaining,
                total,
                destroyed: group.every(source => source.status === 'destroyed'),
                disabled: group.every(source => source.status !== 'available'),
            };
        });
    }

    private physicalRow(row: MekPhysicalAttackRow, canonicalIndex: number): EquipmentPanelRow {
        return {
            kind: 'physical',
            physical: row,
            id: `physical:${row.target.kind === 'component'
                ? row.target.componentId
                : row.target.actionId}`,
            canonicalIndex,
            category: 'physical',
            tracksAmmo: false,
            destroyed: false,
            disabled: !row.available,
            display: {
                name: row.label,
                location: row.locationCodes.join(', ') || '—',
                heat: row.firingHeat > 0 ? String(row.firingHeat) : '—',
                damage: this.runtime().physicalDamage(row),
                hit: row.hitModifiers.map(formatPhysicalHitModifier).join('/'),
                min: '—',
                short: '—',
                medium: '—',
                long: '—',
            },
            rangePresentation: {
                showMinimum: false,
                values: { short: '—', medium: '—', long: '—', extreme: '—' },
            },
            firingHeat: null,
            heatWeakened: false,
            modifiers: [],
            selectedMode: null,
            ammo: { tracksAmmo: false, remaining: 0, total: 0, options: [] },
            extremeRange: null,
        };
    }

    onRowTargetSelectorClick(event: MouseEvent, row: EquipmentPanelRow): void {
        event.stopPropagation();
        if (this.readOnly()) return;
        if (!row.component?.weapon && !row.physical) return;
        const selectedTargetId = this.selectedTargetId(row);
        this.openTargetChoiceOverlay(
            event.currentTarget as HTMLElement,
            selectedTargetId,
            targetId => {
                const target = targetId ? this.targets().find(candidate => candidate.id === targetId) : null;
                if (target && this.targetDisabledReason(row, target) !== null) return;
                if (row.physical) void this.runtime().selectPhysicalTarget(row.physical, targetId ?? '');
                else void this.runtime().selectTarget(row.component!, targetId ?? '');
            },
            this.targetChoiceTargetNumberTexts(row),
            this.targetChoiceDisabledReasons([row]),
        );
    }

    groupTargetSelection(group: EquipmentPanelGroup): TargetingTarget | null {
        const rows = this.groupActiveSelectableRows(group);
        if (rows.length === 0) return null;
        const first = this.selectedTargetId(rows[0]);
        if (!first || !rows.every(row => this.selectedTargetId(row) === first)) return null;
        return this.targets().find(target => target.id === first) ?? null;
    }

    groupSomeTargetRowsSelected(group: EquipmentPanelGroup): boolean {
        const rows = this.groupActiveSelectableRows(group);
        const selectedCount = rows.filter(row => this.selectedTargetId(row) !== null).length;
        return selectedCount > 0 && selectedCount < rows.length;
    }

    onGroupTargetSelectorClick(event: MouseEvent, group: EquipmentPanelGroup): void {
        event.stopPropagation();
        if (this.readOnly()) return;
        if (group.id !== 'ranged') return;
        const targets = this.targets();
        if (targets.length === 0) return;
        if (targets.length === 1) {
            const target = targets[0];
            const targetId = target.id;
            const selected = this.groupTargetSelection(group)?.id === targetId;
            const rows = this.groupActiveSelectableRows(group);
            if (!selected && rows.some(row => this.targetDisabledReason(row, target) !== null)) {
                this.openTargetChoiceOverlay(
                    event.currentTarget as HTMLElement,
                    null,
                    targetId => this.setGroupTarget(group, targetId),
                    {},
                    this.targetChoiceDisabledReasons(rows),
                );
                return;
            }
            this.setGroupTarget(group, selected ? null : targetId);
            return;
        }

        const rows = this.groupActiveSelectableRows(group);
        this.openTargetChoiceOverlay(
            event.currentTarget as HTMLElement,
            this.groupTargetSelection(group)?.id ?? null,
            targetId => this.setGroupTarget(group, targetId),
            {},
            this.targetChoiceDisabledReasons(rows),
        );
    }

    private setGroupTarget(group: EquipmentPanelGroup, targetId: EncounterTargetId | null): void {
        const rows = targetId ? this.groupActiveSelectableRows(group) : this.groupSelectableRows(group);
        const target = targetId ? this.targets().find(candidate => candidate.id === targetId) : null;
        if (target && rows.some(row => this.targetDisabledReason(row, target) !== null)) return;
        for (const row of rows) {
            if (row.component?.weapon) void this.runtime().selectTarget(row.component, targetId ?? '');
        }
    }

    private openTargetChoiceOverlay(
        anchor: HTMLElement,
        selectedTargetId: EncounterTargetId | null,
        onSelect: (targetId: EncounterTargetId | null) => void,
        targetNumberTexts: Readonly<Record<EncounterTargetId, string>> = {},
        disabledTargetReasons: Readonly<Record<EncounterTargetId, string>> = {},
    ): void {
        this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        const portal = new ComponentPortal(WeaponTargetChoiceMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY, anchor, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-target-choice-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
                { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        componentRef.setInput('targets', this.targets());
        componentRef.setInput('selectedTargetId', selectedTargetId);
        componentRef.setInput('targetNumberTexts', targetNumberTexts);
        componentRef.setInput('disabledTargetReasons', disabledTargetReasons);
        componentRef.changeDetectorRef.detectChanges();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            onSelect(targetId);
            this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        });
    }

    groupTracksAmmo(group: EquipmentPanelGroup): boolean {
        return group.rows.some(row => this.showAmmoControls(row));
    }

    groupHasControls(group: EquipmentPanelGroup): boolean {
        return group.rows.some(row => this.rowHasControls(row));
    }

    groupHasActions(group: EquipmentPanelGroup): boolean {
        return group.rows.some(row => this.rowHasActions(row));
    }

    groupActionsHeader(group: EquipmentPanelGroup): string {
        const hasAmmo = this.groupTracksAmmo(group);
        const hasControls = this.groupHasControls(group);
        if (hasAmmo && hasControls) return 'Ammo & Controls';
        if (hasAmmo) return 'Ammo';
        if (hasControls) return 'Controls';
        return '';
    }

    rowHasControls(row: EquipmentPanelRow): boolean {
        return this.handlerChoices(row).length > 0 || this.canMarkDestroyed(row) || this.canRepair(row);
    }

    rowHasActions(row: EquipmentPanelRow): boolean {
        return this.showAmmoControls(row) || this.rowHasControls(row);
    }

    readOnly(): boolean {
        return this.runtime().member.force.readOnly();
    }

    isSelectable(row: EquipmentPanelRow): boolean {
        if (this.isMachineGunArrayRow(row) || this.isMachineGunArrayMemberRow(row)) {
            return row.component?.bay?.canFire === true;
        }
        return row.component?.weapon !== undefined || row.physical !== undefined;
    }

    isMachineGunArrayRow(row: EquipmentPanelRow): boolean {
        const bay = row.component?.bay;
        return bay?.relation.kind === 'machine-gun-array' && bay.role === 'controller';
    }

    isMachineGunArrayMemberRow(row: EquipmentPanelRow): boolean {
        const bay = row.component?.bay;
        return bay?.relation.kind === 'machine-gun-array' && bay.role === 'member';
    }

    isMachineGunArrayMemberControlled(row: EquipmentPanelRow): boolean {
        const bay = row.component?.bay;
        return this.isMachineGunArrayMemberRow(row)
            && bay?.controllerStatus === 'available'
            && bay.controllerMode === 'Linked';
    }

    machineGunArraySummary(row: EquipmentPanelRow): string | null {
        const bay = row.component?.bay;
        if (!this.isMachineGunArrayRow(row) || !bay) return null;
        const installed = bay.relation.memberIds.length;
        const working = bay.operationalMemberIds.length;
        const guns = working === installed
            ? `${working} gun${working === 1 ? '' : 's'}`
            : `${working}/${installed} guns`;
        if (bay.controllerStatus !== 'available' || bay.controllerMode !== 'Linked') {
            return `${guns} · Individual fire`;
        }
        if (working === 0) return 'No working guns';
        const modifier = machineGunArrayClusterModifier(this.runtime().snapshot().ruleset);
        const cluster = modifier === 0 ? 'Cluster roll' : `Cluster +${modifier}`;
        return `${guns} · ${working} ammo/attack · ${cluster}`;
    }

    machineGunArrayMemberSummary(row: EquipmentPanelRow): string | null {
        const bay = row.component?.bay;
        if (!this.isMachineGunArrayMemberRow(row) || !bay) return null;
        const member = bay.members.find(candidate => candidate.componentId === row.id);
        if (member?.operational !== true) return 'Excluded from array';
        return this.isMachineGunArrayMemberControlled(row) ? 'Linked' : 'Unlinked';
    }

    showAmmoControls(row: EquipmentPanelRow): boolean {
        if (!row.tracksAmmo) return false;
        if (this.isMachineGunArrayMemberRow(row)) return !this.isMachineGunArrayMemberControlled(row);
        if (!this.isMachineGunArrayRow(row)) return true;
        const bay = row.component?.bay;
        return bay?.controllerStatus === 'available'
            && bay.controllerMode === 'Linked'
            && bay.operationalMemberIds.length > 0;
    }

    isRowSortable(group: EquipmentPanelGroup, row: EquipmentPanelRow): boolean {
        return group.sortable && !this.isMachineGunArrayMemberRow(row);
    }

    isSelected(row: EquipmentPanelRow): boolean {
        return row.component?.weapon?.selection !== undefined
            || row.physical?.selection !== undefined;
    }

    toggleSelected(row: EquipmentPanelRow): void {
        if (this.readOnly()) return;
        const selected = this.isSelected(row);
        if (!selected && (row.disabled || row.destroyed)) return;
        if (row.component?.weapon) {
            void this.runtime().selectTarget(row.component, selected ? '' : 'selected');
        } else if (row.physical) {
            void this.runtime().selectPhysicalTarget(row.physical, selected ? '' : 'selected');
        }
    }

    groupAllSelectableRowsSelected(group: EquipmentPanelGroup): boolean {
        const rows = this.groupActiveSelectableRows(group);
        if (rows.length > 0) return rows.every(row => this.isSelected(row));
        return this.groupSelectableRows(group).some(row => this.isSelected(row));
    }

    groupSomeSelectableRowsSelected(group: EquipmentPanelGroup): boolean {
        const rows = this.groupSelectableRows(group);
        return rows.some(row => this.isSelected(row)) && !this.groupAllSelectableRowsSelected(group);
    }

    toggleGroupSelectableRows(group: EquipmentPanelGroup): void {
        if (this.readOnly() || group.id !== 'ranged') return;
        const selected = !this.groupAllSelectableRowsSelected(group);
        const rows = selected ? this.groupActiveSelectableRows(group) : this.groupSelectableRows(group);
        rows.forEach(row => {
            if (row.component?.weapon) void this.runtime().selectTarget(row.component, selected ? 'selected' : '');
        });
    }

    resetSelections(): void {
        void this.runtime().resetSelections();
    }

    hasSelectedRows(): boolean {
        return this.runtime().hasSelections();
    }

    canSelectRange(row: EquipmentPanelRow, range: InventoryRangeDisplayKey, state = this.targetState(row)): boolean {
        if (state.target || row.disabled || row.destroyed) return false;
        if (range === 'extreme' && !this.usesAerospaceWeaponValues() && !this.showsGroundExtremeRange()) return false;
        const value = this.rangeValue(row, range);
        return this.isSelectable(row) && value !== '—';
    }

    selectRange(row: EquipmentPanelRow, range: InventoryRangeDisplayKey): void {
        if (!this.canSelectRange(row, range)) return;
        if (row.component?.weapon) {
            const selected = this.runtime().selectedTarget(row.component) === `range:${range}`;
            void this.runtime().selectTarget(row.component, selected ? '' : `range:${range}`);
        }
    }

    isRangeSelected(row: EquipmentPanelRow, range: InventoryRangeDisplayKey, state = this.targetState(row)): boolean {
        if (row.category === 'physical') return false;
        const targetRange = state.rangeSelection;
        if (targetRange) {
            return !targetRange.outOfRange && targetRange.range === range;
        }
        return this.runtime().selectedTarget(row.component!) === `range:${range}`;
    }

    rangeValue(row: EquipmentPanelRow, range: InventoryRangeDisplayKey): string {
        if (range === 'extreme' && !this.usesAerospaceWeaponValues()) {
            return row.extremeRange?.toString() ?? '—';
        }
        return row.rangePresentation.values[range];
    }

    private targetChoiceTargetNumberTexts(row: EquipmentPanelRow): Readonly<Record<EncounterTargetId, string>> {
        return Object.fromEntries(this.targets()
            .map(target => [target.id, this.targetNumberTextForTarget(row, target)] as const)
            .filter(([, targetNumber]) => targetNumber !== ''));
    }

    private targetNumberTextForTarget(row: EquipmentPanelRow, target: TargetingTarget | null): string {
        return this.createTargetState(row, target).targetNumberText;
    }

    private targetChoiceDisabledReasons(
        rows: readonly EquipmentPanelRow[],
    ): Readonly<Record<EncounterTargetId, string>> {
        const reasons: Record<EncounterTargetId, string> = {};
        for (const target of this.targets()) {
            const reason = rows
                .map(row => this.targetDisabledReason(row, target))
                .find((value): value is string => value !== null);
            if (reason) reasons[target.id] = reason;
        }
        return reasons;
    }

    private targetDisabledReason(
        row: EquipmentPanelRow,
        target: TargetingTarget,
    ): string | null {
        return row.component?.weapon?.disabledTargetReasons[target.id] ?? null;
    }

    targetState(row: EquipmentPanelRow): TargetRowState {
        const targetId = this.selectedTargetId(row);
        const target = targetId ? this.targets().find(candidate => candidate.id === targetId) ?? null : null;
        return this.createTargetState(row, target);
    }

    ammoState(row: EquipmentPanelRow): AmmoRowState {
        const selectedValue = row.component ? this.runtime().selectedAmmo(row.component) : '';
        const separator = selectedValue.indexOf('\u0000');
        const selectedSourceId = separator < 0 ? '' : selectedValue.slice(0, separator);
        const selectedMunitionKey = separator < 0 ? '' : selectedValue.slice(separator + 1);
        const selectedProfileOptions = selectedMunitionKey === ''
            ? []
            : row.ammo.options.filter(option => option.munitionKey === selectedMunitionKey);
        const selectedOption = selectedMunitionKey === ''
            ? row.ammo.options.find(option => !option.disabled && option.remaining > 0)
                ?? row.ammo.options.find(option => !option.disabled)
                ?? row.ammo.options[0]
            : selectedProfileOptions.find(option =>
                option.sourceIds.some(sourceId => sourceId === selectedSourceId))
                ?? selectedProfileOptions.find(option => !option.disabled && option.remaining > 0)
                ?? selectedProfileOptions.find(option => !option.disabled)
                ?? selectedProfileOptions[0];
        const hasAmmo = row.tracksAmmo && row.ammo.options.some(option => !option.disabled && option.remaining > 0);
        return {
            hasAmmo,
            showDropdown: row.ammo.options.length > 1 && hasAmmo,
            selectedOption,
            selectedOptionId: selectedOption?.id ?? '',
            text: hasAmmo ? selectedOption?.label ?? '' : '',
            depleted: selectedOption ? selectedOption.remaining <= 0 : true,
            destroyed: selectedOption?.destroyed ?? false,
            disabled: selectedOption?.disabled === true && selectedOption.destroyed !== true,
            canDecrease: !this.readOnly() && hasAmmo && selectedOption !== undefined
                && !selectedOption.disabled && selectedOption.remaining > 0,
            canIncrease: !this.readOnly() && hasAmmo && selectedOption !== undefined
                && !selectedOption.disabled && selectedOption.remaining < selectedOption.total,
        };
    }

    ammoDropdownOptions(row: EquipmentPanelRow): MultilineDropdownOption[] {
        return row.ammo.options.map(option => ({
            value: option.id,
            label: option.label,
            trailingLabel: `(${option.remaining}/${option.total})`,
            disabled: option.disabled,
            destroyed: option.destroyed,
        }));
    }

    selectAmmoOption(row: EquipmentPanelRow, value: string): void {
        if (row.component?.weapon) void this.runtime().selectWeaponAmmo(row.component, value);
    }

    adjustAmmo(row: EquipmentPanelRow, delta: number): void {
        const state = this.ammoState(row);
        if (delta > 0 && !state.canDecrease) return;
        if (delta < 0 && !state.canIncrease) return;
        if (delta === 0) return;
        const option = state.selectedOption;
        if (!option) return;
        const currentSources = this.runtime().ammo().filter(candidate =>
            option.sourceIds.includes(candidate.componentId));
        const selectedValue = row.component ? this.runtime().selectedAmmo(row.component) : '';
        const selectedSourceId = selectedValue.split('\u0000', 1)[0];
        const ordered = [...currentSources].sort((left, right) =>
            left.componentId === selectedSourceId ? -1 : right.componentId === selectedSourceId ? 1 : 0);
        const source = delta > 0
            ? ordered.find(candidate => candidate.status === 'available' && (candidate.ammo?.remaining ?? 0) > 0)
            : ordered.find(candidate => candidate.status === 'available'
                && candidate.ammo !== undefined
                && candidate.ammo.remaining < candidate.ammo.capacity);
        if (source?.ammo) {
            void this.runtime().configureAmmo(source, source.ammo.munitionKey, source.ammo.remaining - delta);
        }
    }

    async consumeSelectedHeatAndAmmo(): Promise<void> {
        if (this.readOnly() || this.fireInFlight()) return;
        this.fireInFlight.set(true);
        try {
            await this.runtime().fire();
        } finally {
            this.fireInFlight.set(false);
        }
    }

    private createTargetState(
        row: EquipmentPanelRow,
        target: TargetingTarget | null,
    ): TargetRowState {
        if (row.physical) return this.createPhysicalTargetState(row, target);
        if (!row.component?.weapon) {
            return {
                target: null,
                invalidTarget: false,
                rangeSelection: null,
                hitText: row.display.hit,
                hitModifierTooltip: null,
                hitModifierWeakened: false,
                damageText: row.display.damage,
                targetNumberText: '',
                targetNumberTooltip: null,
                breakdown: null,
            };
        }
        const component = row.component!;
        const targetDisabledReason = target === null ? null : this.targetDisabledReason(row, target);
        const presentation = projectWeaponTargetPresentation(
            component,
            target,
            this.runtime().snapshot().crew.gunnery,
            this.runtime().attackerMovementMode(),
            this.runtime().snapshot().ruleset,
            {
                pilotingSkill: this.runtime().snapshot().crew.piloting,
                allowExtremeRange: this.runtime().allowsExtremeRangeAttacks(),
                missingMovementModifier: this.runtime().missingAttackMovementModifier(),
                attackModifierBreakdown: this.runtime().attackModifierBreakdown(),
                c3Available: this.runtime().c3Available(),
                c3DegradationSource: this.runtime().c3DegradationSource(),
            },
        );
        const attackModifierBreakdown = this.runtime().attackModifierBreakdown();
        const hitResolution = presentation.hitResolution;
        if (hitResolution === null) {
            throw new Error(`Weapon ${component.componentId} has no hit resolution`);
        }
        const hitModifierTooltip = this.hitModifierTooltip(hitResolution, attackModifierBreakdown);
        const invalidTarget = targetDisabledReason !== null || presentation.outOfRange;
        const breakdown = presentation.targetNumberBreakdown === null
            ? null
            : {
                total: presentation.targetNumberBreakdown.total,
                lines: [...presentation.targetNumberBreakdown.lines],
            };
        return {
            target,
            invalidTarget,
            ...(targetDisabledReason !== null
                ? { invalidTargetReason: 'type' as const }
                : presentation.outOfRange ? { invalidTargetReason: 'out-of-range' as const } : {}),
            rangeSelection: presentation.rangeSelection,
            hitText: presentation.hitText,
            hitModifierTooltip,
            hitModifierWeakened: hitResolution.weakened
                || attackModifierBreakdown.some(modifier => modifier.weakened === true),
            damageText: presentation.damageText,
            targetNumberText: invalidTarget ? 'X' : presentation.targetNumberText,
            targetNumberTooltip: this.targetNumberTooltip(row, hitResolution, breakdown),
            breakdown,
        };
    }

    private createPhysicalTargetState(
        row: EquipmentPanelRow,
        target: TargetingTarget | null,
    ): TargetRowState {
        const modifier = row.physical?.hitModifiers[0];
        const numericModifier = typeof modifier === 'number' ? modifier : 0;
        const piloting = this.runtime().snapshot().crew.piloting;
        const targetModifier = target?.tnModifier ?? 0;
        const attackModifierBreakdown = this.runtime().attackModifierBreakdown();
        const attackModifier = attackModifierBreakdown.reduce((total, item) => total + item.modifier, 0);
        const physicalBreakdown = row.physical!.hitModifierBreakdown;
        const hitModifierTooltip = this.modifierTooltip([
            ...attackModifierBreakdown,
            ...physicalBreakdown,
        ]);
        const tooltip: TooltipLine[] | null = target === null ? null : [
            { label: 'Piloting', value: String(piloting), priority: SKILL_BREAKDOWN_PRIORITY },
            ...orderedModifierTooltipLines(
                [...attackModifierBreakdown, ...physicalBreakdown],
                item => formatInventoryTargetSignedModifier(item.modifier),
            ),
            ...(targetModifier === 0 ? [] : [{
                label: 'Target',
                value: formatInventoryTargetSignedModifier(targetModifier),
            }]),
        ];
        return {
            target,
            invalidTarget: false,
            rangeSelection: null,
            hitText: typeof modifier === 'number'
                ? formatInventoryTargetSignedModifier(numericModifier + attackModifier)
                : modifier === 'versus' && attackModifier !== 0
                    ? `Vs${formatInventoryTargetSignedModifier(attackModifier)}`
                    : row.display.hit,
            hitModifierTooltip,
            hitModifierWeakened: row.physical!.hitModifierBreakdown.some(item => item.weakened === true),
            damageText: row.display.damage,
            targetNumberText: target === null
                ? ''
                : typeof modifier === 'number'
                    ? String(piloting + numericModifier + attackModifier + targetModifier)
                    : formatPhysicalHitModifier(modifier),
            targetNumberTooltip: tooltip,
            breakdown: null,
        };
    }

    private hitModifierTooltip(
        resolution: ToHitResolution,
        attackModifierBreakdown: readonly UnitModifierBreakdownEntry[],
    ): TooltipLine[] | null {
        const modifiers = [...attackModifierBreakdown, ...resolution.modifierBreakdown];
        const lines = this.modifierTooltip(modifiers);
        if (lines === null || lines.length <= 1) return lines;
        const modifier = modifiers.reduce((total, entry) => total + entry.modifier, 0);
        if (resolution.value === 'Vs') {
            return [
                ...lines,
                { isBreak: true },
                { label: 'Total', value: `VS${formatInventoryTargetSignedModifier(modifier)}`, isHeader: true },
            ];
        }
        if (typeof resolution.value !== 'number') return lines;
        return [
            ...lines,
            { isBreak: true },
            { label: 'Total', value: formatInventoryTargetSignedModifier(modifier), isHeader: true },
        ];
    }

    private modifierTooltip(
        modifiers: readonly UnitModifierBreakdownEntry[],
    ): TooltipLine[] | null {
        if (modifiers.length === 0) return null;
        return orderedModifierTooltipLines(
            modifiers,
            entry => formatInventoryTargetSignedModifier(entry.modifier),
        );
    }

    private targetNumberTooltip(
        row: EquipmentPanelRow,
        resolution: ToHitResolution,
        breakdown: TargetNumberBreakdown | null,
    ): TooltipLine[] | null {
        if (resolution.value !== 'Vs') return breakdown?.lines ?? null;
        if (resolution.modifierBreakdown.length === 0) return null;
        const modifier = resolution.modifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
        const total = modifier === 0 ? 'Vs' : `Vs${formatInventoryTargetSignedModifier(modifier)}`;
        return [
            { label: row.display.name, value: 'Vs', priority: SKILL_BREAKDOWN_PRIORITY },
            ...orderedModifierTooltipLines(
                resolution.modifierBreakdown,
                entry => formatInventoryTargetSignedModifier(entry.modifier),
            ),
            { isBreak: true },
            { label: 'Total', value: total, isHeader: true },
        ];
    }

    private selectedTargetId(row: EquipmentPanelRow): EncounterTargetId | null {
        const selection = row.component?.weapon?.selection ?? row.physical?.selection;
        return selection?.kind === 'target' ? selection.targetId : null;
    }

    private heatValue(row: EquipmentPanelRow): number {
        return row.firingHeat ?? 0;
    }

    private groupSelectableRows(group: EquipmentPanelGroup): EquipmentPanelRow[] {
        return group.rows.filter(row => this.isSelectable(row));
    }

    private groupActiveSelectableRows(group: EquipmentPanelGroup): EquipmentPanelRow[] {
        return this.groupSelectableRows(group).filter(row => !row.destroyed && !row.disabled);
    }

    private groupMachineGunArrayRows(rows: EquipmentPanelRow[]): EquipmentPanelRow[] {
        const rowsById = new Map(rows.map(row => [row.id, row]));
        const nestedMembers = new Set(rows
            .filter(row => this.isMachineGunArrayMemberRow(row)
                && row.component?.bay?.relation.controllerId !== undefined
                && rowsById.has(row.component.bay.relation.controllerId))
            .map(row => row.id));
        const grouped: EquipmentPanelRow[] = [];
        for (const row of rows) {
            if (nestedMembers.has(row.id)) continue;
            grouped.push(row);
            if (!this.isMachineGunArrayRow(row)) continue;
            for (const memberId of row.component!.bay!.relation.memberIds) {
                const member = rowsById.get(memberId);
                if (member) grouped.push(member);
            }
        }
        return grouped;
    }

    cacheDragPreviewCellWidths(event: PointerEvent): void {
        const sourceRow = event.currentTarget;
        if (!(sourceRow instanceof HTMLElement)) return;
        this.pendingDragPreviewSizing = this.measureDragPreviewSizing(sourceRow);
    }

    onDragStarted(event: CdkDragStart): void {
        const sourceRow = event.source.getRootElement();
        const sizing = this.pendingDragPreviewSizing?.sourceRow === sourceRow
            ? this.pendingDragPreviewSizing
            : this.measureDragPreviewSizing(sourceRow);
        this.pendingDragPreviewSizing = null;
        this.lockDragPreviewCellWidths(sourceRow, sizing);
    }

    private measureDragPreviewSizing(sourceRow: HTMLElement): DragPreviewSizing | null {
        const cells = this.measureDragPreviewCells(sourceRow);
        if (cells.length === 0) return null;
        const sourceRowStyle = getComputedStyle(sourceRow);
        return {
            sourceRow,
            rowWidth: sourceRow.getBoundingClientRect().width,
            gridTemplateColumns: this.dragPreviewGridTemplateColumns(sourceRow, sourceRowStyle),
            cells
        };
    }

    private dragPreviewGridTemplateColumns(sourceRow: HTMLElement, sourceRowStyle: CSSStyleDeclaration): string {
        const sourceColumns = sourceRowStyle.gridTemplateColumns;
        if (sourceColumns && sourceColumns !== 'none' && !sourceColumns.includes('subgrid')) return sourceColumns;

        const contentColumns = sourceRowStyle.getPropertyValue('--weapon-equipment-content-columns').trim();
        if (!contentColumns) return sourceColumns;

        return [
            this.measuredTrackWidth(sourceRow, '.grid-fill-left'),
            contentColumns,
            this.measuredTrackWidth(sourceRow, '.grid-fill-right')
        ].join(' ');
    }

    private measuredTrackWidth(sourceRow: HTMLElement, selector: string): string {
        const element = sourceRow.querySelector<HTMLElement>(selector);
        const width = element?.getBoundingClientRect().width ?? 0;
        return `${Math.max(0, width)}px`;
    }

    private measureDragPreviewCells(parent: HTMLElement, parentPath: number[] = []): DragPreviewCellSizing[] {
        return Array.from(parent.children).flatMap((child, index) => {
            if (!(child instanceof HTMLElement)) return [];
            const path = [...parentPath, index];
            if (getComputedStyle(child).display === 'contents') {
                return this.measureDragPreviewCells(child, path);
            }
            const width = child.getBoundingClientRect().width;
            return Number.isFinite(width) && width > 0 ? [{ path, width }] : [];
        });
    }

    private lockDragPreviewCellWidths(sourceRow: HTMLElement, sizing: DragPreviewSizing | null): void {
        if (!sizing) return;

        const applyWidth = () => {
            const previewRow = this.findDragPreviewRow(sourceRow);
            if (!previewRow) return false;
            if (Number.isFinite(sizing.rowWidth) && sizing.rowWidth > 0) {
                const fixedRowWidth = `${sizing.rowWidth}px`;
                previewRow.style.width = fixedRowWidth;
                previewRow.style.minWidth = fixedRowWidth;
                previewRow.style.maxWidth = fixedRowWidth;
            }
            if (sizing.gridTemplateColumns && sizing.gridTemplateColumns !== 'none') {
                previewRow.style.gridTemplateColumns = sizing.gridTemplateColumns;
            }
            let appliedAnyCell = false;
            for (const cell of sizing.cells) {
                const previewCell = this.elementAtPath(previewRow, cell.path);
                if (!previewCell) continue;
                const fixedWidth = `${cell.width}px`;
                previewCell.style.width = fixedWidth;
                previewCell.style.minWidth = fixedWidth;
                previewCell.style.maxWidth = fixedWidth;
                previewCell.style.flexBasis = fixedWidth;
                appliedAnyCell = true;
            }
            return appliedAnyCell;
        };

        if (!applyWidth()) {
            queueMicrotask(applyWidth);
            requestAnimationFrame(applyWidth);
        }
    }

    private elementAtPath(root: HTMLElement, path: number[]): HTMLElement | null {
        let current: Element = root;
        for (const index of path) {
            const child = current.children.item(index);
            if (!(child instanceof HTMLElement)) return null;
            current = child;
        }
        return current instanceof HTMLElement ? current : null;
    }

    private findDragPreviewRow(sourceRow: HTMLElement): HTMLElement | null {
        const container = sourceRow.parentElement;
        if (!container) return null;
        const previews = Array.from(container.querySelectorAll<HTMLElement>('.weapon-equipment-row.cdk-drag-preview'));
        return previews.find(preview => preview !== sourceRow) ?? null;
    }

    drop(event: CdkDragDrop<EquipmentPanelRow[]>, group: EquipmentPanelGroup): void {
        if (group.id === 'equipment' || !group.sortable || this.readOnly()
            || event.previousIndex === event.currentIndex) return;
        const rows = [...group.rows];
        moveItemInArray(rows, event.previousIndex, event.currentIndex);
        void this.runtime().reorderEquipmentRows(
            group.id,
            rows.map(row => row.canonicalIndex),
        );
    }

    handlerChoices(row: EquipmentPanelRow): readonly EquipmentDialogChoice[] {
        return this.getHandlerChoices(row)
            .filter(choice => !this.isModeChoice(choice));
    }

    isEscalatingFailureSequenceChoice(choice: EquipmentDialogChoice): boolean {
        return choice.interactionKind === 'escalating-failure' && choice.failureTarget !== undefined;
    }

    modeChoice(row: EquipmentPanelRow): EquipmentDialogChoice | undefined {
        return this.getHandlerChoices(row)
            .find(choice => this.isModeChoice(choice));
    }

    modeText(row: EquipmentPanelRow, choice: EquipmentDialogChoice): string {
        const option = choice.choices?.find(candidate => candidate.value === choice.value);
        if (option) return option.label;
        return row.component?.mode ?? String(choice.value);
    }

    handlerDropdownOptions(choice: EquipmentDialogChoice): MultilineDropdownOption[] {
        return choice.choices?.map(option => ({
            value: String(option.value),
            label: option.label,
            disabled: option.disabled
        })) ?? [];
    }

    handlerDropdownValue(choice: EquipmentDialogChoice): string {
        return String(choice.value);
    }

    async selectHandlerDropdown(row: EquipmentPanelRow, choice: EquipmentDialogChoice, value: string): Promise<void> {
        const option = choice.choices?.find(candidate => String(candidate.value) === value);
        if (!option) return;
        await this.handleChoice(row, {
            ...choice,
            value: option.value,
            label: option.label,
            command: option.command,
            disabled: option.disabled,
        });
    }

    async handleChoice(row: EquipmentPanelRow, choice: EquipmentDialogChoice): Promise<void> {
        if (this.readOnly() || choice.disabled) return;
        const interaction = row.component ? this.runtime().interaction(row.component) : undefined;
        if (interaction && choice.command) {
            await this.runtime().chooseInteraction(interaction, choice.command);
        }
    }

    private getHandlerChoices(row: EquipmentPanelRow): readonly EquipmentDialogChoice[] {
        const interaction = row.component ? this.runtime().interaction(row.component) : undefined;
        const choices = interaction?.choices ?? [];
        const result: EquipmentDialogChoice[] = [];
        const emittedDropdowns = new Set<string>();
        for (const choice of choices) {
            if (choice.displayType === 'dropdown') {
                const groupKey = `${choice.command.handlerId}\0${choice.groupLabel ?? choice.label}`;
                if (emittedDropdowns.has(groupKey)) continue;
                emittedDropdowns.add(groupKey);
                const options = choices.filter(candidate => candidate.displayType === 'dropdown'
                    && candidate.command.handlerId === choice.command.handlerId
                    && (candidate.groupLabel ?? candidate.label) === (choice.groupLabel ?? choice.label));
                const selected = options.find(candidate => candidate.active) ?? options[0];
                if (!selected) continue;
                result.push({
                    command: selected.command,
                    interactionKind: choice.interactionKind,
                    label: choice.groupLabel ?? choice.label,
                    value: selected.command.value,
                    active: options.some(candidate => candidate.active),
                    disabled: options.every(candidate => candidate.disabled),
                    displayType: 'dropdown',
                    ...(choice.selectionTone === undefined ? {} : { selectionTone: choice.selectionTone }),
                    ...(choice.colors === undefined ? {} : { colors: choice.colors }),
                    ...(choice.keepOpen === undefined ? {} : { keepOpen: choice.keepOpen }),
                    ...(choice.tooltipType === undefined ? {} : { tooltipType: choice.tooltipType }),
                    ...(choice.failureTarget === undefined ? {} : { failureTarget: choice.failureTarget }),
                    choices: options.map(option => ({
                        label: option.shortLabel ?? option.label,
                        value: option.command.value,
                        command: option.command,
                        disabled: option.disabled,
                    })),
                });
                continue;
            }
            result.push({
                command: choice.command,
                interactionKind: choice.interactionKind,
                label: choice.label,
                ...(choice.shortLabel === undefined ? {} : { shortLabel: choice.shortLabel }),
                value: choice.command.value,
                active: choice.active,
                disabled: choice.disabled,
                ...(choice.selectionTone === undefined ? {} : { selectionTone: choice.selectionTone }),
                ...(choice.colors === undefined ? {} : { colors: choice.colors }),
                ...(choice.keepOpen === undefined ? {} : { keepOpen: choice.keepOpen }),
                ...(choice.displayType === undefined ? {} : { displayType: choice.displayType }),
                ...(choice.tooltipType === undefined ? {} : { tooltipType: choice.tooltipType }),
                ...(choice.failureTarget === undefined ? {} : { failureTarget: choice.failureTarget }),
            });
        }
        return result;
    }

    private isModeChoice(choice: EquipmentDialogChoice): boolean {
        return choice.command?.handlerId === INVENTORY_MODE_HANDLER_ID
            || (choice.label === INVENTORY_MODE_CHOICE_LABEL && choice.displayType === 'dropdown');
    }

    canMarkDestroyed(row: EquipmentPanelRow): boolean {
        return !this.readOnly()
            && !this.runtime().supportsMekTurnTools()
            && row.component !== undefined
            && row.component.previewStatus !== 'destroyed';
    }

    markDestroyed(row: EquipmentPanelRow): void {
        if (!this.canMarkDestroyed(row)) return;
        if (row.component) void this.runtime().changeStatus(row.component);
    }

    canRepair(row: EquipmentPanelRow): boolean {
        return !this.readOnly()
            && !this.runtime().supportsMekTurnTools()
            && row.component?.previewStatus === 'destroyed';
    }

    rowEffectivelyDestroyed(row: EquipmentPanelRow): boolean {
        const state = this.rowPresentationState(row);
        return state === 'destroying' || state === 'destroyed';
    }

    rowDestroying(row: EquipmentPanelRow): boolean {
        return this.rowPresentationState(row) === 'destroying';
    }

    rowRepairing(row: EquipmentPanelRow): boolean {
        return this.rowPresentationState(row) === 'repairing';
    }

    rowCommittedDestroyed(row: EquipmentPanelRow): boolean {
        return this.rowPresentationState(row) === 'destroyed';
    }

    rowPresentationState(row: EquipmentPanelRow): 'destroying' | 'repairing' | 'destroyed' | 'disabled' | null {
        const component = row.component;
        if (component?.status !== 'destroyed' && component?.previewStatus === 'destroyed') return 'destroying';
        if (component?.status === 'destroyed' && component.previewStatus !== 'destroyed') return 'repairing';
        if (component?.status === 'destroyed') return 'destroyed';
        if (component?.previewStatus === 'disabled' || row.disabled) return 'disabled';
        return null;
    }

    repair(row: EquipmentPanelRow): void {
        if (!this.canRepair(row)) return;
        if (row.component) void this.runtime().changeStatus(row.component);
    }

}
