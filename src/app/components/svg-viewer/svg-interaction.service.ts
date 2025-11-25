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

import { Injectable, ElementRef, DestroyRef, signal, WritableSignal, Injector, effect, EffectRef, ApplicationRef, EnvironmentInjector, createComponent, inject } from '@angular/core';
import { DialogsService } from '../../services/dialogs.service';
import { firstValueFrom } from 'rxjs';
import { ForceUnit } from '../../models/force-unit.model';
import { SkillType } from '../../models/crew-member.model';
import { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import { OptionsService } from '../../services/options.service';
import { InputDialogComponent, InputDialogData } from '../input-dialog/input-dialog.component';
import { SvgZoomPanService } from './svg-zoom-pan.service';
import { PickerChoice, PickerInstance, PickerPosition, PickerTargetType, PickerValue } from '../picker/picker.interface';
import { RadialPickerComponent } from '../radial-picker/radial-picker.component';
import { LinearPickerComponent } from '../linear-picker/linear-picker.component';
import { RotatingPickerComponent } from '../rotating-picker/rotating-picker.component';
import { ToastService } from '../../services/toast.service';
import { LayoutService } from '../../services/layout.service';
import { SetAmmoDialogComponent, SetAmmoDialogData } from '../set-ammo-dialog/set-ammo.dialog.component';
import { DataService } from '../../services/data.service';
import { AmmoEquipment } from '../../models/equipment.model';
import { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import { HandlerChoice, HandlerContext } from '../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../services/force-builder.service';

/*
 * Author: Drake
 */
export interface InteractionState {
    interactionMode: WritableSignal<'touch' | 'mouse'>;
    clickTarget: SVGElement | null;
    isHeatDragging: boolean;
    diffHeatMarkerVisible: WritableSignal<boolean>;
    heatMarkerData: WritableSignal<{ el: SVGElement | null, heat: number } | null>;
    isPickerOpen: WritableSignal<boolean>;
}

@Injectable({
    providedIn: 'root'
})
export class SvgInteractionService {
    private dataService = inject(DataService);
    private optionsService = inject(OptionsService);
    private dialogsService = inject(DialogsService);
    private zoomPanService = inject(SvgZoomPanService);
    private toastService = inject(ToastService);
    private layoutService = inject(LayoutService);
    private forceBuilderService = inject(ForceBuilderService);
    private equipmentRegistryService = inject(EquipmentInteractionRegistryService);

    private containerRef!: ElementRef<HTMLDivElement>;
    private unit = signal<ForceUnit | null>(null);
    private injector!: Injector;

    private state: InteractionState = {
        interactionMode: signal<'touch' | 'mouse'>('touch'),
        clickTarget: null,
        isHeatDragging: false,
        diffHeatMarkerVisible: signal(false),
        heatMarkerData: signal<{ el: SVGElement | null, heat: number } | null>(null),
        isPickerOpen: signal(false)
    };

    private pickerRef: PickerInstance | null = null;
    private heatMarkerEffectRef: EffectRef | null = null;
    private diffHeatMarkerRef?: ElementRef<HTMLDivElement>;
    private diffHeatArrowRef?: ElementRef<HTMLDivElement>;
    private diffHeatTextRef?: ElementRef<HTMLDivElement>;
    private interactionAbortController: AbortController | null = null;

    private currentHighlightedElement: SVGElement | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.cleanup();
        });
    }

    initialize(
        containerRef: ElementRef<HTMLDivElement>,
        injector: Injector,
        diffHeatMarkerRef?: ElementRef<HTMLDivElement>,
        diffHeatArrowRef?: ElementRef<HTMLDivElement>,
        diffHeatTextRef?: ElementRef<HTMLDivElement>
    ) {
        this.cleanup();

        this.containerRef = containerRef;
        this.injector = injector;
        this.diffHeatMarkerRef = diffHeatMarkerRef;
        this.diffHeatArrowRef = diffHeatArrowRef;
        this.diffHeatTextRef = diffHeatTextRef;

        this.heatMarkerEffectRef = effect(() => {
            const currentUnit = this.unit();
            if (!currentUnit) return;
            if (!this.diffHeatMarkerRef || !this.diffHeatArrowRef || !this.diffHeatTextRef) return;

            const data = this.state.heatMarkerData();
            const isVisible = !!data;

            this.state.diffHeatMarkerVisible.set(isVisible);

            const currentHeat = currentUnit.getHeat();
            if (!isVisible) {
                this.updateHeatHighlight(currentHeat.next ?? currentHeat.current);
                return;
            }

            const diff = data.heat - currentHeat.current;
            const container = this.containerRef.nativeElement;
            const containerRect = container.getBoundingClientRect();
            const elRect = data.el?.getBoundingClientRect();

            if (!elRect) {
                this.state.diffHeatMarkerVisible.set(false);
                return;
            }

            this.updateHeatHighlight(data.heat);
            const isMouse = this.state.interactionMode() === 'mouse';
            const markerWidth = isMouse ? 50 : 150;
            const markerHeight = isMouse ? 22 : 44;
            const spacing = 4;

            const x = elRect.left - containerRect.left - markerWidth - spacing;
            const y = elRect.top - containerRect.top + (elRect.height / 2) - (markerHeight / 2);

            const marker = this.diffHeatMarkerRef.nativeElement;
            marker.style.transform = `translate(${x}px, ${y}px)`;

            let color = '#666';
            if (diff < 0) color = 'var(--cold-color)';
            else if (diff > 0) color = 'var(--hot-color)';

            this.diffHeatTextRef.nativeElement.style.backgroundColor = color;
            this.diffHeatArrowRef.nativeElement.style.borderLeftColor = color;

            let diffText = (diff >= 0 ? '+' : '') + diff.toString();
            if (!isMouse) {
                diffText = `${data.heat} (${diffText})`;
            }
            this.diffHeatTextRef.nativeElement.textContent = diffText;
        }, { injector: this.injector });
    }

    getState(): Readonly<InteractionState> {
        return {
            interactionMode: this.state.interactionMode,
            clickTarget: this.state.clickTarget,
            isHeatDragging: this.state.isHeatDragging,
            diffHeatMarkerVisible: this.state.diffHeatMarkerVisible,
            heatMarkerData: this.state.heatMarkerData,
            isPickerOpen: this.state.isPickerOpen
        };
    }

    updateUnit(unit: ForceUnit | null) {
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
        this.setupCritSlotInteractions(svg, signal);
        this.setupHeatInteractions(svg, signal);
        this.setupCritLocInteractions(svg, signal);
        this.setupCrewHitInteractions(svg, signal);
        this.setupSkillInteractions(svg, signal);
        this.setupCrewNameInteractions(svg, signal);
        this.setupInventoryInteractions(svg, signal);
    }

    private addSvgTapHandler(
        el: SVGElement,
        handler: (evt: PointerEvent, primaryAction: boolean) => void,
        signal: AbortSignal
    ) {
        let longTouchTimer: any = null;
        el.classList.add('interactive');
        const eventOptions = { passive: false, signal };

        let pointerId: number | null = null;

        el.addEventListener('pointerdown', (evt: PointerEvent) => {
            evt.preventDefault();
            this.state.interactionMode.set(evt.pointerType === 'mouse' ? 'mouse' : 'touch');
            this.state.clickTarget = el;
            this.zoomPanService.pointerMoved = false;
            clearLongTouch();
            longTouchTimer = setTimeout(() => {
                upHandlerSecondary(evt);
            }, 300);
            pointerId = evt.pointerId;
        }, eventOptions);

        const clearLongTouch = () => {
            pointerId = null;
            if (longTouchTimer) {
                clearTimeout(longTouchTimer);
                longTouchTimer = null;
            }
        };

        const upHandlerSecondary = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            clearLongTouch();
            evt.stopPropagation();
            evt.preventDefault();
            if (this.state.clickTarget && !this.zoomPanService.pointerMoved) {
                handler(evt, false);
            }
            this.state.clickTarget = null;
        };

        const upHandler = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            clearLongTouch();
            evt.preventDefault();
            if (this.state.clickTarget && !this.zoomPanService.pointerMoved) {
                let isLeftClick = true;
                isLeftClick = evt.button === 0;
                handler(evt, isLeftClick);
            }
            this.state.clickTarget = null;
        };

        const cancelHandler = (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            clearLongTouch();
            evt.preventDefault();
            this.state.clickTarget = null;
        };

        el.addEventListener('pointerleave', cancelHandler, eventOptions);
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
        svg.querySelectorAll<SVGElement>('.crew-status-checkbox').forEach(el => {
            el.classList.add('interactive');
            this.addSvgTapHandler(el, (evt: Event, primaryAction: boolean) => {
                // Handle the tap event for crew status checkboxes
                if (this.state.clickTarget !== el) return;
                const crewId = el.getAttribute('crewId') as number | null;
                const state = el.getAttribute('state');
                if (crewId === null || !state) return;
                const unit = this.unit();
                if (!unit) return;
                const crewMember = unit.getCrewMember(crewId);
                if (!crewMember) return;
                if (state === 'dead') {
                    crewMember.toggleDead();
                } else if (state === 'unconscious') {
                    crewMember.toggleUnconscious();
                }
            }, signal);
        });

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
            this.toastService.show(`${amountText} hits (${remaining}/${totalTroops})`, amount > 0 ? 'error' : 'success', toastId);
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
                    this.unit()?.setInternalHits('TROOP', newHealth - 1);
                    showToast(deltaChange - 1);
                } else if (deltaChange > 0) {
                    this.unit()?.setInternalHits('TROOP', newHealth);
                    showToast(deltaChange);
                } else {
                    this.unit()?.addInternalHits('TROOP', -1);
                    showToast(-1);
                }
            }, signal);
        });
    }

    private setupArmorInteraction(svg: SVGSVGElement, signal: AbortSignal) {
        let locationZones = svg.querySelectorAll('.unitLocation');
        if (locationZones.length === 0) {
            locationZones = svg.querySelectorAll('.pip.armor, .pip.structure');
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
                this.toastService.show(`${amountText} ${rear ? ' rear' : ''} ${location} hits in ${loc} (${remaining}/${totalPips})`, amount > 0 ? 'error' : 'success', armorToastId);
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
                const pickerInstance: PickerInstance = this.showPicker({
                    event: event,
                    el: svgEl,
                    position: { x: x, y: y },
                    title: `${loc}${rear ? ' (Rear)' : ''}`,
                    values: calculateValues(),
                    selected: 0,
                    suggestedPickerStyle: 'radial',
                    targetType: 'armor',
                    onPick: (val: PickerChoice) => {
                        this.removePicker();
                        const unit = this.unit();
                        if (!unit) return;
                        if (val) {
                            if (isStructure) {
                                unit.addInternalHits(loc, val.value as number);
                            } else {
                                let valueToApply = val.value as number;
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
                                        unit.addArmorHits(loc, -armorPointsToRepair, rear);
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
                                    this.unit()?.addArmorHits(loc, valueToApply, rear);
                                }
                            }
                            showArmorToast(val.value as number);
                        }
                    },
                    onCancel: () => {
                        this.removePicker();
                    }
                });
            }

            this.addSvgTapHandler(svgEl, (event: PointerEvent, primaryAction: boolean) => {
                createAndShowPicker(event);
            }, signal);
        });
    }

    private setupCritLocInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        svg.querySelectorAll('.critLoc').forEach(el => {
            const svgEl = el as SVGElement;
            this.addSvgTapHandler(svgEl, (evt: Event, primaryAction: boolean) => {
                if (this.state.clickTarget !== svgEl) return;
                const id = svgEl.getAttribute('id');
                if (!id) return;
                let critLoc = this.unit()?.getCritLoc(id);
                if (!critLoc) return;
                critLoc.destroyed = !!critLoc.destroyed ? undefined : Date.now();
                this.unit()?.setCritLoc(critLoc);
            }, signal);
        });
    }

    private setupCritSlotInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit) return;
        const equipmentList = this.dataService.getEquipment(unit.getUnit().type);
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
                this.toastService.show(`${amountText} ${amount >= 0 ? 'to' : 'from'} ${labelText} (${remaining}/${totalAmmo})`, 'info', ammoToastId);
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
                        values.unshift({ label: '+1', value: '+1', disabled: ((critSlot.consumed ?? 0) == 0) });
                        values.unshift({ label: '-1', value: '-1', disabled: ((critSlot.consumed ?? 0) >= totalAmmo) });
                        values.push({ label: 'Set Ammo', value: 'Set Ammo' });
                    }
                    return values;
                };
                const pickerInstance: PickerInstance = this.showPicker({
                    event: event,
                    el: svgEl,
                    title: labelText,
                    values: calculateValues(),
                    selected: null,
                    pickerStyle: 'linear',
                    targetType: 'crit',
                    onPick: async (choice: HandlerChoice) => {
                        this.removePicker();
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
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == '-1') {
                            if (critSlot.consumed === undefined) {
                                critSlot.consumed = 0;
                            }
                            if (critSlot.consumed >= totalAmmo) return;
                            critSlot.consumed++;
                            unit.setCritSlot(critSlot);
                            showAmmoToast(critSlot, -1);
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == 'Empty') {
                            critSlot.consumed = totalAmmo;
                            unit.setCritSlot(critSlot);
                            this.toastService.show(`Emptied ${labelText}`, 'info');
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == 'Set Ammo') {
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
                                        const ao = baseOrder[(a.base || '')] ?? 3;
                                        const bo = baseOrder[(b.base || '')] ?? 3;
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
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == 'Hit') {
                            unit.applyHitToCritSlot(critSlot, 1, !this.optionsService.options().useAutomations);
                            this.toastService.show(`Critical Hit on ${labelText}`, 'error');
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == 'Repair') {
                            unit.applyHitToCritSlot(critSlot, -1, !this.optionsService.options().useAutomations);
                            this.toastService.show(`Repaired ${labelText}`, 'success');
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
                            unit.applyHitToCritSlot(critSlot, 1, !this.optionsService.options().useAutomations);
                            this.toastService.show(`Critical Hit on ${labelText}`, 'error');
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
            let nameText = entry.el?.querySelector(':scope > .name')?.textContent || '';
            let totalAmmo = 0;
            if (el.hasAttribute('totalAmmo')) {
                totalAmmo = parseInt(el.getAttribute('totalAmmo') || '0');
            }
            const ammoToastId = `ammo-${this.unit()?.id}-${entry.id}`;
            let lastAmountVariationTimestamp = 0;
            let amount = 0;
            const showAmmoToast = (equip: MountedEquipment, variation: number) => {
                if (equip.consumed === undefined) {
                    return;
                }
                const timeDiff = Date.now() - lastAmountVariationTimestamp;
                if (timeDiff > 3000) {
                    amount = 0;
                }
                amount += variation;
                lastAmountVariationTimestamp = Date.now();
                const remaining = totalAmmo - equip.consumed;
                const amountText = amount > 0 ? `+${amount}` : amount.toString();
                this.toastService.show(`${amountText} ${amount >= 0 ? 'to' : 'from'} ${nameText} (${remaining}/${totalAmmo})`, 'info', ammoToastId);
            };

            const createAndShowPicker = (event: Event) => {
                const context: HandlerContext = {
                    toastService: this.toastService
                };

                const registry = this.equipmentRegistryService.getRegistry();

                const calculateValues = () => {
                    let values: HandlerChoice[] = [];

                    // Get equipment-specific choices based on flags
                    const equipmentChoices = registry.getChoices(entry, context);
                    if (equipmentChoices.length > 0) {
                        values.push(...equipmentChoices);
                    }


                    // Add standard damage/repair options
                    if (this.unit()?.hasDirectInventory()) {
                        if (!entry.destroyed) {
                            values.push({ label: 'Critical Hit', value: 'Hit' });
                        } else {
                            values.push({ label: 'Repair', value: 'Repair' });
                        }
                    }

                    // Add ammo management options if applicable
                    if (!entry.destroyed && (totalAmmo > 0)) {
                        values.unshift({ label: '+1', value: '+1', disabled: ((entry.consumed ?? 0) == 0) });
                        values.unshift({ label: '-1', value: '-1', disabled: ((entry.consumed ?? 0) >= totalAmmo) });
                        values.push({ label: 'Empty', value: 'Empty', disabled: ((entry.consumed ?? 0) >= totalAmmo) });
                    }
                    return values;
                };

                let calculatePickerValues = calculateValues();
                if (calculatePickerValues.length === 0) {
                    return;
                }

                const pickerInstance: PickerInstance = this.showPicker({
                    event: event,
                    el: el,
                    title: nameText,
                    values: calculatePickerValues,
                    selected: null,
                    pickerStyle: 'linear',
                    targetType: 'crit',
                    onPick: (choice: HandlerChoice) => {
                        // Try equipment-specific handlers first
                        if (choice?._handler) {
                            const handled = registry.handleSelection(entry, choice, context);

                            if (handled && choice.keepOpen) {
                                calculatePickerValues = calculateValues();
                                pickerInstance.component.values.set(calculatePickerValues);
                                return; // Keep picker open for state changes
                            }
                        }

                        // Handle standard options
                        if (choice.value == '+1') {
                            if (entry.consumed === undefined) {
                                return;
                            }
                            if (entry.consumed <= 0) return;
                            entry.consumed--;
                            this.unit()?.setInventoryEntry(entry);
                            showAmmoToast(entry, 1);
                            pickerInstance.component.values.set(calculateValues());
                            return;
                        }
                        if (choice.value == '-1') {
                            if (entry.consumed === undefined) {
                                entry.consumed = 0;
                            }
                            if (entry.consumed >= totalAmmo) return;
                            entry.consumed++;
                            this.unit()?.setInventoryEntry(entry);
                            showAmmoToast(entry, -1);
                            pickerInstance.component.values.set(calculateValues());
                            return;
                        }
                        if (choice.value == 'Empty') {
                            entry.consumed = totalAmmo;
                            this.unit()?.setInventoryEntry(entry);
                            this.toastService.show(`Emptied ${nameText}`, 'info');
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == 'Hit') {
                            entry.destroyed = true;
                            this.unit()?.setInventoryEntry(entry);
                            this.toastService.show(`Critical Hit on ${nameText}`, 'error');
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (choice.value == 'Repair') {
                            entry.destroyed = false;
                            this.unit()?.setInventoryEntry(entry);
                            this.toastService.show(`Repaired ${nameText}`, 'success');
                            pickerInstance.component.values.set(calculateValues());
                        }
                        if (!choice || !choice.keepOpen) {
                            this.removePicker();
                        }
                    },
                    onCancel: () => {
                        this.removePicker();
                    }
                });
            }

            this.addSvgTapHandler(el, (event: Event, primaryAction: boolean) => {
                if (this.state.clickTarget !== el) return;
                if (primaryAction && !el.classList.contains('damagedInventory') && !el.classList.contains('disabledInventory')) {
                    if (event.target instanceof Element) {
                        if (event.target.classList.contains('alternativeModeButton')) {
                            const altModeEl = event.target.parentElement;
                            if (altModeEl) {
                                const wasSelected = altModeEl.classList.contains('selected');
                                el.querySelectorAll('.alternativeMode') .forEach(optionEl => {
                                    if (optionEl === altModeEl) return;
                                    optionEl.classList.remove('selected');
                                });
                                altModeEl.classList.toggle('selected', !wasSelected);
                                el.classList.toggle('selected', !wasSelected);
                                return;
                            }
                        }
                    }
                    el.classList.toggle('selected');
                }
                createAndShowPicker(event);
            }, signal);
        });
    }

    private setupHeatInteractions(svg: SVGSVGElement, signal: AbortSignal) {
        const unit = this.unit();
        if (!unit) return;

        let heatScale: SVGElement | null = svg.getElementById('heatScale') as SVGGElement | null;
        if (!heatScale) return;

        let dragState: {
            pointerId: number;
            startElement: SVGElement;
        } | null = null;

        const findClosestHeat = (clientY: number): SVGElement | null => {
            let closestHeat: SVGElement | null = null;
            let minDist = Infinity;
            svg.querySelectorAll('#heatScale .heat').forEach(heatEl => {
                const rect = (heatEl as SVGElement).getBoundingClientRect();
                const centerY = rect.top + rect.height / 2;
                const dist = Math.abs(centerY - clientY);
                if (dist < minDist) {
                    minDist = dist;
                    closestHeat = heatEl as SVGElement;
                }
            });
            return closestHeat;
        };

        const updateHeatMarker = (clientY: number) => {
            const closestHeat = findClosestHeat(clientY);
            if (closestHeat) {
                this.state.clickTarget = closestHeat;
                const heatValue = Number(closestHeat.getAttribute('heat'));
                this.state.heatMarkerData.set({
                    el: closestHeat,
                    heat: heatValue
                });
            }
        };
        const cancelHeatDrag = () => {
            if (!dragState) return;
            svg.removeEventListener('pointerdown', onPointerDown);
            svg.removeEventListener('pointermove', onPointerMove);
            svg.removeEventListener('pointerup', onPointerUp);
            svg.removeEventListener('pointercancel', onPointerCancel);
            this.state.isHeatDragging = false;
            this.state.heatMarkerData.set(null);
            dragState = null;
        };

        const onPointerMove = (evt: PointerEvent) => {
            if (!dragState || !this.state.isHeatDragging) return;
            if (evt.pointerId !== dragState.pointerId) {
                cancelHeatDrag();
                return;
            }
            evt.preventDefault();
            evt.stopPropagation();
            this.zoomPanService.isPanning = false;
            updateHeatMarker(evt.clientY);
        };

        const onPointerUp = (evt: PointerEvent) => {
            if (!dragState || evt.pointerId !== dragState.pointerId) return;
            const heatValue = Number(this.state.clickTarget?.getAttribute('heat') || 0);
            unit.setHeat(heatValue, !this.optionsService.options().useAutomations);
            cancelHeatDrag();
        };

        const onPointerCancel = (evt: PointerEvent) => {
            if (!dragState || evt.pointerId !== dragState.pointerId) return;
            cancelHeatDrag();
        };

        const onPointerDown = (evt: PointerEvent) => {
            if (!dragState || evt.pointerId !== dragState.pointerId) {
                cancelHeatDrag();
                return;
            }
        };

        svg.querySelectorAll<SVGElement>('#heatScale .heat').forEach(el => {
            el.classList.add('interactive');
            el.addEventListener('pointerdown', (evt: PointerEvent) => {
                evt.preventDefault();
                if (dragState) return;
                const interactionType = evt.pointerType === 'mouse' ? 'mouse' : 'touch';
                this.state.interactionMode.set(interactionType);
                this.zoomPanService.pointerMoved = false;
                dragState = {
                    pointerId: evt.pointerId,
                    startElement: el
                };
                this.state.isHeatDragging = true;
                this.zoomPanService.isPanning = false;
                this.state.clickTarget = el as SVGElement;
                const heatValue = Number(el.getAttribute('heat'));
                this.state.heatMarkerData.set({
                    el: this.state.clickTarget,
                    heat: heatValue
                });
                svg.addEventListener('pointerdown', onPointerDown, { passive: false, signal: signal });
                svg.addEventListener('pointermove', onPointerMove, { passive: false, signal });
                svg.addEventListener('pointerup', onPointerUp, { passive: false, signal });
                svg.addEventListener('pointercancel', onPointerCancel, { passive: false, signal });
                try {
                    this.state.clickTarget.setPointerCapture(evt.pointerId);
                } catch (e) { /* Ignore */ }
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
                unit.setHeat(heatValue, !this.optionsService.options().useAutomations);
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
                }, { passive: false, signal } );
            }

            const hsPipEl = heatDataPanel.querySelector('g.hsPips') as SVGElement | null;

            const totalHeatsinkPips = heatDataPanel.querySelectorAll<SVGElement>('.pip.hsPip').length;
            // Setup interactions for the heat data panel that allows to turn on/off heat sinks and reduce the dissipation power
            const getHeatsinkPickerChoices = (unit: ForceUnit): PickerChoice[] => {

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
                    const pickerInstance: PickerInstance = this.showPicker({
                        event: event,
                        el: hsPipEl,
                        title: `Active Heatsinks`,
                        values: getHeatsinkPickerChoices(unit),
                        selected: 0,
                        suggestedPickerStyle: 'radial',
                        targetType: 'heatsinks',
                        onPick: (val: PickerChoice) => {
                            this.removePicker();
                            if (val) {
                                const heatsinksOff = (unit.getHeat().heatsinksOff || 0) - (val.value as number);
                                unit.setHeatsinksOff(heatsinksOff);
                                this.toastService.show(`Heatsink settings updated.`, 'info');
                            }
                        },
                        onCancel: () => {
                            this.removePicker();
                        }
                    });
    
                }, signal);
            }
        }
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
        svg.querySelectorAll('.crewSkillButton').forEach(el => {
            const svgEl = el as SVGElement;
            svgEl.style.cursor = 'pointer';

            this.addSvgTapHandler(svgEl, (event: Event, primaryAction: boolean) => {
                const crewId = Number(svgEl.getAttribute('crewId') || 0);
                const skill = svgEl.getAttribute('skill') as SkillType;
                const asf = svgEl.getAttribute('asf') === 'true';
                if (!skill) return;
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

                this.showPicker({
                    event: event,
                    el: svgEl,
                    title: skill,
                    values: values,
                    selected: currentValue,
                    suggestedPickerStyle: 'radial',
                    targetType: 'skill',
                    onPick: (val: PickerChoice) => {
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

    /**
     * This is a light version of updateHeatDisplay from SvgService, is used for realtime show of the heatscale while drag operations.
     * @param heatValue The current heat value.
     * @returns 
     */
    private updateHeatHighlight(heatValue: number) {
        const unit = this.unit();
        if (!unit) return;
        const svg = unit.svg();
        if (!svg) return;

        let highestHeatVal = -Infinity;

        // Update heat scale rectangles
        svg.querySelectorAll('#heatScale .heat').forEach(heatRect => {
            const heatVal = Number((heatRect as SVGElement).getAttribute('heat'));

            if (heatVal <= heatValue) {
                heatRect.classList.add('hot');
                if (heatVal > highestHeatVal) {
                    highestHeatVal = heatVal;
                }
            } else {
                heatRect.classList.remove('hot');
            }
        });

        // Update heat effects highlight
        svg.querySelectorAll('.heatEffect').forEach(effectEl => {
            const effectVal = Number((effectEl as SVGElement).getAttribute('heat'));
            effectEl.classList.remove('surpassed');

            if (effectVal <= heatValue) {
                effectEl.classList.add('hot');
            } else {
                effectEl.classList.remove('hot');
            }
        });
        svg.querySelectorAll('.heatEffect.hot').forEach(effectEl => {
            const attrs = [
                { name: 'h-shut', value: effectEl.getAttribute('h-shut') },
                { name: 'h-random', value: effectEl.getAttribute('h-random') },
                { name: 'h-ammo', value: effectEl.getAttribute('h-ammo') },
                { name: 'h-fire', value: effectEl.getAttribute('h-fire') },
                { name: 'h-move', value: effectEl.getAttribute('h-move'), inverse: true },
            ];
            let surpassed = false;
            for (const attr of attrs) {
                if (surpassed) break; // If already surpassed, no need to check further
                if (attr.value === null) continue;
                const currentVal = Number(attr.value);
                // Search for another .heatEffect.hot element with same attribute, not null, and lower value
                svg.querySelectorAll('.heatEffect.hot:not(.surpassed)').forEach(otherEl => {
                    if (otherEl === effectEl) return; // same element, skip
                    const otherVal = otherEl.getAttribute(attr.name);
                    if (otherVal === null) return; // skip if no value
                    if (attr.inverse) {
                        if (Number(otherVal) < currentVal) {
                            effectEl.classList.add('surpassed');
                            surpassed = true;
                        }
                    } else
                        if (Number(otherVal) > currentVal) {
                            effectEl.classList.add('surpassed');
                            surpassed = true;
                        }
                });
            }
        });

        // Handle overflow frame
        if (highestHeatVal >= heatValue) {
            svg.querySelector('#heatScale .overflowFrame')?.classList.remove('hot');
        }
    }

    // Picker Management
    private showPicker(opts: {
        event: Event,
        el: SVGElement,
        position?: PickerPosition,
        title: string | null,
        values: PickerChoice[],
        selected: PickerValue | null,
        pickerStyle?: 'radial' | 'linear',
        suggestedPickerStyle?: 'radial' | 'linear' | 'auto',
        targetType?: PickerTargetType,
        onPick: (val: PickerChoice) => void,
        onCancel: () => void
    }): PickerInstance {
        if (this.pickerRef) this.removePicker();

        opts.el.classList.add('picker-active');
        this.currentHighlightedElement = opts.el;
        this.state.isPickerOpen.set(true);

        const appRef = this.injector.get(ApplicationRef);
        const envInjector = this.injector.get(EnvironmentInjector);
        const rect = opts.el.getBoundingClientRect();

        // Determine picker style
        let pickerStyle = opts.pickerStyle ?? opts.suggestedPickerStyle ?? 'auto';
        if (pickerStyle === 'auto') {
            pickerStyle = this.state.interactionMode() == 'mouse' ? 'linear' : 'radial';
        }
        if (!opts.pickerStyle) {
            const optionsPickerStyle = this.optionsService.options().pickerStyle;
            if (optionsPickerStyle !== 'default') {
                pickerStyle = optionsPickerStyle;
            }
        }

        // Create appropriate picker component
        let compRef: any;
        if (pickerStyle === 'linear') {
            compRef = this.createLinearPicker(envInjector, opts, rect);
        } else {
            if (opts.targetType === 'armor' || opts.targetType === 'heatsinks') {
                compRef = this.createRotatingPicker(envInjector, opts, rect);
            } else {
                compRef = this.createRadialPicker(envInjector, opts, rect);
            }
        }

        // Subscribe to picker events
        compRef.instance.picked.subscribe(opts.onPick);
        compRef.instance.cancelled.subscribe(opts.onCancel);

        // Attach to DOM
        document.body.appendChild(compRef.location.nativeElement);
        appRef.attachView(compRef.hostView);
        this.pickerRef = {
            component: compRef.instance,
            destroy: () => {
                appRef.detachView(compRef.hostView);
                compRef.destroy();
            }
        };

        return this.pickerRef;
    }

    private createLinearPicker(envInjector: EnvironmentInjector, opts: any, rect: DOMRect) {
        const compRef = createComponent(LinearPickerComponent, {
            environmentInjector: envInjector,
            elementInjector: this.injector
        });

        const instance = compRef.instance;
        instance.interactionType.set(this.state.interactionMode());
        instance.title.set(opts.title);
        instance.values.set(opts.values);
        instance.selected.set(opts.selected);

        if (opts.targetType === 'crit') {
            instance.horizontal.set(true);
            instance.align.set('topleft');
            const pickerX = opts.position?.x ?? rect.left;
            const pickerY = opts.position?.y ?? rect.top;
            instance.position.set({ x: pickerX, y: pickerY });
        } else
            if (opts.targetType === 'inventory') {
                instance.align.set('left');
                const pickerX = opts.position?.x ?? (rect.left + rect.width + 4);
                const pickerY = opts.position?.y ?? (rect.top + rect.height / 2);
                instance.position.set({ x: pickerX, y: pickerY });
            } else {
                const pickerX = opts.position?.x ?? (rect.left + rect.width / 2);
                const pickerY = opts.position?.y ?? (rect.top + rect.height / 2);
                instance.position.set({ x: pickerX, y: pickerY });
            }
        if (opts.event instanceof PointerEvent) {
            instance.initialEvent.set(opts.event);
        }

        return compRef;
    }

    private createRotatingPicker(envInjector: EnvironmentInjector, opts: any, rect: DOMRect) {
        const compRef = createComponent(RotatingPickerComponent, {
            environmentInjector: envInjector,
            elementInjector: this.injector
        });

        const instance = compRef.instance;
        instance.interactionType.set(this.state.interactionMode());
        instance.title.set(opts.title);
        instance.values.set(opts.values);
        instance.selected.set(opts.selected);

        const pickerX = opts.position?.x ?? (rect.left + rect.width / 2);
        const pickerY = opts.position?.y ?? (rect.top + rect.height / 2);
        instance.position.set({ x: pickerX, y: pickerY });
        if (opts.event instanceof PointerEvent) {
            instance.initialEvent.set(opts.event);
        }

        return compRef;
    }

    private createRadialPicker(envInjector: EnvironmentInjector, opts: any, rect: DOMRect) {
        const compRef = createComponent(RadialPickerComponent, {
            environmentInjector: envInjector,
            elementInjector: this.injector
        });

        const instance = compRef.instance;
        instance.interactionType.set(this.state.interactionMode());
        instance.title.set(opts.title);
        instance.values.set(opts.values);
        instance.selected.set(opts.selected);

        if (opts.targetType === 'crit' || opts.targetType === 'inventory') {
            instance.beginEndPadding.set(0);
            instance.useCurvedText.set(true);
            instance.innerRadius.set(40);
            const x = opts.event.clientX;
            const y = opts.event.clientY;
            instance.position.set({ x: opts.position?.x ?? x, y: opts.position?.y ?? y });
        } else if (opts.targetType === 'armor') {
            instance.beginEndPadding.set(50);
            instance.innerRadius.set(50);
            const x = opts.event.clientX;
            const y = opts.event.clientY;
            instance.position.set({ x: opts.position?.x ?? x, y: opts.position?.y ?? y });
        } else {
            const pickerX = opts.position?.x ?? (rect.left + rect.width / 2);
            const pickerY = opts.position?.y ?? (rect.top + rect.height / 2);
            instance.position.set({ x: pickerX, y: pickerY });
            if (!opts.title) {
                instance.beginEndPadding.set(0);
            }
        }
        if (opts.event instanceof PointerEvent) {
            instance.initialEvent.set(opts.event);
        }

        return compRef;
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
    }
}