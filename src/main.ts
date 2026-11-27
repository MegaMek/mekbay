// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { runServiceWorkerUpdateBootstrap } from './app/utils/service-worker-update-bootstrap.util';


bootstrapApplication(App, appConfig)
  .then(() => {
    // Updating is important, but it must not hold the first render behind a
    // service-worker round trip. The bootstrap shell and Angular app can paint
    // before the update check starts its own task.
    window.setTimeout(() => {
      void runServiceWorkerUpdateBootstrap();
    }, 0);
  })
  .catch((err) => console.error(err));
