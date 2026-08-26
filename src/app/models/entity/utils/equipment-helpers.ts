// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Equipment } from "../../equipment.model";
import type { BaseEntity } from "../base-entity";
import type { ArmorType } from "../types/armor";
import { isQuadMekConfig } from "../types/mek";
import { weightClassCode } from "../types/weight";
import { isAeroEntity, isMekEntity, isVehicleEntity } from "./entity-type-guards";
import {
    getTargetingComputerRelevantWeight,
    targetingComputerCriticalSlots,
} from "./targeting-computer";
import { isBlueShieldEquipment, isMascEquipment } from "../../escalating-equipment.model";
import { isActuatorEnhancementSystem } from "../../myomer-equipment.model";
import {
    armorConstructionKind,
    structureConstructionKind,
} from "../../construction-equipment.model";
import {
    isTalonEquipment,
    physicalEquipmentCriticalSlots,
} from "./physical-weapon";
import { jumpBoosterCriticalSlots } from "../../jump-equipment.model";
import { isTracksEquipment } from "../../chassis-equipment.model";
import { supportEquipmentCriticalSlots } from "../../support-equipment.model";

// ═══════════════════════════════════════════════════════════════════════════
//  VARIABLE CRIT-SLOT RESOLUTION
//
//  Mirrors Java's MiscType.getNumCriticalSlots(Entity, double).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the actual number of critical slots an equipment item occupies
 * on this entity.  For equipment with fixed (numeric) crit slots, returns
 * the static value.  For variable equipment, applies the formula from
 * Java's `MiscType.getNumCriticalSlots(Entity, double)`.
 */
