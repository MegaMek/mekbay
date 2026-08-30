// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Faction } from '../models/factions.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { isEcmEquipment } from '../models/ecm-mode.model';
import { isBapEquipment } from '../models/bap-equipment.model';
import { CBT_WEIGHT_CLASS_ORDINALS, type UnitSummary } from '../models/unit-summary.model';
import { isGroundMovementMode } from './as-common.util';

const CBT_LIGHT_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Light') ?? 1;
const CBT_MEDIUM_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Medium') ?? 2;
const CBT_HEAVY_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Heavy') ?? 3;
const CBT_ASSAULT_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Assault') ?? 4;

export interface FormationUnitFacts {
    readonly forceUnit: FormationUnitLike;
    readonly uuid: string;
    readonly name: string;
    readonly chassis: string;
    readonly role: string;
    readonly unitType: string;
    readonly unitSubtype: string;
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
    readonly cbtHasAutocannon: boolean;
    readonly cbtHasArtillery: boolean;
    readonly cbtHasLrm: boolean;
    readonly cbtHasSrm: boolean;
    readonly cbtHasEcm: boolean;
    readonly cbtHasBap: boolean;
    readonly cbtHasTag: boolean;
    readonly cbtQuirks: readonly string[];
    readonly cbtWeapons: readonly Readonly<{
        readonly maxRange: number;
        readonly maximumDamage: number;
    }>[];
    readonly pilotSkill?: number;
    readonly gunnerySkill?: number;
}

export interface FormationUnitForceContext {
    faction(): Faction | null;
}

export interface FormationUnitLike {
    readonly force: FormationUnitForceContext;
    getFormationEntity?(): BaseEntity;
    getFormationSummary?(): UnitSummary;
    pilotSkill?(): number;
    gunnerySkill?(): number;
}

export function formationUnitTechBaseFacts(unit: FormationUnitLike): Readonly<{
    techBase: 'Inner Sphere' | 'Clan';
    mixed: boolean;
}> {
    const entity = unit.getFormationEntity?.();
    if (entity) {
        return Object.freeze({
            techBase: entity.techBase() === 'Clan' ? 'Clan' : 'Inner Sphere',
            mixed: entity.mixedTech(),
        });
    }
    const summary = unit.getFormationSummary?.();
    if (!summary) throw new Error('Formation unit has neither Entity nor catalog facts');
    return Object.freeze({ techBase: summary.techBase, mixed: summary.mixed });
}

export function asGetMaxGroundMove(unit: UnitSummary): number {
    const movementModes = unit.as?.MVm;
    if (!movementModes) return 0;

    let maxMove = 0;
    for (const [mode, value] of Object.entries(movementModes)) {
        if (!isGroundMovementMode(mode)) continue;
        if (value > maxMove) maxMove = value;
    }

    return maxMove;
}

export function asGetJumpMove(unit: UnitSummary): number {
    return unit.as?.MVm?.['j'] ?? 0;
}

export function cbtCanDealDamage(unit: UnitSummary, minDamage: number, atRange: number): boolean {
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

        if (component.md) {
            const damage = parseInt(component.md);
            if (!isNaN(damage)) {
                totalDamageAtRange += damage * component.q;
                if (totalDamageAtRange >= minDamage) return true;
            }
        }
    }

    return false;
}

export function cbtHasAutocannon(unit: UnitSummary): boolean {
    return unit.comp?.some(component => (
        component.n?.includes('AC/')
        || component.n?.includes('LB ')
        || component.n?.includes('LB-')
    )) || false;
}

export function cbtHasArtillery(unit: UnitSummary): boolean {
    return unit.comp?.some(component => component.t === 'A') || false;
}

