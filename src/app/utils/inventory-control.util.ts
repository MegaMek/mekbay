/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { AmmoEquipment, findIntrinsicAmmoForWeapon, WeaponEquipment, type EquipmentMap, type WeaponType } from '../models/equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { MountedAmmo, MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { type CriticalSlot } from '../models/force-serialization';
import type { UnitComponent } from '../models/units.model';
import type { InventoryControlRuntimeEntryState, InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../models/inventory-control-runtime-state.model';
import type { ToHitAdjustment, ToHitResolution } from '../models/rules/game-rules';
import { FIELD_GUN_LOCATION, InfantryRules } from '../models/rules/infantry-rules';
import type { MountedEquipmentRuleState } from '../models/rules/unit-type-rules';
import { formatBattleArmorTrooperLocation, getBattleArmorTrooperNumber } from './ammo-interaction.util';
import { resolveInventoryControlWeaponDamage, type InventoryControlDamage, type InventoryControlDamageRules } from './inventory-control-damage.util';
import { formatInventoryControlHeat, resolveInventoryControlHeatEffect, type InventoryControlHeatRules } from './inventory-control-heat.util';
import type { InventoryControlPhysicalDamageEffect } from './inventory-control-physical-damage.util';
import { ATM_AMMO_PROFILES, MML_AMMO_PROFILES, resolveAmmoWeaponProfile, type AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';

export const INVENTORY_CONTROL_MODE_STATE = 'inventory_control_mode';
export const INVENTORY_CONTROL_SORT_STATE = 'inventory_control_sort';
export const INVENTORY_CONTROL_VIRTUAL_TROOPER_ROW_STATE = 'inventory_control_virtual_trooper_row';
export const INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE = 'data-mekbay-original-damage-text';
export const INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE = 'data-mekbay-physical-base-damage-text';
export const INVENTORY_CONTROL_MODE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
    Standard: 'STD',
    'Extended Range': 'ER',
    'High Explosive': 'HE'
};

const RANGE_MODIFIER_KEYS: readonly InventoryControlRuntimeRangeKey[] = ['short', 'medium', 'long', 'extreme'];

export type InventoryControlGroupId = 'ranged' | 'physical' | 'equipment';
export type InventoryRangeKey = 'short' | 'medium' | 'long';

export interface InventoryControlMode {
    mode: string;
    name: string;
    ammoProfile: AmmoWeaponProfile;
    data: InventoryControlDisplayData;
}

export interface InventoryControlModifier {
    name: string;
    destroyed: boolean;
}

export interface InventoryControlDisplayData {
    name: string;
    location: string;
    heat: string;
    damage: string;
    hit: string;
    min: string;
    short: string;
    medium: string;
    long: string;
}

export interface InventoryControlAmmoSummary {
    tracksAmmo: boolean;
    remaining: number;
    total: number;
    options: InventoryControlAmmoOption[];
}

export interface InventoryControlAmmoOption {
    id: string;
    label: string;
    ammo?: AmmoEquipment;
    remaining: number;
    total: number;
    destroyed: boolean;
    disabled: boolean;
}

export interface InventoryControlRow {
    id: string;
    entry: MountedEquipment;
    category: InventoryControlGroupId;
    tracksAmmo: boolean;
    additionalHitModifier: number;
    destroyed: boolean;
    disabled: boolean;
    originalIndex: number;
    base: InventoryControlDisplayData;
    display: InventoryControlDisplayData;
    damage: InventoryControlDamage | null;
    damageTypes: WeaponType[];
    firingHeat: number | null;
    heatWeakened: boolean;
    hitResolution: ToHitResolution;
    selectedAmmoOption?: InventoryControlAmmoOption;
    modes: InventoryControlMode[];
    modifiers: InventoryControlModifier[];
    selectedMode: string | null;
    ammo: InventoryControlAmmoSummary;
    extremeRange: number | null;
}

export interface InventoryControlGroup {
    id: InventoryControlGroupId;
    title: string;
    sortable: boolean;
    rows: InventoryControlRow[];
}

interface AmmoSource {
    id: string;
    ammo: AmmoEquipment;
    locationLabel: string;
    total: number;
    consumed: number;
    destroyed: boolean;
}

interface InventoryControlRowOptions {
    rowId?: string;
    locationLock?: string;
    destroyed?: boolean;
}

export interface InventoryControlDisplayEffectOptions {
    selectedRange: InventoryControlRuntimeRangeKey | null;
    additionalHitModifier: number;
    selectedAmmo?: AmmoEquipment | null;
}

export type InventoryControlDisplayEffectApplier = (
    entry: MountedEquipment,
    display: InventoryControlDisplayData,
    options: InventoryControlDisplayEffectOptions
) => InventoryControlDisplayData;

export interface InventoryControlRules extends InventoryControlDamageRules, InventoryControlHeatRules {
    applyDisplayEffects?: InventoryControlDisplayEffectApplier;
    matchesAmmo?: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) => boolean | null;
    resolveToHitAdjustments?: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => readonly ToHitAdjustment[];
    isSelectable?: (entry: MountedEquipment) => boolean;
    applyPhysicalDamageEffects?: (
        entry: MountedEquipment,
        effect: InventoryControlPhysicalDamageEffect
    ) => InventoryControlPhysicalDamageEffect;
}

const GROUP_TITLES: Record<InventoryControlGroupId, string> = {
    ranged: 'Ranged Weapons',
    physical: 'Physical Weapons',
    equipment: 'Equipment'
};

export const BUILT_IN_ONE_SHOT_AMMO_OPTION_ID = '__built_in_one_shot__';

