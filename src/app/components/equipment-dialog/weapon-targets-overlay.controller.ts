// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { type DestroyRef, Injector, type ComponentRef } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { type ConnectedPosition, type Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import type { CBTForce, CBTForceTargetRegistryDispatchResult } from '../../models/cbt-force.model';
import { isCBTMekForceMember, type CBTForceMember } from '../../models/force-member.model';
import {
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
    mergeInventoryControlCalculatorState,
    splitInventoryControlCalculatorState,
    type InventoryControlRuntimeTarget,
    type InventoryControlUnitTargetPatch,
} from '../../models/inventory-control-runtime-state.model';
import type {
    AttackerLocalCalculatorInputs,
    AttackerLocalTargetState,
} from '../../models/runtime/attacker-targeting-state';
import {
    CORE_2026_GAME_RULES,
    TW_GAME_RULES,
    type CBTGameRules,
} from '../../models/rules/game-rules';
import {
    calculateTargetTnModifier,
    normalizeTargetCustomModifier,
} from '../../models/target-number-calculator.model';
import {
    asEncounterTargetId,
    createEncounterTargetId,
    reclaimableTargetRegistryOpfor,
    type EncounterTarget,
    type TargetRegistryTargetPatch,
} from '../../models/runtime/encounter-runtime';
import type { OverlayManagerService } from '../../services/overlay-manager.service';
import { LoggerService } from '../../services/logger.service';
import { ToastService } from '../../services/toast.service';
import {
    WeaponTargetsMenuComponent,
    type NarcCapableWeaponLayers,
    type WeaponTargetCalculatorRequest,
    type WeaponTargetUpdateRequest,
} from './weapon-targets-menu.component';
import { TnCalculatorDialogComponent, type TnCalculatorDialogData, type TnCalculatorDialogResult } from './tn-calculator-dialog.component';
import { InventoryControlOpforService } from '../../services/inventory-control-opfor.service';

const WEAPON_TARGET_OVERLAY_POSITIONS: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];
const TN_CALCULATOR_OVERLAY_POSITIONS: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
];
const TN_CALCULATOR_FULLSCREEN_QUERY = '(max-width: 600px)';

export interface WeaponTargetsOverlayControllerDeps {
    overlay: Overlay;
    overlayManager: OverlayManagerService;
    injector: Injector;
    destroyRef: DestroyRef;
}

interface WeaponTargetsOverlayOpenOptionsBase {
    overlayKey: string;
    target: HTMLElement;
    readOnly?: () => boolean;
    sensitiveAreaReferenceElement?: HTMLElement;
}

export interface WeaponTargetsOverlayOpenOptions extends WeaponTargetsOverlayOpenOptionsBase {
    readonly member: CBTForceMember;
}

export class WeaponTargetsOverlayController {
    private targetsCompRef: ComponentRef<WeaponTargetsMenuComponent> | null = null;
    private targetsSyncSubscription: Subscription | null = null;
    private tnCalculatorCompRef: ComponentRef<TnCalculatorDialogComponent> | null = null;
    private tnCalculatorTargetId: string | null = null;

    constructor(private readonly deps: WeaponTargetsOverlayControllerDeps) {}

    has(overlayKey: string): boolean {
        return this.deps.overlayManager.has(overlayKey);
    }

    close(overlayKey: string): void {
        this.closeTnCalculator(overlayKey);
        this.destroyTargetsSyncEffect();
        this.deps.overlayManager.closeManagedOverlay(overlayKey);
        this.targetsCompRef = null;
    }

    clearRef(): void {
        this.destroyTargetsSyncEffect();
        this.targetsCompRef = null;
    }

    open(options: WeaponTargetsOverlayOpenOptions): void {
        this.destroyTargetsSyncEffect();
        const portal = new ComponentPortal(WeaponTargetsMenuComponent, null, this.deps.injector);
        const { componentRef, closed } = this.deps.overlayManager.createManagedOverlay(options.overlayKey, options.target, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-targets-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: options.sensitiveAreaReferenceElement,
            scrollStrategy: this.deps.overlay.scrollStrategies.reposition(),
            positions: WEAPON_TARGET_OVERLAY_POSITIONS
        });
        this.targetsCompRef = componentRef;
        this.syncInputs(options);
        this.targetsSyncSubscription = options.member.force.changed.subscribe(() => this.syncInputs(options));

