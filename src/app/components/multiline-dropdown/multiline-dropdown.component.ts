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

import { ChangeDetectionStrategy, Component, computed, type ComponentRef, ElementRef, inject, Injector, input, output, signal, type OnDestroy, viewChild } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { OverlayManagerService } from '../../services/overlay-manager.service';

/*
 * Author: Drake
 * Component for a dropdown that supports multiline option labels and keyboard navigation.
 */
export interface MultilineDropdownOption {
    value: string;
    label: string;
    disabled?: boolean;
    destroyed?: boolean;
}

@Component({
    selector: 'multiline-dropdown-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[style.font-size]': 'fontSize() || null'
    },
    template: `
        <div
            class="multiline-dropdown-options glass has-shadow framed-borders"
            data-scroll-container
            [id]="optionsId()"
            role="listbox"
            [attr.aria-label]="label()"
            [attr.aria-activedescendant]="activeOptionId()"
        >
            @for (option of options(); let optionIndex = $index; track option.value) {
                <button
                    class="multiline-dropdown-option"
                    type="button"
                    role="option"
                    [id]="optionId(optionIndex)"
                    [class.active]="optionIndex === activeIndex()"
                    [disabled]="option.disabled"
                    [class.destroyed]="option.destroyed"
                    [attr.aria-selected]="option.value === value()"
                    (click)="selectOption(option)"
                    (mouseenter)="hovered.emit(optionIndex)"
                >
                    <span class="multiline-dropdown-option-label">{{ option.label }}</span>
                </button>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            min-height: 0;
        }

        .multiline-dropdown-options {
            box-sizing: border-box;
            width: 100%;
            max-height: 90dvh;
            overflow-y: auto;
        }

        .multiline-dropdown-option {
            display: block;
            width: 100%;
            padding: 6px;
            border: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            border-left: 3px solid transparent;
            background: transparent;
            color: var(--text-color);
            font: inherit;
            text-align: left;
            cursor: pointer;
        }

        .multiline-dropdown-option:last-child {
            border-bottom: 0;
        }

        .multiline-dropdown-option:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.1);
        }

        .multiline-dropdown-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);

            &:hover {
                background: var(--bt-yellow-background-bright-transparent);
            }
        }

        .multiline-dropdown-option:disabled {
            color: var(--text-color-tertiary);
            cursor: not-allowed;
        }
        
        .multiline-dropdown-option.destroyed {
            color: var(--damage-color);
        }

        .multiline-dropdown-option-label {
            display: block;
            min-width: 0;
            white-space: normal;
            overflow-wrap: normal;
            word-break: normal;
        }
    `]
})
class MultilineDropdownPanelComponent {
    readonly options = input<readonly MultilineDropdownOption[]>([]);
    readonly value = input('');
    readonly label = input('Select option');
    readonly optionsId = input('');
    readonly activeOptionId = input('');
    readonly activeIndex = input(0);
    readonly fontSize = input('');

    readonly selected = output<MultilineDropdownOption>();
    readonly hovered = output<number>();

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }

    selectOption(option: MultilineDropdownOption) {
        if (option.disabled) return;
        this.selected.emit(option);
    }
}

