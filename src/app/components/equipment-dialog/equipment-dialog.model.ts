// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceMember } from '../../models/force-member.model';
import type { MekEquipmentChoice } from '../../models/cbt-force.model';

export type EquipmentDialogTab = 'weapons' | 'ammo';

export interface EquipmentDialogDropdownChoice {
    readonly label: string;
    readonly value: string | number;
    readonly disabled?: boolean;
}

export interface EquipmentDialogChoiceColors {
    readonly normal?: string;
    readonly normalText?: string;
    readonly selected?: string;
    readonly selectedText?: string;
    readonly mutedSelected?: string;
    readonly mutedSelectedText?: string;
    readonly disabled?: string;
    readonly disabledText?: string;
}

/** Detached presentation choice projected from one runtime interaction. */
export interface EquipmentDialogChoice {
    readonly handlerId?: string;
    readonly interactionKind?: MekEquipmentChoice['interactionKind'];
    readonly label: string;
    readonly shortLabel?: string;
    readonly value: string | number;
    readonly disabled?: boolean;
    readonly active?: boolean;
    readonly selectionTone?: 'selected' | 'muted';
    readonly colors?: EquipmentDialogChoiceColors;
    readonly keepOpen?: boolean;
    readonly displayType?: 'button' | 'dropdown' | 'label' | 'state-button' | 'toggle';
    readonly choices?: readonly EquipmentDialogDropdownChoice[];
    readonly tooltipType?: 'info' | 'success' | 'error';
    readonly failureTarget?: number;
}

/** The equipment dialog has one authority: an admitted Entity + runtime member. */
export interface EquipmentDialogData {
    readonly member: CBTForceMember;
    readonly initialTab?: EquipmentDialogTab;
    readonly onMemberChange?: (member: CBTForceMember, index: number) => void;
}
