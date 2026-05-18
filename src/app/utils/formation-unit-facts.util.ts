import type { Faction } from '../models/factions.model';
import { CBT_WEIGHT_CLASS_ORDINALS, type Unit } from '../models/units.model';
import { isGroundMovement } from './as-common.util';

const CBT_LIGHT_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Light') ?? 1;
const CBT_MEDIUM_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Medium') ?? 2;
const CBT_HEAVY_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Heavy') ?? 3;
const CBT_ASSAULT_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Assault') ?? 4;

export interface FormationUnitFacts {
    readonly forceUnit: FormationUnitLike;
    readonly unit: Unit;
    readonly name: string;
    readonly chassis: string;
    readonly role: string;
    readonly asType: string | undefined;
    readonly asSize: number;
    readonly asArmor: number;
    readonly asGroundMove: number;
    readonly asJumpMove: number;
    readonly asAnyGroundOrJumpMove: number;
    readonly asShortDamage: number;
    readonly asMediumDamage: number;
    readonly asLongDamage: number;
    readonly asSpecials: readonly string[];
    readonly cbtArmor: number;
    readonly cbtWalk: number;
    readonly cbtJump: number;
    readonly cbtWeightClass: number;
    readonly cbtIsLight: boolean;
    readonly cbtIsMedium: boolean;
    readonly cbtIsMediumOrLarger: boolean;
    readonly cbtIsLightOrMedium: boolean;
    readonly cbtIsHeavyOrLarger: boolean;
    readonly cbtIsAssaultOrLarger: boolean;
    readonly pilotSkill?: number;
    readonly gunnerySkill?: number;
}

export interface FormationUnitForceContext {
    faction(): Faction | null;
}

export interface FormationUnitLike {
    readonly force: FormationUnitForceContext;
    getUnit(): Unit;
    pilotSkill?(): number;
    gunnerySkill?(): number;
}

export function asGetMaxGroundMove(unit: Unit): number {
    const movementModes = unit.as?.MVm;
    if (!movementModes) return 0;

    let maxMove = 0;
    for (const [mode, value] of Object.entries(movementModes)) {
        if (!isGroundMovement(mode)) continue;
        if (value > maxMove) maxMove = value;
    }

    return maxMove;
}

export function asGetJumpMove(unit: Unit): number {
    return unit.as?.MVm?.['j'] ?? 0;
}

export function cbtCanDealDamage(unit: Unit, minDamage: number, atRange: number): boolean {
    if (!unit.comp || unit.comp.length === 0) return false;

    let totalDamageAtRange = 0;
    for (const component of unit.comp) {
        if (!component.r) continue;

        let maxRange = 0;
        for (const rangeText of component.r.split('/')) {
            const parsedRange = parseInt(rangeText);
            if (parsedRange > maxRange) maxRange = parsedRange;
        }
        if (maxRange < atRange) continue;

        if (component.d) {
            const damage = parseInt(component.d);
            if (!isNaN(damage)) {
                totalDamageAtRange += damage;
                if (totalDamageAtRange >= minDamage) return true;
            }
        }
    }

    return false;
}

export function cbtHasAutocannon(unit: Unit): boolean {
    return unit.comp?.some(component => (
        component.n?.includes('AC/')
        || component.n?.includes('LB ')
        || component.n?.includes('LB-')
    )) || false;
}

export function cbtHasArtillery(unit: Unit): boolean {
    return unit.comp?.some(component => component.t === 'A') || false;
}

export function compileFormationUnitFacts(forceUnit: FormationUnitLike): FormationUnitFacts {
    const unit = forceUnit.getUnit();
    const cbtWeightClass = CBT_WEIGHT_CLASS_ORDINALS.get(unit.weightClass) ?? -1;
    const pilotSkill = forceUnit.pilotSkill?.();
    const gunnerySkill = forceUnit.gunnerySkill?.();
    const asGroundMove = asGetMaxGroundMove(unit);
    const asJumpMove = asGetJumpMove(unit);

    return {
        forceUnit,
        unit,
        name: unit.name,
        chassis: unit.chassis,
        role: unit.role,
        asType: unit.as?.TP,
        asSize: unit.as?.SZ ?? 0,
        asArmor: unit.as?.Arm ?? 0,
        asGroundMove,
        asJumpMove,
        asAnyGroundOrJumpMove: Math.max(asGroundMove, asJumpMove),
        asShortDamage: unit.as?.dmg?._dmgS ?? 0,
        asMediumDamage: unit.as?.dmg?._dmgM ?? 0,
        asLongDamage: unit.as?.dmg?._dmgL ?? 0,
        asSpecials: unit.as?.specials ?? [],
        cbtArmor: unit.armor,
        cbtWalk: unit.walk,
        cbtJump: unit.jump,
        cbtWeightClass,
        cbtIsLight: cbtWeightClass === CBT_LIGHT_WEIGHT_CLASS,
        cbtIsMedium: cbtWeightClass === CBT_MEDIUM_WEIGHT_CLASS,
        cbtIsMediumOrLarger: cbtWeightClass >= CBT_MEDIUM_WEIGHT_CLASS,
        cbtIsLightOrMedium: cbtWeightClass <= CBT_MEDIUM_WEIGHT_CLASS,
        cbtIsHeavyOrLarger: cbtWeightClass >= CBT_HEAVY_WEIGHT_CLASS,
        cbtIsAssaultOrLarger: cbtWeightClass >= CBT_ASSAULT_WEIGHT_CLASS,
        pilotSkill,
        gunnerySkill,
    };
}
