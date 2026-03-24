/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { Force, UnitGroup } from '../models/force.model';
import { AlphaStrikeCardComponent } from '../components/alpha-strike-card/alpha-strike-card.component';
import { getLayoutForUnitType } from '../components/alpha-strike-card/card-layout.config';
import type { OptionsService } from '../services/options.service';
import { isIOS } from './platform.util';
import type { PrintAllOptions } from '../models/print-options.model';
import { createPrintRosterLogoMarkup, createPrintRosterQrMarkup, getPrintRosterBrandingStyles } from './print-roster-branding.util';

/**
 * Represents a single card to render (handles multi-card units)
 */
interface CardRenderItem {
    forceUnit: ASForceUnit;
    cardIndex: number;
    groupIndex: number;
}

// Card dimensions in inches (88mm x 63mm)
const CARD_WIDTH_IN = 3.46;
const CARD_HEIGHT_IN = 2.48;
// Page dimensions (Letter size with margins)
const PAGE_WIDTH_IN = 8.0;  // 8.5 - 0.5 margins
const PAGE_HEIGHT_IN = 10.5; // 11 - 0.5 margins
// Calculate cards per page
const COLS_PER_PAGE = Math.floor(PAGE_WIDTH_IN / CARD_WIDTH_IN);
const ROWS_PER_PAGE = Math.floor(PAGE_HEIGHT_IN / CARD_HEIGHT_IN);
const CARDS_PER_PAGE = COLS_PER_PAGE * ROWS_PER_PAGE;

/*
 * Author: Drake
 */
