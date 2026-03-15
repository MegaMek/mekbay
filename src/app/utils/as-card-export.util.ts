/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { type ApplicationRef, type ComponentRef, createComponent, EnvironmentInjector, type Injector } from '@angular/core';
import html2canvas from 'html2canvas';
import { AlphaStrikeCardComponent } from '../components/alpha-strike-card/alpha-strike-card.component';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { Unit } from '../models/units.model';
import type { OptionsService } from '../services/options.service';

const CARD_BASE_WIDTH = 1120;
const CARD_BASE_HEIGHT = 800;
const DEFAULT_JPEG_QUALITY = 0.92;
const EXPORT_EXCLUDED_SELECTORS = [
    '.crit-roll-button',
    '.commit-overlay',
    '.destroyed-overlay',
    '[data-export-exclude="true"]',
];

export interface ContainedRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface AlphaStrikeCardExportRenderOptions {
    forceUnit?: ASForceUnit;
    unit?: Unit;
    cardIndex?: number;
    useHex?: boolean;
    cardStyle?: 'colored' | 'monochrome';
}

export interface AlphaStrikeCardJpegExportOptions extends AlphaStrikeCardExportRenderOptions {
    width: number;
    height: number;
    quality?: number;
    backgroundColor?: string;
    externalImagePolicy?: 'omit' | 'error';
}

export function fitRectWithinBounds(
    sourceWidth: number,
    sourceHeight: number,
    boundsWidth: number,
    boundsHeight: number,
): ContainedRect {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
        throw new Error('Source dimensions must be positive.');
    }
    if (boundsWidth <= 0 || boundsHeight <= 0) {
        throw new Error('Target dimensions must be positive.');
    }

    const scale = Math.min(boundsWidth / sourceWidth, boundsHeight / sourceHeight);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);

    return {
        x: Math.floor((boundsWidth - width) / 2),
        y: Math.floor((boundsHeight - height) / 2),
        width,
        height,
    };
}

/*
 * Author: Copilot
 */
export class ASCardExportUtil {
    private static readonly imageDataUrlCache = new Map<string, Promise<string>>();

    public static async renderCardToSvgObjectUrl(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        options: AlphaStrikeCardExportRenderOptions & { externalImagePolicy?: 'omit' | 'error' },
    ): Promise<string | null> {
        const useHex = options.useHex ?? optionsService.options().ASUseHex;
        const cardStyle = options.cardStyle ?? optionsService.options().ASCardStyle;
        const mount = this.createOffscreenMount(CARD_BASE_WIDTH, CARD_BASE_HEIGHT);
        const environmentInjector = injector.get(EnvironmentInjector);
        const componentRef = createComponent(AlphaStrikeCardComponent, {
            environmentInjector,
            elementInjector: injector,
        });

        try {
            componentRef.setInput('forceUnit', options.forceUnit);
            componentRef.setInput('unit', options.unit);
            componentRef.setInput('cardIndex', options.cardIndex ?? 0);
            componentRef.setInput('useHex', useHex);
            componentRef.setInput('cardStyle', cardStyle);
            componentRef.setInput('interactive', false);
            componentRef.setInput('isSelected', false);
            componentRef.setInput('exportMode', true);

            appRef.attachView(componentRef.hostView);

            const cardElement = componentRef.location.nativeElement as HTMLElement;
            cardElement.style.width = `${CARD_BASE_WIDTH}px`;
            cardElement.style.height = `${CARD_BASE_HEIGHT}px`;

            mount.appendChild(cardElement);
            document.body.appendChild(mount);
            appRef.tick();

            await this.waitForStableRender(mount);

            if (!this.shouldUseSvgExport(cardElement)) {
                return null;
            }

            const svgMarkup = await this.renderElementToSvgMarkup(cardElement, options.externalImagePolicy ?? 'omit');
            const objectUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
            return objectUrl;
        } finally {
            appRef.detachView(componentRef.hostView);
            componentRef.destroy();
            mount.remove();
        }
    }

    public static async exportCardToJpeg(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        options: AlphaStrikeCardJpegExportOptions,
    ): Promise<Blob> {
        const { width, height } = options;
        if (width <= 0 || height <= 0) {
            throw new Error('Export dimensions must be positive.');
        }

        const renderRect = fitRectWithinBounds(CARD_BASE_WIDTH, CARD_BASE_HEIGHT, width, height);
        const renderWidth = Math.max(1, renderRect.width);
        const renderHeight = Math.max(1, renderRect.height);
        const useHex = options.useHex ?? optionsService.options().ASUseHex;
        const cardStyle = options.cardStyle ?? optionsService.options().ASCardStyle;
        const mount = this.createOffscreenMount(renderWidth, renderHeight);
        const environmentInjector = injector.get(EnvironmentInjector);
        const componentRef = createComponent(AlphaStrikeCardComponent, {
            environmentInjector,
            elementInjector: injector,
        });

        try {
            componentRef.setInput('forceUnit', options.forceUnit);
            componentRef.setInput('unit', options.unit);
            componentRef.setInput('cardIndex', options.cardIndex ?? 0);
            componentRef.setInput('useHex', useHex);
            componentRef.setInput('cardStyle', cardStyle);
            componentRef.setInput('interactive', false);
            componentRef.setInput('isSelected', false);
            componentRef.setInput('exportMode', true);

            appRef.attachView(componentRef.hostView);

            const cardElement = componentRef.location.nativeElement as HTMLElement;
            cardElement.style.width = `${renderWidth}px`;
            cardElement.style.height = `${renderHeight}px`;

            mount.appendChild(cardElement);
            document.body.appendChild(mount);
            appRef.tick();

            await this.waitForStableRender(mount);

            return await this.exportElementToJpeg(cardElement, {
                width,
                height,
                quality: options.quality ?? DEFAULT_JPEG_QUALITY,
                backgroundColor: options.backgroundColor ?? '#ffffff',
                externalImagePolicy: options.externalImagePolicy ?? 'omit',
            });
        } finally {
            appRef.detachView(componentRef.hostView);
            componentRef.destroy();
            mount.remove();
        }
    }

