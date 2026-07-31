import type { ArmorEquipment } from '../../../equipment.model';

/** Default Total Warfare target movement modifier (advanced movement option off). */
export function targetMovementModifier(mp: number, jumped = false, airborne = false): number {
  if (mp <= 0) return 0;
  let modifier = mp >= 25 ? 6 : mp >= 18 ? 5 : mp >= 10 ? 4 : mp >= 7 ? 3 : mp >= 5 ? 2 : mp >= 3 ? 1 : 0;
  if (airborne) modifier++;
  else if (jumped) modifier++;
  return modifier;
}

/** TM p.316 offensive speed factor, rounded exactly as MegaMek does. */
export function offensiveSpeedFactor(mp: number): number {
  return Math.round(Math.pow(1 + (mp - 5) / 10, 1.2) * 100) / 100;
}

export function armorBVMultiplier(armor: ArmorEquipment | undefined): number {
  switch (armor?.armorType) {
    case 'HARDENED': return 2;
    case 'REACTIVE':
    case 'REFLECTIVE':
    case 'BALLISTIC_REINFORCED': return 1.5;
    case 'FERRO_LAMELLOR':
    case 'ANTI_PENETRATIVE_ABLATION': return 1.2;
    case 'HEAT_DISSIPATING': return 1.1;
    default: return 1;
  }
}

export function vehicleTypeModifier(motive: string): number {
  switch (motive) {
    case 'Tracked': return 0.9;
    case 'Wheeled': return 0.8;
    case 'Hover':
    case 'VTOL':
    case 'WiGE': return 0.7;
    default: return 0.6;
  }
}

export function ammoKey(ammoType: string, rackSize: number, location?: string): string {
  const key = `${ammoType}:${rackSize}`;
  return location === undefined ? key : `${location}:${key}`;
}
