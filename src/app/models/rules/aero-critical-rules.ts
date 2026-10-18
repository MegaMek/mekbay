// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { NonMekHitArc } from '../runtime/non-mek-hit-location';

/** The critical damage a hit-location result threatens (TW p.237 Aerospace Units Hit Location Table). */
export type AeroCriticalType =
    | 'weapon' | 'sensors' | 'heat-sink' | 'avionics' | 'control' | 'fcs' | 'gear' | 'fuel' | 'engine'
    | 'crew' | 'bomb' | 'life-support' | 'thruster' | 'door' | 'cargo' | 'docking-collar' | 'kf-boom';

type Column = 'nose' | 'aft' | 'side';

/** Rolls 2 through 12 of each attack direction. */
const FIGHTER_CRITICALS: Readonly<Record<Column, readonly AeroCriticalType[]>> = {
    nose: ['weapon', 'sensors', 'heat-sink', 'weapon', 'avionics', 'control', 'fcs', 'weapon', 'heat-sink', 'gear', 'weapon'],
    aft: ['weapon', 'heat-sink', 'fuel', 'weapon', 'engine', 'control', 'engine', 'weapon', 'fuel', 'heat-sink', 'weapon'],
    side: ['weapon', 'gear', 'sensors', 'crew', 'weapon', 'avionics', 'bomb', 'control', 'engine', 'gear', 'weapon'],
};

const SMALL_CRAFT_CRITICALS: Readonly<Record<Column, readonly AeroCriticalType[]>> = {
    nose: ['crew', 'avionics', 'weapon', 'thruster', 'fcs', 'weapon', 'control', 'thruster', 'weapon', 'sensors', 'kf-boom'],
    aft: ['life-support', 'control', 'weapon', 'door', 'engine', 'weapon', 'docking-collar', 'door', 'weapon', 'gear', 'fuel'],
    side: ['weapon', 'fcs', 'sensors', 'thruster', 'cargo', 'weapon', 'door', 'thruster', 'avionics', 'engine', 'weapon'],
};

export const AERO_CRITICAL_LABELS: Readonly<Record<AeroCriticalType, string>> = {
    weapon: 'Weapon', sensors: 'Sensors', 'heat-sink': 'Heat Sink', avionics: 'Avionics', control: 'Control',
    fcs: 'FCS', gear: 'Gear', fuel: 'Fuel', engine: 'Engine', crew: 'Crew', bomb: 'Bomb', 'life-support': 'Life Support',
    thruster: 'Thruster', door: 'Door', cargo: 'Cargo', 'docking-collar': 'Docking Collar', 'kf-boom': 'K-F Boom',
};

/** A possible critical takes effect on 8 or more (TW p.238, standard-scale armor). */
export const AERO_CRITICAL_TARGET = 8;

/**
 * The critical damage one hit-location roll threatens on fighters and on DropShips and small craft. Capital
 * ships use the StratOps tables, which are not covered here.
 */
export function aeroCriticalType(entity: BaseEntity, arc: NonMekHitArc, roll: number): AeroCriticalType | undefined {
    if (['JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType)) return undefined;
    const table = entity.entityType === 'SmallCraft' || entity.entityType === 'DropShip'
        ? SMALL_CRAFT_CRITICALS
        : FIGHTER_CRITICALS;
    return table[arc === 'front' ? 'nose' : arc === 'rear' ? 'aft' : 'side'][roll - 2];
}
