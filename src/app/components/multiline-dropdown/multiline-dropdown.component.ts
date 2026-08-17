// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, type ComponentRef, ElementRef, inject, Injector, input, output, signal, type OnDestroy, viewChild } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { DropdownPointerActivationGuard, scrollActiveOptionIntoView } from '../../utils/dropdown-interaction.utils';

/*
 * Component for a dropdown that supports multiline option labels and keyboard navigation.
 */
export interface MultilineDropdownOption {
    value: string;
    label: string;
    /** A trailing part of label that must remain visible when the closed trigger truncates. */
    trailingLabel?: string | null;
    modifierLabel?: string | null;
    disabled?: boolean;
    destroyed?: boolean;
}

interface MultilineDropdownPointerHoverEvent {
    index: number;
    clientX: number;
    clientY: number;
}

@Component({
    selector: 'multiline-dropdown-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[style.font-size]': 'fontSize() || null',
        '[class.expand-to-content]': 'expandToContent()',
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
                    [class.active]="option.value === value()"
                    [class.keyboard-active]="optionIndex === activeIndex()"
                    [disabled]="option.disabled"
                    [class.destroyed]="option.destroyed"
                    [attr.aria-selected]="option.value === value()"
                    (click)="selectOption(option)"
                    (pointerenter)="onOptionPointerHover(optionIndex, $event)"
                    (pointermove)="onOptionPointerHover(optionIndex, $event)"
                >
                    <span class="multiline-dropdown-option-label">{{ option.label }}</span>
                    @if (option.modifierLabel; as modifierLabel) {
                        <span class="modifier-badge">{{ modifierLabel }}</span>
                    }
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

        :host(.expand-to-content) {
            box-sizing: border-box;
            width: max-content;
            min-width: 100%;
            max-width: calc(100dvw - 8px);
        }

        :host(.expand-to-content) .multiline-dropdown-options {
            width: max-content;
            min-width: 100%;
            max-width: calc(100dvw - 8px);
        }

        .multiline-dropdown-options {
            box-sizing: border-box;
            width: 100%;
            max-height: 90dvh;
            overflow-y: auto;
        }

        .multiline-dropdown-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
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

        .multiline-dropdown-option.keyboard-active:not(.active):not(:disabled) {
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

        .modifier-badge {
            flex: 0 0 24px;
            inline-size: 24px;
            block-size: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.6);
            color: var(--text-color);
            font-weight: 600;
            font-size: 0.78em;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            box-sizing: border-box;
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
    readonly expandToContent = input(false);

    readonly selected = output<MultilineDropdownOption>();
    readonly pointerHovered = output<MultilineDropdownPointerHoverEvent>();

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }

    selectOption(option: MultilineDropdownOption) {
        if (option.disabled) return;
        this.selected.emit(option);
    }

    onOptionPointerHover(index: number, event: PointerEvent): void {
        this.pointerHovered.emit({
            index,
            clientX: event.clientX,
            clientY: event.clientY,
        });
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
                [attr.title]="selectedLabel()"
                [disabled]="disabled() || options().length === 0"
                [class.destroyed]="selectedOption()?.destroyed"
                (click)="toggle()"
                (keydown)="onTriggerKeydown($event)"
            >
                <span class="multiline-dropdown-label">
                    <span class="multiline-dropdown-label-text">{{ selectedLeadingLabel() }}</span>
                    @if (selectedTrailingLabel(); as trailingLabel) {
                        <span class="multiline-dropdown-trailing-label">{{ trailingLabel }}</span>
                    }
                </span>
                @if (selectedOption()?.modifierLabel; as modifierLabel) {
                    <span class="modifier-badge">{{ modifierLabel }}</span>
                }
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
            grid-template-columns: minmax(0, 1fr) auto auto;
            align-items: center;
            width: 100%;
            height: 100%;
            gap: 4px;
            overflow: hidden;
            overflow-wrap: normal;
            word-break: normal;
            white-space: nowrap;
            text-align: left;
            cursor: pointer;
        }

        .multiline-dropdown-trigger {
            background: transparent;
            border: 0;
            color: inherit;
            font-weight: inherit;
        }

        .multiline-dropdown-trigger.destroyed {
            color: var(--damage-color);
        }

        .multiline-dropdown-label {
            grid-column: 1;
            grid-row: 1;
            display: flex;
            align-items: center;
            gap: 0.3em;
            min-width: 0;
            overflow: hidden;
            overflow-wrap: normal;
            word-break: normal;
            white-space: nowrap;
        }

        .multiline-dropdown-label-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .multiline-dropdown-trailing-label {
            flex: 0 0 auto;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
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
            line-height: 0;
        }

        .multiline-dropdown-measure-option {
            grid-column: 1;
            grid-row: 1;
            white-space: nowrap;
        }

        .multiline-dropdown-arrow {
            grid-column: 3;
            grid-row: 1;
            flex: 0 0 auto;
            color: inherit;
            font-size: 1.1em;
            line-height: 0;
        }

        .modifier-badge {
            grid-column: 2;
            grid-row: 1;
            flex: 0 0 24px;
            inline-size: 24px;
            block-size: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            background: #000;
            color: var(--text-color);
            font-weight: 600;
            font-size: 0.78em;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            box-sizing: border-box;
        }
    `]
})
export class MultilineDropdownComponent implements OnDestroy {
    private static nextId = 0;
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly pointerActivationGuard = new DropdownPointerActivationGuard();
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
    readonly expandPanelToContent = input(false);

    readonly valueChange = output<string>();
    readonly optionSelected = output<MultilineDropdownOption>();

    readonly open = signal(false);
    readonly activeIndex = signal(0);
    readonly optionsId = computed(() => `${this.controlId()}-options`);
    readonly activeOptionId = computed(() => this.optionId(this.activeIndex()));
    readonly selectedOption = computed(() => this.options().find(option => option.value === this.value()) ?? null);
    readonly selectedLabel = computed(() => this.selectedOption()?.label ?? this.placeholder());
    readonly selectedTrailingLabel = computed(() => {
        const option = this.selectedOption();
        const trailingLabel = option?.trailingLabel?.trim();
        return option && trailingLabel && option.label.trimEnd().endsWith(trailingLabel)
            ? trailingLabel
            : null;
    });
    readonly selectedLeadingLabel = computed(() => {
        const option = this.selectedOption();
        if (!option) return this.placeholder();
        const trailingLabel = this.selectedTrailingLabel();
        return trailingLabel
            ? option.label.trimEnd().slice(0, -trailingLabel.length).trimEnd()
            : option.label;
    });

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
        this.pointerActivationGuard.suppress();
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
                this.activateKeyboardOption(this.firstEnabledIndex());
                break;
            case 'End':
                event.preventDefault();
                this.openDropdown();
                this.activateKeyboardOption(this.lastEnabledIndex());
                break;
            case 'Tab':
                if (!this.open()) break;
                event.preventDefault();
                this.moveActiveOption(event.shiftKey ? -1 : 1);
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

    activatePointerOption(event: MultilineDropdownPointerHoverEvent) {
        if (this.pointerActivationGuard.shouldIgnore(event)) return;

        const index = event.index;
        if (this.options()[index]?.disabled) return;
        if (index === this.activeIndex()) return;

        this.activeIndex.set(index);
        this.syncPanelInputs(false);
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
                anchorActiveSelector: '.multiline-dropdown-option.keyboard-active'
            }
        );

        this.panelRef = componentRef;
        this.syncPanelInputs();
        componentRef.instance.selected.subscribe(option => this.selectOption(option));
        componentRef.instance.pointerHovered.subscribe(event => this.activatePointerOption(event));
        this.closedSubscription = closed.subscribe(() => {
            this.open.set(false);
            this.panelRef = null;
            this.closedSubscription = null;
        });
    }

    private syncPanelInputs(scrollActiveIntoView = true) {
        const panelRef = this.panelRef;
        if (!panelRef) return;
        panelRef.setInput('options', this.options());
        panelRef.setInput('value', this.value());
        panelRef.setInput('label', this.label());
        panelRef.setInput('optionsId', this.optionsId());
        panelRef.setInput('activeOptionId', this.activeOptionId());
        panelRef.setInput('activeIndex', this.activeIndex());
        panelRef.setInput('fontSize', this.triggerFontSize());
        panelRef.setInput('expandToContent', this.expandPanelToContent());
        panelRef.changeDetectorRef.detectChanges();
        if (scrollActiveIntoView) {
            this.scrollActiveOptionIntoView(panelRef.location.nativeElement as HTMLElement);
        }
    }

    private triggerFontSize(): string {
        const trigger = this.triggerEl();
        return trigger ? getComputedStyle(trigger.nativeElement).fontSize : '';
    }

    private scrollActiveOptionIntoView(panelHost: HTMLElement) {
        scrollActiveOptionIntoView(panelHost, '[data-scroll-container]', '.multiline-dropdown-option.keyboard-active');
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
                this.activateKeyboardOption(nextIndex);
                return;
            }
        }
    }

    private activateKeyboardOption(index: number): void {
        const options = this.options();
        if (options.length === 0) return;

        this.pointerActivationGuard.suppress();
        this.activeIndex.set(Math.max(0, Math.min(index, options.length - 1)));
        this.syncPanelInputs();
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
