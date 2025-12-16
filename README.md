[![CD/CI Release](https://github.com/MegaMek/mekbay/actions/workflows/main.yml/badge.svg)](https://github.com/MegaMek/mekbay/actions/workflows/main.yml)[![CD/CI Next Release](https://github.com/MegaMek/mekbay/actions/workflows/next.yml/badge.svg)](https://github.com/MegaMek/mekbay/actions/workflows/next.yml)

# MekBay

A web-based application for managing BattleTech forces with interactive record sheets that can be used online or printed.

**🌐 Latest stable build:** [https://mekbay.com](https://mekbay.com)

**🌐 Latest experimental build:** [https://next.mekbay.com](https://next.mekbay.com) (can break anytime! use at your own risk!)

## Overview

MekBay is an Angular-based application designed for BattleTech enthusiasts to:

- **Manage BattleTech Forces**: Organize and track your mechs, vehicles, and other units
- **Interactive Record Sheets**: Use digital record sheets during gameplay with real-time damage tracking and status updates
- **Print Support**: Generate printable versions of record sheets for tabletop play
- **Force Organization**: Build and maintain multiple force compositions, save/load/share them across devices with cloud sync

Follow the steps below to set up your local development environment.

### Prerequisites

Before you begin, ensure you have the following installed on your machine:

- **Node.js**: Version 24 LTS or higher is required. You can download it from [nodejs.org](https://nodejs.org/).
- **npm**: This is usually installed automatically with Node.js.
- **Angular CLI**: Version 21+, while not strictly required to run scripts (as we use local binaries), installing it globally is helpful for generating components.
  ```bash
  npm install -g @angular/cli
  ```
- **Git**: For version control and cloning the repository.

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/MegaMek/mekbay.git
   cd mekbay
   ```

2. **Install dependencies**:
   This command downloads all necessary packages defined in `package.json`.
   ```bash
   npm install
   ```

### Dependencies

The application depends on the `mm-data` repository for the `prerun` task (see [`Development`](#development) section below). Clone it as a sibling to the `mekbay` folder.
```bash
cd ..
git clone https://github.com/MegaMek/mm-data.git
cd mekbay
```
*Note: You can configure a custom path to `mm-data` by creating a `.env` file in the project root and setting the `MM_DATA_PATH` variable (for example: `MM_DATA_PATH=../../mm-data`).*

### Development

To start a local development server, follow these steps:

1. **Generate Assets**:
   Before running the app for the first time, you must generate compressed assets and metadata (required only once).
   ```bash
   npm run prerun
   ```
   *Note: The `mm-data` repository is required for generating compressed assets. Without it, the application will still run, but unit icons and other resources will be missing.*

2. **Start the Server**:
   Launch the development server. This watches for file changes and rebuilds the app in memory.
   ```bash
   npm start
   ```

3. **Access the App**:
   Open your browser and navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

### Building

To build the project run:

```bash
npm run build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Support

For questions, issues, or feature requests, please:

1. Check the [Issues](../../issues) page
2. Create a new issue if needed
3. Join our community discussions on the [MegaMek Discord](https://discord.gg/RcAV6kmJzz)

## Additional Resources

- [BattleTech Official Website](https://www.battletech.com)
- [MegaMek Website](https://megamek.org)
- [Angular CLI Documentation](https://angular.dev/tools/cli)

## License and Copyright

MekBay is part of the MegaMek family.

MekBay is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License (GPL), version 3 or (at your option) any later version, as published by the Free Software Foundation.

MekBay is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

A copy of the GPL should have been included with this project; if not, see <https://www.gnu.org/licenses/>.

### Notice

The MegaMek organization is a non-profit group of volunteers creating free software for the BattleTech community.

MechWarrior, BattleMech, 'Mech and AeroTech are registered trademarks of The Topps Company, Inc. All Rights Reserved.

Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of InMediaRes Productions, LLC.

MechWarrior Copyright Microsoft Corporation. MegaMek was created under Microsoft's "Game Content Usage Rules" <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or affiliated with Microsoft.
