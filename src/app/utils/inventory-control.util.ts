// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { CBTForceUnit, EquipmentAction } from '../models/cbt-force-unit.model';
import { MountedAmmo, MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { parseInventoryComponentReference } from '../models/inventory-component-reference.model';
import { type CriticalSlot } from '../models/force-serialization';
import type { UnitComponent } from '../models/units.model';
import { resolveInventoryControlSelectedAmmoProfileId, type InventoryControlRuntimeAmmoSelection, type InventoryControlRuntimeEntryState, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from '../models/inventory-control-runtime-state.model';
import type { ToHitAdjustment, ToHitModifierBreakdownEntry, ToHitResolution } from '../models/rules/game-rules';
import { FIELD_GUN_LOCATION, InfantryRules } from '../models/rules/infantry-rules';
import { getBattleArmorTrooperNumber } from '../models/battle-armor-location.model';
import {
    formatBattleArmorTrooperLocation,
    getIntrinsicOneShotAmmoMount,
    isIntrinsicOneShotAmmoMount,
} from './ammo-interaction.util';
import { resolveInventoryControlWeaponDamage, type InventoryControlDamageRules } from './inventory-control-damage.util';
import type { WeaponDamage } from '../models/equipment.model';
import { combineEquipmentStatuses, type EquipmentStatus } from '../models/equipment-status.model';
import { formatInventoryControlHeat, resolveInventoryControlHeatEffect, type InventoryControlHeatRules } from './inventory-control-heat.util';
import type { InventoryControlPhysicalDamageEffect } from './inventory-control-physical-damage.util';
import { ATM_AMMO_PROFILES, MML_AMMO_PROFILES, resolveAmmoWeaponProfile, type AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';
import { AEROSPACE_RANGE_BRACKETS, STANDARD_AEROSPACE_RANGE_LIMITS, aerospaceAttackValues, aerospaceMaximumDistance, effectiveAerospaceMaximumBracket, isRangeBracketWithinMaximum } from './aerospace-range.util';

export const INVENTORY_CONTROL_MODE_STATE = 'inventory_control_mode';
export const INVENTORY_CONTROL_SORT_STATE = 'inventory_control_sort';
export const INVENTORY_CONTROL_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE = 'data-mekbay-original-damage-text';
export const INVENTORY_CONTROL_PHYSICAL_BASE_DAMAGE_TEXT_ATTRIBUTE = 'data-mekbay-physical-base-damage-text';
export const INVENTORY_CONTROL_MODE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
    Standard: 'STD',
    'Extended Range': 'ER',
    'High Explosive': 'HE'
};

export type InventoryControlGroupId = 'ranged' | 'physical' | 'equipment';
export type InventoryRangeKey = 'short' | 'medium' | 'long';
export type InventoryRangeDisplayKey = InventoryRangeKey | 'extreme';

export interface InventoryControlRangePresentation {
    showMinimum: boolean;
    values: Readonly<Record<InventoryRangeDisplayKey, string>>;
}

export interface InventoryControlMode {
    mode: string;
    name: string;
    ammoProfile: AmmoWeaponProfile;
    data: InventoryControlDisplayData;
}

export interface InventoryControlModifier {
    name: string;
    status: EquipmentStatus;
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
    profileId: string;
    label: string;
    ammo?: AmmoEquipment;
    remaining: number;
    total: number;
    destroyed: boolean;
    disabled: boolean;
}

export interface InventoryControlAmmoProfileOption {
    readonly profileId: string;
    readonly ammo: AmmoEquipment;
}

export interface InventoryControlAmmoSelectionOption extends InventoryControlAmmoProfileOption {
    readonly id: string;
    readonly usable: boolean;
}

export interface InventoryControlAmmoSelectionCandidates {
    readonly sourceOptions: readonly InventoryControlAmmoSelectionOption[];
    readonly profileOptions: readonly InventoryControlAmmoProfileOption[];
}

export interface InventoryControlRow {
    id: string;
    entry: MountedEquipment;
    category: InventoryControlGroupId;
    tracksAmmo: boolean;
    destroyed: boolean;
    disabled: boolean;
    originalIndex: number;
    base: InventoryControlDisplayData;
    display: InventoryControlDisplayData;
    rangePresentation: InventoryControlRangePresentation;
    damage: WeaponDamage | null;
    damageTypes: WeaponType[];
    firingHeat: number | null;
    heatWeakened: boolean;
    hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[];
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
    profileId: string;
    ammo: AmmoEquipment;
    locationLabel: string;
    total: number;
    consumed: number;
    status: EquipmentStatus;
    intrinsicOneShotAmmo: boolean;
}

interface InventoryControlRowOptions {
    rowId?: string;
    locationLock?: string;
    destroyed?: boolean;
}

export interface InventoryControlDisplayEffectOptions {
    selectedRange: InventoryControlRuntimeRangeKey | null;
    hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[];
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

export type InventoryControlAmmoMatcher = NonNullable<InventoryControlRules['matchesAmmo']>;

const GROUP_TITLES: Record<InventoryControlGroupId, string> = {
    ranged: 'Ranged Weapons',
    physical: 'Physical Weapons',
    equipment: 'Equipment'
};

export function inventoryControlSortKey(groupId: InventoryControlGroupId): string {
    return `${INVENTORY_CONTROL_SORT_STATE}:${groupId}`;
}

export function setInventoryControlSortOrder(rows: InventoryControlRow[]): void {
    if (rows.length === 0) return;
    const sortKey = inventoryControlSortKey(rows[0].category);
    rows.forEach((row, index) => {
        if (row.entry.setState(sortKey, index.toString())) {
            row.entry.owner.setInventoryEntry(row.entry, { phaseChange: false });
        }
    });
}

export function setInventoryControlMode(entry: MountedEquipment, mode: string): void {
    const changed = entry.setState(INVENTORY_CONTROL_MODE_STATE, mode);
    syncSvgMode(entry, mode);
    if (changed) entry.owner.setInventoryEntry(entry);
}

export function getInventoryControlGroups(
    unit: CBTForceUnit,
    equipmentCatalog: EquipmentRegistry,
    rules: InventoryControlRules = {}
): InventoryControlGroup[] {
    const ammoSources = getAmmoSources(unit, equipmentCatalog);
    const rows = unit.getInventory()
        .map((entry, index) => {
            const locationLock = getBattleArmorWeaponLocation(entry);
            return buildInventoryControlRow(entry, index, ammoSources, rules, equipmentCatalog, {
                locationLock,
                destroyed: locationLock
                    ? !unit.isEquipmentOperationalAtLocation(entry, locationLock)
                    : undefined,
            });
        })
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

/** The canonical action represented by an inventory-control entry. */
export function inventoryControlEntryAction(entry: MountedEquipment): EquipmentAction {
    if (entry.isPhysicalWeapon()) return 'physical-attack';
    return entry.equipment instanceof WeaponEquipment ? 'fire' : 'change-mode';
}

export function selectInventoryControlEntry(
    unit: CBTForceUnit,
    entry: MountedEquipment,
    chooseTarget?: (selectedTargetId: InventoryControlRuntimeTargetId | null, targets: readonly InventoryControlRuntimeTarget[]) => void,
    forceSelected = false
): boolean {
    if (!isInventoryControlSelectableEntry(entry)
        || !entry.owner.canPerformEquipmentAction(entry, inventoryControlEntryAction(entry))) return false;

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
    if (entry.isPhysicalWeapon() || !(entry.equipment instanceof WeaponEquipment)) return [];
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
    equipmentCatalog: EquipmentRegistry,
    matchesAmmo?: InventoryControlAmmoMatcher
): string | null {
    const intrinsicAmmo = getIntrinsicOneShotAmmoMount(entry);
    const ammoSources = entry.equipment instanceof WeaponEquipment && entry.equipment.ammoType === 'MML'
        ? intrinsicAmmo
            ? [createInventoryAmmoSource(intrinsicAmmo, equipmentCatalog, false)].filter((source): source is AmmoSource => source !== null)
            : getAmmoSources(entry.owner, equipmentCatalog, false)
        : [];
    return getSelectedMode(entry, getInventoryControlModes(entry), ammoSources, matchesAmmo);
}

export function resolveInventoryControlSelectedAmmoType(
    entry: MountedEquipment,
    equipmentCatalog: EquipmentRegistry,
    matchesAmmo?: InventoryControlAmmoMatcher,
    selection?: InventoryControlRuntimeAmmoSelection,
    mode?: string | null,
): AmmoEquipment | null {
    const candidates = getInventoryControlAmmoSelectionCandidates(
        entry,
        equipmentCatalog,
        matchesAmmo,
        mode,
        false,
    );
    const profileId = resolveInventoryControlSelectedAmmoProfileId(
        candidates.profileOptions,
        selection?.selectedProfileId,
        selection?.preferredSourceOptionId,
        candidates.sourceOptions,
    );
    return candidates.profileOptions.find(option => option.profileId === profileId)?.ammo ?? null;
}

export function getInventoryControlAmmoSelectionOptions(
    entry: MountedEquipment,
    equipmentCatalog: EquipmentRegistry,
    matchesAmmo?: InventoryControlAmmoMatcher,
    mode?: string | null,
): readonly InventoryControlAmmoSelectionOption[] {
    return getInventoryControlAmmoSelectionCandidates(
        entry,
        equipmentCatalog,
        matchesAmmo,
        mode,
        true,
    ).sourceOptions;
}

export function getInventoryControlAmmoSelectionCandidates(
    entry: MountedEquipment,
    equipmentCatalog: EquipmentRegistry,
    matchesAmmo?: InventoryControlAmmoMatcher,
    mode?: string | null,
    resolveSourceUsability = true,
): InventoryControlAmmoSelectionCandidates {
    if (!(entry.equipment instanceof WeaponEquipment) || entry.equipment.ammoType === 'NA') {
        return { sourceOptions: [], profileOptions: [] };
    }
    const intrinsicAmmo = getIntrinsicOneShotAmmoMount(entry);
    const sources = intrinsicAmmo
        ? [createInventoryAmmoSource(intrinsicAmmo, equipmentCatalog, resolveSourceUsability)]
            .filter((source): source is AmmoSource => source !== null)
        : getAmmoSources(entry.owner, equipmentCatalog, resolveSourceUsability);
    const selectedMode = mode ?? getSelectedMode(
        entry,
        getInventoryControlModes(entry),
        sources,
        matchesAmmo,
        getBattleArmorWeaponLocation(entry),
    );
    const locationLock = getBattleArmorWeaponLocation(entry);
    const compatibleSources = sources
        .filter(source => ammoMatchesWeaponMode(entry, source.ammo, selectedMode, matchesAmmo));
    const sourceOptions = groupAmmoSources(compatibleSources
        .filter(source => !locationLock || source.locationLabel === locationLock))
        .map(source => ({
            id: source.id,
            profileId: source.profileId,
            ammo: source.ammo,
            usable: !resolveSourceUsability || (source.status === 'available' && source.total > source.consumed),
        }));
    const compatibleCatalogAmmo = intrinsicAmmo
        ? []
        : equipmentCatalog.getAmmoForWeapon(entry.equipment)
            .filter(ammo => ammoMatchesWeaponMode(entry, ammo, selectedMode, matchesAmmo));
    const profileOptions = createInventoryControlAmmoProfileOptions([
        ...compatibleSources.map(source => source.ammo),
        ...compatibleCatalogAmmo,
    ]);

    return { sourceOptions, profileOptions };
}

export function getInventoryControlModeAmmoSummary(
    entry: MountedEquipment,
    equipmentCatalog: EquipmentRegistry,
    rules: InventoryControlRules = {},
    mode: string | null = getSelectedInventoryControlMode(entry, equipmentCatalog, rules.matchesAmmo)
): InventoryControlAmmoSummary {
    return getInventoryControlAmmoSummary(entry, getAmmoSources(entry.owner, equipmentCatalog), mode, equipmentCatalog, rules.matchesAmmo);
}

function getInventoryControlAmmoSummary(
    entry: MountedEquipment,
    ammoSources: AmmoSource[],
    mode: string | null,
    equipmentCatalog: EquipmentRegistry,
    matchesAmmo?: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) => boolean | null,
    locationLock?: string,
): InventoryControlAmmoSummary {
    if (!(entry.equipment instanceof WeaponEquipment)) {
        return { tracksAmmo: false, remaining: 0, total: 0, options: [] };
    }

    const intrinsicAmmo = getIntrinsicOneShotAmmoMount(entry);
    if (intrinsicAmmo) {
        const source = createInventoryAmmoSource(intrinsicAmmo, equipmentCatalog);
        return createAmmoSummary(source ? [source] : []);
    }

    if (entry.equipment.ammoType === 'NA') {
        return { tracksAmmo: false, remaining: 0, total: 0, options: [] };
    }

    const matchingAmmo = ammoSources
        .filter(source => ammoMatchesWeaponMode(entry, source.ammo, mode, matchesAmmo))
        .filter(source => !locationLock || source.locationLabel === locationLock);
    return createAmmoSummary(matchingAmmo);
}

function createAmmoSummary(matchingAmmo: AmmoSource[]): InventoryControlAmmoSummary {
    const groupedAmmo = groupAmmoSources(matchingAmmo);
    const availableAmmo = groupedAmmo.filter(source => source.status === 'available');

    const locationSensitiveAmmoNames = getLocationSensitiveAmmoNames(groupedAmmo);
    return {
        tracksAmmo: true,
        remaining: availableAmmo.reduce((sum, source) => sum + Math.max(0, source.total - source.consumed), 0),
        total: availableAmmo.reduce((sum, source) => sum + source.total, 0),
        options: groupedAmmo.map(source => ({
            id: source.id,
            profileId: source.profileId,
            label: formatAmmoOptionLabel(source, locationSensitiveAmmoNames.has(source.ammo.shortName)),
            ammo: source.ammo,
            remaining: source.status === 'available' ? Math.max(0, source.total - source.consumed) : 0,
            total: source.total,
            destroyed: source.status === 'destroyed',
            disabled: source.status !== 'available'
        }))
    };
}

export function getInventoryControlAmmoProfileId(ammo: AmmoEquipment): string {
    const munitions = [...ammo.munitionType].sort().join(',');
    const subMunition = (ammo.ammo.subMunition ?? '').trim().toLowerCase();
    return `${ammo.internalName}|${subMunition}|${munitions}`;
}

export function resolveInventoryControlSelectedAmmoOption(
    options: readonly InventoryControlAmmoOption[],
    selectedProfileId?: string | null,
    preferredSourceOptionId?: string | null,
): InventoryControlAmmoOption | undefined {
    if (options.length === 0) return undefined;
    const preferredSource = preferredSourceOptionId
        ? options.find(option => option.id === preferredSourceOptionId)
        : undefined;
    const effectiveProfileId = selectedProfileId ?? preferredSource?.profileId ?? options[0].profileId;
    const selectedProfile = options.filter(option => option.profileId === effectiveProfileId);
    if (preferredSource && selectedProfile.includes(preferredSource)
        && (!selectedProfile.some(isUsableInventoryControlAmmoOption) || isUsableInventoryControlAmmoOption(preferredSource))) {
        return preferredSource;
    }
    const usableProfileSource = selectedProfile.find(isUsableInventoryControlAmmoOption);
    if (usableProfileSource) return usableProfileSource;
    return selectedProfile.find(option => !option.destroyed) ?? selectedProfile[0];
}

function createInventoryControlAmmoProfileOptions(
    ammoCandidates: readonly AmmoEquipment[],
): InventoryControlAmmoProfileOption[] {
    const profiles = new Map<string, InventoryControlAmmoProfileOption>();
    for (const ammo of ammoCandidates) {
        const profileId = getInventoryControlAmmoProfileId(ammo);
        if (!profiles.has(profileId)) profiles.set(profileId, { profileId, ammo });
    }
    return [...profiles.values()];
}

function isUsableInventoryControlAmmoOption(option: InventoryControlAmmoOption): boolean {
    return !option.disabled && option.remaining > 0;
}

function groupAmmoSources(sources: AmmoSource[]): AmmoSource[] {
    type GroupedAmmoSource = AmmoSource & { availableCount: number; disabledCount: number; sourceCount: number };
    const groups: GroupedAmmoSource[] = [];
    const groupMap = new Map<string, GroupedAmmoSource>();

    for (const source of sources) {
        const key = source.intrinsicOneShotAmmo
            ? source.id
            : `${source.ammo.internalName}:${source.locationLabel}`;
        const existing = groupMap.get(key);
        const remaining = source.status === 'available' ? Math.max(0, source.total - source.consumed) : 0;
        if (!existing) {
            const groupedSource = {
                ...source,
                id: key,
                consumed: source.total - remaining,
                availableCount: source.status === 'available' ? 1 : 0,
                disabledCount: source.status === 'disabled' ? 1 : 0,
                sourceCount: 1
            };
            groupMap.set(key, groupedSource);
            groups.push(groupedSource);
            continue;
        }

        existing.total += source.total;
        existing.consumed = Math.max(0, existing.consumed) + (source.total - remaining);
        existing.availableCount += source.status === 'available' ? 1 : 0;
        existing.disabledCount += source.status === 'disabled' ? 1 : 0;
        existing.sourceCount = (existing.sourceCount ?? 0) + 1;
        existing.status = existing.availableCount > 0
            ? 'available'
            : existing.disabledCount > 0 ? 'disabled' : 'destroyed';
    }

    return groups.map(({ availableCount, disabledCount, sourceCount, ...source }) => source);
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
    const remaining = source.status === 'available' ? Math.max(0, source.total - source.consumed) : 0;
    const location = showLocation ? `[${source.locationLabel}] ` : '';
    return `${location}${source.ammo.shortName} (${remaining}/${source.total})`;
}

export function getInventoryControlModeChoices(entry: MountedEquipment): Array<{ label: string; value: string; disabled?: boolean }> {
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
    ammoSources: AmmoSource[],
    rules: InventoryControlRules,
    equipmentCatalog: EquipmentRegistry,
    options: InventoryControlRowOptions = {}
): InventoryControlRow | null {
    const unitRules = entry.owner.rules;
    const fieldGunComponent = unitRules instanceof InfantryRules ? unitRules.getFieldGunComponent(entry) : null;
    const hasModelDisplay = entry.isIntrinsicPhysicalAttack()
        || (!!entry.equipment && !(entry.equipment instanceof AmmoEquipment));
    const linkedWeaponEnhancement = isLinkedWeaponEnhancement(entry);
    if (entry.el && !entry.el.classList.contains('inventoryEntry') && !fieldGunComponent && !linkedWeaponEnhancement) return null;
    if (!entry.el && !fieldGunComponent && !hasModelDisplay) return null;

    const status = entry.owner.getEquipmentStatus(entry);
    const hitModifierBreakdown = unitRules.getEquipmentToHitModifiers(entry);
    const destroyed = options.destroyed ?? status === 'destroyed';
    const disabled = !entry.owner.canPerformEquipmentAction(entry, inventoryControlEntryAction(entry))
        || status === 'disabled'
        || rules.isSelectable?.(entry) === false;
    const category = getEntryCategory(entry);
    const { modes, modifiers } = readInventoryControlModesAndModifiers(entry);
    const selectedMode = getSelectedMode(entry, modes, ammoSources, rules.matchesAmmo, options.locationLock);
    const ammo = getInventoryControlAmmoSummary(entry, ammoSources, selectedMode, equipmentCatalog, rules.matchesAmmo, options.locationLock);
    const ammoSelection = entry.owner.getInventoryControlEntryAmmoSelection?.(entry.id);
    const selectedAmmo = entry.owner.getInventoryControlSelectedAmmo(entry, selectedMode);
    const selectedAmmoOption = resolveInventoryControlSelectedAmmoOption(
        ammo.options,
        selectedAmmo ? getInventoryControlAmmoProfileId(selectedAmmo) : ammoSelection?.selectedProfileId,
        ammoSelection?.preferredSourceOptionId,
    );
    const hitResolution = resolveInventoryControlHitModifier(
        entry,
        hitModifierBreakdown,
        selectedAmmo,
        rules
    );
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
    const runtimeRange = entry.owner.getInventoryControlEntryRange?.(entry.id) ?? null;
    const selectedRange = runtimeRange === 'short' || runtimeRange === 'medium' || runtimeRange === 'long' ? runtimeRange : null;
    const damageResolution = resolveInventoryControlWeaponDamage(entry, {
        selectedRange,
        selectedAmmo,
        equipmentCatalog,
        ammoProfile: selectedAmmo ? null : selectedAmmoProfile,
    }, rules);
    const heatResolution = resolveInventoryControlHeatEffect(entry, rules);
    const firingHeat = heatResolution?.value ?? null;
    const rapidFireCount = entry.equipment instanceof WeaponEquipment
        ? entry.equipment.getRapidFireCount()
        : 0;
    const resolvedDisplay = {
        ...display,
        ...(entry.equipment instanceof WeaponEquipment && { damage: damageResolution?.text ?? '—' }),
        ...(heatResolution !== null && { heat: formatInventoryControlHeat(heatResolution.value, heatResolution.suffix, rapidFireCount) })
    };
    const adjustedDisplay = applyInventoryControlDisplayEffects(entry, resolvedDisplay, {
        selectedRange,
        hitModifierBreakdown,
        selectedAmmo
    }, rules);

    return {
        id: entry.id,
        entry,
        category,
        tracksAmmo: ammo.tracksAmmo,
        hitModifierBreakdown,
        destroyed,
        disabled,
        originalIndex,
        base,
        display: adjustedDisplay,
        rangePresentation: resolveInventoryControlRangePresentation(entry, adjustedDisplay, selectedAmmoProfile),
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
        extremeRange: resolveInventoryControlExtremeRange(entry, selectedAmmo, selectedAmmoProfile)
    };
}

function resolveInventoryControlHitModifier(
    entry: MountedEquipment,
    hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[],
    selectedAmmo: AmmoEquipment | null,
    rules: InventoryControlRules
): ToHitResolution {
    return entry.owner.gameRules.resolveToHit({
        subject: entry,
        stateModifiers: hitModifierBreakdown,
        adjustments: rules.resolveToHitAdjustments?.(entry, selectedAmmo)
    });
}

function formatInventoryControlHitResolution(resolution: ToHitResolution): string {
    return resolution.profile.length > 1
        ? resolution.profile.map(formatHitModifier).join('/')
        : formatHitModifier(resolution.value);
}

function getBattleArmorWeaponLocation(entry: MountedEquipment): string | undefined {
    if (entry.owner.getUnit().subtype !== 'Battle Armor') return undefined;
    if (!(entry.equipment instanceof WeaponEquipment) || !entry.equipment.flags.has('F_BA_WEAPON')) return undefined;
    return Array.from(entry.locations ?? []).find(location => getBattleArmorTrooperNumber(location) !== null);
}


function getEntryCategory(entry: MountedEquipment): InventoryControlGroupId {
    if (entry.isPhysicalWeapon()) return 'physical';
    if (entry.equipment instanceof WeaponEquipment) return 'ranged';
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
        const hasLrmAmmo = ammoSources.some(source =>
            (!locationLock || source.locationLabel === locationLock)
            && ammoMatchesWeaponMode(entry, source.ammo, 'LRM', matchesAmmo)
            && resolveAmmoWeaponProfile(source.ammo)?.id === 'mml-lrm');
        return hasLrmAmmo ? 'LRM' : 'SRM';
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
    const physical = entry.isPhysicalWeapon();
    const weapon = !physical && equipment instanceof WeaponEquipment ? equipment : null;
    const physicalDamage = physical && entry.el
        ? normalizeCell(readDamageText(entry.el))
        : '—';
    const ranges = weapon && entry.owner.getUnit().type === 'Aero'
        ? STANDARD_AEROSPACE_RANGE_LIMITS
        : weapon?.ranges;
    return {
        name: equipment?.name ?? entry.name,
        location: normalizeCell(Array.from(entry.locations ?? []).join('/')),
        heat: weapon ? formatInventoryControlHeat(weapon.heat) : '—',
        damage: weapon ? '—' : physicalDamage,
        hit,
        min: weapon && entry.owner.getUnit().type !== 'Aero' ? formatInventoryRange(weapon.minRange) : '—',
        short: weapon ? formatInventoryRange(ranges?.[0]) : '—',
        medium: weapon ? formatInventoryRange(ranges?.[1]) : '—',
        long: weapon ? formatInventoryRange(ranges?.[2]) : '—',
    };
}

/**
 * Projects range cells for the inventory UI without replacing the tactical
 * ranges used by target-number calculations. Aerospace record sheets display
 * attack values (SRV/MRV/LRV/ERV), not tactical weapon distances.
 */
export function resolveInventoryControlRangePresentation(
    entry: MountedEquipment,
    display: InventoryControlDisplayData,
    ammoProfile: AmmoWeaponProfile | null = null
): InventoryControlRangePresentation {
    if (entry.owner.getUnit().type !== 'Aero') {
        return {
            showMinimum: true,
            values: {
                short: display.short,
                medium: display.medium,
                long: display.long,
                extreme: '—'
            }
        };
    }

    const equipment = entry.equipment;
    if (equipment instanceof WeaponEquipment) {
        const maximumBracket = effectiveAerospaceMaximumBracket(equipment, ammoProfile);
        const attackValues = aerospaceAttackValues(equipment, ammoProfile);
        const value = (index: number): string => isRangeBracketWithinMaximum(AEROSPACE_RANGE_BRACKETS[index], maximumBracket)
            ? attackValues[index].toString()
            : '—';
        return {
            showMinimum: false,
            values: {
                short: value(0),
                medium: value(1),
                long: value(2),
                extreme: value(3)
            }
        };
    }

    return {
        showMinimum: false,
        values: {
            short: display.short,
            medium: display.medium,
            long: display.long,
            extreme: entry.el ? normalizeCell(readDirectText(entry.el, '.range_extreme')) : '—'
        }
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
            modifiers.push({ name: data.name, status: getModifierStatus(entry, data.name) });
        }
    });

    return { modes, modifiers };
}

function readLinkedWeaponEnhancementModifiers(entry: MountedEquipment): InventoryControlModifier[] {
    return entry.linkedWith
        ?.filter(isWeaponEnhancement)
        .map(linked => ({
            name: readLinkedModifierName(linked),
            status: linked.owner.getEquipmentStatus(linked)
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

function getModifierStatus(entry: MountedEquipment, modifierName: string): EquipmentStatus {
    const normalizedModifier = normalizeEquipmentName(modifierName);
    const statuses = entry.linkedWith?.flatMap(linked => {
        const linkedNames = [
            linked.name,
            linked.equipment?.name,
            linked.equipment?.shortName,
            linked.el ? readDirectText(linked.el, '.name') : ''
        ];
        const matches = linkedNames.some(name => {
            const normalizedLinkedName = normalizeEquipmentName(name ?? '');
            return normalizedLinkedName.length > 0
                && (normalizedModifier.includes(normalizedLinkedName) || normalizedLinkedName.includes(normalizedModifier));
        });
        return matches ? [linked.owner.getEquipmentStatus(linked)] : [];
    }) ?? [];
    return combineEquipmentStatuses(statuses);
}

function getAmmoSources(unit: CBTForceUnit, equipmentCatalog: EquipmentRegistry, resolveAvailability = true): AmmoSource[] {
    const critSources = unit.getCritSlots()
        .map(criticalSlot => createCriticalSlotAmmoSource(unit, criticalSlot, resolveAvailability))
        .filter((source): source is AmmoSource => !!source);
    const inventorySources = unit.getInventory()
        .filter(entry => !isIntrinsicOneShotAmmoMount(entry))
        .map(entry => createInventoryAmmoSource(entry, equipmentCatalog, resolveAvailability))
        .filter((source): source is AmmoSource => !!source);

    return [...critSources, ...inventorySources];
}

function createCriticalSlotAmmoSource(
    unit: CBTForceUnit,
    criticalSlot: CriticalSlot,
    resolveAvailability = true
): AmmoSource | null {
    if (!(criticalSlot.eq instanceof AmmoEquipment)) return null;
    const elementTotal = Number(criticalSlot.el?.getAttribute('totalAmmo') ?? 0);
    return {
        id: `crit:${criticalSlot.loc ?? ''}:${criticalSlot.slot ?? ''}:${criticalSlot.name ?? criticalSlot.id}`,
        profileId: getInventoryControlAmmoProfileId(criticalSlot.eq),
        ammo: criticalSlot.eq,
        locationLabel: criticalSlot.loc ?? 'Ammo',
        total: criticalSlot.totalAmmo || elementTotal || 0,
        consumed: criticalSlot.consumed ?? 0,
        status: resolveAvailability ? unit.getEquipmentStatus(criticalSlot) : 'available',
        intrinsicOneShotAmmo: false,
    };
}

function createInventoryAmmoSource(
    entry: MountedEquipment,
    equipmentCatalog: EquipmentRegistry,
    resolveAvailability = true
): AmmoSource | null {
    const currentAmmo = entry.ammo ? equipmentCatalog.findEquipment(entry.ammo) : entry.equipment;
    const ammo = currentAmmo instanceof AmmoEquipment
        ? currentAmmo
        : entry.equipment instanceof AmmoEquipment ? entry.equipment : null;
    if (!ammo) return null;

    const total = entry.totalAmmo ?? (entry instanceof MountedAmmo
        ? getInventoryOriginalTotalAmmo(entry)
        : ammo.getShots(entry.owner.gameRules, equipmentCatalog));
    const locationLabel = Array.from(entry.locations ?? []).join('/') || 'Ammo';
    return {
        id: `inventory:${entry.id}`,
        profileId: getInventoryControlAmmoProfileId(ammo),
        ammo,
        locationLabel,
        total,
        consumed: entry.consumed ?? 0,
        status: resolveInventoryAmmoSourceStatus(entry, resolveAvailability),
        intrinsicOneShotAmmo: isIntrinsicOneShotAmmoMount(entry),
    };
}

function resolveInventoryAmmoSourceStatus(entry: MountedEquipment, resolveAvailability: boolean): EquipmentStatus {
    if (!resolveAvailability) return 'available';
    return combineEquipmentStatuses([
        entry.owner.getEquipmentStatus(entry),
        ...(isIntrinsicOneShotAmmoMount(entry) && entry.parent
            ? [entry.owner.getEquipmentStatus(entry.parent)]
            : []),
    ]);
}

function getInventoryOriginalTotalAmmo(entry: MountedAmmo): number {
    return entry.originalTotalAmmo ?? entry.totalAmmo ?? entry.getMaxShots();
}

function readInfantryFieldGunDisplayData(entry: MountedEquipment, component: UnitComponent, hit: string): InventoryControlDisplayData {
    if (entry.equipment instanceof WeaponEquipment) {
        const display = readTypedEquipmentDisplayData(entry, hit);
        const componentRef = parseInventoryComponentReference(entry.id);
        const gunCount = Math.max(1, component.q ?? 1);
        const gunIndex = componentRef?.binIndex ?? 0;
        return {
            ...display,
            name: gunCount > 1 ? `${display.name} (${gunIndex + 1}/${gunCount})` : display.name,
            location: FIELD_GUN_LOCATION
        };
    }
    const ranges = (component.r ?? '').split('/');
    const componentRef = parseInventoryComponentReference(entry.id);
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
    if (entry.owner.getUnit().type === 'Aero') {
        const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo) ?? fallbackAmmoProfile ?? null;
        return aerospaceMaximumDistance(weapon, effectiveAerospaceMaximumBracket(weapon, ammoProfile));
    }
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo) ?? fallbackAmmoProfile;
    if (ammoProfile) return ammoProfile.ranges[3];
    const extreme = weapon.ranges[3];
    return Number.isFinite(extreme) && extreme > 0 ? extreme : null;
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
        options.hitModifierBreakdown,
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
    hitModifierBreakdown: readonly ToHitModifierBreakdownEntry[],
    selectedAmmo?: AmmoEquipment | null,
    resolveToHitAdjustments?: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => readonly ToHitAdjustment[]
): InventoryControlDisplayData {
    const hit = selectedRange === null
        ? display.hit
        : formatHitModifier(entry.owner.gameRules.resolveToHit({
            subject: entry,
            stateModifiers: hitModifierBreakdown,
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
    disabled = !entry.owner.canPerformEquipmentAction(entry, inventoryControlEntryAction(entry))
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