export function inventoryControlSortKey(groupId: InventoryControlGroupId): string {
    return `${INVENTORY_CONTROL_SORT_STATE}:${groupId}`;
}

export function setInventoryControlSortOrder(rows: InventoryControlRow[]): void {
    if (rows.length === 0) return;
    const sortKey = inventoryControlSortKey(rows[0].category);
    rows.forEach((row, index) => {
        if (row.entry.setState(sortKey, index.toString())) {
            row.entry.owner.setInventoryEntry(row.entry);
        }
    });
}

export function setInventoryControlMode(entry: MountedEquipment, mode: string): void {
    entry.setState(INVENTORY_CONTROL_MODE_STATE, mode);
    syncSvgMode(entry, mode);
    entry.owner.setInventoryEntry(entry);
}

export function getInventoryControlGroups(
    unit: CBTForceUnit,
    equipmentMap: EquipmentMap = {},
    rules: InventoryControlRules = {}
): InventoryControlGroup[] {
    const entryStates = getEntryStates(unit);
    const ammoSources = getAmmoSources(unit, equipmentMap);
    const rows = unit.getInventory()
        .flatMap((entry, index) => buildInventoryControlRows(entry, index, entryStates, ammoSources, rules, equipmentMap))
        .filter((row): row is InventoryControlRow => row !== null);

    const groups: InventoryControlGroup[] = [
        createGroup('ranged', rows),
        createGroup('physical', rows),
        createGroup('equipment', rows),
    ];

    return groups.filter(group => group.rows.length > 0);
}

export function isInventoryControlSelectableEntry(entry: MountedEquipment): boolean {
    const category = getEntryCategory(entry);
    return category === 'ranged' || category === 'physical';
}

export function selectInventoryControlEntry(
    unit: CBTForceUnit,
    entry: MountedEquipment,
    chooseTarget?: (selectedTargetId: InventoryControlRuntimeTargetId | null, targets: readonly InventoryControlRuntimeTarget[]) => void,
    forceSelected = false
): boolean {
    if (!isInventoryControlSelectableEntry(entry)) return false;

    const targets = unit.getInventoryControlTargets();
    if (targets.length === 0) {
        unit.setInventoryControlEntrySelected(entry, forceSelected || !unit.isInventoryControlEntrySelected(entry.id));
        return true;
    }

    if (targets.length === 1) {
        const targetId = targets[0].id;
        const selectedTargetId = unit.getInventoryControlEntryTargetId(entry.id);
        unit.setInventoryControlEntryTarget(entry, !forceSelected && selectedTargetId === targetId ? null : targetId);
        return true;
    }

    if (forceSelected && unit.getInventoryControlEntryTargetId(entry.id)) return true;

    chooseTarget?.(unit.getInventoryControlEntryTargetId(entry.id) ?? null, targets);
    return false;
}

export function getInventoryControlModes(entry: MountedEquipment): InventoryControlMode[] {
    const base = readTypedEquipmentDisplayData(entry, '');
    if (!(entry.equipment instanceof WeaponEquipment)) return [];
    if (entry.equipment.ammoType === 'MML') {
        return MML_AMMO_PROFILES.map(profile => createAmmoProfileMode(base, profile));
    }
    if (entry.equipment.ammoType === 'ATM' || entry.equipment.ammoType === 'IATM') {
        return ATM_AMMO_PROFILES.map(profile => createAmmoProfileMode(base, profile));
    }
    return [];
}

export function getSelectedInventoryControlMode(
    entry: MountedEquipment,
    equipmentMap: EquipmentMap = {},
    rules: InventoryControlRules = {}
): string | null {
    const ammoSources = entry.equipment instanceof WeaponEquipment && entry.equipment.ammoType === 'MML'
        ? getAmmoSources(entry.owner, equipmentMap)
        : [];
    return getSelectedMode(entry, getInventoryControlModes(entry), ammoSources, rules.matchesAmmo);
}

export function getInventoryControlModeAmmoSummary(
    entry: MountedEquipment,
    equipmentMap: EquipmentMap,
    rules: InventoryControlRules = {},
    mode: string | null = getSelectedInventoryControlMode(entry, equipmentMap, rules)
): InventoryControlAmmoSummary {
    return getInventoryControlAmmoSummary(entry, getAmmoSources(entry.owner, equipmentMap), mode, rules.matchesAmmo, undefined, equipmentMap);
}

function getInventoryControlAmmoSummary(
    entry: MountedEquipment,
    ammoSources: AmmoSource[],
    mode: string | null,
    matchesAmmo?: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) => boolean | null,
    locationLock?: string,
    equipmentMap: EquipmentMap = {}
): InventoryControlAmmoSummary {
    if (!(entry.equipment instanceof WeaponEquipment)) {
        return { tracksAmmo: false, remaining: 0, total: 0, options: [] };
    }

    const builtInShotCapacity = getBuiltInOneShotCapacity(entry);
    if (builtInShotCapacity > 0) {
        return getBuiltInOneShotAmmoSummary(entry, builtInShotCapacity, equipmentMap);
    }

    if (entry.equipment.ammoType === 'NA') {
        return { tracksAmmo: false, remaining: 0, total: 0, options: [] };
    }

    const matchingAmmo = ammoSources
        .filter(source => ammoMatchesWeaponMode(entry, source.ammo, mode, matchesAmmo))
        .filter(source => !locationLock || source.locationLabel === locationLock);
    const groupedAmmo = groupAmmoSources(matchingAmmo);
    const availableAmmo = groupedAmmo.filter(source => !source.destroyed);

    const locationSensitiveAmmoNames = getLocationSensitiveAmmoNames(groupedAmmo);
    return {
        tracksAmmo: true,
        remaining: availableAmmo.reduce((sum, source) => sum + Math.max(0, source.total - source.consumed), 0),
        total: availableAmmo.reduce((sum, source) => sum + source.total, 0),
        options: groupedAmmo.map(source => ({
            id: source.id,
            label: formatAmmoOptionLabel(source, locationSensitiveAmmoNames.has(source.ammo.shortName)),
            ammo: source.ammo,
            remaining: source.destroyed ? 0 : Math.max(0, source.total - source.consumed),
            total: source.total,
            destroyed: source.destroyed,
            disabled: source.destroyed
        }))
    };
}

