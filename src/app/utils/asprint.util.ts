// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { type ApplicationRef, type ComponentRef, createComponent, EnvironmentInjector, type Injector } from '@angular/core';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { UnitGroup } from '../models/force.model';
import { AlphaStrikeCardComponent } from '../components/alpha-strike-card/alpha-strike-card.component';
import { getLayoutForUnitType } from '../components/alpha-strike-card/card-layout.config';
import type { OptionsService } from '../services/options.service';
import type { ColorScheme } from '../models/options.model';
import { isIOS } from './platform.util';
import type { PrintAllOptions } from '../models/print-options.model';
import { mountPrintOverlay } from './print-overlay.util';

/**
 * Represents a single card to render (handles multi-card units)
 */
interface CardRenderItem {
    forceUnit: ASForceUnit;
    cardIndex: number;
    groupIndex: number;
}

interface ASPrintLayout {
    cardScale: number;
    columnsPerPage: number;
    rowsPerPage: number;
    pageSize: 'auto' | 'landscape';
}

// Standard Alpha Strike card dimensions in millimeters.
const CARD_WIDTH_MM = 88;
const CARD_HEIGHT_MM = 63;
// Page dimensions (Letter size with margins)
const PAGE_WIDTH_IN = 8.0;  // 8.5 - 0.5 margins
const PAGE_HEIGHT_IN = 10.5; // 11 - 0.5 margins

const AS_PRINT_LAYOUTS = {
    standard: {
        cardScale: 1,
        columnsPerPage: 2,
        rowsPerPage: 4,
        pageSize: 'auto',
    },
    enlarged: {
        // Halving the cards per page doubles each card's printed area.
        cardScale: Math.SQRT2,
        columnsPerPage: 2,
        rowsPerPage: 2,
        pageSize: 'landscape',
    },
} satisfies Record<PrintAllOptions['ASPrintCardSize'], ASPrintLayout>;

type ASCardPrintOptions = Pick<
    PrintAllOptions,
    'clean' | 'ASPrintPageBreakOnGroups' | 'ASPrintCardSize' | 'printMargin'
>;

interface ASPrintUnitSnapshot {
    unit: ASForceUnit;
    serialized: ReturnType<ASForceUnit['serialize']>;
    disabledSaving: boolean;
}

interface ASPrintContainerOptions {
    appRef: ApplicationRef;
    injector: Injector;
    optionsService: OptionsService;
    cardItems: CardRenderItem[];
    pageBreakOnGroups: boolean;
    groups: UnitGroup<ASForceUnit>[];
    printMargin: PrintAllOptions['printMargin'];
    cardSize: PrintAllOptions['ASPrintCardSize'];
    componentRefs: ComponentRef<AlphaStrikeCardComponent>[];
}


export class ASPrintUtil {
    /**
     * Prints Alpha Strike cards using the selected per-page card layout.
     * 
     * @param appRef - Angular ApplicationRef for dynamic component creation
     * @param injector - Angular Injector for dependency injection
     * @param optionsService - Options service for card style preferences
     * @param groups - Array of UnitGroup to print
     * @param printOptions - One-off settings for this print job
     * @param triggerPrint - If true, triggers the browser print dialog
     */
    public static async multipagePrint(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        groups: UnitGroup<ASForceUnit>[],
        printOptions: ASCardPrintOptions,
        triggerPrint: boolean = true,
    ): Promise<void> {
        const allUnits = groups.flatMap(g => g.units());
        if (allUnits.length === 0) {
            console.warn('No units to export.');
            return;
        }

        const restoreUnits = this.prepareUnitsForPrint(allUnits, printOptions.clean);
        const cardComponentRefs: ComponentRef<AlphaStrikeCardComponent>[] = [];
        let detachedViewCount = 0;
        const detachViews = () => {
            let firstError: unknown;
            while (detachedViewCount < cardComponentRefs.length) {
                const ref = cardComponentRefs[detachedViewCount];
                detachedViewCount++;
                try {
                    appRef.detachView(ref.hostView);
                } catch (error) {
                    firstError ??= error;
                }
            }
            if (firstError !== undefined) {
                throw firstError;
            }
        };
        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;

            let firstError: unknown;
            const attempt = (operation: () => void) => {
                try {
                    operation();
                } catch (error) {
                    firstError ??= error;
                }
            };

            attempt(restoreUnits);
            attempt(detachViews);
            for (const ref of cardComponentRefs) {
                attempt(() => ref.destroy());
            }
            if (firstError !== undefined) {
                throw firstError;
            }
        };

