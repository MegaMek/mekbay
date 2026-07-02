import type { AmmoEquipment, AmmoType, TechAdvancementDates, WeaponEquipment } from '../models/equipment.model';
import type { Era } from '../models/eras.model';
import type { MountedEquipment } from '../models/force-serialization';
import type { Unit, UnitType } from '../models/units.model';
import { getEffectiveAdvancementYear } from './tech-advancement-date.util';

export interface AmmoValidityContext {
    unitType?: UnitType;
    era?: Era | null;
    allowAeroArtilleryAlternateMunitions?: boolean;
}

export class AmmoValidityUtil {
    static isAmmoValid(ammo: AmmoEquipment, context: AmmoValidityContext = {}): boolean {
        return context.unitType !== 'Aero'
            || this.canAeroUse(ammo, !!context.allowAeroArtilleryAlternateMunitions);
    }

    static isAmmoCompatible(originalAmmo: AmmoEquipment, candidateAmmo: AmmoEquipment, unit?: Unit, inventory: readonly MountedEquipment[] = []): boolean {
        if (!this.isAmmoValid(candidateAmmo, { unitType: unit?.type })) return false;
        if (originalAmmo.ammoType !== candidateAmmo.ammoType) return false;
        if (!this.hasCompatibleTechBase(originalAmmo, candidateAmmo, unit)) return false;
        if (originalAmmo.hasFlag('M_CASELESS') !== candidateAmmo.hasFlag('M_CASELESS')) return false;
        if (originalAmmo.hasFlag('F_BATTLEARMOR') !== candidateAmmo.hasFlag('F_BATTLEARMOR')) return false;
        if (!this.hasRequiredMunitionSupport(candidateAmmo, inventory)) return false;

        if (originalAmmo.ammoType === 'AR10') return true;
        if (originalAmmo.rackSize !== candidateAmmo.rackSize) return false;
        if (originalAmmo.ammoType === 'MML' || originalAmmo.ammoType === 'AC_LBX') return true;

        return originalAmmo.ammoType === candidateAmmo.ammoType;
    }

    static isAmmoUnavailable(ammo: AmmoEquipment, context: AmmoValidityContext = {}): boolean {
        return !!context.era && this.isUnavailableForEra(ammo, context.era);
    }

    static getUnavailableAmmo(ammoOptions: readonly AmmoEquipment[], context: AmmoValidityContext = {}): Record<string, boolean> {
        return Object.fromEntries(ammoOptions.map(ammo => [ammo.internalName, this.isAmmoUnavailable(ammo, context)]));
    }

    private static hasCompatibleTechBase(originalAmmo: AmmoEquipment, candidateAmmo: AmmoEquipment, unit?: Unit): boolean {
        if (originalAmmo.techBase === candidateAmmo.techBase) return true;
        if (!unit) return originalAmmo.techBase === 'All' || candidateAmmo.techBase === 'All';
        if (unit.techBase === 'Mixed') return true;
        if (unit.techBase === 'Clan' && originalAmmo.techBase === 'IS') return false;
        if (unit.techBase === 'Inner Sphere' && originalAmmo.techBase === 'Clan') return false;
        return true;
    }

    private static hasRequiredMunitionSupport(ammo: AmmoEquipment, inventory: readonly MountedEquipment[]): boolean {
        if (ammo.hasMunitionType('M_ARTEMIS_CAPABLE') || ammo.hasMunitionType('M_ARTEMIS_V_CAPABLE')) {
            return inventory.some(entry => this.isArtemisSupportedWeaponEntry(entry, ammo, inventory, ['F_ARTEMIS', 'F_ARTEMIS_PROTO', 'F_ARTEMIS_V']));
        }
        return true;
    }

    private static isArtemisSupportedWeaponEntry(entry: MountedEquipment, ammo: AmmoEquipment, inventory: readonly MountedEquipment[], artemisFlags: readonly string[]): boolean {
        const equipment = entry.equipment;
        return this.isWeaponEquipment(equipment)
            && equipment.hasFlag('F_ARTEMIS_COMPATIBLE')
            && this.weaponUsesAmmo(equipment, ammo)
            && this.hasArtemisEnhancementForWeapon(entry, inventory, artemisFlags);
    }

    private static isWeaponEquipment(equipment: unknown): equipment is WeaponEquipment {
        return !!equipment
            && (equipment as { type?: unknown }).type === 'weapon'
            && typeof (equipment as { ammoType?: unknown }).ammoType === 'string';
    }

    private static weaponUsesAmmo(weapon: WeaponEquipment, ammo: AmmoEquipment): boolean {
        if (weapon.ammoType === 'NA') return false;
        if (!weapon.rackSize || weapon.rackSize <= 0) return weapon.ammoType === ammo.ammoType;
        return weapon.ammoType === ammo.ammoType && weapon.rackSize === ammo.rackSize;
    }

