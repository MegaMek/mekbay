// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceMember } from '../../models/force-member.model';
import type { CBTEquipmentChoiceCommand } from '../../models/cbt-force.types';
import type { EquipmentInteractionKind } from '../../models/runtime/equipment-interaction';
import type {
    PickerChoiceColors,
    PickerChoiceSelectionTone,
    PickerDisplayType,
    PickerValue,
} from '../picker/picker.interface';
import type { TooltipType } from '../tooltip/tooltip.component';

export type EquipmentDialogTab = 'weapons' | 'ammo';

export interface EquipmentDialogDropdownChoice {
    readonly label: string;
    readonly value: PickerValue;
    readonly command?: CBTEquipmentChoiceCommand;
    readonly disabled?: boolean;
}

/** Detached presentation choice projected from one runtime interaction. */
export interface EquipmentDialogChoice {
    readonly command?: CBTEquipmentChoiceCommand;
    readonly interactionKind?: EquipmentInteractionKind;
    readonly label: string;
    readonly shortLabel?: string;
    readonly value: PickerValue;
    readonly disabled?: boolean;
    readonly active?: boolean;
    readonly selectionTone?: PickerChoiceSelectionTone;
    readonly colors?: Readonly<PickerChoiceColors>;
    readonly keepOpen?: boolean;
    readonly displayType?: PickerDisplayType;
    readonly choices?: readonly EquipmentDialogDropdownChoice[];
    readonly tooltipType?: TooltipType;
    readonly failureTarget?: number;
}

/** The equipment dialog has one authority: an admitted Entity + runtime member. */
export interface EquipmentDialogData {
    readonly member: CBTForceMember;
    readonly initialTab?: EquipmentDialogTab;
    readonly onMemberChange?: (member: CBTForceMember, index: number) => void;
}
