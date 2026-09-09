// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewerStageComponent } from './viewer-stage.component';

@Component({
    imports: [ViewerStageComponent],
    template: `
        <viewer-stage [swiping]="swiping" [multipleVisible]="multipleVisible" [atMinZoom]="atMinZoom">
            <div class="projected-content"></div>
            <div class="page-wrapper selected"><svg class="mekbay-sheet"></svg></div>
        </viewer-stage>
    `
})
class TestHostComponent {
    swiping = false;
    multipleVisible = false;
    atMinZoom = false;
}

describe('ViewerStageComponent', () => {
    let fixture: ComponentFixture<TestHostComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestHostComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(TestHostComponent);
    });

    it('projects content into the stage container', () => {
        fixture.detectChanges();

        const stage = fixture.nativeElement.querySelector('.page-viewer-container') as HTMLDivElement | null;

        expect(stage).not.toBeNull();
        expect(stage?.querySelector('.projected-content')).not.toBeNull();
    });

    it('outlines selected projected and imperative pages only when multiple pages are visible', () => {
        fixture.componentInstance.multipleVisible = true;
        fixture.detectChanges();
        const stage = fixture.nativeElement.querySelector('.page-viewer-container') as HTMLDivElement;
        const projected = stage.querySelector<SVGSVGElement>('svg')!;
        const wrapper = document.createElement('div');
        wrapper.classList.add('page-wrapper', 'selected');
        const imperative = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        imperative.classList.add('mekbay-sheet');
        wrapper.appendChild(imperative);
        stage.appendChild(wrapper);
        const sheets = [projected, imperative];
        expect(stage.classList.contains('multiple-visible')).toBeTrue();
        for (const svg of sheets) {
            expect(getComputedStyle(svg).outlineStyle).toBe('solid');
            expect(getComputedStyle(svg).outlineWidth).toBe('4px');
            expect(getComputedStyle(svg).outlineOffset).toBe('-4px');
            svg.parentElement!.classList.remove('selected');
            expect(getComputedStyle(svg).outlineStyle).toBe('none');
            svg.parentElement!.classList.add('selected');
        }
        const preview = imperative.cloneNode(true) as SVGSVGElement;
        stage.appendChild(preview);
        expect(getComputedStyle(preview).outlineStyle).toBe('none');
        stage.classList.remove('multiple-visible');
        for (const svg of sheets) expect(getComputedStyle(svg).outlineStyle).toBe('none');
    });

    it('reflects wrapper state through declarative classes', () => {
        const host = fixture.componentInstance;
        host.swiping = true;
        host.multipleVisible = true;
        host.atMinZoom = true;

        fixture.detectChanges();

        const stage = fixture.nativeElement.querySelector('.page-viewer-container') as HTMLDivElement;

        expect(stage.classList.contains('swiping')).toBeTrue();
        expect(stage.classList.contains('multiple-visible')).toBeTrue();
        expect(stage.classList.contains('at-min-zoom')).toBeTrue();
    });
});
