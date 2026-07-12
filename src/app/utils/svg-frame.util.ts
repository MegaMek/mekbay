export interface SVGFrameOptions {
    id?: string;
    headerWidth?: number;
}

export class SvgFrameUtil {

    public static createSVGFrame(title: string, width: number, height: number, options: SVGFrameOptions = {}): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        if (options.id) {
            group.setAttribute('id', options.id);
        }
        const headerWidth = options.headerWidth ?? this.defaultHeaderWidth(title);

        const outerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outerPath.setAttribute('fill', '#fff');
        outerPath.setAttribute('stroke-width', '5.2');
        outerPath.setAttribute('d', this.createSVGFramePath(width, height, headerWidth, true));
        outerPath.setAttribute('stroke-linejoin', 'round');
        outerPath.setAttribute('stroke', '#c7c7c7');
        group.appendChild(outerPath);

        const innerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        innerPath.setAttribute('fill', '#fff');
        innerPath.setAttribute('stroke-width', '1.932');
        innerPath.setAttribute('d', this.createSVGFramePath(width - 1.5, height - 1.5, headerWidth, false));
        innerPath.setAttribute('stroke-linejoin', 'round');
        innerPath.setAttribute('stroke', '#000');
        group.appendChild(innerPath);

        const header = this.createSVGFrameHeader(title, headerWidth);
        group.appendChild(header);

        return group;
    }

    private static createSVGFramePath(width: number, height: number, headerWidth: number, outer: boolean): string {
        const xOffset = outer ? 2.5 : 0;
        const yOffset = outer ? 2.5 : 0;
        const upperInsetY = 8.214 + yOffset;
        const topY = yOffset;
        const tabStartX = 5.475 + xOffset;
        const tabWidth = Math.max(headerWidth - 5.998, 1);
        const tabSkewX = 5.475;
        const sideSkewX = 7.845;
        const sideSkewY = 7.6;
        const rightX = width;
        const bottomY = height;

        return [
            `M ${xOffset} ${upperInsetY}`,
            `L ${tabStartX} ${topY}`,
            `l ${tabWidth} 0`,
            `l ${tabSkewX} 8.214`,
            `L ${rightX - sideSkewX} ${upperInsetY}`,
            `l ${sideSkewX} ${sideSkewY}`,
            `L ${rightX} ${bottomY - sideSkewY}`,
            `l -${sideSkewX} ${sideSkewY}`,
            `L ${sideSkewX + xOffset} ${bottomY}`,
            `l -${sideSkewX} -${sideSkewY}`,
            'Z'
        ].join(' ');
    }

    private static createSVGFrameHeader(title: string, headerWidth: number): SVGGElement {
        const header = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        header.setAttribute('transform', 'translate(2.5 3)');

        const resolvedHeaderWidth = Math.max(headerWidth, 14.997);
        const naturalTextLength = Math.max(title.length * 6.466, 1);
        const maxTextLength = Math.max(resolvedHeaderWidth - 13.231, 1);
        const headerMiddle = resolvedHeaderWidth / 2;
        const headerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        headerPath.setAttribute('d', `M 0 7.5 l 4.999 -7.5 h ${resolvedHeaderWidth - 9.998} l 4.999 7.5 l -4.999 7.5 h -${resolvedHeaderWidth - 9.998} Z`);
        header.appendChild(headerPath);

        const headerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        headerText.setAttribute('x', headerMiddle.toString());
        headerText.setAttribute('y', '11.25');
        headerText.setAttribute('fill', '#fff');
        headerText.setAttribute('text-anchor', 'middle');
        headerText.setAttribute('style', 'font-family:Roboto;font-size: 10.600px;font-weight:700');
        if (naturalTextLength > maxTextLength) {
            headerText.setAttribute('textLength', maxTextLength.toString());
            headerText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
        headerText.textContent = title;
        header.appendChild(headerText);

        return header;
    }

    private static defaultHeaderWidth(title: string): number {
        return Math.max(title.length * 6.466, 32.33) + 13.231;
    }
}