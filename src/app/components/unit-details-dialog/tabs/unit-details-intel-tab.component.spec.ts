// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { UnitFluff } from '../../../models/unit-fluff.model';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { NativeUnitFluffService } from '../../../services/catalogs/native-unit-fluff.service';
import { UnitFluffImageService } from '../../../services/catalogs/unit-fluff-image.service';
import { UnitDetailsIntelTabComponent } from './unit-details-intel-tab.component';

describe('UnitDetailsIntelTabComponent', () => {
    let fluffImages: jasmine.SpyObj<Pick<UnitFluffImageService, 'resolveUrl'>>;
    let nativeFluff: jasmine.SpyObj<Pick<NativeUnitFluffService, 'load'>>;

    beforeEach(() => {
        fluffImages = jasmine.createSpyObj('UnitFluffImageService', ['resolveUrl']);
        nativeFluff = jasmine.createSpyObj('NativeUnitFluffService', ['load']);
        fluffImages.resolveUrl.and.returnValue(null);
        nativeFluff.load.and.resolveTo(undefined);

        TestBed.configureTestingModule({
            imports: [UnitDetailsIntelTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: UnitFluffImageService, useValue: fluffImages },
                { provide: NativeUnitFluffService, useValue: nativeFluff },
            ],
        });
    });

    async function createComponent(fluff?: UnitFluff, unit = testUnit()): Promise<ComponentFixture<UnitDetailsIntelTabComponent>> {
        nativeFluff.load.and.resolveTo(fluff);
        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();
        await settle(fixture);
        return fixture;
    }

    function getFluffText(element: HTMLElement, label: string): string | undefined {
        const section = Array.from(element.querySelectorAll('.fluff-section')).find(
            candidate => candidate.querySelector('.fluff-label')?.textContent?.trim() === label,
        );
        return section?.querySelector('.fluff-text')?.textContent ?? undefined;
    }

    it('shows a loading state while the native source read is pending', () => {
        nativeFluff.load.and.returnValue(new Promise(() => undefined));
        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', testUnit());
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent)
            .toContain('Loading intel');
    });

    it('keeps catalog-resolved artwork independent from an empty native fluff result', async () => {
        fluffImages.resolveUrl.and.returnValue('https://fluff.example.test/images/fluff/Mek/Awesome.png');
        const fixture = await createComponent(undefined);
        const element = fixture.nativeElement as HTMLElement;

        expect(nativeFluff.load).toHaveBeenCalledTimes(1);
        expect(element.querySelector('.fluff-content')?.classList.contains('image-only')).toBeTrue();
        expect(element.querySelector('img')?.getAttribute('src')).toContain('/images/fluff/Mek/Awesome.png');
        expect(element.querySelector('.no-fluff')).toBeNull();
    });

    it('renders an empty state when native fluff and artwork are absent', async () => {
        const fixture = await createComponent(undefined);
        expect((fixture.nativeElement as HTMLElement).querySelector('.no-fluff')?.textContent)
            .toContain('No intel available');
    });

    it('renders a failed native read without hiding independently resolved artwork', async () => {
        fluffImages.resolveUrl.and.returnValue('https://fluff.example.test/images/fluff/Mek/Awesome.png');
        nativeFluff.load.and.rejectWith(new Error('read failed'));
        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', testUnit());
        fixture.detectChanges();
        await settle(fixture);
        const element = fixture.nativeElement as HTMLElement;

        expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
        expect(element.querySelector('img')).not.toBeNull();
    });

    it('ignores stale completion and failure when the unit changes in the same tab', async () => {
        const first = deferred<UnitFluff | undefined>();
        const second = deferred<UnitFluff | undefined>();
        nativeFluff.load.and.callFake(unit => unit.model === 'OLD' ? first.promise : second.promise);
        const fixture = TestBed.createComponent(UnitDetailsIntelTabComponent);
        fixture.componentRef.setInput('unit', testUnit('OLD'));
        fixture.detectChanges();

        fixture.componentRef.setInput('unit', testUnit('NEW'));
        fixture.detectChanges();
        second.resolve({ overview: 'New unit intel' });
        await settle(fixture);
        first.reject(new Error('stale failure'));
        await settle(fixture);

        const element = fixture.nativeElement as HTMLElement;
        expect(getFluffText(element, 'Overview:')).toBe('New unit intel');
        expect(element.querySelector('[role="alert"]')).toBeNull();
        expect(nativeFluff.load).toHaveBeenCalledTimes(2);
    });

    it('releases parsed fluff when the Intel tab is destroyed', async () => {
        const fixture = await createComponent({ overview: 'Transient intel' });
        const component = fixture.componentInstance;
        expect(component.fluff()?.overview).toBe('Transient intel');

        fixture.destroy();

        expect(component.fluff()).toBeUndefined();
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

    function testUnit(model = 'AWS-8Q'): UnitSummary {
        return createEmptyUnit({ name: `Awesome ${model}`, chassis: 'Awesome', model });
    }

    async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
    }

    function deferred<T>(): {
        readonly promise: Promise<T>;
        readonly resolve: (value: T) => void;
        readonly reject: (reason?: unknown) => void;
    } {
        let resolve!: (value: T) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    }
});
