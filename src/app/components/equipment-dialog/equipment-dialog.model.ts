import type { Signal } from '@angular/core';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { MountedEquipment } from '../../models/mounted-equipment.model';
import type { HandlerChoice, HandlerContext } from '../../services/equipment-interaction-registry.service';
import type { InventoryControlRules } from '../../utils/inventory-control.util';

export type EquipmentDialogTab = 'weapons' | 'ammo';

export interface EquipmentDialogRegistry {
    getChoices(entry: MountedEquipment, context: HandlerContext): HandlerChoice[];
    handleSelection(entry: MountedEquipment, choice: HandlerChoice, context: HandlerContext): boolean | Promise<boolean>;
    afterInventoryControlFire(entry: MountedEquipment, context: HandlerContext): void | Promise<void>;
    onEndTurn?(entry: MountedEquipment, context: HandlerContext): void;
    canPerformAimedShot(entry: MountedEquipment, context: HandlerContext): boolean;
    inventoryControlRules(context: HandlerContext): InventoryControlRules;
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