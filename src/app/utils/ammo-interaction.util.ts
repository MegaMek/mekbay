import { firstValueFrom } from 'rxjs';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from '../components/set-ammo-dialog/set-ammo.dialog.component';
import { AmmoEquipment, WeaponEquipment, type EquipmentMap } from '../models/equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CriticalSlot, LocationData, MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';

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

function createCriticalSlotAmmoControlEntry(unit: CBTForceUnit, criticalSlot: CriticalSlot, equipmentMap: EquipmentMap): AmmoControlEntry | null {
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
        destroyed: !!criticalSlot.destroyed
    };
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

function getInventoryOriginalTotalAmmo(entry: MountedEquipment): number {
    const componentRef = getInventoryComponentRef(entry);
    const component = componentRef === null ? undefined : entry.owner.getUnit().comp[componentRef.componentIndex];
    const originalAmmo = entry.equipment instanceof AmmoEquipment ? entry.equipment : null;
    const binCount = Math.max(1, component?.q ?? 1);
    const totalAmmo = component?.q2 || (originalAmmo ? originalAmmo.shots * binCount : 0) || entry.totalAmmo || 0;
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
    const locationLabel = Array.from(inventoryEntry.locations ?? []).join('/') || 'Ammo';
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
        consumed: inventoryEntry.consumed ?? 0,
        destroyed: !!inventoryEntry.destroyed
    };
}

