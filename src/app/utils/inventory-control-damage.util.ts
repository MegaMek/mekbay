import { AmmoEquipment, WEAPON_TYPES, WeaponEquipment, type WeaponType } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { InventoryRangeKey } from './inventory-control.util';
import type { AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';

const RANGE_DAMAGE_INDEX: Record<InventoryRangeKey, number> = {
    short: 0,
    medium: 1,
    long: 2
};

export type InventoryControlDamage =
    | { readonly kind: 'simple'; readonly value: number }
    | { readonly kind: 'per-missile'; readonly value: number }
    | { readonly kind: 'special'; readonly value: string }
    | { readonly kind: 'profile'; readonly values: readonly InventoryControlDamage[] };

export interface InventoryControlDamageContext {
    selectedRange: InventoryRangeKey | null;
    selectedAmmo: AmmoEquipment | null;
    fallbackAmmoProfile?: AmmoWeaponProfile | null;
}

export interface InventoryControlDamageResolution {
    readonly damage: InventoryControlDamage;
    readonly damageTypes: readonly WeaponType[];
    readonly text: string;
}

export interface InventoryControlDamageRules {
    applyDamageEffects?: (
        entry: MountedEquipment,
        damage: InventoryControlDamage,
        context: InventoryControlDamageContext
    ) => InventoryControlDamage;
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

export function resolveWeaponDamageText(
    weapon: WeaponEquipment,
    context: InventoryControlDamageContext = { selectedRange: null, selectedAmmo: null }
): string | null {
    const damage = resolveWeaponDamage(weapon, context);
    return formatInventoryControlDamage(damage, getUnmountedWeaponTypes(weapon, context.selectedAmmo), weapon, context.selectedAmmo, context.fallbackAmmoProfile);
}

export function resolveInventoryControlWeaponDamage(
    entry: MountedEquipment,
    context: InventoryControlDamageContext,
    rules: InventoryControlDamageRules = {}
): InventoryControlDamageResolution | null {
    if (!(entry.equipment instanceof WeaponEquipment)) return null;
    const damage = resolveInventoryControlDamage(entry, context, rules);
    if (!damage) return null;
    const damageTypes = getInventoryControlDamageTypes(entry, context.selectedAmmo, rules);
    return {
        damage,
        damageTypes,
        text: formatInventoryControlDamage(damage, damageTypes, entry.equipment, context.selectedAmmo, context.fallbackAmmoProfile)
    };
}

export function resolveInventoryControlDamage(
    entry: MountedEquipment,
    context: InventoryControlDamageContext,
    rules: InventoryControlDamageRules = {}
): InventoryControlDamage | null {
    if (!(entry.equipment instanceof WeaponEquipment)) return null;

    const damage = resolveWeaponDamage(entry.equipment, context);
    return rules.applyDamageEffects?.(entry, damage, context) ?? damage;
}

export function resolveWeaponDamage(
    weapon: WeaponEquipment,
    context: InventoryControlDamageContext
): InventoryControlDamage {
    return damageFromModel(weapon, context);
}

export function formatInventoryControlDamage(
    damage: InventoryControlDamage,
    damageTypes: Iterable<WeaponType>,
    weapon: WeaponEquipment,
    selectedAmmo?: AmmoEquipment | null,
    fallbackAmmoProfile?: AmmoWeaponProfile | null
): string {
    const damageValue = formatDamageValue(damage);
    const baseDamage = weapon.getRapidFireCount() > 0 ? `${damageValue}/Sht` : damageValue;
    const typeSet = new Set(damageTypes);
    const orderedTypes = WEAPON_TYPES.filter(type => typeSet.has(type));
    const typeLabels = orderedTypes.map(type => formatWeaponTypeLabel(type, weapon, selectedAmmo, fallbackAmmoProfile));
    return typeLabels.length > 0 ? `${baseDamage} [${typeLabels.join(',')}]`.trim() : baseDamage;
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

function damageFromModel(
    weapon: WeaponEquipment,
    context: InventoryControlDamageContext
): InventoryControlDamage {
    const modelDamage = weapon.damage;
    if (Array.isArray(modelDamage)) {
        const selectedDamage = context.selectedRange
            ? modelDamage[RANGE_DAMAGE_INDEX[context.selectedRange]]
            : undefined;
        return selectedDamage === undefined
                ? { kind: 'profile', values: modelDamage.map(value => damageAmount(value, weapon, context.selectedAmmo, context.fallbackAmmoProfile)) }
                : damageAmount(selectedDamage, weapon, context.selectedAmmo, context.fallbackAmmoProfile);
    }
            return damageAmount(modelDamage, weapon, context.selectedAmmo, context.fallbackAmmoProfile);
}

function getUnmountedWeaponTypes(weapon: WeaponEquipment, selectedAmmo?: AmmoEquipment | null): Set<WeaponType> {
    const types = new Set(weapon.getWeaponTypes());
    selectedAmmo?.getRemovedDamageTypes().forEach(type => types.delete(type));
    selectedAmmo?.getWeaponTypes().forEach(type => types.add(type));
    return types;
}

function formatWeaponTypeLabel(
    type: WeaponType,
    weapon: WeaponEquipment,
    selectedAmmo?: AmmoEquipment | null,
    fallbackAmmoProfile?: AmmoWeaponProfile | null
): string {
    if (type === 'C') {
        const clusterSize = weapon.getClusterSize(selectedAmmo, fallbackAmmoProfile);
        return clusterSize > 0 ? `C${clusterSize}` : type;
    }
    if (type === 'R') {
        const rapidFireCount = weapon.getRapidFireCount();
        return rapidFireCount > 0 ? `R${rapidFireCount}` : type;
    }
    return type;
}

function damageAmount(
    value: string | number,
    weapon: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
    fallbackAmmoProfile?: AmmoWeaponProfile | null
): InventoryControlDamage {
    if (typeof value === 'number') return { kind: 'simple', value };
    if (value === 'special' && weapon.oneShotCount && selectedAmmo) {
        const profile = weapon.getDamageProfile(selectedAmmo);
        if (profile.kind === 'fixed') return { kind: 'simple', value: profile.damage };
    }
    if (value !== 'cluster') return { kind: 'special', value };

    const damagePerMissile = selectedAmmo?.damagePerShot
        ?? fallbackAmmoProfile?.fallbackDamagePerShot
        ?? defaultDamagePerMissile(weapon);
    return { kind: 'per-missile', value: damagePerMissile };
}

function defaultDamagePerMissile(weapon: WeaponEquipment): number {
    if (weapon.ammoType === 'SRM' || weapon.ammoType === 'SRM_STREAK' || weapon.ammoType === 'SRM_TORPEDO' || weapon.ammoType === 'SRM_ADVANCED') return 2;
    return 1; // LRM
}

function formatDamageValue(damage: InventoryControlDamage): string {
    switch (damage.kind) {
        case 'simple': return damage.value === 0 ? '' : formatNumber(damage.value);
        case 'per-missile': return `${formatNumber(damage.value)}/Msl`;
        case 'special': return damage.value;
        case 'profile': return damage.values.map(formatDamageValue).join('/');
    }
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, '');
}
