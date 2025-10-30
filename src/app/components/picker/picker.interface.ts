import { Signal, WritableSignal, InputSignal, OutputEmitterRef } from '@angular/core';

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

/*
 * Author: Drake
 * Picker interface for all picker components
 */
export interface PickerPosition {
    x: number;
    y: number;
}

export type PickerTargetType = 'skill' | 'crit' | 'armor' | 'inventory' | 'heatsinks';

export type PickerInteractionType = 'mouse' | 'touch';
export type PickerValue = string | number;
export type PickerChoice = {
    label: string;
    value: PickerValue;
    disabled?: boolean;
};

export interface PickerComponent {
    interactionType: WritableSignal<PickerInteractionType>;
    title: WritableSignal<string | null>;
    values: WritableSignal<PickerChoice[]>;
    selected: WritableSignal<PickerValue | null>;
    position: WritableSignal<PickerPosition>;

    // Output emitters
    picked: OutputEmitterRef<PickerValue>;
    cancelled: OutputEmitterRef<void>;

    // Methods
    pick(val: PickerValue): void;
    cancel(): void;
}

export interface PickerInstance {
    component: PickerComponent;
    destroy(): void;
}