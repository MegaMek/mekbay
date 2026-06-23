const PNG_MIME_TYPE = 'image/png';
const DEFAULT_PNG_SCALE = 3;
const DEFAULT_CLIPBOARD_PNG_SCALE = 5; //workaround for some browsers that uses some internal pixel scaling that is less than the rendering one

type FontFaceSpec = {
    family: string;
    href: string;
    weight: string;
    style: string;
    stretch?: string;
};

export type SvgPngRenderOptions = {
    scale?: number;
    backgroundColor?: string;
};

type RenderedPng = {
    blob: Blob;
    width: number;
    height: number;
};

const FONT_FACE_SPECS: FontFaceSpec[] = [
    { family: 'Roboto', href: 'fonts/Roboto-VariableFont_wdth,wght.ttf', weight: '100 900', style: 'normal', stretch: '75% 100%' },
    { family: 'Roboto', href: 'fonts/Roboto-Italic-VariableFont_wdth,wght.ttf', weight: '100 900', style: 'italic', stretch: '75% 100%' },
    { family: 'Roboto Condensed', href: 'fonts/RobotoCondensed-VariableFont_wght.ttf', weight: '100 900', style: 'normal' },
    { family: 'Roboto Condensed', href: 'fonts/RobotoCondensed-Italic-VariableFont_wght.ttf', weight: '100 900', style: 'italic' },
];

export class SvgExportUtil {
    private static embeddedFontCssPromise: Promise<string> | null = null;

    static async downloadPng(svgs: SVGSVGElement[], fileName: string, options: SvgPngRenderOptions = {}): Promise<void> {
        const renderedPng = await this.generatePng(svgs, options);
        if (!renderedPng) return;

        this.downloadPngBlob(renderedPng.blob, fileName);
    }

    static async sharePng(svgs: SVGSVGElement[], fileName: string, options: SvgPngRenderOptions = {}): Promise<void> {
        const renderedPng = await this.generatePng(svgs, options);
        if (!renderedPng) throw new Error('No PNG data was generated');

        await this.sharePngBlob(renderedPng.blob, fileName);
    }

    static async copyPngToClipboard(svgs: SVGSVGElement[], fileName = 'record-sheet', options: SvgPngRenderOptions = {}): Promise<void> {
        const renderedPng = await this.generatePng(svgs, {
            ...options,
            scale: options.scale ?? DEFAULT_CLIPBOARD_PNG_SCALE,
        });
        if (!renderedPng) throw new Error('No PNG data was generated');

        await this.copyPngBlobToClipboard(renderedPng.blob, fileName, renderedPng);
    }

    static async renderPngBlob(svgs: SVGSVGElement[], options: SvgPngRenderOptions = {}): Promise<Blob | null> {
        return (await this.generatePng(svgs, options))?.blob ?? null;
    }

    static downloadPngBlob(pngBlob: Blob, fileName: string): void {
        const pngUrl = URL.createObjectURL(pngBlob);
        try {
            const link = document.createElement('a');
            link.href = pngUrl;
            link.download = `${fileName}.png`;
            link.click();
        } finally {
            URL.revokeObjectURL(pngUrl);
        }
    }

    static async sharePngBlob(pngBlob: Blob, fileName: string): Promise<void> {
        const pngFile = this.createPngFile(pngBlob, fileName);
        if (!this.canSharePngFile(pngFile)) {
            throw new Error('PNG file sharing is not supported by this browser');
        }

        await navigator.share({ files: [pngFile], title: fileName });
    }

