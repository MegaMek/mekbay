import type { Signal } from '@angular/core';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { MountedEquipment } from '../../models/force-serialization';
import type { HandlerChoice, HandlerContext } from '../../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../../utils/inventory-control.util';

export type EquipmentDialogTab = 'weapons' | 'ammo';

export interface EquipmentDialogRegistry {
    getChoices(entry: MountedEquipment, context: HandlerContext): HandlerChoice[];
    handleSelection(entry: MountedEquipment, choice: HandlerChoice, context: HandlerContext): boolean | Promise<boolean>;
    afterInventoryControlFire(entry: MountedEquipment, context: HandlerContext): void | Promise<void>;
    applyInventoryControlDisplayEffects(entry: MountedEquipment, display: InventoryControlDisplayData, options: InventoryControlDisplayEffectOptions, context: HandlerContext): InventoryControlDisplayData;
}

export interface EquipmentDialogContext extends HandlerContext {
    registry: EquipmentDialogRegistry;
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