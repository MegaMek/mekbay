export interface SVGFrameOptions {
    id?: string;
    headerWidth?: number | 'auto';
    headerFontSize?: number;
    headerHeight?: number | 'auto';
    bottomLeftNotchWidth?: number;
    cornerAngleDegrees?: number | SVGFrameCornerAngleOptions;
    fullWidthHeader?: boolean;
}

export interface SVGFrameCornerAngleOptions {
    topLeft?: number;
    topRight?: number;
    bottomRight?: number;
    bottomLeft?: number;
}

type SVGFrameCorner = keyof SVGFrameCornerAngleOptions;

interface SVGFrameCornerCut {
    x: number;
    y: number;
}

interface SVGFrameHeaderCuts {
    left: SVGFrameCornerCut;
    right: SVGFrameCornerCut;
}

interface SVGFrameGeometry {
    headerWidth: number;
    headerFontSize: number;
    headerHeight: number;
    headerTextLength: number;
    headerOffsetX: number;
    headerCuts: SVGFrameHeaderCuts;
    bottomLeftNotchWidth: number;
    cornerAngles: Record<SVGFrameCorner, number>;
    cornerCuts: Record<SVGFrameCorner, SVGFrameCornerCut>;
    fullWidthHeader: boolean;
}

export class SvgFrameUtil {

    private static readonly cornerCutBaseline = 7.6;
    private static readonly defaultCornerAngleDegrees = 60;
    private static readonly framePathInset = 2.5;
    private static readonly headerBorderInset = 3;
    private static readonly innerFrameContract = 1.5;
    private static readonly headerTextPadding = 13.2;
    private static readonly headerTextVerticalPadding = 2.5;
    private static readonly headerTextFontSize = 10.6;
    private static readonly fallbackHeaderTextLengthPerFontSize = 0.8;
    private static readonly bottomNotchDepth = 7.6;

    public static createSVGFrame(title: string, width: number, height: number, options: SVGFrameOptions = {}): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        if (options.id) {
            group.setAttribute('id', options.id);
        }
        const geometry = this.createFrameGeometry(title, width, options);

        const outerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outerPath.setAttribute('fill', '#fff');
        outerPath.setAttribute('stroke-width', '5.2');
        outerPath.setAttribute('d', this.createSVGFramePath(width, height, geometry, true));
        outerPath.setAttribute('stroke-linejoin', 'round');
        outerPath.setAttribute('stroke', '#c7c7c7');
        group.appendChild(outerPath);

        const innerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        innerPath.setAttribute('fill', '#fff');
        innerPath.setAttribute('stroke-width', '1.932');
        innerPath.setAttribute('d', this.createSVGFramePath(width - 1.5, height - 1.5, geometry, false));
        innerPath.setAttribute('stroke-linejoin', 'round');
        innerPath.setAttribute('stroke', '#000');
        group.appendChild(innerPath);

        const header = this.createSVGFrameHeader(title, geometry);
        group.appendChild(header);

