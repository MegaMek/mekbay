import { AmmoEquipment, WeaponEquipment, type EquipmentMap } from '../models/equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../models/force-serialization';
import type { InventoryControlRuntimeEntryState, InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../models/inventory-control-runtime-state.model';
import { computeLinkedModifiers, isMountedDestroyed, resolveHitModifier } from '../models/rules/hit-modifier.util';
import { resolveWeaponRangeDamageText, WEAPON_RANGE_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE, type WeaponRangeKey } from '../models/rules/weapon-range-rules.util';
import { formatBattleArmorTrooperLocation, getBattleArmorTrooperNumber, isBattleArmorTrooperLocationDestroyed } from './ammo-interaction.util';

export const INVENTORY_CONTROL_MODE_STATE = 'inventory_control_mode';
export const INVENTORY_CONTROL_SORT_STATE = 'inventory_control_sort';
export const INVENTORY_CONTROL_VIRTUAL_TROOPER_ROW_STATE = 'inventory_control_virtual_trooper_row';
export const INVENTORY_CONTROL_MODE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
    Standard: 'STD',
    'Extended Range': 'ER',
    'High Explosive': 'HE'
};

export type InventoryControlGroupId = 'ranged' | 'physical' | 'equipment';
export type InventoryRangeKey = 'short' | 'medium' | 'long';

export interface InventoryControlMode {
    mode: string;
    name: string;
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
    modes: InventoryControlMode[];
    modifiers: InventoryControlModifier[];
    selectedMode: string | null;
    ammo: InventoryControlAmmoSummary;
}

export interface InventoryControlGroup {
    id: InventoryControlGroupId;
    title: string;
    sortable: boolean;
    rows: InventoryControlRow[];
}

type EntryState = { isDamaged: boolean; isDisabled: boolean; hitMod: number };
type EntryStateRules = { computeAllEntryStates?: () => Map<MountedEquipment, EntryState> };

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

const GROUP_TITLES: Record<InventoryControlGroupId, string> = {
    ranged: 'Ranged Weapons',
    physical: 'Physical Weapons',
    equipment: 'Equipment'
};

const JAMMED_STATE_VALUE = 'jammed';
export const BUILT_IN_ONE_SHOT_AMMO_OPTION_ID = '__built_in_one_shot__';

export function inventoryControlSortKey(groupId: InventoryControlGroupId): string {
    return `${INVENTORY_CONTROL_SORT_STATE}:${groupId}`;
}

export function setInventoryControlSortOrder(rows: InventoryControlRow[]): void {
    if (rows.length === 0) return;
    const sortKey = inventoryControlSortKey(rows[0].category);
    rows.forEach((row, index) => {
        row.entry.states.set(sortKey, index.toString());
        row.entry.owner.setInventoryEntry(row.entry);
    });
}

export function setInventoryControlMode(entry: MountedEquipment, mode: string): void {
    entry.states.set(INVENTORY_CONTROL_MODE_STATE, mode);
    syncSvgMode(entry, mode);
    entry.owner.setInventoryEntry(entry);
}

export function getInventoryControlGroups(unit: CBTForceUnit, equipmentMap: EquipmentMap = {}): InventoryControlGroup[] {
    const entryStates = getEntryStates(unit);
    const ammoSources = getAmmoSources(unit, equipmentMap);
    const rows = unit.getInventory()
        .flatMap((entry, index) => buildInventoryControlRows(entry, index, entryStates, ammoSources))
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
    chooseTarget?: (selectedTargetId: InventoryControlRuntimeTargetId | null, targets: readonly InventoryControlRuntimeTarget[]) => void
): boolean {
    if (!isInventoryControlSelectableEntry(entry)) return false;

    const targets = unit.getInventoryControlTargets();
    if (targets.length === 0) {
        unit.setInventoryControlEntrySelected(entry, !unit.isInventoryControlEntrySelected(entry.id));
        return true;
    }

    if (targets.length === 1) {
        const targetId = targets[0].id;
        const selectedTargetId = unit.getInventoryControlEntryTargetId(entry.id);
        unit.setInventoryControlEntryTarget(entry, selectedTargetId === targetId ? null : targetId);
        return true;
    }

    chooseTarget?.(unit.getInventoryControlEntryTargetId(entry.id) ?? null, targets);
    return false;
}

export function getInventoryControlModes(entry: MountedEquipment): InventoryControlMode[] {
    return readAlternativeModes(entry).modes;
}

export function getSelectedInventoryControlMode(entry: MountedEquipment): string | null {
    return getSelectedMode(entry, getInventoryControlModes(entry));
}

