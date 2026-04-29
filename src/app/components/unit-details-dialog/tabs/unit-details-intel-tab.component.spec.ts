import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Unit } from '../../../models/units.model';
import { UnitDetailsIntelTabComponent } from './unit-details-intel-tab.component';

describe('UnitDetailsIntelTabComponent', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [UnitDetailsIntelTabComponent],
            providers: [provideZonelessChangeDetection()],
        });
    });

    function createComponent(fluff: NonNullable<Unit['fluff']>) {
        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', {
            id: 1,
            chassis: 'Awesome',
            model: 'AWS-8Q',
            fluff,
        } as Unit);
        fixture.detectChanges();
        return fixture;
    }

    function getFluffText(element: HTMLElement, label: string): string | undefined {
        const section = Array.from(element.querySelectorAll('.fluff-section')).find(
            (candidate) => candidate.querySelector('.fluff-label')?.textContent?.trim() === label,
        );
        return section?.querySelector('.fluff-text')?.textContent ?? undefined;
    }

    it('groups paired manufacturers and primary factories under a combined section', () => {
        const fixture = createComponent({
            manufacturer: 'Earthwerks-FWL, Inc.|Bowie Industries|Bowie Industries|Diplass BattleMechs',
            primaryFactory: 'Calloway VI|Carlisle|Erdvynn|Hesperus II',
        });

        const element = fixture.nativeElement as HTMLElement;

        expect(getFluffText(element, 'Manufacturers and Primary Factories:')).toBe('Earthwerks-FWL, Inc. (Calloway VI)\nBowie Industries (Carlisle, Erdvynn)\nDiplass BattleMechs (Hesperus II)');
        expect(getFluffText(element, 'Manufacturers:')).toBeUndefined();
        expect(getFluffText(element, 'Primary Factories:')).toBeUndefined();
    });

    it('deduplicates separate manufacturer and primary factory entries when counts do not match', () => {
        const fixture = createComponent({
            manufacturer: ' Earthwerks-FWL, Inc. | Bowie Industries | Bowie Industries ',
            primaryFactory: ' Calloway VI | Carlisle | Carlisle | Erdvynn ',
        });

        const element = fixture.nativeElement as HTMLElement;

        expect(getFluffText(element, 'Manufacturers:')).toBe('Earthwerks-FWL, Inc.\nBowie Industries');
        expect(getFluffText(element, 'Primary Factories:')).toBe('Calloway VI, Carlisle, Erdvynn');
        expect(getFluffText(element, 'Manufacturers and Primary Factories:')).toBeUndefined();
    });
});
