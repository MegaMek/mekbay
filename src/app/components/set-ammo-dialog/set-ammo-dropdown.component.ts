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
import { DropdownPointerActivationGuard, scrollActiveOptionIntoView } from '../../utils/dropdown-interaction.utils';
import { AdvancementTimelineComponent, getEquipmentAdvancementTimeline, type EquipmentAdvancementTimeline } from './advancement-timeline.component';

interface AmmoDropdownOption {
    ammo: AmmoEquipment;
    label: string;
    _searchText: string;
    advancement: EquipmentAdvancementTimeline;
    unavailable: boolean;
}

interface AmmoDropdownPointerHoverEvent {
    internalName: string;
    clientX: number;
    clientY: number;
}

@Component({
    selector: 'set-ammo-dropdown-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AdvancementTimelineComponent],
    host: {
        '[style.font-size]': 'fontSize() || null'
    },
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
            </div>
            <div class="dropdown-panel" data-scroll-container>
            @for (option of filteredOptions(); let optionIndex = $index; track option.ammo.internalName) {
                <button
                    class="set-ammo-dropdown-option"
                    type="button"
                    role="option"
                    [id]="optionId(optionIndex)"
                    [class.active]="option.ammo.internalName === activeValue()"
                    [class.unavailable]="option.unavailable"
                    [attr.aria-selected]="option.ammo.internalName === value()"
                    (click)="selectOption(option)"
                    (pointerenter)="onOptionPointerHover(option, $event)"
                    (pointermove)="onOptionPointerHover(option, $event)"
                >
                    <span class="set-ammo-dropdown-option-name">{{ option.label }}</span>
                    <span class="set-ammo-dropdown-details" [class.visible]="expanded()">
                        @if (option.advancement.timelines.length > 0) {
                            <advancement-timeline [slots]="option.advancement.slots" [timelines]="option.advancement.timelines" />
                        }
                        <!-- @for (group of option.detailGroups; track group.group) {
                            @if (group.group === 'History') {
                                <advancement-timeline density="compact" [slots]="group.timelineSlots" [timelines]="group.timelines" />
                            } @else {
                                <span class="set-ammo-dropdown-spec-grid">
                                    @for (detail of group.items; track detail.label) {
                                        <span class="set-ammo-dropdown-spec">
                                            <span class="set-ammo-dropdown-spec-label">{{ detail.label }}</span>
                                            <span class="set-ammo-dropdown-spec-value">{{ detail.value }}</span>
                                        </span>
                                    }
                                </span>
                            }
                        } -->
                    </span>
                </button>
            }
            </div>
            <div class="footer">
                <button class="bt-button" (click)="toggleExpanded()">{{ expanded() ? "HIDE DETAILS" : "SHOW DETAILS" }}</button>
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
            flex: 0 0 auto;
            padding: 4px 6px;
            border-bottom: 1px solid var(--border-color);

            .bt-input {
                width: 100%;
            }
        }

        .footer {
            flex: 0 0 auto;
            padding: 4px 6px;
            border-top: 1px solid var(--border-color);

            .bt-button {
                width: 100%;
            }
        }

        .set-ammo-dropdown-option {
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
        }

        .set-ammo-dropdown-option:last-child {
            border-bottom: 0;
        }

        .set-ammo-dropdown-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .set-ammo-dropdown-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);

            &:hover {
                background: var(--bt-yellow-background-bright-transparent);
            }
        }

        .set-ammo-dropdown-option.unavailable {
            border-left-color: rgba(221, 0, 0, 0.7);
        }

        .set-ammo-dropdown-option.unavailable:hover {
            background: rgba(221, 0, 0, 0.08);
        }

        .set-ammo-dropdown-option.active.unavailable {
            background: rgba(221, 0, 0, 0.14);
            border-left-color: #dd0000;

            &:hover {
                background: rgba(221, 0, 0, 0.2);
            }
        }

        .set-ammo-dropdown-option.unavailable .set-ammo-dropdown-option-name {
            color: #ff7373;
        }

        .set-ammo-dropdown-option-name {
            display: block;
            min-width: 0;
            white-space: normal;
            overflow-wrap: normal;
            word-break: normal;
            font-weight: 600;
            line-height: 1.2;
        }

        .set-ammo-dropdown-details {
            display: none;
            gap: 8px;

            &.visible {
                display: grid;
            }
        }

        .set-ammo-dropdown-spec-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
            gap: 6px;
        }

        .set-ammo-dropdown-spec {
            display: grid;
            gap: 2px;
            min-width: 0;
            padding: 5px 7px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(0, 0, 0, 0.18);
        }

        .set-ammo-dropdown-spec-label {
            color: var(--text-color-secondary);
            font-size: 0.72em;
            font-weight: 700;
            line-height: 1.1;
            text-transform: uppercase;
        }

        .set-ammo-dropdown-spec-value {
            min-width: 0;
            color: var(--text-color);
            font-size: 0.84em;
            line-height: 1.2;
            overflow-wrap: anywhere;
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
    readonly fontSize = input('');

    readonly selected = output<string>();
    readonly pointerHovered = output<AmmoDropdownPointerHoverEvent>();

    readonly expanded = signal<boolean>(false);
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

    readonly activeOptionId = computed(() => {
        const activeIndex = this.filteredOptions().findIndex(option => option.ammo.internalName === this.activeValue());
        return activeIndex >= 0 ? this.optionId(activeIndex) : '';
    });

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }

    selectOption(option: AmmoDropdownOption): void {
        this.selected.emit(option.ammo.internalName);
    }

    onOptionPointerHover(option: AmmoDropdownOption, event: PointerEvent): void {
        this.pointerHovered.emit({
            internalName: option.ammo.internalName,
            clientX: event.clientX,
            clientY: event.clientY,
        });
    }

    toggleExpanded() {
        this.expanded.update(v => !v);
        this.overlayManager.repositionAll();
    }
    
    onSearch(text: string) {
        this.searchText.set(text);
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
                [class.unavailable]="selectedOption()?.unavailable"
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

        .set-ammo-dropdown-trigger.unavailable {
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
    readonly unavailableAmmo = input<Record<string, boolean>>({});

    readonly valueChange = output<string>();

    readonly open = signal(false);
    readonly activeIndex = signal(0);
    readonly mixedTechBase = computed(() => this.options().some(ammo => ammo.techBase === 'Clan') && this.options().some(ammo => ammo.techBase === 'IS'));
    readonly optionItems = computed<AmmoDropdownOption[]>(() => this.options().map(ammo => {
        const displayName = getAmmoDisplayText(ammo, this.options(), this.currentAmmo(), this.originalAmmo());
        const searchText = displayName.toLocaleLowerCase();
        return {
            ammo,
            label: displayName,
            _searchText: `${searchText} ${searchText.replace(/[^a-zA-Z0-9]/g, "")}`,
            advancement: getEquipmentAdvancementTimeline(ammo),
            unavailable: this.unavailableAmmo()[ammo.internalName] ?? false,
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
        this.open.set(true);
        this.attachOverlay();
    }

    onTriggerKeydown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.openDropdown();
                this.moveActiveOption(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.openDropdown();
                this.moveActiveOption(-1);
                break;
            case 'Home':
                event.preventDefault();
                this.openDropdown();
                this.activateKeyboardOption(0);
                break;
            case 'End':
                event.preventDefault();
                this.openDropdown();
                this.activateKeyboardOption(this.optionItems().length - 1);
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
        if (index < 0 || index === this.activeIndex()) return;

        this.activeIndex.set(index);
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
                anchorActiveSelector: '.set-ammo-dropdown-option.active'
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
        panelRef.setInput('fontSize', this.triggerFontSize());
        panelRef.changeDetectorRef.detectChanges();
        if (scrollActiveIntoView) {
            this.scrollActiveOptionIntoView(panelRef.location.nativeElement as HTMLElement);
        }
    }

    private triggerFontSize(): string {
        const trigger = this.triggerEl();
        return trigger ? getComputedStyle(trigger.nativeElement).fontSize : '';
    }

    private scrollActiveOptionIntoView(panelHost: HTMLElement): void {
        scrollActiveOptionIntoView(panelHost, '[data-scroll-container]', '.set-ammo-dropdown-option.active');
    }

    private selectedIndex(): number {
        const selectedIndex = this.optionItems().findIndex(option => option.ammo.internalName === this.value());
        return Math.max(0, selectedIndex);
    }

    private moveActiveOption(delta: number): void {
        const options = this.optionItems();
        if (options.length === 0) return;
        this.activateKeyboardOption((this.activeIndex() + delta + options.length) % options.length);
    }

    private activateKeyboardOption(index: number): void {
        const options = this.optionItems();
        if (options.length === 0) return;

        this.pointerActivationGuard.suppress();
        this.activeIndex.set(Math.max(0, Math.min(index, options.length - 1)));
        this.syncPanelInputs();
    }

    private selectActiveOption(): void {
        const activeOption = this.optionItems()[this.activeIndex()];
        if (activeOption) {
            this.selectValue(activeOption.ammo.internalName);
        }
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