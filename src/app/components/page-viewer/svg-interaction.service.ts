import type { CrewStateControlKey } from '../../models/rules/unit-type-rules';
/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Injectable, type ElementRef, DestroyRef, signal, type WritableSignal, type Injector, effect, type EffectRef, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogsService } from '../../services/dialogs.service';
import { firstValueFrom } from 'rxjs';
import type { SkillType } from '../../models/crew-member.model';
import type { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import { OptionsService } from '../../services/options.service';
import { InputDialogComponent, type InputDialogData } from '../input-dialog/input-dialog.component';
import type { ZoomPanServiceInterface } from './zoom-pan.interface';
import { type ChoicePickerInstance, isChoicePickerInstance, type NumericPickerInstance, type NumericPickerResult, type PickerChoice, type PickerPosition, type PickerTargetType, type PickerValue } from '../picker/picker.interface';
import { ToastService } from '../../services/toast.service';
import { LayoutService } from '../../services/layout.service';
import { SetAmmoDialogComponent, type SetAmmoDialogData } from '../set-ammo-dialog/set-ammo.dialog.component';
import { DataService } from '../../services/data.service';
import { AmmoEquipment } from '../../models/equipment.model';
import { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import type { HandlerChoice } from '../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { type ChoicePickerStyle, PickerFactoryService } from '../../services/picker-factory.service';
import { canAntiMech } from '../../utils/infantry.util';
import { EquipmentDialogComponent } from '../equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogContext, EquipmentDialogData, EquipmentDialogTab } from '../equipment-dialog/equipment-dialog.model';
import { WeaponTargetChoiceMenuComponent } from '../../components/equipment-dialog/weapon-target-choice-menu.component';
import { getInventoryControlModes, getSelectedInventoryControlMode, selectInventoryControlEntry, setInventoryControlMode, syncSvgMode, type InventoryRangeKey } from '../../utils/inventory-control.util';
import type { InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import { inventoryTargetCategory, inventoryTargetNumberText, parseInventoryTargetNumberCell, readInventoryTargetDisplay, readInventoryTargetText } from '../../utils/inventory-target-number.util';
import { PageViewerStateService } from './internal/page-viewer-state.service';
import { committedCriticalHitCount, isRepeatableMotiveHitId, motiveHitLevelFromId, MOTIVE_HIT_PIP_COUNT, pendingCriticalHitTimestamps } from '../../models/rules/vehicle-motive-hit.util';
import { UnitStateDropdownComponent, type UnitStateDropdownChoice } from './unit-state-dropdown.component';

type SheetInventoryRangeKey = InventoryRangeKey | 'extreme';
type HeatMarkerData = { el: SVGElement | null, heat: number; baselineHeat: number };

interface HeatCell {
    el: SVGElement;
    value: number;
}

interface ActiveHeatDrag {
    pointerId: number;
    selectedCell: HeatCell;
    baselineHeat: number;
    startElement: SVGElement;
    cleanup: () => void;
}

const INVENTORY_RANGE_BUTTON_CLASSES: ReadonlyArray<readonly [string, SheetInventoryRangeKey]> = [
    ['shrButton', 'short'],
    ['medButton', 'medium'],
    ['lngButton', 'long'],
    ['extButton', 'extreme']
];
const VTOL_ROTOR_CRIT_ID = 'rotor';
const VTOL_ROTOR_HITS_MAX = 20;
const SVG_INVENTORY_TARGET_CHOICE_OVERLAY_KEY = 'svg-inventory-target-choice';
const SVG_CONDITIONS_DROPDOWN_OVERLAY_KEY = 'svg-conditions-dropdown';
const SVG_CREW_STATE_DROPDOWN_OVERLAY_KEY = 'svg-crew-state-dropdown';
const SVG_LOCATION_CONDITIONS_DROPDOWN_OVERLAY_KEY = 'svg-location-conditions-dropdown';
const REPEATABLE_MOTIVE_HIT_LABELS = new Map<number, string>([
    [2, 'Medium'],
    [3, 'Heavy']
]);

/*
 * Author: Drake
 */
export interface InteractionState {
    clickTarget: SVGElement | null;
    isHeatDragging: boolean;
    diffHeatMarkerVisible: WritableSignal<boolean>;
    heatMarkerData: WritableSignal<HeatMarkerData | null>;
    isPickerOpen: WritableSignal<boolean>;
}

@Injectable()
export class SvgInteractionService {
    private dataService = inject(DataService);
    private destroyRef = inject(DestroyRef);
    private overlay = inject(Overlay);
    private overlayManager = inject(OverlayManagerService);
    private optionsService = inject(OptionsService);
    private dialogsService = inject(DialogsService);
    private toastService = inject(ToastService);
    private layoutService = inject(LayoutService);
    private forceBuilderService = inject(ForceBuilderService);
    private equipmentRegistryService = inject(EquipmentInteractionRegistryService);
    private pageViewerState = inject(PageViewerStateService);
    private pickerFactory = inject(PickerFactoryService);

    // Zoom-pan service passed via initialize()
    private zoomPanService!: ZoomPanServiceInterface;

    private containerRef!: ElementRef<HTMLDivElement>;
    private unit = signal<CBTForceUnit | null>(null);
    private injector!: Injector;

    private state: InteractionState = {
        clickTarget: null,
        isHeatDragging: false,
        diffHeatMarkerVisible: signal(false),
        heatMarkerData: signal<HeatMarkerData | null>(null),
        isPickerOpen: signal(false)
    };

    private pickerRef: ChoicePickerInstance | NumericPickerInstance | null = null;
    private heatMarkerEffectRef: EffectRef | null = null;
    private interactionAbortController: AbortController | null = null;
    private activeHeatDrag: ActiveHeatDrag | null = null;

    private currentHighlightedElement: SVGElement | null = null;

    /** When automations are off, damage/heat changes consolidate immediately (no pending state). */
    private get consolidateImmediately(): boolean {
        return !this.optionsService.options().useAutomations;
    }

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.cleanup();
        });
    }

    initialize(
        containerRef: ElementRef<HTMLDivElement>,
        injector: Injector,
        zoomPanService: ZoomPanServiceInterface
    ) {
        this.cleanup();

        this.containerRef = containerRef;
        this.injector = injector;
        this.zoomPanService = zoomPanService;

        this.heatMarkerEffectRef = effect(() => {
            const currentUnit = this.unit();
            if (!currentUnit) return;

            const data = this.state.heatMarkerData();
            const isVisible = !!data;

            this.state.diffHeatMarkerVisible.set(isVisible);

            const currentHeat = currentUnit.getHeat();
            if (!isVisible) {
                this.updateHeatHighlight(currentHeat.next ?? currentHeat.current);
                return;
            }

            const elRect = data.el?.getBoundingClientRect();
            if (!elRect) {
                this.state.diffHeatMarkerVisible.set(false);
                return;
            }

            this.updateHeatHighlight(data.heat);
        }, { injector: this.injector });
    }

    /**
     * Gets the heat diff marker data for the HeatDiffMarkerComponent.
     * Returns null if no marker should be shown.
     */
    getHeatDiffMarkerData(): { el: SVGElement | null; heat: number; baselineHeat: number; containerRect: DOMRect } | null {
        const data = this.state.heatMarkerData();
        if (!data?.el) return null;

        const currentUnit = this.unit();
        if (!currentUnit) return null;

        const containerRect = this.containerRef.nativeElement.getBoundingClientRect();

        return {
            el: data.el,
            heat: data.heat,
            baselineHeat: data.baselineHeat,
            containerRect
        };
    }

    getState(): Readonly<InteractionState> {
        return {
            clickTarget: this.state.clickTarget,
            isHeatDragging: this.state.isHeatDragging,
            diffHeatMarkerVisible: this.state.diffHeatMarkerVisible,
            heatMarkerData: this.state.heatMarkerData,
            isPickerOpen: this.state.isPickerOpen
        };
    }

    updateUnit(unit: CBTForceUnit | null) {
        this.unit.set(unit);
    }

    setupInteractions(svg: SVGSVGElement) {
        if (this.interactionAbortController) {
            this.interactionAbortController.abort();
        }
        this.interactionAbortController = new AbortController();
        const signal = this.interactionAbortController.signal;
        this.setupPipInteractions(svg, signal);
        this.setupSoldierPipInteractions(svg, signal);
        this.setupArmorInteraction(svg, signal);
        this.setupVtolRotorHitsInteraction(svg, signal);
        this.setupCritSlotInteractions(svg, signal);
        this.setupHeatInteractions(svg, signal);
        this.setupCritLocInteractions(svg, signal);
        this.setupCrewHitInteractions(svg, signal);
        this.setupSkillInteractions(svg, signal);
        this.setupCrewNameInteractions(svg, signal);
        this.setupCrewStateInteractions(svg, signal);
        this.setupConditionsInteractions(svg, signal);
        this.setupLocationConditionInteractions(svg, signal);
        this.setupInventoryInteractions(svg, signal);
        this.setupAmmoProfileInteractions(svg, signal);
    }

    setupReadOnlyInteractions(svg: SVGSVGElement) {
        if (this.interactionAbortController) {
            this.interactionAbortController.abort();
        }
        this.interactionAbortController = new AbortController();
        const signal = this.interactionAbortController.signal;
        this.setupAmmoProfileInteractions(svg, signal);
    }

    private addSvgTapHandler(
        el: SVGElement,
        handler: (evt: PointerEvent, primaryAction: boolean) => void,
        signal: AbortSignal
    ) {
        let longTouchTimer: any = null;
        el.classList.add('interactive');
        const eventOptions = { passive: false, signal };
        const globalEventOptions = { passive: false, signal, capture: true };

        let pointerId: number | null = null;
        let tapStartEvent: PointerEvent | null = null;
        let globalListenersActive = false;

        const releasePointerCapture = (id: number | null) => {
            if (id === null) return;
            try {
                if (el.hasPointerCapture(id)) {
                    el.releasePointerCapture(id);
                }
            } catch { /* Ignore unsupported pointer capture */ }
        };

        el.addEventListener('pointerdown', (evt: PointerEvent) => {
            evt.preventDefault();
            this.state.clickTarget = el;
            this.zoomPanService.pointerMoved = false;
            clearLongTouch();
            pointerId = evt.pointerId;
            tapStartEvent = evt;
            try {
                el.setPointerCapture(evt.pointerId);
            } catch { /* Ignore unsupported pointer capture */ }
            addGlobalPointerListeners();
            longTouchTimer = setTimeout(() => {
                upHandlerSecondary(evt);
            }, 300);
            // Dispatch a custom event for page selection to work
            // Since we preventDefault on pointerdown, the click event won't fire naturally
            el.dispatchEvent(new CustomEvent('svg-interaction-click', { bubbles: true }));
        }, eventOptions);

        const clearLongTouch = () => {
            const activePointerId = pointerId;
            pointerId = null;
            tapStartEvent = null;
            removeGlobalPointerListeners();
            if (longTouchTimer) {
                clearTimeout(longTouchTimer);
                longTouchTimer = null;
            }
            releasePointerCapture(activePointerId);
        };

        const getAnchoredTapEvent = (evt: PointerEvent) => {
            const anchor = tapStartEvent;
            if (!anchor || (anchor.clientX === evt.clientX && anchor.clientY === evt.clientY)) {
                return evt;
            }

            return new PointerEvent(evt.type, {
                bubbles: evt.bubbles,
                cancelable: evt.cancelable,
                composed: evt.composed,
                detail: evt.detail,
                view: window,
                screenX: anchor.screenX,
                screenY: anchor.screenY,
                clientX: anchor.clientX,
                clientY: anchor.clientY,
                ctrlKey: evt.ctrlKey,
                shiftKey: evt.shiftKey,
                altKey: evt.altKey,
                metaKey: evt.metaKey,
                button: evt.button,
                buttons: evt.buttons,
                relatedTarget: evt.relatedTarget,
                pointerId: evt.pointerId,
                width: evt.width,
                height: evt.height,
                pressure: evt.pressure,
                tangentialPressure: evt.tangentialPressure,
                tiltX: evt.tiltX,
                tiltY: evt.tiltY,
                twist: evt.twist,
                pointerType: evt.pointerType,
                isPrimary: evt.isPrimary
            });
        };

        const upHandlerSecondary = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            const tapEvent = getAnchoredTapEvent(evt);
            clearLongTouch();
            evt.stopPropagation();
            evt.preventDefault();
            if (this.state.clickTarget && !this.zoomPanService.pointerMoved) {
                handler(tapEvent, false);
            }
            this.state.clickTarget = null;
        };

        const upHandler = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            const tapEvent = getAnchoredTapEvent(evt);
            clearLongTouch();
            evt.preventDefault();
            if (this.state.clickTarget && !this.zoomPanService.pointerMoved) {
                let isLeftClick = true;
                isLeftClick = evt.button === 0;
                handler(tapEvent, isLeftClick);
            }
            this.state.clickTarget = null;
        };

        const cancelHandler = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            clearLongTouch();
            evt.preventDefault();
            this.state.clickTarget = null;
        };

        const addGlobalPointerListeners = () => {
            if (globalListenersActive) return;
            globalListenersActive = true;
            window.addEventListener('pointerup', upHandler, globalEventOptions);
            window.addEventListener('pointercancel', cancelHandler, globalEventOptions);
        };

        const removeGlobalPointerListeners = () => {
            if (!globalListenersActive) return;
            globalListenersActive = false;
            window.removeEventListener('pointerup', upHandler, globalEventOptions);
            window.removeEventListener('pointercancel', cancelHandler, globalEventOptions);
        };

        const leaveHandler = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            try {
                if (el.hasPointerCapture(evt.pointerId)) return;
            } catch { /* Ignore unsupported pointer capture */ }
            if (evt.pointerType === 'pen' || evt.pointerType === 'touch') return;
            cancelHandler(evt);
        };

        el.addEventListener('pointerleave', leaveHandler, eventOptions);
        el.addEventListener('pointercancel', cancelHandler, eventOptions);
        el.addEventListener('pointerup', upHandler, eventOptions);
        signal.addEventListener('abort', () => {
            clearLongTouch();
        }, { once: true });
    }

    private setupPipInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        // If we have location zones, we handle it with those ones
        if (svg.querySelector('.unitLocation')) {
            svg.querySelectorAll('.pip').forEach(el => {
                if (el.classList.contains('shield')) return; // Shields are handled separately, TODO: update the sheets to use areas
                (el as SVGElement).style.pointerEvents = 'none';
            });
        }
    }

    private setupSoldierPipInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const hasTroops = svg.getElementById('soldier_1');
        if (!hasTroops) return;

        const totalTroops = this.unit()?.getInternalPoints('TROOP') || 0;
        const getHits = () => {
            return this.unit()?.getInternalHits('TROOP') || 0;
        }

        const toastId = `${this.unit()?.id}-troopHit`;
        let lastAmountVariationTimestamp = 0;
        let amount = 0;
        const showToast = (variation: number) => {
            const timeDiff = Date.now() - lastAmountVariationTimestamp;
            if (timeDiff > 3000) {
                amount = 0;
            }
            amount += variation;
            lastAmountVariationTimestamp = Date.now();
            const remaining = totalTroops - getHits();
            const amountText = amount > 0 ? `+${amount}` : amount.toString();
            this.toastService.showToast(`${amountText} hits (${remaining}/${totalTroops})`, amount > 0 ? 'error' : 'success', toastId);
        };
        svg.querySelectorAll('.soldierPip').forEach(el => {
            const svgEl = el as SVGElement;

            this.addSvgTapHandler(svgEl, (evt: Event, primaryAction: boolean) => {
                if (this.state.clickTarget !== svgEl) return;
                const soldierId = svgEl.getAttribute('soldier-id') as number | null;
                if (!soldierId) return;
                const newHealth = totalTroops - (soldierId - 1);
                const deltaChange = newHealth - getHits();
                if (deltaChange < 0) {
                    this.unit()?.addInternalHits('TROOP', deltaChange - 1, this.consolidateImmediately);
                    showToast(deltaChange - 1);
                } else if (deltaChange > 0) {
                    this.unit()?.addInternalHits('TROOP', deltaChange, this.consolidateImmediately);
                    showToast(deltaChange);
                } else {
                    this.unit()?.addInternalHits('TROOP', -1, this.consolidateImmediately);
                    showToast(-1);
                }
            }, signal);
        });
    }

    private setupArmorInteraction(svg: SVGSVGElement, signal: AbortSignal) {
        let locationZones = svg.querySelectorAll('.unitLocation');
        if (locationZones.length === 0) {
            // Fall back to pip hit areas (larger touch targets) or pips themselves
            locationZones = svg.querySelectorAll('.pip-hit-area.armor, .pip-hit-area.structure');
            if (locationZones.length === 0) {
                locationZones = svg.querySelectorAll('.pip.armor, .pip.structure');
            }
        }
        locationZones.forEach(el => {
            const svgEl = el as SVGElement;
            const id = svgEl.getAttribute('id');
            const loc = svgEl.getAttribute('loc');
            if (!loc) return;
            svgEl.classList.add('selectable');
            const isStructure = !!svgEl.classList.contains('structure');
            const isShield = !!svgEl.classList.contains('shield');
            const rear = !!svgEl.getAttribute('rear');
            let consumedModularArmorPoints = 0;
            let availableModularArmorPoints = 0;
            let pipsCount = isStructure ? this.unit()?.getInternalPoints(loc) : this.unit()?.getArmorPoints(loc, rear);
            if (!pipsCount) {
                pipsCount = 0;
            }

            const getHits = () => {
                if (isStructure) {
                    return this.unit()?.getInternalHits(loc) || 0;
                } else {
                    return (this.unit()?.getArmorHits(loc, rear) || 0);
                }
            }

            const armorToastId = `${this.unit()?.id}-${isStructure ? 'structure' : 'armor'}-${loc}-${rear ? 'rear' : ''}`;
            let lastAmountVariationTimestamp = 0;
            let amount = 0;
            const showArmorToast = (variation: number) => {
                const timeDiff = Date.now() - lastAmountVariationTimestamp;
                if (timeDiff > 3000) {
                    amount = 0;
                }
                amount += variation;
                lastAmountVariationTimestamp = Date.now();
                const remaining = (pipsCount ?? 0) - getHits() + availableModularArmorPoints;
                const amountText = amount > 0 ? `+${amount}` : amount.toString();
                const totalPips = pipsCount + availableModularArmorPoints + consumedModularArmorPoints;
                const location = isStructure ? 'internal' : isShield ? 'shield' : 'armor';
                this.toastService.showToast(`${amountText} ${rear ? ' rear' : ''} ${location} hits in ${loc} (${remaining}/${totalPips})`, amount > 0 ? 'error' : 'success', armorToastId);
            };

            const createAndShowPicker = (event: PointerEvent) => {
                const x = event.clientX;
                const y = event.clientY;

                if (!isStructure && !isShield) {
                    // We recalculate modular armor status, in case we added/removed some crits (destroyed or repaired)
                    consumedModularArmorPoints = 0;
                    availableModularArmorPoints = 0;
                    this.unit()?.getCritSlotsAsMatrix()[loc]?.forEach(critSlot => {
                        if (!critSlot.eq?.flags?.has('F_MODULAR_ARMOR')) return;
                        if (critSlot.destroyed) return;
                        consumedModularArmorPoints += critSlot.consumed || 0;
                        availableModularArmorPoints += 10 - consumedModularArmorPoints;
                    });
                }

                const allowedValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, -1, -2, -3, -4, -5, -10, -20];
                const calculateValues = () => {
                    let values: PickerChoice[] = [];
                    const startValue = - getHits() - consumedModularArmorPoints;
                    const endValue = pipsCount - getHits() + availableModularArmorPoints;
                    for (const value of allowedValues) {
                        if (value >= startValue && value <= endValue) {
                            values.push({ label: value.toString(), value: value });
                        }
                    }
                    // Add intermediate values, starting from 50, 100, 200, 350, 500 and their negative counterparts
                    const intermediateValues = [50, 100, 200, 350, 500];
                    for (const value of intermediateValues) {
                        if (value >= startValue && value <= endValue) {
                            values.push({ label: value.toString(), value: value });
                        }
                        if (-value >= startValue && -value <= endValue) {
                            values.push({ label: (-value).toString(), value: -value });
                        }
                    }

                    // Add startValue if it's not already included
                    if (!values.some(v => v.value === startValue)) {
                        values.push({ label: startValue.toString(), value: startValue });
                    }

                    // Add endValue if it's not already included
                    if (!values.some(v => v.value === endValue)) {
                        values.push({ label: endValue.toString(), value: endValue });
                    }
                    values.sort((a, b) => (a.value as number) - (b.value as number));

                    return values;
                };
                const title = `${loc}${rear ? ' (Rear)' : ''}`;
                const position = { x, y };
                const startValue = - getHits() - consumedModularArmorPoints;
                const endValue = pipsCount - getHits() + availableModularArmorPoints;

                const applyArmorChange = (value: number) => {
                    this.removePicker();
                    const unit = this.unit();
                    if (!unit) return;
                    if (isStructure) {
                        unit.addInternalHits(loc, value, this.consolidateImmediately);
                    } else {
                        let valueToApply = value;
                                // We remove/add first from/to the modular armor, if any
                                if (availableModularArmorPoints > 0 && valueToApply > 0) {
                                    unit.getCritSlotsAsMatrix()[loc]?.forEach(critSlot => {
                                        if (valueToApply == 0) return;
                                        if (!critSlot.eq?.flags?.has('F_MODULAR_ARMOR')) return;
                                        if (critSlot.destroyed) return;
                                        const canApply = Math.min(valueToApply, 10 - (critSlot.consumed || 0));
                                        critSlot.consumed = (critSlot.consumed || 0) + canApply;
                                        valueToApply -= canApply;
                                        availableModularArmorPoints -= canApply;
                                        consumedModularArmorPoints += canApply;
                                        unit.setCritSlot(critSlot);
                                    });
                                } else if (consumedModularArmorPoints > 0 && valueToApply < 0) {
                                    unit.getCritSlotsAsMatrix()[loc]?.forEach(critSlot => {
                                        const armorPointsToRepair = Math.min(-valueToApply, unit.getArmorHits(loc, rear));
                                        unit.addArmorHits(loc, -armorPointsToRepair, rear, this.consolidateImmediately);
                                        valueToApply += armorPointsToRepair;
                                        if (valueToApply == 0) return;
                                        if (!critSlot.eq?.flags?.has('F_MODULAR_ARMOR')) return;
                                        if (critSlot.destroyed) return;
                                        const canApply = Math.min(-valueToApply, critSlot.consumed || 0);
                                        critSlot.consumed = (critSlot.consumed || 0) - canApply;
                                        valueToApply += canApply;
                                        availableModularArmorPoints += canApply;
                                        consumedModularArmorPoints -= canApply;
                                        this.unit()?.setCritSlot(critSlot);
                                    });
                                }
                        if (valueToApply != 0) {
                            this.unit()?.addArmorHits(loc, valueToApply, rear, this.consolidateImmediately);
                        }
                    }
                    if (loc === 'RO' && value !== 0) {
                        this.applyVtolRotorHitDelta(unit, value > 0 ? 1 : -1, svg.getElementById('rotor_hits_group') as SVGElement | null);
                    }
                    showArmorToast(value);
                };

                // Use numeric picker for continuous range
                const pickerStylePref = this.getUserPickerPreference();
                if (pickerStylePref === 'radial' || pickerStylePref === 'default') {
                    this.showNumericPicker({
                        event,
                        el: svgEl,
                        position,
                        title,
                        min: startValue,
                        max: endValue,
                        selected: 0,
                        onPick: (result) => applyArmorChange(result.value),
                        onCancel: () => this.removePicker()
                    });
                } else {
                    // Use choice picker with discrete values for linear style (screen space limitation)
                    this.showChoicePicker({
                        event,
                        el: svgEl,
                        position,
                        title,
                        values: calculateValues(),
                        selected: 0,
                        suggestedStyle: 'linear',
                        targetType: 'armor',
                        onPick: (val) => applyArmorChange(val.value as number),
                        onCancel: () => this.removePicker()
                    });
                }
            }

            this.addSvgTapHandler(svgEl, (event: PointerEvent, primaryAction: boolean) => {
                createAndShowPicker(event);
            }, signal);
        });
    }

    private setupCritLocInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        svg.querySelectorAll('.critLoc').forEach(el => {
            const svgEl = el as SVGElement;
            if (this.critLocId(svgEl) === VTOL_ROTOR_CRIT_ID) return;
            this.addSvgTapHandler(svgEl, (evt: Event, primaryAction: boolean) => {
                if (this.state.clickTarget !== svgEl) return;
                const id = this.critLocId(svgEl);
                if (!id) return;
                if (isRepeatableMotiveHitId(id)) {
                    this.showMotiveHitPicker(evt, svgEl, id);
                    return;
                }
                if (this.applySensorHitInteraction(id)) return;
                let critLoc = this.unit()?.getCritLoc(id);
                if (!critLoc) return;
                critLoc.destroying = !!critLoc.destroying ? undefined : Date.now();
                this.unit()?.setCritLoc(critLoc);
            }, signal);
        });
    }

    private setupVtolRotorHitsInteraction(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit || unit.getUnit().type !== 'VTOL') return;

        const rotorEl = svg.getElementById('rotor_hits_group') as SVGElement | null;
        if (!rotorEl) return;

        this.addSvgTapHandler(rotorEl, (event: PointerEvent) => {
            if (this.state.clickTarget !== rotorEl) return;

            const rotorCrit = unit.getCritLoc(VTOL_ROTOR_CRIT_ID);
            const currentHits = Math.max(0, (rotorCrit?.hits ?? 0) + (rotorCrit?.pendingHits ?? 0));
            this.showHitDeltaPicker(event, rotorEl, 'Rotor Hits', currentHits, VTOL_ROTOR_HITS_MAX - currentHits, (delta) => {
                this.applyVtolRotorHitDelta(unit, delta, rotorEl);
            });
        }, signal);
    }

    private applyVtolRotorHitDelta(unit: CBTForceUnit, delta: number, rotorEl?: SVGElement | null): void {
        if (delta === 0 || unit.getUnit().type !== 'VTOL') return;

        const critLoc = unit.getCritLoc(VTOL_ROTOR_CRIT_ID) ?? { id: VTOL_ROTOR_CRIT_ID, name: VTOL_ROTOR_CRIT_ID };
        const committedHits = Math.max(0, critLoc.hits ?? 0);
        const pendingHits = critLoc.pendingHits ?? 0;
        const totalHits = Math.max(0, Math.min(VTOL_ROTOR_HITS_MAX, committedHits + pendingHits + delta));
        critLoc.id = VTOL_ROTOR_CRIT_ID;
        critLoc.el = rotorEl ?? critLoc.el;
        if (this.consolidateImmediately) {
            critLoc.hits = totalHits;
            critLoc.pendingHits = undefined;
        } else {
            const nextPendingHits = totalHits - committedHits;
            critLoc.pendingHits = nextPendingHits === 0 ? undefined : nextPendingHits;
        }
        critLoc.destroying = undefined;
        critLoc.destroyed = undefined;
        unit.setCritLoc(critLoc);
    }

    private showMotiveHitPicker(event: Event, motiveEl: SVGElement, id: string): void {
        const unit = this.unit();
        if (!unit) return;

        const critLoc = unit.getCritLoc(id) ?? { id, name: id, el: motiveEl };
        const currentHits = Math.max(0, committedCriticalHitCount(critLoc) + (critLoc.pendingHits ?? 0));
        const motiveHitLevel = motiveHitLevelFromId(id);
        const motiveHitLabel = motiveHitLevel === null ? null : REPEATABLE_MOTIVE_HIT_LABELS.get(motiveHitLevel);
        const title = motiveHitLabel ? `Motive Hits (${motiveHitLabel})` : 'Motive Hits';
        this.showHitDeltaPicker(event, motiveEl, title, currentHits, MOTIVE_HIT_PIP_COUNT, (delta) => {
            this.applyMotiveHitDelta(unit, id, delta, motiveEl);
        });
    }

    private showHitDeltaPicker(
        event: Event,
        el: SVGElement,
        title: string,
        currentHits: number,
        maxDelta: number,
        onPick: (delta: number) => void
    ): void {
        const startValue = -currentHits;
        const endValue = maxDelta;
        const selectedValue = endValue >= 1 ? 1 : 0;
        const applyHitDelta = (delta: number) => {
            this.removePicker();
            onPick(delta);
        };
        const position = event instanceof PointerEvent ? { x: event.clientX, y: event.clientY } : undefined;
        const pickerStylePref = this.getUserPickerPreference();
        if (pickerStylePref === 'radial' || pickerStylePref === 'default') {
            this.showNumericPicker({
                event,
                el,
                position,
                title,
                min: startValue,
                max: endValue,
                selected: selectedValue,
                onPick: (result) => applyHitDelta(result.value),
                onCancel: () => this.removePicker()
            });
        } else {
            this.showChoicePicker({
                event,
                el,
                position,
                title,
                values: this.hitDeltaChoices(startValue, endValue),
                selected: selectedValue,
                suggestedStyle: 'linear',
                targetType: 'motive',
                onPick: (val) => applyHitDelta(val.value as number),
                onCancel: () => this.removePicker()
            });
        }
    }

    private applyMotiveHitDelta(unit: CBTForceUnit, id: string, delta: number, motiveEl?: SVGElement | null): void {
        if (delta === 0) return;

        const critLoc = unit.getCritLoc(id) ?? { id, name: id };
        const committedHits = committedCriticalHitCount(critLoc);
        const currentHits = Math.max(0, committedHits + (critLoc.pendingHits ?? 0));
        const totalHits = Math.max(0, currentHits + delta);
        const pendingHits = totalHits - committedHits;
        critLoc.id = id;
        critLoc.name = critLoc.name ?? id;
        critLoc.el = motiveEl ?? critLoc.el;

        if (this.consolidateImmediately) {
            critLoc.hits = totalHits;
            critLoc.hitTimestamps = this.updatedImmediateMotiveHitTimestamps(critLoc, totalHits, delta);
            critLoc.pendingHits = undefined;
            critLoc.pendingHitTimestamps = undefined;
        } else {
            critLoc.pendingHits = pendingHits === 0 ? undefined : pendingHits;
            critLoc.pendingHitTimestamps = pendingHits > 0
                ? this.updatedPendingMotiveHitTimestamps(critLoc, pendingHits)
                : undefined;
        }
        critLoc.destroying = undefined;
        critLoc.destroyed = undefined;
        unit.setCritLoc(critLoc);
    }

    private updatedImmediateMotiveHitTimestamps(critLoc: CriticalSlot, totalHits: number, delta: number): number[] | undefined {
        const committed = this.currentMotiveHitTimestamps(critLoc);
        const timestamps = delta > 0
            ? [...committed, ...this.newTimestamps(delta)]
            : committed.slice(0, totalHits);
        return timestamps.length > 0 ? timestamps.slice(0, totalHits) : undefined;
    }

    private currentMotiveHitTimestamps(critLoc: CriticalSlot): number[] {
        const committed = (critLoc.hitTimestamps ?? [])
            .filter(timestamp => Number.isFinite(timestamp))
            .sort((a, b) => a - b);
        const pendingHits = critLoc.pendingHits ?? 0;
        if (pendingHits > 0) return [...committed, ...pendingCriticalHitTimestamps(critLoc).slice(0, pendingHits)].sort((a, b) => a - b);
        if (pendingHits < 0) return committed.slice(0, Math.max(0, committed.length + pendingHits));
        return committed;
    }

    private updatedPendingMotiveHitTimestamps(critLoc: CriticalSlot, pendingHits: number): number[] | undefined {
        const current = pendingCriticalHitTimestamps(critLoc).slice(0, pendingHits);
        const missing = pendingHits - current.length;
        const timestamps = missing > 0 ? [...current, ...this.newTimestamps(missing)] : current;
        return timestamps.length > 0 ? timestamps : undefined;
    }

    private newTimestamps(count: number): number[] {
        const timestamp = Date.now();
        return Array.from({ length: count }, (_value, index) => timestamp + index);
    }

    private hitDeltaChoices(startValue: number, endValue: number): PickerChoice[] {
        const allowedValues = [0, 1, 2, 3, 4, 5, 10, 15, 20, -1, -2, -3, -4, -5, -10, -15, -20];
        const values = allowedValues
            .filter(value => value >= startValue && value <= endValue)
            .map(value => ({ label: value.toString(), value }));

        if (!values.some(value => value.value === startValue)) {
            values.push({ label: startValue.toString(), value: startValue });
        }
        if (!values.some(value => value.value === endValue)) {
            values.push({ label: endValue.toString(), value: endValue });
        }
        return values.sort((a, b) => a.value - b.value);
    }

    private critLocId(el: SVGElement): string | null {
        return el.getAttribute('critId') || el.getAttribute('id');
    }

    private applySensorHitInteraction(id: string): boolean {
        const unit = this.unit();
        const targetLevel = this.sensorHitLevel(id);
        if (!unit || targetLevel === null) return false;

        const sensorCrits = unit.getCritSlots()
            .map(crit => ({ crit, level: this.sensorHitLevel(crit.id || crit.name || '') }))
            .filter((entry): entry is { crit: CriticalSlot; level: number } => entry.level !== null)
            .sort((a, b) => a.level - b.level);
        if (!sensorCrits.some(entry => entry.level === targetLevel)) return false;

        const targetCrit = sensorCrits.find(entry => entry.level === targetLevel)?.crit;
        const targetActive = targetCrit?.destroying !== undefined;
        const highestActiveLevel = sensorCrits.reduce((highest, entry) => (
            entry.crit.destroying !== undefined ? Math.max(highest, entry.level) : highest
        ), 0);
        const timestamp = Date.now();

        sensorCrits.forEach(({ crit, level }) => {
            let active: boolean;
            if (highestActiveLevel > targetLevel) {
                active = level <= targetLevel;
            } else if (level === targetLevel && targetActive) {
                active = false;
            } else {
                active = level <= targetLevel;
            }
            crit.destroying = active ? (crit.destroying ?? timestamp) : undefined;
        });
        unit.setCritSlots([...unit.getCritSlots()]);
        return true;
    }

    private sensorHitLevel(id: string): number | null {
        const match = id.match(/^sensor_hit_(\d+)$/);
        return match ? parseInt(match[1], 10) : null;
    }

    private setupCritSlotInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit) return;
        const equipmentList = this.dataService.getEquipments();
        svg.querySelectorAll('.critSlot').forEach(el => {
            if (el.getAttribute('hittable') != '1') return; // Only add handlers to hittable crit slots
            const svgEl = el as SVGElement;
            const loc = svgEl.getAttribute('loc');
            const slot = parseInt(svgEl.getAttribute('slot') as string);
            const originalTotalAmmo = parseInt(svgEl.getAttribute('totalAmmo') || '0');
            let labelText = svgEl.textContent || '';
            if (svgEl.classList.contains('ammoSlot')) {
                // for ammo, we remove the number at the end, example "Ammo (SRM 2) 5" should become "Ammo (SRM 2)"
                labelText = labelText.replace(/\s\d+$/, '');
            }
            if (loc === null || slot === null) return;
            const critSlot = unit.getCritSlot(loc, slot);
            let totalAmmo = critSlot?.totalAmmo || originalTotalAmmo;
            const ammoToastId = `ammo-${unit.id}-${loc}-${slot}`;
            let lastAmountVariationTimestamp = 0;
            let amount = 0;
            const showAmmoToast = (critSlot: CriticalSlot, variation: number) => {
                if (critSlot.consumed === undefined) {
                    return;
                }
                const timeDiff = Date.now() - lastAmountVariationTimestamp;
                if (timeDiff > 3000) {
                    amount = 0;
                }
                amount += variation;
                lastAmountVariationTimestamp = Date.now();
                const remaining = totalAmmo - critSlot.consumed;
                const amountText = amount > 0 ? `+${amount}` : amount.toString();
                this.toastService.showToast(`${amountText} ${amount >= 0 ? 'to' : 'from'} ${labelText} (${remaining}/${totalAmmo})`, 'info', ammoToastId);
            };

            const registry = this.equipmentRegistryService.getRegistry();

            const createAndShowPicker = (event: Event) => {
                if (unit.isInternalLocDestroyed(loc)) {
                    return;
                }
                const calculateValues = () => {
                    const critSlot = unit.getCritSlot(loc, slot);
                    if (!critSlot) return [];
                    let values: PickerChoice[] = [];
                    if (!critSlot.destroying) {
                        values.push({ label: 'Critical Hit', value: 'Hit' });
                    }
                    if ((critSlot.hits ?? 0) > 0) {
                        values.push({ label: 'Repair', value: 'Repair' });
                    }
                    if (!critSlot.destroyed && critSlot.eq instanceof AmmoEquipment) {
                        values.unshift({ label: '+1', value: '+1', keepOpen: true, disabled: ((critSlot.consumed ?? 0) == 0) });
                        values.unshift({ label: '-1', value: '-1', keepOpen: true, disabled: ((critSlot.consumed ?? 0) >= totalAmmo) });
                        values.push({ label: 'Set Ammo', value: 'Set Ammo' });
                    }
                    return values;
                };

                // TODO: merge it with the inventory interaction system. 
                // Make that we find the inventory entry from the crit slot and then we handle from there.
                const pickerInstance = this.showChoicePicker({
                    event,
                    el: svgEl,
                    title: labelText,
                    values: calculateValues(),
                    selected: null,
                    style: 'linear',
                    targetType: 'crit',
                    onPick: async (choice: HandlerChoice) => {
                        if (!choice || !choice.keepOpen) {
                            this.removePicker();
                        }
                        if (!choice) return;
                        const critSlot = unit.getCritSlot(loc, slot);
                        if (!critSlot) return;
                        if (choice.value == '+1') {
                            if (critSlot.consumed === undefined) {
                                return;
                            }
                            if (critSlot.consumed <= 0) return;
                            critSlot.consumed--;
                            unit.setCritSlot(critSlot);
                            showAmmoToast(critSlot, 1);
                        } else if (choice.value == '-1') {
                            if (critSlot.consumed === undefined) {
                                critSlot.consumed = 0;
                            }
                            if (critSlot.consumed >= totalAmmo) return;
                            critSlot.consumed++;
                            unit.setCritSlot(critSlot);
                            showAmmoToast(critSlot, -1);
                        } else if (choice.value == 'Empty') {
                            critSlot.consumed = totalAmmo;
                            unit.setCritSlot(critSlot);
                            this.toastService.showToast(`Emptied ${labelText}`, 'info');
                        } else if (choice.value == 'Set Ammo') {
                            const amountUsed = critSlot.consumed ?? 0;
                            const ammoOptions: AmmoEquipment[] = [];
                            if (!critSlot.name || !critSlot.eq) return;
                            const ammoItem = critSlot.eq;
                            let originalAmmo = ammoItem as AmmoEquipment;
                            if (critSlot.originalName && critSlot.originalName !== critSlot.name) {
                                originalAmmo = equipmentList[critSlot.originalName] as AmmoEquipment;
                            }
                            if (ammoItem instanceof AmmoEquipment) {
                                const baseOrder: Record<string, number> = { 'All': 0, 'IS': 1, 'Clan': 2 };
                                const unitBlueprint = unit.getUnit();
                                const compatibleAmmo = Object.values(equipmentList)
                                    .filter((e): e is AmmoEquipment => (e instanceof AmmoEquipment) && (originalAmmo.compatibleAmmo(e, unitBlueprint)))
                                    .sort((a, b) => {
                                        const ao = baseOrder[(a.techBase || '')] ?? 3;
                                        const bo = baseOrder[(b.techBase || '')] ?? 3;
                                        if (ao !== bo) return ao - bo;
                                        if (!a.baseAmmo && b.baseAmmo) {
                                            return -1;
                                        }
                                        return a.name.localeCompare(b.name);
                                    });
                                ammoOptions.push(...compatibleAmmo);
                            }
                            const ref = this.dialogsService.createDialog<{ name: string; quantity: number, totalAmmo: number } | null>(SetAmmoDialogComponent, {
                                data: {
                                    currentAmmo: ammoItem,
                                    originalAmmo: originalAmmo,
                                    originalTotalAmmo: originalTotalAmmo,
                                    ammoOptions: ammoOptions,
                                    quantity: totalAmmo - amountUsed,
                                    maxQuantity: totalAmmo
                                } as SetAmmoDialogData
                            });
                            const newAmmoValue = await firstValueFrom(ref.closed);
                            if (!newAmmoValue) return;
                            if (newAmmoValue.name && newAmmoValue.name != critSlot.name && equipmentList[newAmmoValue.name]) {
                                if (!critSlot.originalName) {
                                    critSlot.originalName = critSlot.name;
                                } else
                                    if (newAmmoValue.name == critSlot.originalName) {
                                        delete critSlot.originalName;
                                    }
                                critSlot.name = newAmmoValue.name;
                                totalAmmo = newAmmoValue.totalAmmo;
                                critSlot.totalAmmo = totalAmmo;
                                critSlot.eq = equipmentList[newAmmoValue.name];
                                labelText = critSlot.eq.shortName;
                            }
                            const newQuantity = Math.max(0, Math.min(totalAmmo, newAmmoValue.quantity));
                            critSlot.consumed = totalAmmo - newQuantity;
                            unit.setCritSlot(critSlot);
                            const deltaChange = amountUsed - critSlot.consumed;
                            if (deltaChange !== 0) {
                                showAmmoToast(critSlot, deltaChange);
                            }
                        } else if (choice.value == 'Hit') {
                            unit.applyHitToCritSlot(critSlot, 1, this.consolidateImmediately);
                            this.toastService.showToast(`Critical Hit on ${labelText}`, 'error');
                        } else if (choice.value == 'Repair') {
                            unit.applyHitToCritSlot(critSlot, -1, this.consolidateImmediately);
                            this.toastService.showToast(`Repaired ${labelText}`, 'success');
                        }
                        if (choice.keepOpen && isChoicePickerInstance(pickerInstance)) {
                            pickerInstance.component.values.set(calculateValues());
                        }
                    },
                    onCancel: () => {
                        this.removePicker();
                    }
                });
            }

            this.addSvgTapHandler(svgEl, (event: Event, primaryAction: boolean) => {
                if (this.state.clickTarget !== svgEl) return;
                this.removePicker();
                if (primaryAction && (this.optionsService.options().quickActions === 'enabled')) {
                    let critSlot = unit.getCritSlot(loc, slot);
                    if (!critSlot) return;
                    if (critSlot.consumed !== undefined) {
                        //Is ammo, default is -1
                        if ((critSlot.consumed ?? 0) < totalAmmo) {
                            critSlot.consumed = (critSlot.consumed ?? 0) + 1;
                            unit.setCritSlot(critSlot);
                            showAmmoToast(critSlot, -1);
                            return;
                        }
                    } else {
                        // default is damage
                        if (!critSlot.destroyed) {
                            unit.applyHitToCritSlot(critSlot, 1, this.consolidateImmediately);
                            this.toastService.showToast(`Critical Hit on ${labelText}`, 'error');
                            return;
                        }
                    }
                }
                createAndShowPicker(event);
            }, signal);
        });
    }

    private setupInventoryInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        this.unit()?.getInventory().forEach(entry => {
            const el = entry.el;
            if (!el) return;
            syncSvgMode(entry, getSelectedInventoryControlMode(entry));

            const selectEntry = (button: SVGElement) => {
                const unit = this.unit();
                if (!unit) return;

                const clickedMode = this.validInventoryModeForButton(entry, button);
                const selectedMode = getSelectedInventoryControlMode(entry);
                const forceSelected = !!clickedMode && clickedMode !== selectedMode;
                if (clickedMode) {
                    setInventoryControlMode(entry, clickedMode);
                }

                const updated = selectInventoryControlEntry(unit, entry, (selectedTargetId, targets) => {
                    this.showInventoryTargetPicker(entry, button, selectedTargetId, targets);
                }, forceSelected);
                if (updated) {
                    this.removePicker();
                } else if (button.classList.contains('mainButton') && entry.el?.classList.contains('bay')) {
                    // This is a poorly designed workaround to allow toggling the bay entry selection.
                    unit.setInventoryControlEntrySelected(entry, forceSelected || !unit.isInventoryControlEntrySelected(entry.id));
                    this.removePicker();
                }
            };

            const selectRange = (button: SVGElement) => {
                const unit = this.unit();
                const range = this.inventoryRangeForButton(button);
                if (!unit || !range) return;

                const clickedMode = this.validInventoryModeForButton(entry, button);
                const selectedMode = getSelectedInventoryControlMode(entry);
                const forceSelected = !!clickedMode && clickedMode !== selectedMode;

                if (clickedMode) {
                    setInventoryControlMode(entry, clickedMode);
                }
                const targets = unit.getInventoryControlTargets();
                if (targets.length === 0) {
                    unit.toggleInventoryControlEntryRange(entry, range, forceSelected);
                } else if (targets.length === 1) {
                    const targetId = targets[0].id;
                    const selectedTargetId = unit.getInventoryControlEntryTargetId(entry.id);
                    unit.setInventoryControlEntryTarget(entry, !forceSelected && selectedTargetId === targetId ? null : targetId);
                } else {
                    this.showInventoryTargetPicker(entry, button, unit.getInventoryControlEntryTargetId(entry.id) ?? null, targets);
                }
            };

            el.classList.add('interactive');
            this.inventoryDialogButtons(el).forEach(button => {
                button.classList.add('interactive');
                button.style.cursor = 'pointer';
                button.addEventListener('click', (evt: Event) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    selectEntry(button);
                }, { passive: false, signal });
            });
            this.inventoryRangeButtons(el).forEach(button => {
                button.classList.add('interactive');
                button.style.cursor = 'pointer';
                button.addEventListener('click', (evt: Event) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    selectRange(button);
                }, { passive: false, signal });
            });
        });
    }

    private inventoryDialogButtons(entryEl: SVGElement): SVGElement[] {
        return [
            ...Array.from(entryEl.querySelectorAll<SVGElement>(':scope > .mainButton')),
            ...Array.from(entryEl.querySelectorAll<SVGElement>(':scope > .alternativeMode > .alternativeModeButton'))
        ];
    }

    private inventoryRangeButtons(entryEl: SVGElement): SVGElement[] {
        return Array.from(entryEl.querySelectorAll<SVGElement>(this.inventoryRangeButtonSelector()))
            .filter(button => button.parentNode === entryEl
                || (button.parentElement?.classList.contains('alternativeMode') && button.parentElement.parentNode === entryEl));
    }

    private inventoryRangeButtonSelector(): string {
        return INVENTORY_RANGE_BUTTON_CLASSES
            .map(([className]) => `.${className}`)
            .join(', ');
    }

    private inventoryRangeForButton(button: SVGElement): SheetInventoryRangeKey | null {
        return INVENTORY_RANGE_BUTTON_CLASSES.find(([className]) => button.classList.contains(className))?.[1] ?? null;
    }

    private validInventoryModeForButton(entry: MountedEquipment, button: SVGElement): string | null {
        const modeEl = button.closest('.alternativeMode');
        if (!modeEl || modeEl.parentNode !== entry.el) return null;
        const mode = modeEl.getAttribute('mode');
        if (!mode) return null;
        return getInventoryControlModes(entry).some(candidate => candidate.mode === mode) ? mode : null;
    }

    private showInventoryTargetPicker(
        entry: MountedEquipment,
        button: SVGElement,
        selectedTargetId: InventoryControlRuntimeTargetId | null,
        targets: readonly InventoryControlRuntimeTarget[]
    ): void {
        const unit = this.unit();
        if (!unit) return;
        this.removePicker();
        const portal = new ComponentPortal(WeaponTargetChoiceMenuComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay(SVG_INVENTORY_TARGET_CHOICE_OVERLAY_KEY, button as unknown as HTMLElement, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-target-choice-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
                { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        componentRef.setInput('targets', targets);
        componentRef.setInput('selectedTargetId', selectedTargetId);
        componentRef.setInput('targetNumberTexts', this.inventoryTargetNumberTexts(entry, targets));
        componentRef.changeDetectorRef.detectChanges();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            unit.setInventoryControlEntryTarget(entry, targetId);
            this.overlayManager.closeManagedOverlay(SVG_INVENTORY_TARGET_CHOICE_OVERLAY_KEY);
        });
    }

    private inventoryTargetNumberTexts(entry: MountedEquipment, targets: readonly InventoryControlRuntimeTarget[]): Readonly<Record<InventoryControlRuntimeTargetId, string>> {
        return Object.fromEntries(targets
            .map(target => [target.id, this.inventoryTargetNumberText(entry, target)] as const)
            .filter(([, targetNumber]) => targetNumber !== ''));
    }

    private inventoryTargetNumberText(entry: MountedEquipment, target: InventoryControlRuntimeTarget): string {
        const unit = this.unit();
        if (!unit) return '';
        const svgText = unit.svgService?.inventoryTargetNumberText(entry, target);
        if (svgText) return svgText;

        const missingMovementModifier = unit.turnState().missingAttackMovementModifier();
        const heatFireModifier = unit.svgService?.inventoryTargetHeatFireModifier(entry) ?? 0;
        const hitModifier = parseInventoryTargetNumberCell(readInventoryTargetText(entry, 'hit')) ?? 0;
        return inventoryTargetNumberText({
            entry,
            category: inventoryTargetCategory(entry),
            display: readInventoryTargetDisplay(entry),
            target,
            gunnerySkill: unit.effectiveGunnerySkill(),
            pilotingSkill: unit.effectivePilotingSkill(),
            missingMovementModifier,
            attackModifierBreakdown: unit.turnState().getAttackModifierBreakdown(),
            hitModifier: hitModifier - heatFireModifier,
            heatFireModifier
        });
    }

    private setupAmmoProfileInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const ammoProfileEl = svg.querySelector('#ammoProfile') as SVGElement | null;
        if (!ammoProfileEl) return;

        ammoProfileEl.classList.add('interactive');
        ammoProfileEl.style.cursor = 'pointer';
        ammoProfileEl.addEventListener('click', (event: Event) => {
            const unit = this.unit();
            if (!unit) return;
            this.openEquipmentDialog(unit, 'ammo');
        }, { passive: false, signal });
    }

    private setupConditionsInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit) return;
        const buttonConditions = new Set(unit.rules.conditionControls
            .filter(condition => condition.placement === 'button')
            .map(condition => condition.key));
        const hasMenuConditions = unit.rules.conditionControls.some(condition => condition.placement === 'menu');
        svg.querySelectorAll<SVGElement>('.unitConditionButton, .locConditionButton').forEach(el => {
            const condition = el.getAttribute('condition');
            if (!condition || (condition !== 'menu' && !buttonConditions.has(condition)) || (condition === 'menu' && !hasMenuConditions)) return;
            this.addSvgTapHandler(el, (event: PointerEvent) => {
                const unit = this.unit();
                const clickTarget = this.state.clickTarget;
                if (!unit || !clickTarget || (clickTarget !== el && !el.contains(clickTarget))) return;
                if (condition === 'menu') {
                    this.showConditionsDropdown(el, unit);
                } else {
                    unit.setCondition(condition, !unit.getCondition(condition));
                }
            }, signal);
        });
    }

    private showConditionsDropdown(el: SVGElement, unit: CBTForceUnit): void {
        if (this.overlayManager.has(SVG_CONDITIONS_DROPDOWN_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(SVG_CONDITIONS_DROPDOWN_OVERLAY_KEY);
            return;
        }

        this.removePicker();
    this.overlayManager.closeAllManagedOverlays();
        const portal = new ComponentPortal(UnitStateDropdownComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay(SVG_CONDITIONS_DROPDOWN_OVERLAY_KEY, el as unknown as HTMLElement, portal, {
            hasBackdrop: false,
            panelClass: 'unit-state-dropdown-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        const updateChoices = () => {
            componentRef.setInput('choices', this.unitStateDropdownChoices(el, unit));
            componentRef.changeDetectorRef.detectChanges();
        };
        updateChoices();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
            unit.setCondition(state, !unit.getCondition(state));
            if (componentRef.instance.closeOnSelect()) {
                this.overlayManager.closeManagedOverlay(SVG_CONDITIONS_DROPDOWN_OVERLAY_KEY);
            } else {
                updateChoices();
            }
        });
    }

    private unitStateDropdownChoices(el: SVGElement, unit: CBTForceUnit): UnitStateDropdownChoice[] {
        return unit.rules.conditionControls
            .filter(state => state.placement === 'menu')
            .map(state => ({
                key: state.key,
                label: state.label,
                color: this.unitStateColor(el, state.key, state.color),
                active: unit.getCondition(state.key),
            }));
    }

    private unitStateColor(el: SVGElement, state: string, fallback: string): string {
        return el.ownerSVGElement?.querySelector<SVGElement>(`.unitConditionBanner[state="${state}"]`)?.getAttribute('state-color') ?? fallback;
    }

    private setupLocationConditionInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit || unit.rules.locationConditionControls.length === 0) return;

        svg.querySelectorAll<SVGElement>('.locationConditionButton, .locationConditionText').forEach(el => {
            const loc = el.getAttribute('loc');
            if (!loc) return;
            this.addSvgTapHandler(el, () => {
                const unit = this.unit();
                const clickTarget = this.state.clickTarget;
                if (!unit || !clickTarget || (clickTarget !== el && !el.contains(clickTarget))) return;
                this.showLocationConditionsDropdown(el, unit, loc);
            }, signal);
        });
    }

    private showLocationConditionsDropdown(el: SVGElement, unit: CBTForceUnit, loc: string): void {
        if (this.overlayManager.has(SVG_LOCATION_CONDITIONS_DROPDOWN_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(SVG_LOCATION_CONDITIONS_DROPDOWN_OVERLAY_KEY);
            return;
        }

        this.removePicker();
    this.overlayManager.closeAllManagedOverlays();
        const portal = new ComponentPortal(UnitStateDropdownComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay(SVG_LOCATION_CONDITIONS_DROPDOWN_OVERLAY_KEY, el as unknown as HTMLElement, portal, {
            hasBackdrop: false,
            panelClass: 'unit-state-dropdown-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        componentRef.setInput('closeOnSelect', false);
        const updateChoices = () => {
            componentRef.setInput('choices', this.locationConditionDropdownChoices(unit, loc));
            componentRef.changeDetectorRef.detectChanges();
        };
        updateChoices();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
            const control = unit.rules.locationConditionControls.find(candidate => candidate.key === state);
            if (control?.counted) {
                const value = unit.getLocationConditionValue(loc, state) ?? 0;
                unit.setLocationConditionValue(loc, state, value > 0 ? undefined : 1);
            } else {
                unit.setLocationCondition(loc, state, !unit.getLocationCondition(loc, state));
            }
            updateChoices();
        });

        outputToObservable(componentRef.instance.incremented).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
            const value = unit.getLocationConditionValue(loc, state) ?? 0;
            unit.setLocationConditionValue(loc, state, value + 1);
            updateChoices();
        });

        outputToObservable(componentRef.instance.decremented).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
            const value = unit.getLocationConditionValue(loc, state) ?? 0;
            unit.setLocationConditionValue(loc, state, value - 1);
            updateChoices();
        });
    }

    private locationConditionDropdownChoices(unit: CBTForceUnit, loc: string): UnitStateDropdownChoice[] {
        return unit.rules.locationConditionControls.map(state => {
            const value = unit.getLocationConditionValue(loc, state.key) ?? 0;
            return {
                key: state.key,
                label: state.label,
                color: state.color,
                active: state.counted ? value > 0 : unit.getLocationCondition(loc, state.key),
                counted: state.counted,
                value: state.counted ? value : undefined,
            };
        });
    }

    private openEquipmentDialog(unit: CBTForceUnit, initialTab: EquipmentDialogTab): void {
        this.removePicker();
        this.overlayManager.closeAllManagedOverlays();
        const unitList = this.pageViewerState.forceUnits().length > 0 ? this.pageViewerState.forceUnits() : [unit];
        const context: EquipmentDialogContext = {
            toastService: this.toastService,
            dialogsService: this.dialogsService,
            dataService: this.dataService,
            registry: this.equipmentRegistryService.getRegistry()
        };
        this.pageViewerState.beginInventoryDialog();
        const ref = this.dialogsService.createDialog<void>(EquipmentDialogComponent, {
            data: {
                unitList,
                unitIndex: Math.max(0, unitList.findIndex(candidate => candidate.id === unit.id)),
                onUnitChange: (selectedUnit) => this.forceBuilderService.selectUnit(selectedUnit),
                context,
                initialTab
            } as EquipmentDialogData,
        });
        ref.closed.subscribe(() => this.pageViewerState.endInventoryDialog());
    }

    private setupHeatInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit) return;

        const heatScale = svg.getElementById('heatScale') as SVGGElement | null;
        if (!heatScale) return;

        this.heatCells(svg).forEach(cell => {
            const el = cell.el;
            el.classList.add('interactive');
            el.addEventListener('pointerdown', (evt: PointerEvent) => {
                evt.preventDefault();
                const dragStarted = this.beginHeatDrag(evt, svg, cell, signal);
                if (!dragStarted) return;
                // Dispatch a custom event for page selection to work
                // Since we preventDefault on pointerdown, the click event won't fire naturally
                el.dispatchEvent(new CustomEvent('svg-interaction-click', { bubbles: true }));
            }, { passive: false, signal });
        });

        // Setup overflow button to directly set heat value
        const overflowFrame = svg.querySelector('#heatScale .overflowFrame');
        const overflowButton = svg.querySelector('#heatScale .overflowButton');
        if (overflowFrame && overflowButton) {
            const promptHeatOverflow = async (evt: Event) => {
                const currentHeat = unit.getHeat();
                const ref = this.dialogsService.createDialog<number | null>(InputDialogComponent, {
                    data: {
                        message: 'Heat',
                        inputType: 'number',
                        defaultValue: currentHeat.next ?? currentHeat.current,
                        placeholder: 'Heat value'
                    } as InputDialogData
                });
                const newHeatValue = await firstValueFrom(ref.closed);
                if (newHeatValue === null || isNaN(Number(newHeatValue))) return;
                const heatValue = Math.max(0, Number(newHeatValue));
                unit.setHeat(heatValue, this.consolidateImmediately);
            };
            overflowButton.classList.add('interactive');
            overflowButton.addEventListener('click', promptHeatOverflow, { passive: false, signal });
        }

        const heatDataPanel = svg.getElementById('heatDataPanel') as SVGElement | null;

        if (heatDataPanel) {
            const applyHeatButton = heatDataPanel.querySelector('#applyHeatButton') as SVGElement | null;
            if (applyHeatButton) {
                applyHeatButton.classList.add('interactive');
                applyHeatButton.addEventListener('click', (evt: MouseEvent) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    unit.applyHeat();
                }, { passive: false, signal });
            }

            const hsPipEl = heatDataPanel.querySelector('g.hsPips') as SVGElement | null;

            const totalHeatsinkPips = heatDataPanel.querySelectorAll<SVGElement>('.pip.hsPip').length;
            // Setup interactions for the heat data panel that allows to turn on/off heat sinks and reduce the dissipation power
            const getHeatsinkPickerChoices = (unit: CBTForceUnit): PickerChoice[] => {

                const choices: PickerChoice[] = [];
                const turnedOffHeatsinks = (unit.getHeat().heatsinksOff || 0);
                const totalValidAndActiveHeatsinks = turnedOffHeatsinks - totalHeatsinkPips;
                for (let i = totalValidAndActiveHeatsinks; i <= turnedOffHeatsinks; i++) {
                    choices.push({ label: `${i}`, value: i });
                }
                return choices;
            }

            if (hsPipEl) {
                this.addSvgTapHandler(hsPipEl, (event: PointerEvent) => {
                    if (this.state.clickTarget !== hsPipEl) return;

                    const applyHeatsinkChange = (value: number) => {
                        this.removePicker();
                        const heatsinksOff = (unit.getHeat().heatsinksOff || 0) - value;
                        unit.setHeatsinksOff(heatsinksOff);
                        this.toastService.showToast(`Heatsink settings updated.`, 'info');
                    };

                    const choices = getHeatsinkPickerChoices(unit);
                    const numericValues = choices.map(c => c.value as number);
                    const min = Math.min(...numericValues);
                    const max = Math.max(...numericValues);

                    const pickerStylePref = this.getUserPickerPreference();
                    if (pickerStylePref === 'radial' || pickerStylePref === 'default') {
                        this.showNumericPicker({
                            event,
                            el: hsPipEl,
                            title: `Active Heatsinks`,
                            min,
                            max,
                            selected: 0,
                            onPick: (result) => applyHeatsinkChange(result.value),
                            onCancel: () => this.removePicker()
                        });
                    } else {
                        // Use choice picker with discrete values for linear style
                        this.showChoicePicker({
                            event,
                            el: hsPipEl,
                            title: `Active Heatsinks`,
                            values: choices,
                            selected: 0,
                            suggestedStyle: 'linear',
                            targetType: 'heatsinks',
                            onPick: (val) => applyHeatsinkChange(val.value as number),
                            onCancel: () => this.removePicker()
                        });
                    }
                }, signal);
            }
        }
    }

    private beginHeatDrag(evt: PointerEvent, svg: SVGSVGElement, cell: HeatCell, signal: AbortSignal): boolean {
        const unit = this.unit();
        if (!unit || this.activeHeatDrag) return false;

        const onPointerMove = (moveEvent: PointerEvent) => {
            const drag = this.activeHeatDrag;
            if (!drag || moveEvent.pointerId !== drag.pointerId) return;
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            this.zoomPanService.isPanning = false;
            this.updateActiveHeatDrag(moveEvent.clientY, svg);
        };

        const onPointerUp = (upEvent: PointerEvent) => {
            const drag = this.activeHeatDrag;
            if (!drag || upEvent.pointerId !== drag.pointerId) return;
            upEvent.preventDefault();
            unit.setHeat(drag.selectedCell.value, this.consolidateImmediately);
            this.endHeatDrag();
        };

        const onPointerCancel = (cancelEvent: PointerEvent) => {
            const drag = this.activeHeatDrag;
            if (!drag || cancelEvent.pointerId !== drag.pointerId) return;
            this.endHeatDrag();
        };

        const onPointerDown = (downEvent: PointerEvent) => {
            const drag = this.activeHeatDrag;
            if (!drag || downEvent.pointerId === drag.pointerId) return;
            this.endHeatDrag();
        };

        const removeDragListeners = () => {
            svg.removeEventListener('pointerdown', onPointerDown);
            svg.removeEventListener('pointermove', onPointerMove);
            svg.removeEventListener('pointerup', onPointerUp);
            svg.removeEventListener('pointercancel', onPointerCancel);
        };

        const currentHeat = unit.getHeat();
        this.zoomPanService.pointerMoved = false;
        this.zoomPanService.isPanning = false;
        this.state.isHeatDragging = true;
        this.activeHeatDrag = {
            pointerId: evt.pointerId,
            selectedCell: cell,
            baselineHeat: this.displayedHeatValue(currentHeat),
            startElement: cell.el,
            cleanup: removeDragListeners
        };
        this.setHeatMarker(cell);

        svg.addEventListener('pointerdown', onPointerDown, { passive: false, signal });
        svg.addEventListener('pointermove', onPointerMove, { passive: false, signal });
        svg.addEventListener('pointerup', onPointerUp, { passive: false, signal });
        svg.addEventListener('pointercancel', onPointerCancel, { passive: false, signal });
        signal.addEventListener('abort', () => this.endHeatDrag(), { once: true });

        try {
            cell.el.setPointerCapture(evt.pointerId);
        } catch { /* Ignore unsupported pointer capture */ }
        return true;
    }

    private updateActiveHeatDrag(clientY: number, svg: SVGSVGElement): void {
        const drag = this.activeHeatDrag;
        if (!drag) return;
        const cell = this.closestHeatCell(svg, clientY);
        if (!cell || drag.selectedCell.el === cell.el) return;
        drag.selectedCell = cell;
        this.setHeatMarker(cell);
    }

    private setHeatMarker(cell: HeatCell): void {
        const drag = this.activeHeatDrag;
        if (!drag) return;
        this.state.clickTarget = cell.el;
        this.state.heatMarkerData.set({
            el: cell.el,
            heat: cell.value,
            baselineHeat: drag.baselineHeat
        });
    }

    private endHeatDrag(): void {
        const drag = this.activeHeatDrag;
        if (!drag) return;
        drag.cleanup();
        try {
            if (drag.startElement.hasPointerCapture(drag.pointerId)) {
                drag.startElement.releasePointerCapture(drag.pointerId);
            }
        } catch { /* Ignore unsupported pointer capture */ }
        this.activeHeatDrag = null;
        this.state.isHeatDragging = false;
        this.state.heatMarkerData.set(null);
        this.state.clickTarget = null;
    }

    private setupCrewHitInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        svg.querySelectorAll('.crewHit').forEach(el => {
            const svgEl = el as SVGElement;
            this.addSvgTapHandler(svgEl, () => {
                if (this.state.clickTarget !== svgEl) return;
                const unit = this.unit();
                if (!unit) return;
                const crewId = parseInt(svgEl.getAttribute('crewId') || '0');
                const hitValue = parseInt(svgEl.getAttribute('hit') || '0');
                const member = unit.getCrewMember(crewId);
                const currentHits = member.getHits();
                if (currentHits > hitValue) {
                    // if there are slots above, we act as a slider
                    member.setHits(Math.max(0, hitValue));
                } else if (currentHits === hitValue) {
                    // else we toggle the hit value of this slot
                    member.setHits(Math.max(0, currentHits - 1));
                } else {
                    member.setHits(Math.max(0, hitValue));
                }
            }, signal);
        });
    }

    private setupSkillInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit()!;
        const baseUnit = unit.getUnit();
        const disablePiloting = baseUnit.type === 'ProtoMek' || ((baseUnit.type === 'Infantry') && (!canAntiMech(baseUnit)));
        svg.querySelectorAll('.crewSkillButton').forEach(el => {
            const svgEl = el as SVGElement;
            svgEl.style.cursor = 'pointer';

            this.addSvgTapHandler(svgEl, (event: Event, primaryAction: boolean) => {
                const crewId = Number(svgEl.getAttribute('crewId') || 0);
                const skill = svgEl.getAttribute('skill') as SkillType;
                const asf = svgEl.getAttribute('asf') === 'true';
                if (!skill) return;
                if (skill === 'piloting' && disablePiloting) return;
                const crewMember = unit.getCrewMember(crewId);
                const currentValue = crewMember.getSkill(skill, asf);

                const values: PickerChoice[] = [
                    { label: '8', value: 8 },
                    { label: '7', value: 7 },
                    { label: '6', value: 6 },
                    { label: '5', value: 5 },
                    { label: '4', value: 4 },
                    { label: '3', value: 3 },
                    { label: '2', value: 2 },
                    { label: '1', value: 1 },
                    { label: '0', value: 0 },
                ];

                this.showChoicePicker({
                    event,
                    el: svgEl,
                    title: skill,
                    values,
                    selected: currentValue,
                    suggestedStyle: 'radial',
                    targetType: 'skill',
                    onPick: (val) => {
                        crewMember.setSkill(skill, parseInt(val.value as string), asf);
                        this.removePicker();
                    },
                    onCancel: () => this.removePicker()
                });

            }, signal);
        });
    }

    private setupCrewNameInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        svg.querySelectorAll('.crewNameButton').forEach(el => {
            const svgEl = el as SVGElement;
            svgEl.style.cursor = 'pointer';
            svgEl.addEventListener('click', (evt: Event) => {
                const crewId = Number(svgEl.getAttribute('crewId') || 0);
                this.editCrewName(crewId);
            }, { passive: false, signal });
        });
    }

    private setupCrewStateInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        svg.querySelectorAll<SVGElement>('.crewStateButton').forEach(el => {
            this.addSvgTapHandler(el, (event: PointerEvent) => {
                const unit = this.unit();
                const clickTarget = this.state.clickTarget;
                if (!unit || !clickTarget || (clickTarget !== el && !el.contains(clickTarget))) return;
                this.showCrewStateDropdown(el, unit);
            }, signal);
        });
    }

    private showCrewStateDropdown(el: SVGElement, unit: CBTForceUnit): void {
        if (this.overlayManager.has(SVG_CREW_STATE_DROPDOWN_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(SVG_CREW_STATE_DROPDOWN_OVERLAY_KEY);
            return;
        }

        this.removePicker();
        this.overlayManager.closeAllManagedOverlays();
        const crewId = Number(el.getAttribute('crewId') || 0);
        const portal = new ComponentPortal(UnitStateDropdownComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay(SVG_CREW_STATE_DROPDOWN_OVERLAY_KEY, el as unknown as HTMLElement, portal, {
            hasBackdrop: false,
            panelClass: 'unit-state-dropdown-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        const updateChoices = () => {
            componentRef.setInput('choices', this.crewStateDropdownChoices(unit, crewId));
            componentRef.changeDetectorRef.detectChanges();
        };
        updateChoices();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
            const crewMember = unit.getCrewMember(crewId);
            const selectedState = state as CrewStateControlKey;
            crewMember.setState(crewMember.getState() === selectedState ? 'healthy' : selectedState);
            if (componentRef.instance.closeOnSelect()) {
                this.overlayManager.closeManagedOverlay(SVG_CREW_STATE_DROPDOWN_OVERLAY_KEY);
            } else {
                updateChoices();
            }
        });
    }

    private crewStateDropdownChoices(unit: CBTForceUnit, crewId: number): UnitStateDropdownChoice[] {
        const currentState = unit.getCrewMember(crewId).getState();
        return unit.rules.crewStateControls.map(state => ({
            key: state.key,
            label: state.label,
            color: state.color,
            active: currentState === state.key,
        }));
    }

    private heatCells(svg: SVGSVGElement): HeatCell[] {
        return Array.from(svg.querySelectorAll<SVGElement>('#heatScale rect.heat[heat]'))
            .map(el => ({ el, value: Number(el.getAttribute('heat')) }))
            .filter((cell): cell is HeatCell => Number.isFinite(cell.value));
    }

    private closestHeatCell(svg: SVGSVGElement, clientY: number): HeatCell | null {
        let closestCell: HeatCell | null = null;
        let minDistance = Infinity;
        for (const cell of this.heatCells(svg)) {
            const rect = cell.el.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const distance = Math.abs(centerY - clientY);
            if (distance < minDistance) {
                minDistance = distance;
                closestCell = cell;
            }
        }
        return closestCell;
    }

    private displayedHeatValue(heat: { current: number; next?: number | null }): number {
        const heatValue = heat.next ?? heat.current;
        return Number.isFinite(heatValue) ? heatValue : 0;
    }

    private updateHeatHighlight(heatValue: number) {
        const unit = this.unit();
        if (!unit) return;
        const svg = unit.svg();
        if (!svg) return;

        if (!Number.isFinite(heatValue)) {
            heatValue = this.displayedHeatValue(unit.getHeat());
        }

        const highestHotHeat = this.updateHeatTrackHighlight(svg, heatValue);
        this.updateHeatEffectHighlight(svg, heatValue);
        this.updateHeatOverflowHighlight(svg, heatValue, highestHotHeat);
    }

    private updateHeatTrackHighlight(svg: SVGSVGElement, heatValue: number): number {
        let highestHotHeat = -Infinity;
        for (const cell of this.heatCells(svg)) {
            const isHot = cell.value <= heatValue;
            cell.el.classList.toggle('hot', isHot);
            if (isHot && cell.value > highestHotHeat) {
                highestHotHeat = cell.value;
            }
        }
        return highestHotHeat;
    }

    private updateHeatEffectHighlight(svg: SVGSVGElement, heatValue: number): void {
        svg.querySelectorAll<SVGElement>('.heatEffect').forEach(effectEl => {
            const effectVal = Number(effectEl.getAttribute('heat'));
            const isHot = Number.isFinite(effectVal) && effectVal <= heatValue;
            effectEl.classList.remove('surpassed');
            effectEl.classList.toggle('hot', isHot);
        });
        this.updateSurpassedHeatEffects(svg);
    }

    private updateSurpassedHeatEffects(svg: SVGSVGElement): void {
        svg.querySelectorAll<SVGElement>('.heatEffect.hot').forEach(effectEl => {
            const attrs = [
                { name: 'h-shut', value: effectEl.getAttribute('h-shut') },
                { name: 'h-random', value: effectEl.getAttribute('h-random') },
                { name: 'h-ammo', value: effectEl.getAttribute('h-ammo') },
                { name: 'h-fire', value: effectEl.getAttribute('h-fire') },
                { name: 'h-move', value: effectEl.getAttribute('h-move'), inverse: true },
            ];
            let surpassed = false;
            for (const attr of attrs) {
                if (surpassed) break;
                if (attr.value === null) continue;
                const currentVal = Number(attr.value);
                if (!Number.isFinite(currentVal)) continue;
                svg.querySelectorAll<SVGElement>('.heatEffect.hot:not(.surpassed)').forEach(otherEl => {
                    if (otherEl === effectEl) return;
                    const otherVal = otherEl.getAttribute(attr.name);
                    if (otherVal === null) return;
                    const otherNumber = Number(otherVal);
                    if (!Number.isFinite(otherNumber)) return;
                    if (attr.inverse) {
                        if (otherNumber < currentVal) {
                            effectEl.classList.add('surpassed');
                            surpassed = true;
                        }
                    } else if (otherNumber > currentVal) {
                        effectEl.classList.add('surpassed');
                        surpassed = true;
                    }
                });
            }
        });
    }

    private updateHeatOverflowHighlight(svg: SVGSVGElement, heatValue: number, highestHotHeat: number): void {
        if (highestHotHeat >= heatValue) {
            svg.querySelector('#heatScale .overflowFrame')?.classList.remove('hot');
        }
    }

    // Picker Management
    
    /**
     * Show a choice picker for selecting from a list of values.
     * Uses the PickerFactoryService to handle picker type selection based on user preferences.
     */
    private showChoicePicker(opts: {
        event: Event;
        el: SVGElement;
        position?: PickerPosition;
        title: string | null;
        values: PickerChoice[];
        selected: PickerValue | null;
        style?: ChoicePickerStyle;
        suggestedStyle?: ChoicePickerStyle;
        horizontal?: boolean;
        align?: 'topleft' | 'left' | 'center' | 'top';
        targetType?: PickerTargetType;
        onPick: (val: PickerChoice) => void;
        onCancel: () => void;
    }): ChoicePickerInstance {
        if (this.pickerRef) this.removePicker();

        opts.el.classList.add('picker-active');
        this.currentHighlightedElement = opts.el;
        this.state.isPickerOpen.set(true);

        const rect = opts.el.getBoundingClientRect();
        const lightTheme = this.optionsService.options().sheetsColor === 'night';

        // Calculate position based on target type
        let position: PickerPosition;
        let horizontal = false;
        let align: 'topleft' | 'left' | 'center' | 'top' = 'center';

        if (opts.targetType === 'crit') {
            position = { 
                x: opts.position?.x ?? rect.left, 
                y: opts.position?.y ?? rect.top 
            };
            align = 'topleft';
            horizontal = true;
        } else if (opts.targetType === 'inventory') {
            position = { 
                x: opts.position?.x ?? (rect.left + rect.width + 4), 
                y: opts.position?.y ?? (rect.top + rect.height / 2) 
            };
            align = 'left';
            horizontal = true;
        } else {
            position = { 
                x: opts.position?.x ?? (rect.left + rect.width / 2), 
                y: opts.position?.y ?? (rect.top + rect.height / 2) 
            };
        }
        horizontal = opts.horizontal ?? horizontal;
        align = opts.align ?? align;

        this.pickerRef = this.pickerFactory.createChoicePicker({
            values: opts.values,
            selected: opts.selected,
            position,
            title: opts.title,
            lightTheme,
            style: opts.style,
            suggestedStyle: opts.suggestedStyle,
            targetType: opts.targetType,
            horizontal,
            align,
            initialEvent: opts.event instanceof PointerEvent ? opts.event : undefined,
            onPick: opts.onPick,
            onCancel: opts.onCancel
        });

        return this.pickerRef as ChoicePickerInstance;
    }

    /**
     * Show a numeric picker for selecting a value within a min/max range.
     * Uses the rotating dial picker optimized for numeric input.
     */
    private showNumericPicker(opts: {
        event: Event;
        el: SVGElement;
        position?: PickerPosition;
        title: string | null;
        min: number;
        max: number;
        selected?: number;
        step?: number;
        onPick: (result: NumericPickerResult) => void;
        onCancel: () => void;
    }): NumericPickerInstance {
        if (this.pickerRef) this.removePicker();

        opts.el.classList.add('picker-active');
        this.currentHighlightedElement = opts.el;
        this.state.isPickerOpen.set(true);

        const rect = opts.el.getBoundingClientRect();
        const lightTheme = this.optionsService.options().sheetsColor === 'night';

        const position: PickerPosition = {
            x: opts.position?.x ?? (rect.left + rect.width / 2),
            y: opts.position?.y ?? (rect.top + rect.height / 2)
        };

        this.pickerRef = this.pickerFactory.createNumericPicker({
            min: opts.min,
            max: opts.max,
            selected: opts.selected ?? 0,
            step: opts.step ?? 1,
            position,
            title: opts.title,
            lightTheme,
            initialEvent: opts.event instanceof PointerEvent ? opts.event : undefined,
            onPick: opts.onPick,
            onCancel: opts.onCancel
        });

        return this.pickerRef as NumericPickerInstance;
    }

    private getUserPickerPreference(): 'linear' | 'radial' | 'default' {
        return this.optionsService.options().pickerStyle;
    }

    public removePicker() {
        if (this.pickerRef) {
            this.pickerRef.destroy();
            this.pickerRef = null;
            this.state.isPickerOpen.set(false);

            if (this.currentHighlightedElement) {
                this.currentHighlightedElement.classList.remove('picker-active');
                this.currentHighlightedElement = null;
            }
        }
    }

    isAnyPickerOpen(): boolean {
        return this.state.isPickerOpen() || (this.state.heatMarkerData() !== null);
    }

    private async editCrewName(crewId: number) {
        const unit = this.unit()!;
        if (!unit) return;
        const crewMember = unit.getCrewMember(crewId);
        await this.forceBuilderService.editPilotOfUnit(unit, crewMember);
    }

    cleanup() {
        this.endHeatDrag();
        if (this.heatMarkerEffectRef) {
            this.heatMarkerEffectRef.destroy();
            this.heatMarkerEffectRef = null;
        }
        if (this.interactionAbortController) {
            this.interactionAbortController.abort();
            this.interactionAbortController = null;
        }

        if (this.pickerRef) {
            this.removePicker();
        }
        this.currentHighlightedElement = null;
        this.state.clickTarget = null;
        this.state.heatMarkerData.set(null);
        this.overlayManager.closeAllManagedOverlays();
        this.unit.set(null);
    }
}