    static async copyPngBlobToClipboard(pngBlob: Blob, fileName = 'record-sheet', dimensions?: { width: number; height: number }): Promise<void> {
        const pngFile = this.createPngFile(pngBlob, fileName);

        if (this.canSharePngFile(pngFile)) {
            try {
                await navigator.share({ files: [pngFile], title: fileName });
                return;
            } catch {
                // Fall through to clipboard APIs when sharing is unavailable, cancelled, or rejected.
            }
        }

        if (this.canUseAsyncImageClipboard()) {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ [PNG_MIME_TYPE]: pngBlob }),
                ]);
                return;
            } catch {
                // Fall through to execCommand for browsers that expose but reject image clipboard writes.
            }
        }

        await this.copyPngBlobWithExecCommand(pngBlob, fileName, dimensions);
    }

    private static async generatePng(svgs: SVGSVGElement[], options: SvgPngRenderOptions = {}): Promise<RenderedPng | null> {
        if (svgs.length === 0) return null;

        const scale = options.scale ?? DEFAULT_PNG_SCALE;
        const backgroundColor = options.backgroundColor ?? '#ffffff';
        const embeddedFontCss = await this.getEmbeddedFontCss();
        const entries = svgs.map((svg) => ({ svg, size: this.getSvgExportSize(svg), url: '' }));

        try {
            await document.fonts?.ready;
        } catch {
            // Continue; embedded @font-face rules keep SVG image rasterization self-contained.
        }

        try {
            for (const entry of entries) {
                const serialized = this.serializeSvgForExport(entry.svg, embeddedFontCss);
                const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
                entry.url = URL.createObjectURL(svgBlob);
            }

            const images = await Promise.all(entries.map((entry) => this.loadImage(entry.url)));
            const width = entries.reduce((sum, entry) => sum + entry.size.width, 0);
            const height = Math.max(...entries.map((entry) => entry.size.height));
            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const context = canvas.getContext('2d');
            if (!context) return null;

            context.scale(scale, scale);
            context.fillStyle = backgroundColor;
            context.fillRect(0, 0, width, height);

            let x = 0;
            for (let index = 0; index < images.length; index += 1) {
                const size = entries[index].size;
                context.drawImage(images[index], x, 0, size.width, size.height);
                x += size.width;
            }

            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PNG_MIME_TYPE));
            return blob ? { blob, width: canvas.width, height: canvas.height } : null;
        } finally {
            for (const entry of entries) {
                if (entry.url) URL.revokeObjectURL(entry.url);
            }
        }
    }

    private static serializeSvgForExport(svg: SVGSVGElement, embeddedFontCss: string): string {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        if (!clone.getAttribute('xmlns')) {
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        if (!clone.getAttribute('xmlns:xlink')) {
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        }

        this.injectExportStyles(clone, embeddedFontCss);
        return new XMLSerializer().serializeToString(clone);
    }

    private static injectExportStyles(svg: SVGSVGElement, embeddedFontCss: string): void {
        if (!embeddedFontCss) return;

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.setAttribute('type', 'text/css');
        style.textContent = embeddedFontCss;
        defs.appendChild(style);
        svg.insertBefore(defs, svg.firstChild);
    }

    private static async getEmbeddedFontCss(): Promise<string> {
        this.embeddedFontCssPromise ??= this.loadEmbeddedFontCss();
        return this.embeddedFontCssPromise;
    }

    private static async loadEmbeddedFontCss(): Promise<string> {
        try {
            const rules = await Promise.all(FONT_FACE_SPECS.map(async (font) => {
                const dataUrl = await this.fetchAsDataUrl(font.href);
                return [
                    '@font-face {',
                    `font-family: '${font.family}';`,
                    `src: url('${dataUrl}') format('truetype');`,
                    `font-weight: ${font.weight};`,
                    font.stretch ? `font-stretch: ${font.stretch};` : '',
                    `font-style: ${font.style};`,
                    '}',
                ].filter(Boolean).join('\n');
            }));
            return rules.join('\n');
        } catch {
            return '';
        }
    }

    private static async fetchAsDataUrl(href: string): Promise<string> {
        const response = await fetch(new URL(href, document.baseURI));
        if (!response.ok) throw new Error(`Failed to load font: ${href}`);

        const bytes = new Uint8Array(await response.arrayBuffer());
        return `data:font/ttf;base64,${this.bytesToBase64(bytes)}`;
    }

    private static bytesToBase64(bytes: Uint8Array): string {
        const chunkSize = 0x8000;
        let binary = '';
        for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
    }

    private static createPngFile(pngBlob: Blob, fileName: string): File {
        return new File([pngBlob], `${fileName}.png`, { type: PNG_MIME_TYPE });
    }

    private static canSharePngFile(pngFile: File): boolean {
        return typeof navigator.share === 'function'
            && typeof navigator.canShare === 'function'
            && navigator.canShare({ files: [pngFile] });
    }

    private static canUseAsyncImageClipboard(): boolean {
        return typeof navigator.clipboard?.write === 'function'
            && typeof ClipboardItem !== 'undefined';
    }

    private static async copyPngBlobWithExecCommand(pngBlob: Blob, fileName: string, dimensions?: { width: number; height: number }): Promise<void> {
        const dataUrl = await this.blobToDataUrl(pngBlob);
        const copyContainer = document.createElement('div');
        copyContainer.contentEditable = 'true';
        copyContainer.style.position = 'fixed';
        copyContainer.style.left = '-10000px';
        copyContainer.style.top = '0';

        const image = document.createElement('img');
        image.alt = '';
        image.src = dataUrl;
        if (dimensions) {
            image.width = dimensions.width;
            image.height = dimensions.height;
        }
        copyContainer.appendChild(image);

        const onCopy = (event: ClipboardEvent) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return;

            event.preventDefault();
            try {
                clipboardData.items.add(new File([pngBlob], `${fileName}.png`, { type: PNG_MIME_TYPE }));
            } catch {
                // Some browsers reject binary clipboard items here but still accept HTML data.
            }
            clipboardData.setData('text/html', copyContainer.innerHTML);
        };

        document.body.appendChild(copyContainer);
        document.addEventListener('copy', onCopy, { once: true });

        const selection = window.getSelection();
        const previousRanges = selection
            ? Array.from({ length: selection.rangeCount }, (_value, index) => selection.getRangeAt(index).cloneRange())
            : [];

        try {
            const range = document.createRange();
            range.selectNode(image);
            selection?.removeAllRanges();
            selection?.addRange(range);
            copyContainer.focus();

            if (!document.execCommand('copy')) {
                throw new Error('Copy command was unsuccessful');
            }
        } finally {
            document.removeEventListener('copy', onCopy);
            selection?.removeAllRanges();
            for (const range of previousRanges) {
                selection?.addRange(range);
            }
            document.body.removeChild(copyContainer);
        }
    }

    private static blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error('Failed to read PNG data'));
            reader.readAsDataURL(blob);
        });
    }

    private static loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Failed to load SVG image'));
            image.src = url;
        });
    }

    private static getSvgExportSize(svg: SVGSVGElement): { width: number; height: number } {
        const viewBox = svg.viewBox?.baseVal;
        const rect = svg.getBoundingClientRect();
        const width = viewBox?.width || Number.parseFloat(svg.getAttribute('width') ?? '') || rect.width || 1000;
        const height = viewBox?.height || Number.parseFloat(svg.getAttribute('height') ?? '') || rect.height || 1000;
        return { width: Math.ceil(width), height: Math.ceil(height) };
    }
}