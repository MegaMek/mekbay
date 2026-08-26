// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../equipment.model';

export const CLAN_EXCEPTIONAL_BAY_IDS = new Set(['AR10 Bay', 'AMS Bay', 'ATM Bay', 'Bomb Bay']);

export function weaponBayEquipmentId(weapon: WeaponEquipment): string {
  switch (weapon.weapon.atClass) {
    case 'LASER': return 'Laser Bay';
    case 'AMS': return 'AMS Bay';
    case 'POINT_DEFENSE': return 'Point Defense Bay';
    case 'PPC': return 'PPC Bay';
    case 'PULSE_LASER': return 'Pulse Laser Bay';
    case 'ARTILLERY': return 'Artillery Bay';
    case 'PLASMA': return 'Plasma Bay';
    case 'AC': return 'AC Bay';
    case 'LBX_AC': return 'LBX AC Bay';
    case 'LRM': return 'LRM Bay';
    case 'SRM': return 'SRM Bay';
    case 'MRM': return 'MRM Bay';
    case 'MML': return 'MML Bay';
    case 'THUNDERBOLT': return 'Thunderbolt Bay';
    case 'ATM': return 'ATM Bay';
    case 'ROCKET_LAUNCHER': return 'Rocket Launcher Bay';
    case 'CAPITAL_LASER': return weapon.subCapital ? 'Sub-Capital Laser Bay' : 'Capital Laser Bay';
    case 'CAPITAL_PPC': return 'Capital PPC Bay';
    case 'CAPITAL_AC': return weapon.subCapital ? 'Sub-Capital Cannon Bay' : 'Capital AC Bay';
    case 'CAPITAL_GAUSS': return 'Capital Gauss Bay';
    case 'CAPITAL_MD': return 'Capital Mass Driver Bay';
    case 'CAPITAL_MISSILE': return weapon.subCapital ? 'Sub-Capital Missile Bay' : 'Capital Missile Bay';
    case 'TELE_MISSILE': return 'Tele-Operated Capital Missile Bay';
    case 'AR10': return 'AR10 Bay';
    case 'SCREEN': return 'Screen Launcher Bay';
    default: return weapon.ammoType === 'BOMB' ? 'Bomb Bay' : 'Misc Bay';
  }
}
