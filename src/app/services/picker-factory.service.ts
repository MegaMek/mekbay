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

import { ApplicationRef, ComponentRef, createComponent, EnvironmentInjector, inject, Injectable, Injector } from '@angular/core';
import { OptionsService } from './options.service';
import { LayoutService } from './layout.service';
import {
    ChoicePickerInstance,
    NumericPickerInstance,
    NumericPickerResult,
    PickerChoice,
    PickerPosition,
    PickerTargetType,
    PickerValue
} from '../components/picker/picker.interface';
import { RotatingPickerComponent } from '../components/rotating-picker/rotating-picker.component';
import { LinearPickerComponent } from '../components/linear-picker/linear-picker.component';
import { RadialPickerComponent } from '../components/radial-picker/radial-picker.component';

/*
 * Author: Drake
 * 
 * Picker Factory Service - Centralized factory for creating picker components.
 * 
 * This service provides a clean, DRY interface for creating pickers throughout the app.
 * It handles:
 * - Picker type selection based on user preferences and context
 * - Component instantiation and DOM attachment
 * - Event subscription setup
 * - Proper cleanup on destroy
 * 
 * Usage:
 *   // Numeric picker (for range selection)
 *   const instance = this.pickerFactory.createNumericPicker({
 *     min: 0,
 *     max: 10,
 *     selected: 5,
 *     position: { x: 100, y: 200 },
 *     onPick: (result) => console.log('Picked:', result.value),
 *     onCancel: () => console.log('Cancelled')
 *   });
 * 
 *   // Choice picker (for selection from list)
 *   const instance = this.pickerFactory.createChoicePicker({
 *     values: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
 *     selected: 'a',
 *     position: { x: 100, y: 200 },
 *     onPick: (choice) => console.log('Picked:', choice.label),
 *     onCancel: () => console.log('Cancelled')
 *   });
 */

/** Style of choice picker to use */
export type ChoicePickerStyle = 'linear' | 'radial' | 'auto';

/** Base configuration for all pickers */
interface BasePickerConfig {
    position: PickerPosition;
    title?: string | null;
    lightTheme?: boolean;
    initialEvent?: PointerEvent;
    onCancel: () => void;
}

/** Configuration for numeric picker */
export interface NumericPickerConfig extends BasePickerConfig {
    min: number;
    max: number;
    threshold?: number;
    selected?: number;
    step?: number;
    onPick: (result: NumericPickerResult) => void;
}

/** Configuration for choice picker */
export interface ChoicePickerConfig extends BasePickerConfig {
    values: PickerChoice[];
    selected?: PickerValue | null;
    /** Explicit style override (bypasses user preference) */
    style?: ChoicePickerStyle;
    /** Suggested style (can be overridden by user preference) */
    suggestedStyle?: ChoicePickerStyle;
    /** Target type hint for positioning/behavior */
    targetType?: PickerTargetType;
    /** Horizontal layout for linear picker */
    horizontal?: boolean;
    /** Alignment for linear picker */
    align?: 'topleft' | 'left' | 'center' | 'top';
    onPick: (choice: PickerChoice) => void;
}

@Injectable({ providedIn: 'root' })
export class PickerFactoryService {
    private readonly appRef = inject(ApplicationRef);
    private readonly envInjector = inject(EnvironmentInjector);
    private readonly injector = inject(Injector);
    private readonly optionsService = inject(OptionsService);
    private readonly layoutService = inject(LayoutService);

    /**
     * Create a numeric picker (rotating dial) for selecting a value within a range.
     */
    createNumericPicker(config: NumericPickerConfig): NumericPickerInstance {
        const compRef = createComponent(RotatingPickerComponent, {
            environmentInjector: this.envInjector,
            elementInjector: this.injector
        });

        const instance = compRef.instance;

        // Set inputs
        compRef.setInput('min', config.min);
        compRef.setInput('max', config.max);
        compRef.setInput('threshold', config.threshold ?? null);
        compRef.setInput('selected', config.selected ?? 0);
        compRef.setInput('step', config.step ?? 1);
        compRef.setInput('position', config.position);
        compRef.setInput('title', config.title ?? null);
        compRef.setInput('lightTheme', config.lightTheme ?? false);

        if (config.initialEvent) {
            instance.initialEvent.set(config.initialEvent);
        }

        // Subscribe to events
        instance.picked.subscribe(config.onPick);
        instance.cancelled.subscribe(config.onCancel);

        // Attach to DOM
        this.attachToDOM(compRef);

        return {
            component: instance,
            setPosition: (position: PickerPosition) => compRef.setInput('position', position),
            destroy: () => this.destroyComponent(compRef)
        };
    }