export function compileFormationUnitFacts(forceUnit: FormationUnitLike): FormationUnitFacts {
    const entity = forceUnit.getFormationEntity?.();
    const summary = entity ? undefined : forceUnit.getFormationSummary?.();
    if (!entity && !summary) throw new Error('Formation unit has neither Entity nor catalog facts');
    const cbtWeightClass = CBT_WEIGHT_CLASS_ORDINALS.get(
        (entity?.weightClass() ?? summary!.weightClass) as UnitSummary['weightClass'],
    ) ?? -1;
    const pilotSkill = forceUnit.pilotSkill?.();
    const gunnerySkill = forceUnit.gunnerySkill?.();
    const asGroundMove = summary ? asGetMaxGroundMove(summary) : 0;
    const asJumpMove = summary ? asGetJumpMove(summary) : 0;
    const weapons = entity
        ? entity.rangedWeapons().map(mount => Object.freeze({
            maxRange: Math.max(0, ...mount.equipment.ranges),
            maximumDamage: entity.resolveMountedWeaponDamage(mount).maximum,
        }))
        : summary!.comp.flatMap(component => {
            if (!component.r) return [];
            const maxRange = Math.max(0, ...component.r.split('/').map(value => Number.parseInt(value, 10) || 0));
            const damage = Number.parseInt(component.md ?? '', 10);
            return Number.isFinite(damage)
                ? Array.from({ length: component.q }, () => Object.freeze({
                    maxRange,
                    maximumDamage: damage,
                }))
                : [];
        });
    const equipment = entity?.equipment().map(mount => mount.equipment) ?? [];
    const summaryComponents = summary?.comp ?? [];

    return {
        forceUnit,
        uuid: entity?.uuid() ?? summary!.uuid,
        name: entity?.displayName() ?? summary!.name,
        chassis: entity?.chassis() ?? summary!.chassis,
        role: entity?.role() ?? summary!.role,
        unitType: entity?.unitType() ?? summary!.type,
        unitSubtype: entity?.unitSubtype() ?? summary!.subtype,
        asType: summary?.as?.TP,
        asSize: summary?.as?.SZ ?? 0,
        asArmor: summary?.as?.Arm ?? 0,
        asGroundMove,
        asJumpMove,
        asAnyGroundOrJumpMove: Math.max(asGroundMove, asJumpMove),
        asShortDamage: summary?.as?.dmg?._dmgS ?? 0,
        asMediumDamage: summary?.as?.dmg?._dmgM ?? 0,
        asLongDamage: summary?.as?.dmg?._dmgL ?? 0,
        asSpecials: summary?.as?.specials ?? [],
        cbtArmor: entity
            ? entity.damageLocations().reduce((total, location) =>
                total + location.armor.front + location.armor.rear, 0)
            : summary!.armor,
        cbtWalk: entity?.walkMP() ?? summary!.walk,
        cbtJump: entity?.jumpMP() ?? summary!.jump,
        cbtWeightClass,
        cbtIsLight: cbtWeightClass === CBT_LIGHT_WEIGHT_CLASS,
        cbtIsMedium: cbtWeightClass === CBT_MEDIUM_WEIGHT_CLASS,
        cbtIsMediumOrLarger: cbtWeightClass >= CBT_MEDIUM_WEIGHT_CLASS,
        cbtIsLightOrMedium: cbtWeightClass <= CBT_MEDIUM_WEIGHT_CLASS,
        cbtIsHeavyOrLarger: cbtWeightClass >= CBT_HEAVY_WEIGHT_CLASS,
        cbtIsAssaultOrLarger: cbtWeightClass >= CBT_ASSAULT_WEIGHT_CLASS,
        cbtHasAutocannon: entity
            ? entity.rangedWeapons().some(mount => mount.equipment.hasWeaponTrait('autocannon'))
            : cbtHasAutocannon(summary!),
        cbtHasArtillery: entity
            ? entity.rangedWeapons().some(mount => mount.equipment.hasWeaponTrait('artillery'))
            : cbtHasArtillery(summary!),
        cbtHasLrm: entity
            ? entity.rangedWeapons().some(mount => mount.equipment.hasWeaponTrait('lrm'))
            : summaryComponents.some(component => component.n?.includes('LRM')),
        cbtHasSrm: entity
            ? entity.rangedWeapons().some(mount => mount.equipment.hasWeaponTrait('srm'))
            : summaryComponents.some(component => component.n?.includes('SRM')),
        cbtHasEcm: entity
            ? equipment.some(isEcmEquipment)
            : summaryComponents.some(component => isEcmEquipment(component.eq)),
        cbtHasBap: entity
            ? equipment.some(isBapEquipment)
            : summaryComponents.some(component => isBapEquipment(component.eq)),
        cbtHasTag: entity
            ? entity.rangedWeapons().some(mount => mount.equipment.hasWeaponTrait('tag'))
            : summaryComponents.some(component => component.eq?.hasWeaponTrait('tag') === true),
        cbtQuirks: entity
            ? Object.freeze(entity.quirks().flatMap(quirk => [quirk.quirk.key, quirk.quirk.name]))
            : summary!.quirks,
        cbtWeapons: Object.freeze(weapons),
        pilotSkill,
        gunnerySkill,
    };
}

export function formationCanDealDamage(
    facts: FormationUnitFacts,
    minDamage: number,
    atRange: number,
): boolean {
    let total = 0;
    for (const weapon of facts.cbtWeapons) {
        if (weapon.maxRange < atRange) continue;
        total += weapon.maximumDamage;
        if (total >= minDamage) return true;
    }
    return false;
}
