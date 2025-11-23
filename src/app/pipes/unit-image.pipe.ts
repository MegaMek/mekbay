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

import { Pipe, PipeTransform, inject } from '@angular/core';
import { ImageStorageService } from '../services/image-storage.service';
import { Observable, from, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';

@Pipe({
  name: 'unitImage',
  standalone: true,
  pure: true,
})
export class UnitImagePipe implements PipeTransform {
  private imageService = inject(ImageStorageService);

  transform(imagePath: string | undefined | null): Observable<string> {
    const placeholder = 'assets/images/unknown.png';
    
    if (!imagePath) return of(placeholder);

    // imagePath comes in as "meks/Atlas.png" which matches the ZIP key
    return from(this.imageService.getImage(imagePath)).pipe(
      map(url => url || placeholder),
      catchError(() => of(placeholder)),
      startWith(placeholder)
    );
  }
}