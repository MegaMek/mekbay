import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { PAGE_GAP, PAGE_WIDTH } from '../page-viewer-zoom-pan.service';
import type { PageViewerShadowDescriptor } from './types';

@Injectable()
export class PageViewerShadowRenderService {
    private readonly shadowBindings = new WeakMap<HTMLDivElement, {
        descriptor: PageViewerShadowDescriptor;
        onShadowClick: (descriptor: PageViewerShadowDescriptor, wrapper: HTMLDivElement, event: MouseEvent) => void;
        sourceSvg: SVGSVGElement | null;
    }>();

    bindDeclarativeShadowPages(options: {
        wrappers: HTMLDivElement[];
        currentCleanups: Array<() => void>;
        descriptors: readonly PageViewerShadowDescriptor[];
        scale: number;
        showFluff: boolean;
        setPromotedShadowState: (wrapper: HTMLDivElement, isPromoted: boolean) => void;
        applyWrapperLayout: (wrapper: HTMLDivElement, options: { originalLeft: number; scale?: number }) => void;
        setPageWrapperContentState: (wrapper: HTMLDivElement, hasSvg: boolean) => void;
        applyFluffImageVisibilityToSvg: (svg: SVGSVGElement, showFluff: boolean) => void;
        onShadowClick: (descriptor: PageViewerShadowDescriptor, wrapper: HTMLDivElement, event: MouseEvent) => void;
    }): Array<() => void> {
        const {
            wrappers,
            currentCleanups,
            descriptors,
            scale,
            showFluff,
            setPromotedShadowState,
            applyWrapperLayout,
            setPageWrapperContentState,
            applyFluffImageVisibilityToSvg,
            onShadowClick
        } = options;

        const descriptorMap = new Map(descriptors.map((descriptor) => [descriptor.key, descriptor]));

        for (const wrapper of wrappers) {
            const shadowKey = wrapper.dataset['shadowKey'];
            if (!shadowKey) {
                continue;
            }

            const descriptor = descriptorMap.get(shadowKey);
            if (!descriptor) {
                continue;
            }

            wrapper.dataset['shadowDirection'] = descriptor.direction;
            setPromotedShadowState(wrapper, false);
            applyWrapperLayout(wrapper, { originalLeft: descriptor.originalLeft, scale });

            const sourceSvg = descriptor.unit.svg();
            const existingSvg = wrapper.querySelector(':scope > svg');
            const currentBinding = this.shadowBindings.get(wrapper);
            const canReuseExistingSvg =
                existingSvg instanceof SVGSVGElement &&
                currentBinding?.descriptor.unitId === descriptor.unitId &&
                currentBinding.sourceSvg === sourceSvg;

            let boundSvg: SVGSVGElement | null = canReuseExistingSvg ? existingSvg : null;

            if (!canReuseExistingSvg && existingSvg && existingSvg.parentElement === wrapper) {
                wrapper.removeChild(existingSvg);
            }

            if (!boundSvg && sourceSvg) {
                boundSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
                boundSvg.style.pointerEvents = 'none';
                wrapper.insertBefore(boundSvg, wrapper.firstChild);
            }

            if (boundSvg) {
                boundSvg.style.transform = `scale(${scale})`;
                boundSvg.style.transformOrigin = 'top left';
                applyFluffImageVisibilityToSvg(boundSvg, showFluff);
            }

            setPageWrapperContentState(wrapper, !!boundSvg);

            if (!currentBinding) {
                wrapper.addEventListener('click', (event: MouseEvent) => {
                    const binding = this.shadowBindings.get(wrapper);
                    if (!binding) {
                        return;
                    }

                    binding.onShadowClick(binding.descriptor, wrapper, event);
                });
            }

            this.shadowBindings.set(wrapper, {
                descriptor,
                onShadowClick,
                sourceSvg
            });
        }

        return [];
    }

    createIncomingShadowPages(options: {
        clickedShadow: HTMLDivElement;
        targetIndex: number;
        direction: 'left' | 'right';
        pagesToMove: number;
        scale: number;
        showFluff: boolean;
        allUnits: CBTForceUnit[];
        shadowPageElements: readonly HTMLDivElement[];
        activeUnitIds: ReadonlySet<string>;
        getShadowKey: (unitIndex: number, direction: 'left' | 'right') => string;
        isAnimationActive: () => boolean;
        upsertTransientShadowPage: (descriptor: PageViewerShadowDescriptor, scale: number, showFluff: boolean) => void;
    }): void {
        const {
            clickedShadow,
            targetIndex,
            direction,
            pagesToMove,
            scale,
            showFluff,
            allUnits,
            shadowPageElements,
            activeUnitIds,
            getShadowKey,
            isAnimationActive,
            upsertTransientShadowPage
        } = options;

        const totalUnits = allUnits.length;
        const scaledPageStep = (PAGE_WIDTH + PAGE_GAP) * scale;
        const clickedShadowLeft = parseFloat(clickedShadow.style.left) || 0;
        const incomingCount = Math.abs(pagesToMove);
        const existingShadowKeys = this.collectExistingShadowKeys(shadowPageElements, getShadowKey);

        for (let index = 1; index <= incomingCount; index++) {
            const unitOffset = direction === 'right' ? index : -index;
            const incomingUnitIndex = (targetIndex + unitOffset + totalUnits) % totalUnits;
            const incomingShadowKey = getShadowKey(incomingUnitIndex, direction);

            if (existingShadowKeys.has(incomingShadowKey)) {
                continue;
            }

            const unit = allUnits[incomingUnitIndex];
            if (!unit || activeUnitIds.has(unit.id)) {
                continue;
            }

            const positionOffset = direction === 'right' ? index : -index;
            const incomingPosition = clickedShadowLeft + positionOffset * scaledPageStep;

            unit.load().then(() => {
                if (!isAnimationActive() || !clickedShadow.isConnected) {
                    return;
                }

                upsertTransientShadowPage({
                    key: incomingShadowKey,
                    unit,
                    unitId: unit.id,
                    unitIndex: incomingUnitIndex,
                    direction,
                    originalLeft: incomingPosition / scale,
                    scaledLeft: incomingPosition,
                    isDimmed: true
                }, scale, showFluff);
            });
        }
    }

    clearShadowPages(options: {
        shadowPageElements: readonly HTMLDivElement[];
        shadowPageCleanups: Array<() => void>;
    }): {
        shadowPageElements: HTMLDivElement[];
        shadowPageCleanups: Array<() => void>;
    } {
        const { shadowPageElements, shadowPageCleanups } = options;

        shadowPageCleanups.forEach((cleanup) => cleanup());

        shadowPageElements.forEach((element) => {
            if (element.dataset['renderMode'] !== 'declarative-shadow' && element.parentElement) {
                element.parentElement.removeChild(element);
            }
            element.innerHTML = '';
        });

        return {
            shadowPageElements: [],
            shadowPageCleanups: []
        };
    }

    collectExistingShadowKeys(
        shadowPageElements: readonly HTMLDivElement[],
        getShadowKey: (unitIndex: number, direction: 'left' | 'right') => string
    ): Set<string> {
        return new Set(
            shadowPageElements
                .map((element) => {
                    const unitIndex = parseInt(element.dataset['unitIndex'] ?? '-1', 10);
                    const direction = element.dataset['shadowDirection'];
                    if ((direction !== 'left' && direction !== 'right') || Number.isNaN(unitIndex)) {
                        return '';
                    }

                    return getShadowKey(unitIndex, direction);
                })
                .filter((key) => key.length > 0)
        );
    }
}