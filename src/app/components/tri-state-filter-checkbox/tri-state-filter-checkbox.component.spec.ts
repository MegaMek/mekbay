import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { TriStateBooleanFilterValue } from '../../services/unit-search-filters.model';
import { TriStateFilterCheckboxComponent } from './tri-state-filter-checkbox.component';

@Component({
    standalone: true,
    imports: [TriStateFilterCheckboxComponent],
    template: `
        <tri-state-filter-checkbox
            label="Canon"
            [value]="value()"
            (valueChange)="value.set($event)">
        </tri-state-filter-checkbox>
    `,
})
class TestHostComponent {
    readonly value = signal<TriStateBooleanFilterValue>(null);
}

describe('TriStateFilterCheckboxComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestHostComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();
    });

    it('cycles unchecked to OR to NOT to unchecked', () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

        button.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.value()).toBe('or');

        button.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.value()).toBe('not');

        button.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.value()).toBeNull();
    });
});