export function getNumCriticalSlots(entity: BaseEntity, eq: Equipment, size: number = 1): number | undefined {
    if (eq.svSlots !== undefined && eq.svSlots >= 0
        && entity.isSupportVehicle()) {
        return eq.svSlots;
    }
    if (eq.tankSlots !== undefined && eq.tankSlots >= 0
        && isVehicleEntity(entity) && !entity.isSupportVehicle()) {
        return eq.tankSlots;
    }
    
    const isSuperHeavyMek = isMekEntity(entity) && entity.isSuperHeavy();
    const isSuperHeavyEntity = isSuperHeavyMek
        || (isVehicleEntity(entity) && entity.isSuperHeavy());
    if (eq.hasFixedCriticalSlots()) {
        const fixedSlots = eq.critSlots;
        if (isSuperHeavyEntity) {
            return Math.ceil(fixedSlots / 2);
        }
        return fixedSlots;
    }

    const weight = entity.tonnage();
    const isQuad = isMekEntity(entity) && isQuadMekConfig(entity.chassisConfig);
    const isAero = isAeroEntity(entity);
    const armorKind = armorConstructionKind(eq);
    const structureKind = structureConstructionKind(eq);
    const physicalSlots = physicalEquipmentCriticalSlots(eq, weight);
    const boosterSlots = jumpBoosterCriticalSlots(eq, isQuad);
    const targetingComputerSlots = targetingComputerCriticalSlots(
        eq,
        () => getTargetingComputerRelevantWeight(entity),
    );
    const supportSlots = supportEquipmentCriticalSlots(entity, eq, size);

    if (physicalSlots !== null) return physicalSlots;

    // ── MASC ────────────────────────────────────────────────────────
    if (isMascEquipment(eq)) {
        return eq.techBase === 'Clan'
            ? Math.max(Math.round(weight / 25), 1)
            : Math.max(Math.round(weight / 20), 1);
    }

    // ── Aero armor (no crit slots) ──────────────────────────────────
    if (isAero && armorKind !== null && [
        'reactive', 'reflective', 'anti-penetrative-ablative',
        'ballistic-reinforced', 'ferro-lamellor',
    ].includes(armorKind)) {
        return 0;
    }

    // ── Targeting Computer ──────────────────────────────────────────
    if (targetingComputerSlots !== null) return targetingComputerSlots;

    // ── Ferro-Fibrous / Reactive ────────────────────────────────────
    if (armorKind === 'ferro-fibrous' || armorKind === 'reactive') {
        const mountedArmor = entity.uniformArmor();
        if (!mountedArmor) {
            return getPatchworkArmorSlots(
                entity,
                ['FERRO_FIBROUS', 'REACTIVE'],
                techBase => techBase === 'Clan' ? 1 : 2,
            ) ?? 0;
        }

        const base = mountedArmor.techBase === 'Clan' ? 7 : 14;
        return isSuperHeavyMek ? Math.ceil(base / 2) : base;
    }

    // ── Reflective ──────────────────────────────────────────────────
    if (armorKind === 'reflective') {
        const mountedArmor = entity.uniformArmor();
        if (!mountedArmor) {
            return getPatchworkArmorSlots(
                entity,
                ['REFLECTIVE'],
                techBase => techBase === 'Clan' ? 1 : 2,
            ) ?? 0;
        }

        const base = mountedArmor.techBase === 'Clan' ? 5 : 10;
        return isSuperHeavyMek ? Math.ceil(base / 2) : base;
    }

    // ── Light Ferro-Fibrous ─────────────────────────────────────────
    if (armorKind === 'light-ferro') {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['LIGHT_FERRO'], () => 1);
        return patchworkSlots ?? (isSuperHeavyMek ? 4 : 7);
    }

    // ── Heavy Ferro-Fibrous ─────────────────────────────────────────
    if (armorKind === 'heavy-ferro') {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['HEAVY_FERRO'], () => 3);
        return patchworkSlots ?? (isSuperHeavyMek ? 11 : 21);
    }

    // ── Ferro-Lamellor ──────────────────────────────────────────────
    if (armorKind === 'ferro-lamellor') {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['FERRO_LAMELLOR'], () => 2);
        return patchworkSlots ?? (isSuperHeavyMek ? 6 : 12);
    }

    // ── Ferro-Fibrous Prototype ─────────────────────────────────────
    if (armorKind === 'ferro-fibrous-prototype') {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['FERRO_FIBROUS_PROTO'], () => 2);
        return patchworkSlots ?? (isSuperHeavyMek ? 8 : 16);
    }

    // ── Anti-Penetrative Ablative / Heat-Dissipating ────────────────
    if (armorKind === 'anti-penetrative-ablative' || armorKind === 'heat-dissipating') {
        return isSuperHeavyMek ? 3 : 6;
    }

    // ── Ballistic-Reinforced / Impact-Resistant ─────────────────────
    if (armorKind === 'ballistic-reinforced' || armorKind === 'impact-resistant') {
        return isSuperHeavyMek ? 5 : 10;
    }

    // ── Jump Booster / Talons ───────────────────────────────────────
    if (boosterSlots !== null || isTalonEquipment(eq)) return boosterSlots ?? (isQuad ? 8 : 4);

    // ── Tracks ──────────────────────────────────────────────────────
    if (isTracksEquipment(eq)) {
        if (isQuad) return 4;
        if (isMekEntity(entity)
            && (entity.chassisConfig === 'Biped' || entity.chassisConfig === 'LAM')) {
            return 2;
        }
    }

    // ── Actuator Enhancement System ─────────────────────────────────
    if (isActuatorEnhancementSystem(eq)) {
        const wc = entity.weightClass();
        if (wc === 'Light') return 1;
        if (wc === 'Medium') return 2;
        if (wc === 'Heavy') return 3;
        if (wc === 'Assault') return 4;
        return weightClassCode(wc);
    }

    // ── Blue Shield ─────────────────────────────────────────────────
    if (isBlueShieldEquipment(eq)) {
        return isAero ? 4 : entity.locationOrder.length - 1;
    }

    // ── Endo Steel ──────────────────────────────────────────────────
    if (structureKind === 'endo-steel') {
        const base = eq.techBase === 'Clan' ? 7 : 14;
        return isSuperHeavyEntity ? Math.ceil(base / 2) : base;
    }

    // ── Endo Steel Prototype ────────────────────────────────────────
    if (structureKind === 'endo-steel-prototype') {
        return isSuperHeavyEntity ? 8 : 16;
    }

    // ── Endo-Composite ──────────────────────────────────────────────
    if (structureKind === 'endo-composite') {
        const base = eq.techBase === 'Clan' ? 4 : 7;
        return isSuperHeavyEntity ? Math.ceil(base / 2) : base;
    }

    if (supportSlots !== null) return supportSlots;

    // MegaMek logs an error and assumes one slot for an unrecognized formula.
    return 1;
}

function getPatchworkArmorSlots(
    entity: BaseEntity,
    armorTypes: readonly ArmorType[],
    slotsPerLocation: (techBase: 'IS' | 'Clan' | 'All') => number,
): number | undefined {
    if (!entity.hasPatchworkArmor()) return undefined;

    const slots = entity.armorLocations.reduce((total, location) => {
        const locationArmor = entity.armorAt(location);
        if (!armorTypes.includes(locationArmor.type)) return total;
        return total + slotsPerLocation(locationArmor.techBase);
    }, 0);

    return isMekEntity(entity) && entity.isSuperHeavy()
        ? Math.ceil(slots / 2)
        : slots;
}
