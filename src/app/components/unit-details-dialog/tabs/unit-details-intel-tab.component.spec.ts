import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Unit, UnitFluffCatalogEntry } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { UnitDetailsIntelTabComponent } from './unit-details-intel-tab.component';

describe('UnitDetailsIntelTabComponent', () => {
    let dataService: jasmine.SpyObj<Pick<DataService, 'getUnitFluff'>>;

    beforeEach(() => {
        dataService = jasmine.createSpyObj<Pick<DataService, 'getUnitFluff'>>('DataService', ['getUnitFluff']);

        TestBed.configureTestingModule({
            imports: [UnitDetailsIntelTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: dataService },
            ],
        });
    });

    async function settleMicrotasks(): Promise<void> {
        for (let index = 0; index < 3; index += 1) {
            await Promise.resolve();
        }
    }

    async function createComponent(fluff: UnitFluffCatalogEntry) {
        dataService.getUnitFluff.and.resolveTo(fluff);

        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({
            name: 'Awesome AWS-8Q',
            id: 1,
            chassis: 'Awesome',
            model: 'AWS-8Q',
            fluff: fluff.img ? { img: fluff.img } : undefined,
        }));
        fixture.detectChanges();
        await settleMicrotasks();
        fixture.detectChanges();
        return fixture;
    }

    function getFluffText(element: HTMLElement, label: string): string | undefined {
        const section = Array.from(element.querySelectorAll('.fluff-section')).find(
            (candidate) => candidate.querySelector('.fluff-label')?.textContent?.trim() === label,
        );
        return section?.querySelector('.fluff-text')?.textContent ?? undefined;
    }

    it('does not use the centered image-only layout while catalog fluff is loading', async () => {
        let resolveFluff!: (fluff: UnitFluffCatalogEntry) => void;
        dataService.getUnitFluff.and.returnValue(new Promise<UnitFluffCatalogEntry>((resolve) => {
            resolveFluff = resolve;
        }));

        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({
            name: 'Awesome AWS-8Q',
            id: 1,
            chassis: 'Awesome',
            model: 'AWS-8Q',
            fluff: { img: 'awesome.png' },
        }));
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        expect(element.querySelector('.fluff-content')?.classList.contains('image-only')).toBeFalse();

        resolveFluff({ img: 'awesome.png' });
        await settleMicrotasks();
        fixture.detectChanges();

        expect(element.querySelector('.fluff-content')?.classList.contains('image-only')).toBeTrue();
    });

    it('groups paired manufacturers and primary factories under a combined section', async () => {
        const fixture = await createComponent({
            manufacturer: 'Earthwerks-FWL, Inc.|Bowie Industries|Bowie Industries|Diplass BattleMechs',
            primaryFactory: 'Calloway VI|Carlisle|Erdvynn|Hesperus II',
        });

        const element = fixture.nativeElement as HTMLElement;

        expect(getFluffText(element, 'Manufacturers and Primary Factories:')).toBe('Earthwerks-FWL, Inc. (Calloway VI)\nBowie Industries (Carlisle, Erdvynn)\nDiplass BattleMechs (Hesperus II)');
        expect(getFluffText(element, 'Manufacturers:')).toBeUndefined();
        expect(getFluffText(element, 'Primary Factories:')).toBeUndefined();
    });

    it('deduplicates separate manufacturer and primary factory entries when counts do not match', async () => {
        const fixture = await createComponent({
            manufacturer: ' Earthwerks-FWL, Inc. | Bowie Industries | Bowie Industries ',
            primaryFactory: ' Calloway VI | Carlisle | Carlisle | Erdvynn ',
        });

        const element = fixture.nativeElement as HTMLElement;

        expect(getFluffText(element, 'Manufacturers:')).toBe('Earthwerks-FWL, Inc.\nBowie Industries');
        expect(getFluffText(element, 'Primary Factories:')).toBe('Calloway VI, Carlisle, Erdvynn');
        expect(getFluffText(element, 'Manufacturers and Primary Factories:')).toBeUndefined();
    });
});
