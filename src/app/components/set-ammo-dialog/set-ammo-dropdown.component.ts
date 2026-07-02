/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, computed, type ComponentRef, ElementRef, inject, Injector, input, type OnDestroy, output, signal, viewChild } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import type { AmmoEquipment } from '../../models/equipment.model';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import type { AmmoSelectionStatus } from '../../utils/ammo-validity.util';
import { DropdownPointerActivationGuard, nextDropdownTarget, nextDropdownTargetInCurrentLane, scrollActiveOptionIntoView } from '../../utils/dropdown-interaction.utils';
import { AdvancementTimelineComponent, getEquipmentAdvancementTimeline, type EquipmentAdvancementTimeline } from './advancement-timeline.component';

interface AmmoDropdownOption {
    ammo: AmmoEquipment;
    label: string;
    _searchText: string;
    advancement: EquipmentAdvancementTimeline;
    selectionStatus: AmmoSelectionStatus;
    selectionIssueText: string;
}

type AmmoDropdownActiveTarget = 'entry' | 'details';

interface AmmoDropdownActiveOption {
    internalName: string;
    target: AmmoDropdownActiveTarget;
}

interface AmmoDropdownPointerHoverEvent {
    internalName: string;
    target: AmmoDropdownActiveTarget;
    clientX: number;
    clientY: number;
}

