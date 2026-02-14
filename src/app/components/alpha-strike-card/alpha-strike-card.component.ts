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

import { Component, ChangeDetectionStrategy, input, computed, inject, signal, effect, output, ElementRef, DestroyRef, afterNextRender, ComponentRef, Injector } from '@angular/core';
import { ASUnitTypeCode, Unit } from '../../models/units.model';
import { ASForceUnit, AbilitySelection } from '../../models/as-force-unit.model';
import { PILOT_ABILITIES, ASCustomPilotAbility } from '../../models/pilot-abilities.model';
import { AsAbilityLookupService, ParsedAbility } from '../../services/as-ability-lookup.service';
import { DialogsService } from '../../services/dialogs.service';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { InputDialogComponent, InputDialogData } from '../input-dialog/input-dialog.component';
import { PilotAbilityInfoDialogComponent, PilotAbilityInfoDialogData } from '../pilot-ability-info-dialog/pilot-ability-info-dialog.component';
import { CardConfig, CardLayoutDesign, CriticalHitsVariant, getLayoutForUnitType } from './card-layout.config';
import { SpecialAbilityState, SpecialAbilityClickEvent } from './layouts/layout-base.component';
import { CriticalHitRollDialogComponent, CriticalHitRollDialogData } from './critical-hit-roll-dialog/critical-hit-roll-dialog.component';
import { MotiveDamageRollDialogComponent, MotiveDamageRollDialogData } from './motive-damage-roll-dialog/motive-damage-roll-dialog.component';
import { AsLayoutStandardComponent, AsLayoutLargeVessel1Component, AsLayoutLargeVessel2Component } from './layouts';
import { GameSystem, REMOTE_HOST } from '../../models/common.model';
import { ChoicePickerInstance, NumericPickerInstance, NumericPickerResult, PickerChoice, PickerPosition } from '../picker/picker.interface';
import { vibrate } from '../../utils/vibrate.util';
import { firstValueFrom } from 'rxjs';
import { OptionsService } from '../../services/options.service';
import { PickerFactoryService } from '../../services/picker-factory.service';

/*
 * Author: Drake
 */

@Component({
    selector: 'alpha-strike-card',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AsLayoutStandardComponent,
        AsLayoutLargeVessel1Component,
        AsLayoutLargeVessel2Component,
    ],
    templateUrl: './alpha-strike-card.component.html',
    styleUrl: './alpha-strike-card.component.scss',
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
        '[class.selected]': 'isSelected()',
        '[class.interactive]': 'interactive()',
        '(click)': 'onCardClick()'
    }
})
export class AlphaStrikeCardComponent {
    private static nextId = 0;
    private readonly injector = inject(Injector);
    private readonly optionsService = inject(OptionsService);
    private readonly abilityLookup = inject(AsAbilityLookupService);
    private readonly dialogs = inject(DialogsService);
    private readonly elRef = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private readonly pickerFactory = inject(PickerFactoryService);
    
    /** Unique instance ID for SVG filter deduplication */
    readonly instanceId = AlphaStrikeCardComponent.nextId++;
    
    /** Optional: provide the stateful AS unit wrapper (preferred when available). */
    forceUnit = input<ASForceUnit | undefined>(undefined);
    /** Optional: provide a plain Unit (used when no forceUnit is available). */
    unit = input<Unit | undefined>(undefined);
    useHex = input<boolean>(false);
    cardStyle = input<'colored' | 'monochrome'>('colored');
    isSelected = input<boolean>(false);
    /** Which card index to render (0 for first/only card, 1 for second card) */
    cardIndex = input<number>(0);
    /** Enable interactive mode (damage/crit pickers) */
    interactive = input<boolean>(false);
    /** Trigger to update picker position (viewer increments this on scroll/resize) */
    updatePickerPositionTrigger = input<number>(0);
    
    selected = output<ASForceUnit>();
    editPilot = output<ASForceUnit>();
    
    imageUrl = signal<string>('');
    
    // Interaction state
    private interactionAbortController: AbortController | null = null;
    private pickerRef: NumericPickerInstance | ChoicePickerInstance | null = null;
    private pickerAnchorElement: HTMLElement | null = null;
    private interactionsSetup = false;
    
    onCardClick(): void {
        const fu = this.forceUnit();
        if (fu) {
            this.selected.emit(fu);
        }
    }
    