export function resolveInventoryControlSelectedAmmoOption(options: readonly InventoryControlAmmoOption[], selectedOptionId?: string): InventoryControlAmmoOption | undefined {
    const selectedOption = selectedOptionId
        ? options.find(option => option.id === selectedOptionId)
        : undefined;
    if (selectedOption && (!hasUsableInventoryControlAmmoOption(options) || isUsableInventoryControlAmmoOption(selectedOption))) {
        return selectedOption;
    }
    if (selectedOption) {
        return preferredInventoryControlAmmoOption(options, selectedOption) ?? selectedOption;
    }
    return preferredInventoryControlAmmoOption(options);
}

function hasUsableInventoryControlAmmoOption(options: readonly InventoryControlAmmoOption[]): boolean {
    return options.some(option => isUsableInventoryControlAmmoOption(option));
}

function isUsableInventoryControlAmmoOption(option: InventoryControlAmmoOption): boolean {
    return !option.destroyed && option.remaining > 0;
}

function preferredInventoryControlAmmoOption(options: readonly InventoryControlAmmoOption[], sameTypeAs?: InventoryControlAmmoOption): InventoryControlAmmoOption | undefined {
    return options.find(option => isUsableInventoryControlAmmoOption(option)
            && (!sameTypeAs || inventoryControlAmmoTypeKey(option) === inventoryControlAmmoTypeKey(sameTypeAs)))
    ?? (sameTypeAs ? undefined : options.find(option => !option.destroyed) ?? options[0]);
}

function inventoryControlAmmoTypeKey(option: InventoryControlAmmoOption): string {
    return option.ammo?.internalName ?? option.id;
}

export function getBuiltInOneShotCapacity(entry: MountedEquipment): number {
    if (!(entry.equipment instanceof WeaponEquipment)) return 0;
    if (entry.equipment.flags.has('F_DOUBLE_ONE_SHOT')) return 2;
    if (entry.equipment.flags.has('F_ONE_SHOT')) return 1;
    return 0;
}

export function getBuiltInOneShotConsumed(entry: MountedEquipment): number {
    const capacity = getBuiltInOneShotCapacity(entry);
    if (capacity <= 0) return 0;
    const consumed = entry.critSlots?.[0]?.consumed ?? entry.consumed ?? 0;
    return Math.max(0, Math.min(capacity, consumed));
}

export function isBuiltInOneShotAmmoOption(optionId: string): boolean {
    return optionId === BUILT_IN_ONE_SHOT_AMMO_OPTION_ID;
}

function getBuiltInOneShotAmmoSummary(
    entry: MountedEquipment,
    capacity: number,
    equipmentMap: EquipmentMap
): InventoryControlAmmoSummary {
    const consumed = getBuiltInOneShotConsumed(entry);
    const remaining = Math.max(0, capacity - consumed);
    const intrinsicAmmo = entry.equipment instanceof WeaponEquipment
        ? findIntrinsicAmmoForWeapon(entry.equipment, equipmentMap)
        : null;
    return {
        tracksAmmo: true,
        remaining,
        total: capacity,
        options: [{
            id: BUILT_IN_ONE_SHOT_AMMO_OPTION_ID,
            label: `Built-in (${remaining}/${capacity})`,
            ammo: intrinsicAmmo ?? undefined,
            remaining,
            total: capacity,
            destroyed: false,
            disabled: remaining <= 0
        }]
    };
}

function groupAmmoSources(sources: AmmoSource[]): AmmoSource[] {
    type GroupedAmmoSource = AmmoSource & { destroyedCount: number; sourceCount: number };
    const groups: GroupedAmmoSource[] = [];
    const groupMap = new Map<string, GroupedAmmoSource>();

    for (const source of sources) {
        const key = `${source.ammo.internalName}:${source.locationLabel}`;
        const existing = groupMap.get(key);
        const remaining = source.destroyed ? 0 : Math.max(0, source.total - source.consumed);
        if (!existing) {
            const groupedSource = {
                ...source,
                id: key,
                consumed: source.total - remaining,
                destroyedCount: source.destroyed ? 1 : 0,
                sourceCount: 1
            };
            groupMap.set(key, groupedSource);
            groups.push(groupedSource);
            continue;
        }

        existing.total += source.total;
        existing.consumed = Math.max(0, existing.consumed) + (source.total - remaining);
        existing.destroyedCount = (existing.destroyedCount ?? 0) + (source.destroyed ? 1 : 0);
        existing.sourceCount = (existing.sourceCount ?? 0) + 1;
        existing.destroyed = existing.destroyedCount === existing.sourceCount;
    }

    return groups.map(({ destroyedCount, sourceCount, ...source }) => source);
}