    public static async downloadCardAsJpeg(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        options: AlphaStrikeCardJpegExportOptions,
        fileName: string,
    ): Promise<void> {
        const blob = await this.exportCardToJpeg(appRef, injector, optionsService, options);
        const objectUrl = URL.createObjectURL(blob);

        try {
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = fileName;
            anchor.click();
        } finally {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        }
    }

    public static async openCardJpegInNewTab(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        options: AlphaStrikeCardJpegExportOptions,
        fileName: string,
        previewWindow: Window,
    ): Promise<void> {
        this.preparePreviewWindow(previewWindow, fileName);

        const blob = await this.exportCardToJpeg(appRef, injector, optionsService, options);
        const objectUrl = URL.createObjectURL(blob);
        this.navigatePreviewWindow(previewWindow, objectUrl, fileName);
    }

    private static async exportElementToJpeg(
        sourceElement: HTMLElement,
        options: Required<Pick<AlphaStrikeCardJpegExportOptions, 'width' | 'height' | 'quality' | 'backgroundColor' | 'externalImagePolicy'>>,
    ): Promise<Blob> {
        if (this.shouldUseSvgExport(sourceElement)) {
            return await this.exportElementToJpegViaSvg(sourceElement, options);
        }

        return await this.exportElementToJpegViaHtml2Canvas(sourceElement, options);
    }

    private static shouldUseSvgExport(sourceElement: HTMLElement): boolean {
        return sourceElement.querySelector('as-layout-standard') !== null;
    }

