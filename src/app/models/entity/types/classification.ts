/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 */

/** Broad Classic BattleTech classification exposed by an entity. */
export type UnitType =
  | 'Aero'
  | 'Handheld Weapon'
  | 'Infantry'
  | 'Mek'
  | 'Naval'
  | 'ProtoMek'
  | 'Tank'
  | 'VTOL';

/** Detailed Classic BattleTech classification exposed by an entity. */
export type UnitSubtype =
  | 'Aerodyne DropShip'
  | 'Aerodyne Small Craft'
  | 'Aerospace Fighter'
  | 'Aerospace Fighter Omni'
  | 'Battle Armor'
  | 'BattleMek'
  | 'BattleMek Omni'
  | 'Civilian Aerodyne DropShip'
  | 'Civilian Aerodyne Small Craft'
  | 'Civilian Space Station'
  | 'Civilian Spheroid DropShip'
  | 'Combat Vehicle'
  | 'Combat Vehicle Omni'
  | 'Conventional Fighter'
  | 'Conventional Infantry'
  | 'Fixed Wing Support Vehicle'
  | 'Fixed Wing Support Vehicle Omni'
  | 'Handheld Weapon'
  | 'Hovercraft'
  | 'Hovercraft Omni'
  | 'Industrial Mek'
  | 'JumpShip'
  | 'Land-Air BattleMek'
  | 'Mechanized Conventional Infantry'
  | 'Military Space Station'
  | 'Motorized Conventional Infantry'
  | 'Naval Vessel'
  | 'ProtoMek'
  | 'Quad BattleMek'
  | 'Quad BattleMek Omni'
  | 'Quad Industrial Mek'
  | 'Quad ProtoMek'
  | 'QuadVee BattleMek'
  | 'QuadVee BattleMek Omni'
  | 'Spheroid DropShip'
  | 'Spheroid Small Craft'
  | 'Submarine'
  | 'Support Vehicle'
  | 'Support Vehicle Omni'
  | 'Tripod BattleMek'
  | 'Tripod BattleMek Omni'
  | 'WarShip'
  | 'WiGE';
