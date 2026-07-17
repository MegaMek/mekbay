import { ALL_MOTIVE_TYPES, type MotiveType } from '../types/motive';

const MOTIVE_TYPE_BY_LOWERCASE = new Map<string, MotiveType>(
  ALL_MOTIVE_TYPES.map(type => [type.toLowerCase(), type]),
);

const MOTIVE_TYPE_ALIASES = new Map<string, MotiveType>([
  ['building', 'None'],
  ['microcopter', 'VTOL'],
  ['micro-copter', 'VTOL'],
  ['microlite', 'VTOL'],
  ['glider', 'WiGE'],
  ['scuba', 'UMU'],
  ['motorized scuba', 'UMU'],
  ['foot', 'Leg'],
  ['foot infantry', 'Leg'],
  ['motorized infantry', 'Motorized'],
  ['jump infantry', 'Jump'],
  ['inf_leg', 'Leg'],
  ['inf_motorized', 'Motorized'],
  ['inf_jump', 'Jump'],
  ['inf_umu', 'UMU'],
  ['biped_swim', 'UMU'],
  ['quad_swim', 'UMU'],
  ['station', 'Station Keeping'],
  ['station_keeping', 'Station Keeping'],
  ['station-keeping', 'Station Keeping'],
  ['satellite', 'Station Keeping'],
  ['maglev', 'MagLev'],
  ['wige', 'WiGE'],
]);

/** Decode an MTF or BLK movement-mode value to its canonical domain type. */
export function decodeMotiveType(value: string): MotiveType {
  const normalized = value.trim().toLowerCase();
  return MOTIVE_TYPE_BY_LOWERCASE.get(normalized)
    ?? MOTIVE_TYPE_ALIASES.get(normalized)
    ?? 'None';
}