        try {
            const cardRenderItems = this.expandToCardItems(groups);
            const containerOptions: ASPrintContainerOptions = {
                appRef,
                injector,
                optionsService,
                cardItems: cardRenderItems,
                pageBreakOnGroups: printOptions.ASPrintPageBreakOnGroups,
                groups,
                printMargin: printOptions.printMargin,
                cardSize: printOptions.ASPrintCardSize,
                componentRefs: cardComponentRefs,
            };
            const overlay = isIOS()
                ? this.createFixedPrintContainer(containerOptions)
                : this.createFlexPrintContainer(containerOptions);

            await mountPrintOverlay({
                overlay,
                bodyClass: 'as-multipage-container-active',
                triggerPrint,
                onMount: () => {
                    appRef.tick();
                },
                onCleanup: cleanup,
            });
        } catch (error) {
            cleanup();
            throw error;
        }
    }

    /**
     * Expands force units into individual card render items.
     * Multi-card units (like large vessels) are expanded into multiple entries.
     * @param groups - Array of UnitGroups
     */
    private static expandToCardItems(groups: UnitGroup<ASForceUnit>[]): CardRenderItem[] {
        const items: CardRenderItem[] = [];
        
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const groupUnits = groups[groupIndex].units();
            for (const forceUnit of groupUnits) {
                const unitType = forceUnit.getSummary().as.TP;
                const layout = getLayoutForUnitType(unitType);
                const cardCount = layout.cards.length;
                
                for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
                    items.push({ forceUnit, cardIndex, groupIndex });
                }
            }
        }
        
        return items;
    }

    private static prepareUnitsForPrint(units: ASForceUnit[], clean: boolean): () => void {
        const snapshots: ASPrintUnitSnapshot[] = units.map(unit => ({
            unit,
            serialized: unit.serialize(),
            disabledSaving: unit.disabledSaving,
        }));
        let restored = false;
        const restore = () => {
            if (restored) return;

            let firstError: unknown;
            for (const snapshot of snapshots) {
                try {
                    snapshot.unit.update(snapshot.serialized);
                } catch (error) {
                    firstError ??= error;
                } finally {
                    snapshot.unit.disabledSaving = snapshot.disabledSaving;
                }
            }
            restored = true;
            if (firstError !== undefined) {
                throw firstError;
            }
        };

        try {
            for (const unit of units) {
                unit.disabledSaving = true;
                if (clean) {
                    unit.repairAll();
                } else {
                    unit.setHeat(0);
                    unit.setPendingHeat(0);
                }
            }
        } catch (error) {
            restore();
            throw error;
        }

        return restore;
    }

    /**
     * Creates a fixed grid print container (iOS-specific).
     * Uses fixed page dimensions for reliable printing on iOS.
     */
    private static createFixedPrintContainer({
        appRef,
        injector,
        optionsService,
        cardItems,
        pageBreakOnGroups,
        groups,
        printMargin,
        cardSize,
        componentRefs,
    }: ASPrintContainerOptions): HTMLElement {
        const useHex = optionsService.options().ASUseHex;
        const cardStyle = optionsService.options().colorScheme;
        const layout = this.getPrintLayout(cardSize);
        const cardsPerPage = layout.columnsPerPage * layout.rowsPerPage;
        
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'as-multipage-container';
        
        // Add print styles
        const style = document.createElement('style');
        style.textContent = this.getFixedPrintStyles(printMargin, cardSize);
        overlay.appendChild(style);
        
        // Group cards by groupIndex if pageBreakOnGroups is enabled
        if (pageBreakOnGroups) {
            const groupedCards = this.groupCardsByGroupIndex(cardItems);
            let isLastGroup = false;
            
            for (let g = 0; g < groupedCards.length; g++) {
                const groupCards = groupedCards[g];
                isLastGroup = g === groupedCards.length - 1;
                const totalPagesInGroup = Math.ceil(groupCards.length / cardsPerPage);
                
                for (let pageIndex = 0; pageIndex < totalPagesInGroup; pageIndex++) {
                    const pageDiv = document.createElement('div');
                    pageDiv.className = 'as-print-page';
                    
                    // Mark last page of last group
                    const isLastPageOfGroup = pageIndex === totalPagesInGroup - 1;
                    if (isLastGroup && isLastPageOfGroup) {
                        pageDiv.classList.add('last-page');
                    }

                    // Add group header on first page of each group
                    if (pageIndex === 0 && groups.length > 1) {
                        const group = groups[groupCards[0].groupIndex];
                        if (group) {
                            pageDiv.appendChild(this.createGroupHeaderElement(group));
                        }
                    }
                    
                    const startIndex = pageIndex * cardsPerPage;
                    const endIndex = Math.min(startIndex + cardsPerPage, groupCards.length);
                    
                    for (let i = startIndex; i < endIndex; i++) {
                        const item = groupCards[i];
                        this.appendCardToContainer(pageDiv, item, appRef, injector, useHex, cardStyle, componentRefs);
                    }
                    
                    overlay.appendChild(pageDiv);
                }
            }
        } else {
            // Simple pagination
            const totalPages = Math.ceil(cardItems.length / cardsPerPage);
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const pageDiv = document.createElement('div');
                pageDiv.className = 'as-print-page';
                if (pageIndex === totalPages - 1) {
                    pageDiv.classList.add('last-page');
                }
                
                const startIndex = pageIndex * cardsPerPage;
                const endIndex = Math.min(startIndex + cardsPerPage, cardItems.length);
                
                for (let i = startIndex; i < endIndex; i++) {
                    const item = cardItems[i];
                    this.appendCardToContainer(pageDiv, item, appRef, injector, useHex, cardStyle, componentRefs);
                }
                
                overlay.appendChild(pageDiv);
            }
        }
        
        return overlay;
    }

    /**
     * Creates a flexible print container (non-iOS platforms).
     * Uses flexbox with auto-wrapping for portrait/landscape support.
     */
    private static createFlexPrintContainer({
        appRef,
        injector,
        optionsService,
        cardItems,
        pageBreakOnGroups,
        groups,
        printMargin,
        cardSize,
        componentRefs,
    }: ASPrintContainerOptions): HTMLElement {
        const useHex = optionsService.options().ASUseHex;
        const cardStyle = optionsService.options().colorScheme;
        
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'as-multipage-container';
        
        // Add print styles
        const style = document.createElement('style');
        style.textContent = this.getFlexPrintStyles(printMargin, cardSize);
        overlay.appendChild(style);
        
        if (pageBreakOnGroups) {
            // Create separate flex containers for each group with page breaks
            const groupedCards = this.groupCardsByGroupIndex(cardItems);
            
            for (let g = 0; g < groupedCards.length; g++) {
                const groupCards = groupedCards[g];
                const isLastGroup = g === groupedCards.length - 1;
                
                const flexContainer = document.createElement('div');
                flexContainer.className = 'as-flex-container';
                if (!isLastGroup) {
                    flexContainer.classList.add('as-group-break');
                }

                // Add group header
                if (groups.length > 1) {
                    const group = groups[groupCards[0].groupIndex];
                    if (group) {
                        flexContainer.appendChild(this.createGroupHeaderElement(group));
                    }
                }
                
                for (const item of groupCards) {
                    this.appendCardToContainer(flexContainer, item, appRef, injector, useHex, cardStyle, componentRefs);
                }
                
                overlay.appendChild(flexContainer);
            }
        } else {
            // Simple pagination
            const flexContainer = document.createElement('div');
            flexContainer.className = 'as-flex-container';

            // Add group headers inline when multiple groups
            if (groups.length > 1) {
                let lastGroupIndex = -1;
                for (const item of cardItems) {
                    if (item.groupIndex !== lastGroupIndex) {
                        const group = groups[item.groupIndex];
                        if (group) {
                            flexContainer.appendChild(this.createGroupHeaderElement(group));
                        }
                        lastGroupIndex = item.groupIndex;
                    }
                    this.appendCardToContainer(flexContainer, item, appRef, injector, useHex, cardStyle, componentRefs);
                }
            } else {
                for (const item of cardItems) {
                    this.appendCardToContainer(flexContainer, item, appRef, injector, useHex, cardStyle, componentRefs);
                }
            }
            
            overlay.appendChild(flexContainer);
        }
        
        return overlay;
    }
    
    /**
     * Helper to group card items by their groupIndex.
     */
    private static groupCardsByGroupIndex(cardItems: CardRenderItem[]): CardRenderItem[][] {
        const groups: Map<number, CardRenderItem[]> = new Map();
        
        for (const item of cardItems) {
            if (!groups.has(item.groupIndex)) {
                groups.set(item.groupIndex, []);
            }
            groups.get(item.groupIndex)!.push(item);
        }
        
        // Return groups in order of groupIndex
        return Array.from(groups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, items]) => items);
    }

    /**
     * Creates a DOM element for a group header (name + optional formation).
     */
    private static createGroupHeaderElement(group: UnitGroup<ASForceUnit>): HTMLElement {
        const header = document.createElement('div');
        header.className = 'as-group-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'as-group-name';
        nameSpan.textContent = group.groupDisplayName();
        header.appendChild(nameSpan);

        const subtitle = group.formationDisplayName();
        if (subtitle) {
            const formSpan = document.createElement('span');
            formSpan.className = 'as-group-formation';
            formSpan.textContent = subtitle;
            header.appendChild(formSpan);
            if (!group.hasValidFormation()) {
                const warnSpan = document.createElement('span');
                warnSpan.className = 'as-group-warning';
                warnSpan.textContent = '⚠ Invalid Formation';
                header.appendChild(warnSpan);
            }
        }

        return header;
    }

    /**
     * Helper to create and append a card component to a container.
     */
    private static appendCardToContainer(
        container: HTMLElement,
        item: CardRenderItem,
        appRef: ApplicationRef,
        injector: Injector,
        useHex: boolean,
        cardStyle: ColorScheme,
        componentRefs: ComponentRef<AlphaStrikeCardComponent>[]
    ): void {
        const cellDiv = document.createElement('div');
        cellDiv.className = 'as-card-cell';
        
        const environmentInjector = injector.get(EnvironmentInjector);
        const componentRef = createComponent(AlphaStrikeCardComponent, {
            environmentInjector,
            elementInjector: injector
        });
        let attached = false;
        try {
            componentRef.setInput('forceUnit', item.forceUnit);
            componentRef.setInput('cardIndex', item.cardIndex);
            componentRef.setInput('cardStyle', cardStyle);
            componentRef.setInput('useHex', useHex);
            componentRef.setInput('isSelected', false);

            appRef.attachView(componentRef.hostView);
            attached = true;

            const cardElement = componentRef.location.nativeElement as HTMLElement;
            cellDiv.appendChild(cardElement);
            container.appendChild(cellDiv);
            componentRefs.push(componentRef);
        } catch (error) {
            if (attached) {
                appRef.detachView(componentRef.hostView);
            }
            componentRef.destroy();
            throw error;
        }
    }

    private static getPrintLayout(cardSize: PrintAllOptions['ASPrintCardSize']): ASPrintLayout {
        return AS_PRINT_LAYOUTS[cardSize];
    }

    /**
     * Returns the CSS styles for fixed grid printing (iOS).
     * Standard card size: 88mm x 63mm.
     */
    private static getFixedPrintStyles(
        printMargin: PrintAllOptions['printMargin'],
        cardSize: PrintAllOptions['ASPrintCardSize']
    ): string {
        const layout = this.getPrintLayout(cardSize);
        const cardWidthMm = `${CARD_WIDTH_MM * layout.cardScale}mm`;
        const cardHeightMm = `${CARD_HEIGHT_MM * layout.cardScale}mm`;
        const cardFontSizeMm = `${CARD_WIDTH_MM * layout.cardScale / 100}mm`;
        const justifyContent = cardSize === 'enlarged' ? 'center' : 'flex-start';
        const pageWidthIn = `${layout.pageSize === 'landscape' ? PAGE_HEIGHT_IN : PAGE_WIDTH_IN}in`;
        const pageHeightIn = `${layout.pageSize === 'landscape' ? PAGE_WIDTH_IN : PAGE_HEIGHT_IN}in`;
        
        return `
            @media screen {
                #as-multipage-container {
                    display: none;
                    z-index: -1000;
                }
            }

            .as-print-page {
                width: ${pageWidthIn};
                height: ${pageHeightIn};
                display: -webkit-flex;
                display: flex;
                -webkit-flex-wrap: wrap;
                flex-wrap: wrap;
                -webkit-align-content: flex-start;
                align-content: flex-start;
                -webkit-justify-content: ${justifyContent};
                justify-content: ${justifyContent};
                gap: 0.01in;
                background: white;
                box-sizing: border-box;
                overflow: hidden;
            }

            .as-card-cell {
                -webkit-flex: 0 0 ${cardWidthMm};
                flex: 0 0 ${cardWidthMm};
                width: ${cardWidthMm};
                height: ${cardHeightMm};
                display: -webkit-flex;
                display: flex;
                -webkit-justify-content: center;
                justify-content: center;
                -webkit-align-items: center;
                align-items: center;
                overflow: hidden;
                box-sizing: border-box;
            }

            .as-card-cell > alpha-strike-card {
                display: block;
                width: ${cardWidthMm};
                height: ${cardHeightMm};
            }

            .as-card-cell > alpha-strike-card > .card-container {
                width: ${cardWidthMm};
                font-size: ${cardFontSizeMm};
            }

            .as-group-header {
                width: 100%;
                flex-basis: 100%;
                display: flex;
                align-items: baseline;
                gap: 0.06in;
                padding: 0.06in 0.04in;
                font-family: sans-serif;
                color: #333;
                border-bottom: 1px solid #bbb;
                margin-bottom: 0.04in;
            }

            .as-group-name {
                font-size: 11pt;
                font-weight: 700;
            }

            .as-group-formation {
                font-weight: 400;
                color: #666;
            }

            .as-group-formation::before {
                content: '·';
                margin-right: 4px;
            }

            .as-group-warning {
                font-weight: 600;
                color: #000;
                margin-left: 0.05in;
            }

            @media print {
                body, html {
                    margin: 0 !important;
                    padding: 0 !important;
                }

                body.as-multipage-container-active > *:not(#as-multipage-container) {
                    display: none !important;
                }

                .as-print-page {
                    page-break-after: always;
                    break-after: page;
                    margin: 0;
                    padding: 0;
                }

                .as-print-page.last-page {
                    page-break-after: auto;
                    break-after: auto;
                }

                @page {
                    size: ${layout.pageSize};
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

    /**
     * Returns the CSS styles for flexible printing (non-iOS platforms).
     * Uses flexbox with auto-wrapping for portrait/landscape support.
     */
    private static getFlexPrintStyles(
        printMargin: PrintAllOptions['printMargin'],
        cardSize: PrintAllOptions['ASPrintCardSize']
    ): string {
        const layout = this.getPrintLayout(cardSize);
        const cardWidthMm = `${CARD_WIDTH_MM * layout.cardScale}mm`;
        const cardHeightMm = `${CARD_HEIGHT_MM * layout.cardScale}mm`;
        const cardFontSizeMm = `${CARD_WIDTH_MM * layout.cardScale / 100}mm`;
        const justifyContent = cardSize === 'enlarged' ? 'center' : 'flex-start';
        
        return `            
            @media screen {
                #as-multipage-container {
                    display: none;
                    z-index: -1000;
                }
            }

            .as-flex-container {
                display: flex;
                flex-wrap: wrap;
                align-content: flex-start;
                justify-content: ${justifyContent};
                gap: 0.01in;
                background: white;
                padding: 0;
            }

            .as-card-cell {
                flex: 0 0 ${cardWidthMm};
                width: ${cardWidthMm};
                height: ${cardHeightMm};
                display: flex;
                justify-content: center;
                align-items: center;
                overflow: hidden;
                box-sizing: border-box;
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .as-card-cell > alpha-strike-card {
                display: block;
                width: ${cardWidthMm};
                height: ${cardHeightMm};
            }

            .as-card-cell > alpha-strike-card > .card-container {
                width: ${cardWidthMm};
                font-size: ${cardFontSizeMm};
            }

            .as-group-header {
                width: 100%;
                flex-basis: 100%;
                display: flex;
                align-items: baseline;
                gap: 0.05in;
                padding: 0.06in 0.04in;
                font-family: sans-serif;
                color: #333;
                border-bottom: 1px solid #bbb;
                margin-bottom: 0.04in;
            }

            .as-group-name {
                font-size: 11pt;
                font-weight: 700;
            }

            .as-group-formation {
                font-weight: 400;
                color: #666;
            }

            .as-group-formation::before {
                content: '·';
                margin-right: 4px;
            }

            .as-group-warning {
                font-weight: 600;
                color: #000;
                margin-left: 0.05in;
            }

            @media print {
                body, html {
                    margin: 0 !important;
                    padding: 0 !important;
                }

                body.as-multipage-container-active > *:not(#as-multipage-container) {
                    display: none !important;
                }

                .as-flex-container.as-group-break {
                    page-break-after: always;
                    break-after: page;
                }

                @page {
                    size: ${layout.pageSize};
                    margin: ${printMargin === 'none' ? '0' : '0.25in'} !important;
                }

            }
        `;
    }

}