@Component({
    selector: 'set-ammo-dropdown-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AdvancementTimelineComponent],
    template: `
        <div
            class="dropdown-shell glass has-shadow framed-borders"
            [id]="optionsId()"
            role="listbox"
            [attr.aria-label]="label()"
            [attr.aria-activedescendant]="activeOptionId()"
        >
            <div class="header">
                <input
                    class="bt-input"
                    type="text"
                    placeholder="Search ammo..."
                    [value]="searchText()"
                    (input)="onSearch($any($event.target).value)" />
                <button
                    class="expand-btn master-expand-btn"
                    type="button"
                    [disabled]="filteredExpandableOptions().length === 0"
                    [class.expanded]="allFilteredOptionsExpanded()"
                    [title]="allFilteredOptionsExpanded() ? 'Hide all details' : 'Show all details'"
                    (click)="toggleAllExpanded($event)">
                    <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M3 1l5 4-5 4z"/>
                    </svg>
                </button>
            </div>
            <div class="dropdown-panel" data-scroll-container>
            @for (option of filteredOptions(); let optionIndex = $index; track option.ammo.internalName) {
                <div
                    class="ammo-dropdown-option"
                    role="option"
                    tabindex="-1"
                    [id]="optionId(optionIndex)"
                    [class.active]="option.ammo.internalName === value()"
                    [class.keyboard-active]="option.ammo.internalName === activeValue()"
                    [class.selection-issue]="option.selectionIssueText"
                    [attr.title]="option.selectionIssueText || null"
                    [attr.aria-selected]="option.ammo.internalName === value()"
                    (click)="selectOption(option)"
                    (pointerenter)="onOptionPointerHover(option, 'entry', $event)"
                    (pointermove)="onOptionPointerHover(option, 'entry', $event)"
                >
                    <span class="ammo-dropdown-option-header">
                        <span class="ammo-dropdown-option-name">{{ option.label }}</span>
                        @if (optionHasDetails(option)) {
                            <button
                                class="expand-btn"
                                type="button"
                                [id]="optionTargetId(optionIndex, 'details')"
                                [class.active]="isActiveTarget(option, 'details')"
                                [class.expanded]="isOptionExpanded(option)"
                                title="Show details"
                                (pointerenter)="onOptionPointerHover(option, 'details', $event)"
                                (pointermove)="onOptionPointerHover(option, 'details', $event)"
                                (click)="toggleOptionExpanded(option, $event)">
                                <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                                    <path d="M3 1l5 4-5 4z"/>
                                </svg>
                            </button>
                        }
                    </span>
                    @if (optionHasDetails(option) && isOptionExpanded(option)) {
                        <span class="ammo-dropdown-details">
                            @if (option.selectionStatus.issues.length > 0) {
                                <span class="ammo-selection-issues">
                                    @for (issue of option.selectionStatus.issues; track issue.reason) {
                                        <span class="ammo-selection-issue">{{ issue.message }}</span>
                                    }
                                </span>
                            }
                            @if (option.advancement.timelines.length > 0) {
                                <advancement-timeline [slots]="option.advancement.slots" [timelines]="option.advancement.timelines" />
                            }
                        </span>
                    }
                </div>
            }
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            min-height: 0;
        }

        .dropdown-shell {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
        }

        .dropdown-panel {
            box-sizing: border-box;
            overflow-y: auto;
            flex: 1 1 auto;
            min-height: 0;
        }

        .header {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
            padding: 4px 6px;
            border-bottom: 1px solid var(--border-color);

            .bt-input {
                width: 100%;
            }
        }

        .ammo-dropdown-option {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            width: 100%;
            padding: 6px 4px;
            border: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            border-left: 3px solid transparent;
            background: transparent;
            color: var(--text-color);
            text-align: left;
            cursor: pointer;
            box-sizing: border-box;
        }

        .ammo-dropdown-option:last-child {
            border-bottom: 0;
        }

        .ammo-dropdown-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .ammo-dropdown-option.keyboard-active:not(.active) {
            background: rgba(255, 255, 255, 0.1);
        }

        .ammo-dropdown-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);

            &:hover {
                background: var(--bt-yellow-background-bright-transparent);
            }
        }

        .ammo-dropdown-option.selection-issue {
            border-left-color: rgba(221, 0, 0, 0.7);
        }

        .ammo-dropdown-option.selection-issue:hover {
            background: rgba(221, 0, 0, 0.08);
        }

        .ammo-dropdown-option.active.selection-issue {
            background: rgba(221, 0, 0, 0.14);
            border-left-color: #dd0000;

            &:hover {
                background: rgba(221, 0, 0, 0.2);
            }
        }

        .ammo-dropdown-option.selection-issue .ammo-dropdown-option-name {
            color: #ff7373;
        }

        .ammo-dropdown-option-header {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }

        .ammo-dropdown-option-name {
            display: block;
            flex: 1 1 auto;
            min-width: 0;
            white-space: normal;
            overflow-wrap: normal;
            word-break: normal;
            font-weight: 600;
            line-height: 1.2;
        }

        .ammo-dropdown-details {
            display: grid;
            gap: 8px;
        }

        .ammo-selection-issues {
            display: grid;
            gap: 4px;
        }

        .ammo-selection-issue {
            display: block;
            color: red;
            font-size: 0.86em;
            padding-left: 4px;
        }

        .expand-btn {
            flex-shrink: 0;
            background: none;
            border: none;
            color: var(--text-color-tertiary);
            cursor: pointer;
            padding: 8px 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s;
        }

        .expand-btn:hover:not(:disabled) {
            color: var(--text-color);
        }

        .expand-btn.active {
            color: var(--text-color);
            background: rgba(255, 255, 255, 0.12);
        }

        .expand-btn:disabled {
            cursor: default;
            opacity: 0.35;
        }

        .expand-btn svg {
            transition: transform 0.2s;
        }

        .expand-btn.expanded svg {
            transform: rotate(90deg);
        }

        .master-expand-btn {
            padding: 7px 8px;
        }
    `]
})
class SetAmmoDropdownPanelComponent {
    private readonly overlayManager = inject(OverlayManagerService);

    readonly options = input<readonly AmmoDropdownOption[]>([]);
    readonly value = input('');
    readonly label = input('Select ammo');
    readonly optionsId = input('');
    readonly activeValue = input('');
    readonly activeTarget = input<AmmoDropdownActiveTarget>('entry');

    readonly selected = output<string>();
    readonly pointerHovered = output<AmmoDropdownPointerHoverEvent>();

    readonly expandedOptionNames = signal<ReadonlySet<string>>(new Set<string>());
    readonly searchText = signal<string>('');

    filteredOptions = computed<AmmoDropdownOption[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);

        const filtered = tokens.length === 0
            ? [...this.options()]
            : this.options().filter(option => {
                const hay = option._searchText || '';
                return tokens.every(t => hay.indexOf(t) !== -1);
            });