        return group;
    }

    private static createSVGFramePath(width: number, height: number, geometry: SVGFrameGeometry, outer: boolean): string {
        const xOffset = outer ? this.framePathInset : 0;
        const yOffset = outer ? this.framePathInset : 0;
        const topY = yOffset;
        const rightX = width;
        const bottomY = height;
        const { topLeft, topRight, bottomRight, bottomLeft } = geometry.cornerCuts;
        const upperInsetY = topY + topLeft.y;
        const tabStartX = topLeft.x + xOffset;
        const headerRightCut = geometry.headerCuts.right;
        const headerRightInset = this.createParallelInsetX(headerRightCut, this.headerBorderInset);
        const tabWidth = Math.max(geometry.headerOffsetX + geometry.headerWidth - headerRightCut.x + headerRightInset - topLeft.x, 1);

        const path = [
            `M ${xOffset} ${upperInsetY}`,
            `L ${tabStartX} ${topY}`,
            ...(geometry.fullWidthHeader
                ? [`L ${rightX - topRight.x} ${topY}`]
                : [
                    `l ${tabWidth} 0`,
                    `l ${topLeft.x} ${topLeft.y}`,
                    `L ${rightX - topRight.x} ${upperInsetY}`
                ]),
            `l ${topRight.x} ${topRight.y}`,
            `L ${rightX} ${bottomY - bottomRight.y}`,
            `l -${bottomRight.x} ${bottomRight.y}`,
            ...this.createBottomLeftNotchPath(width, bottomY, xOffset, bottomLeft, bottomRight, geometry.cornerAngles.bottomRight, geometry.bottomLeftNotchWidth),
            'Z'
        ];

        return path.join(' ');
    }

    private static createBottomLeftNotchPath(
        width: number,
        bottomY: number,
        xOffset: number,
        bottomLeft: SVGFrameCornerCut,
        bottomRight: SVGFrameCornerCut,
        bottomRightAngle: number,
        bottomLeftNotchWidth: number
    ): string[] {
        if (bottomLeftNotchWidth <= 0) {
            return [
                `L ${bottomLeft.x + xOffset} ${bottomY}`,
                `l -${bottomLeft.x} -${bottomLeft.y}`
            ];
        }

        const notchStartX = bottomLeft.x + xOffset;
        const notchCut = this.createAngleCut(bottomRightAngle, this.bottomNotchDepth);
        const availableNotchWidth = Math.max(width - bottomRight.x - notchStartX - notchCut.x, 0);
        const notchWidth = Math.min(bottomLeftNotchWidth, availableNotchWidth);
        const notchEndX = notchStartX + notchWidth;
        const notchSlopeEndX = notchEndX + notchCut.x;
        const notchTopY = bottomY - notchCut.y;

        return [
            `L ${notchSlopeEndX} ${bottomY}`,
            `L ${notchEndX} ${notchTopY}`,
            `L ${notchStartX} ${notchTopY}`,
            `l -${bottomLeft.x} -${bottomLeft.y}`
        ];
    }

    private static createSVGFrameHeader(title: string, geometry: SVGFrameGeometry): SVGGElement {
        const header = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        header.setAttribute('transform', `translate(${geometry.headerOffsetX} ${this.headerBorderInset})`);

        const resolvedHeaderWidth = Math.max(geometry.headerWidth, this.createHeaderMinWidth(geometry.headerCuts));
        const naturalTextLength = Math.max(geometry.headerTextLength, 1);
        const maxTextLength = Math.max(resolvedHeaderWidth - this.headerTextPadding, 1);
        const headerMiddle = resolvedHeaderWidth / 2;
        const headerLeftCut = geometry.headerCuts.left;
        const headerRightCut = geometry.headerCuts.right;
        const headerMiddleY = geometry.headerHeight / 2;
        const headerTopWidth = Math.max(resolvedHeaderWidth - headerLeftCut.x - headerRightCut.x, 1);
        const headerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        headerPath.setAttribute('d', `M 0 ${headerMiddleY} l ${headerLeftCut.x} -${headerLeftCut.y} h ${headerTopWidth} l ${headerRightCut.x} ${headerRightCut.y} l -${headerRightCut.x} ${headerRightCut.y} h -${headerTopWidth} Z`);
        header.appendChild(headerPath);

        const headerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        headerText.setAttribute('x', headerMiddle.toString());
        headerText.setAttribute('y', (geometry.headerHeight / 2 + geometry.headerFontSize * 0.35).toString());
        headerText.setAttribute('fill', '#fff');
        headerText.setAttribute('class', 'svg-frame-title');
        headerText.setAttribute('text-anchor', 'middle');
        headerText.setAttribute('font-size', geometry.headerFontSize.toFixed(3));
        headerText.setAttribute('font-weight', '700');
        if (naturalTextLength > maxTextLength) {
            headerText.setAttribute('textLength', maxTextLength.toString());
            headerText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
        headerText.textContent = title;
        header.appendChild(headerText);

        return header;
    }

    private static createFrameGeometry(title: string, width: number, options: SVGFrameOptions): SVGFrameGeometry {
        const cornerAngles = this.createCornerAngles(options.cornerAngleDegrees);
        const cornerCuts = this.createCornerCuts(cornerAngles);
        const fullWidthHeader = options.fullWidthHeader ?? false;
        const headerFontSize = this.createHeaderFontSize(options.headerFontSize);
        const headerHeight = this.createHeaderHeight(options.headerHeight, headerFontSize);
        const headerCuts = this.createHeaderCuts(cornerAngles, fullWidthHeader, headerHeight);
        const headerMiddleY = Math.max(headerCuts.left.y, headerCuts.right.y);
        const headerMinWidth = this.createHeaderMinWidth(headerCuts);
        const headerTextLength = this.measureHeaderTextLength(title, headerFontSize);
        const headerOffsetX = this.createHeaderSideInsetX(cornerCuts.topLeft, headerMiddleY, this.headerBorderInset);
        const fullWidthHeaderRightInset = this.createHeaderSideInsetX(cornerCuts.topRight, headerMiddleY, this.headerBorderInset);
        const fullWidthHeaderWidth = Math.max(width - this.innerFrameContract - headerOffsetX - fullWidthHeaderRightInset, headerMinWidth);
        const headerWidth = options.headerWidth === undefined || options.headerWidth === 'auto'
            ? Math.max(headerTextLength, 32) + this.headerTextPadding
            : options.headerWidth;

        return {
            headerWidth: fullWidthHeader
                ? fullWidthHeaderWidth
                : Math.max(headerWidth, headerMinWidth),
            headerFontSize,
            headerHeight,
            headerTextLength,
            headerOffsetX,
            headerCuts,
            bottomLeftNotchWidth: Math.max(options.bottomLeftNotchWidth ?? 0, 0),
            cornerAngles,
            cornerCuts,
            fullWidthHeader
        };
    }

    private static createCornerAngles(cornerAngleDegrees: SVGFrameOptions['cornerAngleDegrees']): SVGFrameGeometry['cornerAngles'] {
        if (typeof cornerAngleDegrees === 'number') {
            const cornerAngle = this.createCornerAngle(cornerAngleDegrees);
            return {
                topLeft: cornerAngle,
                topRight: cornerAngle,
                bottomRight: cornerAngle,
                bottomLeft: cornerAngle
            };
        }

        return {
            topLeft: this.createCornerAngle(cornerAngleDegrees?.topLeft),
            topRight: this.createCornerAngle(cornerAngleDegrees?.topRight),
            bottomRight: this.createCornerAngle(cornerAngleDegrees?.bottomRight),
            bottomLeft: this.createCornerAngle(cornerAngleDegrees?.bottomLeft)
        };
    }

    private static createCornerAngle(angleDegrees: number | undefined): number {
        if (angleDegrees === undefined || !Number.isFinite(angleDegrees)) {
            return this.defaultCornerAngleDegrees;
        }

        return Math.min(Math.max(angleDegrees, 0), 90);
    }

    private static createCornerCuts(cornerAngles: SVGFrameGeometry['cornerAngles']): SVGFrameGeometry['cornerCuts'] {
        return {
            topLeft: this.createCornerCut(cornerAngles.topLeft),
            topRight: this.createCornerCut(cornerAngles.topRight),
            bottomRight: this.createCornerCut(cornerAngles.bottomRight),
            bottomLeft: this.createCornerCut(cornerAngles.bottomLeft)
        };
    }

    private static createCornerCut(angleDegrees: number): SVGFrameCornerCut {
        return this.createAngleCut(angleDegrees, this.cornerCutBaseline);
    }

    private static createAngleCut(angleDegrees: number, baseline: number): SVGFrameCornerCut {
        if (angleDegrees <= 0 || angleDegrees >= 90) {
            return { x: 0, y: 0 };
        }

        const radians = angleDegrees * Math.PI / 180;
        return {
            x: baseline * Math.cos(radians) / Math.SQRT1_2,
            y: baseline * Math.sin(radians) / Math.SQRT1_2
        };
    }

    private static createParallelInsetX(cut: SVGFrameCornerCut, inset: number): number {
        if (cut.x <= 0 || cut.y <= 0) {
            return inset;
        }

        return inset * (Math.hypot(cut.x, cut.y) - cut.x) / cut.y;
    }

    private static createHeaderSideInsetX(frameCut: SVGFrameCornerCut, headerMiddleY: number, inset: number): number {
        if (frameCut.x <= 0 || frameCut.y <= 0) {
            return inset;
        }

        const headerTipY = inset + headerMiddleY;
        if (headerTipY >= frameCut.y) {
            return inset;
        }

        return (inset * Math.hypot(frameCut.x, frameCut.y) + frameCut.x * (frameCut.y - headerTipY)) / frameCut.y;
    }

    private static createHeaderMinWidth(headerCuts: SVGFrameHeaderCuts): number {
        return headerCuts.left.x + headerCuts.right.x + 1;
    }

    private static createHeaderCuts(cornerAngles: SVGFrameGeometry['cornerAngles'], fullWidthHeader: boolean, headerHeight: number): SVGFrameHeaderCuts {
        return {
            left: this.createHeaderCut(cornerAngles.topLeft, headerHeight),
            right: this.createHeaderCut(fullWidthHeader ? cornerAngles.topRight : cornerAngles.topLeft, headerHeight)
        };
    }

    private static createHeaderCut(angleDegrees: number, headerHeight: number): SVGFrameCornerCut {
        const y = headerHeight / 2;
        if (angleDegrees <= 0 || angleDegrees >= 90) {
            return { x: 0, y };
        }

        return { x: y / Math.tan(angleDegrees * Math.PI / 180), y };
    }

    private static createHeaderFontSize(headerFontSize: number | undefined): number {
        if (headerFontSize === undefined || !Number.isFinite(headerFontSize) || headerFontSize <= 0) {
            return this.headerTextFontSize;
        }

        return headerFontSize;
    }

    private static createHeaderHeight(headerHeight: SVGFrameOptions['headerHeight'], headerFontSize: number): number {
        const resolvedHeaderHeight = headerHeight === undefined || headerHeight === 'auto' || !Number.isFinite(headerHeight) || headerHeight <= 0
            ? headerFontSize
            : headerHeight;

        return resolvedHeaderHeight + this.headerTextVerticalPadding * 2;
    }

    private static measureHeaderTextLength(title: string, headerFontSize: number): number {
        const fallbackLength = Math.max(title.length * headerFontSize * this.fallbackHeaderTextLengthPerFontSize, 1);
        if (!document.body) {
            return fallbackLength;
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.position = 'absolute';
        svg.style.visibility = 'hidden';
        svg.style.pointerEvents = 'none';

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'svg-frame-title');
        text.setAttribute('font-size', headerFontSize.toFixed(3));
        text.setAttribute('font-weight', '700');
        text.textContent = title;

        svg.appendChild(text);
        document.body.appendChild(svg);
        const measuredLength = text.getComputedTextLength();
        svg.remove();

        return Number.isFinite(measuredLength) && measuredLength > 0
            ? measuredLength
            : fallbackLength;
    }
}