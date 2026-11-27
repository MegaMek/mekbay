// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitType, UnitSubtype } from './entity/types';

export type UnitCrewKind = 'none' | 'integrated' | 'swappable';

export type CrewSkillSet = 'ground' | 'aerospace' | 'both';

/** VTOLs use vehicle gunnery/VTOL piloting in MekHQ, grouped here as Ground. */
export function unitCrewSkillSet(type: UnitType, subtype: UnitSubtype): CrewSkillSet {
  if (subtype === 'Land-Air BattleMek') return 'both';
  return type === 'Aero' ? 'aerospace' : 'ground';
}

/** Personal ratings; omitted values have the standard 4/5 defaults in each set. */
export interface CrewSkills {
  readonly gunnery?: number;
  readonly piloting?: number;
  readonly aeroGunnery?: number;
  readonly aeroPiloting?: number;
}

/** LAM BV uses the better rating from each pair, matching the crew editor. */
export function crewSkillsForUnit(skills: CrewSkills | undefined, type: UnitType, subtype: UnitSubtype) {
  const set = unitCrewSkillSet(type, subtype);
  const ground = { gunnery: skills?.gunnery ?? 4, piloting: skills?.piloting ?? 5 };
  const aero = { gunnery: skills?.aeroGunnery ?? 4, piloting: skills?.aeroPiloting ?? 5 };
  return set === 'aerospace' ? aero : set === 'ground' ? ground : {
    gunnery: Math.min(ground.gunnery, aero.gunnery),
    piloting: Math.min(ground.piloting, aero.piloting),
  };
}

export function unitTracksPilotWounds(type: UnitType): boolean {
  return type === 'Mek' || type === 'ProtoMek' || type === 'Aero';
}

/** Assignment policy is a unit fact; an empty personnel roster does not erase its stations. */
export function unitCrewKind(type: UnitType, subtype: UnitSubtype, stationCount?: number): UnitCrewKind {
  if (stationCount === 0 || type === 'Handheld Weapon' || type === 'Building') return 'none';
  if (type === 'Infantry' && subtype !== 'Battle Armor') return 'integrated';
  return 'swappable';
}

export interface UnitCrewPolicy {
  readonly kind: UnitCrewKind;
  readonly positions: readonly { readonly positionId: string; readonly label: string }[];
  readonly canEdit: boolean;
  readonly reason?: string;
}