    private static async exportElementToJpegViaSvg(
        sourceElement: HTMLElement,
        options: Required<Pick<AlphaStrikeCardJpegExportOptions, 'width' | 'height' | 'quality' | 'backgroundColor' | 'externalImagePolicy'>>,
    ): Promise<Blob> {
        const sourceRect = sourceElement.getBoundingClientRect();
        const sourceWidth = Math.max(1, Math.round(sourceRect.width));
        const sourceHeight = Math.max(1, Math.round(sourceRect.height));
        const clone = sourceElement.cloneNode(true) as HTMLElement;

        clone.style.width = `${sourceWidth}px`;
        clone.style.height = `${sourceHeight}px`;
        clone.style.maxWidth = 'none';

        await this.inlineImages(sourceElement, clone, options.externalImagePolicy);
        this.removeExcludedExportElements(clone);

        const renderHost = this.createDetachedRenderHost(sourceWidth, sourceHeight);
        renderHost.appendChild(clone);
        document.body.appendChild(renderHost);

        try {
            const svgMarkup = await this.renderElementToSvgMarkup(sourceElement, options.externalImagePolicy, clone, renderHost);
            const renderedCanvas = await this.renderSvgToCanvas(svgMarkup, sourceWidth, sourceHeight);

            const canvas = document.createElement('canvas');
            canvas.width = options.width;
            canvas.height = options.height;

            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Failed to create export canvas.');
            }

            context.fillStyle = options.backgroundColor;
            context.fillRect(0, 0, canvas.width, canvas.height);

            const drawRect = fitRectWithinBounds(sourceWidth, sourceHeight, canvas.width, canvas.height);
            context.drawImage(renderedCanvas, drawRect.x, drawRect.y, drawRect.width, drawRect.height);

            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', options.quality);
            });
            if (!blob) {
                throw new Error('Canvas JPEG export failed.');
            }

            return blob;
        } finally {
            renderHost.remove();
        }
    }

    private static async exportElementToJpegViaHtml2Canvas(
        sourceElement: HTMLElement,
        options: Required<Pick<AlphaStrikeCardJpegExportOptions, 'width' | 'height' | 'quality' | 'backgroundColor' | 'externalImagePolicy'>>,
    ): Promise<Blob> {
        const sourceRect = sourceElement.getBoundingClientRect();
        const sourceWidth = Math.max(1, Math.round(sourceRect.width));
        const sourceHeight = Math.max(1, Math.round(sourceRect.height));
        const clone = sourceElement.cloneNode(true) as HTMLElement;

        clone.style.width = `${sourceWidth}px`;
        clone.style.height = `${sourceHeight}px`;
        clone.style.maxWidth = 'none';

        await this.inlineComputedStyles(sourceElement, clone, options.externalImagePolicy);
        await this.inlineImages(sourceElement, clone, options.externalImagePolicy);
        this.removeExcludedExportElements(clone);

        const renderHost = this.createDetachedRenderHost(sourceWidth, sourceHeight);
        renderHost.appendChild(clone);
        document.body.appendChild(renderHost);

        try {
            await this.waitForImagesToLoad(renderHost);
            this.applyExportLayoutFixups(sourceElement, clone);
            await this.nextAnimationFrames(2);

            const renderedCanvas = await html2canvas(clone, {
                backgroundColor: null,
                scale: 1,
                useCORS: false,
                allowTaint: false,
                logging: false,
                imageTimeout: 4000,
                width: sourceWidth,
                height: sourceHeight,
                foreignObjectRendering: false,
            });

            const canvas = document.createElement('canvas');
            canvas.width = options.width;
            canvas.height = options.height;

            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Failed to create export canvas.');
            }

            context.fillStyle = options.backgroundColor;
            context.fillRect(0, 0, canvas.width, canvas.height);

            const drawRect = fitRectWithinBounds(sourceWidth, sourceHeight, canvas.width, canvas.height);
            context.drawImage(renderedCanvas, drawRect.x, drawRect.y, drawRect.width, drawRect.height);

            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', options.quality);
            });
            if (!blob) {
                throw new Error('Canvas JPEG export failed.');
            }

            return blob;
        } finally {
            renderHost.remove();
        }
    }

    private static async renderElementToSvgMarkup(
        sourceElement: HTMLElement,
        externalImagePolicy: 'omit' | 'error',
        clone?: HTMLElement,
        renderHost?: HTMLElement,
    ): Promise<string> {
        const sourceRect = sourceElement.getBoundingClientRect();
        const sourceWidth = Math.max(1, Math.round(sourceRect.width));
        const sourceHeight = Math.max(1, Math.round(sourceRect.height));
        const localClone = clone ?? sourceElement.cloneNode(true) as HTMLElement;

        localClone.style.width = `${sourceWidth}px`;
        localClone.style.height = `${sourceHeight}px`;
        localClone.style.maxWidth = 'none';

        await this.inlineImages(sourceElement, localClone, externalImagePolicy);
        this.removeExcludedExportElements(localClone);

        const localRenderHost = renderHost ?? this.createDetachedRenderHost(sourceWidth, sourceHeight);
        if (!renderHost) {
            localRenderHost.appendChild(localClone);
            document.body.appendChild(localRenderHost);
        }

        try {
            await this.waitForImagesToLoad(localRenderHost);
            this.applySvgExportLayoutFixups(sourceElement, localClone);
            await this.nextAnimationFrames(2);
            return await this.serializeElementToSvg(localClone, sourceWidth, sourceHeight, externalImagePolicy);
        } finally {
            if (!renderHost) {
                localRenderHost.remove();
            }
        }
    }

    private static async serializeElementToSvg(
        root: HTMLElement,
        width: number,
        height: number,
        externalImagePolicy: 'omit' | 'error',
    ): Promise<string> {
        const rootRect = root.getBoundingClientRect();
        const defs: string[] = [];
        const content: string[] = [];
        const backgroundAssetCache = new Map<string, string>();
        const context = {
            rootRect,
            defs,
            content,
            backgroundAssetCache,
            nextId: 0,
            externalImagePolicy,
        };

        await this.serializeNodeToSvg(root, context, null);

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
            defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
            content.join(''),
            '</svg>',
        ].join('');
    }

    private static async renderSvgToCanvas(svgMarkup: string, width: number, height: number): Promise<HTMLCanvasElement> {
        const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);

        try {
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load SVG export image.'));
                img.src = objectUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Failed to create SVG rasterization canvas.');
            }

            context.drawImage(image, 0, 0, width, height);
            return canvas;
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    private static async serializeNodeToSvg(
        node: Node,
        context: {
            rootRect: DOMRect;
            defs: string[];
            content: string[];
            backgroundAssetCache: Map<string, string>;
            nextId: number;
            externalImagePolicy: 'omit' | 'error';
        },
        inheritedClipId: string | null,
    ): Promise<void> {
        if (node instanceof Text) {
            await this.serializeTextNodeToSvg(node, context, inheritedClipId);
            return;
        }

        if (!(node instanceof Element)) {
            return;
        }

        if (!this.isRenderableElement(node)) {
            return;
        }

        if (node instanceof SVGSVGElement) {
            const imageTag = this.buildSerializedSvgImage(node, context.rootRect, inheritedClipId);
            if (imageTag) {
                context.content.push(imageTag);
            }
            return;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }

        const x = rect.left - context.rootRect.left;
        const y = rect.top - context.rootRect.top;
        const width = rect.width;
        const height = rect.height;
        const computedStyle = getComputedStyle(node);

        const ownClipId = this.createClipPathIfNeeded(node, x, y, width, height, computedStyle, context);
        const activeClipId = ownClipId ?? inheritedClipId;

        const boxMarkup = await this.buildElementBoxMarkup(node, x, y, width, height, computedStyle, activeClipId, context);
        if (boxMarkup) {
            context.content.push(boxMarkup);
        }

        if (node instanceof HTMLImageElement) {
            const imageMarkup = this.buildHtmlImageMarkup(node, x, y, width, height, computedStyle, activeClipId);
            if (imageMarkup) {
                context.content.push(imageMarkup);
            }
            return;
        }

        for (const child of Array.from(node.childNodes)) {
            await this.serializeNodeToSvg(child, context, activeClipId);
        }
    }

    private static isRenderableElement(element: Element): boolean {
        const computedStyle = getComputedStyle(element);
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
            return false;
        }

        if (element instanceof HTMLElement && element.hidden) {
            return false;
        }

        return true;
    }

    private static createClipPathIfNeeded(
        element: Element,
        x: number,
        y: number,
        width: number,
        height: number,
        computedStyle: CSSStyleDeclaration,
        context: {
            defs: string[];
            nextId: number;
        },
    ): string | null {
        const overflowX = computedStyle.overflowX;
        const overflowY = computedStyle.overflowY;
        const requiresClip = ['hidden', 'clip'].includes(overflowX) || ['hidden', 'clip'].includes(overflowY);
        if (!requiresClip) {
            return null;
        }

        const clipId = `as-export-clip-${context.nextId++}`;
        const radius = this.readCornerRadius(computedStyle, width, height);
        context.defs.push(`<clipPath id="${clipId}">${this.buildRoundedRectMarkup(x, y, width, height, radius, 'none', null, 0)}</clipPath>`);
        return clipId;
    }

    private static async buildElementBoxMarkup(
        element: Element,
        x: number,
        y: number,
        width: number,
        height: number,
        computedStyle: CSSStyleDeclaration,
        clipId: string | null,
        context: {
            defs: string[];
            backgroundAssetCache: Map<string, string>;
            nextId: number;
            externalImagePolicy: 'omit' | 'error';
        },
    ): Promise<string> {
        const opacity = this.readOpacity(computedStyle.opacity);
        const radius = this.readCornerRadius(computedStyle, width, height);
        const layers: string[] = [];

        const backgroundColor = computedStyle.backgroundColor;
        if (!this.isTransparentColor(backgroundColor)) {
            layers.push(this.buildRoundedRectMarkup(x, y, width, height, radius, backgroundColor, clipId, opacity));
        }

        const backgroundImage = computedStyle.backgroundImage;
        if (backgroundImage && backgroundImage !== 'none') {
            const backgroundMarkup = await this.buildBackgroundImageMarkup(
                element,
                x,
                y,
                width,
                height,
                computedStyle,
                clipId,
                opacity,
                context,
            );
            if (backgroundMarkup) {
                layers.push(backgroundMarkup);
            }
        }

        const borderMarkup = this.buildBorderMarkup(x, y, width, height, computedStyle, radius, clipId, opacity);
        if (borderMarkup) {
            layers.push(borderMarkup);
        }

        return layers.join('');
    }

    private static buildBorderMarkup(
        x: number,
        y: number,
        width: number,
        height: number,
        computedStyle: CSSStyleDeclaration,
        radius: { rx: number; ry: number },
        clipId: string | null,
        opacity: number,
    ): string {
        const borderWidth = this.parsePixels(computedStyle.borderTopWidth);
        const borderColor = computedStyle.borderTopColor;
        const hasUniformBorder =
            borderWidth > 0
            && computedStyle.borderTopStyle !== 'none'
            && computedStyle.borderTopWidth === computedStyle.borderRightWidth
            && computedStyle.borderTopWidth === computedStyle.borderBottomWidth
            && computedStyle.borderTopWidth === computedStyle.borderLeftWidth
            && computedStyle.borderTopColor === computedStyle.borderRightColor
            && computedStyle.borderTopColor === computedStyle.borderBottomColor
            && computedStyle.borderTopColor === computedStyle.borderLeftColor;

        if (!hasUniformBorder || this.isTransparentColor(borderColor)) {
            return '';
        }

        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const opacityAttribute = opacity < 1 ? ` opacity="${opacity}"` : '';
        return `<rect x="${this.formatNumber(x + borderWidth / 2)}" y="${this.formatNumber(y + borderWidth / 2)}" width="${this.formatNumber(Math.max(0, width - borderWidth))}" height="${this.formatNumber(Math.max(0, height - borderWidth))}" rx="${this.formatNumber(Math.max(0, radius.rx - borderWidth / 2))}" ry="${this.formatNumber(Math.max(0, radius.ry - borderWidth / 2))}" fill="none" stroke="${this.escapeXml(borderColor)}" stroke-width="${this.formatNumber(borderWidth)}"${clipAttribute}${opacityAttribute}/>`;
    }

    private static async buildBackgroundImageMarkup(
        element: Element,
        x: number,
        y: number,
        width: number,
        height: number,
        computedStyle: CSSStyleDeclaration,
        clipId: string | null,
        opacity: number,
        context: {
            defs: string[];
            backgroundAssetCache: Map<string, string>;
            nextId: number;
            externalImagePolicy: 'omit' | 'error';
        },
    ): Promise<string> {
        const backgroundImage = computedStyle.backgroundImage;
        if (backgroundImage.startsWith('linear-gradient(')) {
            return this.buildLinearGradientMarkup(x, y, width, height, backgroundImage, clipId, opacity, context);
        }

        const urlMatch = backgroundImage.match(/url\((["']?)(.*?)\1\)/);
        if (!urlMatch?.[2]) {
            return '';
        }

        const sourceUrl = urlMatch[2].trim();
        const href = await this.resolveSvgAssetHref(sourceUrl, context.backgroundAssetCache, context.externalImagePolicy);
        if (!href) {
            return '';
        }

        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const opacityAttribute = opacity < 1 ? ` opacity="${opacity}"` : '';
        const size = this.readBackgroundSize(computedStyle.backgroundSize, width, height);
        const position = this.readBackgroundPosition(computedStyle.backgroundPosition, width, height, size.width, size.height);
        return `<image x="${this.formatNumber(x + position.x)}" y="${this.formatNumber(y + position.y)}" width="${this.formatNumber(size.width)}" height="${this.formatNumber(size.height)}" href="${this.escapeXml(href)}" preserveAspectRatio="none"${clipAttribute}${opacityAttribute}/>`;
    }

    private static buildLinearGradientMarkup(
        x: number,
        y: number,
        width: number,
        height: number,
        backgroundImage: string,
        clipId: string | null,
        opacity: number,
        context: {
            defs: string[];
            nextId: number;
        },
    ): string {
        const gradientId = `as-export-gradient-${context.nextId++}`;
        const match = backgroundImage.match(/^linear-gradient\((.*)\)$/);
        if (!match) {
            return '';
        }

        const tokens = match[1].split(/,(?![^()]*\))/).map((token) => token.trim());
        const direction = tokens[0].startsWith('to ') ? tokens.shift() ?? 'to bottom' : 'to bottom';
        const vector = direction.includes('right') ? { x1: '0%', y1: '0%', x2: '100%', y2: '0%' } : { x1: '0%', y1: '0%', x2: '0%', y2: '100%' };
        const stops = tokens.map((token, index) => {
            const stopMatch = token.match(/^(.*?)(\s+([\d.]+)(px|%))?$/);
            const color = stopMatch?.[1]?.trim() ?? token;
            const rawOffset = stopMatch?.[3];
            const unit = stopMatch?.[4] ?? '%';
            let offset = `${Math.round((index / Math.max(1, tokens.length - 1)) * 100)}%`;
            if (rawOffset) {
                offset = unit === '%' ? `${rawOffset}%` : `${(Number(rawOffset) / width) * 100}%`;
            }
            return `<stop offset="${offset}" stop-color="${this.escapeXml(color)}"/>`;
        });
        context.defs.push(`<linearGradient id="${gradientId}" x1="${vector.x1}" y1="${vector.y1}" x2="${vector.x2}" y2="${vector.y2}">${stops.join('')}</linearGradient>`);

        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const opacityAttribute = opacity < 1 ? ` opacity="${opacity}"` : '';
        return `<rect x="${this.formatNumber(x)}" y="${this.formatNumber(y)}" width="${this.formatNumber(width)}" height="${this.formatNumber(height)}" fill="url(#${gradientId})"${clipAttribute}${opacityAttribute}/>`;
    }

    private static buildHtmlImageMarkup(
        image: HTMLImageElement,
        x: number,
        y: number,
        width: number,
        height: number,
        computedStyle: CSSStyleDeclaration,
        clipId: string | null,
    ): string {
        const sourceUrl = image.currentSrc || image.src || image.getAttribute('src');
        if (!sourceUrl) {
            return '';
        }

        const objectFit = computedStyle.objectFit || 'fill';
        const objectPosition = computedStyle.objectPosition || '50% 50%';
        const fittedRect = this.fitImageWithinRect(
            width,
            height,
            image.naturalWidth || width,
            image.naturalHeight || height,
            objectFit,
            objectPosition,
        );
        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const opacity = this.readOpacity(computedStyle.opacity);
        const opacityAttribute = opacity < 1 ? ` opacity="${opacity}"` : '';
        return `<image x="${this.formatNumber(x + fittedRect.x)}" y="${this.formatNumber(y + fittedRect.y)}" width="${this.formatNumber(fittedRect.width)}" height="${this.formatNumber(fittedRect.height)}" href="${this.escapeXml(sourceUrl)}" preserveAspectRatio="none"${clipAttribute}${opacityAttribute}/>`;
    }

    private static buildSerializedSvgImage(svg: SVGSVGElement, rootRect: DOMRect, clipId: string | null): string {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return '';
        }

        const serializer = new XMLSerializer();
        const markup = serializer.serializeToString(svg);
        const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const x = rect.left - rootRect.left;
        const y = rect.top - rootRect.top;
        return `<image x="${this.formatNumber(x)}" y="${this.formatNumber(y)}" width="${this.formatNumber(rect.width)}" height="${this.formatNumber(rect.height)}" href="${href}" preserveAspectRatio="none"${clipAttribute}/>`;
    }

    private static async serializeTextNodeToSvg(
        node: Text,
        context: {
            rootRect: DOMRect;
            content: string[];
        },
        clipId: string | null,
    ): Promise<void> {
        const rawText = node.textContent ?? '';
        if (!rawText.trim()) {
            return;
        }

        const parentElement = node.parentElement;
        if (!parentElement || parentElement.closest('svg')) {
            return;
        }

        const fragments = this.measureTextFragments(node);
        if (fragments.length === 0) {
            return;
        }

        const computedStyle = getComputedStyle(parentElement);
        const fill = computedStyle.color;
        if (this.isTransparentColor(fill)) {
            return;
        }

        const opacity = this.readOpacity(computedStyle.opacity);
        const fontSize = this.parsePixels(computedStyle.fontSize);
        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const opacityAttribute = opacity < 1 ? ` opacity="${opacity}"` : '';
        const strokeColor = computedStyle.getPropertyValue('-webkit-text-stroke-color').trim();
        const strokeWidth = this.parsePixels(computedStyle.getPropertyValue('-webkit-text-stroke-width'));

        for (const fragment of fragments) {
            if (!fragment.text.trim()) {
                continue;
            }

            const relativeX = fragment.rect.left - context.rootRect.left;
            const relativeY = fragment.rect.top - context.rootRect.top;
            const anchor = this.readTextAnchor(computedStyle.textAlign);
            const textX = anchor === 'start'
                ? relativeX
                : anchor === 'middle'
                    ? relativeX + (fragment.rect.width / 2)
                    : relativeX + fragment.rect.width;
            const baselineY = relativeY + fragment.rect.height - Math.max(1, fontSize * 0.18);
            const strokeAttributes = strokeWidth > 0 && !this.isTransparentColor(strokeColor)
                ? ` stroke="${this.escapeXml(strokeColor)}" stroke-width="${this.formatNumber(strokeWidth)}" paint-order="stroke fill"`
                : '';

            context.content.push(
                `<text x="${this.formatNumber(textX)}" y="${this.formatNumber(baselineY)}" fill="${this.escapeXml(fill)}" font-family="${this.escapeXml(computedStyle.fontFamily)}" font-size="${this.escapeXml(computedStyle.fontSize)}" font-weight="${this.escapeXml(computedStyle.fontWeight)}" font-style="${this.escapeXml(computedStyle.fontStyle)}" letter-spacing="${this.escapeXml(computedStyle.letterSpacing)}" text-anchor="${anchor}"${strokeAttributes}${clipAttribute}${opacityAttribute}>${this.escapeXml(fragment.text)}</text>`,
            );
        }
    }

    private static measureTextFragments(node: Text): Array<{ text: string; rect: DOMRect }> {
        const text = node.textContent ?? '';
        if (!text) {
            return [];
        }

        const range = document.createRange();
        const fragments: Array<{ text: string; rect: DOMRect }> = [];
        let currentStart = 0;
        let currentRect: DOMRect | null = null;

        for (let index = 0; index < text.length; index++) {
            range.setStart(node, currentStart);
            range.setEnd(node, index + 1);
            const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
            const latestRect = rects.at(-1) ?? null;
            if (!latestRect) {
                continue;
            }

            if (!currentRect) {
                currentRect = latestRect;
                continue;
            }

            const sameLine = Math.abs(latestRect.top - currentRect.top) < 0.5 && Math.abs(latestRect.height - currentRect.height) < 0.5;
            if (!sameLine) {
                range.setStart(node, currentStart);
                range.setEnd(node, index);
                const finalizedText = range.toString();
                if (finalizedText) {
                    fragments.push({ text: finalizedText, rect: currentRect });
                }
                currentStart = index;
                currentRect = latestRect;
            } else {
                currentRect = latestRect;
            }
        }

        if (currentRect) {
            range.setStart(node, currentStart);
            range.setEnd(node, text.length);
            const finalizedText = range.toString();
            if (finalizedText) {
                fragments.push({ text: finalizedText, rect: currentRect });
            }
        }

        range.detach?.();
        return fragments;
    }

    private static async resolveSvgAssetHref(
        sourceUrl: string,
        cache: Map<string, string>,
        externalImagePolicy: 'omit' | 'error',
    ): Promise<string | null> {
        if (!sourceUrl) {
            return null;
        }

        if (sourceUrl.startsWith('data:') || sourceUrl.startsWith('blob:')) {
            return sourceUrl;
        }

        const absoluteUrl = new URL(sourceUrl, document.baseURI).toString();
        if (new URL(absoluteUrl).origin === window.location.origin) {
            return absoluteUrl;
        }

        const cached = cache.get(absoluteUrl);
        if (cached) {
            return cached;
        }

        try {
            const dataUrl = await this.fetchImageAsDataUrl(absoluteUrl);
            cache.set(absoluteUrl, dataUrl);
            return dataUrl;
        } catch (error) {
            if (externalImagePolicy === 'error') {
                throw new Error(`Failed to inline export asset: ${absoluteUrl}. ${(error as Error).message}`);
            }

            cache.set(absoluteUrl, '');
            return null;
        }
    }

    private static fitImageWithinRect(
        boxWidth: number,
        boxHeight: number,
        imageWidth: number,
        imageHeight: number,
        objectFit: string,
        objectPosition: string,
    ): ContainedRect {
        if (objectFit === 'fill' || imageWidth <= 0 || imageHeight <= 0) {
            return { x: 0, y: 0, width: boxWidth, height: boxHeight };
        }

        const contain = fitRectWithinBounds(imageWidth, imageHeight, boxWidth, boxHeight);
        if (objectFit === 'contain' || objectFit === 'scale-down') {
            return contain;
        }

        if (objectFit === 'none') {
            return { x: 0, y: 0, width: imageWidth, height: imageHeight };
        }

        if (objectFit === 'cover') {
            const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
            const width = imageWidth * scale;
            const height = imageHeight * scale;
            const [positionX, positionY] = this.readObjectPosition(objectPosition);
            return {
                x: (boxWidth - width) * positionX,
                y: (boxHeight - height) * positionY,
                width,
                height,
            };
        }

        return contain;
    }

    private static readObjectPosition(objectPosition: string): [number, number] {
        const [xToken = '50%', yToken = '50%'] = objectPosition.split(/\s+/);
        return [this.readPositionRatio(xToken), this.readPositionRatio(yToken)];
    }

    private static readBackgroundSize(backgroundSize: string, width: number, height: number): { width: number; height: number } {
        const [widthToken = 'auto', heightToken = 'auto'] = backgroundSize.split(/\s+/);
        return {
            width: this.resolveCssLength(widthToken, width, width),
            height: this.resolveCssLength(heightToken, height, height),
        };
    }

    private static readBackgroundPosition(
        backgroundPosition: string,
        width: number,
        height: number,
        backgroundWidth: number,
        backgroundHeight: number,
    ): { x: number; y: number } {
        const [xToken = '0%', yToken = '0%'] = backgroundPosition.split(/\s+/);
        const xRatio = this.readPositionRatio(xToken);
        const yRatio = this.readPositionRatio(yToken);
        const xOffset = this.parsePixels(xToken);
        const yOffset = this.parsePixels(yToken);
        return {
            x: xToken.endsWith('%') || ['left', 'center', 'right'].includes(xToken) ? (width - backgroundWidth) * xRatio : xOffset,
            y: yToken.endsWith('%') || ['top', 'center', 'bottom'].includes(yToken) ? (height - backgroundHeight) * yRatio : yOffset,
        };
    }

    private static readPositionRatio(token: string): number {
        switch (token) {
            case 'left':
            case 'top':
                return 0;
            case 'right':
            case 'bottom':
                return 1;
            case 'center':
                return 0.5;
            default:
                if (token.endsWith('%')) {
                    return Number(token.slice(0, -1)) / 100;
                }
                return 0;
        }
    }

    private static readTextAnchor(textAlign: string): 'start' | 'middle' | 'end' {
        if (textAlign === 'center') {
            return 'middle';
        }
        if (textAlign === 'right' || textAlign === 'end') {
            return 'end';
        }
        return 'start';
    }

    private static readCornerRadius(computedStyle: CSSStyleDeclaration, width: number, height: number): { rx: number; ry: number } {
        return {
            rx: Math.min(width / 2, this.parsePixels(computedStyle.borderTopLeftRadius.split(' ')[0] ?? '0')),
            ry: Math.min(height / 2, this.parsePixels(computedStyle.borderTopLeftRadius.split(' ')[1] ?? computedStyle.borderTopLeftRadius.split(' ')[0] ?? '0')),
        };
    }

    private static buildRoundedRectMarkup(
        x: number,
        y: number,
        width: number,
        height: number,
        radius: { rx: number; ry: number },
        fill: string,
        clipId: string | null,
        opacity: number,
    ): string {
        const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : '';
        const opacityAttribute = opacity < 1 ? ` opacity="${opacity}"` : '';
        return `<rect x="${this.formatNumber(x)}" y="${this.formatNumber(y)}" width="${this.formatNumber(width)}" height="${this.formatNumber(height)}" rx="${this.formatNumber(radius.rx)}" ry="${this.formatNumber(radius.ry)}" fill="${this.escapeXml(fill)}"${clipAttribute}${opacityAttribute}/>`;
    }

    private static resolveCssLength(token: string, axisLength: number, fallback: number): number {
        if (token === 'auto') {
            return fallback;
        }
        if (token.endsWith('%')) {
            return (Number(token.slice(0, -1)) / 100) * axisLength;
        }
        return this.parsePixels(token) || fallback;
    }

    private static readOpacity(value: string): number {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 1;
    }

    private static parsePixels(value: string): number {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private static isTransparentColor(value: string): boolean {
        const normalized = value.trim().toLowerCase();
        return normalized === 'transparent' || normalized === 'rgba(0, 0, 0, 0)' || normalized === 'rgba(0,0,0,0)';
    }

    private static formatNumber(value: number): string {
        return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
    }

    private static escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private static createOffscreenMount(width: number, height: number): HTMLDivElement {
        const mount = document.createElement('div');
        mount.setAttribute('aria-hidden', 'true');
        mount.style.position = 'fixed';
        mount.style.left = '-100000px';
        mount.style.top = '0';
        mount.style.width = `${width}px`;
        mount.style.height = `${height}px`;
        mount.style.overflow = 'hidden';
        mount.style.pointerEvents = 'none';
        mount.style.opacity = '0';
        mount.style.zIndex = '-1';
        mount.style.contain = 'layout style paint size';
        return mount;
    }

    private static createDetachedRenderHost(width: number, height: number): HTMLDivElement {
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.position = 'fixed';
        host.style.left = '-100000px';
        host.style.top = '0';
        host.style.width = `${width}px`;
        host.style.height = `${height}px`;
        host.style.overflow = 'hidden';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '-1';
        host.style.background = 'transparent';
        return host;
    }

    private static preparePreviewWindow(previewWindow: Window, fileName: string): void {
        try {
            previewWindow.document.open();
            previewWindow.document.write(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Rendering ${this.escapeHtml(fileName)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root {
            color-scheme: light;
            font-family: Roboto, Arial, sans-serif;
        }

        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f3f1ec;
            color: #1d1b19;
        }

        .preview-status {
            display: grid;
            gap: 12px;
            justify-items: center;
            text-align: center;
            padding: 24px;
        }

        .preview-spinner {
            width: 30px;
            height: 30px;
            border: 3px solid #c9c3b8;
            border-top-color: #7b0000;
            border-radius: 50%;
            animation: preview-spin 0.9s linear infinite;
        }

        .preview-label {
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 0.04em;
        }

        .preview-note {
            font-size: 13px;
            color: #5b504e;
        }

        @keyframes preview-spin {
            to {
                transform: rotate(360deg);
            }
        }
    </style>
</head>
<body>
    <main class="preview-status" aria-live="polite">
        <div class="preview-spinner" aria-hidden="true"></div>
        <div class="preview-label">Rendering Alpha Strike card…</div>
        <div class="preview-note">The image will appear automatically when it is ready.</div>
    </main>
</body>
</html>`);
            previewWindow.document.close();
        } catch {
            // Ignore preview-window bootstrap failures and continue with the export.
        }

        try {
            previewWindow.blur();
            window.focus();
        } catch {
            // Ignore focus-management failures.
        }
    }

    private static navigatePreviewWindow(previewWindow: Window, objectUrl: string, fileName: string): void {
        try {
            previewWindow.name = fileName;
        } catch {
            // Ignore preview window metadata failures and continue with navigation.
        }

        previewWindow.location.replace(objectUrl);
    }

    private static async waitForStableRender(root: ParentNode): Promise<void> {
        const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
        if (fontSet?.ready) {
            try {
                await fontSet.ready;
            } catch {
                // Ignore font readiness failures and continue with the current render state.
            }
        }

        await this.waitForImagesToLoad(root);
        await this.waitForLayoutStability(root as HTMLElement);
    }

    private static async waitForImagesToLoad(root: ParentNode): Promise<void> {
        const images = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
        if (images.length === 0) {
            return;
        }

        await Promise.all(images.map((image) => new Promise<void>((resolve) => {
            const done = () => resolve();
            if (image.complete) {
                resolve();
                return;
            }

            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
            setTimeout(done, 4000);
        })));
    }

    private static async waitForLayoutStability(root: HTMLElement): Promise<void> {
        let previousSignature = this.readLayoutSignature(root);
        let stableFrames = 0;

        for (let i = 0; i < 10 && stableFrames < 2; i++) {
            await this.nextAnimationFrames(1);
            const currentSignature = this.readLayoutSignature(root);
            if (currentSignature === previousSignature) {
                stableFrames++;
            } else {
                stableFrames = 0;
                previousSignature = currentSignature;
            }
        }
    }

    private static readLayoutSignature(root: HTMLElement): string {
        return `${root.clientWidth}:${root.clientHeight}:${root.scrollWidth}:${root.scrollHeight}`;
    }

    private static async inlineComputedStyles(
        sourceRoot: HTMLElement,
        cloneRoot: HTMLElement,
        externalImagePolicy: 'omit' | 'error',
    ): Promise<void> {
        const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
        const cloneElements = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];

        for (let i = 0; i < sourceElements.length; i++) {
            const source = sourceElements[i] as HTMLElement | undefined;
            const clone = cloneElements[i] as HTMLElement | undefined;
            if (!source || !clone) {
                continue;
            }

            const computedStyle = getComputedStyle(source);
            const serializedStyle: string[] = [];
            for (const propertyName of Array.from(computedStyle)) {
                const propertyValue = this.sanitizeStyleValue(propertyName, computedStyle.getPropertyValue(propertyName));
                const inlinedValue = await this.inlineStyleValueUrls(propertyValue, externalImagePolicy);
                serializedStyle.push(`${propertyName}:${inlinedValue};`);
            }
            clone.setAttribute('style', serializedStyle.join(''));

        }
    }

    private static async inlineStyleValueUrls(
        propertyValue: string,
        externalImagePolicy: 'omit' | 'error',
    ): Promise<string> {
        const urlPattern = /url\((['"]?)(.*?)\1\)/g;
        const matches = Array.from(propertyValue.matchAll(urlPattern));

        if (matches.length === 0) {
            return propertyValue;
        }

        let nextValue = propertyValue;
        for (const match of matches) {
            const originalToken = match[0];
            const rawUrl = match[2]?.trim() ?? '';
            if (!rawUrl || rawUrl.startsWith('#') || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
                continue;
            }

            try {
                const dataUrl = await this.fetchImageAsDataUrl(rawUrl);
                nextValue = nextValue.replace(originalToken, `url("${dataUrl}")`);
            } catch (error) {
                if (externalImagePolicy === 'error') {
                    throw new Error(`Failed to inline export style asset: ${rawUrl}. ${(error as Error).message}`);
                }

                nextValue = nextValue.replace(originalToken, 'none');
            }
        }

        return nextValue;
    }

    private static sanitizeStyleValue(propertyName: string, propertyValue: string): string {
        return propertyValue;
    }

    private static async inlineImages(
        sourceRoot: HTMLElement,
        cloneRoot: HTMLElement,
        externalImagePolicy: 'omit' | 'error',
    ): Promise<void> {
        const sourceImages = Array.from(sourceRoot.querySelectorAll('img')) as HTMLImageElement[];
        const cloneImages = Array.from(cloneRoot.querySelectorAll('img')) as HTMLImageElement[];

        await Promise.all(sourceImages.map(async (sourceImage, index) => {
            const cloneImage = cloneImages[index];
            if (!cloneImage) {
                return;
            }

            const sourceUrl = sourceImage.currentSrc || sourceImage.src || cloneImage.getAttribute('src') || '';
            if (!sourceUrl) {
                return;
            }

            if (sourceUrl.startsWith('data:') || sourceUrl.startsWith('blob:')) {
                cloneImage.setAttribute('src', sourceUrl);
                return;
            }

            const absoluteUrl = new URL(sourceUrl, document.baseURI).toString();
            if (new URL(absoluteUrl).origin === window.location.origin) {
                cloneImage.setAttribute('src', absoluteUrl);
                return;
            }

            try {
                const dataUrl = await this.fetchImageAsDataUrl(absoluteUrl);
                cloneImage.setAttribute('src', dataUrl);
            } catch (error) {
                if (externalImagePolicy === 'error') {
                    throw new Error(`Failed to inline export image: ${absoluteUrl}. ${(error as Error).message}`);
                }

                cloneImage.removeAttribute('src');
            }
        }));
    }

    private static applyExportLayoutFixups(sourceRoot: HTMLElement, cloneRoot: HTMLElement): void {
        this.lockExportElementHeights(sourceRoot, cloneRoot, '.damage-box');
        this.lockExportElementHeights(sourceRoot, cloneRoot, '.damage-ranges');

        for (const damageBox of Array.from(cloneRoot.querySelectorAll('.damage-box'))) {
            if (damageBox instanceof HTMLElement) {
                damageBox.style.boxSizing = 'border-box';
                damageBox.style.overflow = 'hidden';
            }
        }

        for (const pips of Array.from(cloneRoot.querySelectorAll('.pips'))) {
            if (pips instanceof HTMLElement) {
                pips.style.flexWrap = 'nowrap';
            }
        }

        for (const icon of Array.from(cloneRoot.querySelectorAll('img.era-icon'))) {
            if (!(icon instanceof HTMLImageElement)) {
                continue;
            }

            icon.style.filter = 'none';
            icon.style.mixBlendMode = 'normal';
        }

        for (const image of Array.from(cloneRoot.querySelectorAll('img.fluff-image'))) {
            if (!(image instanceof HTMLImageElement)) {
                continue;
            }

            const container = image.parentElement;
            if (!(container instanceof HTMLElement)) {
                continue;
            }

            const naturalWidth = image.naturalWidth;
            const naturalHeight = image.naturalHeight;
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
                continue;
            }

            const imageAspectRatio = naturalWidth / naturalHeight;
            const containerAspectRatio = containerWidth / containerHeight;

            image.style.display = 'block';
            image.style.margin = '0 auto';
            image.style.maxWidth = '100%';
            image.style.maxHeight = '100%';

            if (imageAspectRatio > containerAspectRatio) {
                image.style.width = '100%';
                image.style.height = 'auto';
            } else {
                image.style.width = 'auto';
                image.style.height = '100%';
            }
        }
    }

    private static applySvgExportLayoutFixups(sourceRoot: HTMLElement, cloneRoot: HTMLElement): void {
        void sourceRoot;
        void cloneRoot;
    }

    private static lockExportElementHeights(sourceRoot: HTMLElement, cloneRoot: HTMLElement, selector: string): void {
        const sourceElements = Array.from(sourceRoot.querySelectorAll(selector));
        const cloneElements = Array.from(cloneRoot.querySelectorAll(selector));

        for (let index = 0; index < Math.min(sourceElements.length, cloneElements.length); index++) {
            const sourceElement = sourceElements[index];
            const cloneElement = cloneElements[index];
            if (!(sourceElement instanceof HTMLElement) || !(cloneElement instanceof HTMLElement)) {
                continue;
            }

            const { height } = sourceElement.getBoundingClientRect();
            if (height <= 0) {
                continue;
            }

            const heightPx = `${height}px`;
            cloneElement.style.height = heightPx;
            cloneElement.style.minHeight = heightPx;
            cloneElement.style.maxHeight = heightPx;
        }
    }

    private static async fetchImageAsDataUrl(sourceUrl: string): Promise<string> {
        const cacheKey = sourceUrl;
        let pending = this.imageDataUrlCache.get(cacheKey);
        if (!pending) {
            pending = (async () => {
                const response = await fetch(sourceUrl, {
                    mode: 'cors',
                    cache: 'force-cache',
                });
                if (!response.ok) {
                    throw new Error(`Image request failed with status ${response.status}.`);
                }

                const blob = await response.blob();
                return await this.blobToDataUrl(blob);
            })();
            this.imageDataUrlCache.set(cacheKey, pending);
        }

        try {
            return await pending;
        } catch (error) {
            this.imageDataUrlCache.delete(cacheKey);
            throw error;
        }
    }

    private static blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as data URL.'));
            reader.readAsDataURL(blob);
        });
    }

    private static removeExcludedExportElements(root: HTMLElement): void {
        for (const selector of EXPORT_EXCLUDED_SELECTORS) {
            for (const element of Array.from(root.querySelectorAll(selector))) {
                element.remove();
            }
        }
    }

    private static async nextAnimationFrames(frameCount: number): Promise<void> {
        for (let i = 0; i < frameCount; i++) {
            await new Promise<void>((resolve) => {
                let settled = false;
                let frameId = 0;
                const finish = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    if (frameId) {
                        cancelAnimationFrame(frameId);
                    }
                    resolve();
                };

                const timeoutId = window.setTimeout(finish, document.visibilityState === 'hidden' ? 16 : 50);
                frameId = requestAnimationFrame(() => {
                    window.clearTimeout(timeoutId);
                    finish();
                });
            });
        }
    }

    private static escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}