function ammoMatchesWeapon(weapon: WeaponEquipment, ammo: AmmoEquipment): boolean {
    if (weapon.ammoType === 'NA') return false;
    if (weapon.rackSize <= 0) return ammo.ammoType === weapon.ammoType;
    return ammo.ammoType === weapon.ammoType && ammo.rackSize === weapon.rackSize;
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

    const critEntries = equipment.owner.getCritSlots()
        .filter(criticalSlot => criticalSlot.eq instanceof AmmoEquipment && ammoMatchesWeapon(equipment.equipment as WeaponEquipment, criticalSlot.eq))
        .map(criticalSlot => createCriticalSlotAmmoControlEntry(equipment.owner, criticalSlot, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);
    const inventoryEntries = equipment.owner.getInventory()
        .filter(entry => entry.equipment instanceof AmmoEquipment && ammoMatchesWeapon(equipment.equipment as WeaponEquipment, getInventoryCurrentAmmo(entry, equipmentMap) ?? entry.equipment))
        .map(entry => createInventoryAmmoControlEntry(equipment.owner, entry, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);

    return sortAmmoControlEntries([...critEntries, ...inventoryEntries]);
}

export function getAmmoControlEntriesForUnitWeapons(unit: CBTForceUnit, equipmentMap: EquipmentMap): AmmoControlEntry[] {
    const weaponAmmoKeys = new Set(
        unit.getInventory()
            .map(entry => entry.equipment)
            .filter((equipment): equipment is WeaponEquipment => equipment instanceof WeaponEquipment && equipment.ammoType !== 'NA')
            .map(weapon => getAmmoCompatibilityKey(weapon))
    );

    if (weaponAmmoKeys.size === 0) return [];

    const critEntries = unit.getCritSlots()
        .filter(criticalSlot => criticalSlot.eq instanceof AmmoEquipment && weaponAmmoKeys.has(getAmmoCompatibilityKey(criticalSlot.eq)))
        .map(criticalSlot => createCriticalSlotAmmoControlEntry(unit, criticalSlot, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);
    const inventoryEntries = unit.getInventory()
        .filter(entry => {
            const ammo = getInventoryCurrentAmmo(entry, equipmentMap);
            return ammo && weaponAmmoKeys.has(getAmmoCompatibilityKey(ammo));
        })
        .map(entry => createInventoryAmmoControlEntry(unit, entry, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry);

    return sortAmmoControlEntries([...critEntries, ...inventoryEntries]);
}

export function getAmmoEntryRemaining(entry: AmmoControlEntry): number {
    if (entry.destroyed) return 0;
    return Math.max(0, entry.totalAmmo - entry.consumed);
}

export function getAmmoControlGroups(entries: AmmoControlEntry[]): AmmoControlGroup[] {
    const groups: AmmoControlGroup[] = [];
    const keyedGroups = new Map<string, AmmoControlGroup>();

    for (const entry of entries) {
        const key = `${entry.sourceType}:${entry.currentAmmo.internalName}`;
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

function getAmmoLocationState(entries: AmmoControlEntry[], loc: string): AmmoControlGroupLocation['state'] {
    if (entries.every(entry => entry.destroyed)) return 'destroyed';
    return entries.some(entry => isAmmoLocationExposed(entry, loc)) ? 'exposed' : 'normal';
}

function getAmmoControlGroupLocations(entries: AmmoControlEntry[]): AmmoControlGroupLocation[] {
    const groupedLocations = new Map<string, AmmoControlEntry[]>();
    for (const entry of entries) {
        const locationEntries = groupedLocations.get(entry.locationLabel);
        if (locationEntries) {
            locationEntries.push(entry);
        } else {
            groupedLocations.set(entry.locationLabel, [entry]);
        }
    }

    return Array.from(groupedLocations, ([loc, locationEntries]) => ({
        loc,
        quantity: locationEntries.length,
        state: getAmmoLocationState(locationEntries, loc),
    }));
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
        entry.destroyed = !!source.destroyed;
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
    entry.destroyed = !!(entry.source as CriticalSlot).destroyed;
}

function showAmmoToast(entry: AmmoControlEntry, deltaRemaining: number, context: HandlerContext): void {
    const amountText = deltaRemaining > 0 ? `+${deltaRemaining}` : deltaRemaining.toString();
    context.toastService.showToast(
        `${amountText} ${deltaRemaining >= 0 ? 'to' : 'from'} ${entry.locationLabel} ${entry.displayName} (${getAmmoEntryRemaining(entry)}/${entry.totalAmmo})`,
        'info',
        `ammo-control-${entry.owner.id}-${entry.id}`
    );
}

export function changeAmmoEntryRemaining(entry: AmmoControlEntry, deltaRemaining: number, context: HandlerContext): boolean {
    if (entry.destroyed) return false;
    const currentRemaining = getAmmoEntryRemaining(entry);
    const nextRemaining = clamp(currentRemaining + deltaRemaining, 0, entry.totalAmmo);
    const appliedDelta = nextRemaining - currentRemaining;
    if (appliedDelta === 0) return false;

    entry.source.consumed = entry.totalAmmo - nextRemaining;
    if (entry.sourceType === 'inventory') {
        entry.owner.setInventoryEntry(entry.source as MountedEquipment);
    } else {
        entry.owner.setCritSlot(entry.source as CriticalSlot);
    }
    syncEntryFromSource(entry, context.dataService.getEquipments());
    showAmmoToast(entry, appliedDelta, context);
    return true;
}

export function getAmmoGroupRemaining(group: AmmoControlGroup): number {
    return group.entries.reduce((total, entry) => total + getAmmoEntryRemaining(entry), 0);
}

export function changeAmmoGroupRemaining(group: AmmoControlGroup, deltaRemaining: number, context: HandlerContext): boolean {
    if (group.entries.length === 1) return changeAmmoEntryRemaining(group.entries[0], deltaRemaining, context);

    const sortedEntries = [...group.entries].sort(compareAmmoControlEntryOrder);
    let changed = false;

    if (deltaRemaining < 0) {
        const target = [...sortedEntries].reverse().find(entry => !entry.destroyed && getAmmoEntryRemaining(entry) > 0);
        if (target) changed = changeAmmoEntryRemaining(target, -1, context);
    } else if (deltaRemaining > 0) {
        const target = [...sortedEntries].reverse().find(entry => {
            const remaining = getAmmoEntryRemaining(entry);
            return !entry.destroyed && remaining > 0 && remaining < entry.totalAmmo;
        }) ?? sortedEntries.find(entry => !entry.destroyed && getAmmoEntryRemaining(entry) < entry.totalAmmo);
        if (target) changed = changeAmmoEntryRemaining(target, 1, context);
    }

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

function getTotalAmmoForAmmoType(originalAmmo: AmmoEquipment, originalTotalAmmo: number, selectedAmmo: AmmoEquipment): number {
    if (selectedAmmo.kgPerShot <= 0) return originalTotalAmmo;
    return Math.floor((originalAmmo.kgPerShot * originalTotalAmmo) / selectedAmmo.kgPerShot);
}

export async function setAmmoEntry(entry: AmmoControlEntry, context: HandlerContext): Promise<boolean> {
    if (entry.destroyed) return false;

    const equipmentMap = context.dataService.getEquipments();
    const unitBlueprint = entry.owner.getUnit();
    const compatibleAmmo = sortCompatibleAmmo(Object.values(equipmentMap)
        .filter((equipment): equipment is AmmoEquipment => (equipment instanceof AmmoEquipment) && entry.originalAmmo.compatibleAmmo(equipment, unitBlueprint)));

    const previousRemaining = getAmmoEntryRemaining(entry);
    const ref = context.dialogsService.createDialog<{ name: string; quantity: number, totalAmmo: number } | null>(SetAmmoDialogComponent, {
        data: {
            currentAmmo: entry.currentAmmo,
            originalAmmo: entry.originalAmmo,
            originalTotalAmmo: entry.originalTotalAmmo,
            ammoOptions: compatibleAmmo,
            quantity: previousRemaining,
            maxQuantity: entry.totalAmmo
        } as SetAmmoDialogData
    });

    const newAmmoValue = await firstValueFrom(ref.closed);
    if (!newAmmoValue) return false;

    const selectedAmmo = equipmentMap[newAmmoValue.name] instanceof AmmoEquipment
        ? equipmentMap[newAmmoValue.name] as AmmoEquipment
        : entry.currentAmmo;
    const newTotalAmmo = getTotalAmmoForAmmoType(entry.originalAmmo, entry.originalTotalAmmo, selectedAmmo);
    const newQuantity = clamp(newAmmoValue.quantity, 0, newTotalAmmo);

    if (entry.sourceType === 'inventory') {
        const source = entry.source as MountedEquipment;
        source.ammo = selectedAmmo.internalName === source.name ? undefined : selectedAmmo.internalName;
        source.totalAmmo = newTotalAmmo;
        source.consumed = newTotalAmmo - newQuantity;
        entry.owner.setInventoryEntry(source);
    } else {
        const source = entry.source as CriticalSlot;
        if (selectedAmmo.internalName !== source.name) {
            if (!source.originalName) {
                source.originalName = source.name;
            } else if (selectedAmmo.internalName === source.originalName) {
                delete source.originalName;
            }
            source.name = selectedAmmo.internalName;
            source.eq = selectedAmmo;
        }

        source.totalAmmo = newTotalAmmo;
        source.consumed = newTotalAmmo - newQuantity;
        entry.owner.setCritSlot(source);
    }
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
    const originalTotalAmmo = group.entries.reduce((total, entry) => total + entry.originalTotalAmmo, 0);
    const previousRemaining = getAmmoGroupRemaining(group);
    const compatibleAmmo = sortCompatibleAmmo(Object.values(equipmentMap)
        .filter((equipment): equipment is AmmoEquipment => (equipment instanceof AmmoEquipment) && firstEntry.originalAmmo.compatibleAmmo(equipment, unitBlueprint)));

    const ref = context.dialogsService.createDialog<{ name: string; quantity: number, totalAmmo: number } | null>(SetAmmoDialogComponent, {
        data: {
            currentAmmo: firstEntry.currentAmmo,
            originalAmmo: firstEntry.originalAmmo,
            originalTotalAmmo,
            ammoOptions: compatibleAmmo,
            quantity: previousRemaining,
            maxQuantity: group.totalAmmo
        } as SetAmmoDialogData
    });

    const newAmmoValue = await firstValueFrom(ref.closed);
    if (!newAmmoValue) return false;

    const selectedAmmo = equipmentMap[newAmmoValue.name] instanceof AmmoEquipment
        ? equipmentMap[newAmmoValue.name] as AmmoEquipment
        : firstEntry.currentAmmo;
    let remainingToAllocate = clamp(newAmmoValue.quantity, 0, getTotalAmmoForAmmoType(firstEntry.originalAmmo, originalTotalAmmo, selectedAmmo));

    for (const entry of group.entries.sort(compareAmmoControlEntryOrder)) {
        const newTotalAmmo = getTotalAmmoForAmmoType(entry.originalAmmo, entry.originalTotalAmmo, selectedAmmo);
        const newRemaining = Math.min(newTotalAmmo, remainingToAllocate);
        remainingToAllocate -= newRemaining;

        if (entry.sourceType === 'inventory') {
            const source = entry.source as MountedEquipment;
            source.ammo = selectedAmmo.internalName === source.name ? undefined : selectedAmmo.internalName;
            source.totalAmmo = newTotalAmmo;
            source.consumed = newTotalAmmo - newRemaining;
            entry.owner.setInventoryEntry(source);
        } else {
            const source = entry.source as CriticalSlot;
            if (selectedAmmo.internalName !== source.name) {
                if (!source.originalName) {
                    source.originalName = source.name;
                } else if (selectedAmmo.internalName === source.originalName) {
                    delete source.originalName;
                }
                source.name = selectedAmmo.internalName;
                source.eq = selectedAmmo;
            }
            source.totalAmmo = newTotalAmmo;
            source.consumed = newTotalAmmo - newRemaining;
            entry.owner.setCritSlot(source);
        }
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