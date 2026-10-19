// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { WeaponAttackContext } from '../../models/runtime/equipment-panel';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { CBTForceMember } from '../../models/force-member.model';
import { sameAttackerSelection } from '../../models/runtime/attacker-targeting-state';
import {
    equipmentWeaponToHit,
    projectTargetingTarget,
    projectWeaponTargetPresentation,
    selectedWeaponHeat,
    type EquipmentPanelComponent,
    type EquipmentPanelSnapshot,
} from '../../models/runtime/equipment-panel';
import type { UnitEditContext } from '../../models/runtime/unit-edit-context';
import type { HeatDissipationBoost } from '../../models/entity/base-entity';
import {
    HEAT_PROFILE_BOOSTS_ATTRIBUTE,
    HEAT_PROFILE_MAXIMUM_ATTRIBUTE,
    recordSheetHeatProfileText,
    svgElement,
} from '../../utils/sheets/record-sheet-svg-rendering';
import type { RecordSheetBind } from './record-sheet-dom';

const COMPONENT_IDS_ATTRIBUTE = 'data-mekbay-component-ids';

const INVENTORY_RANGE_BUTTONS = Object.freeze([
    Object.freeze({ selector: '.shrButton', range: 'short' as const }),
    Object.freeze({ selector: '.medButton', range: 'medium' as const }),
    Object.freeze({ selector: '.lngButton', range: 'long' as const }),
    Object.freeze({ selector: '.extButton', range: 'extreme' as const }),
]);

/** What a sheet's inventory needs to show weapon selections: the equipment panel and the unit's attack context. */
export interface RecordSheetInventorySource {
    readonly panel: EquipmentPanelSnapshot;
    readonly attack: WeaponAttackContext | null;
}

/** The live inventory source for a member's sheets. */
export function recordSheetInventorySource(member: CBTForceMember): RecordSheetInventorySource | null {
    const panel = member.force.getEquipmentPanelSnapshot(member.id);
    return panel ? Object.freeze({ panel, attack: member.force.getWeaponAttackContext(member.id, panel) }) : null;
}

export type RecordSheetPanelWeapon = EquipmentPanelComponent & {
    readonly weapon: NonNullable<EquipmentPanelComponent['weapon']>;
};

/** Components a sheet row or critical slot stands for, as written on the element. */
export function readRecordSheetComponentIds(element: Element): readonly ComponentId[] {
    return (element.getAttribute(COMPONENT_IDS_ATTRIBUTE) ?? '').trim().split(/\s+/u).filter(Boolean) as ComponentId[];
}

export function writeRecordSheetComponentIds(element: Element, componentIds: readonly ComponentId[]): void {
    if (componentIds.length > 0) element.setAttribute(COMPONENT_IDS_ATTRIBUTE, componentIds.join(' '));
    else element.removeAttribute(COMPONENT_IDS_ATTRIBUTE);
}

/** Binds a row's (or one of its mode rows') main and range buttons to select its weapons, in that mode and range. */
export function bindRecordSheetInventoryButtons(
    row: SVGElement,
    componentIds: readonly ComponentId[],
    mode: string | undefined,
    bind: RecordSheetBind,
    context: () => UnitEditContext,
): void {
    const select = (range?: 'short' | 'medium' | 'long' | 'extreme') => () => Object.freeze({
        kind: 'inventory-selection' as const,
        componentIds,
        ...(mode === undefined ? {} : { mode }),
        ...(range === undefined ? {} : { range }),
        context: context(),
    });
    const main = row.querySelector<SVGElement>(mode === undefined
        ? ':scope > .inventoryEntryButton.mainButton'
        : ':scope > .inventoryEntryButton.alternativeModeButton') ?? row;
    bind(main, select(), 'control');
    for (const definition of INVENTORY_RANGE_BUTTONS) {
        row.querySelectorAll<SVGElement>(`:scope > .inventoryEntryButton${definition.selector}`)
            .forEach(button => bind(button, select(definition.range), 'control'));
    }
}

/** How an inventory row shows its selection. */
export interface RecordSheetInventorySelection {
    readonly selected: boolean;
    readonly range?: 'short' | 'medium' | 'long' | 'extreme';
    readonly outOfRange?: boolean;
    readonly targetColor?: string;
    readonly targetNumberText?: string;
    readonly hitModifierText?: string;
    /** Damage or another impairment worsened the hit modifier; its badge turns red as in the equipment dialog. */
    readonly hitModifierWeakened?: boolean;
}

export const NO_INVENTORY_SELECTION: RecordSheetInventorySelection = Object.freeze({ selected: false });

/**
 * A row's weapon selection the way the equipment dialog computes it: target color, range band, out-of-range, the target
 * number, and the hit modifier at that target and range. Without a source (printing) nothing is selected.
 */
