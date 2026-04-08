import { ApplicationRef, Injectable, Injector, createComponent, type ComponentRef } from '@angular/core';

import type { CBTForce } from '../../../models/cbt-force.model';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../page-viewer-zoom-pan.service';
import { PageCanvasOverlayComponent } from '../canvas';
import { PageInteractionOverlayComponent } from '../overlay';

function applyAbsoluteFillLayout(element: HTMLElement): void {
    element.style.position = 'absolute';
    element.style.top = '0';
    element.style.left = '0';
    element.style.width = '100%';
    element.style.height = '100%';
}

@Injectable()
export class PageViewerOverlayService {
    private canvasOverlayRefs = new Map<string, ComponentRef<PageCanvasOverlayComponent>>();
    private canvasOverlaySubscriptions = new Map<string, { unsubscribe: () => void }>();
    private interactionOverlayRefs = new Map<string, ComponentRef<PageInteractionOverlayComponent>>();
    private interactionOverlayModes = new Map<string, 'fixed' | 'page'>();

    getOrCreateCanvasOverlay(options: {
        appRef: ApplicationRef;
        injector: Injector;
        pageWrapper: HTMLDivElement;
        unit: CBTForceUnit;
        onDrawingStarted: (unit: CBTForceUnit) => void;
    }): ComponentRef<PageCanvasOverlayComponent> {
        const { appRef, injector, pageWrapper, unit, onDrawingStarted } = options;
        const existingRef = this.canvasOverlayRefs.get(unit.id);
        if (existingRef) {
            const canvasElement = existingRef.location.nativeElement as HTMLElement;
            pageWrapper.appendChild(canvasElement);
            return existingRef;
        }

        const componentRef = createComponent(PageCanvasOverlayComponent, {
            environmentInjector: appRef.injector,
            elementInjector: injector
        });

        componentRef.setInput('unit', unit);
        componentRef.setInput('width', PAGE_WIDTH);
        componentRef.setInput('height', PAGE_HEIGHT);

        const subscription = componentRef.instance.drawingStarted.subscribe((drawnUnit) => {
            onDrawingStarted(drawnUnit as CBTForceUnit);
        });

        this.canvasOverlaySubscriptions.set(unit.id, subscription);
        appRef.attachView(componentRef.hostView);

        const canvasElement = componentRef.location.nativeElement as HTMLElement;
        applyAbsoluteFillLayout(canvasElement);
        pageWrapper.appendChild(canvasElement);

        this.canvasOverlayRefs.set(unit.id, componentRef);
        return componentRef;
    }

    cleanupUnusedCanvasOverlays(appRef: ApplicationRef, keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];

        this.canvasOverlayRefs.forEach((ref, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                const subscription = this.canvasOverlaySubscriptions.get(unitId);
                if (subscription) {
                    subscription.unsubscribe();
                    this.canvasOverlaySubscriptions.delete(unitId);
                }
                appRef.detachView(ref.hostView);
                ref.destroy();
                toRemove.push(unitId);
            }
        });

        toRemove.forEach((unitId) => this.canvasOverlayRefs.delete(unitId));
    }

    cleanupCanvasOverlays(appRef: ApplicationRef): void {
        this.canvasOverlaySubscriptions.forEach((subscription) => subscription.unsubscribe());
        this.canvasOverlaySubscriptions.clear();

        this.canvasOverlayRefs.forEach((ref) => {
            appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.canvasOverlayRefs.clear();
    }

    getOrCreateInteractionOverlay(options: {
        appRef: ApplicationRef;
        injector: Injector;
        pageWrapper: HTMLDivElement;
        fixedOverlayContainer: HTMLDivElement;
        unit: CBTForceUnit;
        force: CBTForce | null;
        mode: 'fixed' | 'page';
    }): ComponentRef<PageInteractionOverlayComponent> {
        const { appRef, injector, pageWrapper, fixedOverlayContainer, unit, force, mode } = options;
        const targetContainer = mode === 'fixed' ? fixedOverlayContainer : pageWrapper;
        const existingRef = this.interactionOverlayRefs.get(unit.id);
        const existingMode = this.interactionOverlayModes.get(unit.id);

        if (existingRef) {
            if (existingMode !== mode) {
                existingRef.setInput('mode', mode);
                this.interactionOverlayModes.set(unit.id, mode);
            }

            const overlayElement = existingRef.location.nativeElement as HTMLElement;
            applyAbsoluteFillLayout(overlayElement);
            targetContainer.appendChild(overlayElement);
            return existingRef;
        }

        const componentRef = createComponent(PageInteractionOverlayComponent, {
            environmentInjector: appRef.injector,
            elementInjector: injector
        });

        componentRef.setInput('unit', unit);
        componentRef.setInput('force', force);
        componentRef.setInput('mode', mode);

        appRef.attachView(componentRef.hostView);

        const overlayElement = componentRef.location.nativeElement as HTMLElement;
        applyAbsoluteFillLayout(overlayElement);
        targetContainer.appendChild(overlayElement);

        this.interactionOverlayRefs.set(unit.id, componentRef);
        this.interactionOverlayModes.set(unit.id, mode);
        return componentRef;
    }

    cleanupUnusedInteractionOverlays(appRef: ApplicationRef, keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];

        this.interactionOverlayRefs.forEach((ref, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                appRef.detachView(ref.hostView);
                ref.destroy();
                toRemove.push(unitId);
            }
        });

        toRemove.forEach((unitId) => {
            this.interactionOverlayRefs.delete(unitId);
            this.interactionOverlayModes.delete(unitId);
        });
    }

    cleanupInteractionOverlays(appRef: ApplicationRef): void {
        this.interactionOverlayRefs.forEach((ref) => {
            appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.interactionOverlayRefs.clear();
        this.interactionOverlayModes.clear();
    }

    closeInteractionOverlays(): void {
        this.interactionOverlayRefs.forEach((ref) => {
            ref.instance.closeAllOverlays();
        });
    }

    getCanvasOverlayElements(unitIds: readonly string[]): HTMLElement[] {
        return unitIds
            .map((unitId) => this.canvasOverlayRefs.get(unitId)?.location.nativeElement as HTMLElement | undefined)
            .filter((element): element is HTMLElement => !!element && element.isConnected);
    }
}