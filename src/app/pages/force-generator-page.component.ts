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

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ForceBuilderService } from '../services/force-builder.service';
import { RoutedDialogPage } from './routed-dialog-page';

/*
 * Author: Drake
 */

/**
 * Routed page for the force generator dialog (/forcegenerator).
 * The optional `importCurrentForce` flag is passed via navigation state.
 */
@Component({
    selector: 'force-generator-page',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForceGeneratorPageComponent extends RoutedDialogPage {
    private readonly forceBuilderService = inject(ForceBuilderService);

    /** Navigation state must be read during construction (while the navigation is running). */
    private readonly importCurrentForce =
        (this.router.currentNavigation()?.extras?.state ?? history.state)?.importCurrentForce === true;

    protected override openDialog() {
        return this.forceBuilderService.openSearchForceGeneratorDialog({
            importCurrentForce: this.importCurrentForce,
        });
    }
}
