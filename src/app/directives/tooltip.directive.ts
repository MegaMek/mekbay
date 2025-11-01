import { Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { TooltipComponent } from '../components/tooltip/tooltip.component';

@Directive({
    selector: '[tooltip]',
    standalone: true,
})
export class TooltipDirective implements OnDestroy {
    @Input('tooltip') tooltipText: string | null = null;
    @Input() tooltipDelay = 400; // ms

    private overlay = inject(Overlay);
    private host = inject(ElementRef<HTMLElement>);
    private overlayRef: OverlayRef | null = null;
    private showTimeout: any = null;
    private isVisible = false;

    constructor() {
        const el = this.host.nativeElement;

        el.addEventListener('pointerover', this.onPointerOver, { passive: true });
        el.addEventListener('pointerout', this.onPointerOut, { passive: true });
        el.addEventListener('pointerdown', this.onPointerDown, { passive: true });
        el.addEventListener('pointercancel', this.hideImmediate, { passive: true });
    }

    private onPointerOver = (ev: PointerEvent) => {
        if (ev.pointerType === 'touch') return;
        const related = ev.relatedTarget as Node | null;
        // if coming from inside the host, ignore (it's an internal transition)
        if (related && this.host.nativeElement.contains(related)) return;
        this.queueShow(ev);
    };

    private onPointerDown = (ev: PointerEvent) => {
        if (ev.pointerType === 'touch') {
            this.queueShow(ev, 250);
        }
    };

    // pointerout bubbles; ignore internal moves by checking relatedTarget
    private onPointerOut = (ev?: PointerEvent) => {
        if (ev) {
            const related = ev.relatedTarget as Node | null;
            if (related && this.host.nativeElement.contains(related)) return;
        }
        this.clearShowTimeout();
        this.hideImmediate();
    };

    private onPointerLeave = (ev?: PointerEvent) => {
        this.clearShowTimeout();
        this.hideImmediate();
    };

    private queueShow(ev: PointerEvent, delayOverride?: number) {
        this.clearShowTimeout();
        const delay = typeof delayOverride === 'number' ? delayOverride : this.tooltipDelay;
        this.showTimeout = setTimeout(() => {
            this.show(ev);
        }, delay);
    }

    private clearShowTimeout() {
        if (this.showTimeout) {
            clearTimeout(this.showTimeout);
            this.showTimeout = null;
        }
    }

    private show(ev: PointerEvent) {
        if (!this.tooltipText) return;
        if (this.isVisible) return;

        // create overlay positioned relative to host native element
        const position = this.overlay.position()
            .flexibleConnectedTo(this.host.nativeElement)
            .withPositions([
                {
                    originX: 'center',
                    originY: 'top',
                    overlayX: 'center',
                    overlayY: 'bottom',
                    offsetY: -8
                },
                {
                    originX: 'center',
                    originY: 'bottom',
                    overlayX: 'center',
                    overlayY: 'top',
                    offsetY: 8
                }
            ])
            .withFlexibleDimensions(false)
            .withPush(true)
            .withViewportMargin(12);

        this.overlayRef = this.overlay.create({
            positionStrategy: position,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            hasBackdrop: false,
            panelClass: 'tooltip-panel'
        });

        const portal = new ComponentPortal(TooltipComponent);
        const compRef = this.overlayRef.attach(portal);
        compRef.instance.text = this.tooltipText;
        // ensure OnPush component renders immediately
        compRef.changeDetectorRef.detectChanges();

        this.isVisible = true;

        // hide on pointerdown anywhere (so touch will dismiss) or on detach
        const onDocumentPointerDown = (dEv: PointerEvent) => {
            if (!this.host.nativeElement.contains(dEv.target as Node)) {
                this.hideImmediate();
            }
        };
        document.addEventListener('pointerdown', onDocumentPointerDown, { passive: true });

        // use overlayElement (CDK) rather than hostElement
        const overlayEl = this.overlayRef!.overlayElement;
        overlayEl.addEventListener('pointerdown', this.hideImmediate, { passive: true });

        // cleanup when overlay detaches
        const cleanup = () => {
            document.removeEventListener('pointerdown', onDocumentPointerDown as any);
            overlayEl.removeEventListener('pointerdown', this.hideImmediate as any);
        };
        this.overlayRef!.detachments().subscribe(cleanup);
    }

    private hideImmediate = () => {
        if (this.overlayRef) {
            try {
                this.overlayRef.dispose();
            } catch { /* ignore */ }
            this.overlayRef = null;
        }
        this.isVisible = false;
    };

    ngOnDestroy(): void {
        this.clearShowTimeout();
        this.hideImmediate();
        const el = this.host.nativeElement;
        el.removeEventListener('pointerover', this.onPointerOver);
        el.removeEventListener('pointerout', this.onPointerOut);
        el.removeEventListener('pointerdown', this.onPointerDown);
        el.removeEventListener('pointercancel', this.hideImmediate);
    }
}