import { firstValueFrom } from 'rxjs';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from '../components/set-ammo-dialog/set-ammo.dialog.component';
import { AmmoEquipment, WeaponEquipment, type EquipmentMap } from '../models/equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';

export interface AmmoControlEntry {
    id: string;
    owner: CBTForceUnit;
    source: CriticalSlot;
    locationLabel: string;
    displayName: string;
    currentAmmo: AmmoEquipment;
    originalAmmo: AmmoEquipment;
    originalTotalAmmo: number;
    totalAmmo: number;
    consumed: number;
    destroyed: boolean;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function formatAmmoName(ammo: AmmoEquipment): string {
    return ammo.shortName.endsWith(' Ammo') ? ammo.shortName.slice(0, -5) : ammo.shortName;
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
    return {
        id: `crit:${criticalSlot.loc ?? ''}:${criticalSlot.slot ?? ''}:${criticalSlot.name ?? criticalSlot.id}`,
        owner: unit,
        source: criticalSlot,
        locationLabel: criticalSlot.loc ?? 'Ammo',
        displayName: formatAmmoName(criticalSlot.eq),
        currentAmmo: criticalSlot.eq,
        originalAmmo,
        originalTotalAmmo: getOriginalTotalAmmo(unit, criticalSlot),
        totalAmmo,
        consumed: criticalSlot.consumed ?? 0,
        destroyed: !!criticalSlot.destroyed
    };
}

function ammoMatchesWeapon(weapon: WeaponEquipment, ammo: AmmoEquipment): boolean {
    if (weapon.ammoType === 'NA' || weapon.rackSize <= 0) return false;
    return ammo.ammoType === weapon.ammoType && ammo.rackSize === weapon.rackSize;
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

export function getAmmoControlEntriesForWeapon(equipment: MountedEquipment, context: HandlerContext): AmmoControlEntry[] {
    if (!(equipment.equipment instanceof WeaponEquipment)) return [];
    const equipmentMap = context.dataService.getEquipments();

    return sortAmmoControlEntries(equipment.owner.getCritSlots()
        .filter(criticalSlot => criticalSlot.eq instanceof AmmoEquipment && ammoMatchesWeapon(equipment.equipment as WeaponEquipment, criticalSlot.eq))
        .map(criticalSlot => createCriticalSlotAmmoControlEntry(equipment.owner, criticalSlot, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry));
}

export function getAmmoControlEntriesForUnitWeapons(unit: CBTForceUnit, equipmentMap: EquipmentMap): AmmoControlEntry[] {
    const weaponAmmoKeys = new Set(
        unit.getInventory()
            .map(entry => entry.equipment)
            .filter((equipment): equipment is WeaponEquipment => equipment instanceof WeaponEquipment && equipment.ammoType !== 'NA' && equipment.rackSize > 0)
            .map(weapon => `${weapon.ammoType}:${weapon.rackSize}`)
    );

    if (weaponAmmoKeys.size === 0) return [];

    return sortAmmoControlEntries(unit.getCritSlots()
        .filter(criticalSlot => criticalSlot.eq instanceof AmmoEquipment && weaponAmmoKeys.has(`${criticalSlot.eq.ammoType}:${criticalSlot.eq.rackSize}`))
        .map(criticalSlot => createCriticalSlotAmmoControlEntry(unit, criticalSlot, equipmentMap))
        .filter((entry): entry is AmmoControlEntry => !!entry));
}

export function getAmmoEntryRemaining(entry: AmmoControlEntry): number {
    return Math.max(0, entry.totalAmmo - entry.consumed);
}

function syncEntryFromSource(entry: AmmoControlEntry, equipmentMap: EquipmentMap): void {
    const currentAmmo = entry.source.eq;
    if (currentAmmo instanceof AmmoEquipment) {
        entry.currentAmmo = currentAmmo;
        entry.displayName = formatAmmoName(currentAmmo);
    }
    entry.originalAmmo = resolveOriginalAmmo(entry.source, equipmentMap) ?? entry.currentAmmo;
    entry.originalTotalAmmo = getOriginalTotalAmmo(entry.owner, entry.source);
    entry.totalAmmo = getCriticalSlotTotalAmmo(entry.owner, entry.source);
    entry.consumed = entry.source.consumed ?? 0;
    entry.destroyed = !!entry.source.destroyed;
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
    entry.owner.setCritSlot(entry.source);
    syncEntryFromSource(entry, context.dataService.getEquipments());
    showAmmoToast(entry, appliedDelta, context);
    return true;
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

    if (selectedAmmo.internalName !== entry.source.name) {
        if (!entry.source.originalName) {
            entry.source.originalName = entry.source.name;
        } else if (selectedAmmo.internalName === entry.source.originalName) {
            delete entry.source.originalName;
        }
        entry.source.name = selectedAmmo.internalName;
        entry.source.eq = selectedAmmo;
    }

    entry.source.totalAmmo = newTotalAmmo;
    entry.source.consumed = newTotalAmmo - newQuantity;
    entry.owner.setCritSlot(entry.source);
    syncEntryFromSource(entry, equipmentMap);

    const appliedDelta = getAmmoEntryRemaining(entry) - previousRemaining;
    if (appliedDelta !== 0) {
        showAmmoToast(entry, appliedDelta, context);
    }
    return true;
}