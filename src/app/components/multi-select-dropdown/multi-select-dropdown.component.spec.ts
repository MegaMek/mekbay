import { Component, provideZonelessChangeDetection, signal, viewChild } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import type { DropdownOption, MultiStateSelection } from './multi-select-dropdown.component';
import { MultiSelectDropdownComponent } from './multi-select-dropdown.component';
import { LayoutService } from '../../services/layout.service';

@Component({
    standalone: true,
    imports: [MultiSelectDropdownComponent],
    template: `
        <multi-select-dropdown
            [options]="options()"
            [selected]="selected()"
            [multistate]="true"
            (selectionChange)="onSelectionChange($event)">
        </multi-select-dropdown>
    `,
})
class TestHostComponent {
    readonly options = signal<DropdownOption[]>([]);
    readonly selected = signal<MultiStateSelection>({});
    readonly dropdown = viewChild(MultiSelectDropdownComponent);

    onSelectionChange(selection: MultiStateSelection | readonly string[]) {
        this.selected.set(selection as MultiStateSelection);
    }
}

describe('MultiSelectDropdownComponent', () => {
    let overlayContainer: OverlayContainer;
    let overlayContainerElement: HTMLElement;

    const layoutServiceStub = {
        windowWidth: signal(1280),
        windowHeight: signal(900),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MultiSelectDropdownComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LayoutService, useValue: layoutServiceStub },
            ],
        }).compileComponents();

        overlayContainer = TestBed.inject(OverlayContainer);
        overlayContainerElement = overlayContainer.getContainerElement();
        overlayContainerElement.innerHTML = '';
    });

    function createOptions(count: number): DropdownOption[] {
        return Array.from({ length: count }, (_, index) => ({
            name: `Option ${index + 1}`,
            available: true,
        }));
    }

    async function flushRender() {
        await Promise.resolve();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }

    it('uses a virtual viewport for large visible option lists', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', createOptions(100));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        expect(fixture.componentInstance.useVirtualScroll()).toBeTrue();
        const viewportEl = overlayContainerElement.querySelector('cdk-virtual-scroll-viewport') as HTMLElement | null;
        expect(viewportEl).not.toBeNull();
        expect(getComputedStyle(viewportEl!).overflowY).toBe('auto');
    });

    it('keeps the plain list path for small option lists', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', createOptions(10));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        expect(fixture.componentInstance.useVirtualScroll()).toBeFalse();
        expect(overlayContainerElement.querySelector('cdk-virtual-scroll-viewport')).toBeNull();
        expect(overlayContainerElement.querySelector('.options-list')).not.toBeNull();
    });

    it('hides unavailable unselected options by default while keeping selected unavailable ones visible', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        const options: DropdownOption[] = [
            { name: 'Available', available: true },
            { name: 'Hidden', available: false },
            { name: 'Selected Hidden', available: false },
        ];
        const selected: MultiStateSelection = {
            'Selected Hidden': {
                name: 'Selected Hidden',
                state: 'or',
                count: 1,
            },
        };

        fixture.componentRef.setInput('multistate', true);
        fixture.componentRef.setInput('options', options);
        fixture.componentRef.setInput('selected', selected);
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        expect(fixture.componentInstance.filteredOptions().map(option => option.name)).toEqual([
            'Available',
            'Selected Hidden',
        ]);
    });

    it('can keep unavailable options visible when requested by the host', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', [
            { name: 'Available', available: true },
            { name: 'Not Available', available: false },
        ]);
        fixture.componentRef.setInput('keepUnavailableVisible', true);
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        expect(fixture.componentInstance.filteredOptions().map(option => option.name)).toEqual([
            'Available',
            'Not Available',
        ]);
    });

    it('keeps matching unavailable options visible while filtering', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', [
            { name: 'Wolf’s Dragoons', available: false },
            { name: 'Clan Wolf', available: true },
        ]);
        fixture.componentInstance.isOpen.set(true);
        fixture.componentInstance.filterText.set("Wolf's Dragoons");
        fixture.detectChanges();

        expect(fixture.componentInstance.filteredOptions().map(option => option.name)).toEqual([
            'Wolf’s Dragoons',
        ]);
    });

    it('filters symbol-heavy option names with apostrophes', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', [
            { name: 'Wolf’s Dragoons', available: true },
            { name: 'Clan Wolf', available: true },
        ]);
        fixture.componentInstance.isOpen.set(true);
        fixture.componentInstance.filterText.set("Wolf's Dragoons");
        fixture.detectChanges();

        expect(fixture.componentInstance.filteredOptions().map(option => option.name)).toEqual([
            'Wolf’s Dragoons',
        ]);
    });

    it('filters symbol-heavy option names with parentheses', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', [
            { name: 'Clan Wolf (Beta Galaxy)', available: true },
            { name: 'Clan Wolf Alpha Galaxy', available: true },
        ]);
        fixture.componentInstance.isOpen.set(true);
        fixture.componentInstance.filterText.set('Wolf (Beta');
        fixture.detectChanges();

        expect(fixture.componentInstance.filteredOptions().map(option => option.name)).toEqual([
            'Clan Wolf (Beta Galaxy)',
        ]);
    });

    it('renders semantic display text instead of the Any placeholder for wildcard-only semantic filters', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('multistate', true);
        fixture.componentRef.setInput('semanticOnly', true);
        fixture.componentRef.setInput('displayText', '==Capellan *');
        fixture.componentRef.setInput('selected', {});
        fixture.detectChanges();

        const semanticText = fixture.nativeElement.querySelector('.semantic-display-text') as HTMLElement | null;
        const placeholder = fixture.nativeElement.querySelector('.placeholder') as HTMLElement | null;

        expect(semanticText?.textContent?.trim()).toBe('==Capellan *');
        expect(placeholder).toBeNull();
    });

    it('does not show the Any placeholder for semantic-only filters without display metadata', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('multistate', true);
        fixture.componentRef.setInput('semanticOnly', true);
        fixture.componentRef.setInput('selected', {});
        fixture.detectChanges();

        const placeholder = fixture.nativeElement.querySelector('.placeholder') as HTMLElement | null;

        expect(placeholder).toBeNull();
    });

    it('renders single-select values with a clear button that unsets the selection', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        let emittedSelection: unknown;

        fixture.componentInstance.selectionChange.subscribe((selection) => {
            emittedSelection = selection;
        });

        fixture.componentRef.setInput('multiselect', false);
        fixture.componentRef.setInput('options', [
            { name: 'inner-sphere', displayName: 'Inner Sphere' },
        ]);
        fixture.componentRef.setInput('selected', ['inner-sphere']);
        fixture.detectChanges();

        const selectedValue = fixture.nativeElement.querySelector('.single-selected-value') as HTMLElement | null;
        const clearButton = fixture.nativeElement.querySelector('.single-selected-value .remove-pill') as HTMLButtonElement | null;

        expect(selectedValue?.textContent).toContain('Inner Sphere');
        expect(clearButton).not.toBeNull();

        clearButton!.click();

        expect(emittedSelection).toEqual([]);
    });

    it('can restrict multistate toggles to selected and unselected only', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        let emittedSelection: unknown;
        fixture.componentInstance.selectionChange.subscribe((selection) => {
            emittedSelection = selection;
        });

        fixture.componentRef.setInput('multistate', true);
        fixture.componentRef.setInput('stateCycle', ['or']);
        fixture.componentRef.setInput('selected', {});
        fixture.detectChanges();

        fixture.componentInstance.onOptionToggle('Option 1');
        expect((emittedSelection as MultiStateSelection)['Option 1']?.state).toBe('or');

        fixture.componentRef.setInput('selected', emittedSelection);
        fixture.detectChanges();

        fixture.componentInstance.onOptionToggle('Option 1');
        expect(emittedSelection).toEqual({});
    });

    it('supports exclusive multistate options with their own state cycle', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        let emittedSelection: unknown;
        fixture.componentInstance.selectionChange.subscribe((selection) => {
            emittedSelection = selection;
        });

        fixture.componentRef.setInput('multistate', true);
        fixture.componentRef.setInput('options', [
            { name: 'Random', exclusive: true, stateCycle: ['or'] },
            { name: 'Federated Suns' },
        ]);
        fixture.componentRef.setInput('selected', {
            'Federated Suns': { name: 'Federated Suns', state: 'and', count: 1 },
        });
        fixture.detectChanges();

        fixture.componentInstance.onOptionToggle('Random');
        expect(emittedSelection).toEqual({
            Random: { name: 'Random', state: 'or', count: 1 },
        });

        fixture.componentRef.setInput('selected', emittedSelection);
        fixture.detectChanges();

        fixture.componentInstance.onOptionToggle('Random');
        expect(emittedSelection).toEqual({});
    });

    it('keeps always-visible options in filtered results', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', [
            { name: 'Random', alwaysVisible: true },
            { name: 'Federated Suns' },
        ]);
        fixture.detectChanges();

        fixture.componentInstance.isOpen.set(true);
        fixture.componentInstance.filterText.set('clan');

        expect(fixture.componentInstance.filteredOptions().map((option) => option.name)).toEqual(['Random']);
    });

    it('does not mark an option as keyboard-focused when opened by pointer', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(3));
        fixture.detectChanges();

        const displayArea = fixture.nativeElement.querySelector('.display-area') as HTMLElement;
        displayArea.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
        displayArea.click();
        fixture.detectChanges();

        expect(fixture.componentInstance.keyboardFocusedIndex()).toBe(-1);
        expect(overlayContainerElement.querySelector('.option-item.keyboard-focused')).toBeNull();
    });

    it('marks a keyboard-focused option only after keyboard navigation', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(3));
        fixture.detectChanges();

        const displayArea = fixture.nativeElement.querySelector('.display-area') as HTMLElement;
        displayArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();

        const optionItems = Array.from(overlayContainerElement.querySelectorAll('.option-item')) as HTMLElement[];
        expect(fixture.componentInstance.keyboardFocusedIndex()).toBe(0);
        expect(optionItems[0].classList.contains('keyboard-focused')).toBeTrue();
    });

    it('keeps keyboard focus on the same option when the option list changes', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(5));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        fixture.componentInstance['setKeyboardFocusedIndex'](4);
        fixture.detectChanges();
        expect(fixture.componentInstance.keyboardFocusedIndex()).toBe(4);

        fixture.componentRef.setInput('options', [
            { name: 'Option 1', available: true },
            { name: 'Option 5', available: true },
            { name: 'Option 2', available: true },
            { name: 'Option 3', available: true },
            { name: 'Option 4', available: true },
        ]);
        fixture.detectChanges();

        const focusedOption = overlayContainerElement.querySelector('.option-item.keyboard-focused') as HTMLElement | null;
        expect(fixture.componentInstance.keyboardFocusedIndex()).toBe(1);
        expect(focusedOption?.getAttribute('data-option-name')).toBe('Option 5');
    });

    it('does not restore the old visual offset when keyboard toggle reorders the focused option', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        const component = fixture.componentInstance;
        const baseOptions = createOptions(100);
        const focusedOption = baseOptions[5];
        const andOrderedOptions = [
            focusedOption,
            ...baseOptions.filter(option => option.name !== focusedOption.name),
        ];
        const notOrderedOptions = [
            baseOptions[0],
            baseOptions[1],
            baseOptions[2],
            focusedOption,
            ...baseOptions.filter(option => !['Option 1', 'Option 2', 'Option 3', focusedOption.name].includes(option.name)),
        ];
        const restoreScrollPosition = spyOn<any>(component, 'restoreScrollPosition').and.callThrough();

        component.selectionChange.subscribe(selection => {
            fixture.componentRef.setInput('selected', selection);
            fixture.componentRef.setInput('options', notOrderedOptions);
        });
        fixture.componentRef.setInput('multistate', true);
        fixture.componentRef.setInput('options', andOrderedOptions);
        fixture.componentRef.setInput('selected', {
            [focusedOption.name]: { name: focusedOption.name, state: 'and', count: 1 },
        });
        component.isOpen.set(true);
        fixture.detectChanges();

        component['setKeyboardFocusedIndex'](0);
        component['toggleKeyboardFocusedOption']();
        fixture.detectChanges();

        expect(restoreScrollPosition).not.toHaveBeenCalled();
        expect(component.keyboardFocusedIndex()).toBe(3);
    });

    it('keeps keyboard focus on the same option when it moves back down the list', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        const component = fixture.componentInstance;
        const baseOptions = createOptions(100);
        const focusedOption = baseOptions[29];
        const collapsedOptions = [
            focusedOption,
            ...baseOptions.filter(option => option.name !== focusedOption.name),
        ];
        const expandedOptions = [
            ...baseOptions.slice(0, 29),
            focusedOption,
            ...baseOptions.slice(30),
        ];

        fixture.componentRef.setInput('options', collapsedOptions);
        component.isOpen.set(true);
        fixture.detectChanges();

        component['setKeyboardFocusedIndex'](0);
        fixture.detectChanges();
        fixture.componentRef.setInput('options', expandedOptions);
        fixture.detectChanges();

        expect(component.keyboardFocusedIndex()).toBe(29);
    });

    it('starts keyboard navigation from the hovered option when nothing is keyboard-focused', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(10));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        const optionItems = Array.from(overlayContainerElement.querySelectorAll('.option-item')) as HTMLElement[];
        optionItems[5].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        fixture.detectChanges();

        const optionsList = overlayContainerElement.querySelector('.options-list') as HTMLElement;
        optionsList.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();

        expect(fixture.componentInstance.keyboardFocusedIndex()).toBe(6);
        expect(optionItems[6].classList.contains('keyboard-focused')).toBeTrue();
    });

    it('allows tab focus to land on the option list and initialize keyboard focus', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(3));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        const optionsList = overlayContainerElement.querySelector('.options-list') as HTMLElement;
        expect(optionsList.getAttribute('tabindex')).toBe('0');

        optionsList.dispatchEvent(new FocusEvent('focus'));
        fixture.detectChanges();

        const optionItems = Array.from(overlayContainerElement.querySelectorAll('.option-item')) as HTMLElement[];
        expect(fixture.componentInstance.keyboardFocusedIndex()).toBe(0);
        expect(optionItems[0].classList.contains('keyboard-focused')).toBeTrue();
    });

    it('styles keyboard-focused options like hovered options', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(3));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        const optionItems = Array.from(overlayContainerElement.querySelectorAll('.option-item')) as HTMLElement[];
        const expectedBackground = document.createElement('div');
        expectedBackground.style.backgroundColor = 'var(--background-color-light)';
        overlayContainerElement.appendChild(expectedBackground);

        optionItems[0].classList.add('keyboard-focused');

        expect(getComputedStyle(optionItems[0]).backgroundColor).toBe(getComputedStyle(expectedBackground).backgroundColor);
    });

    it('uses instant nearest-edge scrolling when a pill targets a virtualized option below view', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        const component = fixture.componentInstance;
        const scrollToOffset = jasmine.createSpy('scrollToOffset');
        const viewport = {
            measureScrollOffset: () => 0,
            getViewportSize: () => component.optionItemSize * 3,
            scrollToOffset,
        } as unknown as Parameters<typeof component['scrollVirtualOptionIntoView']>[0];

        fixture.componentRef.setInput('options', createOptions(100));
        component.isOpen.set(true);
        fixture.detectChanges();

        component['scrollVirtualOptionIntoView'](viewport, 89);

        expect(scrollToOffset).toHaveBeenCalledOnceWith(component.optionItemSize * 87, 'auto');
    });

    it('uses instant nearest-edge scrolling when a pill targets a plain-list option below view', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);
        fixture.componentRef.setInput('options', createOptions(10));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        const container = overlayContainerElement.querySelector('.options-list') as HTMLElement;
        const optionItems = Array.from(overlayContainerElement.querySelectorAll('.option-item')) as HTMLElement[];
        let scrollTop = 0;
        Object.defineProperty(container, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => scrollTop = value,
        });
        spyOnProperty(container, 'clientHeight', 'get').and.returnValue(88);
        spyOnProperty(container, 'scrollHeight', 'get').and.returnValue(440);
        spyOn(container, 'getBoundingClientRect').and.returnValue({
            top: 100,
            bottom: 188,
            height: 88,
            left: 0,
            right: 240,
            width: 240,
            x: 0,
            y: 100,
            toJSON: () => null,
        } as DOMRect);
        optionItems.forEach((item, index) => {
            spyOnProperty(item, 'offsetTop', 'get').and.returnValue(24 + (index * 44));
            spyOnProperty(item, 'offsetHeight', 'get').and.returnValue(44);
            spyOn(item, 'getBoundingClientRect').and.returnValue({
                top: 100 + (index * 44),
                bottom: 100 + ((index + 1) * 44),
                height: 44,
                left: 0,
                right: 240,
                width: 240,
                x: 0,
                y: 100 + (index * 44),
                toJSON: () => null,
            } as DOMRect);
        });

        fixture.componentInstance['scrollToOption']('Option 5');

        expect(scrollTop).toBe(132);
    });

    xit('preserves scroll position when toggling an item in the virtualized list', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.componentInstance.options.set(createOptions(140));
        fixture.detectChanges();

        const dropdown = fixture.componentInstance.dropdown();
        expect(dropdown).toBeTruthy();

        dropdown!.isOpen.set(true);
        fixture.detectChanges();
        await flushRender();
        fixture.detectChanges();

        const viewport = dropdown!.optionsViewport();
        expect(viewport).toBeTruthy();

        viewport!.scrollToOffset(dropdown!.optionItemSize * 90);
        fixture.detectChanges();
        await flushRender();
        fixture.detectChanges();

        const beforeOffset = viewport!.measureScrollOffset('top');
        const renderedItems = Array.from(fixture.nativeElement.querySelectorAll('.option-item')) as HTMLElement[];
        expect(renderedItems.length).toBeGreaterThan(0);

        const targetItem = renderedItems[Math.floor(renderedItems.length / 2)];
        const optionName = targetItem.getAttribute('data-option-name');
        const checkbox = targetItem.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

        expect(optionName).toBeTruthy();
        expect(checkbox).not.toBeNull();

        checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
        fixture.detectChanges();
        await flushRender();
        fixture.detectChanges();

        const afterOffset = viewport!.measureScrollOffset('top');
        expect(Math.abs(afterOffset - beforeOffset)).toBeLessThan(dropdown!.optionItemSize + 1);
        expect(fixture.componentInstance.selected()[optionName!]?.state).toBe('or');
    });

    it('removes all selections in a compressed state bucket from the summary pill button', () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.componentInstance.options.set(createOptions(6));
        fixture.componentInstance.selected.set({
            'Option 1': { name: 'Option 1', state: 'or', count: 1 },
            'Option 2': { name: 'Option 2', state: 'or', count: 1 },
            'Option 3': { name: 'Option 3', state: 'or', count: 1 },
            'Option 4': { name: 'Option 4', state: 'and', count: 1 },
            'Option 5': { name: 'Option 5', state: 'and', count: 1 },
            'Option 6': { name: 'Option 6', state: 'not', count: 1 },
        });
        fixture.detectChanges();

        const dropdown = fixture.componentInstance.dropdown();
        expect(dropdown?.compressedPills()).toEqual([
            { state: 'or', count: 3 },
            { state: 'and', count: 2 },
            { state: 'not', count: 1 },
        ]);

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('.pill .remove-pill')) as HTMLButtonElement[];
        expect(buttons.length).toBe(3);

        buttons[1].click();
        fixture.detectChanges();

        expect(fixture.componentInstance.selected()).toEqual({
            'Option 1': { name: 'Option 1', state: 'or', count: 1 },
            'Option 2': { name: 'Option 2', state: 'or', count: 1 },
            'Option 3': { name: 'Option 3', state: 'or', count: 1 },
            'Option 6': { name: 'Option 6', state: 'not', count: 1 },
        });
    });
});