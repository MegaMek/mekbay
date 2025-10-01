/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Component, input, ElementRef, ViewChild, AfterViewInit, OnDestroy, Renderer2, HostListener, Injector, signal, EffectRef, effect, inject, ChangeDetectionStrategy, computed, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ForceUnit } from '../../models/force-unit.model';
import { SvgZoomPanService, SwipeCallbacks } from './svg-zoom-pan.service';
import { SvgInteractionService } from './svg-interaction.service';
import { ForceBuilderService } from '../../services/force-builder.service';

/*
 * Author: Drake
 */
@Component({
    selector: 'svg-viewer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    providers: [SvgZoomPanService, SvgInteractionService],
    templateUrl: './svg-viewer.component.html',
    styleUrls: ['./svg-viewer.component.css']
})
export class SvgViewerComponent implements AfterViewInit, OnDestroy {
    protected injector = inject(Injector);
    private renderer = inject(Renderer2);
    private zoomPanService = inject(SvgZoomPanService);
    private interactionService = inject(SvgInteractionService);
    private forceBuilder = inject(ForceBuilderService);
    unit = input<ForceUnit | null>(null);

    @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLDivElement>;
    @ViewChild('slides', { static: true }) slidesRef!: ElementRef<HTMLDivElement>;
    @ViewChild('diffHeatMarker', { static: true }) diffHeatMarkerRef!: ElementRef<HTMLDivElement>;
    @ViewChild('diffHeatArrow', { static: true }) diffHeatArrowRef!: ElementRef<HTMLDivElement>;
    @ViewChild('diffHeatText', { static: true }) diffHeatTextRef!: ElementRef<HTMLDivElement>;

    loadError = signal<string | null>(null);
    svgWidth = 0;
    svgHeight = 0;
    containerWidth = 0;
    containerHeight = 0;

    private unitChangeEffectRef: EffectRef | null = null;
    private sheetChangeEffectRef: EffectRef | null = null;
    private currentSvg = signal<SVGSVGElement | null>(null);

    // Slides/swipe state
    private currentSlideEl: HTMLDivElement | null = null;
    private prevSlideEl: HTMLDivElement | null = null;
    private nextSlideEl: HTMLDivElement | null = null;
    private swipeStarted = false;
    private swipeActive = false;
    private swipeOffsetX = 0;

    private prevUnit: ForceUnit | null = null;
    private nextUnit: ForceUnit | null = null;
    private prevSvg: SVGSVGElement | null = null;
    private nextSvg: SVGSVGElement | null = null;

    // Signals for picker state
    private isPickerOpen = signal(false);

    // Interaction mode and visibility signals from interaction service
    get interactionMode() {
        return this.interactionService.getState().interactionMode;
    }

    get diffHeatMarkerVisible() {
        return this.interactionService.getState().diffHeatMarkerVisible;
    }

    hasMultipleSheets = computed(() => {
        const unit = this.unit();
        return unit ? unit.getSheetCount() > 1 : false;
    });

    currentSheetName = computed(() => {
        const unit = this.unit();
        if (!unit || unit.getSheetCount() < 2) return '';
        const index = unit.currentSheetIndex();
        return index === 0 ? 'Front' : 'Back';
    });

    private resizeTimeout: any = null;

    constructor() {
        // Watch for unit changes using effect instead of ngOnChanges
        let previousUnit: ForceUnit | null = null;
        this.unitChangeEffectRef = effect(async () => {
            const currentUnit = this.unit();
            await currentUnit?.load();

            // If there was a previous unit, save its view state
            if (previousUnit && previousUnit !== currentUnit) {
                this.saveViewState(previousUnit);
            }
            
            this.interactionService.updateUnit(currentUnit);
            this.displaySvg();
            previousUnit = currentUnit;
        }, { injector: this.injector });

        this.sheetChangeEffectRef = effect(() => {
        const currentUnit = this.unit();
        if (currentUnit) {
            // Only track the sheet index change, not the unit change
            const sheetIndex = currentUnit.currentSheetIndex();
            
            // Use untracked to read the unit without making this effect depend on unit changes
            untracked(() => {
                const svg = currentUnit.getCurrentSvg();
                this.currentSvg.set(svg);
                this.displaySvg();
                console.log('Sheet changed to index', sheetIndex);
            });
        }
        }, { injector: this.injector });
    }