    private static hasArtemisEnhancementForWeapon(weaponEntry: MountedEquipment, inventory: readonly MountedEquipment[], artemisFlags: readonly string[]): boolean {
        if (weaponEntry.linkedWith?.some(entry => this.isArtemisEnhancement(entry, artemisFlags))) return true;

        const weaponLocations = this.getMountedLocations(weaponEntry);
        if (weaponLocations.size === 0) return false;

        return inventory.some(entry => {
            if (entry.parent === weaponEntry && this.isArtemisEnhancement(entry, artemisFlags)) return true;
            if (!this.isArtemisEnhancement(entry, artemisFlags)) return false;
            return this.locationsOverlap(weaponLocations, this.getMountedLocations(entry));
        });
    }

    private static isArtemisEnhancement(entry: MountedEquipment, artemisFlags: readonly string[]): boolean {
        return !!entry.equipment?.hasFlag('F_WEAPON_ENHANCEMENT')
            && artemisFlags.some(flag => entry.equipment?.hasFlag(flag));
    }

    private static getMountedLocations(entry: MountedEquipment): Set<string> {
        const locations = new Set<string>();
        entry.locations?.forEach(location => this.addLocations(locations, location));
        entry.critSlots?.forEach(slot => this.addLocations(locations, slot.loc));
        this.addLocations(locations, entry.id.match(/@([^#]+)#/)?.[1]);
        return locations;
    }

    private static addLocations(locations: Set<string>, locationText: string | null | undefined): void {
        locationText?.split('/').map(location => location.trim()).filter(Boolean).forEach(location => locations.add(location));
    }

    private static locationsOverlap(first: Set<string>, second: Set<string>): boolean {
        return Array.from(first).some(location => second.has(location));
    }

    private static canAeroUse(ammo: AmmoEquipment, allowAlternateArtilleryMunitions: boolean): boolean {
        if (allowAlternateArtilleryMunitions && this.canAeroUseAlternateArtilleryMunition(ammo)) return true;

        switch (ammo.ammoType) {
            case 'AC_LBX':
            case 'SBGAUSS':
                return ammo.hasMunitionType('M_CLUSTER');
            case 'ATM':
            case 'IATM':
                return this.hasAnyMunition(ammo, ['M_STANDARD', 'M_HIGH_EXPLOSIVE', 'M_EXTENDED_RANGE']);
            case 'AR10':
                return true;
            default:
                return this.isStandardMunition(ammo)
                    || ammo.hasMunitionType('M_ARTEMIS_CAPABLE')
                    || ammo.hasMunitionType('M_ARTEMIS_V_CAPABLE');
        }
    }

    private static canAeroUseAlternateArtilleryMunition(ammo: AmmoEquipment): boolean {
        const allowedMunitionsByAmmoType: Partial<Record<AmmoType, readonly string[]>> = {
            ARROW_IV: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_INFERNO_IV', 'M_LASER_INHIB', 'M_SMOKE', 'M_FASCAM', 'M_DAVY_CROCKETT_M', 'M_VIBRABOMB_IV', 'M_STANDARD'],
            LONG_TOM: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_FLECHETTE', 'M_SMOKE', 'M_FASCAM', 'M_DAVY_CROCKETT_M', 'M_STANDARD'],
            SNIPER: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_FLECHETTE', 'M_SMOKE', 'M_FASCAM', 'M_STANDARD'],
            THUMPER: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_FLECHETTE', 'M_SMOKE', 'M_FASCAM', 'M_STANDARD'],
        };

        const allowedMunitions = allowedMunitionsByAmmoType[ammo.ammoType];
        return !!allowedMunitions && this.hasAnyMunition(ammo, allowedMunitions);
    }

    private static isStandardMunition(ammo: AmmoEquipment): boolean {
        return ammo.munitionType.size === 0 || ammo.hasMunitionType('M_STANDARD');
    }

    private static hasAnyMunition(ammo: AmmoEquipment, munitionTypes: readonly string[]): boolean {
        return munitionTypes.some(munitionType => ammo.hasMunitionType(munitionType));
    }

    private static isUnavailableForEra(ammo: AmmoEquipment, era: Era): boolean {
        const timelines = [ammo.tech.advancement?.is, ammo.tech.advancement?.clan]
            .filter((dates): dates is TechAdvancementDates => !!dates);
        return timelines.length > 0 && timelines.every(dates => this.isTimelineUnavailableForEra(dates, era));
    }

    private static isTimelineUnavailableForEra(dates: TechAdvancementDates, era: Era): boolean {
        const eraStartYear = era.years.from ?? Number.NEGATIVE_INFINITY;
        const eraEndYear = era.years.to ?? Number.POSITIVE_INFINITY;
        const nonExtinctionYears = [dates.prototype, dates.production, dates.common, dates.reintroduced]
            .map(value => getEffectiveAdvancementYear(value, 'availability'))
            .filter((year): year is number => year !== null);

        if (nonExtinctionYears.length > 0 && eraEndYear < Math.min(...nonExtinctionYears)) {
            return true;
        }

        const extinctYear = getEffectiveAdvancementYear(dates.extinct, 'extinct');
        if (extinctYear === null || eraStartYear < extinctYear) return false;

        const nextAfterExtinction = nonExtinctionYears
            .filter(year => year > extinctYear)
            .sort((a, b) => a - b)[0];
        return nextAfterExtinction === undefined || eraEndYear < nextAfterExtinction;
    }
}