function getLocationSensitiveAmmoNames(sources: AmmoSource[]): Set<string> {
    const locationsByName = new Map<string, Set<string>>();
    for (const source of sources) {
        const locations = locationsByName.get(source.ammo.shortName) ?? new Set<string>();
        locations.add(source.locationLabel);
        locationsByName.set(source.ammo.shortName, locations);
    }
    return new Set(
        Array.from(locationsByName.entries())
            .filter(([, locations]) => locations.size > 1)
            .map(([shortName]) => shortName)
    );
}

function formatAmmoOptionLabel(source: AmmoSource, showLocation: boolean): string {
    const remaining = source.destroyed ? 0 : Math.max(0, source.total - source.consumed);
    const location = showLocation ? `[${source.locationLabel}] ` : '';
    return `${location}${source.ammo.shortName} (${remaining}/${source.total})`;
}

export function getInventoryControlModeChoices(entry: MountedEquipment, _equipmentMap: EquipmentMap): Array<{ label: string; value: string; disabled?: boolean }> {
    return getInventoryControlModes(entry).map(mode => ({
        label: formatInventoryControlModeName(mode.name),
        value: mode.mode,
        disabled: false
    }));
}

function createGroup(id: InventoryControlGroupId, rows: InventoryControlRow[]): InventoryControlGroup {
    const groupRows = rows
        .filter(row => row.category === id)
        .sort((a, b) => compareRows(a, b, id));

    return {
        id,
        title: GROUP_TITLES[id],
        sortable: id === 'ranged' || id === 'physical',
        rows: groupRows
    };
}

function compareRows(a: InventoryControlRow, b: InventoryControlRow, groupId: InventoryControlGroupId): number {
    const sortKey = inventoryControlSortKey(groupId);
    const aOrder = Number(a.entry.states.get(sortKey));
    const bOrder = Number(b.entry.states.get(sortKey));
    const aHasOrder = Number.isFinite(aOrder);
    const bHasOrder = Number.isFinite(bOrder);

    if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
    return a.originalIndex - b.originalIndex;
}

function buildInventoryControlRow(
    entry: MountedEquipment,
    originalIndex: number,
    entryStates: Map<MountedEquipment, MountedEquipmentRuleState>,
    ammoSources: AmmoSource[],
    rules: InventoryControlRules,
    equipmentMap: EquipmentMap,
    options: InventoryControlRowOptions = {}
): InventoryControlRow | null {
    const unitRules = entry.owner.rules;
    const fieldGunComponent = unitRules instanceof InfantryRules ? unitRules.getFieldGunComponent(entry) : null;
    const hasModelDisplay = entry.physical || (!!entry.equipment && !(entry.equipment instanceof AmmoEquipment));
    const linkedWeaponEnhancement = isLinkedWeaponEnhancement(entry);
    if (entry.el && !entry.el.classList.contains('inventoryEntry') && !fieldGunComponent && !linkedWeaponEnhancement) return null;
    if (!entry.el && !fieldGunComponent && !hasModelDisplay) return null;

    const state = entryStates.get(entry) ?? entry.ruleState();
    const destroyed = options.destroyed ?? state.isDamaged;
    const disabled = state.isDisabled || rules.isSelectable?.(entry) === false;
    const category = getEntryCategory(entry);
    const { modes, modifiers } = readInventoryControlModesAndModifiers(entry);
    const selectedMode = getSelectedMode(entry, modes, ammoSources, rules.matchesAmmo, options.locationLock);
    syncSvgMode(entry, selectedMode, disabled);
    const rowEntry = createInventoryControlRowEntry(entry, options);
    const ammo = getInventoryControlAmmoSummary(rowEntry, ammoSources, selectedMode, rules.matchesAmmo, options.locationLock, equipmentMap);
    const selectedAmmoOption = resolveInventoryControlSelectedAmmoOption(ammo.options, rowEntry.owner.getInventoryControlEntryAmmoOption?.(rowEntry.id));
    const selectedAmmo = selectedAmmoOption?.ammo ?? null;
    const additionalHitModifier = state?.hitMod ?? 0;
    const hitResolution = resolveInventoryControlHitModifier(rowEntry, additionalHitModifier, selectedAmmo, rules);
    const hit = formatInventoryControlHitResolution(hitResolution);
    const base = fieldGunComponent
        ? readInfantryFieldGunDisplayData(entry, fieldGunComponent, hit)
        : entry.equipment
            ? readTypedEquipmentDisplayData(entry, hit)
            : entry.el
                ? readEntryDisplayData(entry.el, hit)
                : readModelDisplayData(entry, hit);
    if (options.locationLock) {
        base.location = formatBattleArmorTrooperLocation(options.locationLock);
    }
    const selectedModeData = selectedMode ? modes.find(mode => mode.mode === selectedMode)?.data : null;
    const selectedAmmoProfile = resolveAmmoWeaponProfile(selectedAmmo)
        ?? modes.find(mode => mode.mode === selectedMode)?.ammoProfile
        ?? null;
    const display = selectedModeData ? mergeModeData(base, selectedModeData) : base;
    const runtimeRange = entry.owner.getInventoryControlEntryRange?.(rowEntry.id) ?? null;
    const selectedRange = runtimeRange === 'short' || runtimeRange === 'medium' || runtimeRange === 'long' ? runtimeRange : null;
    const damageResolution = resolveInventoryControlWeaponDamage(rowEntry, {
        selectedRange,
        selectedAmmo,
        fallbackAmmoProfile: selectedAmmo ? null : selectedAmmoProfile
    }, rules);
    const heatResolution = resolveInventoryControlHeatEffect(rowEntry, rules);
    const firingHeat = heatResolution?.value ?? null;
    const rapidFireCount = rowEntry.equipment instanceof WeaponEquipment
        ? rowEntry.equipment.getRapidFireCount()
        : 0;
    const resolvedDisplay = {
        ...display,
        ...(rowEntry.equipment instanceof WeaponEquipment && { damage: damageResolution?.text ?? '—' }),
        ...(heatResolution !== null && { heat: formatInventoryControlHeat(heatResolution.value, heatResolution.suffix, rapidFireCount) })
    };
    const adjustedDisplay = applyInventoryControlDisplayEffects(rowEntry, resolvedDisplay, {
        selectedRange,
        additionalHitModifier,
        selectedAmmo
    }, rules);

    return {
        id: rowEntry.id,
        entry: rowEntry,
        category,
        tracksAmmo: ammo.tracksAmmo,
        additionalHitModifier,
        destroyed,
        disabled,
        originalIndex,
        base,
        display: adjustedDisplay,
        damage: damageResolution?.damage ?? null,
        damageTypes: [...(damageResolution?.damageTypes ?? [])],
        firingHeat,
        heatWeakened: heatResolution?.weakened ?? false,
        hitResolution,
        selectedAmmoOption,
        modes,
        modifiers,
        selectedMode,
        ammo,
        extremeRange: resolveInventoryControlExtremeRange(rowEntry, selectedAmmo, selectedAmmoProfile)
    };
}

