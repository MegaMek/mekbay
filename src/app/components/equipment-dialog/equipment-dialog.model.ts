// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Signal } from '@angular/core';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { MountedEquipment } from '../../models/mounted-equipment.model';
import type { HandlerChoice, HandlerCommandContext, HandlerQueryContext, InventoryControlFireResult } from '../../services/equipment-interaction-registry.service';
import type { InventoryControlRules } from '../../utils/inventory-control.util';

export type EquipmentDialogTab = 'weapons' | 'ammo';

export interface EquipmentDialogRegistry {
    getChoices(entry: MountedEquipment, context: HandlerQueryContext): HandlerChoice[];
    handleSelection(entry: MountedEquipment, choice: HandlerChoice, context: HandlerCommandContext): boolean | Promise<boolean>;
    afterInventoryControlFire(entry: MountedEquipment): Promise<readonly InventoryControlFireResult[]>;
    applyInventoryControlAmmoConsumption?(entry: MountedEquipment, count: number, context: HandlerQueryContext): number;
    inventoryControlRules(context: HandlerQueryContext): InventoryControlRules;
}

export interface EquipmentDialogContext {
    registry: EquipmentDialogRegistry;
    queryContext: HandlerQueryContext;
    commandContext: HandlerCommandContext;
}

export interface EquipmentDialogData {
    unit?: CBTForceUnit;
    unitList?: CBTForceUnit[] | Signal<CBTForceUnit[]>;
    unitIndex?: number;
    onUnitChange?: (unit: CBTForceUnit, unitIndex: number) => void;
    context: EquipmentDialogContext;
    readOnly?: boolean;
    initialTab?: EquipmentDialogTab;
}
