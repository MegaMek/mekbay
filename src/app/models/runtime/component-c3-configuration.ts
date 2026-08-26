// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import { ALL_C3_FLAGS } from '../c3-network.model';
import type { EquipmentFlag } from '../equipment-flags.type';
import {
    EquipmentInteractionHandler,
    type EquipmentInteractionChoice,
    type EquipmentInteractionCommandContext,
    type EquipmentInteractionInput,
    type EquipmentInteractionQueryContext,
} from './equipment-interaction';
import { equipmentForComponent } from './mek-runtime-index';

export const C3_HANDLER_ID = 'c3-handler';
export const C3_CONFIGURATION_CHOICE = 'c3-network-configuration';

/** Force-owned C3 configuration navigation exposed by C3 equipment. */
export class C3Handler extends EquipmentInteractionHandler {
    readonly id = C3_HANDLER_ID;
    readonly kind = 'c3-configuration';
    readonly scope = 'component' as const;
    override readonly priority = 10;

    override choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[] {
        const flags = equipmentForComponent(input.index, input.componentId)?.flags;
        return flags && this.applicableToComponentC3Configuration(flags)
            ? this.getComponentC3ConfigurationChoices(input.context)
            : [];
    }

    override select(
        _input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        return this.handleComponentC3ConfigurationSelection(choice, context);
    }

    applicableToComponentC3Configuration(flags: ReadonlySet<EquipmentFlag>): boolean {
        return ALL_C3_FLAGS.some(flag => flags.has(flag));
    }

    getComponentC3ConfigurationChoices(
        _context: EquipmentInteractionQueryContext,
    ): EquipmentInteractionChoice[] {
        return [{
            label: 'Configure',
            value: C3_CONFIGURATION_CHOICE,
            action: 'configure-network',
            readOnlySafe: true,
            displayType: 'button',
        }];
    }

    handleComponentC3ConfigurationSelection(
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean {
        if (choice.value !== C3_CONFIGURATION_CHOICE || !context.configureC3Network) return false;
        context.configureC3Network();
        return true;
    }
}
