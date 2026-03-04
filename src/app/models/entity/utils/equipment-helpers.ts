
import type { Equipment } from "../../equipment.model";
import type { BaseEntity } from "../base-entity";
import { AeroEntity } from "../entities/aero/aero-entity";
import { MekEntity } from "../entities/mek/mek-entity";
import { QuadMekEntity } from "../entities/mek/quad-mek-entity";
import { SupportTankEntity } from "../entities/vehicle/support-tank-entity";
import { SupportVtolEntity } from "../entities/vehicle/support-vtol-entity";
import { VehicleEntity } from "../entities/vehicle/vehicle-entity";

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
    && (entity instanceof SupportTankEntity || entity instanceof SupportVtolEntity)) {
        return eq.stats.svSlots;
    }
    if (eq.stats.tankSlots !== undefined && eq.stats.tankSlots >= 0 
    && (entity instanceof VehicleEntity)) {
        return eq.stats.tankSlots;
    }
    const isSuperHeavy = entity instanceof MekEntity && entity.isSuperHeavy();

    if (eq.stats.criticalSlots !== "variable") {
        const fixedSlots = eq.stats.criticalSlots as number;
        if (isSuperHeavy) {
            return Math.ceil(fixedSlots / 2);
        }
        return fixedSlots;
    }

    const weight = entity.tonnage();
    const isClan = entity.techBase() === 'Clan';
    const isQuad = entity instanceof QuadMekEntity;
    const isAero = entity instanceof AeroEntity;

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
        return isClan
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

    // ── Targeting Computer (needs weapon list — cannot resolve here) ─
    if (eq.hasFlag('F_TARGETING_COMPUTER')) return undefined;

    // ── Ferro-Fibrous / Reactive ────────────────────────────────────
    if (eq.hasFlag('F_FERRO_FIBROUS') || eq.hasFlag('F_REACTIVE')) {
        const base = isClan ? 7 : 14;
        return isSuperHeavy ? Math.ceil(base / 2) : base;
    }

    // ── Reflective ──────────────────────────────────────────────────
    if (eq.hasFlag('F_REFLECTIVE')) {
        const base = isClan ? 5 : 10;
        return isSuperHeavy ? Math.ceil(base / 2) : base;
    }

    // ── Light Ferro-Fibrous ─────────────────────────────────────────
    if (eq.hasFlag('F_LIGHT_FERRO')) {
        return isSuperHeavy ? 4 : 7;
    }

    // ── Heavy Ferro-Fibrous ─────────────────────────────────────────
    if (eq.hasFlag('F_HEAVY_FERRO')) {
        return isSuperHeavy ? 11 : 21;
    }

    // ── Ferro-Lamellor ──────────────────────────────────────────────
    if (eq.hasFlag('F_FERRO_LAMELLOR')) {
        return isSuperHeavy ? 6 : 12;
    }

    // ── Ferro-Fibrous Prototype ─────────────────────────────────────
    if (eq.hasFlag('F_FERRO_FIBROUS_PROTO')) {
        return isSuperHeavy ? 8 : 16;
    }

    // ── Anti-Penetrative Ablative / Heat-Dissipating ────────────────
    if (eq.hasFlag('F_ANTI_PENETRATIVE_ABLATIVE') || eq.hasFlag('F_HEAT_DISSIPATING')) {
        return isSuperHeavy ? 3 : 6;
    }

    // ── Ballistic-Reinforced / Impact-Resistant ─────────────────────
    if (eq.hasFlag('F_BALLISTIC_REINFORCED') || eq.hasFlag('F_IMPACT_RESISTANT')) {
        return isSuperHeavy ? 5 : 10;
    }

    // ── Jump Booster / Talons ───────────────────────────────────────
    if (eq.hasFlag('F_JUMP_BOOSTER') || eq.hasFlag('F_TALON')) {
        return isQuad ? 8 : 4;
    }

    // ── Tracks ──────────────────────────────────────────────────────
    if (eq.hasFlag('F_TRACKS')) {
        return isQuad ? 4 : 2;
    }

    // ── Actuator Enhancement System ─────────────────────────────────
    if (eq.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) {
        const wc = entity.weightClass();
        if (wc === 'Light' || wc === 'Ultra Light') return 1;
        if (wc === 'Medium') return 2;
        if (wc === 'Heavy') return 3;
        return 4; // Assault / Super Heavy
    }

    // ── Blue Shield ─────────────────────────────────────────────────
    if (eq.hasFlag('F_BLUE_SHIELD')) {
        return isAero ? 4 : entity.validLocations.size - 1;
    }

    // ── Endo Steel ──────────────────────────────────────────────────
    if (eq.hasFlag('F_ENDO_STEEL')) {
        const base = isClan ? 7 : 14;
        return isSuperHeavy ? Math.ceil(base / 2) : base;
    }

    // ── Endo Steel Prototype ────────────────────────────────────────
    if (eq.hasFlag('F_ENDO_STEEL_PROTO')) {
        return isSuperHeavy ? 8 : 16;
    }

    // ── Endo-Composite ──────────────────────────────────────────────
    if (eq.hasFlag('F_ENDO_COMPOSITE')) {
        const base = isClan ? 4 : 7;
        return isSuperHeavy ? Math.ceil(base / 2) : base;
    }

    // ── Fuel ────────────────────────────────────────────────────────
    if (eq.hasFlag('F_FUEL')) {
        return Math.ceil(size || 1);
    }

    // ── Cargo ───────────────────────────────────────────────────────
    if (eq.hasFlag('F_CARGO')) {
        return isAero ? 0 : Math.ceil(size || 1);
    }

    // ── Liquid Cargo / Communications ───────────────────────────────
    if (eq.hasFlag('F_LIQUID_CARGO') || eq.hasFlag('F_COMMUNICATIONS')) {
        return Math.ceil(size || 1);
    }

    // Unrecognized variable formula — caller must handle
    return undefined;
}