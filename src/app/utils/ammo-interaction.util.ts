import { firstValueFrom } from 'rxjs';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from '../components/set-ammo-dialog/set-ammo.dialog.component';
import { AmmoEquipment, findIntrinsicAmmoForWeapon, WeaponEquipment, type EquipmentMap } from '../models/equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getMountedOneShotConsumed, MountedAmmo, MountedEquipment } from '../models/mounted-equipment.model';
import { parseInventoryComponentReference } from '../models/inventory-component-reference.model';
import { type CriticalSlot, type LocationData } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import type { CBTGameRules } from '../models/rules/game-rules';
import type { Unit } from '../models/units.model';
import { normalizeBattleArmorTrooperLocation } from '../models/battle-armor-location.model';

export const INTRINSIC_ONE_SHOT_AMMO_STATE = 'intrinsic_one_shot_ammo';

export interface AmmoControlEntry {
    id: string;
    owner: CBTForceUnit;
    source: CriticalSlot | MountedEquipment;
    sourceType: 'crit' | 'inventory';
    locationLabel: string;
    displayName: string;
    displayBinName: string;
    currentAmmo: AmmoEquipment;
    originalAmmo: AmmoEquipment;
    originalTotalAmmo: number;
    totalAmmo: number;
    consumed: number;
    destroyed: boolean;
}

export interface AmmoControlGroupLocation {
    loc: string;
    quantity: number;
    state: 'normal' | 'exposed' | 'destroyed';
}

