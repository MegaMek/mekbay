// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { Toast, ToastService } from '../../services/toast.service';
import type { DialogsService } from '../../services/dialogs.service';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { EquipmentRegistry } from '../equipment-lookup';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { CBTEncounterSnapshot } from './encounter-runtime';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { UnitInstanceId } from './runtime-state';
import type { CBTUnitInstance } from './unit-instance';

export interface EquipmentInteractionQueryContext {
    readonly equipmentCatalog: EquipmentRegistry;
    readonly choiceSurface?: 'critical' | 'inventory' | 'turn-summary';
}

export interface EquipmentInteractionCommandContext {
    readonly equipmentCatalog: EquipmentRegistry;
    readonly toastService: EquipmentInteractionToastService;
    readonly dialogsService: EquipmentInteractionDialogsService;
    /** Force-owned navigation; it does not mutate unit runtime or history. */
    readonly configureC3Network?: () => void;
}

export interface EquipmentInteractionToastService {
    showToast: ToastService['showToast'];
    toasts(): readonly Toast[];
}

export type EquipmentInteractionNotifications = Pick<EquipmentInteractionToastService, 'showToast'>;

export interface EquipmentInteractionDialogsService {
    createDialog: DialogsService['createDialog'];
    showError: DialogsService['showError'];
    showNoticeHtml: DialogsService['showNoticeHtml'];
    /** Optional on lightweight surfaces; confirmation-required actions fail closed without it. */
    requestConfirmation?: DialogsService['requestConfirmation'];
}

export interface EquipmentInteractionChoice extends PickerChoice {
    /** Internal owner. It is never persisted or exposed by the force API. */
    _handler?: EquipmentInteractionHandler;
    /** Concrete operational permission; ordinary mode choices default to `change-mode`. */
    action?: 'fire' | 'physical-attack' | 'activate' | 'change-mode' | 'provide-passive-effect' | 'configure-network';
    /** Recovery/state edit uses explicit edit permission instead of operational gating. */
    stateEdit?: 'enable' | 'disable' | 'repair' | 'apply-damage';
    /** Some feature state, such as a C3EM sequence step, is editable while its passive effect is unavailable. */
    skipActionGate?: boolean;
    /** Non-mutating navigation that remains useful on a read-only unit. */
    readOnlySafe?: boolean;
    /** Numeric avoid/failure target for one escalating-failure step. */
    failureTarget?: number;
}

export interface EquipmentInteractionOwnerContext {
    readonly instanceId: UnitInstanceId;
    readonly encounter: () => CBTEncounterSnapshot;
}

/**
 * Complete immutable input for one equipment behavior. Generic orchestration
 * knows only whether it is visiting a component or an authored source->target
 * link; the behavior owns every equipment-specific definition and decision.
 */
export interface EquipmentInteractionInput {
    readonly runtime: CBTUnitInstance;
    readonly entity: MekEntity;
    readonly index: MekRuntimeIndex;
    readonly ruleset: CBTRuleset;
    readonly owner: EquipmentInteractionOwnerContext;
    readonly componentId: ComponentId;
    /** Source component for linked behavior; `componentId` is the target. */
    readonly relatedComponentId?: ComponentId;
    readonly context: EquipmentInteractionQueryContext;
}

export type EquipmentInteractionScope = 'component' | 'link';
export type EquipmentInteractionKind = string;

/** One uniform extension point for every mutable equipment feature. */
export abstract class EquipmentInteractionHandler {
    abstract readonly id: string;
    abstract readonly kind: EquipmentInteractionKind;
    abstract readonly scope: EquipmentInteractionScope;
    readonly flags: readonly EquipmentFlag[] = [];
    readonly priority: number = 0;

    abstract choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[];

    abstract select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean | Promise<boolean>;
}

/** Internal owner binding. Public force DTOs expose only an opaque command token. */
export interface V2EquipmentInteractionChoiceBinding {
    readonly kind: EquipmentInteractionKind;
    readonly componentId: ComponentId;
    readonly relatedComponentId?: ComponentId;
    readonly actionComponentId: ComponentId;
    readonly handler: EquipmentInteractionHandler;
    readonly choice: EquipmentInteractionChoice;
}
