// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Force } from '../models/force.model';
import { getFactionAffinity } from '../models/factions.model';

const PRINT_FORCE_BASE_URL = 'https://mekbay.com';
const PRINT_LOGO_PATH = '/images/mekbay.svg';
const PRINT_QR_SIZE_PX = 198;

export interface PrintRosterHeading {
    context: string;
    name: string;
}

export function getPrintRosterHeading(force: Force): PrintRosterHeading {
    const context: string[] = [];
    const faction = force.faction();
    if (faction) {
        const affinity = getFactionAffinity(faction);
        context.push(
            affinity !== 'Other' && affinity !== faction.name
                ? `${faction.name} · ${affinity}`
                : faction.name,
        );
    }

    const era = force.era();
    if (era) {
        context.push(era.name);
    }

    return {
        context: context.join(' · '),
        name: force.name || force.displayName(),
    };
}

export function buildPrintRosterForceUrl(force: Force | null | undefined): string | null {
    const instanceId = force?.instanceId()?.trim();
    if (!instanceId) {
        return null;
    }

    return `${PRINT_FORCE_BASE_URL}/?instance=${encodeURIComponent(instanceId)}`;
}

export function getPrintRosterLogoUrl(): string {
    return new URL(PRINT_LOGO_PATH, window.location.origin || PRINT_FORCE_BASE_URL).toString();
}

export function createPrintRosterHeader(force: Force): HTMLDivElement {
    const heading = getPrintRosterHeading(force);
    const header = document.createElement('div');
    header.className = 'print-roster-header';

    const name = document.createElement('span');
    name.className = 'print-roster-name';
    name.textContent = heading.name;
    header.appendChild(name);

    if (heading.context) {
        const context = document.createElement('span');
        context.className = 'print-roster-context';
        context.textContent = heading.context;
        header.appendChild(context);
    }

    const logo = document.createElement('div');
    logo.className = 'print-roster-logo';
    const image = document.createElement('img');
    image.src = getPrintRosterLogoUrl();
    image.alt = 'MekBay';
    logo.appendChild(image);
    header.appendChild(logo);

    return header;
}

export async function createPrintRosterQrMarkup(
    force: Force | null | undefined,
    className: string = 'print-roster-qr-inline'
): Promise<string> {
    const forceUrl = buildPrintRosterForceUrl(force);
    if (!forceUrl) {
        return '';
    }

    try {
        const qrMarkup = await createQrCodeSvgMarkup(forceUrl, PRINT_QR_SIZE_PX);
        return `<div class="${className}">${qrMarkup}</div>`;
    } catch (error) {
        console.error('Failed to generate print roster QR code.', error);
        return '';
    }
}

async function createQrCodeSvgMarkup(url: string, width: number): Promise<string> {
    const toString = await getQrCodeToString();
    return toString(url, {
        errorCorrectionLevel: 'L',
        margin: 2,
        type: 'svg',
        width,
    });
}

export async function createQrCodeSvgDataUrl(url: string, width: number): Promise<string> {
    const svgMarkup = await createQrCodeSvgMarkup(url, width);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

async function getQrCodeToString(): Promise<(text: string, options: object) => Promise<string>> {
    const qrCodeModule = await import('qrcode');
    const toString =
        typeof qrCodeModule.toString === 'function'
            ? qrCodeModule.toString.bind(qrCodeModule)
            : typeof qrCodeModule.default?.toString === 'function'
                ? qrCodeModule.default.toString.bind(qrCodeModule.default)
                : null;

    if (!toString) {
        throw new Error('qrcode.toString() is unavailable.');
    }

    return toString;
}

export function getPrintRosterBrandingStyles(prefix: string = ''): string {
    const scope = prefix ? `${prefix} ` : '';

    return `
        ${scope}.print-roster-header {
            position: relative;
            display: flex;
            align-items: baseline;
            gap: 0.05in;
            padding: 0 1.5in 0.08in 0.04in;
            border-bottom: 2px solid #333;
            margin-bottom: 0.1in;
            break-after: avoid;
            page-break-after: avoid;
        }

        ${scope}.print-roster-context {
            font-size: 10pt;
            color: #555;
            padding-left: 0;
        }

        ${scope}.print-roster-context::before {
            content: '—';
            margin-right: 0.05in;
        }

        ${scope}.print-roster-name {
            min-width: 0;
            font-size: 12pt;
            font-weight: 700;
            padding-right: 0;
        }

        ${scope}.print-roster-logo {
            position: absolute;
            top: -0.02in;
            right: 0.04in;
            width: 1.35in;
            display: flex;
            justify-content: flex-end;
            align-items: flex-start;
        }

        ${scope}.print-roster-logo img {
            display: block;
            width: 100%;
            height: auto;
        }

        ${scope}.print-roster-qr-inline {
            width: 1.47in;
            height: 1.47in;
            padding: 0.04in;
            background: white;
            box-sizing: border-box;
            display: flex;
            justify-content: center;
            align-items: center;
            flex: 0 0 auto;
        }

        ${scope}.print-roster-qr-inline svg {
            display: block;
            width: 100%;
            height: 100%;
        }

        ${scope}.print-roster-qr-block {
            break-inside: avoid;
            page-break-inside: avoid;
        }
    `;
}