@Component({
    selector: 'multiline-dropdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="multiline-dropdown">
            <button
                class="field-input multiline-dropdown-trigger"
                #triggerEl
                type="button"
                [id]="controlId()"
                aria-haspopup="listbox"
                [attr.aria-controls]="optionsId()"
                [attr.aria-expanded]="open()"
                [attr.aria-label]="label()"
                [disabled]="disabled() || options().length === 0"
                [class.destroyed]="selectedOption()?.destroyed"
                (click)="toggle()"
                (keydown)="onTriggerKeydown($event)"
            >
                <span class="multiline-dropdown-label">{{ selectedLabel() }}</span>
                <span class="multiline-dropdown-measure" aria-hidden="true">
                    @for (option of options(); track option.value) {
                        <span class="multiline-dropdown-measure-option">{{ option.label }}</span>
                    }
                </span>
                <span class="multiline-dropdown-arrow" aria-hidden="true">\u25be</span>
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

        .multiline-dropdown {
            min-width: 0;
            width: 100%;
            height: 100%;
        }

        .multiline-dropdown-trigger {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            width: 100%;
            height: 100%;
            gap: 4px;
            text-align: left;
            cursor: pointer;
        }

        .multiline-dropdown-trigger.destroyed {
            color: var(--damage-color);
        }

        .multiline-dropdown-label {
            grid-column: 1;
            grid-row: 1;
            flex: 1 1 auto;
            min-width: 0;
            white-space: normal;
            overflow-wrap: normal;
            word-break: normal;
        }

        .multiline-dropdown-measure {
            display: grid;
            grid-column: 1;
            grid-row: 1;
            min-width: 0;
            overflow: hidden;
            visibility: hidden;
            white-space: nowrap;
            pointer-events: none;
        }

        .multiline-dropdown-measure-option {
            grid-column: 1;
            grid-row: 1;
            white-space: nowrap;
        }

        .multiline-dropdown-arrow {
            grid-column: 2;
            grid-row: 1;
            flex: 0 0 auto;
            color: var(--text-color-secondary);
            font-size: 0.8em;
        }
    `]
})
export class MultilineDropdownComponent implements OnDestroy {
    private static nextId = 0;
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly instanceId = `multilineDropdown-${MultilineDropdownComponent.nextId++}`;
    private readonly overlayKey = `${this.instanceId}-overlay`;
    private readonly triggerEl = viewChild<ElementRef<HTMLButtonElement>>('triggerEl');
    private panelRef: ComponentRef<MultilineDropdownPanelComponent> | null = null;
    private closedSubscription: { unsubscribe(): void } | null = null;

    readonly options = input<readonly MultilineDropdownOption[]>([]);
    readonly value = input('');
    readonly label = input('Select option');
    readonly placeholder = input('Select');
    readonly controlId = input(this.instanceId);
    readonly disabled = input(false);

    readonly valueChange = output<string>();
    readonly optionSelected = output<MultilineDropdownOption>();

    readonly open = signal(false);
    readonly activeIndex = signal(0);
    readonly optionsId = computed(() => `${this.controlId()}-options`);
    readonly activeOptionId = computed(() => this.optionId(this.activeIndex()));
    readonly selectedOption = computed(() => this.options().find(option => option.value === this.value()) ?? null);
    readonly selectedLabel = computed(() => this.selectedOption()?.label ?? this.placeholder());

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }

    toggle() {
        if (this.open()) {
            this.closeDropdown();
            return;
        }
        this.openDropdown();
    }

    openDropdown() {
        if (this.open()) return;
        this.activeIndex.set(this.selectedIndex());
        this.open.set(true);
        this.attachOverlay();
    }

    onTriggerKeydown(event: KeyboardEvent) {
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
                this.activeIndex.set(this.firstEnabledIndex());
                this.syncPanelInputs();
                break;
            case 'End':
                event.preventDefault();
                this.openDropdown();
                this.activeIndex.set(this.lastEnabledIndex());
                this.syncPanelInputs();
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

    setActiveIndex(index: number) {
        if (this.options()[index]?.disabled) return;
        this.activeIndex.set(index);
        this.syncPanelInputs();
    }

    selectOption(option: MultilineDropdownOption) {
        if (option.disabled) return;
        this.valueChange.emit(option.value);
        this.optionSelected.emit(option);
        this.closeDropdown();
    }

    ngOnDestroy() {
        this.closeDropdown();
    }

    private closeDropdown() {
        this.open.set(false);
        this.closedSubscription?.unsubscribe();
        this.closedSubscription = null;
        this.panelRef = null;
        this.overlayManager.closeManagedOverlay(this.overlayKey);
    }

    private attachOverlay() {
        const trigger = this.triggerEl();
        if (!trigger) return;

        const portal = new ComponentPortal(MultilineDropdownPanelComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(
            this.overlayKey,
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'multiline-dropdown-overlay',
                matchTriggerWidth: true,
                anchorActiveSelector: '.multiline-dropdown-option.active'
            }
        );

        this.panelRef = componentRef;
        this.syncPanelInputs();
        componentRef.instance.selected.subscribe(option => this.selectOption(option));
        componentRef.instance.hovered.subscribe(index => this.setActiveIndex(index));
        this.closedSubscription = closed.subscribe(() => {
            this.open.set(false);
            this.panelRef = null;
            this.closedSubscription = null;
        });
    }

    private syncPanelInputs() {
        const panelRef = this.panelRef;
        if (!panelRef) return;
        panelRef.setInput('options', this.options());
        panelRef.setInput('value', this.value());
        panelRef.setInput('label', this.label());
        panelRef.setInput('optionsId', this.optionsId());
        panelRef.setInput('activeOptionId', this.activeOptionId());
        panelRef.setInput('activeIndex', this.activeIndex());
        panelRef.setInput('fontSize', this.triggerFontSize());
        panelRef.changeDetectorRef.detectChanges();
        this.scrollActiveOptionIntoView(panelRef.location.nativeElement as HTMLElement);
    }

    private triggerFontSize(): string {
        const trigger = this.triggerEl();
        return trigger ? getComputedStyle(trigger.nativeElement).fontSize : '';
    }

    private scrollActiveOptionIntoView(panelHost: HTMLElement) {
        const scrollContainer = panelHost.querySelector('[data-scroll-container]') as HTMLElement | null;
        const activeOption = panelHost.querySelector('.multiline-dropdown-option.active') as HTMLElement | null;
        if (!scrollContainer || !activeOption) return;

        const visibleTop = scrollContainer.scrollTop;
        const visibleBottom = visibleTop + scrollContainer.clientHeight;
        const optionTop = activeOption.offsetTop;
        const optionBottom = optionTop + activeOption.offsetHeight;
        const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);

        if (optionTop < visibleTop) {
            scrollContainer.scrollTop = Math.max(0, optionTop);
        } else if (optionBottom > visibleBottom) {
            scrollContainer.scrollTop = Math.min(maxScrollTop, optionBottom - scrollContainer.clientHeight);
        }
    }

    private selectedIndex(): number {
        const selectedIndex = this.options().findIndex(option => option.value === this.value() && !option.disabled);
        return selectedIndex >= 0 ? selectedIndex : this.firstEnabledIndex();
    }

    private moveActiveOption(delta: number) {
        const options = this.options();
        if (options.length === 0) return;

        let nextIndex = this.activeIndex();
        for (let i = 0; i < options.length; i++) {
            nextIndex = (nextIndex + delta + options.length) % options.length;
            if (!options[nextIndex].disabled) {
                this.activeIndex.set(nextIndex);
                this.syncPanelInputs();
                return;
            }
        }
    }

    private selectActiveOption() {
        const activeOption = this.options()[this.activeIndex()];
        if (activeOption) {
            this.selectOption(activeOption);
        }
    }

    private firstEnabledIndex(): number {
        return Math.max(0, this.options().findIndex(option => !option.disabled));
    }

    private lastEnabledIndex(): number {
        for (let i = this.options().length - 1; i >= 0; i--) {
            if (!this.options()[i].disabled) return i;
        }
        return 0;
    }
}