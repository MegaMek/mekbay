import {
    BIPED_ARMOR_PIP_LAYOUTS,
    BIPED_STRUCTURE_PIP_LAYOUTS,
} from '../../data/biped-canon-pip-layouts.generated';
import type {
    PipBounds,
    PipGroupLayout,
    PipRenderOptions,
} from './pip-renderer.types';
import { PipRendererShared } from './pip-renderer.shared';

const DEFAULT_USE_CANON_PIP_RADIUS = false;

export class CanonPipRenderer {

    public static createArmorPips(
        location: string,
        armorPipCount: number,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions = {},
    ): SVGGElement | null {
        const locationLayout = BIPED_ARMOR_PIP_LAYOUTS[location];
        const amountLayout = locationLayout?.amount[armorPipCount];
        return amountLayout
            ? this.createPipGroup(
                { ...locationLayout.info, ...amountLayout },
                containerWidth,
                containerHeight,
                options,
                'armor',
                location,
                armorPipCount,
            )
            : null;
    }

    public static createStructurePips(
        tonnage: number,
        location: string,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions = {},
    ): SVGGElement | null {
        const locationLayout = BIPED_STRUCTURE_PIP_LAYOUTS[location];
        const amountLayout = locationLayout?.amount[tonnage];
        return amountLayout
            ? this.createPipGroup(
                { ...locationLayout.info, ...amountLayout },
                containerWidth,
                containerHeight,
                options,
                'structure',
                location,
                tonnage,
            )
            : null;
    }

    public static getStructurePipCount(tonnage: number, location: string): number {
        return BIPED_STRUCTURE_PIP_LAYOUTS[location]?.amount[tonnage]?.points.length ?? 0;
    }

    private static createPipGroup(
        layout: PipGroupLayout,
        containerWidth: number,
        containerHeight: number,
        options: PipRenderOptions,
        type: string,
        location: string,
        value: number,
    ): SVGGElement {
        const group = PipRendererShared.createGroup(options, type, location, value, 'canon');
        const inset = PipRendererShared.getInset(options);
        const availableWidth = Math.max(containerWidth - inset * 2, 0);
        const availableHeight = Math.max(containerHeight - inset * 2, 0);
        const initialScale = Math.min(availableWidth / layout.width, availableHeight / layout.height);
        const strokeWidthRatio = PipRendererShared.getStrokeWidthRatio(options);
        const useCanonPipRadius = (options.useCanonPipRadius ?? DEFAULT_USE_CANON_PIP_RADIUS)
            && Number.isFinite(layout.radius)
            && Number.isFinite(layout.stroke);
        const scale = useCanonPipRadius
            ? initialScale
            : this.getCanonScale(
                layout,
                availableWidth,
                availableHeight,
                initialScale,
                PipRendererShared.getRequestedPipRadius(options),
                strokeWidthRatio,
                PipRendererShared.getPipGap(options),
            );
        const renderedWidth = layout.width * scale;
        const renderedHeight = layout.height * scale;
        const offsetX = inset + (availableWidth - renderedWidth) / 2;
        const offsetY = inset + (availableHeight - renderedHeight) / 2;
        group.setAttribute('transform', `translate(${offsetX} ${offsetY}) scale(${scale})`);

        const renderedPoints = layout.points.map(([x, y]) => ({
            x: offsetX + x * scale,
            y: offsetY + y * scale,
        }));
        const bakedRadius = layout.radius ?? 0;
        const bakedStrokeRatio = bakedRadius > 0
            ? (layout.stroke ?? 0) / bakedRadius
            : strokeWidthRatio;
        const localRadius = useCanonPipRadius
            ? bakedRadius
            : (() => {
                const maximumRadius = PipRendererShared.getMaximumRadiusForPoints(
                    renderedPoints,
                    {
                        left: 0,
                        top: 0,
                        right: containerWidth,
                        bottom: containerHeight,
                    },
                    strokeWidthRatio,
                    inset,
                    PipRendererShared.getPipGap(options),
                );
                const radius = Math.max(
                    0,
                    Math.min(PipRendererShared.getRequestedPipRadius(options), maximumRadius),
                );
                return scale > 0 ? radius / scale : 0;
            })();
        const strokeWidth = useCanonPipRadius
            ? localRadius * bakedStrokeRatio
            : localRadius * strokeWidthRatio;
        for (const [x, y] of layout.points) {
            group.appendChild(PipRendererShared.createPipElement(
                { x, y },
                localRadius,
                options,
                strokeWidth,
            ));
        }

        return group;
    }

    private static getCanonScale(
        layout: Pick<PipGroupLayout, 'width' | 'height' | 'points'>,
        availableWidth: number,
        availableHeight: number,
        initialScale: number,
        requestedRadius: number,
        strokeWidthRatio: number,
        pipGap: number,
    ): number {
        const baseScale = initialScale;
        if (!Number.isFinite(initialScale)
            || initialScale <= 0
            || requestedRadius <= 0
            || layout.points.length <= 1) {
            return initialScale;
        }

        const footprintRadius = PipRendererShared.getPipFootprintRadius(requestedRadius, strokeWidthRatio);
        let minimumScale = 0;
        for (let firstIndex = 0; firstIndex < layout.points.length; firstIndex++) {
            const [firstX, firstY] = layout.points[firstIndex];
            const maximumHorizontalScale = this.getMaximumScaleForEdge(
                availableWidth,
                layout.width,
                firstX,
                footprintRadius,
            );
            const maximumVerticalScale = this.getMaximumScaleForEdge(
                availableHeight,
                layout.height,
                firstY,
                footprintRadius,
            );
            if (maximumHorizontalScale < 0 || maximumVerticalScale < 0) {
                return baseScale;
            }
            initialScale = Math.min(initialScale, maximumHorizontalScale, maximumVerticalScale);

            for (let secondIndex = firstIndex + 1; secondIndex < layout.points.length; secondIndex++) {
                const [secondX, secondY] = layout.points[secondIndex];
                const distance = Math.hypot(firstX - secondX, firstY - secondY);
                if (distance <= 0) {
                    return baseScale;
                }
                minimumScale = Math.max(
                    minimumScale,
                    (footprintRadius * 2 + pipGap) / distance,
                );
            }
        }

        return minimumScale <= initialScale ? initialScale : baseScale;
    }

    private static getMaximumScaleForEdge(
        availableDimension: number,
        layoutDimension: number,
        coordinate: number,
        footprintRadius: number,
    ): number {
        const distanceFromLayoutCenter = Math.abs(coordinate - layoutDimension / 2);
        if (distanceFromLayoutCenter === 0) {
            return Number.POSITIVE_INFINITY;
        }
        return (availableDimension / 2 - footprintRadius) / distanceFromLayoutCenter;
    }
}