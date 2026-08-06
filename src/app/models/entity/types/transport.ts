// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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

/** MegaMek's sentinel for a bay number that has not been assigned. */
export const UNSET_TRANSPORT_BAY_NUMBER = -1;

/** The inherited runtime bay number of bays whose constructors do not accept one. */
export const DEFAULT_TRANSPORT_BAY_NUMBER = 0;

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
  /**
   * Runtime Bay.getBayNumber().
   *
   * A few MegaMek bay implementations deliberately serialize the unset value
   * even though their runtime number is assigned (or inherited as zero).
   */
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

export type EntityTransporter =
  | EntityTransportBay
  | TroopSpaceTransporter
  | DockingCollarTransporter
  | BattleArmorHandlesTransporter;

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