    /** Effective Unit for rendering: forceUnit.getUnit() wins, otherwise the plain unit input. */
    resolvedUnit = computed<Unit | undefined>(() => this.forceUnit()?.getUnit() ?? this.unit());
    
    /** Get the Alpha Strike unit type (BM, IM, CV, CI, WS, etc.) */
    unitType = computed<ASUnitTypeCode>(() => this.resolvedUnit()?.as.TP || 'BM');
    
    /** Get the layout configuration for this unit type */
    layoutConfig = computed(() => getLayoutForUnitType(this.unitType()));
    
    /** Get the card config for the current card index */
    currentCardConfig = computed<CardConfig>(() => {
        const config = this.layoutConfig();
        const index = this.cardIndex();
        return config.cards[index] ?? config.cards[0];
    });
    
    /** Get the layout design for the current card */
    currentDesign = computed<CardLayoutDesign>(() => this.currentCardConfig().design);
    
    /** Get the critical hits variant for the current card */
    currentCriticalHitsVariant = computed<CriticalHitsVariant>(() => this.currentCardConfig().criticalHits);

    /** Check if the force unit has uncommitted changes */
    isDirty = computed<boolean>(() => {
        const fu = this.forceUnit();
        return fu ? fu.isDirty() : false;
    });

    /** Handle commit button click */
    onCommitClick(event: MouseEvent): void {
        event.stopPropagation();
        const fu = this.forceUnit();
        if (fu) {
            fu.commitPending();
        }
    }

    constructor() {
        // Effect to load image
        effect(() => {
            const unit = this.resolvedUnit();
            const imagePath = unit?.fluff?.img;
            if (imagePath) {
                this.loadFluffImage(imagePath);
            } else {
                this.imageUrl.set('');
            }
        });
        
        // Track pending afterNextRender callbacks to clean up on destroy
        let pendingAfterRenderRef: { destroy: () => void } | null = null;
        
        // Setup interactions when interactive mode is enabled
        pendingAfterRenderRef = afterNextRender(() => {
            if (this.interactive() && !this.interactionsSetup) {
                this.setupInteractions();
            }
            pendingAfterRenderRef = null;
        });
        
        // Watch for interactive changes
        effect(() => {
            const isInteractive = this.interactive();
            if (isInteractive && !this.interactionsSetup) {
                // Cancel any previous pending render callback
                pendingAfterRenderRef?.destroy();
                pendingAfterRenderRef = afterNextRender(() => {
                    this.setupInteractions();
                    pendingAfterRenderRef = null;
                }, { injector: this.injector });
            } else if (!isInteractive && this.interactionsSetup) {
                this.cleanupInteractions();
            }
        });
        
        // Watch for update picker position trigger from parent (viewer handles scroll/resize)
        effect(() => {
            const trigger = this.updatePickerPositionTrigger();
            if (trigger > 0) {
                this.updatePickerPosition();
            }
        });
        
        // Watch for ASUnifiedDamagePicker changes and re-setup interactions
        effect(() => {
            // Track the option so the effect re-runs when it changes
            const unifiedPicker = this.optionsService.options().ASUnifiedDamagePicker;
            // Only re-setup if interactions are already setup (card is interactive)
            if (this.interactionsSetup) {
                this.cleanupInteractions();
                // Cancel any previous pending render callback
                pendingAfterRenderRef?.destroy();
                pendingAfterRenderRef = afterNextRender(() => {
                    this.setupInteractions();
                    pendingAfterRenderRef = null;
                }, { injector: this.injector });
            }
        });
        
        this.destroyRef.onDestroy(() => {
            pendingAfterRenderRef?.destroy();
            this.cleanupInteractions();
        });
    }
    
    private async loadFluffImage(imagePath: string): Promise<void> {
        try {    
            if (imagePath.endsWith('hud.png')) {
                this.imageUrl.set('');
                return;
            }
            const fluffImageUrl = `${REMOTE_HOST}/images/fluff/${imagePath}`;
            this.imageUrl.set(fluffImageUrl);
        } catch {
            // Ignore errors, image will just not display
            this.imageUrl.set('');
        }
    }
    