function resolveInventoryControlHitModifier(
    entry: MountedEquipment,
    additionalHitModifier: number,
    selectedAmmo: AmmoEquipment | null,
    rules: InventoryControlRules
): ToHitResolution {
    return entry.owner.gameRules.resolveToHit({
        subject: entry,
        stateModifier: additionalHitModifier,
        adjustments: rules.resolveToHitAdjustments?.(entry, selectedAmmo)
    });
}

function formatInventoryControlHitResolution(resolution: ToHitResolution): string {
    return resolution.profile.length > 1
        ? resolution.profile.map(formatHitModifier).join('/')
        : formatHitModifier(resolution.value);
}

function createInventoryControlRowEntry(entry: MountedEquipment, options: InventoryControlRowOptions): MountedEquipment {
    if (!options.rowId) return entry;
    const states = new Map(entry.states);
    states.set(INVENTORY_CONTROL_VIRTUAL_TROOPER_ROW_STATE, '1');
    return MountedEquipment.from(entry).clone({ id: options.rowId, states });
}

function buildInventoryControlRows(
    entry: MountedEquipment,
    originalIndex: number,
    entryStates: Map<MountedEquipment, MountedEquipmentRuleState>,
    ammoSources: AmmoSource[],
    rules: InventoryControlRules,
    equipmentMap: EquipmentMap
): Array<InventoryControlRow | null> {
    const trooperLocations = getBattleArmorWeaponTrooperLocations(entry);
    if (trooperLocations.length === 0) {
        return [buildInventoryControlRow(entry, originalIndex, entryStates, ammoSources, rules, equipmentMap)];
    }

    return trooperLocations.map((location, locationIndex) => buildInventoryControlRow(entry, originalIndex + (locationIndex / 100), entryStates, ammoSources, rules, equipmentMap, {
        rowId: `${entry.id}:${location}`,
        locationLock: location,
        destroyed: entry.owner.isEquipmentUnavailable(entry, location)
    }));
}

function getBattleArmorWeaponTrooperLocations(entry: MountedEquipment): string[] {
    if (entry.owner.getUnit().subtype !== 'Battle Armor') return [];
    if (!(entry.equipment instanceof WeaponEquipment) || !entry.equipment.flags.has('F_BA_WEAPON') || entry.equipment.ammoType === 'NA') return [];

    const componentLocations = (entry.owner.getUnit().comp ?? [])
        .filter(component => component.id === entry.equipment?.internalName || component.id === entry.name || component.eq === entry.equipment)
        .flatMap(component => Array.from({ length: Math.max(1, component.q ?? 1) }, () => component.l ?? ''))
        .filter(location => getBattleArmorTrooperNumber(location) !== null);
    const locations = componentLocations.length > 0
        ? componentLocations
        : Array.from(entry.locations ?? []).filter(location => getBattleArmorTrooperNumber(location) !== null);

    return Array.from(new Set(locations)).sort((a, b) => (getBattleArmorTrooperNumber(a) ?? 0) - (getBattleArmorTrooperNumber(b) ?? 0));
}

function getEntryStates(unit: CBTForceUnit): Map<MountedEquipment, MountedEquipmentRuleState> {
    return unit.rules.computeAllEntryStates();
}

function getEntryCategory(entry: MountedEquipment): InventoryControlGroupId {
    if (entry.physical || entry.equipment?.flags.has('F_CLUB') || entry.equipment?.flags.has('F_HAND_WEAPON')) {
        return 'physical';
    }
    if (entry.equipment instanceof WeaponEquipment) {
        return 'ranged';
    }
    return 'equipment';
}

function getSelectedMode(
    entry: MountedEquipment,
    modes: InventoryControlMode[],
    ammoSources: AmmoSource[] = [],
    matchesAmmo?: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) => boolean | null,
    locationLock?: string
): string | null {
    if (modes.length === 0) return null;

    const persistedMode = entry.states.get(INVENTORY_CONTROL_MODE_STATE);
    if (persistedMode && modes.some(mode => mode.mode === persistedMode)) return persistedMode;

    if (entry.equipment instanceof WeaponEquipment && entry.equipment.ammoType === 'MML') {
        const hasUsableLrmAmmo = ammoSources.some(source =>
            (!locationLock || source.locationLabel === locationLock)
            && !source.destroyed
            && source.total - source.consumed > 0
            && ammoMatchesWeaponMode(entry, source.ammo, 'LRM', matchesAmmo)
            && resolveAmmoWeaponProfile(source.ammo)?.id === 'mml-lrm');
        return hasUsableLrmAmmo ? 'LRM' : 'SRM';
    }
    if (entry.equipment instanceof WeaponEquipment
        && (entry.equipment.ammoType === 'ATM' || entry.equipment.ammoType === 'IATM')) return 'Standard';

    return modes[0].mode;
}

