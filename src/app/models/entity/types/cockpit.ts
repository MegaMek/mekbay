
// ============================================================================
// Cockpit Types
// ============================================================================

/**
 * Union of all known cockpit type strings.
 */
export type CockpitType =
  | 'Standard' | 'Small' | 'Command Console' | 'Torso-Mounted'
  | 'Dual' | 'Industrial' | 'Primitive' | 'Primitive Industrial'
  | 'Superheavy' | 'Superheavy Tripod' | 'Tripod'
  | 'Interface' | 'Virtual Reality Piloting Pod' | 'QuadVee'
  | 'Superheavy Industrial' | 'Superheavy Command Console'
  | 'Small Command Console' | 'Tripod Industrial'
  | 'Superheavy Tripod Industrial';

export const CommandCockpits: Set<CockpitType> = new Set(['Command Console', 'Superheavy Command Console','Small Command Console']);
