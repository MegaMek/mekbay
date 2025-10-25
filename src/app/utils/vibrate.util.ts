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

import { isIOS } from "./platform.util";

const DEFAULT_VIBRATION_DURATION = 10;

export function vibrate(duration?: number): void {
    if (typeof window === "undefined") return;
    if (!duration) {
        duration = DEFAULT_VIBRATION_DURATION;
    }
    if (navigator.vibrate) {
        navigator.vibrate(duration);
    } else if (isIOS()) {
        simulateiOSVibration();
    }
}

// Fallback function for iOS
function simulateiOSVibration(): void {
    const switchEl = getSwitchElement();
    if (!switchEl) return;
    switchEl.click();
}

let inputEl: HTMLInputElement | null = null;
let labelEl: HTMLLabelElement | null = null;
const HAPTIC_ELEMENT_ID = "___haptic_switch_element___";

function getSwitchElement(): HTMLLabelElement {
    if (labelEl) return labelEl;
    inputEl = document.createElement("input");
    inputEl.style.display = "none";
    inputEl.id = HAPTIC_ELEMENT_ID;
    inputEl.type = "checkbox";
    inputEl.setAttribute("switch", "");
    document.body.appendChild(inputEl);

    labelEl = document.createElement("label");
    labelEl.style.display = "none";
    labelEl.htmlFor = HAPTIC_ELEMENT_ID;
    document.body.appendChild(labelEl);
    return labelEl;
}