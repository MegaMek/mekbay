import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewerStageComponent } from './viewer-stage.component';

@Component({
    standalone: true,
    imports: [ViewerStageComponent],
    template: `
        <viewer-stage [swiping]="swiping" [multipleVisible]="multipleVisible" [atMinZoom]="atMinZoom">
            <div class="projected-content"></div>
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