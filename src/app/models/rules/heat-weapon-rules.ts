// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import { gameRulesFor } from './game-rules';
import { isFireResistant } from './inferno-rules';
import type { WeaponEquipment } from '../equipment.model';
import { isFlamerEquipment, isHeatOrDamageWeapon } from '../flamer-mode.model';

/**
 * A heat-causing (H) weapon (TW p. 113; Core p. 182): flamers and the other flame-based weapons, which may deliver
 * their Damage Value as heat, and plasma weapons, which add rolled heat.
 */
export type HeatWeapon =
    /** `heat` is null where the heat equals the Damage Value; an ER flamer deals 1 (BMM p. 99; Core p. 184). */
    | Readonly<{ kind: 'flamer'; heat: number | null }>
    /** A flame-based infantry or battle armor weapon that is no flamer: heat or damage, never both (TW p. 305 §§). */
    | Readonly<{ kind: 'heat-or-damage' }>
    /** Heat rolled against units that track heat; extra damage dice against others (TW p. 140; Core p. 189). */
    | Readonly<{ kind: 'plasma-rifle'; heat: '1d3' | '1d6' | '2d6'; otherDamageDice: 1 | 2 | 3 }>
    /** 2D6 heat and no damage against units that track heat; 3D6 damage against others (TW p. 139). */
    | Readonly<{ kind: 'plasma-cannon' }>;

/** Whether a flamer hit applies its damage, its heat in place of damage, or both. */
export type HeatWeaponMode = 'damage' | 'heat' | 'both';

export interface HeatWeaponTarget {
    /** Meks, aerospace fighters and small craft track heat; heat dealt to anything else is converted or lost. */
    readonly tracksHeat: boolean;
    /** Fire-resistant armor ignores the heat and halves standard damage (TW p. 228; Core p. 148). */
    readonly fireResistant: boolean;
}

export interface HeatWeaponHit {
    readonly damage: number;
    readonly heat: number;
    /** Damage points per hit-location roll. */
    readonly groupSize: number;
    /** How many of the rolled dice the hit read, for showing and editing the roll. */
    readonly dice: number;
}

const ER_FLAMERS = new Set(['ER Flamer', 'CLERFlamer']);
const PLASMA_RIFLES: Readonly<Record<string, Extract<HeatWeapon, { kind: 'plasma-rifle' }>>> = {
    ISLightPlasmaRifle: { kind: 'plasma-rifle', heat: '1d3', otherDamageDice: 1 },
    ISPlasmaRifle: { kind: 'plasma-rifle', heat: '1d6', otherDamageDice: 2 },
    ISHeavyPlasmaRifle: { kind: 'plasma-rifle', heat: '2d6', otherDamageDice: 3 },
};

export function heatWeaponOf(equipment: WeaponEquipment): HeatWeapon | null {
    if (isFlamerEquipment(equipment)) {
        return Object.freeze({ kind: 'flamer', heat: ER_FLAMERS.has(equipment.id) ? 1 : null });
    }
    if (isHeatOrDamageWeapon(equipment)) return Object.freeze({ kind: 'heat-or-damage' });
    if (equipment.id === 'CLPlasmaCannon') return Object.freeze({ kind: 'plasma-cannon' });
    return PLASMA_RIFLES[equipment.id] ?? null;
}

/**
 * Whether a flamer's attacker declares heat or damage before rolling. Core always deals both (p. 183), as does Total
 * Warfare with the BattleMech Manual's optional Enhanced Flamers (p. 99).
 */
export function declaresFlamerHeat(ruleset: CBTRuleset, enhancedFlamers: boolean): boolean {
    return gameRulesFor(ruleset).supportsFlamerModes && !enhancedFlamers;
}

/** How a heat-or-damage hit applies: only a flamer can deal both, and only where it declares nothing. */
export function heatWeaponMode(
    weapon: HeatWeapon,
    ruleset: CBTRuleset,
    enhancedFlamers: boolean,
    declaredHeat: boolean,
): HeatWeaponMode {
    if (weapon.kind === 'flamer' && !declaresFlamerHeat(ruleset, enhancedFlamers)) return 'both';
    return declaredHeat ? 'heat' : 'damage';
}

/** Six-sided dice rolled with every plasma attack; each case reads the first ones it needs. */
export function heatWeaponDice(weapon: HeatWeapon): number {
    return weapon.kind === 'plasma-rifle' || weapon.kind === 'plasma-cannon' ? 3 : 0;
}

/**
 * What one hit delivers. `damage` is the weapon's Damage Value for the hit (a platoon: its damage for the troopers
 * hitting). Under Core a unit that does not track heat takes 2 damage per heat point (Core p. 148); under Total
 * Warfare plasma rolls extra damage instead and flamer heat is lost (TW pp. 113, 139-140).
 */
export function resolveHeatWeaponHit(
    weapon: HeatWeapon,
    damage: number,
    mode: HeatWeaponMode,
    ruleset: CBTRuleset,
    target: HeatWeaponTarget,
    dice: readonly number[],
): HeatWeaponHit {
    const core = ruleset === 'core-2026';
    const halved = (value: number) => core ? Math.ceil(value / 2) : Math.floor(value / 2);
    let read = 0;
    const roll = (count: number) => {
        read = Math.max(read, count);
        return dice.slice(0, count).reduce((sum, die) => sum + die, 0);
    };
    const hit = (hitDamage: number, heat: number, groupSize = Math.max(1, hitDamage)) =>
        Object.freeze({ damage: Math.max(0, hitDamage), heat: Math.max(0, heat), groupSize, dice: read });
    switch (weapon.kind) {
        case 'flamer':
        case 'heat-or-damage': {
            const heat = weapon.kind === 'flamer' ? weapon.heat ?? damage : damage;
            const applyDamage = mode !== 'heat' || !target.tracksHeat;
            const applyHeat = mode !== 'damage';
            const base = applyDamage ? (target.fireResistant ? halved(damage) : damage) : 0;
            if (target.fireResistant || !applyHeat) return hit(base, 0);
            if (target.tracksHeat) return hit(base, heat);
            return hit(base + (core ? 2 * heat : 0), 0);
        }
        case 'plasma-rifle': {
            if (target.fireResistant) return hit(halved(damage), 0, 5);
            if (!target.tracksHeat && !core) return hit(damage + roll(weapon.otherDamageDice), 0, 5);
            const heat = weapon.heat === '1d3' ? Math.ceil(roll(1) / 2) : weapon.heat === '1d6' ? roll(1) : roll(2);
            return target.tracksHeat ? hit(damage, heat) : hit(damage + 2 * heat, 0, 5);
        }
        case 'plasma-cannon': {
            if (target.fireResistant) return hit(0, 0);
            if (!target.tracksHeat && !core) return hit(roll(3), 0, 5);
            const heat = roll(2);
            return target.tracksHeat ? hit(0, heat) : hit(2 * heat, 0, 5);
        }
    }
}

/**
 * The heat facts of the unit an attack strikes: the linked unit when known, otherwise the target's declared unit
 * type. Null when neither is known.
 */
export function heatWeaponTarget(
    entity: BaseEntity | undefined,
    unitType: TnTargetUnitType | undefined,
): HeatWeaponTarget | null {
    if (entity) return Object.freeze({ tracksHeat: entity.tracksHeat(), fireResistant: isFireResistant(entity) });
    if (unitType === undefined) return null;
    return Object.freeze({ tracksHeat: unitType.startsWith('mek-') || unitType === 'aero', fireResistant: false });
}
