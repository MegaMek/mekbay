// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface SvgTextLineWriterOptions {
    readonly maxWidth?: number | null;
    readonly ellipsis?: string;
    readonly allowFinalLineOverflow?: boolean;
    readonly measure?: (line: SVGTextContentElement, text: string) => number;
}

const SVG_TEXT_TAGS = new Set(['text', 'tspan']);
const SVG_TEXT_METRICS_CACHE_LIMIT = 1024;

interface SvgTextMetricsCache {
    context: CanvasRenderingContext2D | null;
    font: string;
    widths: Map<string, number>;
}

const svgTextMetricsCaches = new WeakMap<Document, SvgTextMetricsCache>();

export function getSvgTextLines(container: Element | null | undefined): SVGTextContentElement[] {
    if (!container) return [];

    const directLines = getDirectSvgTextLines(container);
    if (directLines.length > 0) {
        if (directLines.length === 1 && directLines[0].tagName.toLocaleLowerCase() === 'text') {
            const nestedLines = getDirectSvgTextLines(directLines[0]);
            if (nestedLines.length > 0) return nestedLines;
        }
        return directLines;
    }

    return SVG_TEXT_TAGS.has(container.tagName.toLocaleLowerCase())
        ? [container as SVGTextContentElement]
        : [];
}

export function writeSvgTextLines(
    container: Element | null | undefined,
    text: string,
    options: SvgTextLineWriterOptions = {},
): void {
    const lines = getSvgTextLines(container);
    if (lines.length === 0) return;

    const normalizedText = text.trim();
    const maxWidth = Number.isFinite(options.maxWidth) ? options.maxWidth! : null;
    const ellipsis = options.ellipsis ?? '...';
    const measure = options.measure ?? measureSvgText;
    const renderedLines = wrapSvgText(
        lines,
        normalizedText,
        maxWidth,
        ellipsis,
        options.allowFinalLineOverflow ?? false,
        measure,
    );

    lines.forEach((line, index) => {
        line.textContent = (renderedLines[index] ?? '').trim();
    });
}

export function measureSvgTextCanvas(line: SVGTextContentElement, text: string): number {
    const canvasDocument = line.ownerDocument.defaultView?.document ?? document;
    const cache = getSvgTextMetricsCache(canvasDocument);
    const computedStyle = line.ownerDocument.defaultView?.getComputedStyle(line) ?? null;
    const fontSize = Number.parseFloat(line.getAttribute('font-size') ?? computedStyle?.fontSize ?? '') || 8;
    const fontWeight = line.getAttribute('font-weight') ?? computedStyle?.fontWeight ?? 'normal';
    const rawFontStyle = line.getAttribute('font-style') ?? computedStyle?.fontStyle ?? 'normal';
    const fontStyle = ['normal', 'italic', 'oblique'].includes(rawFontStyle) ? rawFontStyle : 'normal';
    const fontFamily = line.getAttribute('font-family') ?? computedStyle?.fontFamily ?? 'Roboto';
    const font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    const fontStatus = canvasDocument.fonts?.status ?? 'unknown';
    const cacheKey = `${fontStatus}\u0000${font}\u0000${text}`;
    const cachedWidth = cache.widths.get(cacheKey);
    if (cachedWidth !== undefined) {
        cache.widths.delete(cacheKey);
        cache.widths.set(cacheKey, cachedWidth);
        return cachedWidth;
    }

    if (!cache.context) {
        const width = text.length * fontSize * 0.7;
        rememberSvgTextWidth(cache, cacheKey, width);
        return width;
    }

    if (cache.font !== font) {
        cache.context.font = font;
        cache.font = font;
    }
    const width = cache.context.measureText(text).width;
    rememberSvgTextWidth(cache, cacheKey, width);
    return width;
}

function getDirectSvgTextLines(container: Element): SVGTextContentElement[] {
    return Array.from(container.children)
        .filter(child => SVG_TEXT_TAGS.has(child.tagName.toLocaleLowerCase()))
        .map(child => child as SVGTextContentElement);
}