function createAmmoProfileMode(base: InventoryControlDisplayData, profile: AmmoWeaponProfile): InventoryControlMode {
    return {
        mode: profile.displayName,
        name: profile.displayName,
        ammoProfile: profile,
        data: {
            ...base,
            name: profile.displayName,
            damage: '—',
            min: formatInventoryRange(profile.minimumRange),
            short: formatInventoryRange(profile.ranges[0]),
            medium: formatInventoryRange(profile.ranges[1]),
            long: formatInventoryRange(profile.ranges[2])
        }
    };
}

function readEntryDisplayData(el: SVGElement, hit: string): InventoryControlDisplayData {
    return {
        name: readDirectText(el, '.name') || el.getAttribute('id') || '',
        location: normalizeCell(readDirectText(el, '.location')),
        heat: normalizeCell(readHeatText(el)),
        damage: normalizeCell(readDamageText(el)),
        hit,
        min: normalizeCell(readDirectText(el, '.range_min')),
        short: normalizeCell(readDirectText(el, '.range_short')),
        medium: normalizeCell(readDirectText(el, '.range_medium')),
        long: normalizeCell(readDirectText(el, '.range_long')),
    };
}

function readTypedEquipmentDisplayData(entry: MountedEquipment, hit: string): InventoryControlDisplayData {
    const equipment = entry.equipment;
    const weapon = equipment instanceof WeaponEquipment ? equipment : null;
    const physicalDamage = !weapon && entry.el
        && (equipment?.flags.has('F_CLUB') || equipment?.flags.has('F_HAND_WEAPON'))
        ? normalizeCell(readDamageText(entry.el))
        : '—';
    return {
        name: equipment?.name ?? entry.name,
        location: normalizeCell(Array.from(entry.locations ?? []).join('/')),
        heat: weapon ? formatInventoryControlHeat(weapon.heat) : '—',
        damage: weapon ? formatModelValue(weapon.damage) : physicalDamage,
        hit,
        min: weapon ? formatInventoryRange(weapon.minRange) : '—',
        short: weapon ? formatInventoryRange(weapon.ranges[0]) : '—',
        medium: weapon ? formatInventoryRange(weapon.ranges[1]) : '—',
        long: weapon ? formatInventoryRange(weapon.ranges[2]) : '—',
    };
}

/** Resolves an entry's base display data from its typed model and SVG metadata. */
export function readInventoryControlDisplayData(entry: MountedEquipment, hit = '—'): InventoryControlDisplayData {
    if (entry.equipment) return readTypedEquipmentDisplayData(entry, hit);
    if (entry.el) return readEntryDisplayData(entry.el, hit);
    return readModelDisplayData(entry, hit);
}

function readModelDisplayData(entry: MountedEquipment, hit: string): InventoryControlDisplayData {
    return readTypedEquipmentDisplayData(entry, hit);
}

function formatInventoryRange(value: number | undefined): string {
    return Number.isFinite(value) && value! > 0 ? value!.toString() : '—';
}

function formatModelValue(value: string | number | number[]): string {
    return Array.isArray(value) ? value.join('/') : `${value}`;
}

function readInventoryControlModesAndModifiers(entry: MountedEquipment): { modes: InventoryControlMode[]; modifiers: InventoryControlModifier[] } {
    const modes = getInventoryControlModes(entry);
    const { modifiers } = readAlternativeModes(entry);
    return { modes, modifiers: [...modifiers, ...readLinkedWeaponEnhancementModifiers(entry)] };
}

function readAlternativeModes(entry: MountedEquipment): { modes: InventoryControlMode[]; modifiers: InventoryControlModifier[] } {
    const modes: InventoryControlMode[] = [];
    const modifiers: InventoryControlModifier[] = [];

    entry.el?.querySelectorAll<SVGElement>(':scope > .alternativeMode').forEach(modeEl => {
        const mode = modeEl.getAttribute('mode') || readDirectText(modeEl, '.name');
        if (!mode) return;

        const data = readEntryDisplayData(modeEl, '');
        data.name = mode;

        if (!hasModeData(data)) {
            modifiers.push({ name: data.name, destroyed: isModifierDestroyed(entry, data.name) });
        }
    });

    return { modes, modifiers };
}

function readLinkedWeaponEnhancementModifiers(entry: MountedEquipment): InventoryControlModifier[] {
    return entry.linkedWith
        ?.filter(isWeaponEnhancement)
        .map(linked => ({
            name: readLinkedModifierName(linked),
            destroyed: linked.isUnavailable()
        })) ?? [];
}

function readLinkedModifierName(entry: MountedEquipment): string {
    return entry.equipment?.shortName || entry.equipment?.name || entry.name;
}

function isLinkedWeaponEnhancement(entry: MountedEquipment): boolean {
    return isWeaponEnhancement(entry) && (!!entry.parent || !!entry.el?.classList.contains('linked'));
}

function isWeaponEnhancement(entry: MountedEquipment): boolean {
    return !!entry.equipment?.flags.has('F_WEAPON_ENHANCEMENT');
}

