/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL), version 3.
 */

import { WeaponEquipment } from '../../equipment.model';

export const CLAN_EXCEPTIONAL_BAY_IDS = new Set(['AR10 Bay', 'AMS Bay', 'ATM Bay', 'Bomb Bay']);

export function weaponBayEquipmentId(weapon: WeaponEquipment): string {
  const ammoType = weapon.ammoType;

  if (ammoType === 'AR10') return 'AR10 Bay';
  if (ammoType === 'AMS') return 'AMS Bay';
  if (ammoType === 'ATM' || ammoType === 'IATM') return 'ATM Bay';
  if (ammoType === 'BOMB') return 'Bomb Bay';
  if (ammoType === 'SCREEN_LAUNCHER') return 'Screen Launcher Bay';

  if (weapon.subCapital) {
    if (weapon.hasFlag('F_ENERGY')) return 'Sub-Capital Laser Bay';
    if (weapon.hasFlag('F_MISSILE')) return 'Sub-Capital Missile Bay';
    return 'Sub-Capital Cannon Bay';
  }
  if (weapon.capital) {
    if (weapon.hasFlag('F_PPC')) return 'Capital PPC Bay';
    if (weapon.hasFlag('F_ENERGY')) return 'Capital Laser Bay';
    if (['LIGHT_NGAUSS', 'MED_NGAUSS', 'HEAVY_NGAUSS'].includes(ammoType)) return 'Capital Gauss Bay';
    if (ammoType === 'NAC') return 'Capital AC Bay';
    if (['LMASS', 'MMASS', 'HMASS'].includes(ammoType)) return 'Capital Mass Driver Bay';
    return 'Capital Missile Bay';
  }

  if (weapon.hasFlag('F_PPC')) return 'PPC Bay';
  if (weapon.hasFlag('F_PULSE')) return 'Pulse Laser Bay';
  if (weapon.hasFlag('F_LASER') || weapon.hasFlag('F_ENERGY')) return 'Laser Bay';
  if (weapon.hasFlag('F_ARTILLERY')) return 'Artillery Bay';
  if (ammoType === 'PLASMA') return 'Plasma Bay';
  if (ammoType === 'AC_LBX' || ammoType === 'AC_LBX_THB') return 'LBX AC Bay';
  if (['AC', 'AC_ULTRA', 'AC_ULTRA_THB', 'AC_ROTARY', 'LAC', 'AC_PRIMITIVE', 'AC_IMP'].includes(ammoType)) return 'AC Bay';
  if (['GAUSS', 'GAUSS_LIGHT', 'GAUSS_HEAVY', 'GAUSS_IMP', 'APGAUSS', 'MAGSHOT', 'HAG'].includes(ammoType)) return 'Gauss Bay';
  if (['LRM', 'LRM_TORPEDO', 'LRM_TORPEDO_COMBO', 'LRM_STREAK', 'LRM_PRIMITIVE', 'LRM_IMP', 'EXLRM'].includes(ammoType)) return 'LRM Bay';
  if (['SRM', 'SRM_TORPEDO', 'SRM_STREAK', 'SRM_ADVANCED', 'SRM_PRIMITIVE', 'SRM_IMP'].includes(ammoType)) return 'SRM Bay';
  if (ammoType === 'MRM') return 'MRM Bay';
  if (ammoType === 'MML') return 'MML Bay';
  if (ammoType === 'ROCKET_LAUNCHER') return 'Rocket Launcher Bay';
  if (['TBOLT_5', 'TBOLT_10', 'TBOLT_15', 'TBOLT_20'].includes(ammoType)) return 'Thunderbolt Bay';
  return 'Misc Bay';
}