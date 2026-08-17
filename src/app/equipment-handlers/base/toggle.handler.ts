// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { MountedEquipment } from '../../models/mounted-equipment.model';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../../services/equipment-interaction-registry.service';

export type ToggleMode = 'direct' | 'transient';

/**
 * Base handler for two-state equipment.
 *
 * Transient toggles keep their current effective state until the pending
 * transition is completed in the End Phase.
 */
export abstract class ToggleHandler extends EquipmentInteractionHandler {
    protected readonly stateKey: string = 'state';
    protected readonly toggleMode: ToggleMode = 'direct';
    protected readonly enabledState: string = 'enabled';
    protected readonly enablingState: string = 'enabling';
    protected readonly disabledState: string = 'disabled';
    protected readonly disablingState: string = 'disabling';
    protected readonly defaultEnabled: boolean = false;
    protected readonly enabledLabel: string = 'Enable';
    protected readonly enablingLabel: string = 'Enabling…';
    protected readonly disabledLabel: string = 'Disable';
    protected readonly disablingLabel: string = 'Disabling…';
    protected readonly enabledToastVerb: string = 'enabled';
    protected readonly enablingToastVerb: string = 'enabling';
    protected readonly disabledToastVerb: string = 'disabled';
    protected readonly disablingToastVerb: string = 'disabling';

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const state = this.getToggleState(equipment);
        return [{
            label: this.labelFor(state),
            value: this.nextState(state),
            active: this.isEffectivelyEnabled(state),
            displayType: 'toggle',
        }];
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): boolean {
        const nextState = this.nextState(this.getToggleState(equipment));
        if (choice.value !== nextState || !equipment.setState(this.stateKey, nextState)) return true;

        equipment.owner.setInventoryEntry(equipment);
        if (this.isTransientState(nextState)) {
            equipment.owner.turnState().markEquipmentStateChanged();
        }
        context.toastService.showToast(
            `${equipment.getDisplayName()} is ${this.toastVerbFor(nextState)}`,
            'info',
        );
        return true;
    }

    override onEndTurn(equipment: MountedEquipment): void {
        if (this.toggleMode !== 'transient') return;

        const state = this.getToggleState(equipment);
        const completedState = state === this.enablingState
            ? this.enabledState
            : state === this.disablingState ? this.disabledState : null;
        if (completedState && equipment.setState(this.stateKey, completedState)) {
            equipment.owner.setInventoryEntry(equipment);
        }
    }

    protected getToggleState(equipment: MountedEquipment): string {
        const storedState = equipment.states.get(this.stateKey);
        if (storedState === this.enabledState || storedState === this.disabledState) return storedState;
        if (this.toggleMode === 'transient'
            && (storedState === this.enablingState || storedState === this.disablingState)) return storedState;
        return this.defaultEnabled ? this.enabledState : this.disabledState;
    }

    private nextState(state: string): string {
        if (this.toggleMode === 'direct') {
            return state === this.enabledState ? this.disabledState : this.enabledState;
        }
        if (state === this.enabledState) return this.disablingState;
        if (state === this.disablingState) return this.enabledState;
        if (state === this.disabledState) return this.enablingState;
        return this.disabledState;
    }

    private isEffectivelyEnabled(state: string): boolean {
        return state === this.enabledState
            || (this.toggleMode === 'transient' && state === this.disablingState);
    }

    private isTransientState(state: string): boolean {
        return this.toggleMode === 'transient'
            && (state === this.enablingState || state === this.disablingState);
    }

    private labelFor(state: string): string {
        if (state === this.enabledState) return this.enabledLabel;
        if (state === this.enablingState) return this.enablingLabel;
        if (state === this.disablingState) return this.disablingLabel;
        return this.disabledLabel;
    }

    private toastVerbFor(state: string): string {
        if (state === this.enabledState) return this.enabledToastVerb;
        if (state === this.enablingState) return this.enablingToastVerb;
        if (state === this.disablingState) return this.disablingToastVerb;
        return this.disabledToastVerb;
    }
}
