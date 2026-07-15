/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

// ============================================================================
// Transporters & Bays
// ============================================================================

export type InfantryTransportType = 'Foot' | 'Jump' | 'Motorized' | 'Mechanized';

export const INFANTRY_TRANSPORT_WEIGHTS: Readonly<Record<InfantryTransportType, number>> = {
  Foot: 5,
  Jump: 6,
  Motorized: 7,
  Mechanized: 8,
};

export type StandardTransportBayType =
  | 'generic'
  | 'cargo'
  | 'liquid-cargo'
  | 'insulated-cargo'
  | 'refrigerated-cargo'
  | 'livestock-cargo'
  | 'mek'
  | 'light-vehicle'
  | 'heavy-vehicle'
  | 'super-heavy-vehicle'
  | 'protomek'
  | 'crew-quarters'
  | 'steerage-quarters'
  | 'second-class-quarters'
  | 'first-class-quarters'
  | 'pillion-seats'
  | 'standard-seats'
  | 'ejection-seats';

export type TransportBayConfiguration =
  | { type: StandardTransportBayType }
  | { type: 'fighter' | 'small-craft'; arts: boolean }
  | { type: 'infantry'; infantryType: InfantryTransportType }
  | { type: 'battle-armor'; techBase: 'IS' | 'Clan'; comStar: boolean }
  | { type: 'drop-shuttle'; facing: number }
  | { type: 'naval-repair'; facing: number; pressurized: boolean; arts: boolean }
  | { type: 'reinforced-repair'; facing: number };

export interface EntityTransportBay {
  id: string;
  kind: 'bay';
  configuration: TransportBayConfiguration;
  /** Canonical Bay.getCapacity() value. Unit depends on bay type. */
  capacity: number;
  /** Preserves construction tonnage when BLK size is weight rather than capacity. */
  constructionWeight?: number;
  doors: number;
  bayNumber: number;
  omni: boolean;
}

export interface TroopSpaceTransporter {
  id: string;
  kind: 'troop-space';
  totalSpace: number;
  omni: boolean;
}

export interface DockingCollarTransporter {
  id: string;
  kind: 'docking-collar';
  collarNumber: number;
  omni: boolean;
}

export interface BattleArmorHandlesTransporter {
  id: string;
  kind: 'battle-armor-handles';
  troopers: number;
  omni: boolean;
}

export interface UnknownTransporter {
  id: string;
  kind: 'unknown';
  rawLine: string;
  omni: boolean;
}

export type EntityTransporter =
  | EntityTransportBay
  | TroopSpaceTransporter
  | DockingCollarTransporter
  | BattleArmorHandlesTransporter
  | UnknownTransporter;

export interface EntityWeaponBay {
  weaponIndices: number[];
  ammoIndices: number[];
  location: string;
  bayType: string;
}

// ============================================================================
// Crew (SmallCraft / DropShip)
// ============================================================================

export interface SmallCraftCrew {
  officers?: number;
  gunners?: number;
  crew?: number;
  passengers?: number;
  marines?: number;
  battleArmorHandles?: number;
  firstClassQuarters?: number;
  secondClassQuarters?: number;
  crewQuarters?: number;
  steerage?: number;
}
