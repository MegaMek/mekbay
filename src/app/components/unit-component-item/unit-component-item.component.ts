import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, input, signal, afterNextRender, Injector, inject, computed, ElementRef, viewChild, HostBinding } from '@angular/core';
import { Unit, UnitComponent } from '../../models/units.model';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { FloatingOverlayService } from '../../services/floating-overlay.service';

type ComponentDisplayStyle = 'normal' | 'small' | 'tiny' | 'text';

@Component({
    selector: 'unit-component-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-component-item.component.html',
    styleUrls: ['./unit-component-item.component.css']
})
export class UnitComponentItemComponent {
    injector = inject(Injector);
    public floatingOverlayService = inject(FloatingOverlayService);
    unit = input.required<Unit>();
    damaged = input<boolean>(false);
    comp = input<UnitComponent | null>(null);
    displayStyle = input<ComponentDisplayStyle>('normal');
    componentEl = viewChild.required<ElementRef<HTMLDivElement>>('component');

    typeClass = computed(() => {
        return getWeaponTypeCSSClass(this.comp()?.t ?? '');
    });

    @HostBinding('style.display') get hostDisplay() {
        return this.displayStyle?.() === 'text' ? 'inline' : 'block';
    }

    constructor() {}

    onCompClick(event: MouseEvent) {
        event.stopPropagation();
        event.preventDefault();
        this.showFloatingOverlay();
    }

    onPointerEnter(event: MouseEvent) {
        this.showFloatingOverlay();
    }

    showFloatingOverlay() {
        const el = this.componentEl().nativeElement;
        this.floatingOverlayService.show(this.unit(), this.comp(), el);
    }

    onPointerLeave() {
        this.floatingOverlayService.hideWithDelay();
    }

    onFloatingPointerLeave() {
        this.floatingOverlayService.hideWithDelay();
    }
}