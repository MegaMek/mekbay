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
    // A cut is stored as a tiny right triangle: move x pixels along one edge,
    // then y pixels along the other edge, and connect those points with a slope.
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

    // The frame corners use this baseline to keep all 0-90 degree cuts in the
    // same visual family. A 45 degree cut ends up roughly 7.6 by 7.6.
    private static readonly cornerCutBaseline = 7.6;
    private static readonly defaultCornerAngleDegrees = 60;
    // The outer grey frame is drawn a little inward so its thick stroke does not
    // spill outside the requested frame box.
    private static readonly framePathInset = 2.5;
    // Gap between the black frame border and the black header tab. The x offset
    // is adjusted for sloped borders so this is a real visual gap, not just +3px.
    private static readonly headerBorderInset = 3;
    // The inner black path is drawn on a slightly smaller box than the grey path.
    private static readonly innerFrameContract = 1.5;
    // Horizontal breathing room added around auto-sized header text.
    private static readonly headerTextPadding = 13.2;
    // Top and bottom breathing room used when headerHeight is auto or explicit.
    private static readonly headerTextVerticalPadding = 2.5;
    private static readonly headerTextFontSize = 10.6;
    // Used only when the browser cannot measure SVG text, for example before the
    // document body exists. It is an approximate width-per-font-size ratio.
    private static readonly fallbackHeaderTextLengthPerFontSize = 0.8;
    // The notch reuses the bottom-right corner angle, but has its own depth.
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
        // The outer path has a thick grey stroke, so it starts inset. The inner
        // path has the actual black border and uses the caller's box directly.
        const xOffset = outer ? this.framePathInset : 0;
        const yOffset = outer ? this.framePathInset : 0;
        const topY = yOffset;
        const rightX = width;
        const bottomY = height;
        const { topLeft, topRight, bottomRight, bottomLeft } = geometry.cornerCuts;
        // The top border starts after the top-left corner cut has climbed up to
        // the top edge. For a square corner, this is just topY.
        const upperInsetY = topY + topLeft.y;
        const tabStartX = topLeft.x + xOffset;
        const headerRightCut = geometry.headerCuts.right;
        // The tab joins the frame path, so its right sloped side needs the same
        // border gap math as the real header geometry.
        const headerRightInset = this.createParallelInsetX(headerRightCut, this.headerBorderInset);
        // Tab width is measured from the frame path's current x, not from the
        // header group's x. This keeps the frame outline aligned with the header.
        const tabWidth = Math.max(geometry.headerOffsetX + geometry.headerWidth - headerRightCut.x + headerRightInset - topLeft.x, 1);

        const path = [
            `M ${xOffset} ${upperInsetY}`,
            `L ${tabStartX} ${topY}`,
            ...(geometry.fullWidthHeader
                // Full-width headers use the normal top border all the way to
                // the right corner; the separate header tab is laid on top.
                ? [`L ${rightX - topRight.x} ${topY}`]
                : [
                    // Tabbed headers bend the frame outline around the header
                    // tab before continuing across the regular top edge.
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
        // The notch slope follows the bottom-right angle, so the bottom details
        // look like one drawing language instead of unrelated decorations.
        const notchCut = this.createAngleCut(bottomRightAngle, this.bottomNotchDepth);
        // Keep the notch inside the bottom edge even if the caller asks for a
        // notch wider than the available space.
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

        // If the requested width is too small for the angled sides, keep at
        // least enough room for both slopes and a 1px flat top.
        const resolvedHeaderWidth = Math.max(geometry.headerWidth, this.createHeaderMinWidth(geometry.headerCuts));
        const naturalTextLength = Math.max(geometry.headerTextLength, 1);
        // A fixed header width may be smaller than the title. In that case SVG
        // textLength squeezes the title into the safe text area.
        const maxTextLength = Math.max(resolvedHeaderWidth - this.headerTextPadding, 1);
        const headerMiddle = resolvedHeaderWidth / 2;
        const headerLeftCut = geometry.headerCuts.left;
        const headerRightCut = geometry.headerCuts.right;
        // Header path coordinates are local to the header group. The middle y is
        // the point of each side tip; the top is y=0 and the bottom is height.
        const headerMiddleY = geometry.headerHeight / 2;
        // The top flat segment is what remains after the two side slopes take
        // their x space.
        const headerTopWidth = Math.max(resolvedHeaderWidth - headerLeftCut.x - headerRightCut.x, 1);
        const headerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        headerPath.setAttribute('d', `M 0 ${headerMiddleY} l ${headerLeftCut.x} -${headerLeftCut.y} h ${headerTopWidth} l ${headerRightCut.x} ${headerRightCut.y} l -${headerRightCut.x} ${headerRightCut.y} h -${headerTopWidth} Z`);
        header.appendChild(headerPath);

        const headerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        headerText.setAttribute('x', headerMiddle.toString());
    // SVG text y is a baseline, not the visual middle. The 0.35 factor moves
    // the baseline down so the text's visible box sits near the tab center.
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
        // Resolve every user option into plain numbers once. Drawing code below
        // should not need to know which values came from defaults or options.
        const cornerAngles = this.createCornerAngles(options.cornerAngleDegrees);
        const cornerCuts = this.createCornerCuts(cornerAngles);
        const fullWidthHeader = options.fullWidthHeader ?? false;
        const headerFontSize = this.createHeaderFontSize(options.headerFontSize);
        const headerHeight = this.createHeaderHeight(options.headerHeight, headerFontSize);
        const headerCuts = this.createHeaderCuts(cornerAngles, fullWidthHeader, headerHeight);
        // Header tips sit halfway down the header, so the side-gap math needs
        // that tip y-position rather than only the top edge.
        const headerMiddleY = Math.max(headerCuts.left.y, headerCuts.right.y);
        const headerMinWidth = this.createHeaderMinWidth(headerCuts);
        const headerTextLength = this.measureHeaderTextLength(title, headerFontSize);
        // Move the header right far enough that its left tip is headerBorderInset
        // away from the sloped frame border.
        const headerOffsetX = this.createHeaderSideInsetX(cornerCuts.topLeft, headerMiddleY, this.headerBorderInset);
        // Full-width headers also need to stop early on the right side by the
        // same visual gap.
        const fullWidthHeaderRightInset = this.createHeaderSideInsetX(cornerCuts.topRight, headerMiddleY, this.headerBorderInset);
        const fullWidthHeaderWidth = Math.max(width - this.innerFrameContract - headerOffsetX - fullWidthHeaderRightInset, headerMinWidth);
        // Auto width means text width plus padding. Numeric width means caller is
        // deliberately fixing the tab, and long text will be squeezed later.
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
        // 0 and 90 are treated as square corners: no diagonal cut is drawn.
        if (angleDegrees <= 0 || angleDegrees >= 90) {
            return { x: 0, y: 0 };
        }

        // The baseline is the 45-degree size. Dividing by cos/sin(45) keeps a
        // 45-degree cut at baseline-by-baseline while other angles stretch x/y.
        const radians = angleDegrees * Math.PI / 180;
        return {
            x: baseline * Math.cos(radians) / Math.SQRT1_2,
            y: baseline * Math.sin(radians) / Math.SQRT1_2
        };
    }

    private static createParallelInsetX(cut: SVGFrameCornerCut, inset: number): number {
        // Square corners can use the inset directly because there is no slope to
        // measure distance from.
        if (cut.x <= 0 || cut.y <= 0) {
            return inset;
        }

        // For a sloped side, moving x by the same amount as the desired gap is
        // not enough. This converts a perpendicular gap from the slope into the
        // horizontal x offset needed at the top edge.
        return inset * (Math.hypot(cut.x, cut.y) - cut.x) / cut.y;
    }

    private static createHeaderSideInsetX(frameCut: SVGFrameCornerCut, headerMiddleY: number, inset: number): number {
        // With a square frame corner, the header can simply start inset pixels
        // from the side.
        if (frameCut.x <= 0 || frameCut.y <= 0) {
            return inset;
        }

        // The risky point is the side tip of the header, not its top-left corner.
        // Work out where that tip lands vertically inside the frame corner cut.
        const headerTipY = inset + headerMiddleY;
        if (headerTipY >= frameCut.y) {
            // If the tip is below the frame corner slope, it only needs the plain
            // side inset because the frame side is vertical there.
            return inset;
        }

        // While the tip is inside the sloped frame corner, push it right until it
        // is inset pixels away from that sloped border.
        return (inset * Math.hypot(frameCut.x, frameCut.y) + frameCut.x * (frameCut.y - headerTipY)) / frameCut.y;
    }

    private static createHeaderMinWidth(headerCuts: SVGFrameHeaderCuts): number {
        // Minimum header width is both side slopes plus a tiny flat top. Without
        // this, very small widths can make the path fold back on itself.
        return headerCuts.left.x + headerCuts.right.x + 1;
    }

    private static createHeaderCuts(cornerAngles: SVGFrameGeometry['cornerAngles'], fullWidthHeader: boolean, headerHeight: number): SVGFrameHeaderCuts {
        return {
            left: this.createHeaderCut(cornerAngles.topLeft, headerHeight),
            right: this.createHeaderCut(fullWidthHeader ? cornerAngles.topRight : cornerAngles.topLeft, headerHeight)
        };
    }

    private static createHeaderCut(angleDegrees: number, headerHeight: number): SVGFrameCornerCut {
        // Header side tips are halfway down the tab, so each sloped side climbs
        // or drops by half the header height.
        const y = headerHeight / 2;
        if (angleDegrees <= 0 || angleDegrees >= 90) {
            return { x: 0, y };
        }

        // For the header, height is the source of truth. Once y is known, x is
        // the run needed to make the side slope match the requested angle.
        return { x: y / Math.tan(angleDegrees * Math.PI / 180), y };
    }

    private static createHeaderFontSize(headerFontSize: number | undefined): number {
        if (headerFontSize === undefined || !Number.isFinite(headerFontSize) || headerFontSize <= 0) {
            return this.headerTextFontSize;
        }

        return headerFontSize;
    }

    private static createHeaderHeight(headerHeight: SVGFrameOptions['headerHeight'], headerFontSize: number): number {
        // Auto height means: make room for the font, then add top and bottom
        // padding. Explicit height uses the same padding so callers can still
        // reason about inner text space consistently.
        const resolvedHeaderHeight = headerHeight === undefined || headerHeight === 'auto' || !Number.isFinite(headerHeight) || headerHeight <= 0
            ? headerFontSize
            : headerHeight;

        return resolvedHeaderHeight + this.headerTextVerticalPadding * 2;
    }

    private static measureHeaderTextLength(title: string, headerFontSize: number): number {
        // Auto width needs the real browser-rendered text length because Roboto
        // is proportional: W is wider than I, and bold changes widths too.
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