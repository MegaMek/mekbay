// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

@Injectable()
export class PageViewerShadowService {
    getShadowKey(unitIndex: number, direction: 'left' | 'right'): string {
        return `${direction}:${unitIndex}`;
    }
}
