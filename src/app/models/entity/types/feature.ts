// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Canonical, export-ready features derived from entity construction state. */
export type EntityFeature =
	| 'Small Cockpit'
	| 'Primitive Cockpit'
	| 'Primitive Industrial Cockpit'
	| 'Command Console'
	| 'Torso-Mounted Cockpit'
	| 'Dual Cockpit'
	| 'Interface Cockpit'
	| 'Virtual Reality Piloting Pod'
	| 'Superheavy Command Console'
	| 'Small Command Console'
	| 'XL Gyro'
	| 'Compact Gyro'
	| 'Heavy Duty Gyro'
	| 'Superheavy Gyro'
	| 'Full Head Ejection System'
	| 'RISC Heat Sink Override Kit'
	| 'FrankenMek'
	| 'VSTOL Equipment'
	| 'LF Battery'
	| 'Infantry Compartment'
	| `Chassis Mod: ${string}`
	| `Bay: ${string}`
	| 'Reversible Arms';
