// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Force } from '../models/force.model';

const PRINT_FORCE_BASE_URL = 'https://mekbay.com';
const PRINT_LOGO_PATH = '/images/mekbay.svg';
const PRINT_QR_SIZE_PX = 198;

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

export function createPrintRosterLogoMarkup(): string {
    const logoUrl = getPrintRosterLogoUrl();
    return `
        <div class="print-roster-logo">
            <img src="${logoUrl}" alt="MekBay" />
        </div>
    `;
}

export async function createPrintRosterBrandingMarkup(force: Force | null | undefined): Promise<string> {
    const qrMarkup = await createPrintRosterQrMarkup(force, 'print-roster-qr');

    return `
        <div class="print-roster-branding" aria-hidden="true">
            ${createPrintRosterLogoMarkup()}
            ${qrMarkup}
        </div>
    `;
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

export async function createQrCodeSvgMarkup(url: string, width: number): Promise<string> {
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
        ${scope}.print-roster-branding {
            position: absolute;
            inset: 0;
            pointer-events: none;
        }

        ${scope}.print-roster-logo {
            position: absolute;
            top: 0.06in;
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

        ${scope}.print-roster-qr {
            position: absolute;
            left: 0.04in;
            bottom: 0.04in;
            width: 1.47in;
            height: 1.47in;
            padding: 0.04in;
            background: white;
            box-sizing: border-box;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        ${scope}.print-roster-qr svg {
            display: block;
            width: 100%;
            height: 100%;
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
    `;
}