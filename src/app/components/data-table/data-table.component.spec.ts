import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    calculateDataTableMinWidth,
    DataTableComponent,
    serializeDataTableTrack,
    type DataTableColumn,
} from './data-table.component';

interface TestRow {
    id: string;
    text: string;
}

const textColumn: DataTableColumn<TestRow> = {
    id: 'text',
    header: 'Text',
    track: 90,
    value: row => row.text,
};

describe('DataTableComponent', () => {
    let fixture: ComponentFixture<DataTableComponent<TestRow>>;
    let component: DataTableComponent<TestRow>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DataTableComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();

        fixture = TestBed.createComponent(DataTableComponent<TestRow>);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('columns', [textColumn]);
        fixture.componentRef.setInput('rows', []);
        fixture.nativeElement.style.cssText = 'display:flex;width:160px;height:320px;font-size:24px;';
    });

    afterEach(() => fixture.destroy());

    async function renderFrames(count = 3): Promise<void> {
        fixture.detectChanges();
        for (let index = 0; index < count; index += 1) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        fixture.detectChanges();
    }

    function hostElement(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
    }

    it('uses explicit stable row keys for variable-height measurements', () => {
        const rows = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
        fixture.componentRef.setInput('rows', rows);
        fixture.componentRef.setInput('rowKeys', ['unit-a', 'unit-b']);
        fixture.detectChanges();

        expect(component.virtualRowKeys()).toEqual(['unit-a', 'unit-b']);
    });

    it('serializes fixed and flexible tracks', () => {
        expect(serializeDataTableTrack(90)).toBe('90px');
        expect(serializeDataTableTrack({ minPx: 320, flex: 1.35 })).toBe('minmax(320px, 1.35fr)');
    });

    it('derives minimum width from tracks, gaps, and padding', () => {
        const columns: DataTableColumn<TestRow>[] = [
            textColumn,
            { id: 'details', header: 'Details', track: { minPx: 220, flex: 1 }, value: row => row.text },
        ];

        expect(calculateDataTableMinWidth(columns)).toBe(350);

        fixture.componentRef.setInput('columns', columns);
        fixture.detectChanges();
        expect(component.gridTemplate()).toBe('90px minmax(220px, 1fr)');
        expect(component.tableWidth()).toBe('max(350px, 100%)');
    });

    it('uses only table padding when there are no columns', () => {
        expect(calculateDataTableMinWidth([])).toBe(32);
    });

    it('derives measurement keys from rowTrackBy when explicit keys are absent or invalid', () => {
        const rows = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
        fixture.componentRef.setInput('rows', rows);
        fixture.componentRef.setInput('rowTrackBy', (_index: number, row: TestRow) => row.id);
        fixture.componentRef.setInput('rowKeys', ['wrong-length']);
        fixture.detectChanges();

        expect(component.virtualRowKeys()).toEqual(['a', 'b']);
    });

    it('grows wrapped rows beyond the estimate without clipping their content', async () => {
        fixture.componentRef.setInput('itemSize', 48);
        fixture.componentRef.setInput('rows', [
            { id: 'short', text: 'Short' },
            { id: 'long', text: 'Motorized Conventional Infantry with additional wrapped details' },
        ]);
        fixture.componentRef.setInput('rowKeys', ['short', 'long']);

        await renderFrames();

        const rowElements = Array.from(
            hostElement().querySelectorAll<HTMLElement>('.mb-data-table-row-item'),
        );
        expect(rowElements.length).toBe(2);

        const shortHeight = rowElements[0].getBoundingClientRect().height;
        const longHeight = rowElements[1].getBoundingClientRect().height;
        const longCell = rowElements[1].querySelector<HTMLElement>('.mb-data-table-body-cell')!;
        const rowStyle = getComputedStyle(rowElements[1]);

        expect(shortHeight).toBeGreaterThanOrEqual(48);
        expect(longHeight).toBeGreaterThan(shortHeight);
        expect(longCell.scrollHeight).toBeLessThanOrEqual(longCell.clientHeight + 1);
        expect(rowStyle.overflow).not.toBe('hidden');
    });

    it('keeps short rows at no less than the configured estimated minimum', async () => {
        fixture.componentRef.setInput('itemSize', 64);
        fixture.componentRef.setInput('rows', [{ id: 'short', text: 'Short' }]);
        fixture.componentRef.setInput('rowKeys', ['short']);

        await renderFrames();

        const row = hostElement().querySelector<HTMLElement>('.mb-data-table-row-item')!;
        expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(64);
    });

});
