// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, ErrorHandler, provideAppInitializer, inject, isDevMode } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { WakeLockService } from './services/wake-lock.service';
import { EquipmentInteractionRegistry } from './services/equipment-interaction-registry.service';
import { registerAllEquipmentBehaviors } from './models/runtime/equipment-behaviors';
import { provideCoreCatalogWorkers } from './utils/core-catalog-worker-browser.providers';


export const appConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        {
            provide: ErrorHandler,
            useExisting: LoggerService,
        },
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        provideHttpClient(),
        provideCoreCatalogWorkers(),
        provideAppInitializer(() => {
            registerAllEquipmentBehaviors(inject(EquipmentInteractionRegistry));
        }),
        provideAppInitializer(() => {
            inject(WakeLockService);
        }),
        provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000',
        }),
        { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    ]
};