export function getInventoryControlModeAmmoSummary(
    entry: MountedEquipment,
    equipmentMap: EquipmentMap,
    mode: string | null = getSelectedInventoryControlMode(entry)
): InventoryControlAmmoSummary {
    return getInventoryControlAmmoSummary(entry, getAmmoSources(entry.owner, equipmentMap), mode);
}

function getInventoryControlAmmoSummary(
    entry: MountedEquipment,
    ammoSources: AmmoSource[],
    mode: string | null,
    locationLock?: string
): InventoryControlAmmoSummary {
    if (!(entry.equipment instanceof WeaponEquipment)) {
        return { tracksAmmo: false, remaining: 0, total: 0, options: [] };
    }

    const builtInShotCapacity = getBuiltInOneShotCapacity(entry);
    if (builtInShotCapacity > 0) {
        return getBuiltInOneShotAmmoSummary(entry, builtInShotCapacity);
    }

    if (entry.equipment.ammoType === 'NA') {
        return { tracksAmmo: false, remaining: 0, total: 0, options: [] };
    }

    const matchingAmmo = ammoSources
        .filter(source => ammoMatchesWeaponMode(entry.equipment as WeaponEquipment, source.ammo, mode))
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
            remaining: source.destroyed ? 0 : Math.max(0, source.total - source.consumed),
            total: source.total,
            destroyed: source.destroyed,
            disabled: source.destroyed
        }))
    };
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