function isModifierDestroyed(entry: MountedEquipment, modifierName: string): boolean {
    const normalizedModifier = normalizeEquipmentName(modifierName);
    return !!entry.linkedWith?.some(linked => {
        const linkedNames = [
            linked.name,
            linked.equipment?.name,
            linked.equipment?.shortName,
            linked.el ? readDirectText(linked.el, '.name') : ''
        ];
        return linked.isUnavailable() && linkedNames.some(name => {
            const normalizedLinkedName = normalizeEquipmentName(name ?? '');
            return normalizedLinkedName.length > 0
                && (normalizedModifier.includes(normalizedLinkedName) || normalizedLinkedName.includes(normalizedModifier));
        });
    });
}

function getAmmoSources(unit: CBTForceUnit, equipmentMap: EquipmentMap): AmmoSource[] {
    const critSources = unit.getCritSlots()
        .map(criticalSlot => createCriticalSlotAmmoSource(unit, criticalSlot))
        .filter((source): source is AmmoSource => !!source);
    const inventorySources = unit.getInventory()
        .map(entry => createInventoryAmmoSource(entry, equipmentMap))
        .filter((source): source is AmmoSource => !!source);

    return [...critSources, ...inventorySources];
}

function createCriticalSlotAmmoSource(unit: CBTForceUnit, criticalSlot: CriticalSlot): AmmoSource | null {
    if (!(criticalSlot.eq instanceof AmmoEquipment)) return null;
    const elementTotal = Number(criticalSlot.el?.getAttribute('totalAmmo') ?? 0);
    return {
        id: `crit:${criticalSlot.loc ?? ''}:${criticalSlot.slot ?? ''}:${criticalSlot.name ?? criticalSlot.id}`,
        ammo: criticalSlot.eq,
        locationLabel: criticalSlot.loc ?? 'Ammo',
        total: criticalSlot.totalAmmo || elementTotal || 0,
        consumed: criticalSlot.consumed ?? 0,
        destroyed: unit.isEquipmentUnavailable(criticalSlot)
    };
}

function createInventoryAmmoSource(entry: MountedEquipment, equipmentMap: EquipmentMap): AmmoSource | null {
    const currentAmmo = entry.ammo ? equipmentMap[entry.ammo] : entry.equipment;
    const ammo = currentAmmo instanceof AmmoEquipment
        ? currentAmmo
        : entry.equipment instanceof AmmoEquipment ? entry.equipment : null;
    if (!ammo) return null;

    const total = entry.totalAmmo ?? (entry instanceof MountedAmmo
        ? getInventoryOriginalTotalAmmo(entry)
        : ammo.getShots(entry.owner.gameRules));
    const locationLabel = Array.from(entry.locations ?? []).join('/') || 'Ammo';
    return {
        id: `inventory:${entry.id}`,
        ammo,
        locationLabel,
        total,
        consumed: entry.consumed ?? 0,
        destroyed: entry.owner.isEquipmentUnavailable(entry)
    };
}

function getInventoryOriginalTotalAmmo(entry: MountedAmmo): number {
    const componentRef = getInventoryComponentRef(entry);
    const component = componentRef === null ? undefined : entry.owner.getUnit().comp[componentRef.componentIndex];
    const binCount = Math.max(1, component?.q ?? 1);
    const totalAmmo = component?.q2 || (entry.getMaxShots() * binCount) || entry.totalAmmo || 0;
    if (componentRef?.binIndex === null) return totalAmmo;
    const baseBinAmmo = Math.floor(totalAmmo / binCount);
    const extraBinAmmo = totalAmmo % binCount;
    return baseBinAmmo + (componentRef && componentRef.binIndex < extraBinAmmo ? 1 : 0);
}

function readInfantryFieldGunDisplayData(entry: MountedEquipment, component: UnitComponent, hit: string): InventoryControlDisplayData {
    if (entry.equipment instanceof WeaponEquipment) {
        const display = readTypedEquipmentDisplayData(entry, hit);
        const componentRef = getInventoryComponentRef(entry);
        const gunCount = Math.max(1, component.q ?? 1);
        const gunIndex = componentRef?.binIndex ?? 0;
        return {
            ...display,
            name: gunCount > 1 ? `${display.name} (${gunIndex + 1}/${gunCount})` : display.name,
            location: FIELD_GUN_LOCATION
        };
    }
    const ranges = (component.r ?? '').split('/');
    const componentRef = getInventoryComponentRef(entry);
    const gunCount = Math.max(1, component.q ?? 1);
    const gunIndex = componentRef?.binIndex ?? 0;
    const name = gunCount > 1 ? `${component.n} (${gunIndex + 1}/${gunCount})` : component.n;
    return {
        name,
        location: FIELD_GUN_LOCATION,
        heat: '—',
        damage: normalizeCell(component.d ?? ''),
        hit,
        min: normalizeCell(component.m ?? ''),
        short: normalizeCell(ranges[0] ?? ''),
        medium: normalizeCell(ranges[1] ?? ''),
        long: normalizeCell(ranges[2] ?? ''),
    };
}

export function resolveInventoryControlExtremeRange(
    entry: MountedEquipment,
    selectedAmmo: AmmoEquipment | null,
    fallbackAmmoProfile?: AmmoWeaponProfile | null
): number | null {
    const weapon = entry.equipment;
    if (!(weapon instanceof WeaponEquipment)) return null;
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo) ?? fallbackAmmoProfile;
    if (ammoProfile) return ammoProfile.ranges[3];
    const extreme = weapon.ranges[3];
    return Number.isFinite(extreme) && extreme > 0 ? extreme : null;
}