export interface AmmoControlGroup {
    id: string;
    entries: AmmoControlEntry[];
    displayName: string;
    locations: AmmoControlGroupLocation[];
    totalAmmo: number;
    consumed: number;
    destroyed: boolean;
    expandable: boolean;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function formatAmmoName(ammo: AmmoEquipment): string {
    return ammo.shortName.endsWith(' Ammo') ? ammo.shortName.slice(0, -5) : ammo.shortName;
}

function getAmmoControlDisplayName(ammo: AmmoEquipment): string {
    return ammo.name.endsWith(' Ammo') ? ammo.name.slice(0, -5) : ammo.name;
}

export function formatBattleArmorTrooperLocation(locationLabel: string): string {
    return normalizeBattleArmorTrooperLocation(locationLabel);
}

function formatAmmoBinName(index: number): string {
    return `#${index} Bin`;
}

export function getCriticalSlotAmmoProfileKey(criticalSlot: CriticalSlot): string | null {
    if (!(criticalSlot.eq instanceof AmmoEquipment)) return null;
    return `(${formatAmmoName(criticalSlot.eq)})`;
}

function getCriticalSlotElement(unit: CBTForceUnit, criticalSlot: CriticalSlot): SVGElement | null {
    if (criticalSlot.el) return criticalSlot.el;
    if (!criticalSlot.loc || criticalSlot.slot === undefined) return null;
    return unit.svg()?.querySelector(`.critSlot[loc="${criticalSlot.loc}"][slot="${criticalSlot.slot}"]`) ?? null;
}

function getCriticalSlotTotalAmmo(unit: CBTForceUnit, criticalSlot: CriticalSlot): number {
    const elementTotal = Number(getCriticalSlotElement(unit, criticalSlot)?.getAttribute('totalAmmo') ?? 0);
    return criticalSlot.totalAmmo || elementTotal || 0;
}

function getOriginalTotalAmmo(unit: CBTForceUnit, criticalSlot: CriticalSlot): number {
    const elementTotal = Number(getCriticalSlotElement(unit, criticalSlot)?.getAttribute('totalAmmo') ?? 0);
    return elementTotal || criticalSlot.totalAmmo || 0;
}

function resolveOriginalAmmo(criticalSlot: CriticalSlot, equipmentMap: EquipmentMap): AmmoEquipment | null {
    const originalEquipment = criticalSlot.originalName ? equipmentMap[criticalSlot.originalName] : criticalSlot.eq;
    if (originalEquipment instanceof AmmoEquipment) return originalEquipment;
    return criticalSlot.eq instanceof AmmoEquipment ? criticalSlot.eq : null;
}

export function getAmmoControlEntryForCriticalSlot(unit: CBTForceUnit, criticalSlot: CriticalSlot, equipmentMap: EquipmentMap): AmmoControlEntry | null {
    if (!(criticalSlot.eq instanceof AmmoEquipment)) return null;
    const originalAmmo = resolveOriginalAmmo(criticalSlot, equipmentMap);
    if (!originalAmmo) return null;

    const totalAmmo = getCriticalSlotTotalAmmo(unit, criticalSlot);
    const locationLabel = criticalSlot.loc ?? 'Ammo';
    return {
        id: `crit:${criticalSlot.loc ?? ''}:${criticalSlot.slot ?? ''}:${criticalSlot.name ?? criticalSlot.id}`,
        owner: unit,
        source: criticalSlot,
        sourceType: 'crit',
        locationLabel,
        displayName: getAmmoControlDisplayName(criticalSlot.eq),
        displayBinName: formatAmmoBinName(1),
        currentAmmo: criticalSlot.eq,
        originalAmmo,
        originalTotalAmmo: getOriginalTotalAmmo(unit, criticalSlot),
        totalAmmo,
        consumed: criticalSlot.consumed ?? 0,
        destroyed: unit.isEquipmentUnavailable(criticalSlot)
    };
}

function getInventoryOriginalTotalAmmo(entry: MountedEquipment): number {
    if (isIntrinsicOneShotAmmoMount(entry)) return entry.totalAmmo ?? 0;
    const componentRef = parseInventoryComponentReference(entry.id);
    const component = componentRef === null ? undefined : entry.owner.getUnit().comp[componentRef.componentIndex];
    const originalAmmo = entry.equipment instanceof AmmoEquipment ? entry.equipment : null;
    const binCount = Math.max(1, component?.q ?? 1);
    const mountedMaxShots = entry instanceof MountedAmmo
        ? entry.getMaxShots()
        : originalAmmo ? (entry.owner.gameRules ? originalAmmo.getShots(entry.owner.gameRules) : originalAmmo.shots) : 0;
    const totalAmmo = component?.q2 || (mountedMaxShots * binCount) || entry.totalAmmo || 0;
    if (componentRef?.binIndex === null) return totalAmmo;
    const baseBinAmmo = Math.floor(totalAmmo / binCount);
    const extraBinAmmo = totalAmmo % binCount;
    return baseBinAmmo + (componentRef && componentRef.binIndex < extraBinAmmo ? 1 : 0);
}

function getInventoryCurrentAmmo(entry: MountedEquipment, equipmentMap: EquipmentMap): AmmoEquipment | null {
    const currentAmmo = entry.ammo ? equipmentMap[entry.ammo] : entry.equipment;
    if (currentAmmo instanceof AmmoEquipment) return currentAmmo;
    return entry.equipment instanceof AmmoEquipment ? entry.equipment : null;
}

function createInventoryAmmoControlEntry(unit: CBTForceUnit, inventoryEntry: MountedEquipment, equipmentMap: EquipmentMap): AmmoControlEntry | null {
    if (!(inventoryEntry.equipment instanceof AmmoEquipment)) return null;
    const currentAmmo = getInventoryCurrentAmmo(inventoryEntry, equipmentMap);
    if (!currentAmmo) return null;

    const originalTotalAmmo = getInventoryOriginalTotalAmmo(inventoryEntry);
    const totalAmmo = inventoryEntry.totalAmmo ?? originalTotalAmmo;
    const consumed = inventoryEntry.consumed ?? 0;
    const locationLabel = Array.from(inventoryEntry.locations ?? []).join('/') || 'Ammo';
    const destroyed = unit.isEquipmentUnavailable(inventoryEntry)
        || (isIntrinsicOneShotAmmoMount(inventoryEntry)
            && !!inventoryEntry.parent
            && unit.isEquipmentUnavailable(inventoryEntry.parent));
    return {
        id: `inventory:${inventoryEntry.id}`,
        owner: unit,
        source: inventoryEntry,
        sourceType: 'inventory',
        locationLabel,
        displayName: getAmmoControlDisplayName(currentAmmo),
        displayBinName: formatAmmoBinName(1),
        currentAmmo,
        originalAmmo: inventoryEntry.equipment,
        originalTotalAmmo,
        totalAmmo,
        consumed,
        destroyed
    };
}

function ammoMatchesWeapon(weapon: WeaponEquipment, ammo: AmmoEquipment): boolean {
    if (weapon.ammoType === 'NA') return false;
    if (weapon.rackSize <= 0) return ammo.ammoType === weapon.ammoType;
    return ammo.ammoType === weapon.ammoType && ammo.rackSize === weapon.rackSize;
}

export function isIntrinsicOneShotAmmoMount(entry: MountedEquipment): entry is MountedAmmo {
    return entry instanceof MountedAmmo && entry.intrinsicOneShotAmmo === true;
}

export function getIntrinsicOneShotAmmoMount(weaponEntry: MountedEquipment): MountedAmmo | null {
    return weaponEntry.linkedWith?.find(isIntrinsicOneShotAmmoMount) ?? null;
}

/**
 * Returns compatible catalog ammunition in the same stable order used by the
 * ammo loadout dialog.
 */
export function getCompatibleCatalogAmmo(
    originalAmmo: AmmoEquipment,
    equipmentMap: EquipmentMap,
    unit: Unit,
    inventory: readonly MountedEquipment[],
): AmmoEquipment[] {
    return sortCompatibleAmmo(Object.values(equipmentMap)
        .filter((equipment): equipment is AmmoEquipment =>
            equipment instanceof AmmoEquipment
            && originalAmmo.compatibleAmmo(equipment, unit, inventory)));
}

/**
 * Materializes the intrinsic round for one-shot weapons during unit
 * initialization. The derived mount is the canonical runtime ammo record and is
 * linked to its weapon solely to preserve the unit's source representation.
 */
export function materializeIntrinsicOneShotAmmoForInventory(
    inventory: readonly MountedEquipment[],
    equipmentMap: EquipmentMap,
): MountedAmmo[] {
    return inventory
        .map(weaponEntry => materializeIntrinsicOneShotAmmo(weaponEntry, equipmentMap, inventory))
        .filter((entry): entry is MountedAmmo => entry !== null);
}

function materializeIntrinsicOneShotAmmo(
    weaponEntry: MountedEquipment,
    equipmentMap: EquipmentMap,
    inventory: readonly MountedEquipment[],
): MountedAmmo | null {
    if (!(weaponEntry.equipment instanceof WeaponEquipment)
        || !weaponEntry.equipment.oneShotCount) {
        return null;
    }

    const originalAmmo = findIntrinsicAmmoForWeapon(weaponEntry.equipment, equipmentMap);
    if (!originalAmmo) return null;

    const compatibleAmmo = getCompatibleCatalogAmmo(
        originalAmmo,
        equipmentMap,
        weaponEntry.owner.getUnit(),
        inventory,
    );
    const selectedAmmoId = weaponEntry.states.get(INTRINSIC_ONE_SHOT_AMMO_STATE);
    const selectedAmmo = compatibleAmmo.find(ammo => ammo.internalName === selectedAmmoId) ?? originalAmmo;
    const capacity = weaponEntry.equipment.oneShotCount;
    const consumed = getMountedOneShotConsumed(weaponEntry);
    const existing = weaponEntry.linkedWith?.find(isIntrinsicOneShotAmmoMount);
    const mount = existing ?? new MountedAmmo({
        owner: weaponEntry.owner,
        id: `${weaponEntry.id}:intrinsic-one-shot-ammo`,
        name: originalAmmo.internalName,
        locations: weaponEntry.locations,
        equipment: originalAmmo,
        parent: weaponEntry,
        totalAmmo: capacity,
        intrinsicOneShotAmmo: true,
    });

    mount.parent = weaponEntry;
    mount.locations = weaponEntry.locations;
    mount.ammo = selectedAmmo.internalName === originalAmmo.internalName ? undefined : selectedAmmo.internalName;
    mount.totalAmmo = capacity;
    mount.consumed = consumed || undefined;
    mount.intrinsicOneShotAmmo = true;
    weaponEntry.linkedWith = [
        ...(weaponEntry.linkedWith ?? []).filter(linked => linked !== existing),
        mount,
    ];
    return mount;
}

function persistIntrinsicOneShotAmmo(
    entry: AmmoControlEntry,
    source: MountedAmmo,
): void {
    const parent = source.parent;
    if (parent?.equipment instanceof WeaponEquipment) {
        if (!source.ammo) {
            parent.deleteState(INTRINSIC_ONE_SHOT_AMMO_STATE);
        } else {
            parent.setState(INTRINSIC_ONE_SHOT_AMMO_STATE, source.ammo);
        }

        if (parent.critSlots?.length) {
            parent.critSlots[0].consumed = source.consumed || undefined;
            parent.owner.setCritSlot(parent.critSlots[0]);
        } else {
            parent.consumed = source.consumed || undefined;
        }
        parent.owner.setInventoryEntry(parent);
    }
}

/** Updates an ammo entry and persists it through its actual storage owner. */
export function setAmmoEntryValue(
    entry: AmmoControlEntry,
    selectedAmmo: AmmoEquipment,
    totalAmmo: number,
    remaining: number,
): void {
    if (entry.sourceType === 'inventory') {
        const source = entry.source as MountedEquipment;
        const intrinsicCapacity = isIntrinsicOneShotAmmoMount(source)
            && source.parent?.equipment instanceof WeaponEquipment
            ? source.parent.equipment.oneShotCount
            : undefined;
        const nextTotalAmmo = intrinsicCapacity ?? Math.max(0, totalAmmo);
        const nextConsumed = nextTotalAmmo - clamp(remaining, 0, nextTotalAmmo);
        source.ammo = selectedAmmo.internalName === source.equipment?.internalName
            ? undefined
            : selectedAmmo.internalName;
        source.totalAmmo = nextTotalAmmo;
        source.consumed = nextConsumed;
        if (isIntrinsicOneShotAmmoMount(source)) {
            persistIntrinsicOneShotAmmo(entry, source);
        } else {
            entry.owner.setInventoryEntry(source);
        }
        return;
    }

    const source = entry.source as CriticalSlot;
    const nextTotalAmmo = Math.max(0, totalAmmo);
    const nextConsumed = nextTotalAmmo - clamp(remaining, 0, nextTotalAmmo);
    if (selectedAmmo.internalName !== source.name) {
        if (!source.originalName) {
            source.originalName = source.name;
        } else if (selectedAmmo.internalName === source.originalName) {
            delete source.originalName;
        }
        source.name = selectedAmmo.internalName;
        source.eq = selectedAmmo;
    }
    source.totalAmmo = nextTotalAmmo;
    source.consumed = nextConsumed;
    entry.owner.setCritSlot(source);
}

function getAmmoCompatibilityKey(equipment: WeaponEquipment | AmmoEquipment): string {
    return equipment.rackSize > 0
        ? `${equipment.ammoType}:${equipment.rackSize}`
        : equipment.ammoType;
}

function sortAmmoControlEntries(entries: AmmoControlEntry[]): AmmoControlEntry[] {
    return entries.sort((a, b) => {
        const nameCompare = a.displayName.localeCompare(b.displayName);
        if (nameCompare !== 0) return nameCompare;
        const locationCompare = a.locationLabel.localeCompare(b.locationLabel);
        if (locationCompare !== 0) return locationCompare;
        return a.id.localeCompare(b.id);
    });
}

function compareAmmoControlEntryOrder(a: AmmoControlEntry, b: AmmoControlEntry): number {
    if (a.sourceType === 'crit' && b.sourceType === 'crit') {
        const aSlot = (a.source as CriticalSlot).slot ?? Number.MAX_SAFE_INTEGER;
        const bSlot = (b.source as CriticalSlot).slot ?? Number.MAX_SAFE_INTEGER;
        if (aSlot !== bSlot) return aSlot - bSlot;
    }

    return a.id.localeCompare(b.id);
}

export function getAmmoControlEntriesForWeapon(equipment: MountedEquipment, context: HandlerContext): AmmoControlEntry[] {
    if (!(equipment.equipment instanceof WeaponEquipment)) return [];
    const equipmentMap = context.dataService.getEquipments();
    const intrinsicAmmo = getIntrinsicOneShotAmmoMount(equipment);
    if (equipment.equipment.oneShotCount) {
        const intrinsicAmmoEntry = intrinsicAmmo
            ? createInventoryAmmoControlEntry(equipment.owner, intrinsicAmmo, equipmentMap)
            : null;
        return intrinsicAmmoEntry ? [intrinsicAmmoEntry] : [];
    }

    const critEntries = equipment.owner.getCritSlots()
        .filter(criticalSlot => criticalSlot.eq instanceof AmmoEquipment && ammoMatchesWeapon(equipment.equipment as WeaponEquipment, criticalSlot.eq))
        .map(criticalSlot => getAmmoControlEntryForCriticalSlot(equipment.owner, criticalSlot, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);
    const inventoryEntries = equipment.owner.getInventory()
        .filter(entry => !isIntrinsicOneShotAmmoMount(entry)
            && entry.equipment instanceof AmmoEquipment
            && ammoMatchesWeapon(equipment.equipment as WeaponEquipment, getInventoryCurrentAmmo(entry, equipmentMap) ?? entry.equipment))
        .map(entry => createInventoryAmmoControlEntry(equipment.owner, entry, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);
    return sortAmmoControlEntries([...critEntries, ...inventoryEntries]);
}

export function getAmmoControlEntriesForUnitWeapons(unit: CBTForceUnit, equipmentMap: EquipmentMap): AmmoControlEntry[] {
    const weaponAmmoKeys = new Set(
        unit.getInventory()
            .map(entry => entry.equipment)
            .filter((equipment): equipment is WeaponEquipment =>
                equipment instanceof WeaponEquipment
                && equipment.ammoType !== 'NA'
                && !equipment.oneShotCount)
            .map(weapon => getAmmoCompatibilityKey(weapon))
    );

    const critEntries = unit.getCritSlots()
        .filter(criticalSlot => criticalSlot.eq instanceof AmmoEquipment && weaponAmmoKeys.has(getAmmoCompatibilityKey(criticalSlot.eq)))
        .map(criticalSlot => getAmmoControlEntryForCriticalSlot(unit, criticalSlot, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);
    const inventoryEntries = unit.getInventory()
        .filter(entry => {
            if (isIntrinsicOneShotAmmoMount(entry)) return false;
            const ammo = getInventoryCurrentAmmo(entry, equipmentMap);
            return ammo && weaponAmmoKeys.has(getAmmoCompatibilityKey(ammo));
        })
        .map(entry => createInventoryAmmoControlEntry(unit, entry, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);
    const intrinsicEntries = unit.getInventory()
        .map(entry => getIntrinsicOneShotAmmoMount(entry))
        .filter((entry): entry is MountedAmmo => entry !== null)
        .map(entry => createInventoryAmmoControlEntry(unit, entry, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);

    return sortAmmoControlEntries([...critEntries, ...inventoryEntries, ...intrinsicEntries]);
}

export function getAmmoEntryRemaining(entry: AmmoControlEntry): number {
    if (entry.destroyed) return 0;
    return Math.max(0, entry.totalAmmo - entry.consumed);
}

export function getAmmoControlGroups(entries: AmmoControlEntry[]): AmmoControlGroup[] {
    const groups: AmmoControlGroup[] = [];
    const keyedGroups = new Map<string, AmmoControlGroup>();

    for (const entry of entries) {
        const intrinsicAmmo = entry.sourceType === 'inventory'
            && isIntrinsicOneShotAmmoMount(entry.source as MountedEquipment);
        const key = intrinsicAmmo
            ? `${entry.sourceType}:intrinsic:${entry.id}`
            : `${entry.sourceType}:${entry.currentAmmo.internalName}`;
        const existingGroup = keyedGroups.get(key);
        if (existingGroup) {
            existingGroup.entries.push(entry);
            syncGroupTotals(existingGroup);
        } else {
            const group = createAmmoControlGroup([entry]);
            keyedGroups.set(key, group);
            groups.push(group);
        }
    }

    return sortAmmoControlGroups(groups);
}

function createAmmoControlGroup(entries: AmmoControlEntry[]): AmmoControlGroup {
    const firstEntry = entries[0];
    const group: AmmoControlGroup = {
        id: entries.map(entry => entry.id).join('|'),
        entries,
        displayName: firstEntry.displayName,
        totalAmmo: 0,
        consumed: 0,
        destroyed: false,
        expandable: false,
        locations: [],
    };
    syncGroupTotals(group);
    return group;
}

function getArmorDamage(locationData: LocationData | undefined): number {
    return (locationData?.armor ?? 0) + (locationData?.pendingArmor ?? 0);
}

function isAmmoLocationExposed(entry: AmmoControlEntry, loc: string): boolean {
    const armor = entry.owner.locations?.armor;
    if (!armor) return false;

    const locations = entry.owner.getLocations?.() ?? {};
    const armorKeys = [loc, `${loc}-rear`].filter(armorKey => armor.has(armorKey));
    return armorKeys.some(armorKey => {
        const armorPoints = armor.get(armorKey)?.points ?? 0;
        return armorPoints > 0 && armorPoints - getArmorDamage(locations[armorKey]) <= 0;
    });
}

function getAmmoEntryLocationState(entry: AmmoControlEntry): AmmoControlGroupLocation['state'] {
    if (entry.destroyed) return 'destroyed';
    return isAmmoLocationExposed(entry, entry.locationLabel) ? 'exposed' : 'normal';
}

function getAmmoControlGroupLocations(entries: AmmoControlEntry[]): AmmoControlGroupLocation[] {
    const groupedLocations = new Map<string, AmmoControlGroupLocation>();
    for (const entry of entries) {
        const state = getAmmoEntryLocationState(entry);
        const key = `${entry.locationLabel}:${state}`;
        const location = groupedLocations.get(key);
        if (location) {
            location.quantity += 1;
        } else {
            groupedLocations.set(key, { loc: entry.locationLabel, quantity: 1, state });
        }
    }

    return Array.from(groupedLocations.values());
}

function syncGroupTotals(group: AmmoControlGroup): void {
    group.entries.sort(compareAmmoControlEntryOrder);
    group.entries.forEach((entry, index) => {
        entry.displayBinName = formatAmmoBinName(index + 1);
    });
    group.id = group.entries.map(entry => entry.id).join('|');
    group.locations = getAmmoControlGroupLocations(group.entries);
    group.totalAmmo = group.entries.reduce((total, entry) => total + entry.totalAmmo, 0);
    group.consumed = group.entries.reduce((total, entry) => total + entry.consumed, 0);
    group.destroyed = group.entries.every(entry => entry.destroyed);
    group.expandable = group.entries.length > 1;
}

function sortAmmoControlGroups(groups: AmmoControlGroup[]): AmmoControlGroup[] {
    return groups.sort((a, b) => {
        if (a.destroyed !== b.destroyed) return a.destroyed ? 1 : -1;
        const nameCompare = a.displayName.localeCompare(b.displayName);
        if (nameCompare !== 0) return nameCompare;
        return a.id.localeCompare(b.id);
    });
}

function syncEntryFromSource(entry: AmmoControlEntry, equipmentMap: EquipmentMap): void {
    if (entry.sourceType === 'inventory') {
        const source = entry.source as MountedEquipment;
        const currentAmmo = getInventoryCurrentAmmo(source, equipmentMap);
        if (currentAmmo) {
            entry.currentAmmo = currentAmmo;
            entry.displayName = getAmmoControlDisplayName(currentAmmo);
        }
        entry.originalAmmo = source.equipment instanceof AmmoEquipment ? source.equipment : entry.currentAmmo;
        entry.originalTotalAmmo = getInventoryOriginalTotalAmmo(source);
        entry.totalAmmo = source.totalAmmo ?? entry.originalTotalAmmo;
        entry.consumed = source.consumed ?? 0;
        entry.destroyed = entry.owner.isEquipmentUnavailable(source)
            || (isIntrinsicOneShotAmmoMount(source)
                && !!source.parent
                && entry.owner.isEquipmentUnavailable(source.parent));
        return;
    }

    const currentAmmo = (entry.source as CriticalSlot).eq;
    if (currentAmmo instanceof AmmoEquipment) {
        entry.currentAmmo = currentAmmo;
        entry.displayName = getAmmoControlDisplayName(currentAmmo);
    }
    entry.originalAmmo = resolveOriginalAmmo(entry.source as CriticalSlot, equipmentMap) ?? entry.currentAmmo;
    entry.originalTotalAmmo = getOriginalTotalAmmo(entry.owner, entry.source as CriticalSlot);
    entry.totalAmmo = getCriticalSlotTotalAmmo(entry.owner, entry.source as CriticalSlot);
    entry.consumed = (entry.source as CriticalSlot).consumed ?? 0;
    entry.destroyed = entry.owner.isEquipmentUnavailable(entry.source as CriticalSlot);
}

function showAmmoToast(entry: AmmoControlEntry, deltaRemaining: number, context: HandlerContext): void {
    const toastId = `ammo-control-${entry.owner.id}-${entry.id}`;
    const existingDelta = readAmmoToastDelta(context, toastId, deltaRemaining);
    const accumulatedDelta = existingDelta + deltaRemaining;
    const amountText = accumulatedDelta > 0 ? `+${accumulatedDelta}` : accumulatedDelta.toString();
    context.toastService.showToast(
        `${amountText} ${accumulatedDelta >= 0 ? 'to' : 'from'} ${entry.locationLabel} ${entry.displayName} (${getAmmoEntryRemaining(entry)}/${entry.totalAmmo})`,
        'info',
        toastId,
        { ammoDeltaRemaining: accumulatedDelta }
    );
}

function readAmmoToastDelta(context: HandlerContext, toastId: string, deltaRemaining: number): number {
    const existingToast = context.toastService.toasts().find(toast => toast.id === toastId);
    const delta = existingToast?.data?.['ammoDeltaRemaining'];
    return typeof delta === 'number' && Math.sign(delta) === Math.sign(deltaRemaining) ? delta : 0;
}

export function changeAmmoEntryRemaining(entry: AmmoControlEntry, deltaRemaining: number, context: HandlerContext): boolean {
    if (entry.destroyed) return false;
    const currentRemaining = getAmmoEntryRemaining(entry);
    const nextRemaining = clamp(currentRemaining + deltaRemaining, 0, entry.totalAmmo);
    const appliedDelta = nextRemaining - currentRemaining;
    if (appliedDelta === 0) return false;

    setAmmoEntryValue(entry, entry.currentAmmo, entry.totalAmmo, nextRemaining);
    syncEntryFromSource(entry, context.dataService.getEquipments());
    showAmmoToast(entry, appliedDelta, context);
    return true;
}

export function changeAmmoEntriesRemaining(entries: AmmoControlEntry[], deltaRemaining: number, context: HandlerContext): boolean {
    if (deltaRemaining === 0) return false;
    const sortedEntries = [...entries].sort(compareAmmoControlEntryOrder);
    const reversedEntries = [...sortedEntries].reverse();
    let remainingAdjustment = Math.abs(deltaRemaining);
    let changed = false;

    while (remainingAdjustment > 0) {
        const target = deltaRemaining < 0
            ? reversedEntries.find(entry => !entry.destroyed && getAmmoEntryRemaining(entry) > 0)
            : reversedEntries.find(entry => {
                const remaining = getAmmoEntryRemaining(entry);
                return !entry.destroyed && remaining > 0 && remaining < entry.totalAmmo;
            }) ?? sortedEntries.find(entry => !entry.destroyed && getAmmoEntryRemaining(entry) < entry.totalAmmo);
        if (!target || !changeAmmoEntryRemaining(target, deltaRemaining < 0 ? -1 : 1, context)) break;
        changed = true;
        remainingAdjustment -= 1;
    }

    return changed;
}

export function getAmmoGroupRemaining(group: AmmoControlGroup): number {
    return group.entries.reduce((total, entry) => total + getAmmoEntryRemaining(entry), 0);
}

export function changeAmmoGroupRemaining(group: AmmoControlGroup, deltaRemaining: number, context: HandlerContext): boolean {
    const changed = changeAmmoEntriesRemaining(group.entries, deltaRemaining, context);

    if (changed) syncGroupTotals(group);
    return changed;
}

function sortCompatibleAmmo(ammoOptions: AmmoEquipment[]): AmmoEquipment[] {
    const baseOrder: Record<string, number> = { 'All': 0, 'IS': 1, 'Clan': 2 };
    return ammoOptions.sort((a, b) => {
        const ao = baseOrder[(a.techBase || '')] ?? 3;
        const bo = baseOrder[(b.techBase || '')] ?? 3;
        if (ao !== bo) return ao - bo;
        if (!a.baseAmmo && b.baseAmmo) return -1;
        return a.name.localeCompare(b.name);
    });
}

function getTotalAmmoForAmmoType(originalAmmo: AmmoEquipment, originalTotalAmmo: number, selectedAmmo: AmmoEquipment, gameRules: CBTGameRules): number {
    const selectedKgPerShot = selectedAmmo.getEffectiveKgPerShot(gameRules);
    if (selectedKgPerShot <= 0) return originalTotalAmmo;
    return Math.floor((originalAmmo.getEffectiveKgPerShot(gameRules) * originalTotalAmmo) / selectedKgPerShot);
}

export async function setAmmoEntry(entry: AmmoControlEntry, context: HandlerContext): Promise<boolean> {
    if (entry.destroyed) return false;

    const equipmentMap = context.dataService.getEquipments();
    const unitBlueprint = entry.owner.getUnit();
    const inventory = entry.owner.getInventory();
    const compatibleAmmo = getCompatibleCatalogAmmo(entry.originalAmmo, equipmentMap, unitBlueprint, inventory);

    const previousRemaining = getAmmoEntryRemaining(entry);
    const ref = context.dialogsService.createDialog<{ name: string; quantity: number, totalAmmo: number } | null>(SetAmmoDialogComponent, {
        data: {
            currentAmmo: entry.currentAmmo,
            originalAmmo: entry.originalAmmo,
            originalTotalAmmo: entry.originalTotalAmmo,
            ammoOptions: compatibleAmmo,
            quantity: previousRemaining,
            maxQuantity: entry.totalAmmo,
            unitType: unitBlueprint.type,
            era: entry.owner.force.era(),
            inventory,
            gameRules: entry.owner.gameRules,
        } as SetAmmoDialogData
    });

    const newAmmoValue = await firstValueFrom(ref.closed);
    if (!newAmmoValue) return false;

    const selectedAmmo = equipmentMap[newAmmoValue.name] instanceof AmmoEquipment
        ? equipmentMap[newAmmoValue.name] as AmmoEquipment
        : entry.currentAmmo;
    const intrinsic = isIntrinsicOneShotAmmoMount(entry.source as MountedEquipment);
    const newTotalAmmo = intrinsic
        ? entry.totalAmmo
        : getTotalAmmoForAmmoType(entry.originalAmmo, entry.originalTotalAmmo, selectedAmmo, entry.owner.gameRules);
    setAmmoEntryValue(entry, selectedAmmo, newTotalAmmo, newAmmoValue.quantity);
    syncEntryFromSource(entry, equipmentMap);

    const appliedDelta = getAmmoEntryRemaining(entry) - previousRemaining;
    if (appliedDelta !== 0) {
        showAmmoToast(entry, appliedDelta, context);
    }
    return true;
}

export async function setAmmoGroup(group: AmmoControlGroup, context: HandlerContext): Promise<boolean> {
    if (group.entries.length === 1) return setAmmoEntry(group.entries[0], context);
    if (group.destroyed) return false;

    const firstEntry = group.entries[0];
    const equipmentMap = context.dataService.getEquipments();
    const unitBlueprint = firstEntry.owner.getUnit();
    const inventory = firstEntry.owner.getInventory();
    const originalTotalAmmo = group.entries.reduce((total, entry) => total + entry.originalTotalAmmo, 0);
    const previousRemaining = getAmmoGroupRemaining(group);
    const compatibleAmmo = sortCompatibleAmmo(Object.values(equipmentMap)
        .filter((equipment): equipment is AmmoEquipment => (equipment instanceof AmmoEquipment) && firstEntry.originalAmmo.compatibleAmmo(equipment, unitBlueprint, inventory)));

    const ref = context.dialogsService.createDialog<{ name: string; quantity: number, totalAmmo: number } | null>(SetAmmoDialogComponent, {
        data: {
            currentAmmo: firstEntry.currentAmmo,
            originalAmmo: firstEntry.originalAmmo,
            originalTotalAmmo,
            ammoOptions: compatibleAmmo,
            quantity: previousRemaining,
            maxQuantity: group.totalAmmo,
            unitType: unitBlueprint.type,
            era: firstEntry.owner.force.era(),
            inventory,
            gameRules: firstEntry.owner.gameRules,
        } as SetAmmoDialogData
    });

    const newAmmoValue = await firstValueFrom(ref.closed);
    if (!newAmmoValue) return false;

    const selectedAmmo = equipmentMap[newAmmoValue.name] instanceof AmmoEquipment
        ? equipmentMap[newAmmoValue.name] as AmmoEquipment
        : firstEntry.currentAmmo;
    let remainingToAllocate = clamp(newAmmoValue.quantity, 0, getTotalAmmoForAmmoType(firstEntry.originalAmmo, originalTotalAmmo, selectedAmmo, firstEntry.owner.gameRules));

    for (const entry of group.entries.sort(compareAmmoControlEntryOrder)) {
        const newTotalAmmo = isIntrinsicOneShotAmmoMount(entry.source as MountedEquipment)
            ? entry.totalAmmo
            : getTotalAmmoForAmmoType(entry.originalAmmo, entry.originalTotalAmmo, selectedAmmo, entry.owner.gameRules);
        const newRemaining = Math.min(newTotalAmmo, remainingToAllocate);
        remainingToAllocate -= newRemaining;
        setAmmoEntryValue(entry, selectedAmmo, newTotalAmmo, newRemaining);
        syncEntryFromSource(entry, equipmentMap);
    }

    syncGroupTotals(group);
    const appliedDelta = getAmmoGroupRemaining(group) - previousRemaining;
    if (appliedDelta !== 0) {
        context.toastService.showToast(
            `${appliedDelta > 0 ? `+${appliedDelta}` : appliedDelta.toString()} ${appliedDelta >= 0 ? 'to' : 'from'} ${group.displayName} (${getAmmoGroupRemaining(group)}/${group.totalAmmo})`,
            'info',
            `ammo-control-${firstEntry.owner.id}-${group.id}`
        );
    }
    return true;
}