function getSvgTextMetricsCache(canvasDocument: Document): SvgTextMetricsCache {
    const existing = svgTextMetricsCaches.get(canvasDocument);
    if (existing) return existing;

    const cache = {
        context: canvasDocument.createElement('canvas').getContext('2d'),
        font: '',
        widths: new Map<string, number>(),
    };
    svgTextMetricsCaches.set(canvasDocument, cache);
    return cache;
}

function rememberSvgTextWidth(cache: SvgTextMetricsCache, key: string, width: number): void {
    if (cache.widths.size >= SVG_TEXT_METRICS_CACHE_LIMIT) {
        const oldestKey = cache.widths.keys().next().value;
        if (oldestKey !== undefined) cache.widths.delete(oldestKey);
    }
    cache.widths.set(key, width);
}

function wrapSvgText(
    lines: readonly SVGTextContentElement[],
    text: string,
    maxWidth: number | null,
    ellipsis: string,
    allowFinalLineOverflow: boolean,
    measure: (line: SVGTextContentElement, text: string) => number,
): string[] {
    const renderedLines = lines.map(() => '');
    if (!text) return renderedLines;
    if (maxWidth === null) {
        renderedLines[0] = text;
        return renderedLines;
    }

    const words = text.split(/\s+/);
    let wordIndex = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (wordIndex >= words.length) break;

        const line = lines[lineIndex];
        const isLastLine = lineIndex === lines.length - 1;
        if (isLastLine) {
            const remaining = words.slice(wordIndex).join(' ');
            renderedLines[lineIndex] = allowFinalLineOverflow
                ? remaining
                : truncateSvgText(line, remaining, maxWidth, ellipsis, measure);
            break;
        }

        let lineText = '';
        while (wordIndex < words.length) {
            const candidate = lineText ? `${lineText} ${words[wordIndex]}` : words[wordIndex];
            if (!fitsSvgText(line, candidate, maxWidth, measure)) break;
            lineText = candidate;
            wordIndex++;
        }

        if (!lineText) {
            renderedLines[lineIndex] = truncateSvgText(
                line,
                words.slice(wordIndex).join(' '),
                maxWidth,
                ellipsis,
                measure,
            );
            break;
        }
        renderedLines[lineIndex] = lineText;
    }

    return renderedLines;
}

function truncateSvgText(
    line: SVGTextContentElement,
    text: string,
    maxWidth: number,
    ellipsis: string,
    measure: (line: SVGTextContentElement, text: string) => number,
): string {
    if (fitsSvgText(line, text, maxWidth, measure)) return text;
    if (!fitsSvgText(line, ellipsis, maxWidth, measure)) return ellipsis;

    const characters = Array.from(text);
    let low = 0;
    let high = characters.length;
    while (low < high) {
        const midpoint = Math.ceil((low + high) / 2);
        const candidate = `${characters.slice(0, midpoint).join('').trimEnd()}${ellipsis}`;
        if (fitsSvgText(line, candidate, maxWidth, measure)) {
            low = midpoint;
        } else {
            high = midpoint - 1;
        }
    }

    return `${characters.slice(0, low).join('').trimEnd()}${ellipsis}`;
}

function fitsSvgText(
    line: SVGTextContentElement,
    text: string,
    maxWidth: number,
    measure: (line: SVGTextContentElement, text: string) => number,
): boolean {
    return measure(line, text) <= maxWidth;
}

function measureSvgText(line: SVGTextContentElement, text: string): number {
    const originalText = line.textContent;
    line.textContent = text;
    try {
        try {
            const computedWidth = line.getComputedTextLength();
            if (computedWidth > 0) return computedWidth;
        } catch {
            // Fall through to the bounding box and character-width estimates.
        }

        try {
            const boundingBoxWidth = (line as SVGGraphicsElement).getBBox().width;
            if (boundingBoxWidth > 0) return boundingBoxWidth;
        } catch {
            // SVGs without a layout box still get a conservative estimate below.
        }

        const fontSize = Number.parseFloat(line.getAttribute('font-size') ?? '') || 8;
        return text.length * fontSize * 0.7;
    } finally {
        line.textContent = originalText;
    }
}