        return filtered;
    });

    readonly filteredExpandableOptions = computed<AmmoDropdownOption[]>(() => {
        return this.filteredOptions().filter(option => this.optionHasDetails(option));
    });

    readonly allFilteredOptionsExpanded = computed(() => {
        const expandableOptions = this.filteredExpandableOptions();
        if (expandableOptions.length === 0) return false;

        const expandedOptionNames = this.expandedOptionNames();
        return expandableOptions.every(option => expandedOptionNames.has(option.ammo.internalName));
    });

    readonly activeOptionId = computed(() => {
        const activeIndex = this.visibleOptionTargets().findIndex(option => this.matchesActiveTarget(option));
        return activeIndex >= 0 ? this.optionTargetIdForActiveIndex(activeIndex) : '';
    });

    readonly visibleOptionTargets = computed<AmmoDropdownActiveOption[]>(() => {
        return this.filteredOptions().flatMap(option => this.optionTargets(option));
    });

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }

    optionTargetId(index: number, target: AmmoDropdownActiveTarget): string {
        return target === 'entry' ? this.optionId(index) : `${this.optionId(index)}-${target}`;
    }

    selectOption(option: AmmoDropdownOption): void {
        this.selected.emit(option.ammo.internalName);
    }

    onOptionPointerHover(option: AmmoDropdownOption, target: AmmoDropdownActiveTarget, event: PointerEvent): void {
        if (target === 'details') {
            event.stopPropagation();
        }
        this.pointerHovered.emit({
            internalName: option.ammo.internalName,
            target,
            clientX: event.clientX,
            clientY: event.clientY,
        });
    }

    isActiveTarget(option: AmmoDropdownOption, target: AmmoDropdownActiveTarget): boolean {
        return option.ammo.internalName === this.activeValue() && this.activeTarget() === target;
    }

    isOptionExpanded(option: AmmoDropdownOption): boolean {
        return this.expandedOptionNames().has(option.ammo.internalName);
    }

    optionHasDetails(option: AmmoDropdownOption): boolean {
        return option.advancement.timelines.length > 0 || option.selectionStatus.issues.length > 0;
    }

    toggleOptionExpanded(option: AmmoDropdownOption, event: MouseEvent): void {
        event.stopPropagation();
        this.toggleExpandedName(option.ammo.internalName);
    }

    toggleExpandedName(internalName: string): void {
        this.expandedOptionNames.update(current => {
            const next = new Set(current);
            if (next.has(internalName)) {
                next.delete(internalName);
            } else {
                next.add(internalName);
            }
            return next;
        });
    }

    toggleAllExpanded(event: MouseEvent): void {
        event.stopPropagation();
        const expandableOptions = this.filteredExpandableOptions();
        if (expandableOptions.length === 0) return;

        const shouldCollapse = this.allFilteredOptionsExpanded();
        this.expandedOptionNames.update(current => {
            const next = new Set(current);
            for (const option of expandableOptions) {
                if (shouldCollapse) {
                    next.delete(option.ammo.internalName);
                } else {
                    next.add(option.ammo.internalName);
                }
            }
            return next;
        });
    }
    
    onSearch(text: string) {
        this.searchText.set(text);
    }

    private optionTargets(option: AmmoDropdownOption): AmmoDropdownActiveOption[] {
        return this.optionHasDetails(option)
            ? [
                { internalName: option.ammo.internalName, target: 'entry' },
                { internalName: option.ammo.internalName, target: 'details' },
            ]
            : [{ internalName: option.ammo.internalName, target: 'entry' }];
    }

    private matchesActiveTarget(option: AmmoDropdownActiveOption): boolean {
        return option.internalName === this.activeValue() && option.target === this.activeTarget();
    }

    private optionTargetIdForActiveIndex(activeIndex: number): string {
        const precedingDetailsTargets = this.visibleOptionTargets()
            .slice(0, activeIndex + 1)
            .filter(option => option.target === 'details')
            .length;
        const rowIndex = activeIndex - precedingDetailsTargets;
        const activeTarget = this.visibleOptionTargets()[activeIndex]?.target ?? 'entry';
        return this.optionTargetId(rowIndex, activeTarget);
    }
}

