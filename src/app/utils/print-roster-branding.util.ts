/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

    const qrMarkup = await createQrCodeMarkup(forceUrl);
    return `<div class="${className}">${qrMarkup}</div>`;
}

async function createQrCodeMarkup(url: string): Promise<string> {
    const { toString } = await import('qrcode');
    return toString(url, {
        errorCorrectionLevel: 'L',
        margin: 2,
        type: 'svg',
        width: PRINT_QR_SIZE_PX,
    });
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