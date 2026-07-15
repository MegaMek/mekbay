import type { WeaponCategory, WeaponDamageProfile } from '../../equipment.model';
import type { EntityMountedWeapon } from './equipment';

export type EntityWeaponHitModifier = number | 'versus' | 'variable';

export interface PhysicalDamageValue {
  readonly damage: number;
  readonly tsmDamage?: number;
}

export type IntrinsicWeaponDamageProfile =
  | {
    readonly kind: 'physical-fixed';
    readonly primary: PhysicalDamageValue;
    readonly alternate?: {
      readonly mode: 'airmek';
      readonly value: PhysicalDamageValue;
    };
  }
  | {
    readonly kind: 'physical-per-hex';
    readonly damagePerHex: number;
    readonly bonusDamage: number;
  }
  | { readonly kind: 'physical-none' };

export type EntityWeaponDamageProfile = WeaponDamageProfile | IntrinsicWeaponDamageProfile;

export interface EntityWeaponCapability {
  readonly source: 'mounted' | 'intrinsic';
  readonly id: string;
  readonly name: string;
  readonly locations: readonly string[];
  readonly category: WeaponCategory | 'physical';
  readonly heat: number;
  readonly damage: EntityWeaponDamageProfile;
  readonly hitModifiers: readonly EntityWeaponHitModifier[];
  readonly minimumRange: number;
  readonly ranges: readonly number[];
  readonly oneShotCount?: 1 | 2;
  readonly optional: boolean;
}

export interface MountedWeaponCapability extends EntityWeaponCapability {
  readonly source: 'mounted';
  readonly mount: EntityMountedWeapon;
  readonly damage: WeaponDamageProfile;
}

export type IntrinsicWeaponKind =
  | 'punch'
  | 'kick'
  | 'club'
  | 'death-from-above'
  | 'charge'
  | 'airmek-ram'
  | 'push'
  | 'frenzy';

export interface IntrinsicWeapon extends EntityWeaponCapability {
  readonly source: 'intrinsic';
  readonly kind: IntrinsicWeaponKind;
  readonly category: 'physical';
  readonly damage: IntrinsicWeaponDamageProfile;
}