export class ASPrintUtil {
    /**
     * Prints Alpha Strike cards in a 2-column, 4-row grid layout per page.
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
        printOptions: PrintAllOptions,
        triggerPrint: boolean = true,
        force?: Force
    ): Promise<void> {
        const allUnits = groups.flatMap(g => g.units());
        if (allUnits.length === 0) {
            console.warn('No units to export.');
            return;
        }

        const clean = printOptions.clean;

        // Store original heat values and set to 0 for printing
        const originalHeats = new Map<ASForceUnit, number>();
        if (!clean) {
            for (const unit of allUnits) {
                unit.disabledSaving = true;
                const unitHeat = unit.getHeat();
                originalHeats.set(unit, unitHeat);
                unit.setHeat(0);
            }
        }

        // Expand units into individual cards (multi-card units become multiple entries)
        const cardRenderItems = this.expandToCardItems(groups);
        const pageBreakOnGroups = printOptions.ASPrintPageBreakOnGroups;
        
        // Create print container - use different layouts for iOS vs other platforms
        const useFixedLayout = isIOS();
        const { overlay, cardComponentRefs } = useFixedLayout
            ? await this.createFixedPrintContainer(appRef, injector, optionsService, cardRenderItems, pageBreakOnGroups, groups, printOptions.printMargin)
            : await this.createFlexPrintContainer(appRef, injector, optionsService, cardRenderItems, pageBreakOnGroups, groups, printOptions.printMargin);

        // Insert roster summary page first if enabled
        const printRosterSummary = printOptions.printRosterSummary;
        if (printRosterSummary && force) {
            const rosterPage = await this.createRosterSummaryPage(groups, force);
            const firstContentNode = Array.from(overlay.children).find(child => !(child instanceof HTMLStyleElement));
            if (firstContentNode) {
                overlay.insertBefore(rosterPage, firstContentNode);
            } else {
                overlay.appendChild(rosterPage);
            }
        }

        // Wait for fonts and images to load
        if ((document as any).fonts?.ready) {
            try { await (document as any).fonts.ready; } catch { /* ignore */ }
        }
        await this.waitForImagesToLoad(overlay);
        await this.nextAnimationFrames(2);

        // Trigger print
        if (triggerPrint) {
            window.print();
        }

        // Remove overlay on first user interaction
        const removeOverlay = () => {
            // Cleanup component refs
            for (const ref of cardComponentRefs) {
                appRef.detachView(ref.hostView);
                ref.destroy();
            }

            overlay.remove();
            document.body.classList.remove('as-multipage-container-active');

            // Restore original heat values
            if (originalHeats.size > 0) {
                for (const unit of allUnits) {
                    const heat = originalHeats.get(unit);
                    if (heat !== undefined) {
                        unit.setHeat(heat);
                        unit.disabledSaving = false;
                    }
                }
            }

            window.removeEventListener('click', removeOverlay, { capture: true });
            window.removeEventListener('keydown', removeOverlay, { capture: true });
            window.removeEventListener('pointerdown', removeOverlay, { capture: true });
        };

        window.addEventListener('click', removeOverlay, { capture: true, once: true });
        window.addEventListener('keydown', removeOverlay, { capture: true, once: true });
        window.addEventListener('pointerdown', removeOverlay, { capture: true, once: true });
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
                const unitType = forceUnit.getUnit().as.TP;
                const layout = getLayoutForUnitType(unitType);
                const cardCount = layout.cards.length;
                
                for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
                    items.push({ forceUnit, cardIndex, groupIndex });
                }
            }
        }
        
        return items;
    }

    /**
     * Creates a fixed grid print container (iOS-specific).
     * Uses fixed page dimensions for reliable printing on iOS.
     */
    private static async createFixedPrintContainer(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        cardItems: CardRenderItem[],
        pageBreakOnGroups: boolean,
        groups: UnitGroup<ASForceUnit>[],
        printMargin: PrintAllOptions['printMargin']
    ): Promise<{ overlay: HTMLElement; cardComponentRefs: ComponentRef<AlphaStrikeCardComponent>[] }> {
        const componentRefs: ComponentRef<AlphaStrikeCardComponent>[] = [];
        const useHex = optionsService.options().ASUseHex;
        const cardStyle = optionsService.options().ASCardStyle;
        
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'as-multipage-container';
        
        // Add print styles
        const style = document.createElement('style');
        style.textContent = this.getFixedPrintStyles(printMargin);
        overlay.appendChild(style);
        
        // Group cards by groupIndex if pageBreakOnGroups is enabled
        if (pageBreakOnGroups) {
            const groupedCards = this.groupCardsByGroupIndex(cardItems);
            let isLastGroup = false;
            
            for (let g = 0; g < groupedCards.length; g++) {
                const groupCards = groupedCards[g];
                isLastGroup = g === groupedCards.length - 1;
                const totalPagesInGroup = Math.ceil(groupCards.length / CARDS_PER_PAGE);
                
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
                    
                    const startIndex = pageIndex * CARDS_PER_PAGE;
                    const endIndex = Math.min(startIndex + CARDS_PER_PAGE, groupCards.length);
                    
                    for (let i = startIndex; i < endIndex; i++) {
                        const item = groupCards[i];
                        this.appendCardToContainer(pageDiv, item, appRef, injector, useHex, cardStyle, componentRefs);
                    }
                    
                    overlay.appendChild(pageDiv);
                }
            }
        } else {
            // Simple pagination
            const totalPages = Math.ceil(cardItems.length / CARDS_PER_PAGE);
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const pageDiv = document.createElement('div');
                pageDiv.className = 'as-print-page';
                if (pageIndex === totalPages - 1) {
                    pageDiv.classList.add('last-page');
                }
                
                const startIndex = pageIndex * CARDS_PER_PAGE;
                const endIndex = Math.min(startIndex + CARDS_PER_PAGE, cardItems.length);
                
                for (let i = startIndex; i < endIndex; i++) {
                    const item = cardItems[i];
                    this.appendCardToContainer(pageDiv, item, appRef, injector, useHex, cardStyle, componentRefs);
                }
                
                overlay.appendChild(pageDiv);
            }
        }
        
        // Append to body
        document.body.appendChild(overlay);
        document.body.classList.add('as-multipage-container-active');
        
        // Trigger change detection for all components
        appRef.tick();
        
        return { overlay, cardComponentRefs: componentRefs };
    }

    /**
     * Creates a flexible print container (non-iOS platforms).
     * Uses flexbox with auto-wrapping for portrait/landscape support.
     */
    private static async createFlexPrintContainer(
        appRef: ApplicationRef,
        injector: Injector,
        optionsService: OptionsService,
        cardItems: CardRenderItem[],
        pageBreakOnGroups: boolean,
        groups: UnitGroup<ASForceUnit>[],
        printMargin: PrintAllOptions['printMargin']
    ): Promise<{ overlay: HTMLElement; cardComponentRefs: ComponentRef<AlphaStrikeCardComponent>[] }> {
        const componentRefs: ComponentRef<AlphaStrikeCardComponent>[] = [];
        const useHex = optionsService.options().ASUseHex;
        const cardStyle = optionsService.options().ASCardStyle;
        
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'as-multipage-container';
        
        // Add print styles
        const style = document.createElement('style');
        style.textContent = this.getFlexPrintStyles(printMargin);
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
        
        // Append to body
        document.body.appendChild(overlay);
        document.body.classList.add('as-multipage-container-active');
        
        // Trigger change detection for all components
        appRef.tick();
        
        return { overlay, cardComponentRefs: componentRefs };
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

        const formation = group.activeFormation();
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
        cardStyle: string,
        componentRefs: ComponentRef<AlphaStrikeCardComponent>[]
    ): void {
        const cellDiv = document.createElement('div');
        cellDiv.className = 'as-card-cell';
        
        const environmentInjector = injector.get(EnvironmentInjector);
        const componentRef = createComponent(AlphaStrikeCardComponent, {
            environmentInjector,
            elementInjector: injector
        });
        
        componentRef.setInput('forceUnit', item.forceUnit);
        componentRef.setInput('cardIndex', item.cardIndex);
        componentRef.setInput('cardStyle', 'monochrome' /* cardStyle */);
        componentRef.setInput('useHex', useHex);
        componentRef.setInput('isSelected', false);
        
        appRef.attachView(componentRef.hostView);
        
        const cardElement = componentRef.location.nativeElement as HTMLElement;
        cellDiv.appendChild(cardElement);
        container.appendChild(cellDiv);
        
        componentRefs.push(componentRef);
    }

    /**
     * Returns the CSS styles for fixed grid printing (iOS).
     * Card size: 88mm x 63mm (standard Alpha Strike card dimensions)
     */
    private static getFixedPrintStyles(printMargin: PrintAllOptions['printMargin']): string {
        const cardWidthIn = `${CARD_WIDTH_IN}in`;
        const cardHeightIn = `${CARD_HEIGHT_IN}in`;
        const pageWidthIn = `${PAGE_WIDTH_IN}in`;
        const pageHeightIn = `${PAGE_HEIGHT_IN}in`;
        
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
                -webkit-justify-content: flex-start;
                justify-content: flex-start;
                gap: 0.01in;
                background: white;
                box-sizing: border-box;
                overflow: hidden;
            }

            .as-card-cell {
                -webkit-flex: 0 0 ${cardWidthIn};
                flex: 0 0 ${cardWidthIn};
                width: ${cardWidthIn};
                height: ${cardHeightIn};
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
                width: 88mm;
                height: 63mm;
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

            ${this.getRosterSummaryStyles()}
            ${getPrintRosterBrandingStyles()}

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

                .as-roster-summary {
                    page-break-after: always;
                    break-after: page;
                }

                @page {
                    size: auto;
                    margin: ${printMargin === 'none' ? '0in' : '0.25in'} !important;
                }
            }
        `;
    }

    /**
     * Returns the CSS styles for flexible printing (non-iOS platforms).
     * Uses flexbox with auto-wrapping for portrait/landscape support.
     */
    private static getFlexPrintStyles(printMargin: PrintAllOptions['printMargin']): string {
        const cardWidthIn = `${CARD_WIDTH_IN}in`;
        const cardHeightIn = `${CARD_HEIGHT_IN}in`;
        
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
                justify-content: flex-start;
                gap: 0.01in;
                background: white;
                padding: 0;
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

            ${this.getRosterSummaryStyles()}
            ${getPrintRosterBrandingStyles()}

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

                .as-roster-summary {
                    page-break-after: always;
                    break-after: page;
                }

                @page {
                    size: auto;
                    margin: ${printMargin === 'none' ? '0' : '0.25in'} !important;
                }

            }
        `;
    }

    /**
     * Returns shared CSS styles for the roster summary table.
     */
    private static getRosterSummaryStyles(): string {
        return `
            .as-roster-summary {
                position: relative;
                background: white;
                padding: 0.2in 0.04in 0;
                box-sizing: border-box;
                font-family: sans-serif;
                color: #222;
            }

            .as-roster-header {
                display: flex;
                align-items: baseline;
                gap: 0.1in;
                padding: 0 1.5in 0.08in 0.04in;
                border-bottom: 2px solid #333;
                margin-bottom: 0.1in;
            }

            .as-roster-faction {
                font-size: 10pt;
                color: #555;
            }

            .as-roster-faction::after {
                content: ':';
                margin-left: 2px;
            }

            .as-roster-force-name {
                font-size: 12pt;
                font-weight: 700;
            }

            .as-roster-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 8pt;
            }

            .as-roster-table th {
                font-weight: 700;
                text-align: left;
                padding: 2px 4px;
                border-bottom: 1.5px solid #555;
                white-space: nowrap;
            }

            .as-roster-table td {
                padding: 2px 4px;
                border-bottom: 0.5px solid #ddd;
                vertical-align: top;
                white-space: nowrap;
            }

            .as-roster-table td.as-roster-specials {
                font-size: 7pt;
                color: #555;
                white-space: normal;
                max-width: 2.5in;
            }

            .as-roster-footer {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 0.12in;
                font-weight: 700;
                font-size: 11pt;
                margin-top: 0.14in;
                padding: 0.08in 0.04in 0.05in;
                border-top: 2px solid #333;
                box-sizing: border-box;
            }

            .as-roster-footer-total {
                margin-left: auto;
                text-align: right;
                padding-top: 0.04in;
            }
        `;
    }

    /**
     * Creates a roster summary page with a table of all units.
     */
    private static async createRosterSummaryPage(groups: UnitGroup<ASForceUnit>[], force: Force): Promise<HTMLElement> {
        const container = document.createElement('div');
        container.className = 'as-roster-summary';

        // Header
        const header = document.createElement('div');
        header.className = 'as-roster-header';
        const parts: string[] = [];
        const faction = force.faction();
        if (faction) {
            let factionLabel = faction.name;
            if (faction.group && faction.group !== faction.name) {
                factionLabel += ` \u00B7 ${faction.group}`;
            }
            parts.push(factionLabel);
        }
        const era = force.era();
        if (era) {
            parts.push(era.name);
        }
        if (parts.length > 0) {
            const factionSpan = document.createElement('span');
            factionSpan.className = 'as-roster-faction';
            factionSpan.textContent = parts.join(' \u00B7 ');
            header.appendChild(factionSpan);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'as-roster-force-name';
        nameSpan.textContent = force.name || '';
        header.appendChild(nameSpan);
        container.appendChild(header);

        // Table
        const table = document.createElement('table');
        table.className = 'as-roster-table';

        // Table header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const columns = ['Unit', 'TP', 'SZ', 'Skill', 'PV', 'Role', 'MV', 'S', 'M', 'L', 'A+S', 'OV', 'Specials'];
        for (const col of columns) {
            const th = document.createElement('th');
            th.textContent = col;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Table body
        const tbody = document.createElement('tbody');
        let totalPv = 0;

        for (const group of groups) {
            for (const forceUnit of group.units()) {
                const unit = forceUnit.getUnit();
                const as = unit.as;
                const adjustedPv = forceUnit.adjustedPv();
                totalPv += adjustedPv;

                const row = document.createElement('tr');

                const unitName = [unit.chassis, unit.model].filter(Boolean).join(' ');
                const cells = [
                    unitName,
                    as.TP,
                    String(as.SZ),
                    String(forceUnit.pilotSkill()),
                    String(adjustedPv),
                    unit.role || '',
                    as.MV,
                    as.dmg.dmgS,
                    as.dmg.dmgM,
                    as.dmg.dmgL,
                    `${as.Arm}+${as.Str}`,
                    String(as.OV),
                    (as.specials || []).join(', ')
                ];

                for (let i = 0; i < cells.length; i++) {
                    const td = document.createElement('td');
                    td.textContent = cells[i];
                    if (i === columns.length - 1) {
                        td.className = 'as-roster-specials';
                    }
                    row.appendChild(td);
                }

                tbody.appendChild(row);
            }
        }
        table.appendChild(tbody);
        container.appendChild(table);

        // Footer with total PV
        const footer = document.createElement('div');
        footer.className = 'as-roster-footer';

        const qrHost = document.createElement('div');
        qrHost.innerHTML = await createPrintRosterQrMarkup(force);
        const qr = qrHost.firstElementChild;
        if (qr) {
            footer.appendChild(qr);
        }

        const total = document.createElement('div');
        total.className = 'as-roster-footer-total';
        total.textContent = `Total PV: ${totalPv}`;
        footer.appendChild(total);

        container.appendChild(footer);

        const brandingHost = document.createElement('div');
        brandingHost.innerHTML = createPrintRosterLogoMarkup();
        const branding = brandingHost.firstElementChild;
        if (branding) {
            container.appendChild(branding);
        }

        return container;
    }

    /**
     * Waits for all images to load within the container.
     */
    private static async waitForImagesToLoad(root: ParentNode): Promise<void> {
        const images = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
        if (images.length === 0) return;

        await Promise.all(images.map(img => new Promise<void>((resolve) => {
            const done = () => resolve();
            
            if (img.complete) {
                return resolve();
            }
            
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            // Safety timeout
            setTimeout(done, 4000);
        })));
    }

    /**
     * Waits for the specified number of animation frames.
     */
    private static async nextAnimationFrames(n: number = 1): Promise<void> {
        for (let i = 0; i < n; i++) {
            await new Promise<void>(r => requestAnimationFrame(() => r()));
        }
    }
}