    // Handle special ability click from layout components
    onSpecialClick(clickEvent: SpecialAbilityClickEvent): void {
        const { state, event } = clickEvent;
        event.stopPropagation();
        const parsedAbility = this.abilityLookup.parseAbility(state.original);
        const ability = parsedAbility.ability;
        const fu = this.forceUnit();
        
        // In interactive mode, show picker for consumable/exhaustible abilities
        if (this.interactive() && fu && ability && (ability.consumable || ability.canExhaust)) {
            const anchorElement = event.currentTarget as HTMLElement | undefined;
            if (anchorElement) {
                this.showAbilityPicker(state, parsedAbility, anchorElement);
                return;
            }
        }
        
        // Default: show info dialog
        this.showAbilityInfoDialog(state);
    }
    
    private showAbilityInfoDialog(state: SpecialAbilityState): void {
        const parsedAbility = this.abilityLookup.parseAbility(state.original);
        const effectiveParsed = state.effective !== state.original 
            ? this.abilityLookup.parseAbility(state.effective) 
            : undefined;
        
        this.dialogs.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility, effectiveParsed } as AbilityInfoDialogData
        });
    }
    
    private showAbilityPicker(state: SpecialAbilityState, parsedAbility: ParsedAbility, anchorElement: HTMLElement): void {
        const fu = this.forceUnit();
        const ability = parsedAbility.ability;
        if (!fu || !ability) return;
        
        const abilityKey = state.original;
        const values: PickerChoice[] = [];
        
        if (ability.consumable) {
            const maxCount = parsedAbility.consumableMax ?? 1;
            const consumedCount = fu.getState().getEffectiveConsumedCount(abilityKey);
            const remaining = maxCount - consumedCount;
            
            // -1 option (only if not at max)
            if (remaining > 0) {
                values.push({ 
                    label: '-1', 
                    value: 'consume',
                    tooltipType: 'error'
                });
            }
            
            // +1 option (only if consumed > 0)
            if (consumedCount > 0) {
                values.push({ 
                    label: '+1', 
                    value: 'restore',
                    tooltipType: 'success'
                });
            }
        } else if (ability.canExhaust) {
            const isExhausted = fu.getState().isAbilityEffectivelyExhausted(abilityKey);
            
            if (!isExhausted) {
                values.push({ 
                    label: 'Exhaust', 
                    value: 'exhaust',
                    tooltipType: 'error'
                });
            } else {
                values.push({ 
                    label: 'Restore', 
                    value: 'restore',
                    tooltipType: 'success'
                });
            }
        }
        
        // Always add Info option
        values.push({ 
            label: 'Rules', 
            value: 'info',
            tooltipType: 'info'
        });
        
        this.showLinearPicker({
            anchorElement,
            title: ability.name.toUpperCase(),
            values,
            onPick: (val: PickerChoice) => {
                this.removePicker();
                
                switch (val.value) {
                    case 'consume': {
                        const currentDelta = fu.getState().getPendingConsumedDelta(abilityKey);
                        fu.setPendingConsumedDelta(abilityKey, currentDelta + 1);
                        vibrate(10);
                        break;
                    }
                    case 'restore': {
                        if (ability.consumable) {
                            const currentDelta = fu.getState().getPendingConsumedDelta(abilityKey);
                            fu.setPendingConsumedDelta(abilityKey, currentDelta - 1);
                        } else if (ability.canExhaust) {
                            fu.setPendingRestore(abilityKey);
                        }
                        vibrate(10);
                        break;
                    }
                    case 'exhaust':
                        fu.setPendingExhaust(abilityKey);
                        vibrate(10);
                        break;
                    case 'info':
                        this.showAbilityInfoDialog(state);
                        break;
                }
            },
            onCancel: () => this.removePicker()
        });
    }

    // Handle edit pilot click
    onEditPilotClick(): void {
        const fu = this.forceUnit();
        if (fu) {
            this.editPilot.emit(fu);
        }
    }

    onPilotAbilityClick(selection: AbilitySelection): void {
        const isCustom = typeof selection !== 'string';
        let ability: PilotAbilityInfoDialogData['ability'];
        
        if (typeof selection === 'string') {
            const found = PILOT_ABILITIES.find(a => a.id === selection);
            ability = found ?? { name: selection, cost: 0, summary: '' } as ASCustomPilotAbility;
        } else {
            ability = selection;
        }
        
        this.dialogs.createDialog<void>(PilotAbilityInfoDialogComponent, {
            data: { gameSystem: GameSystem.ALPHA_STRIKE, ability, isCustom } as PilotAbilityInfoDialogData
        });
    }

    // Handle roll critical click - shows the critical hit roll dialog
    async onRollCriticalClick(): Promise<void> {
        const fu = this.forceUnit();
        if (!fu) return;
        
        const unitType = fu.getUnit().as.TP;
        if (!unitType) return;
        
        const ref = this.dialogs.createDialog<void, CriticalHitRollDialogComponent, CriticalHitRollDialogData>(
            CriticalHitRollDialogComponent,
            {
                data: { 
                    unitType,
                    forceUnit: fu
                }
            }
        );
        await firstValueFrom(ref.closed);
    }
    
    // ===== Interaction Logic =====
    
    private setupInteractions(): void {
        if (this.interactionsSetup) return;
        
        this.interactionAbortController = new AbortController();
        const signal = this.interactionAbortController.signal;
        const el = this.elRef.nativeElement;
        
        this.setupArmorInteraction(el, signal);
        this.setupCriticalHitInteraction(el, signal);
        this.setupVesselDamageTrackInteraction(el, signal);
        this.setupHeatInteraction(el, signal);
        
        this.interactionsSetup = true;
    }
    
    private cleanupInteractions(): void {
        this.removePicker();
        if (this.interactionAbortController) {
            this.interactionAbortController.abort();
            this.interactionAbortController = null;
        }
        this.interactionsSetup = false;
    }
    
    private addTapHandler(el: HTMLElement, handler: (evt: PointerEvent) => void, signal: AbortSignal): void {
        el.classList.add('interactive');
        const eventOptions = { passive: false, signal };
        
        let pointerId: number | null = null;
        let pointerMoved = false;
        let startX = 0;
        let startY = 0;
        const moveThreshold = 10;
        
        el.addEventListener('pointerdown', (evt: PointerEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            pointerMoved = false;
            startX = evt.clientX;
            startY = evt.clientY;
            pointerId = evt.pointerId;
        }, eventOptions);
        
        el.addEventListener('pointermove', (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            const dx = Math.abs(evt.clientX - startX);
            const dy = Math.abs(evt.clientY - startY);
            if (dx > moveThreshold || dy > moveThreshold) {
                pointerMoved = true;
            }
        }, eventOptions);
        
        el.addEventListener('pointerup', (evt: PointerEvent) => {
            if (evt.pointerId !== pointerId) return;
            evt.preventDefault();
            if (!pointerMoved) {
                handler(evt);
            }
            pointerId = null;
        }, eventOptions);
        
        el.addEventListener('pointerleave', (evt: PointerEvent) => {
            if (evt.pointerId === pointerId) pointerId = null;
        }, eventOptions);
        
        el.addEventListener('pointercancel', (evt: PointerEvent) => {
            if (evt.pointerId === pointerId) pointerId = null;
        }, eventOptions);
    }
    
    private setupArmorInteraction(cardElement: HTMLElement, signal: AbortSignal): void {
        if (this.optionsService.options().ASUnifiedDamagePicker) {
            // Unified: tap anywhere in pips-wrapper shows combined damage picker
            const pipsWrapper = cardElement.querySelector('.pips-wrapper');
            if (!pipsWrapper) return;
            
            this.addTapHandler(pipsWrapper as HTMLElement, (evt) => {
                this.showDamagePicker(evt);
            }, signal);
        } else {
            // Separate: tap armor row or structure row shows individual picker
            const armorRow = cardElement.querySelector('[data-damage-type="armor"]');
            const structureRow = cardElement.querySelector('[data-damage-type="structure"]');
            
            if (armorRow) {
                this.addTapHandler(armorRow as HTMLElement, (evt) => {
                    this.showSingleDamagePicker(evt, 'armor');
                }, signal);
            }
            if (structureRow) {
                this.addTapHandler(structureRow as HTMLElement, (evt) => {
                    this.showSingleDamagePicker(evt, 'structure');
                }, signal);
            }
        }
    }
    
    private setupCriticalHitInteraction(cardElement: HTMLElement, signal: AbortSignal): void {
        const critRows = cardElement.querySelectorAll('[data-crit]');
        critRows.forEach(row => {
            const critKey = row.getAttribute('data-crit');
            if (!critKey) return;
            
            this.addTapHandler(row as HTMLElement, (evt) => {
                this.showCritPicker(evt, critKey, row as HTMLElement);
            }, signal);
        });
    }
    
    private setupVesselDamageTrackInteraction(cardElement: HTMLElement, signal: AbortSignal): void {
        const damageTracks = cardElement.querySelectorAll('.damage-track');
        damageTracks.forEach(track => {
            const trackType = track.getAttribute('data-damage-track');
            
            const pickerStyle = this.optionsService.options().pickerStyle;
        
            if (this.optionsService.options().ASUnifiedDamagePicker) {
                // Unified: any damage track shows combined damage dialog
                this.addTapHandler(track as HTMLElement, (evt) => {
                    if (pickerStyle === 'linear') {
                        this.showVesselDamageDialog();
                    } else {
                        this.showDamagePicker(evt);
                    }
                }, signal);
            } else {
                // Separate: each track shows its own damage dialog
                if (trackType === 'armor' || trackType === 'structure') {
                    this.addTapHandler(track as HTMLElement, (evt) => {
                    if (pickerStyle === 'linear') {
                        this.showVesselSingleDamageDialog(trackType);
                    } else {
                        this.showSingleDamagePicker(evt, trackType);
                    }
                    }, signal);
                }
            }
        });
    }
    
    private setupHeatInteraction(cardElement: HTMLElement, signal: AbortSignal): void {
        const heatTrack = cardElement.querySelector('.heat-track');
        if (!heatTrack) return;
        
        const heatLevels = heatTrack.querySelectorAll('.heat-level');
        heatLevels.forEach((level, index) => {
            this.addTapHandler(level as HTMLElement, () => {
                const unit = this.forceUnit();
                if (!unit) return;
                const committedHeat = unit.getState().heat();
                const pendingHeat = unit.getState().pendingHeat();
                const effectiveHeat = committedHeat + pendingHeat;
                
                if (effectiveHeat === index) {
                    // Toggle off - reset pending to 0
                    unit.setPendingHeat(0);
                } else {
                    // Set pending delta to reach this level
                    unit.setPendingHeat(index - committedHeat);
                }
                vibrate(10);
            }, signal);
        });
    }
    
    private showDamagePicker(event: PointerEvent): void {
        const unit = this.forceUnit();
        if (!unit) return;
        
        const maxArmor = unit.getUnit().as.Arm;
        const maxInternal = unit.getUnit().as.Str;
        const totalMax = maxArmor + maxInternal;
        
        const committedTotal = unit.getState().armor() + unit.getState().internal();
        const pendingTotal = unit.getState().pendingArmor() + unit.getState().pendingInternal();
        const currentTotalDamage = committedTotal + pendingTotal;
        const currentTotal = totalMax - currentTotalDamage;
        
        this.showNumericPicker({
            anchorElement: event.currentTarget as HTMLElement,
            event,
            title: 'DAMAGE',
            min: -currentTotalDamage,
            max: currentTotal,
            selected: 1,
            onPick: async (val: NumericPickerResult) => {
                this.removePicker();
                const deltaChange = val.value;
                const delta = pendingTotal + deltaChange;
                
                // Track pending internal before applying damage
                const previousPendingInternal = unit.getState().pendingInternal();
                
                unit.setPendingDamage(delta);
                vibrate(10);
                
                await this.handleDamageAutomations(unit, deltaChange, previousPendingInternal);
            },
            onCancel: () => this.removePicker()
        });
    }
    
    /**
     * Show a picker for a single damage type (armor or structure).
     * Used when ASUnifiedDamagePicker is false.
     */
    private showSingleDamagePicker(event: PointerEvent, type: 'armor' | 'structure'): void {
        const unit = this.forceUnit();
        if (!unit) return;
        
        const state = unit.getState();
        const isArmor = type === 'armor';
        const max = isArmor ? unit.getUnit().as.Arm : unit.getUnit().as.Str;
        const committed = isArmor ? state.armor() : state.internal();
        const pending = isArmor ? state.pendingArmor() : state.pendingInternal();
        const currentDamage = committed + pending;
        const remaining = max - currentDamage;
        
        this.showNumericPicker({
            anchorElement: event.currentTarget as HTMLElement,
            event,
            title: isArmor ? 'ARMOR' : 'STRUCTURE',
            min: -currentDamage,
            max: remaining,
            selected: 1,
            onPick: async (val: NumericPickerResult) => {
                this.removePicker();
                const deltaChange = val.value;
                const newPending = pending + deltaChange;
                const previousPendingInternal = state.pendingInternal();
                
                if (isArmor) {
                    unit.setPendingArmorDamage(newPending);
                } else {
                    unit.setPendingStructureDamage(newPending);
                    await this.handleDamageAutomations(unit, deltaChange, previousPendingInternal);
                }
                vibrate(10);
            },
            onCancel: () => this.removePicker()
        });
    }
    
    /**
     * Show a dialog to input damage amount for vessel layouts (unified armor+structure).
     */
    private async showVesselDamageDialog(): Promise<void> {
        const unit = this.forceUnit();
        if (!unit) return;
        
        const ref = this.dialogs.createDialog<number | null>(InputDialogComponent, {
            data: {
                title: 'DAMAGE',
                message: 'Enter damage amount (negative to heal):',
                inputType: 'number',
                minimumValue: - (unit.getState().armor() + unit.getState().pendingArmor() + unit.getState().internal() + unit.getState().pendingInternal()),
                maximumValue: unit.getUnit().as.Arm + unit.getUnit().as.Str,
                defaultValue: 0
            } as InputDialogData
        });
        
        const result = await firstValueFrom(ref.closed);
        if (result === null || result === undefined) return;
        
        const deltaChange = result as number;
        if (deltaChange === 0) return;
        
        const pendingTotal = unit.getState().pendingArmor() + unit.getState().pendingInternal();
        const delta = pendingTotal + deltaChange;
        
        const previousPendingInternal = unit.getState().pendingInternal();
        unit.setPendingDamage(delta);
        vibrate(10);
        
        await this.handleDamageAutomations(unit, deltaChange, previousPendingInternal);
    }
    
    /**
     * Show a dialog to input damage amount for a single type (armor or structure) on vessels.
     */
    private async showVesselSingleDamageDialog(type: 'armor' | 'structure'): Promise<void> {
        const unit = this.forceUnit();
        if (!unit) return;
        
        const state = unit.getState();
        const isArmor = type === 'armor';
        const title = isArmor ? 'ARMOR DAMAGE' : 'STRUCTURE DAMAGE';
        
        const ref = this.dialogs.createDialog<number | null>(InputDialogComponent, {
            data: {
                title,
                message: 'Enter damage amount (negative to heal):',
                inputType: 'number',
                minimumValue: - (isArmor ? state.armor() + state.pendingArmor() : state.internal() + state.pendingInternal()),
                maximumValue: isArmor ? unit.getUnit().as.Arm : unit.getUnit().as.Str,
                defaultValue: 0
            } as InputDialogData
        });
        
        const result = await firstValueFrom(ref.closed);
        if (result === null || result === undefined) return;
        
        const deltaChange = result as number;
        if (deltaChange === 0) return;
        
        const pending = isArmor ? state.pendingArmor() : state.pendingInternal();
        const newPending = pending + deltaChange;
        const previousPendingInternal = state.pendingInternal();
        
        if (isArmor) {
            unit.setPendingArmorDamage(newPending);
        } else {
            unit.setPendingStructureDamage(newPending);
            await this.handleDamageAutomations(unit, deltaChange, previousPendingInternal);
        }
        vibrate(10);
    }
    
    /**
     * Handle damage automations (critical hits, motive damage) after applying damage.
     * @param unit The unit that took damage
     * @param deltaChange The amount of damage change (positive = damage, negative = heal)
     * @param previousPendingInternal The pending internal before damage was applied
     */
    private async handleDamageAutomations(
        unit: ASForceUnit,
        deltaChange: number,
        previousPendingInternal: number
    ): Promise<void> {
        if (!this.optionsService.options().ASUseAutomations) return;
        if (deltaChange <= 0) return;
        
        const unitType = unit.getUnit().as.TP;
        if (unitType === 'CI') return; // Skip conventional infantry
        
        const newPendingInternal = unit.getState().pendingInternal();
        const tookStructureDamage = newPendingInternal > previousPendingInternal;
        const specials = unit.getUnit().as.specials || [];
        const hasBAR = specials.some(s => s.startsWith('BAR'));
        
        // BAR: Any time a unit with BAR suffers damage, a critical hit may occur
        if (hasBAR) {
            await this.onRollCriticalClick();
        }
        
        if (tookStructureDamage) {
            // Normal structure damage roll
            await this.onRollCriticalClick();
            
            // Industrial Meks get an extra roll on structure damage
            if (unitType === 'IM') {
                await this.onRollCriticalClick();
            }
        }
        
        // Check for motive damage roll for vehicles
        await this.checkMotiveDamage(unit);
    }
    
    /**
     * Check if motive damage roll should be triggered for a vehicle.
     * Vehicles must roll on the Motive Systems Damage Table when taking structure damage.
     */
    private async checkMotiveDamage(unit: ASForceUnit): Promise<void> {
        const unitType = unit.getUnit().as.TP;
        // Only vehicles (CV = Combat Vehicle, SV = Support Vehicle) need motive damage rolls
        if (unitType !== 'CV' && unitType !== 'SV') return;
        
        // Skip if unit will not have any movement left
        const movement = unit.previewMovementNoHeat();
        const entries = Object.entries(movement);
        if (entries.length === 0) return;
        if (entries.every(([, inches]) => inches <= 0)) return;
        
        const ref = this.dialogs.createDialog<void, MotiveDamageRollDialogComponent, MotiveDamageRollDialogData>(
            MotiveDamageRollDialogComponent,
            {
                data: { 
                    forceUnit: unit
                }
            }
        );
        await firstValueFrom(ref.closed);
    }

    private calculateRemainingCritHits(critKey: string): number | null {
        const unit = this.forceUnit();
        if (!unit) return null;
        if (critKey === 'mp' || critKey === 'motive2') {
            return this.calculateRemainingMotiveHits(unit, false);
        } else if (critKey === 'motive1') {
            return this.calculateRemainingMotiveHits(unit, true);
        } else if (critKey === 'weapons') {
            return this.calculateRemainingWeaponHits(unit);
        } else if (critKey === 'fire-control') {
            return 2; // Arbitrary number, no real limit, everytime we offer a +2 to the limit
        }
        return null;
    }

    /**
     * Calculate hits needed to reduce a damage value to 0 from the preview state.
     * Damage scale: 9 8 7 6 5 4 3 2 1 0* 0
     */
    private calculateRemainingWeaponHits(unit: ASForceUnit): number {
        const values = [unit.previewDamageS(), unit.previewDamageM(), unit.previewDamageL(), unit.previewDamageE()];
        let maxHits = 0;
        const hitsToReduceDamageToZero = (value: string): number => {
            if (!value) return 0;
            value = value.trim();
            if (value === '0' || value === '-' || value === '') return 0;
            if (value === '0*') return 1;
            const numericValue = parseInt(value, 10);
            if (isNaN(numericValue) || numericValue < 0) return 0;
            // Position in sequence: value + 1 (0=0, 1=0*, 2=1, etc.)
            // To get to 0, we need (position) hits
            return numericValue + 1;
        }
        for (const val of values) {
            const hits = hitsToReduceDamageToZero(val);
            if (hits > maxHits) maxHits = hits;
        }
        return maxHits;
    }

    /**
     * Calculate hits needed to reduce movement to 0 from the preview state.
     */
    private calculateRemainingMotiveHits(unit: ASForceUnit, isMotive1: boolean): number {
        // Determine max movement inches from preview state
        let maxInches = 0;
        for (const inches of Object.values(unit.previewMovementNoHeat())) {
            if (typeof inches === 'number' && inches > maxInches) {
                maxInches = inches;
            }
        }
        if (maxInches <= 0) return 0;
        let current = maxInches;
        let hits = 0;
        // Simulate Motive damage hits until movement reduced to 0
        if (isMotive1) {
            // Each hit reduces by 2, so max hits = ceil(maxInches / 2)
            hits = Math.ceil(maxInches / 2);
        } else {
            while (current > 0) {
                const halved = Math.floor(current / 2);
                const reduction = Math.max(2, current - halved);
                current = Math.max(0, current - reduction);
                hits++;
            }
        }
        return hits;
    }
    
    private showCritPicker(event: PointerEvent, critKey: string, rowElement: HTMLElement): void {
        const unit = this.forceUnit();
        if (!unit) return;
        
        const pips = rowElement.querySelectorAll('.pip');
        const pipsCount = pips.length;
        if (pipsCount === 0) return;
        
        const committedHits = unit.getCommittedCritHits(critKey);
        const pendingHits = unit.getPendingCritChange(critKey);
        const currentHits = committedHits + pendingHits;
        const remainingPips = pipsCount - currentHits;
        
        // Calculate the effective max based on actual crit effects
        let maxValue = remainingPips;
        const remainingCritHits = this.calculateRemainingCritHits(critKey);
        if (remainingCritHits !== null && remainingCritHits > maxValue) {
            maxValue = remainingCritHits;
        }
        
        this.showNumericPicker({
            anchorElement: rowElement,
            event,
            title: critKey.replace(/-/g, ' ').toUpperCase(),
            min: -currentHits,
            max: maxValue,
            threshold: remainingPips > 0 ? remainingPips : 0,
            selected: 1,
            onPick: (result: NumericPickerResult) => {
                this.removePicker();
                const delta = pendingHits + result.value;
                unit.setPendingCritHits(critKey, delta);
                vibrate(10);
            },
            onCancel: () => this.removePicker()
        });
    }
    
    /**
     * Show a numeric picker for selecting a value within a range.
     * Respects the user's pickerStyle preference:
     * - 'linear': Uses vertical linear picker with generated choices
     * - 'radial' or 'default': Uses rotating dial picker
     */
    private showNumericPicker(config: {
        anchorElement: HTMLElement;
        event?: PointerEvent;
        title: string;
        min: number;
        max: number;
        selected?: number;
        threshold?: number;
        onPick: (result: NumericPickerResult) => void;
        onCancel: () => void;
    }): void {
        this.removePicker();
        
        // Store anchor element for position updates on scroll
        this.pickerAnchorElement = config.anchorElement;
        const lightTheme = this.cardStyle() === 'colored';
        
        // Check user's picker style preference
        const pickerStyle = this.optionsService.options().pickerStyle;
        if (pickerStyle === 'linear') {
            // Use pointer position for linear picker, fall back to element center
            const position = config.event 
                ? { x: config.event.clientX, y: config.event.clientY }
                : this.calculatePickerPosition(config.anchorElement, true);
            
            // Convert numeric range to choices for linear picker (vertical mode)
            const choices: PickerChoice[] = [];
            for (let i = config.min; i <= config.max; i++) {
                choices.push({ 
                    label: i > 0 ? `+${i}` : String(i), 
                    value: i 
                });
            }
            
            this.pickerRef = this.pickerFactory.createLinearPicker({
                values: choices,
                selected: 0,
                position,
                title: config.title,
                lightTheme,
                horizontal: false,
                align: 'center',
                onPick: (choice: PickerChoice) => {
                    config.onPick({ value: choice.value as number });
                },
                onCancel: config.onCancel
            });
        } else {
            // Use rotating dial picker (default or radial) - use element center
            const position = this.calculatePickerPosition(config.anchorElement, true);
            this.pickerRef = this.pickerFactory.createNumericPicker({
                min: config.min,
                max: config.max,
                threshold: config.threshold,
                stepDegreeRange: [6, 48],
                stepRangeBounds: [25, 200],
                selected: config.selected ?? 1,
                position,
                title: config.title,
                lightTheme,
                onPick: config.onPick,
                onCancel: config.onCancel
            });
        }
    }
    
    /**
     * Show a choice picker (linear style) for selecting from a list of options.
     */
    private showLinearPicker(config: {
        anchorElement: HTMLElement;
        title: string;
        values: PickerChoice[];
        onPick: (val: PickerChoice) => void;
        onCancel: () => void;
    }): void {
        this.removePicker();
        
        this.pickerAnchorElement = config.anchorElement;
        const position = this.calculatePickerPosition(config.anchorElement, false);
        
        this.pickerRef = this.pickerFactory.createLinearPicker({
            values: config.values,
            position,
            title: config.title,
            lightTheme: this.cardStyle() === 'colored',
            align: 'top',
            horizontal: true,
            onPick: config.onPick,
            onCancel: config.onCancel
        });
    }
    
    private calculatePickerPosition(element: HTMLElement, centerVertically: boolean): PickerPosition {
        const rect = element.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: centerVertically ? rect.top + rect.height / 2 : rect.top
        };
    }
    
    private updatePickerPosition(): void {
        if (!this.pickerRef || !this.pickerAnchorElement) return;
        
        // Check if anchor element is still in the DOM and visible
        if (!document.body.contains(this.pickerAnchorElement)) {
            this.removePicker();
            return;
        }
        
        // Update picker position based on current anchor element position
        const position = this.calculatePickerPosition(this.pickerAnchorElement, true);
        this.pickerRef.setPosition(position);
    }
    
    private removePicker(): void {
        if (this.pickerRef) {
            this.pickerRef.destroy();
            this.pickerRef = null;
        }
        this.pickerAnchorElement = null;
    }
}
