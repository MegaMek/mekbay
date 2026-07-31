import { Directive, ElementRef, InjectionToken, OnDestroy, afterRenderEffect, inject, input } from '@angular/core';

const DEFAULT_MIN_FONT_SCALE = 0.55;
const DEFAULT_MIN_TEXT_CHARACTERS = 12;
const FIT_EPSILON = 0.01;
const WIDTH_CHANGE_EPSILON = 0.5;
let measurementContext: CanvasRenderingContext2D | null | undefined;

function getMeasurementContext(): CanvasRenderingContext2D | null {
    if (measurementContext === undefined) {
        measurementContext = document.createElement('canvas').getContext('2d');
    }
    return measurementContext;
}

export type AutoFitResizeObserverFactory = (callback: ResizeObserverCallback) => ResizeObserver | null;
export const AUTO_FIT_RESIZE_OBSERVER_FACTORY = new InjectionToken<AutoFitResizeObserverFactory>(
    'AUTO_FIT_RESIZE_OBSERVER_FACTORY',
    {
        factory: () => callback => typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(callback),
    },
);

export interface TextFitResult {
    fontScale: number;
    wraps: boolean;
}

export function hasTextFitWidthChanged(previousWidth: number | null, nextWidth: number): boolean {
    if (!Number.isFinite(nextWidth) || nextWidth < 0) return false;
    return previousWidth === null || Math.abs(nextWidth - previousWidth) >= WIDTH_CHANGE_EPSILON;
}

export function shouldAutoFitText(text: unknown, minCharacters = DEFAULT_MIN_TEXT_CHARACTERS): boolean {
    const safeMinimum = Number.isFinite(minCharacters)
        ? Math.max(0, Math.ceil(minCharacters))
        : DEFAULT_MIN_TEXT_CHARACTERS;
    const textLength = String(text ?? '').trim().length;
    return textLength > 0 && textLength >= safeMinimum;
}

/**
 * Calculates a readable font scale for a single line of text. Text that still
 * cannot fit at the minimum scale is allowed to wrap instead of being clipped.
 */
export function calculateTextFit(
    availableWidth: number,
    naturalWidth: number,
    minFontScale = DEFAULT_MIN_FONT_SCALE,
): TextFitResult {
    const safeMinimum = Number.isFinite(minFontScale)
        ? Math.min(1, Math.max(0.1, minFontScale))
        : DEFAULT_MIN_FONT_SCALE;

    if (!Number.isFinite(availableWidth)
        || !Number.isFinite(naturalWidth)
        || availableWidth <= 0
        || naturalWidth <= 0
        || naturalWidth <= availableWidth + FIT_EPSILON) {
        return { fontScale: 1, wraps: false };
    }

    const requiredScale = availableWidth / naturalWidth;
    if (requiredScale + FIT_EPSILON >= safeMinimum) {
        return { fontScale: Math.min(1, requiredScale), wraps: false };
    }

    return { fontScale: safeMinimum, wraps: true };
}

/** Shrinks plain table text when practical, with wrapping as a readable fallback. */
@Directive({
    selector: '[mbAutoFitText]',
    standalone: true,
})
export class AutoFitTextDirective implements OnDestroy {
    readonly text = input<unknown>('', { alias: 'mbAutoFitText' });
    readonly revision = input<unknown>(0, { alias: 'mbAutoFitTextRevision' });
    readonly minFontScale = input(DEFAULT_MIN_FONT_SCALE, { alias: 'mbAutoFitTextMinScale' });
    readonly minCharacters = input(DEFAULT_MIN_TEXT_CHARACTERS, { alias: 'mbAutoFitTextMinCharacters' });
    readonly observeWidth = input(true, { alias: 'mbAutoFitTextObserveWidth' });

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly resizeObserverFactory = inject(AUTO_FIT_RESIZE_OBSERVER_FACTORY);
    private readonly afterRenderRef = afterRenderEffect(() => {
        const text = this.text();
        this.revision();
        this.minFontScale();
        const minCharacters = this.minCharacters();
        const observeWidth = this.observeWidth();
        if (!shouldAutoFitText(text, minCharacters)) {
            this.stopObservingWidth();
            this.resetStyles();
            return;
        }

        if (observeWidth) {
            this.startObservingWidth();
        } else {
            this.stopObservingWidth();
        }
        this.measure();
    });
    private destroyed = false;
    private resizeObserver: ResizeObserver | null = null;
    private observedWidth: number | null = null;

    ngOnDestroy(): void {
        this.destroyed = true;
        this.stopObservingWidth();
        this.afterRenderRef.destroy();
    }

    private stopObservingWidth(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.observedWidth = null;
    }

    private startObservingWidth(): void {
        if (this.destroyed || this.resizeObserver) return;

        const element = this.host.nativeElement;
        this.observedWidth = element.getBoundingClientRect().width;
        const resizeObserver = this.resizeObserverFactory(entries => {
            const entry = entries.find(item => item.target === element);
            if (!entry || !hasTextFitWidthChanged(this.observedWidth, entry.contentRect.width)) return;

            this.observedWidth = entry.contentRect.width;
            this.measure();
        });
        if (!resizeObserver) return;

        this.resizeObserver = resizeObserver;
        resizeObserver.observe(element);
    }

    private measure(): void {
        if (this.destroyed) return;
        const element = this.host.nativeElement;
        if (!element.isConnected || !shouldAutoFitText(this.text(), this.minCharacters())) {
            this.resetStyles();
            return;
        }

        const availableWidth = element.clientWidth;
        this.observedWidth = element.getBoundingClientRect().width;
        const computedStyle = getComputedStyle(element);
        const baseFontSize = this.resolveBaseFontSize(element, computedStyle);
        const naturalWidth = this.measureNaturalWidth(element.textContent ?? '', computedStyle, baseFontSize);
        if (availableWidth <= 0 || !Number.isFinite(baseFontSize) || baseFontSize <= 0) {
            this.resetStyles();
            return;
        }

        const fit = calculateTextFit(availableWidth, naturalWidth, this.minFontScale());
        element.style.fontSize = fit.fontScale < 1
            ? `${baseFontSize * fit.fontScale}px`
            : '';
        element.style.whiteSpace = fit.wraps ? 'normal' : 'nowrap';
    }

    private resolveBaseFontSize(element: HTMLElement, computedStyle: CSSStyleDeclaration): number {
        const inlineFontSize = element.style.fontSize;
        if (!inlineFontSize) return Number.parseFloat(computedStyle.fontSize);

        element.style.fontSize = '';
        const baseFontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        element.style.fontSize = inlineFontSize;
        return baseFontSize;
    }

    private measureNaturalWidth(text: string, style: CSSStyleDeclaration, baseFontSize: number): number {
        const context = getMeasurementContext();
        if (!context) return 0;

        context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${baseFontSize}px ${style.fontFamily}`;
        const letterSpacing = Number.parseFloat(style.letterSpacing);
        const spacingWidth = Number.isFinite(letterSpacing) ? Math.max(0, text.length - 1) * letterSpacing : 0;
        return context.measureText(text).width + spacingWidth;
    }

    private resetStyles(): void {
        const element = this.host.nativeElement;
        element.style.fontSize = '';
        element.style.whiteSpace = '';
    }
}
