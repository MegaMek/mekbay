// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PickerChoice } from '../../components/picker/picker.interface';
import type { ToastService } from '../../services/toast.service';
import type { DialogsService } from '../../services/dialogs.service';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { CBTEncounterSnapshot } from './encounter-runtime';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { CBTUnitInstance } from './unit-instance';

export type EquipmentChoiceSurface = 'critical' | 'inventory' | 'turn-summary';

export interface EquipmentInteractionQueryContext {
    readonly choiceSurface?: EquipmentChoiceSurface;
}

export interface EquipmentInteractionCommandContext {
    readonly toastService: EquipmentInteractionNotifications;
    readonly dialogsService: EquipmentInteractionDialogsService;
    /** Force-owned navigation; it does not mutate unit runtime or history. */
    readonly configureC3Network?: () => void;
}

export type EquipmentInteractionNotifications = Pick<ToastService, 'showToast'>;

export interface EquipmentInteractionDialogsService {
    showNoticeHtml: DialogsService['showNoticeHtml'];
    /** Optional on lightweight surfaces; confirmation-required actions fail closed without it. */
    requestConfirmation?: DialogsService['requestConfirmation'];
}

export interface EquipmentInteractionChoice extends PickerChoice {
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
    readonly instanceId: string;
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
export type EquipmentInteractionKind =
    | 'apollo'
    | 'booby-trap'
    | 'bombast-laser'
    | 'c3-configuration'
    | 'c3-emergency-master'
    | 'component-mode'
    | 'coolant-pod'
    | 'ecm-mode'
    | 'equipment-power'
    | 'escalating-failure'
    | 'gauss-power'
    | 'hag-mode'
    | 'inventory-mode'
    | 'jam'
    | 'machine-gun-array'
    | 'mobile-hpg'
    | 'ppc-capacitor'
    | 'risc-laser-pulse'
    | 'shield-mode';

/** Stable registry identity; labels and arbitrary strings are not handler IDs. */
export type EquipmentInteractionHandlerId = `${string}-handler`;

/** One uniform extension point for every mutable equipment feature. */
export abstract class EquipmentInteractionHandler {
    abstract readonly id: EquipmentInteractionHandlerId;
    abstract readonly kind: EquipmentInteractionKind;
    abstract readonly scope: EquipmentInteractionScope;
    readonly flags: readonly EquipmentFlag[] = [];
    /** When non-empty, at least one of these flags must also be present. */
    readonly anyFlags: readonly EquipmentFlag[] = [];
    readonly priority: number = 0;

    abstract choices(input: EquipmentInteractionInput): readonly EquipmentInteractionChoice[];

    abstract select(
        input: EquipmentInteractionInput,
        choice: PickerChoice,
        context: EquipmentInteractionCommandContext,
    ): boolean | Promise<boolean>;
}

/** Internal owner binding. Public force DTOs expose only typed detached data. */
export interface EquipmentInteractionChoiceBinding {
    readonly kind: EquipmentInteractionKind;
    readonly componentId: ComponentId;
    readonly relatedComponentId?: ComponentId;
    readonly handler: EquipmentInteractionHandler;
    readonly choice: EquipmentInteractionChoice;
}
