// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Injector } from '@angular/core';

import type { SwarmService } from './swarm.service';

/**
 * The unit automations reach `SwarmService` through this loader: it reads every loaded force, and the force model
 * imports the automations, so a static import would close an import cycle.
 */
export async function loadSwarmService(injector: Injector): Promise<SwarmService> {
    const { SwarmService: service } = await import('./swarm.service');
    return injector.get(service);
}