function getBuiltInOneShotAmmoSummary(entry: MountedEquipment, capacity: number): InventoryControlAmmoSummary {
    const consumed = getBuiltInOneShotConsumed(entry);
    const remaining = Math.max(0, capacity - consumed);
    return {
        tracksAmmo: true,
        remaining,
        total: capacity,
        options: [{
            id: BUILT_IN_ONE_SHOT_AMMO_OPTION_ID,
            label: `Built-in (${remaining}/${capacity})`,
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
    // if (isCritBasedInventoryRow(a) && isCritBasedInventoryRow(b)) {
    //     const aInactive = a.destroyed || a.disabled;
    //     const bInactive = b.destroyed || b.disabled;
    //     if (aInactive !== bInactive) return aInactive ? 1 : -1;
    // }

    const sortKey = inventoryControlSortKey(groupId);
    const aOrder = Number(a.entry.states.get(sortKey));
    const bOrder = Number(b.entry.states.get(sortKey));
    const aHasOrder = Number.isFinite(aOrder);
    const bHasOrder = Number.isFinite(bOrder);

    if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
    return a.originalIndex - b.originalIndex;
}

function isCritBasedInventoryRow(row: InventoryControlRow): boolean {
    return !!row.entry.critSlots?.length;
}

function buildInventoryControlRow(
    entry: MountedEquipment,
    originalIndex: number,
    entryStates: Map<MountedEquipment, EntryState>,
    ammoSources: AmmoSource[],
    options: InventoryControlRowOptions = {}
): InventoryControlRow | null {
    if (!entry.el?.classList.contains('inventoryEntry')) return null;
    if (isLinkedWeaponEnhancement(entry)) return null;

    const state = entryStates.get(entry);
    const destroyed = options.destroyed ?? isMountedDestroyed(entry);
    const disabled = isInventoryControlEntryDisabled(entry, state);
    const category = getEntryCategory(entry);
    const additionalHitModifier = state?.hitMod ?? computeLinkedModifiers(entry);
    const hitModifier = resolveHitModifier(entry, additionalHitModifier);
    const hit = formatHitModifier(hitModifier);
    const base = readEntryDisplayData(entry.el, hit);
    if (options.locationLock) {
        base.location = formatBattleArmorTrooperLocation(options.locationLock);
    }
    const { modes, modifiers } = readInventoryControlModesAndModifiers(entry);
    const selectedMode = getSelectedMode(entry, modes);
    syncSvgMode(entry, selectedMode, disabled);
    const rowEntry = createInventoryControlRowEntry(entry, options);
    const selectedModeData = selectedMode ? modes.find(mode => mode.mode === selectedMode)?.data : null;
    const display = selectedModeData ? mergeModeData(base, selectedModeData) : base;
    const selectedRange = entry.owner.getInventoryControlEntryRange?.(rowEntry.id) ?? null;
    const ammo = getInventoryControlAmmoSummary(entry, ammoSources, selectedMode, options.locationLock);

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
        display: applySelectedRangeDisplay(rowEntry, display, selectedRange, additionalHitModifier),
        modes,
        modifiers,
        selectedMode,
        ammo
    };
}

function createInventoryControlRowEntry(entry: MountedEquipment, options: InventoryControlRowOptions): MountedEquipment {
    if (!options.rowId) return entry;
    const states = new Map(entry.states);
    states.set(INVENTORY_CONTROL_VIRTUAL_TROOPER_ROW_STATE, '1');
    return { ...entry, id: options.rowId, states };
}

function buildInventoryControlRows(
    entry: MountedEquipment,
    originalIndex: number,
    entryStates: Map<MountedEquipment, EntryState>,
    ammoSources: AmmoSource[]
): Array<InventoryControlRow | null> {
    const trooperLocations = getBattleArmorWeaponTrooperLocations(entry);
    if (trooperLocations.length === 0) {
        return [buildInventoryControlRow(entry, originalIndex, entryStates, ammoSources)];
    }

    return trooperLocations.map((location, locationIndex) => buildInventoryControlRow(entry, originalIndex + (locationIndex / 100), entryStates, ammoSources, {
        rowId: `${entry.id}:${location}`,
        locationLock: location,
        destroyed: isMountedDestroyed(entry) || isBattleArmorTrooperLocationDestroyed(entry.owner, location)
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

function getEntryStates(unit: CBTForceUnit): Map<MountedEquipment, EntryState> {
    const rules = unit.rules as EntryStateRules;
    return rules.computeAllEntryStates?.() ?? new Map<MountedEquipment, EntryState>();
}

function isInventoryControlEntryDisabled(entry: MountedEquipment, state?: EntryState): boolean {
    return !!state?.isDisabled || entry.states.get('state') === JAMMED_STATE_VALUE;
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

function getSelectedMode(entry: MountedEquipment, modes: InventoryControlMode[]): string | null {
    if (modes.length === 0) return null;

    const persistedMode = entry.states.get(INVENTORY_CONTROL_MODE_STATE);
    if (persistedMode && modes.some(mode => mode.mode === persistedMode)) return persistedMode;

    const svgSelectedMode = modes.find(mode => entry.el?.querySelector(`:scope > .alternativeMode[mode="${CSS.escape(mode.mode)}"].selected`))?.mode;
    if (svgSelectedMode) return svgSelectedMode;

    return modes[0].mode;
}

function readEntryDisplayData(el: SVGElement, hit: string): InventoryControlDisplayData {
    return {
        name: readDirectText(el, '.name') || el.getAttribute('id') || '',
        location: normalizeCell(readDirectText(el, '.location')),
        heat: normalizeCell(readDirectText(el, '.heat')),
        damage: normalizeCell(readDamageText(el)),
        hit,
        min: normalizeCell(readDirectText(el, '.range_min')),
        short: normalizeCell(readDirectText(el, '.range_short')),
        medium: normalizeCell(readDirectText(el, '.range_medium')),
        long: normalizeCell(readDirectText(el, '.range_long')),
    };
}

function readInventoryControlModesAndModifiers(entry: MountedEquipment): { modes: InventoryControlMode[]; modifiers: InventoryControlModifier[] } {
    const { modes, modifiers } = readAlternativeModes(entry);
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

        if (hasModeData(data)) {
            modes.push({ mode, name: data.name, data });
        } else {
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
            destroyed: isMountedDestroyed(linked)
        })) ?? [];
}

function readLinkedModifierName(entry: MountedEquipment): string {
    return (entry.el ? readDirectText(entry.el, '.name') : '') || entry.equipment?.shortName || entry.name;
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
        return isMountedDestroyed(linked) && linkedNames.some(name => {
            const normalizedLinkedName = normalizeEquipmentName(name ?? '');
            return normalizedLinkedName.length > 0
                && (normalizedModifier.includes(normalizedLinkedName) || normalizedLinkedName.includes(normalizedModifier));
        });
    });
}

function getAmmoSources(unit: CBTForceUnit, equipmentMap: EquipmentMap): AmmoSource[] {
    const critSources = unit.getCritSlots()
        .map(createCriticalSlotAmmoSource)
        .filter((source): source is AmmoSource => !!source);
    const inventorySources = unit.getInventory()
        .map(entry => createInventoryAmmoSource(entry, equipmentMap))
        .filter((source): source is AmmoSource => !!source);

    return [...critSources, ...inventorySources];
}

function createCriticalSlotAmmoSource(criticalSlot: CriticalSlot): AmmoSource | null {
    if (!(criticalSlot.eq instanceof AmmoEquipment)) return null;
    const elementTotal = Number(criticalSlot.el?.getAttribute('totalAmmo') ?? 0);
    return {
        id: `crit:${criticalSlot.loc ?? ''}:${criticalSlot.slot ?? ''}:${criticalSlot.name ?? criticalSlot.id}`,
        ammo: criticalSlot.eq,
        locationLabel: criticalSlot.loc ?? 'Ammo',
        total: criticalSlot.totalAmmo || elementTotal || 0,
        consumed: criticalSlot.consumed ?? 0,
        destroyed: !!criticalSlot.destroyed
    };
}

function createInventoryAmmoSource(entry: MountedEquipment, equipmentMap: EquipmentMap): AmmoSource | null {
    const currentAmmo = entry.ammo ? equipmentMap[entry.ammo] : entry.equipment;
    const ammo = currentAmmo instanceof AmmoEquipment
        ? currentAmmo
        : entry.equipment instanceof AmmoEquipment ? entry.equipment : null;
    if (!ammo) return null;

    const total = entry.totalAmmo ?? getInventoryOriginalTotalAmmo(entry, ammo);
    const locationLabel = Array.from(entry.locations ?? []).join('/') || 'Ammo';
    return {
        id: `inventory:${entry.id}`,
        ammo,
        locationLabel,
        total,
        consumed: entry.consumed ?? 0,
        destroyed: !!entry.destroyed || isBattleArmorTrooperLocationDestroyed(entry.owner, locationLabel)
    };
}

function getInventoryOriginalTotalAmmo(entry: MountedEquipment, ammo: AmmoEquipment): number {
    const componentRef = getInventoryComponentRef(entry);
    const component = componentRef === null ? undefined : entry.owner.getUnit().comp[componentRef.componentIndex];
    const binCount = Math.max(1, component?.q ?? 1);
    const totalAmmo = component?.q2 || (ammo.shots * binCount) || entry.totalAmmo || 0;
    if (componentRef?.binIndex === null) return totalAmmo;
    const baseBinAmmo = Math.floor(totalAmmo / binCount);
    const extraBinAmmo = totalAmmo % binCount;
    return baseBinAmmo + (componentRef && componentRef.binIndex < extraBinAmmo ? 1 : 0);
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

function ammoMatchesWeaponMode(weapon: WeaponEquipment, ammo: AmmoEquipment, mode: string | null): boolean {
    if (weapon.ammoType === 'NA') return false;
    if (ammo.ammoType !== weapon.ammoType) return false;
    if (weapon.rackSize > 0 && ammo.rackSize !== weapon.rackSize) return false;

    const normalizedMode = (mode ?? '').toLocaleLowerCase();
    if (weapon.ammoType === 'MML') {
        if (normalizedMode.includes('lrm')) {
            return ammo.hasFlag('F_MML_LRM') || ammo.shortName.toLocaleLowerCase().includes('lrm') || ammo.name.toLocaleLowerCase().includes('lrm');
        }
        if (normalizedMode.includes('srm')) {
            return ammo.hasFlag('F_MML_SRM') || ammo.shortName.toLocaleLowerCase().includes('srm') || ammo.name.toLocaleLowerCase().includes('srm');
        }
    }

    if (weapon.ammoType === 'ATM' || weapon.ammoType === 'IATM') {
        const requiredMunition = getAtmMunitionType(mode);
        return !requiredMunition || ammo.hasMunitionType(requiredMunition);
    }

    return true;
}

function getAtmMunitionType(mode: string | null): string | null {
    const normalizedMode = (mode ?? '').toLocaleLowerCase();
    if (normalizedMode.includes('extended')) return 'M_EXTENDED_RANGE';
    if (normalizedMode.includes('explosive')) return 'M_HIGH_EXPLOSIVE';
    if (normalizedMode.includes('standard')) return 'M_STANDARD';
    return null;
}

export function formatInventoryControlModeName(modeName: string): string {
    return INVENTORY_CONTROL_MODE_DISPLAY_NAMES[modeName] ?? modeName;
}

function normalizeEquipmentName(value: string): string {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function applySelectedRangeDisplay(
    entry: MountedEquipment,
    display: InventoryControlDisplayData,
    selectedRange: WeaponRangeKey | null,
    additionalHitModifier: number
): InventoryControlDisplayData {
    const damage = resolveWeaponRangeDamageText(entry, selectedRange, display.damage);
    const hit = formatHitModifier(resolveHitModifier(entry, additionalHitModifier, selectedRange));
    if (damage === null && hit === display.hit) return display;
    return {
        ...display,
        damage: damage ?? display.damage,
        hit
    };
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
    const originalText = damageEl
        ?.querySelector(`:scope > text[${WEAPON_RANGE_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE}]`)
        ?.getAttribute(WEAPON_RANGE_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE);
    return (originalText ?? damageEl?.textContent ?? '').trim();
}

function normalizeCell(value: string): string {
    const text = value.trim();
    return text.length > 0 ? text : '—';
}

function formatHitModifier(hitModifier: number | 'Vs' | '*' | null): string {
    if (hitModifier === null) return '—';
    if (hitModifier === 'Vs' || hitModifier === '*') return hitModifier;
    return hitModifier >= 0 ? `+${hitModifier}` : hitModifier.toString();
}

export function syncSvgMode(entry: MountedEquipment, mode: string | null, disabled = isInventoryControlEntryDisabled(entry, getEntryStates(entry.owner).get(entry))): void {
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
