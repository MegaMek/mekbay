import { Component, provideZonelessChangeDetection, signal, viewChild } from '@angular/core';
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
    const layoutServiceStub = {
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
        const viewportEl = fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport') as HTMLElement | null;
        expect(viewportEl).not.toBeNull();
        expect(getComputedStyle(viewportEl!).overflowY).toBe('auto');
    });

    it('keeps the plain list path for small option lists', () => {
        const fixture = TestBed.createComponent(MultiSelectDropdownComponent);

        fixture.componentRef.setInput('options', createOptions(10));
        fixture.componentInstance.isOpen.set(true);
        fixture.detectChanges();

        expect(fixture.componentInstance.useVirtualScroll()).toBeFalse();
        expect(fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport')).toBeNull();
        expect(fixture.nativeElement.querySelector('.options-list')).not.toBeNull();
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