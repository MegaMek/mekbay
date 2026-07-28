import {
    AmmoEquipment,
    resolveWeaponAmmo,
    resolveWeaponDamage,
    WEAPON_TYPES,
    WeaponDamage,
    WeaponEquipment,
    type WeaponType,
} from '../models/equipment.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';
import {
    formatWeaponDamage,
    type WeaponDamageRange,
} from './weapon-damage.util';

export interface InventoryControlDamageContext {
    readonly selectedRange: WeaponDamageRange | null;
    readonly selectedAmmo: AmmoEquipment | null;
    readonly equipmentCatalog: EquipmentRegistry;
    readonly ammoProfile?: AmmoWeaponProfile | null;
}

export interface DefaultWeaponDamageContext {
    readonly selectedRange?: WeaponDamageRange | null;
    readonly ammoProfile?: AmmoWeaponProfile | null;
}

export interface InventoryControlDamageResolution {
    readonly damage: WeaponDamage;
    readonly damageTypes: readonly WeaponType[];
    readonly text: string;
}

export interface InventoryControlDamageRules {
    applyDamageEffects?: (
        entry: MountedEquipment,
        damage: WeaponDamage,
        context: InventoryControlDamageContext
    ) => WeaponDamage;
    applyWeaponTypes?: (
        entry: MountedEquipment,
        types: ReadonlySet<WeaponType>
    ) => ReadonlySet<WeaponType>;
}

export function resolveInventoryControlDamageText(
    entry: MountedEquipment,
    context: InventoryControlDamageContext,
    rules: InventoryControlDamageRules = {}
): string | null {
    return resolveInventoryControlWeaponDamage(entry, context, rules)?.text ?? null;
}

export function resolveDefaultWeaponDamageText(
    weapon: WeaponEquipment,
    equipmentCatalog: EquipmentRegistry,
    context: DefaultWeaponDamageContext = {}
): string {
    const ammo = resolveWeaponAmmo(weapon, equipmentCatalog, context);
    const damage = resolveWeaponDamage(weapon, equipmentCatalog, {
        ammo,
        ammoProfile: context.ammoProfile,
        range: context.selectedRange,
    });
    return formatDamageWithTypes(
        damage,
        getUnmountedWeaponTypes(weapon, ammo),
        weapon,
        ammo,
        context.ammoProfile
    );
}

export function resolveInventoryControlWeaponDamage(
    entry: MountedEquipment,
    context: InventoryControlDamageContext,
    rules: InventoryControlDamageRules = {}
): InventoryControlDamageResolution | null {
    if (!(entry.equipment instanceof WeaponEquipment)) return null;

    const ammo = resolveWeaponAmmo(entry.equipment, context.equipmentCatalog, {
        ammo: context.selectedAmmo,
        ammoProfile: context.ammoProfile,
    });
    const baseDamage = resolveWeaponDamage(entry.equipment, context.equipmentCatalog, {
        ammo,
        ammoProfile: context.ammoProfile,
        range: context.selectedRange,
    });
    const damage = rules.applyDamageEffects?.(entry, baseDamage, context) ?? baseDamage;
    const damageTypes = getInventoryControlDamageTypes(entry, ammo, rules);
    return {
        damage,
        damageTypes,
        text: formatDamageWithTypes(
            damage,
            damageTypes,
            entry.equipment,
            ammo,
            context.ammoProfile
        ),
    };
}

export function getInventoryControlDamageTypes(
    entry: MountedEquipment,
    selectedAmmo?: AmmoEquipment | null,
    rules: InventoryControlDamageRules = {}
): WeaponType[] {
    if (!(entry.equipment instanceof WeaponEquipment)) return [];

    const baseTypes = entry instanceof MountedWeapon
        ? new Set(entry.getWeaponTypes(selectedAmmo))
        : getUnmountedWeaponTypes(entry.equipment, selectedAmmo);
    const effectiveTypes = rules.applyWeaponTypes?.(entry, baseTypes) ?? baseTypes;
    return WEAPON_TYPES.filter(type => effectiveTypes.has(type));
}

function formatDamageWithTypes(
    damage: WeaponDamage,
    damageTypes: Iterable<WeaponType>,
    weapon: WeaponEquipment,
    ammo: AmmoEquipment | null,
    ammoProfile?: AmmoWeaponProfile | null
): string {
    const damageValue = weapon.damage === '' ? '' : formatWeaponDamage(damage, {
        shotSuffix: '/Sht',
        specialLabel: 'special',
        variableLabel: 'variable',
    });
    const typeSet = new Set(damageTypes);
    const labels = WEAPON_TYPES
        .filter(type => typeSet.has(type))
        .map(type => formatWeaponTypeLabel(type, weapon, ammo, ammoProfile));
    return [damageValue, labels.length > 0 ? `[${labels.join(',')}]` : ''].filter(Boolean).join(' ');
}

function getUnmountedWeaponTypes(weapon: WeaponEquipment, ammo?: AmmoEquipment | null): Set<WeaponType> {
    const types = new Set(weapon.getWeaponTypes());
    ammo?.getRemovedDamageTypes().forEach(type => types.delete(type));
    ammo?.getWeaponTypes().forEach(type => types.add(type));
    return types;
}

function formatWeaponTypeLabel(
    type: WeaponType,
    weapon: WeaponEquipment,
    ammo?: AmmoEquipment | null,
    ammoProfile?: AmmoWeaponProfile | null
): string {
    if (type === 'C') {
        const clusterSize = weapon.getClusterSize(ammo, ammoProfile);
        return clusterSize > 0 ? `C${clusterSize}` : type;
    }
    if (type === 'R') {
        const rapidFireCount = weapon.getRapidFireCount();
        return rapidFireCount > 0 ? `R${rapidFireCount}` : type;
    }
    return type;
}
