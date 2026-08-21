// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

interface PrintOverlayOptions {
    containerId: string;
    bodyClass: string;
    content: string;
    styles: string;
    triggerPrint: boolean;
    onImageError?: (image: Element) => void;
}

interface MountedPrintOverlayOptions {
    overlay: HTMLElement;
    bodyClass: string;
    triggerPrint: boolean;
    onImageError?: (image: Element) => void;
    onMount?: () => void;
    onCleanup?: () => void;
}

const CLEANUP_EVENTS = ['click', 'keydown', 'pointerdown', 'afterprint'] as const;

export async function printInOverlay(options: PrintOverlayOptions): Promise<void> {
    const overlay = document.createElement('div');
    overlay.id = options.containerId;
    overlay.innerHTML = options.content;

    const style = document.createElement('style');
    style.textContent = options.styles;
    overlay.appendChild(style);

    await mountPrintOverlay({
        overlay,
        bodyClass: options.bodyClass,
        triggerPrint: options.triggerPrint,
        onImageError: options.onImageError,
    });
}

export async function mountPrintOverlay(options: MountedPrintOverlayOptions): Promise<void> {
    let cleanedUp = false;
    const removeOverlay = () => {
        if (cleanedUp) return;
        cleanedUp = true;

        for (const eventName of CLEANUP_EVENTS) {
            window.removeEventListener(eventName, removeOverlay, { capture: true });
        }

        try {
            options.onCleanup?.();
        } finally {
            options.overlay.remove();
            document.body.classList.remove(options.bodyClass);
        }
    };

    try {
        document.body.appendChild(options.overlay);
        document.body.classList.add(options.bodyClass);
        options.onMount?.();

        try {
            await document.fonts?.ready;
        } catch {
            // Printing can continue with the browser's fallback font.
        }
        await waitForPrintImages(options.overlay, options.onImageError);
        await nextAnimationFrames(2);

        for (const eventName of CLEANUP_EVENTS) {
            window.addEventListener(eventName, removeOverlay, { capture: true, once: true });
        }

        if (options.triggerPrint) {
            window.print();
        }
    } catch (error) {
        removeOverlay();
        throw error;
    }
}

export async function waitForPrintImages(
    root: ParentNode,
    onError?: (image: Element) => void,
): Promise<void> {
    const svgImages = Array.from(root.querySelectorAll<SVGImageElement>('image'));
    const htmlImages = Array.from(root.querySelectorAll<HTMLImageElement>('img'));

    await Promise.all([
        ...svgImages.map(image => waitForSvgImage(image, onError)),
        ...htmlImages.map(image => waitForHtmlImage(image, onError)),
    ]);
}

export async function nextAnimationFrames(count: number = 1): Promise<void> {
    for (let index = 0; index < count; index++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
}

function waitForSvgImage(image: SVGImageElement, onError?: (image: Element) => void): Promise<void> {
    const href = image.getAttribute('href')
        ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || href.startsWith('data:')) {
        return Promise.resolve();
    }

    return waitForImageEvent(image, onError);
}

function waitForHtmlImage(image: HTMLImageElement, onError?: (image: Element) => void): Promise<void> {
    if (image.complete) {
        if (image.naturalWidth === 0) {
            onError?.(image);
        }
        return Promise.resolve();
    }

    return waitForImageEvent(image, onError, () => image.complete && image.naturalWidth > 0);
}

function waitForImageEvent(
    image: Element,
    onError?: (image: Element) => void,
    didLoadOnTimeout: () => boolean = () => false,
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const done = (loaded: boolean) => {
            if (settled) return;
            settled = true;
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
            image.removeEventListener('load', onLoadEvent);
            image.removeEventListener('error', onErrorEvent);
            try {
                if (!loaded) {
                    onError?.(image);
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        const onLoadEvent = () => done(true);
        const onErrorEvent = () => done(false);

        image.addEventListener('load', onLoadEvent, { once: true });
        image.addEventListener('error', onErrorEvent, { once: true });
        timeoutId = setTimeout(() => done(didLoadOnTimeout()), 4000);
    });
}
