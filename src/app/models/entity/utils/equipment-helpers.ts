
import type { Equipment } from "../../equipment.model";
import type { BaseEntity } from "../base-entity";
import { type ArmorType, isQuadMekConfig, weightClassCode } from "../types";
import { isAeroEntity, isMekEntity, isVehicleEntity } from "./entity-type-guards";
import { getTargetingComputerRelevantWeight } from "./targeting-computer";

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
    if (eq.stats.svSlots !== undefined && eq.stats.svSlots >= 0
        && entity.isSupportVehicle()) {
        return eq.stats.svSlots;
    }
    if (eq.stats.tankSlots !== undefined && eq.stats.tankSlots >= 0
        && isVehicleEntity(entity)) {
        return eq.stats.tankSlots;
    }
    
    const isSuperHeavyMek = isMekEntity(entity) && entity.isSuperHeavy();
    const isSuperHeavyEntity = isSuperHeavyMek
        || (isVehicleEntity(entity) && entity.isSuperHeavy());
    if (eq.stats.criticalSlots !== "variable") {
        const fixedSlots = eq.stats.criticalSlots;
        if (isSuperHeavyEntity) {
            return Math.ceil(fixedSlots / 2);
        }
        return fixedSlots;
    }

    const weight = entity.tonnage();
    const isQuad = isMekEntity(entity) && isQuadMekConfig(entity.chassisConfig);
    const isAero = isAeroEntity(entity);

    // ── Melee weapons (F_CLUB) ──────────────────────────────────────
    if (eq.hasFlag('F_CLUB')) {
        if (eq.hasAnyFlag(['S_HATCHET', 'S_SWORD'])) return Math.ceil(weight / 15);
        if (eq.hasFlag('S_LANCE')) return Math.ceil(weight / 20);
        if (eq.hasFlag('S_MACE')) return Math.ceil(weight / 10);
        if (eq.hasFlag('S_RETRACTABLE_BLADE')) return 1 + Math.ceil(weight / 20);
    }

    // ── Hand weapons ────────────────────────────────────────────────
    if (eq.hasFlag('F_HAND_WEAPON') && eq.hasFlag('S_CLAW')) {
        return Math.ceil(weight / 15);
    }

    // ── MASC ────────────────────────────────────────────────────────
    if (eq.hasFlag('F_MASC')) {
        return eq.techBase === 'Clan'
            ? Math.max(Math.round(weight / 25), 1)
            : Math.max(Math.round(weight / 20), 1);
    }

    // ── Aero armor (no crit slots) ──────────────────────────────────
    if (isAero && eq.hasAnyFlag([
        'F_REACTIVE', 'F_REFLECTIVE', 'F_ANTI_PENETRATIVE_ABLATIVE',
        'F_BALLISTIC_REINFORCED', 'F_FERRO_LAMELLOR',
    ])) {
        return 0;
    }

    // ── Targeting Computer ──────────────────────────────────────────
    if (eq.hasFlag('F_TARGETING_COMPUTER')) {
        const relevantWeight = getTargetingComputerRelevantWeight(entity);
        return relevantWeight === undefined
            ? undefined
            : Math.ceil(relevantWeight / (eq.techBase === 'Clan' ? 5 : 4));
    }

    // ── Ferro-Fibrous / Reactive ────────────────────────────────────
    if (eq.hasFlag('F_FERRO_FIBROUS') || eq.hasFlag('F_REACTIVE')) {
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
    if (eq.hasFlag('F_REFLECTIVE')) {
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
    if (eq.hasFlag('F_LIGHT_FERRO')) {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['LIGHT_FERRO'], () => 1);
        return patchworkSlots ?? (isSuperHeavyMek ? 4 : 7);
    }

    // ── Heavy Ferro-Fibrous ─────────────────────────────────────────
    if (eq.hasFlag('F_HEAVY_FERRO')) {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['HEAVY_FERRO'], () => 3);
        return patchworkSlots ?? (isSuperHeavyMek ? 11 : 21);
    }

    // ── Ferro-Lamellor ──────────────────────────────────────────────
    if (eq.hasFlag('F_FERRO_LAMELLOR')) {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['FERRO_LAMELLOR'], () => 2);
        return patchworkSlots ?? (isSuperHeavyMek ? 6 : 12);
    }

    // ── Ferro-Fibrous Prototype ─────────────────────────────────────
    if (eq.hasFlag('F_FERRO_FIBROUS_PROTO')) {
        const patchworkSlots = getPatchworkArmorSlots(entity, ['FERRO_FIBROUS_PROTO'], () => 2);
        return patchworkSlots ?? (isSuperHeavyMek ? 8 : 16);
    }

    // ── Anti-Penetrative Ablative / Heat-Dissipating ────────────────
    if (eq.hasFlag('F_ANTI_PENETRATIVE_ABLATIVE') || eq.hasFlag('F_HEAT_DISSIPATING')) {
        return isSuperHeavyMek ? 3 : 6;
    }

    // ── Ballistic-Reinforced / Impact-Resistant ─────────────────────
    if (eq.hasFlag('F_BALLISTIC_REINFORCED') || eq.hasFlag('F_IMPACT_RESISTANT')) {
        return isSuperHeavyMek ? 5 : 10;
    }

    // ── Jump Booster / Talons ───────────────────────────────────────
    if (eq.hasFlag('F_JUMP_BOOSTER') || eq.hasFlag('F_TALON')) {
        return isQuad ? 8 : 4;
    }

    // ── Tracks ──────────────────────────────────────────────────────
    if (eq.hasFlag('F_TRACKS')) {
        if (isQuad) return 4;
        if (isMekEntity(entity)
            && (entity.chassisConfig === 'Biped' || entity.chassisConfig === 'LAM')) {
            return 2;
        }
    }

    // ── Actuator Enhancement System ─────────────────────────────────
    if (eq.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) {
        const wc = entity.weightClass();
        if (wc === 'Light') return 1;
        if (wc === 'Medium') return 2;
        if (wc === 'Heavy') return 3;
        if (wc === 'Assault') return 4;
        return weightClassCode(wc);
    }

    // ── Blue Shield ─────────────────────────────────────────────────
    if (eq.hasFlag('F_BLUE_SHIELD')) {
        return isAero ? 4 : entity.locationOrder.length - 1;
    }

    // ── Endo Steel ──────────────────────────────────────────────────
    if (eq.hasFlag('F_ENDO_STEEL')) {
        const base = eq.techBase === 'Clan' ? 7 : 14;
        return isSuperHeavyEntity ? Math.ceil(base / 2) : base;
    }

    // ── Endo Steel Prototype ────────────────────────────────────────
    if (eq.hasFlag('F_ENDO_STEEL_PROTO')) {
        return isSuperHeavyEntity ? 8 : 16;
    }

    // ── Endo-Composite ──────────────────────────────────────────────
    if (eq.hasFlag('F_ENDO_COMPOSITE')) {
        const base = eq.techBase === 'Clan' ? 4 : 7;
        return isSuperHeavyEntity ? Math.ceil(base / 2) : base;
    }

    // ── Fuel ────────────────────────────────────────────────────────
    if (eq.hasFlag('F_FUEL')) {
        if (!entity.mountedEngine().installed) return 0;
        const usesTankEngine = entity.entityType === 'Tank'
            || entity.entityType === 'Naval'
            || entity.entityType === 'VTOL';
        const rawTonnage = entity.mountedEngine().getWeight({ tank: usesTankEngine }) * 0.1;
        return Math.ceil(roundStandard(rawTonnage, entity));
    }

    // ── Cargo ───────────────────────────────────────────────────────
    if (eq.hasFlag('F_CARGO')) {
        return isAero ? 0 : Math.ceil(size);
    }

    // ── Liquid Cargo / Communications ───────────────────────────────
    if (eq.hasFlag('F_LIQUID_CARGO') || eq.hasFlag('F_COMMUNICATIONS')) {
        return Math.ceil(size);
    }

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

function roundStandard(tonnage: number, entity: BaseEntity): number {
    const usesKilograms = entity.entityType === 'ProtoMek'
        || entity.entityType === 'BattleArmor'
        || (entity.isSupportVehicle() && entity.weightClass() === 'Small Support');
    return usesKilograms
        ? Math.ceil(tonnage * 1000) / 1000
        : Math.ceil(tonnage * 2) / 2;
}