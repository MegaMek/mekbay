import { effectiveTechDateYear, TechAdvancementDates } from '../models/entity/types/tech';
import type { AmmoEquipment, AmmoType, WeaponEquipment } from '../models/equipment.model';
import type { Era } from '../models/eras.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { Unit, UnitType } from '../models/units.model';

export interface AmmoValidityContext {
    unitType?: UnitType;
    era?: Era | null;
    inventory?: readonly MountedEquipment[];
    allowAeroArtilleryAlternateMunitions?: boolean; // unofficial rules, this comes from MegaMek's AmmoType canAeroUse()
}

export type AmmoSelectionIssueReason = 'not-yet-existing-in-era'
    | 'extinct-in-era'
    | 'missing-artemis-iv-component'
    | 'missing-artemis-v-component';

export interface AmmoSelectionIssue {
    reason: AmmoSelectionIssueReason;
    message: string;
}

export interface AmmoSelectionStatus {
    issues: AmmoSelectionIssue[];
}

const AMMO_SELECTION_ISSUE_MESSAGES: Record<AmmoSelectionIssueReason, string> = {
    'not-yet-existing-in-era': 'Not yet existing in this era',
    'extinct-in-era': 'Extinct in this era',
    'missing-artemis-iv-component': 'Missing Artemis IV component',
    'missing-artemis-v-component': 'Missing Artemis V component',
};

export class AmmoValidityUtil {
    static isAmmoValid(ammo: AmmoEquipment, context: AmmoValidityContext = {}): boolean {
        return context.unitType !== 'Aero'
            || this.canAeroUse(ammo, !!context.allowAeroArtilleryAlternateMunitions);
    }

    static isAmmoCompatible(originalAmmo: AmmoEquipment, candidateAmmo: AmmoEquipment, unit?: Unit, _inventory: readonly MountedEquipment[] = []): boolean {
        if (!this.isAmmoValid(candidateAmmo, { unitType: unit?.type })) return false;
        if (originalAmmo.ammoType !== candidateAmmo.ammoType) return false;
        if (!this.hasCompatibleTechBase(originalAmmo, candidateAmmo, unit)) return false;
        if (originalAmmo.hasFlag('M_CASELESS') !== candidateAmmo.hasFlag('M_CASELESS')) return false;
        if (originalAmmo.hasFlag('F_BATTLEARMOR') !== candidateAmmo.hasFlag('F_BATTLEARMOR')) return false;

        if (originalAmmo.ammoType === 'AR10') return true;
        if (originalAmmo.rackSize !== candidateAmmo.rackSize) return false;
        if (originalAmmo.ammoType === 'MML' || originalAmmo.ammoType === 'AC_LBX') return true;

        return originalAmmo.ammoType === candidateAmmo.ammoType;
    }

    static getAmmoSelectionStatus(ammoOptions: readonly AmmoEquipment[], context: AmmoValidityContext = {}): Record<string, AmmoSelectionStatus> {
        return Object.fromEntries(ammoOptions.map(ammo => [ammo.internalName, { issues: this.getAmmoSelectionIssues(ammo, context) }]));
    }

    static getAmmoSelectionIssues(ammo: AmmoEquipment, context: AmmoValidityContext = {}): AmmoSelectionIssue[] {
        const reasons = [
            ...this.getEraSelectionIssueReasons(ammo, context.era ?? null),
            ...this.getArtemisSelectionIssueReasons(ammo, context.inventory ?? []),
        ];
        return reasons.map(reason => ({ reason, message: AMMO_SELECTION_ISSUE_MESSAGES[reason] }));
    }

    private static hasCompatibleTechBase(originalAmmo: AmmoEquipment, candidateAmmo: AmmoEquipment, unit?: Unit): boolean {
        if (originalAmmo.techBase === candidateAmmo.techBase) return true;
        if (!unit) return originalAmmo.techBase === 'All' || candidateAmmo.techBase === 'All';
        if (unit.techBase === 'Mixed') return true;
        if (unit.techBase === 'Clan' && originalAmmo.techBase === 'IS') return false;
        if (unit.techBase === 'Inner Sphere' && originalAmmo.techBase === 'Clan') return false;
        return true;
    }

    private static getArtemisSelectionIssueReasons(ammo: AmmoEquipment, inventory: readonly MountedEquipment[]): AmmoSelectionIssueReason[] {
        const reasons: AmmoSelectionIssueReason[] = [];

        if (ammo.hasMunitionType('M_ARTEMIS_CAPABLE') && !this.hasArtemisMunitionSupport(ammo, inventory, ['F_ARTEMIS', 'F_ARTEMIS_PROTO'])) {
            reasons.push('missing-artemis-iv-component');
        }

        if (ammo.hasMunitionType('M_ARTEMIS_V_CAPABLE') && !this.hasArtemisMunitionSupport(ammo, inventory, ['F_ARTEMIS_V'])) {
            reasons.push('missing-artemis-v-component');
        }

        return reasons;
    }

    private static hasArtemisMunitionSupport(ammo: AmmoEquipment, inventory: readonly MountedEquipment[], artemisFlags: readonly string[]): boolean {
        return inventory.some(entry => this.isArtemisSupportedWeaponEntry(entry, ammo, inventory, artemisFlags));
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

    private static getEraSelectionIssueReasons(ammo: AmmoEquipment, era: Era | null): AmmoSelectionIssueReason[] {
        if (!era) return [];

        const timelines = [ammo.tech.advancement?.is, ammo.tech.advancement?.clan]
            .filter((dates): dates is TechAdvancementDates => !!dates);
        const timelineReasons = timelines.map(dates => this.getTimelineSelectionIssueReason(dates, era));
        if (timelineReasons.length === 0 || timelineReasons.some(reason => reason === null)) return [];

        return Array.from(new Set(timelineReasons.filter((reason): reason is AmmoSelectionIssueReason => reason !== null)));
    }

    private static getTimelineSelectionIssueReason(dates: TechAdvancementDates, era: Era): AmmoSelectionIssueReason | null {
        const eraStartYear = era.years.from ?? Number.NEGATIVE_INFINITY;
        const eraEndYear = era.years.to ?? Number.POSITIVE_INFINITY;
        const nonExtinctionYears = [dates.prototype, dates.production, dates.common, dates.reintroduced]
            .map(value => effectiveTechDateYear(value))
            .filter((year): year is number => year !== undefined);

        if (nonExtinctionYears.length > 0 && eraEndYear < Math.min(...nonExtinctionYears)) {
            return 'not-yet-existing-in-era';
        }

        const extinctYear = effectiveTechDateYear(dates.extinct, true);
        if (extinctYear === undefined || eraStartYear < extinctYear) return null;

        const nextAfterExtinction = nonExtinctionYears
            .filter(year => year > extinctYear)
            .sort((a, b) => a - b)[0];
        return nextAfterExtinction === undefined || eraEndYear < nextAfterExtinction ? 'extinct-in-era' : null;
    }
}