export function projectRecordSheetWeaponSelection(
    weapons: readonly RecordSheetPanelWeapon[],
    source: RecordSheetInventorySource | null,
): RecordSheetInventorySelection {
    if (weapons.length === 0) return NO_INVENTORY_SELECTION;
    const unavailable = weapons.every(weapon => weapon.status !== 'available');
    const selections = weapons.map(weapon => weapon.weapon.selection);
    const selection = selections[0];
    const uniform = selections.every(candidate => sameAttackerSelection(candidate, selection));
    const selected = source !== null && !unavailable && selections.some(candidate => candidate !== undefined);
    const target = selected && uniform && selection?.kind === 'target'
        ? source.panel.targets.find(candidate => candidate.targetId === selection.targetId)
        : undefined;
    const runtimeTarget = target === undefined ? null : projectTargetingTarget(target, source!.panel.ruleset);
    const attack = source?.attack ?? null;
    const presentation = selected && uniform && attack !== null
        ? projectWeaponTargetPresentation(weapons[0], runtimeTarget, attack, source!.panel.ruleset)
        : null;
    const range = presentation?.rangeSelection?.range;
    const hit = equipmentWeaponToHit(weapons[0], runtimeTarget, range ?? null);
    return Object.freeze({
        selected,
        ...(range === undefined ? {} : { range }),
        ...(presentation?.outOfRange ? { outOfRange: true } : {}),
        ...(target === undefined ? {} : { targetColor: target.color }),
        ...(presentation?.targetNumberText ? { targetNumberText: presentation.targetNumberText } : {}),
        ...(unavailable || hit.modifier === 0 ? {} : {
            hitModifierText: `${hit.modifier > 0 ? '+' : ''}${hit.modifier}`,
            ...(hit.weakened ? { hitModifierWeakened: true } : {}),
        }),
    });
}

/** Shows a row's selection; its mode rows must already mark the selected mode, which then carries the highlight. */
export function renderRecordSheetInventorySelection(row: SVGElement, selection: RecordSheetInventorySelection): void {
    row.classList.toggle('selected', selection.selected);
    for (const band of ['short', 'medium', 'long', 'extreme'] as const) {
        row.classList.toggle(`selected-range-${band}`, selection.range === band);
    }
    row.classList.toggle('selected-target-out-of-range', selection.outOfRange === true);
    row.classList.toggle('selected-alternative-mode',
        selection.selected && row.querySelector(':scope > .alternativeMode.selected') !== null);
    if (selection.targetColor) row.style.setProperty('--inventory-control-selection-color', selection.targetColor);
    else row.style.removeProperty('--inventory-control-selection-color');
    // The target number takes the hit modifier's slot while a target is selected.
    renderInventoryBadge(row, 'targetTn', selection.targetNumberText);
    renderInventoryBadge(row, 'hitMod', selection.targetNumberText ? undefined : selection.hitModifierText);
    row.classList.toggle('weakenedHitMod', selection.hitModifierWeakened === true);
}

/**
 * The inventory heat line against the unit's live dissipation: the design's maximum heat, or the heat of the
 * selected weapons while any are selected.
 */
export function renderRecordSheetHeatProfile(
    svg: SVGSVGElement,
    dissipation: number,
    inventory: RecordSheetInventorySource | null,
): void {
    const profile = svg.querySelector<SVGElement>('#heatProfile');
    const maximum = profile?.getAttribute(HEAT_PROFILE_MAXIMUM_ATTRIBUTE) ?? null;
    if (!profile || maximum === null) return;
    const boosts = JSON.parse(profile.getAttribute(HEAT_PROFILE_BOOSTS_ATTRIBUTE) ?? '[]') as HeatDissipationBoost[];
    const selected = inventory === null ? null : selectedWeaponHeat(inventory.panel);
    if (selected?.hasSelection) {
        const value = svgElement('tspan');
        value.setAttribute('font-weight', '700');
        value.textContent = String(selected.value);
        profile.replaceChildren('Selected Heat (Dissipation): ', value, ` (${dissipation})`);
    } else {
        profile.textContent = recordSheetHeatProfileText(maximum, dissipation, boosts);
    }
}

function renderInventoryBadge(row: SVGElement, kind: 'hitMod' | 'targetTn', value: string | undefined): void {
    const rect = row.querySelector<SVGElement>(`:scope > .${kind}-rect`);
    const text = row.querySelector<SVGElement>(`:scope > .${kind}-text`);
    rect?.setAttribute('display', value ? 'block' : 'none');
    text?.setAttribute('display', value ? 'block' : 'none');
    if (text) text.textContent = value ?? '';
}
