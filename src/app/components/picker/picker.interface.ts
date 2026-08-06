// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { InputSignal, OutputEmitterRef, WritableSignal } from '@angular/core';

/*
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
export type PickerTargetType = 'skill' | 'crit' | 'armor' | 'inventory' | 'heatsinks' | 'motive';

/** Choice value type - string or number */
export type PickerValue = string | number;

// =============================================================================
// Choice Picker Types (Linear/Radial)
// =============================================================================

/** Display type for choice rendering */
export type PickerDisplayType = 'button' | 'dropdown' | 'label' | 'state-button' | 'toggle';

/** Active-choice visual tone. Selected is the strong/default active state; muted is a softer active state. */
export type PickerChoiceSelectionTone = 'selected' | 'muted';

/** Optional background and text colors for renderer states. */
export interface PickerChoiceColors {
    normal?: string;
    normalText?: string;
    selected?: string;
    selectedText?: string;
    mutedSelected?: string;
    mutedSelectedText?: string;
    disabled?: string;
    disabledText?: string;
}

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
    selectionTone?: PickerChoiceSelectionTone;
    colors?: PickerChoiceColors;
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