        outputToObservable(componentRef.instance.addRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.createTarget(options);
            this.syncInputs(options);
        });
        outputToObservable(componentRef.instance.opforToggleRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(enabled => {
            this.opforService().setEnabled(this.force(options), enabled);
            this.syncInputs(options);
        });
        outputToObservable(componentRef.instance.resetRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.resetTargets(options);
            this.syncInputs(options);
        });
        outputToObservable(componentRef.instance.updateRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe((request: WeaponTargetUpdateRequest) => {
            void this.updateTarget(options, request).finally(() => this.syncInputs(options));
        });
        outputToObservable(componentRef.instance.calculatorRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(request => {
            this.openTnCalculator(options, request);
        });
        outputToObservable(componentRef.instance.deleteRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(targetId => {
            this.deleteTarget(options, targetId);
            this.syncInputs(options);
        });
        closed.pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.closeTnCalculator(options.overlayKey);
            if (this.targetsCompRef === componentRef) {
                this.destroyTargetsSyncEffect();
                this.targetsCompRef = null;
            }
        });
    }

    private syncInputs(options: WeaponTargetsOverlayOpenOptions): void {
        if (!this.targetsCompRef) return;
        const force = this.force(options);
        const c3State = this.c3State(options);
        this.targetsCompRef.setInput('targets', this.targets(options));
        this.targetsCompRef.setInput('readOnly', this.readOnly(options));
        this.targetsCompRef.setInput('unassignedMovement', this.unassignedMovement(options));
        this.targetsCompRef.setInput('showC3Distance', c3State !== 'none');
        this.targetsCompRef.setInput('gameRules', this.gameRules(options));
        const guidance = this.guidanceCapabilities(options);
        this.targetsCompRef.setInput('hasSemiGuidedMissiles', guidance.hasSemiGuidedMissiles);
        this.targetsCompRef.setInput('narcCapableWeaponLayers', guidance.narcCapableWeaponLayers);
        this.targetsCompRef.setInput('opforAvailable', this.opforService().isAvailable(force));
        this.targetsCompRef.setInput('opforEnabled', force.inventoryControlOpforEnabled());
        const c3Degraded = c3State === 'degraded';
        this.targetsCompRef.setInput('c3Degraded', c3Degraded);
        this.targetsCompRef.setInput('c3DegradationLabel', this.gameRules(options).c3DegradationLabel);
        this.targetsCompRef.changeDetectorRef.detectChanges();
        if (this.tnCalculatorCompRef) {
            this.tnCalculatorCompRef.instance.setC3Degraded(c3Degraded);
            this.tnCalculatorCompRef.changeDetectorRef.detectChanges();
        }
        this.deps.overlayManager.repositionAll();
    }

    private openTnCalculator(options: WeaponTargetsOverlayOpenOptions, request: WeaponTargetCalculatorRequest): void {
        if (this.readOnly(options)) return;
        const overlayKey = this.tnCalculatorOverlayKey(options.overlayKey);
        if (this.deps.overlayManager.has(overlayKey)) {
            const sameTarget = this.tnCalculatorTargetId === request.targetId;
            this.closeTnCalculator(options.overlayKey);
            if (sameTarget) return;
        }

        const target = this.targets(options).find(candidate => candidate.id === request.targetId);
        if (!target) return;

        const closeWithResult = (result?: TnCalculatorDialogResult | null) => {
            this.closeTnCalculator(options.overlayKey);
            if (result) {
                void this.updateTarget(options, result).finally(() => this.syncInputs(options));
            }
        };
        const portal = new ComponentPortal(TnCalculatorDialogComponent, null, Injector.create({
            providers: [
                { provide: DIALOG_DATA, useValue: {
                    target,
                    gameRules: this.gameRules(options),
                    targetStateReadOnly: target.readOnly === true,
                    showC3Distance: this.c3State(options) !== 'none',
                    c3Degraded: this.c3State(options) === 'degraded',
                    indirectFireAvailable: this.indirectFireAvailable(options),
                } satisfies TnCalculatorDialogData },
                { provide: DialogRef, useValue: { close: closeWithResult } },
            ],
            parent: this.deps.injector,
        }));

        this.deps.overlayManager.blockCloseUntil(options.overlayKey);
        const fullscreen = this.tnCalculatorFullscreen();
        const overlayOrigin = fullscreen ? null : request.origin;
        const { componentRef, closed } = this.deps.overlayManager.createManagedOverlay(overlayKey, overlayOrigin, portal, {
            hasBackdrop: fullscreen,
            backdropClass: fullscreen ? 'cdk-overlay-dark-backdrop' : undefined,
            panelClass: 'tn-calculator-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.deps.overlay.scrollStrategies.reposition(),
            positions: TN_CALCULATOR_OVERLAY_POSITIONS
        });
        this.tnCalculatorCompRef = componentRef;
        this.tnCalculatorTargetId = request.targetId;
        closed.pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.tnCalculatorTargetId = null;
            this.deps.overlayManager.unblockClose(options.overlayKey);
        });
    }

    private closeTnCalculator(parentOverlayKey: string): void {
        this.deps.overlayManager.closeManagedOverlay(this.tnCalculatorOverlayKey(parentOverlayKey));
        this.tnCalculatorCompRef = null;
        this.tnCalculatorTargetId = null;
        this.deps.overlayManager.unblockClose(parentOverlayKey);
    }

    private tnCalculatorOverlayKey(parentOverlayKey: string): string {
        return `${parentOverlayKey}:tn-calculator`;
    }

    private tnCalculatorFullscreen(): boolean {
        return typeof window !== 'undefined' && window.matchMedia(TN_CALCULATOR_FULLSCREEN_QUERY).matches;
    }

    private createTarget(options: WeaponTargetsOverlayOpenOptions): void {
        if (this.readOnly(options)) return;
        const force = this.force(options);
        const snapshot = force.queryInventoryControlTargetRegistry();
        const usedLetters = new Set(snapshot.targets.map(target => target.letter));
        let target: EncounterTarget | null = null;
        for (let index = 0; index < INVENTORY_CONTROL_TARGET_MAX_COUNT; index += 1) {
            const letter = String.fromCharCode('A'.charCodeAt(0) + index);
            if (usedLetters.has(letter)) continue;
            target = {
                id: createEncounterTargetId(),
                letter,
                name: `Target ${letter}`,
                color: INVENTORY_CONTROL_TARGET_COLORS[index % INVENTORY_CONTROL_TARGET_COLORS.length],
                source: 'manual',
            };
            break;
        }
        if (!target && snapshot.targets.length >= INVENTORY_CONTROL_TARGET_MAX_COUNT) {
            const reclaimable = reclaimableTargetRegistryOpfor(snapshot.targets);
            if (reclaimable) {
                target = {
                    id: createEncounterTargetId(),
                    letter: reclaimable.letter,
                    name: `Target ${reclaimable.letter}`,
                    color: reclaimable.color,
                    source: 'manual',
                };
            }
        }
        if (!target) {
            const message = 'Could not add target: the target registry is full.';
            this.deps.injector.get(LoggerService).error(message);
            this.deps.injector.get(ToastService).showToast(message, 'error');
            return;
        }
        this.handleTargetRegistryResult(force.dispatchInventoryControlTargetRegistry({
            kind: 'create-target',
            target,
        }, 'user'), 'add target');
    }

    private async updateTarget(options: WeaponTargetsOverlayOpenOptions, request: WeaponTargetUpdateRequest): Promise<void> {
        if (this.readOnly(options)) return;
        const force = this.force(options);
        const snapshot = force.queryInventoryControlTargetRegistry();
        const existing = snapshot.targets.find(target => target.id === request.targetId);
        const calculator = splitInventoryControlCalculatorState(request.patch.tnCalculator);
        const sharedPatch: {
            name?: TargetRegistryTargetPatch['name'];
            color?: TargetRegistryTargetPatch['color'];
            unitType?: TargetRegistryTargetPatch['unitType'];
            tnCalculator?: TargetRegistryTargetPatch['tnCalculator'];
        } = {};
        if (request.patch.name !== undefined && request.patch.name !== existing?.name) {
            sharedPatch.name = request.patch.name;
        }
        if (request.patch.color !== undefined && request.patch.color !== existing?.color) {
            sharedPatch.color = request.patch.color;
        }
        if (request.patch.unitType !== undefined && request.patch.unitType !== existing?.unitType) {
            sharedPatch.unitType = request.patch.unitType;
        }
        if (calculator.shared) {
            const nextCalculator = { ...existing?.tnCalculator, ...calculator.shared };
            if (!shallowRecordsEqual(existing?.tnCalculator, nextCalculator)) {
                sharedPatch.tnCalculator = nextCalculator;
            }
        }

        // OPFOR/linked target identity and calculator facts are force-owned and
        // read-only, while presentation color remains editable. Distance, C3
        // use and attacker-relative TN inputs are independent unit-local state.
        // The calculator returns a complete form, so filter its forbidden shared
        // defaults instead of letting READ_ONLY_TARGET abort the local delta.
        const registryPatch = existing?.readOnly === true
            ? (sharedPatch.color === undefined ? {} : { color: sharedPatch.color })
            : sharedPatch;
        if (Object.keys(registryPatch).length > 0) {
            const accepted = this.handleTargetRegistryResult(force.dispatchInventoryControlTargetRegistry({
                kind: 'update-target',
                targetId: asEncounterTargetId(request.targetId),
                patch: registryPatch,
            }, 'user'), 'update target');
            if (!accepted && existing?.readOnly !== true) return;
        }

        const localPatch: InventoryControlUnitTargetPatch = {
            ...(request.patch.distance !== undefined && { distance: request.patch.distance }),
            ...(request.patch.c3Distance !== undefined && { c3Distance: request.patch.c3Distance }),
            ...(request.patch.useC3 !== undefined && { useC3: request.patch.useC3 }),
            ...(request.patch.tnModifier !== undefined && { tnModifier: request.patch.tnModifier }),
            ...(calculator.local && { tnCalculator: calculator.local }),
        };
        if (Object.keys(localPatch).length === 0) return;
        await this.updateAttackerTarget(options.member, request, localPatch);
    }

    private deleteTarget(options: WeaponTargetsOverlayOpenOptions, targetId: string): void {
        if (this.readOnly(options)) return;
        const force = this.force(options);
        this.handleTargetRegistryResult(force.dispatchInventoryControlTargetRegistry({
            kind: 'delete-target',
            targetId: asEncounterTargetId(targetId),
        }, 'user'), 'delete target');
    }

    private resetTargets(options: WeaponTargetsOverlayOpenOptions): void {
        if (this.readOnly(options)) return;
        const force = this.force(options);
        const accepted = this.handleTargetRegistryResult(force.dispatchInventoryControlTargetRegistry({
            kind: 'reset-targets',
        }, 'registry-reset'), 'reset targets');
        if (accepted) force.inventoryControlOpforEnabled.set(false);
    }

    private handleTargetRegistryResult(result: CBTForceTargetRegistryDispatchResult, action: string): boolean {
        if (result.accepted) return true;
        const message = `Could not ${action}: the target is read-only.`;
        this.deps.injector.get(LoggerService).error(message);
        this.deps.injector.get(ToastService).showToast(message, 'error');
        return false;
    }

    private force(options: WeaponTargetsOverlayOpenOptions): CBTForce {
        return options.member.force;
    }

    private targets(options: WeaponTargetsOverlayOpenOptions): InventoryControlRuntimeTarget[] {
        const registry = options.member.force.queryInventoryControlTargetRegistry();
        const targeting = options.member.force.getAttackerTargeting(options.member.id);
        if (!targeting) return [];
        const rules = this.gameRules(options);
        return registry.targets.map(target => {
            const local = targeting.state.targets.get(target.id);
            const distance = local?.distance ?? 1;
            const calculator = mergeInventoryControlCalculatorState(
                target.tnCalculator,
                local?.calculator,
            );
            return {
                id: target.id,
                letter: target.letter,
                name: target.name,
                color: target.color,
                ...(target.source === undefined ? {} : { source: target.source }),
                ...(target.readOnly === undefined ? {} : { readOnly: target.readOnly }),
                ...(target.unitType === undefined ? {} : { unitType: target.unitType }),
                distance,
                ...(local?.c3Distance === undefined ? {} : { c3Distance: local.c3Distance }),
                ...(local?.useC3 === true ? { useC3: true } : {}),
                tnModifier: local?.manualTnOverride?.modifier ?? calculateTargetTnModifier({
                    ...calculator,
                    unitType: target.unitType,
                    range: distance,
                }, rules),
                ...(calculator === undefined ? {} : { tnCalculator: calculator }),
                ...(local?.manualTnOverride === undefined
                    ? {}
                    : { manualTnModifier: local.manualTnOverride.modifier }),
            };
        });
    }

    private indirectFireAvailable(options: WeaponTargetsOverlayOpenOptions): boolean {
        return options.member.force.getEquipmentPanelSnapshot(options.member.id)
            ?.components.some(row => row.equipment?.hasWeaponTrait('indirect-fire') === true) === true;
    }

    private guidanceCapabilities(options: WeaponTargetsOverlayOpenOptions): {
        hasSemiGuidedMissiles: boolean;
        narcCapableWeaponLayers: NarcCapableWeaponLayers;
    } {
        let hasSemiGuidedMissiles = false;
        const narcCapableWeaponLayers = { aboveWater: false, underwater: false };
        const panel = options.member.force.getEquipmentPanelSnapshot(options.member.id);
        for (const row of panel?.components ?? []) {
            if (row.status !== 'available' || row.weapon?.selectable !== true) continue;
            for (const source of row.weapon.ammoSources) {
                if (source.status !== 'available' || source.remaining <= 0) continue;
                for (const loadout of source.loadouts) {
                    if (loadout.equipment.hasMunitionType('M_SEMIGUIDED')) {
                        hasSemiGuidedMissiles = true;
                    }
                    if (loadout.equipment.hasMunitionType('M_NARC_CAPABLE')) {
                        if (row.weapon.underwater) narcCapableWeaponLayers.underwater = true;
                        else narcCapableWeaponLayers.aboveWater = true;
                    }
                }
            }
        }
        return { hasSemiGuidedMissiles, narcCapableWeaponLayers };
    }

    private gameRules(options: WeaponTargetsOverlayOpenOptions): CBTGameRules {
        const snapshot = options.member.force.getUnitSnapshot(options.member.id);
        switch (snapshot?.ruleset) {
            case 'total-warfare': return TW_GAME_RULES;
            case 'core-2026': return CORE_2026_GAME_RULES;
            default: throw new Error('Classic unit is missing its exact CBT ruleset');
        }
    }

    private c3State(options: WeaponTargetsOverlayOpenOptions): 'none' | 'operational' | 'degraded' {
        return options.member.force.getC3State(options.member.id);
    }

    private unassignedMovement(options: WeaponTargetsOverlayOpenOptions): boolean {
        return isCBTMekForceMember(options.member)
            && options.member.force.getMekTurnPanelSnapshot(options.member.id, 'manual')
                ?.movementState.movement === null;
    }

    private async updateAttackerTarget(
        member: CBTForceMember,
        request: WeaponTargetUpdateRequest,
        patch: InventoryControlUnitTargetPatch,
    ): Promise<void> {
        const targeting = member.force.getAttackerTargeting(member.id);
        const current = targeting?.state.targets.get(asEncounterTargetId(request.targetId));
        if (!targeting) {
            this.reportTargetingRejection('update target');
            return;
        }
        const next: {
            distance?: number;
            c3Distance?: number;
            useC3?: true;
            calculator?: AttackerLocalCalculatorInputs;
            manualTnOverride?: { readonly kind: 'user-manual'; readonly modifier: number };
        } = { ...current };
        if (patch.distance !== undefined) next.distance = patch.distance;
        if (patch.c3Distance !== undefined) next.c3Distance = patch.c3Distance;
        if (patch.useC3 !== undefined) {
            if (patch.useC3) next.useC3 = true;
            else delete next.useC3;
        }
        if (request.patch.tnCalculator !== undefined) {
            const localCalculator = splitInventoryControlCalculatorState(request.patch.tnCalculator).local;
            const canonical = canonicalCalculator(localCalculator);
            if (canonical) next.calculator = canonical;
            else delete next.calculator;
        }
        if (request.manualTnOverride === true && patch.tnModifier !== undefined) {
            next.manualTnOverride = { kind: 'user-manual', modifier: patch.tnModifier };
        } else if (patch.tnModifier !== undefined) {
            delete next.manualTnOverride;
        }

        const result = await member.force.dispatchAttackerTargeting(member.id, {
            type: 'edit-attacker-targeting',
            edit: {
                kind: 'set-target-facts',
                targetId: asEncounterTargetId(request.targetId),
                facts: Object.keys(next).length === 0 ? null : next,
            },
        });
        if (!result.accepted) this.reportTargetingRejection('update target');
    }

    private reportTargetingRejection(action: string): void {
        const message = `Could not ${action}: this force is read-only.`;
        this.deps.injector.get(LoggerService).error(message);
        this.deps.injector.get(ToastService).showToast(message, 'error');
    }

    private readOnly(options: WeaponTargetsOverlayOpenOptions): boolean {
        if (options.readOnly) return options.readOnly();
        return options.member.force.readOnly();
    }

    private destroyTargetsSyncEffect(): void {
        this.targetsSyncSubscription?.unsubscribe();
        this.targetsSyncSubscription = null;
    }

    private opforService(): InventoryControlOpforService {
        return this.deps.injector.get(InventoryControlOpforService);
    }
}