    /**
     * Create a choice picker (linear or radial) for selecting from a list of options.
     */
    createChoicePicker(config: ChoicePickerConfig): ChoicePickerInstance {
        const style = this.resolveChoicePickerStyle(config);

        if (style === 'radial') {
            return this.createRadialPicker(config);
        } else {
            return this.createLinearPicker(config);
        }
    }

    /**
     * Create a linear picker explicitly.
     */
    createLinearPicker(config: ChoicePickerConfig): ChoicePickerInstance {
        const compRef = createComponent(LinearPickerComponent, {
            environmentInjector: this.envInjector,
            elementInjector: this.injector
        });

        const instance = compRef.instance;

        // Set inputs
        compRef.setInput('title', config.title ?? null);
        compRef.setInput('selected', config.selected ?? null);
        compRef.setInput('position', config.position);
        compRef.setInput('lightTheme', config.lightTheme ?? false);
        compRef.setInput('horizontal', config.horizontal ?? false);
        compRef.setInput('align', config.align ?? 'center');
        instance.values.set(config.values);

        if (config.initialEvent) {
            instance.initialEvent.set(config.initialEvent);
        }

        // Subscribe to events
        instance.picked.subscribe(config.onPick);
        instance.cancelled.subscribe(config.onCancel);

        // Attach to DOM
        this.attachToDOM(compRef);

        return {
            component: instance,
            setPosition: (position: PickerPosition) => compRef.setInput('position', position),
            destroy: () => this.destroyComponent(compRef)
        };
    }

    /**
     * Create a radial picker explicitly.
     */
    createRadialPicker(config: ChoicePickerConfig): ChoicePickerInstance {
        const compRef = createComponent(RadialPickerComponent, {
            environmentInjector: this.envInjector,
            elementInjector: this.injector
        });

        const instance = compRef.instance;

        // Set inputs
        compRef.setInput('title', config.title ?? null);
        compRef.setInput('selected', config.selected ?? null);
        compRef.setInput('position', config.position);
        compRef.setInput('lightTheme', config.lightTheme ?? false);
        instance.values.set(config.values);

        if (config.initialEvent) {
            instance.initialEvent.set(config.initialEvent);
        }

        // Subscribe to events
        instance.picked.subscribe(config.onPick);
        instance.cancelled.subscribe(config.onCancel);

        // Attach to DOM
        this.attachToDOM(compRef);

        return {
            component: instance,
            setPosition: (position: PickerPosition) => compRef.setInput('position', position),
            destroy: () => this.destroyComponent(compRef)
        };
    }

    /**
     * Resolve which choice picker style to use based on config and user preferences.
     */
    private resolveChoicePickerStyle(config: ChoicePickerConfig): 'linear' | 'radial' {
        // Explicit style always wins
        if (config.style && config.style !== 'auto') {
            return config.style;
        }

        // Check user preference
        const userPreference = this.optionsService.options().pickerStyle;
        if (userPreference !== 'default') {
            return userPreference;
        }

        // Use suggested style if provided and not 'auto'
        if (config.suggestedStyle && config.suggestedStyle !== 'auto') {
            return config.suggestedStyle;
        }

        // Default: linear for desktop, radial for touch
        return this.layoutService.isTouchInput() ? 'radial' : 'linear';
    }

    /**
     * Attach component to DOM and Angular's view tree.
     */
    private attachToDOM(compRef: ComponentRef<unknown>): void {
        document.body.appendChild(compRef.location.nativeElement);
        this.appRef.attachView(compRef.hostView);
    }

    /**
     * Clean up component from DOM and Angular's view tree.
     */
    private destroyComponent(compRef: ComponentRef<unknown>): void {
        this.appRef.detachView(compRef.hostView);
        compRef.destroy();
    }
}
