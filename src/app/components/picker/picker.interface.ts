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

import { InputSignal, OutputEmitterRef, WritableSignal } from '@angular/core';

/*
 * Author: Drake
 * Picker interface for all picker components
 * 
 * Architecture:
 * - NumericPickerComponent: For selecting a number within a range (rotating dial)
 * - ChoicePickerComponent: For selecting from a list of choices (linear/radial)
 * 
 * Both share common positioning and lifecycle patterns through base interfaces.
 */

// =============================================================================
// Common Types
// =============================================================================

/** Position for picker placement */
export interface PickerPosition {
    x: number;
    y: number;
}

/** Target context for picker styling/behavior hints */
export type PickerTargetType = 'skill' | 'crit' | 'armor' | 'inventory' | 'heatsinks';

/** Choice value type - string or number */
export type PickerValue = string | number;

// =============================================================================
// Choice Picker Types (Linear/Radial)
// =============================================================================

/** Display type for choice rendering */
export type PickerDisplayType = 'button' | 'dropdown' | 'label' | 'state-button' | 'toggle';

/** Option for dropdown-type choices */
export interface PickerDropdownOption {
    label: string;
    value: PickerValue;
    disabled?: boolean;
}

/** A selectable choice for linear/radial pickers */
export interface PickerChoice {
    label: string;
    shortLabel?: string;
    value: PickerValue;
    disabled?: boolean;
    active?: boolean;
    keepOpen?: boolean;
    displayType?: PickerDisplayType;
    choices?: PickerDropdownOption[];
    tooltipType?: 'info' | 'success' | 'error';
}

// =============================================================================
// Numeric Picker Types (Rotating)
// =============================================================================

/** Result emitted when a numeric value is picked */
export interface NumericPickerResult {
    value: number;
}

// =============================================================================
// Base Picker Interface (shared by all pickers)
// =============================================================================

/** Base interface for all picker components */
export interface BasePicker {
    /** Optional title displayed above the picker */
    title: InputSignal<string | null>;
    /** Position of the picker on screen */
    position: InputSignal<PickerPosition>;
    /** Light theme flag */
    lightTheme: InputSignal<boolean>;
    /** Initial pointer event for drag continuation */
    initialEvent: WritableSignal<PointerEvent | null>;
    /** Emitted when picker is cancelled (dismissed without selection) */
    cancelled: OutputEmitterRef<void>;
    /** Cancel the picker */
    cancel(): void;
}

// =============================================================================
// Choice Picker Interface (Linear/Radial)
// =============================================================================

/** Interface for choice-based pickers (linear, radial) */
export interface ChoicePickerComponent extends BasePicker {
    /** Available choices to pick from */
    values: WritableSignal<PickerChoice[]>;
    /** Currently selected value */
    selected: InputSignal<PickerValue | null>;
    /** Emitted when a choice is picked */
    picked: OutputEmitterRef<PickerChoice>;
    /** Pick a choice */
    pick(val: PickerChoice): void;
}

// =============================================================================
// Numeric Picker Interface (Rotating)
// =============================================================================

/** Interface for numeric range picker (rotating dial) */
export interface NumericPickerComponent extends BasePicker {
    /** Minimum value (inclusive) */
    min: InputSignal<number>;
    /** Maximum value (inclusive) */
    max: InputSignal<number>;
    /** Threshold value (optional) */
    threshold: InputSignal<number | null>;
    /** Initial/selected value */
    selected: InputSignal<number>;
    /** Step increment (default: 1) */
    step: InputSignal<number>;
    /** Emitted when a value is picked */
    picked: OutputEmitterRef<NumericPickerResult>;
    /** Pick a numeric value */
    pick(value: number): void;
}

// =============================================================================
// Picker Instance (for dynamic component management)
// =============================================================================

/** Instance wrapper for choice pickers */
export interface ChoicePickerInstance {
    component: ChoicePickerComponent;
    /** Update the picker position */
    setPosition(position: PickerPosition): void;
    destroy(): void;
}

/** Instance wrapper for numeric pickers */
export interface NumericPickerInstance {
    component: NumericPickerComponent;
    /** Update the picker position */
    setPosition(position: PickerPosition): void;
    destroy(): void;
}

/** Union type for any picker instance */
export type PickerInstance = ChoicePickerInstance | NumericPickerInstance;

// =============================================================================
// Type Guards
// =============================================================================

/** Type guard to check if an instance is a ChoicePickerInstance */
export function isChoicePickerInstance(instance: PickerInstance): instance is ChoicePickerInstance {
    return 'values' in instance.component;
}

/** Type guard to check if an instance is a NumericPickerInstance */
export function isNumericPickerInstance(instance: PickerInstance): instance is NumericPickerInstance {
    return 'min' in instance.component && 'max' in instance.component;
}