import { Component, ChangeDetectionStrategy, inject, input, output, TemplateRef, ViewChild, ElementRef, ViewContainerRef, computed, signal, viewChild, DestroyRef, effect } from '@angular/core';

import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { LayoutService } from '../../../../services/layout.service';
import { takeUntil } from 'rxjs';

export type Phase = 'movement' | 'weapon' | 'physical' | 'heat';

@Component({
    selector: 'mb-phase-selector',
    standalone: true,
    imports: [],
    templateUrl: './phase-selector.component.html',
    styleUrls: ['./phase-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhaseSelectorComponent {
    private overlay = inject(Overlay);
    private vcr = inject(ViewContainerRef);
    private layout = inject(LayoutService);

    selected = input<Phase>('movement');
    phaseSelected = output<Phase>();

    private overlayRef: OverlayRef | null = null;
    dropdownOpen = signal(false);

    toggleBtn = viewChild<ElementRef<HTMLElement>>('toggleBtn');
    menuTpl = viewChild<TemplateRef<unknown>>('menuTpl');

    isCompact = computed(() => {
        return this.layout.windowWidth() < 700;
    });

    constructor() {
        effect(() => {
            if (!this.isCompact() && this.dropdownOpen()) {
                this.closeDropdown();
            }
        });
        inject(DestroyRef).onDestroy(() => {
            if (this.overlayRef) {
                this.overlayRef.dispose();
                this.overlayRef = null;
            }
        });
  }

    getPhaseLabel(phase: Phase): string {
        switch (phase) {
            case 'movement': return 'Movement';
            case 'weapon': return 'Weapon Attack';
            case 'physical': return 'Physical Attack';
            case 'heat': return 'Heat';
        }
    }

    toggleDropdown(ev: MouseEvent) {
        ev.stopPropagation();
        if (this.dropdownOpen()) {
            this.closeDropdown();
            return;
        }
        const origin = this.toggleBtn()?.nativeElement;
        if (!origin) return;

        const positionStrategy = this.overlay.position()
            .flexibleConnectedTo(origin)
            .withFlexibleDimensions(false)
            .withPush(true)
            .withPositions([
                { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 4 },
                { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -4 },
            ]);

        this.overlayRef = this.overlay.create({
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-transparent-backdrop',
            positionStrategy,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            panelClass: 'mb-phase-dropdown-panel',
        });

        const tpl = this.menuTpl();
        if (!tpl) {
            this.overlayRef.detach();
            this.overlayRef.dispose();
            this.overlayRef = null;
            return;
        }

        this.overlayRef.attach(new TemplatePortal(tpl, this.vcr));
        this.overlayRef.backdropClick().pipe(takeUntil(this.overlayRef.detachments())).subscribe(() => this.closeDropdown());
        this.overlayRef.keydownEvents().pipe(takeUntil(this.overlayRef.detachments())).subscribe(e => {
            if (e.key === 'Escape') this.closeDropdown();
        });

        this.dropdownOpen.set(true);
    }

    closeDropdown() {
        if (this.overlayRef) {
            this.overlayRef.detach();
            this.overlayRef.dispose();
            this.overlayRef = null;
        }
        this.dropdownOpen.set(false);
    }

    choose(phase: Phase) {
        this.phaseSelected.emit(phase);
        this.closeDropdown();
    }

    clickPhase(phase: Phase, ev: MouseEvent) {
        ev.stopPropagation();
        this.phaseSelected.emit(phase);
    }
}