function getInventoryComponentRef(entry: MountedEquipment): { componentIndex: number; binIndex: number | null } | null {
    const indexText = entry.id.split('#').pop();
    if (!indexText) return null;
    const [componentIndexText, binIndexText] = indexText.split('.');
    const componentIndex = Number(componentIndexText);
    const binIndex = binIndexText === undefined ? null : Number(binIndexText);
    if (!Number.isInteger(componentIndex)) return null;
    if (binIndex !== null && !Number.isInteger(binIndex)) return null;
    return { componentIndex, binIndex };
}

function ammoMatchesWeaponMode(entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null, matchesAmmo?: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) => boolean | null): boolean {
    const handlerMatch = matchesAmmo?.(entry, ammo, mode);
    if (handlerMatch !== null && handlerMatch !== undefined) return handlerMatch;
    if (!(entry.equipment instanceof WeaponEquipment)) return false;
    const weapon = entry.equipment;
    if (weapon.ammoType === 'NA') return false;
    if (ammo.ammoType !== weapon.ammoType) return false;
    if (weapon.rackSize > 0 && ammo.rackSize !== weapon.rackSize) return false;
    return true;
}

export function formatInventoryControlModeName(modeName: string): string {
    return INVENTORY_CONTROL_MODE_DISPLAY_NAMES[modeName] ?? modeName;
}

function normalizeEquipmentName(value: string): string {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function applyInventoryControlDisplayEffects(
    entry: MountedEquipment,
    display: InventoryControlDisplayData,
    options: InventoryControlDisplayEffectOptions,
    rules: InventoryControlRules
): InventoryControlDisplayData {
    let nextDisplay = applySelectedRangeDisplay(
        entry,
        display,
        options.selectedRange,
        options.additionalHitModifier,
        options.selectedAmmo,
        rules.resolveToHitAdjustments
    );
    nextDisplay = rules.applyDisplayEffects?.(entry, nextDisplay, options) ?? nextDisplay;
    return nextDisplay;
}

function applySelectedRangeDisplay(
    entry: MountedEquipment,
    display: InventoryControlDisplayData,
    selectedRange: InventoryControlRuntimeRangeKey | null,
    additionalHitModifier: number,
    selectedAmmo?: AmmoEquipment | null,
    resolveToHitAdjustments?: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => readonly ToHitAdjustment[]
): InventoryControlDisplayData {
    const hit = selectedRange === null
        ? display.hit
        : formatHitModifier(entry.owner.gameRules.resolveToHit({
            subject: entry,
            stateModifier: additionalHitModifier,
            range: selectedRange,
            adjustments: resolveToHitAdjustments?.(entry, selectedAmmo)
        }).value);
    return hit === display.hit ? display : { ...display, hit };
}

function mergeModeData(base: InventoryControlDisplayData, modeData: InventoryControlDisplayData): InventoryControlDisplayData {
    return {
        name: base.name,
        location: modeData.location !== '—' ? modeData.location : base.location,
        heat: modeData.heat !== '—' ? modeData.heat : base.heat,
        damage: modeData.damage !== '—' ? modeData.damage : base.damage,
        hit: base.hit,
        min: modeData.min !== '—' ? modeData.min : base.min,
        short: modeData.short !== '—' ? modeData.short : base.short,
        medium: modeData.medium !== '—' ? modeData.medium : base.medium,
        long: modeData.long !== '—' ? modeData.long : base.long,
    };
}

function hasModeData(data: InventoryControlDisplayData): boolean {
    return [data.location, data.heat, data.damage, data.min, data.short, data.medium, data.long]
        .some(value => value !== '—');
}

function readDirectText(el: Element, selector: string): string {
    return (el.querySelector(`:scope > ${selector}`)?.textContent ?? '').trim();
}

function readDamageText(el: Element): string {
    const damageEl = el.querySelector(':scope > .damage');
    const physicalBaseText = damageEl
        ?.querySelector(`:scope > text[${INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE}]`)
        ?.getAttribute(INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE);
    const rangeBaseText = damageEl
        ?.querySelector(`:scope > text[${INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE}]`)
        ?.getAttribute(INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE);
    return (physicalBaseText ?? rangeBaseText ?? damageEl?.textContent ?? '').trim();
}

function readHeatText(el: Element): string {
    return readDirectText(el, '.heat');
}

function normalizeCell(value: string): string {
    const text = value.trim();
    return text.length > 0 ? text : '—';
}

export function formatHitModifier(hitModifier: number | 'Vs' | '*' | null): string {
    if (hitModifier === null) return '—';
    if (hitModifier === 'Vs' || hitModifier === '*') return hitModifier;
    return hitModifier >= 0 ? `+${hitModifier}` : hitModifier.toString();
}

export function syncSvgMode(
    entry: MountedEquipment,
    mode: string | null,
    disabled = entry.isDisabled()
): void {
    const el = entry.el;
    if (!el) return;
    const ownerSelection = entry.owner as { getInventoryControlEntryState?: (entryId: string) => InventoryControlRuntimeEntryState | undefined };
    const selected = ownerSelection.getInventoryControlEntryState?.(entry.id)?.selected ?? false;

    let hasSelectedMode = false;
    el.querySelectorAll(':scope > .alternativeMode').forEach(optionEl => {
        const active = !!mode && optionEl.getAttribute('mode') === mode;
        optionEl.classList.toggle('selected', active);
        hasSelectedMode ||= active;
    });
    el.classList.toggle('selected', selected);
    el.classList.toggle('selected-alternative-mode', selected && hasSelectedMode);
    el.classList.toggle('disabledInventory', disabled);
    if (disabled) el.classList.remove('selected');
}
