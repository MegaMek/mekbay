// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Movement-mode names exposed by MegaMek's unit data, see getMovementModeAsString */
export type MoveType =
  | 'Aerodyne'
  | 'Biped'
  | 'Hover'
  | 'Hydrofoil'
  | 'Jump'
  | 'Leg'
  | 'MagLev'
  | 'Microcopter'
  | 'Microlite'
  | 'Motorized'
  | 'Motorized SCUBA'
  | 'Naval'
  | 'None'
  | 'Quad'
  | 'Rail'
  | 'SCUBA'
  | 'Spheroid'
  | 'Submarine'
  | 'Station-Keeping'
  | 'Tracked'
  | 'Tripod'
  | 'UMU'
  | 'VTOL'
  | 'Wheeled'
  | 'WiGE'
  | 'ERROR';

export interface MovementCalculationOptions {
  readonly ignoreGravity: boolean;
  readonly ignoreHeat: boolean;
  readonly ignoreModularArmor: boolean;
  readonly ignoreChainDrape: boolean;
  readonly ignoreMASC: boolean;
  readonly ignoreMyomerBooster: boolean;
  readonly ignoreDWP: boolean;
  readonly ignoreBurden: boolean;
  readonly ignoreCargo: boolean;
  readonly ignoreWeather: boolean;
  readonly singleMASC: boolean;
  readonly ignoreSubmergedJumpJets: boolean;
  readonly ignoreGrounded: boolean;
  readonly ignoreOptionalRules: boolean;
  readonly ignoreConversion: boolean;
  readonly forceTSM: boolean;
  /** Include Mek alternate jump systems, such as mechanical jump boosters. */
  readonly includeAlternateJumpSystems: boolean;
}

export const STANDARD_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ignoreGravity: false,
  ignoreHeat: false,
  ignoreModularArmor: false,
  ignoreChainDrape: false,
  ignoreMASC: false,
  ignoreMyomerBooster: false,
  ignoreDWP: false,
  ignoreBurden: false,
  ignoreCargo: false,
  ignoreWeather: false,
  singleMASC: false,
  ignoreSubmergedJumpJets: true,
  ignoreGrounded: false,
  ignoreOptionalRules: false,
  ignoreConversion: false,
  forceTSM: false,
  includeAlternateJumpSystems: false,
};

export const RUN_WITHOUT_MASC_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  ignoreMASC: true,
};

/** Java Entity.getAnyTypeMaxJumpMP(): standard jump conditions plus alternate jump systems. */
export const ANY_TYPE_JUMP_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  includeAlternateJumpSystems: true,
};

export const BV_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  ignoreGravity: true,
  ignoreHeat: true,
  ignoreModularArmor: true,
  ignoreDWP: true,
  ignoreBurden: true,
  ignoreCargo: true,
  ignoreWeather: true,
  ignoreGrounded: true,
  ignoreOptionalRules: true,
  ignoreConversion: true,
  forceTSM: true,
  includeAlternateJumpSystems: true,
};

export const AS_MOVEMENT_CALCULATION: MovementCalculationOptions = {
  ...STANDARD_MOVEMENT_CALCULATION,
  ignoreGravity: true,
  ignoreHeat: true,
  ignoreModularArmor: true,
  ignoreChainDrape: true,
  ignoreMyomerBooster: true,
  ignoreDWP: true,
  ignoreBurden: true,
  ignoreCargo: true,
  ignoreWeather: true,
  ignoreGrounded: true,
  ignoreOptionalRules: true,
  ignoreConversion: true,
};