function canonicalCalculator(
    calculator: ReturnType<typeof splitInventoryControlCalculatorState>['local'],
): AttackerLocalCalculatorInputs | undefined {
    if (!calculator) return undefined;
    const indirectFire = calculator.indirectFire === true;
    const secondaryTarget = calculator.secondaryTarget === true;
    const customModifier = normalizeTargetCustomModifier(calculator.customModifier);
    const result: AttackerLocalCalculatorInputs = {
        ...(calculator.interveningWoods === 'light1' || calculator.interveningWoods === 'light2'
            ? { interveningWoods: calculator.interveningWoods }
            : {}),
        ...(calculator.partialCover === true ? { partialCover: true } : {}),
        ...(calculator.attackDirection === 'left'
            || calculator.attackDirection === 'rear'
            || calculator.attackDirection === 'right'
            ? { attackDirection: calculator.attackDirection }
            : {}),
        ...(indirectFire ? { indirectFire: true } : {}),
        ...(secondaryTarget
            ? { secondaryTarget: true }
            : calculator.secondaryTargetSideBack === true
                ? { secondaryTargetSideBack: true }
                : {}),
        ...(indirectFire && (calculator.spotterMoveMode === 'walk'
            || calculator.spotterMoveMode === 'run'
            || calculator.spotterMoveMode === 'jump')
            ? { spotterMoveMode: calculator.spotterMoveMode }
            : {}),
        ...(indirectFire && calculator.spotterDeclaredAttacks === true
            ? { spotterDeclaredAttacks: true }
            : {}),
        ...(customModifier === 0 ? {} : { customModifier }),
    };
    return Object.keys(result).length === 0 ? undefined : result;
}

function shallowRecordsEqual(current: object | undefined, next: object | undefined): boolean {
    if (current === next) return true;
    if (!current || !next) return false;
    const currentEntries = Object.entries(current);
    const nextRecord = next as Record<string, unknown>;
    return currentEntries.length === Object.keys(next).length
        && currentEntries.every(([key, value]) => value === nextRecord[key]);
}
