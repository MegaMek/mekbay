// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

// ============================================================================
// Entity Identity
// ============================================================================

/** Discriminant type for all entity subclasses */
export type EntityType =
  | 'Mek'
  | 'Aero'
  | 'ConvFighter'
  | 'FixedWingSupport'
  | 'SmallCraft'
  | 'DropShip'
  | 'JumpShip'
  | 'WarShip'
  | 'SpaceStation'
  | 'Tank'
  | 'Naval'
  | 'VTOL'
  | 'SupportTank'
  | 'SupportNaval'
  | 'SupportVTOL'
  | 'LargeSupportTank'
  | 'Infantry'
  | 'BattleArmor'
  | 'ProtoMek'
  | 'HandheldWeapon'
  | 'GunEmplacement'
  | 'BuildingEntity';
