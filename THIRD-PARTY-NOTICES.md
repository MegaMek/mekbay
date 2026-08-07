# Third-Party Notices

This document supplements [NOTICE](NOTICE). It identifies third-party
dependencies and data that may be used to build or distribute MekBay. It does
not replace the license text or attribution notice for any component.

## MegaMek data

MekBay can generate catalog, availability, sourcebook, ruleset, and related
data assets from the separate [mm-data repository](https://github.com/MegaMek/mm-data).
Those data files are not covered by MekBay's GPL license.

The mm-data repository is licensed under the **Creative Commons Attribution-
NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)**. The
license text is available at
<https://creativecommons.org/licenses/by-nc-sa/4.0/> and in the upstream
[mm-data LICENSE file](https://github.com/MegaMek/mm-data/blob/main/LICENSE).

Attribution: The MegaMek organization and The MegaMek Team.

## Production npm dependencies

The following direct production dependencies are used by MekBay. Exact
resolved versions and the complete transitive dependency graph are recorded in
`package-lock.json`. Angular's production build also emits
`3rdpartylicenses.txt` containing the license texts detected for bundled
dependencies.

| Dependency | License |
| --- | --- |
| Angular packages (`@angular/cdk`, `@angular/common`, `@angular/compiler`, `@angular/core`, `@angular/forms`, `@angular/platform-browser`, `@angular/pwa`, `@angular/router`, `@angular/service-worker`) | MIT |
| `@zxing/browser` | MIT |
| `@zxing/library` | Apache-2.0 |
| `angularx-qrcode` | MIT |
| `jszip` | MIT OR GPL-3.0-or-later |
| `tslib` | 0BSD |
| `xlsx` (SheetJS Community Edition package) | Apache-2.0 |

## Development dependencies

Development-only dependencies are normally not included in the deployed
application. Their exact versions and license metadata are recorded in
`package-lock.json`; the direct development dependencies currently use MIT or
Apache-2.0 licenses as indicated there.

## Redistribution

When redistributing a source checkout or built application, preserve this
document, [NOTICE](NOTICE), [LICENSE](LICENSE), the applicable upstream data
terms, and any generated third-party license file included with the build.