    @HostListener('window:resize', ['$event'])
    onWindowResize(event: Event) {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => {
            this.handleResize();
            this.resizeTimeout = null;
        }, 150); // 150ms debounce
    }

    ngAfterViewInit() {
        // Monitor container size changes
        if ('ResizeObserver' in window) {
            const resizeObserver = new ResizeObserver(() => this.handleResize());
            resizeObserver.observe(this.containerRef.nativeElement);
        }

        const swipeCallbacks: SwipeCallbacks = {
            onSwipeStart: () => this.onSwipeStart(),
            onSwipeMove: (totalDx: number) => this.onSwipeMove(totalDx),
            onSwipeEnd: (totalDx: number) => this.onSwipeEnd(totalDx),
        };

        // Initialize services
        this.zoomPanService.initialize(this.containerRef, this.isPickerOpen, swipeCallbacks);
        this.interactionService.initialize(
            this.containerRef,
            this.unit(),
            this.injector,
            this.diffHeatMarkerRef,
            this.diffHeatArrowRef,
            this.diffHeatTextRef
        );

        // Monitor picker open state
        effect(() => {
            const pickerOpen = this.interactionService.isAnyPickerOpen();
            this.isPickerOpen.set(pickerOpen);
        }, { injector: this.injector });
    }

    // Lifecycle hooks implementation for base class
    protected saveViewState(unit: ForceUnit): void {
        const viewState = this.zoomPanService.getViewState();
        unit.viewState = {
            scale: viewState.scale,
            translateX: viewState.translateX,
            translateY: viewState.translateY
        };
    }

    protected svgDimensionsUpdated(): void {
        this.zoomPanService.updateDimensions(
            this.svgWidth,
            this.svgHeight,
            this.containerWidth,
            this.containerHeight
        );
    }

    protected restoreViewState(): void {
        const viewState = this.unit()?.viewState || null;
        this.zoomPanService.restoreViewState(viewState);
    }

    protected setupSvgEvents(svg: SVGSVGElement): void {
        // Setup zoom and pan event listeners
        this.zoomPanService.setupEventListeners(svg);

        // Prevent context menu
        svg.addEventListener('contextmenu', (event: MouseEvent) => event.preventDefault());
    }

    protected setupInteractions(svg: SVGSVGElement): void {
        // Setup all interaction handlers
        this.interactionService.setupInteractions(svg);
    }

    ngOnDestroy() {
        // Cleanup effects
        if (this.unitChangeEffectRef) {
            this.unitChangeEffectRef.destroy();
        }
        if (this.sheetChangeEffectRef) {
            this.sheetChangeEffectRef.destroy();
        }

        // Cleanup services
        this.interactionService.cleanup();
    }


    displaySvg(): void {
        const currentUnit = this.unit();
        const slides = this.slidesRef.nativeElement;
        slides.innerHTML = ''; // Clear previous slides
        this.currentSvg.set(null);
        this.loadError.set(null);
        this.currentSlideEl = null;
        this.prevSlideEl = null;
        this.nextSlideEl = null;
        this.swipeStarted = false;
        this.swipeActive = false;
        this.swipeOffsetX = 0;

        if (!currentUnit) {
            return; // No unit selected
        }

        const svg = currentUnit.getCurrentSvg();
        if (svg) {
            // Wrap current svg in a slide
            const slide = this.createSlide();
            slide.appendChild(svg);
            slides.appendChild(slide);
            this.currentSlideEl = slide;

            this.currentSvg.set(svg);

            // Setup events for the newly attached SVG
            this.setupSvgEvents(svg);            
            this.setupInteractions(svg);

            // Update dimensions and restore view state
            this.updateDimensions();
            this.svgDimensionsUpdated();
            this.restoreViewState();

        } else {
            this.loadError.set('Loading record sheet...');
        }
    }

    switchToNextSheet(): void {
        const unit = this.unit();
        if (unit && unit.getSheetCount() > 1) {
            // Save current view state before switching
            this.saveViewState(unit);
            unit.switchToNextSheet();
        }
    }

    retryLoad() {
        const unit = this.unit();
        if (unit) {
            // Force reload
            unit.svgs.set([]);
            unit.load();
        }
    }

    protected updateDimensions() {
        const svg = this.unit()?.getCurrentSvg();
        const container = this.containerRef.nativeElement;

        if (svg) {
            const widthAttr = svg.width.baseVal;
            const heightAttr = svg.height.baseVal;

            if (svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0) {
                this.svgWidth = svg.viewBox.baseVal.width;
                this.svgHeight = svg.viewBox.baseVal.height;
            } else {
                this.svgWidth = widthAttr.value;
                this.svgHeight = heightAttr.value;
            }
        }

        this.containerWidth = container.clientWidth;
        this.containerHeight = container.clientHeight;
    }
    
    protected handleResize() {
        const container = this.containerRef.nativeElement;

        // Update container dimensions
        this.containerWidth = container.clientWidth;
        this.containerHeight = container.clientHeight;

        // Update dimensions in zoom pan service
        this.zoomPanService.updateDimensions(
            this.svgWidth,
            this.svgHeight,
            this.containerWidth,
            this.containerHeight
        );

        // Handle resize in zoom pan service
        this.zoomPanService.handleResize();
    }

    // Helpers for slides/swipe
    private createSlide(): HTMLDivElement {
        const el = this.renderer.createElement('div') as HTMLDivElement;
        this.renderer.addClass(el, 'slide');
        return el;
    }

    private setSlideX(el: HTMLElement, x: number, animate = false) {
        if (animate) {
            el.style.transition = 'transform 250ms ease-out';
        } else {
            el.style.transition = 'none';
        }
        el.style.transform = `translateX(${x}px)`;
    }

    private async preloadNeighbors() {
        const current = this.unit();
        let prevUnit: ForceUnit | null = null;
        let nextUnit: ForceUnit | null = null;
        let prevSvg: SVGSVGElement | null = null;
        let nextSvg: SVGSVGElement | null = null;

        if (current) {
            prevUnit = this.forceBuilder.getPreviousUnit(current);
            nextUnit = this.forceBuilder.getNextUnit(current);

            if (prevUnit) {
                await prevUnit.load();
                prevSvg = prevUnit.getFrontSvg() ?? null;
            }
            if (nextUnit) {
                await nextUnit.load();
                nextSvg = nextUnit.getFrontSvg() ?? null;
            }
        }

        if (this.prevUnit !== prevUnit) this.prevUnit = prevUnit;
        if (this.nextUnit !== nextUnit) this.nextUnit = nextUnit;
        if (this.prevSvg !== prevSvg) this.prevSvg = prevSvg;
        if (this.nextSvg !== nextSvg) this.nextSvg = nextSvg;
    }

    private ensureNeighborSlides(direction: 'prev' | 'next') {
        const slides = this.slidesRef.nativeElement;
        const width = this.containerWidth;
        const state = this.zoomPanService.getState();
        if (direction === 'prev') {
            if (!this.prevSvg || !this.prevUnit) return;
            if (!this.prevSlideEl) {
                const slide = this.createSlide();
                slide.appendChild(this.prevSvg);
                slides.appendChild(slide);
                this.prevSlideEl = slide;
                this.setSlideX(this.prevSlideEl, -width, false);
                const scaledWidth = (this.prevSvg.viewBox.baseVal.width) * state.minScale;
                const scaledHeight = (this.prevSvg.viewBox.baseVal.height) * state.minScale;
                const maxX = Math.max(0, (this.containerWidth - scaledWidth) / 2);
                const maxY = Math.max(0, (this.containerHeight - scaledHeight) / 2);
                const minX = this.containerWidth - scaledWidth - maxX;
                const minY = this.containerHeight - scaledHeight - maxY;
                this.prevSvg.style.transform = `translate(${minX}px,${minY}px) scale(${state.minScale})`;
                this.prevSvg.style.transformOrigin = 'top left';
            }
        } else {
            if (!this.nextSvg || !this.nextUnit) return;
            if (!this.nextSlideEl) {
                const slide = this.createSlide();
                // If nextUnit is the same as prevUnit, clone the SVG so we can visualize the loop
                const svgToAppend = (this.nextUnit === this.prevUnit) ? this.nextSvg.cloneNode(true) as SVGSVGElement : this.nextSvg;
                slide.appendChild(svgToAppend);
                slides.appendChild(slide);
                this.nextSlideEl = slide;
                this.setSlideX(this.nextSlideEl, width, false);
                const scaledWidth = (this.nextSvg.viewBox.baseVal.width) * state.minScale;
                const scaledHeight = (this.nextSvg.viewBox.baseVal.height) * state.minScale;
                const maxX = Math.max(0, (this.containerWidth - scaledWidth) / 2);
                const maxY = Math.max(0, (this.containerHeight - scaledHeight) / 2);
                const minX = this.containerWidth - scaledWidth - maxX;
                const minY = this.containerHeight - scaledHeight - maxY;
                this.nextSvg.style.transform = `translate(${minX}px,${minY}px) scale(${state.minScale})`;
                this.nextSvg.style.transformOrigin = 'top left';
            }
        }
    }

    private async onSwipeStart() {
        if (this.forceBuilder.forceUnits().length < 2) return; // No swipe if only one unit
        this.swipeStarted = true;
        await this.preloadNeighbors();
        if (!this.swipeStarted) return;
        if (!this.currentSlideEl) return;
        this.swipeActive = true;
        this.swipeOffsetX = 0;

        // Prepare both neighbors if available to avoid first-move lag
        if (this.prevUnit && this.prevSvg) {
            this.ensureNeighborSlides('prev');
        }
        if (this.nextUnit && this.nextSvg) {
            this.ensureNeighborSlides('next');
        }

        // Disable transitions while dragging
        this.setSlideX(this.currentSlideEl, 0, false);
        if (this.prevSlideEl) this.setSlideX(this.prevSlideEl, -this.containerWidth, false);
        if (this.nextSlideEl) this.setSlideX(this.nextSlideEl, this.containerWidth, false);
    }

    private onSwipeMove(totalDx: number) {
        if (!this.swipeActive || !this.currentSlideEl) return;

        this.swipeOffsetX = totalDx;

        // Determine direction and ensure target slide is ready
        if (totalDx > 0) {
            // Swiping right -> show prev from left
            this.ensureNeighborSlides('prev');
        } else if (totalDx < 0) {
            // Swiping left -> show next from right
            this.ensureNeighborSlides('next');
        }

        // Follow the finger
        this.setSlideX(this.currentSlideEl, this.swipeOffsetX, false);
        if (this.prevSlideEl) {
            this.setSlideX(this.prevSlideEl, -this.containerWidth + this.swipeOffsetX, false);
        }
        if (this.nextSlideEl) {
            this.setSlideX(this.nextSlideEl, this.containerWidth + this.swipeOffsetX, false);
        }
    }

    private onSwipeEnd(totalDx: number) {
        this.swipeStarted = false;
        if (!this.swipeActive || !this.currentSlideEl) return;

        const width = this.containerWidth || 1;
        const threshold = width * 0.5;
        const commitPrev = totalDx > threshold && !!this.prevSlideEl && !!this.prevUnit;
        const commitNext = totalDx < -threshold && !!this.nextSlideEl && !!this.nextUnit;

        if (commitPrev) {
            const currentViewState = this.zoomPanService.getViewState();
            this.prevUnit!.viewState = {
                scale: currentViewState.scale,
                translateX: currentViewState.translateX,
                translateY: currentViewState.translateY
            };
            this.prevUnit!.currentSheetIndex.set(0); // Always show front sheet when switching
            // Animate commit to prev (current -> right, prev -> center)
            this.setSlideX(this.currentSlideEl, width, true);
            if (this.prevSlideEl) this.setSlideX(this.prevSlideEl, 0, true);

            const onDone = () => {            
                this.currentSlideEl = this.prevSlideEl;
                this.prevSlideEl = null;
                this.cleanupSlides();
                // Switch unit after animation completes
                this.forceBuilder.selectPreviousUnit();
            };
            this.awaitTransitionEnd(this.currentSlideEl, onDone);
            return;
        }

        if (commitNext) {
            const currentViewState = this.zoomPanService.getViewState();
            this.nextUnit!.viewState = {
                scale: currentViewState.scale,
                translateX: currentViewState.translateX,
                translateY: currentViewState.translateY
            };
            this.nextUnit!.currentSheetIndex.set(0); // Always show front sheet when switching

            
            // Animate commit to next (current -> left, next -> center)
            this.setSlideX(this.currentSlideEl, -width, true);
            if (this.nextSlideEl) this.setSlideX(this.nextSlideEl, 0, true);

            const onDone = () => {
                this.currentSlideEl = this.nextSlideEl;
                this.nextSlideEl = null;
                this.cleanupSlides();
                // Switch unit after animation completes
                this.forceBuilder.selectNextUnit();
            };
            this.awaitTransitionEnd(this.currentSlideEl, onDone);
            return;
        }

        // Cancel swipe: animate back to original
        this.setSlideX(this.currentSlideEl, 0, true);
        if (this.prevSlideEl) this.setSlideX(this.prevSlideEl, -width, true);
        if (this.nextSlideEl) this.setSlideX(this.nextSlideEl, width, true);

        const onCancelDone = () => this.cleanupSlides(false);
        this.awaitTransitionEnd(this.currentSlideEl, onCancelDone);
    }

    private awaitTransitionEnd(el: HTMLElement, cb: () => void) {
        const handler = () => {
            el.removeEventListener('transitionend', handler);
            // Next frame to ensure layout is stable
            requestAnimationFrame(cb);
        };
        el.addEventListener('transitionend', handler, { once: true });
    }

    private cleanupSlides(keepCurrent = true) {
        this.swipeActive = false;
        this.swipeOffsetX = 0;

        const slides = this.slidesRef.nativeElement;

        // Remove neighbor slides from DOM if present
        if (this.prevSlideEl && this.prevSlideEl.parentElement === slides) {
            // Do not detach the SVG permanently; it'll be re-attached by displaySvg as needed
            this.prevSlideEl.innerHTML = '';
            slides.removeChild(this.prevSlideEl);
        }
        if (this.nextSlideEl && this.nextSlideEl.parentElement === slides) {
            this.nextSlideEl.innerHTML = '';
            slides.removeChild(this.nextSlideEl);
        }
        this.prevSlideEl = null;
        this.nextSlideEl = null;

        // Reset current slide transform if keeping
        if (keepCurrent && this.currentSlideEl) {
            this.setSlideX(this.currentSlideEl, 0, false);
        }
    }
}