@Component({
    selector: 'set-ammo-dropdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="set-ammo-dropdown">
            <button
                class="field-input set-ammo-dropdown-trigger"
                #triggerEl
                type="button"
                [id]="controlId()"
                aria-haspopup="listbox"
                [attr.aria-controls]="optionsId()"
                [attr.aria-expanded]="open()"
                [attr.aria-label]="label()"
                [class.selection-issue]="selectedOption()?.selectionIssueText"
                [attr.title]="selectedOption()?.selectionIssueText || null"
                [disabled]="options().length === 0"
                (click)="toggle()"
                (keydown)="onTriggerKeydown($event)"
            >
                <span class="set-ammo-dropdown-label">{{ selectedLabel() }}</span>
                <span class="set-ammo-dropdown-measure" aria-hidden="true">
                    @for (option of optionItems(); track option.ammo.internalName) {
                        <span class="set-ammo-dropdown-measure-option">{{ option.label }}</span>
                    }
                </span>
                <span class="set-ammo-dropdown-arrow" aria-hidden="true">\u25be</span>
            </button>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            min-width: 0;
            width: max-content;
            max-width: 100%;
        }

        .set-ammo-dropdown {
            min-width: 0;
            width: 100%;
            height: 100%;
        }

        .set-ammo-dropdown-trigger {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            width: 100%;
            height: 100%;
            gap: 4px;
            text-align: left;
            background: transparent;
            border: 0;
            cursor: pointer;
            color: inherit;
            font-weight: inherit;
            border-bottom: 1px solid #666;
        }

        .set-ammo-dropdown-trigger.selection-issue {
            color: #ff7373;
            border-bottom-color: #dd0000;
        }

        .set-ammo-dropdown-label {
            grid-column: 1;
            grid-row: 1;
            min-width: 0;
            white-space: normal;
            overflow-wrap: normal;
            word-break: normal;
        }

        .set-ammo-dropdown-measure {
            display: grid;
            grid-column: 1;
            grid-row: 1;
            min-width: 0;
            overflow: hidden;
            visibility: hidden;
            white-space: nowrap;
            pointer-events: none;
            line-height: 0;
        }

        .set-ammo-dropdown-measure-option {
            grid-column: 1;
            grid-row: 1;
            white-space: nowrap;
        }

        .set-ammo-dropdown-arrow {
            grid-column: 2;
            grid-row: 1;
            color: inherit;
            font-size: 1.1em;
            line-height: 0;
        }
    `]
})
export class SetAmmoDropdownComponent implements OnDestroy {
    private static nextId = 0;
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly pointerActivationGuard = new DropdownPointerActivationGuard();
    private readonly instanceId = `setAmmoDropdown-${SetAmmoDropdownComponent.nextId++}`;
    private readonly overlayKey = `${this.instanceId}-overlay`;
    private readonly triggerEl = viewChild<ElementRef<HTMLButtonElement>>('triggerEl');
    private panelRef: ComponentRef<SetAmmoDropdownPanelComponent> | null = null;
    private closedSubscription: { unsubscribe(): void } | null = null;

    readonly options = input<readonly AmmoEquipment[]>([]);
    readonly value = input('');
    readonly label = input('Select ammo');
    readonly placeholder = input('Select');
    readonly controlId = input(this.instanceId);
    readonly currentAmmo = input.required<AmmoEquipment>();
    readonly originalAmmo = input.required<AmmoEquipment>();
    readonly ammoSelectionStatus = input<Record<string, AmmoSelectionStatus>>({});

    readonly valueChange = output<string>();

    readonly open = signal(false);
    readonly activeIndex = signal(0);
    readonly activeTarget = signal<AmmoDropdownActiveTarget>('entry');
    readonly optionItems = computed<AmmoDropdownOption[]>(() => this.options().map(ammo => {
        const displayName = getAmmoDisplayText(ammo, this.options(), this.currentAmmo(), this.originalAmmo());
        const searchText = displayName.toLocaleLowerCase();
        const selectionStatus = this.ammoSelectionStatus()[ammo.internalName] ?? { issues: [] };
        return {
            ammo,
            label: displayName,
            _searchText: `${searchText} ${searchText.replace(/[^a-zA-Z0-9]/g, "")}`,
            advancement: getEquipmentAdvancementTimeline(ammo),
            selectionStatus,
            selectionIssueText: selectionStatus.issues.map(issue => issue.message).join('\n'),
        }
    }));
    readonly optionsId = computed(() => `${this.controlId()}-options`);
    readonly activeValue = computed(() => this.optionItems()[this.activeIndex()]?.ammo.internalName ?? '');
    readonly selectedOption = computed(() => this.optionItems().find(option => option.ammo.internalName === this.value()) ?? null);
    readonly selectedLabel = computed(() => this.selectedOption()?.label ?? this.placeholder());

    toggle(): void {
        if (this.open()) {
            this.closeDropdown();
            return;
        }
        this.openDropdown();
    }

    openDropdown(): void {
        if (this.open()) return;
        this.pointerActivationGuard.suppress();
        this.activeIndex.set(this.selectedIndex());
        this.activeTarget.set('entry');
        this.open.set(true);
        this.attachOverlay();
    }

    onTriggerKeydown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.openDropdown();
                this.moveActiveOptionInCurrentLane(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.openDropdown();
                this.moveActiveOptionInCurrentLane(-1);
                break;
            case 'Home':
                event.preventDefault();
                this.openDropdown();
                this.activateKeyboardOption(0);
                break;
            case 'End':
                event.preventDefault();
                this.openDropdown();
                this.activateKeyboardOption(this.visibleOptionTargets().length - 1);
                break;
            case 'Tab':
                if (!this.open()) break;
                event.preventDefault();
                this.moveActiveOptionSequentially(event.shiftKey ? -1 : 1);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                if (this.open()) {
                    this.selectActiveOption();
                } else {
                    this.openDropdown();
                }
                break;
            case 'Escape':
                event.preventDefault();
                this.closeDropdown();
                break;
        }
    }

    activatePointerOption(event: AmmoDropdownPointerHoverEvent): void {
        if (this.pointerActivationGuard.shouldIgnore(event)) return;

        const index = this.optionItems().findIndex(option => option.ammo.internalName === event.internalName);
        if (index < 0 || (index === this.activeIndex() && event.target === this.activeTarget())) return;

        this.activeIndex.set(index);
        this.activeTarget.set(event.target);
        this.syncPanelInputs(false);
    }

    selectValue(value: string): void {
        this.valueChange.emit(value);
        this.closeDropdown();
    }

    ngOnDestroy(): void {
        this.closeDropdown();
    }

    private closeDropdown(): void {
        this.open.set(false);
        this.closedSubscription?.unsubscribe();
        this.closedSubscription = null;
        this.panelRef = null;
        this.overlayManager.closeManagedOverlay(this.overlayKey);
    }

    private attachOverlay(): void {
        const trigger = this.triggerEl();
        if (!trigger) return;

        const portal = new ComponentPortal(SetAmmoDropdownPanelComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(
            this.overlayKey,
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'set-ammo-dropdown-overlay',
                matchTriggerWidth: true,
                anchorActiveSelector: '.ammo-dropdown-option.active'
            }
        );

        this.panelRef = componentRef;
        this.syncPanelInputs();
        componentRef.instance.selected.subscribe(value => this.selectValue(value));
        componentRef.instance.pointerHovered.subscribe(event => this.activatePointerOption(event));
        this.closedSubscription = closed.subscribe(() => {
            this.open.set(false);
            this.panelRef = null;
            this.closedSubscription = null;
        });
    }

    private syncPanelInputs(scrollActiveIntoView = true): void {
        const panelRef = this.panelRef;
        if (!panelRef) return;
        panelRef.setInput('options', this.optionItems());
        panelRef.setInput('value', this.value());
        panelRef.setInput('label', this.label());
        panelRef.setInput('optionsId', this.optionsId());
        panelRef.setInput('activeValue', this.activeValue());
        panelRef.setInput('activeTarget', this.activeTarget());
        panelRef.changeDetectorRef.detectChanges();
        if (scrollActiveIntoView) {
            this.scrollActiveOptionIntoView(panelRef.location.nativeElement as HTMLElement);
        }
    }

    private scrollActiveOptionIntoView(panelHost: HTMLElement): void {
        scrollActiveOptionIntoView(panelHost, '[data-scroll-container]', '.ammo-dropdown-option.keyboard-active');
    }

    private selectedIndex(): number {
        const selectedIndex = this.optionItems().findIndex(option => option.ammo.internalName === this.value());
        return Math.max(0, selectedIndex);
    }

    private moveActiveOptionInCurrentLane(delta: number): void {
        const targets = this.visibleOptionTargets();
        const activeTarget = nextDropdownTargetInCurrentLane(
            targets,
            this.activeTarget(),
            target => this.matchesActiveTarget(target),
            delta,
        );
        if (!activeTarget) return;

        this.activateKeyboardTarget(activeTarget);
    }

    private moveActiveOptionSequentially(delta: number): void {
        const activeTarget = nextDropdownTarget(
            this.visibleOptionTargets(),
            target => this.matchesActiveTarget(target),
            delta,
        );
        if (!activeTarget) return;

        this.activateKeyboardTarget(activeTarget);
    }

    private activateKeyboardOption(index: number): void {
        const targets = this.visibleOptionTargets();
        if (targets.length === 0) return;

        this.pointerActivationGuard.suppress();
        const activeTarget = targets[Math.max(0, Math.min(index, targets.length - 1))];
        this.activateKeyboardTarget(activeTarget);
    }

    private activateKeyboardTarget(activeTarget: AmmoDropdownActiveOption): void {
        const optionIndex = this.optionItems().findIndex(option => option.ammo.internalName === activeTarget.internalName);
        if (optionIndex < 0) return;

        this.pointerActivationGuard.suppress();
        this.activeIndex.set(optionIndex);
        this.activeTarget.set(activeTarget.target);
        this.syncPanelInputs();
    }

    private selectActiveOption(): void {
        const activeOption = this.optionItems()[this.activeIndex()];
        if (!activeOption) return;

        if (this.activeTarget() === 'details') {
            this.toggleActiveOptionDetails(activeOption.ammo.internalName);
            return;
        }

        this.selectValue(activeOption.ammo.internalName);
    }

    private visibleOptionTargets(): AmmoDropdownActiveOption[] {
        return this.panelRef?.instance.visibleOptionTargets() ?? this.allOptionTargets();
    }

    private allOptionTargets(): AmmoDropdownActiveOption[] {
        return this.optionItems().flatMap(option => option.advancement.timelines.length > 0
            ? [
                { internalName: option.ammo.internalName, target: 'entry' as const },
                { internalName: option.ammo.internalName, target: 'details' as const },
            ]
            : [{ internalName: option.ammo.internalName, target: 'entry' as const }]);
    }

    private matchesActiveTarget(target: AmmoDropdownActiveOption): boolean {
        return target.internalName === this.activeValue() && target.target === this.activeTarget();
    }

    private toggleActiveOptionDetails(internalName: string): void {
        const panelRef = this.panelRef;
        if (!panelRef) return;

        panelRef.instance.toggleExpandedName(internalName);
        panelRef.changeDetectorRef.detectChanges();
        this.syncPanelInputs(false);
    }
}

export function getAmmoDisplayText(ammo: AmmoEquipment, options: readonly AmmoEquipment[], currentAmmo: AmmoEquipment, originalAmmo: AmmoEquipment): string {
    const mixedTechBase = options.some(option => option.techBase === 'Clan') && options.some(option => option.techBase === 'IS');
    const techPrefix = mixedTechBase && ammo.techBase !== 'All'
        ? `[${ammo.techBase === 'IS' ? 'IS' : ammo.techBase === 'Clan' ? 'CL' : '*'}] `
        : '';
    const originalMarker = options.length > 1
        && ammo.internalName === originalAmmo.internalName
        && originalAmmo.internalName !== currentAmmo.internalName
        ? ' \u2605'
        : '';
    return `${techPrefix}${ammo.name}${originalMarker}`;
}