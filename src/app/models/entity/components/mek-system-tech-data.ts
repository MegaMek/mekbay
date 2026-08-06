// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { approx, type TechAdvancement } from '../types';

const FULL_HEAD_EJECTION_TECH: TechAdvancement = {
  techBase: 'All', rating: 'D', availability: ['X', 'X', 'E', 'D'], level: 'Standard',
  dates: {
    is: { production: approx(3020), common: 3023 },
    clan: { common: 3052 },
  },
  factions: { prototype: ['LC'], production: ['LC', 'CWF'] },
};

const RISC_HEAT_SINK_OVERRIDE_KIT_TECH: TechAdvancement = {
  techBase: 'IS', rating: 'D', availability: ['X', 'X', 'X', 'F'], level: 'Experimental',
  dates: { prototype: 3134 },
  factions: { prototype: ['RS'] },
};

export function getFullHeadEjectionTech(): TechAdvancement {
  return FULL_HEAD_EJECTION_TECH;
}

export function getRiscHeatSinkOverrideKitTech(): TechAdvancement {
  return RISC_HEAT_SINK_OVERRIDE_KIT_TECH;
}