import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';
import { SvgFrameUtil } from '../utils/svg-frame.util';

@Component({
    selector: 'svg-frame-demo-page',
    template: `
        <section class="svg-frame-demo-page">
            <svg #frameCanvas class="svg-frame-demo" width="612" height="792" viewBox="0 0 612 792" role="img" aria-label="SVG frame demo">
                <rect width="612" height="792" fill="#fff"></rect>
                <g id="btLogoColor" transform="scale(.791)"><path d="M32.125 9.167c20.5 0 18.5 25.75 7.375 25.75c10 0 19.125 27.5-9.125 27.5H0V9.167H32.125z M16.25 22.542v6h12 c4.75 0 4.375-6 0-6H16.25z M16.25 42.507v6H29c5.046 0 4.648-6 0-6H16.25z"></path><polygon fill="#e0ad2a" points="78.208,0 52.958,44.75 69.542,44.75 78.208,29.917 86.875,44.75 103.458,44.75 "></polygon><polygon fill="#e0ad2a" points="94.708,48.833 61.708,48.833 53.875,62.417 102.542,62.417 "></polygon><polygon points="141.636,9.167 97.136,9.167 97.136,23.75 111.031,23.75 111.031,62.417 127.74,62.417 127.739,23.75 141.636,23.75   "></polygon><polygon points="188.959,9.167 144.459,9.167 144.459,23.75 158.354,23.75 158.354,62.417 175.063,62.417 175.063,23.75   188.959,23.75 "></polygon><polygon points="209.313,48.25 209.313,9.167 192.604,9.167 192.604,62.417 229.042,62.417 229.042,48.25 "></polygon><polygon points="363.75,23.292 363.75,9.167 323.5,9.167 323.5,62.417 363.75,62.417 363.75,48.292 339.5,48.292 339.5,42.667   362.875,42.667 362.875,28.542 339.5,28.542 339.5,23.292 "></polygon><polygon points="320.209,9.167 233.375,9.167 233.375,62.417 273.625,62.417 273.625,48.292 249.375,48.292 249.375,42.667   272.75,42.667 272.75,28.542 249.375,28.542 249.375,23.75 289.604,23.75 289.604,62.417 306.313,62.417 306.313,23.75   320.209,23.75 "></polygon><path d="M405.214 41.084c-1.789 4.745-6.023 8.082-10.964 8.082c-6.558 0-11.875-5.876-11.875-13.125 c0-7.249 5.317-13.125 11.875-13.125c4.748 0 8.833 3.087 10.733 7.539l14.02-6.592c-4.572-9.151-14.132-15.45-25.19-15.45 c-15.5 0-28.063 12.371-28.063 27.629s12.563 27.629 28.063 27.629c11.305 0 21.041-6.584 25.486-16.066L405.214 41.084z"></path><polygon points="456.5,9.167 456.5,28 438.541,28 438.541,9.167 421.708,9.167 421.833,62.417 438.542,62.417 438.541,42.583   456.5,42.583 456.499,62.417 473.208,62.417 473.333,9.167 "></polygon><path d="M476.664 13.623v-3.67h-1.396V9.206h3.74v.747h-1.394v3.67H476.664z"></path><path d="M479.608 13.623V9.206h1.422l.854 3.013l.845-3.013h1.426v4.417h-.883v-3.477l-.935 3.477h-.915l-.931-3.477v3.477 H479.608z"></path></g>
                <g id="footer" transform="translate(0 780)">
                    <g id="cglLogo" transform="matrix(.65 0 0 -.65 -95 64)">
                        <g transform="translate(211.079 105.887)"><path d="m 0 0 c 0 1.757 -1.388 3.182 -3.099 3.182 h -41.12 c -1.712 0 -3.099 -1.425 -3.099 -3.182 v -20.677 c 0 -1.757 1.387 -3.181 3.099 -3.181 h 41.12 c 1.711 0 3.099 1.424 3.099 3.181 z"></path></g><g transform="translate(211.079 105.887)"><path style="fill:none;stroke:#000;stroke-width:1.932" d="m 0 0 c 0 1.757 -1.388 3.182 -3.099 3.182 h -41.12 c -1.712 0 -3.099 -1.425 -3.099 -3.182 v -20.677 c 0 -1.757 1.387 -3.181 3.099 -3.181 h 41.12 c 1.711 0 3.099 1.424 3.099 3.181 z"></path></g><g transform="translate(170.143 90.859)"><path style="fill:#fff" d="m 0 0 c -.158 -1.733 -.966 -2.501 -2.402 -2.501 -1.517 0 -2.344 .787 -2.463 2.501 -.078 1.024 -.117 2.048 -.117 3.091 0 .455 0 .908 .019 1.359 0 0 .02 3.467 .098 4.432 .119 1.713 .946 2.521 2.463 2.521 1.436 0 2.244 -.808 2.402 -2.521 .019 -.316 .039 -1.517 .039 -2.01 h -1.536 c 0 .513 -.04 1.733 -.059 2.048 -.077 .769 -.335 1.104 -.846 1.104 -.454 0 -.71 -.354 -.789 -1.104 C -3.288 7.955 -3.288 4.45 -3.288 4.45 -3.309 3.88 -3.309 3.289 -3.309 2.699 c 0 -.927 .021 -1.871 .118 -2.758 .079 -.748 .335 -1.103 .789 -1.103 .511 0 .769 .355 .846 1.103 .019 .315 .059 1.614 .059 2.126 H .039 C .039 1.752 .019 .297 0 0"></path></g><g transform="translate(174.589 100.686)"><path style="fill:#fff" d="m 0 0 h -.551 c -.454 0 -1.043 -.316 -1.122 -1.005 -.08 -.611 -.08 -1.792 -.08 -2.401 V -5.397 H 0 Z m -.04 -12.171 v 5.395 h -1.713 v -5.395 h -1.674 v 8.173 c 0 0 0 1.889 .079 2.758 .138 1.554 1.299 2.658 2.797 2.658 h 2.224 v -13.589 z"></path></g><g transform="translate(185.464 100.686)"><path style="fill:#fff" d="m 0 0 h -.552 c -.453 0 -1.044 -.316 -1.122 -1.005 -.08 -.611 -.08 -1.792 -.08 -2.401 V -5.397 H 0 Z m -.041 -12.171 v 5.395 h -1.713 v -5.395 h -1.673 v 8.173 c 0 0 0 1.889 .079 2.758 .137 1.554 1.3 2.658 2.796 2.658 h 2.226 v -13.589 z"></path></g><g transform="translate(179.788 100.686)"><path style="fill:#fff" d="m 0 0 v -9.964 c 0 -.689 .433 -.985 .867 -.985 H 1.3 v -1.36 H .867 c -1.535 0 -2.56 .67 -2.56 2.207 V 0 h -1.91 V 1.418 H 1.931 V 0 Z"></path></g><g transform="translate(201.017 88.358)"><path style="fill:#fff" d="m 0 0 c -1.458 0 -2.501 .807 -2.501 2.54 v 2.028 h 1.555 V 2.462 c 0 -.788 .453 -1.104 .946 -1.104 .453 0 .905 .316 .905 1.104 v 1.712 c 0 2.088 -3.348 3.191 -3.348 5.751 v 1.457 c 0 1.733 .966 2.52 2.483 2.52 1.437 0 2.382 -.787 2.382 -2.52 V 9.748 H .886 v 1.673 c 0 .769 -.354 1.104 -.846 1.104 -.454 0 -.79 -.335 -.79 -1.104 V 9.944 c 0 -1.614 3.329 -3.151 3.329 -5.71 V 2.54 C 2.579 .807 1.536 0 0 0"></path></g><g transform="translate(207.493 100.686)"><path style="fill:#fff" d="m 0 0 v -9.964 c 0 -.689 .434 -.985 .866 -.985 h .433 v -1.36 H .866 c -1.534 0 -2.559 .67 -2.559 2.207 V 0 h -1.91 V 1.418 H 1.93 L 1.93 0 Z"></path></g><g transform="translate(184.98 86.422)"><path style="fill:#fff" d="m 0 0 c 0 .046 -.005 .096 -.017 .137 -.054 .187 -.199 .328 -.415 .328 -.286 0 -.498 -.249 -.498 -.66 0 -.344 .175 -.623 .494 -.623 .192 0 .357 .124 .416 .308 .011 .054 .02 .125 .02 .182 z m .509 -.917 c 0 -.424 -.087 -.726 -.297 -.917 -.212 -.187 -.503 -.244 -.78 -.244 -.258 0 -.532 .052 -.705 .163 l .111 .384 c .128 -.074 .344 -.154 .589 -.154 .332 0 .582 .174 .582 .611 v .173 H 0 c -.117 -.177 -.324 -.298 -.589 -.298 -.502 0 -.859 .415 -.859 .987 0 .664 .431 1.067 .917 1.067 .307 0 .489 -.15 .585 -.315 H .062 L .083 .809 H .527 C .519 .672 .509 .506 .509 .228 Z"></path></g><g transform="translate(186.942 86.198)"><path style="fill:#fff" d="m 0 0 c -.361 .008 -.704 -.071 -.704 -.378 0 -.2 .127 -.289 .289 -.289 .203 0 .353 .131 .399 .277 C -.004 -.353 0 -.311 0 -.278 Z m .499 -.502 c 0 -.184 .007 -.361 .028 -.486 H .067 L .033 -.764 H .022 c -.125 -.157 -.336 -.27 -.599 -.27 -.405 0 -.634 .294 -.634 .602 0 .51 .452 .768 1.199 .763 v .033 c 0 .134 -.054 .353 -.41 .353 -.201 0 -.407 -.062 -.544 -.149 l -.1 .332 c .149 .091 .41 .178 .73 .178 .647 0 .835 -.411 .835 -.85 z"></path></g><g transform="translate(187.814 86.63)"><path style="fill:#fff" d="m 0 0 c 0 .231 -.004 .426 -.016 .601 h .44 l .02 -.3 h .013 c .098 .159 .282 .345 .622 .345 .267 0 .472 -.149 .56 -.373 h .008 c .07 .111 .153 .194 .25 .253 .112 .079 .24 .12 .407 .12 .335 0 .676 -.227 .676 -.875 V -1.421 H 2.481 v 1.118 C 2.481 .032 2.365 .231 2.12 .231 1.946 .231 1.818 .107 1.763 -.038 1.75 -.088 1.739 -.151 1.739 -.209 V -1.421 H 1.241 v 1.171 c 0 .282 -.112 .481 -.349 .481 -.19 0 -.319 -.149 -.365 -.29 C .506 -.108 .498 -.167 .498 -.224 V -1.421 H 0 Z"></path></g><g transform="translate(192.415 86.434)"><path style="fill:#fff" d="M 0 0 C .004 .186 -.078 .495 -.419 .495 -.734 .495 -.867 .208 -.888 0 Z m -.888 -.356 c .013 -.367 .3 -.523 .622 -.523 .237 0 .407 .033 .562 .091 L .37 -1.141 c -.175 -.07 -.415 -.128 -.706 -.128 -.655 0 -1.042 .406 -1.042 1.024 0 .56 .342 1.087 .988 1.087 .659 0 .871 -.539 .871 -.983 0 -.095 -.008 -.17 -.016 -.215 z"></path></g><path style="fill:#fff" d="m 196.606 88.157 h .514 V 85.21 h -.514 z"></path><g transform="translate(198.577 86.198)"><path style="fill:#fff" d="m 0 0 c -.361 .008 -.706 -.071 -.706 -.378 0 -.2 .129 -.289 .291 -.289 .203 0 .352 .131 .399 .277 C -.005 -.353 0 -.311 0 -.278 Z m .498 -.502 c 0 -.184 .007 -.361 .029 -.486 H .066 L .033 -.764 H .02 c -.124 -.157 -.335 -.27 -.597 -.27 -.407 0 -.635 .294 -.635 .602 0 .51 .453 .768 1.198 .763 v .033 c 0 .134 -.052 .353 -.408 .353 -.201 0 -.408 -.062 -.544 -.149 L -1.067 .9 c .15 .091 .411 .178 .731 .178 .647 0 .834 -.411 .834 -.85 z"></path></g><g transform="translate(199.958 86.043)"><path style="fill:#fff" d="m 0 0 c 0 -.042 .005 -.083 .014 -.119 .053 -.204 .232 -.358 .452 -.358 .318 0 .514 .258 .514 .664 0 .356 -.171 .647 -.511 .647 C .262 .834 .074 .685 .017 .461 .009 .424 0 .379 0 .328 Z M -.51 2.113 H 0 V .909 h .009 c .125 .195 .345 .323 .648 .323 .492 0 .845 -.409 .841 -1.023 0 -.728 -.46 -1.088 -.917 -1.088 -.26 0 -.493 .1 -.639 .348 h -.008 l -.025 -.303 h -.435 c .008 .138 .016 .363 .016 .57 z"></path></g><g transform="translate(201.684 85.679)"><path style="fill:#fff" d="m 0 0 c .117 -.071 .337 -.145 .519 -.145 .225 0 .323 .09 .323 .223 0 .137 -.083 .209 -.332 .296 -.393 .135 -.559 .352 -.555 .588 0 .356 .294 .635 .764 .635 .223 0 .418 -.057 .535 -.12 L 1.153 1.116 C 1.066 1.166 .904 1.232 .726 1.232 .543 1.232 .444 1.146 .444 1.021 .444 .892 .54 .83 .797 .738 1.162 .606 1.332 .419 1.337 .12 c 0 -.365 -.287 -.635 -.822 -.635 -.246 0 -.465 .062 -.615 .145 z"></path></g><g transform="translate(197.39 99.081)"><path style="fill:#fff" d="M 0 0 V 3.007 H -1.063 L -1.674 1.881 v -4.63 c 0 0 0 -2.167 -.098 -3.032 -.058 -.669 -.336 -1.024 -.767 -1.024 -.454 0 -.709 .355 -.789 1.024 -.055 .484 -.079 1.371 -.09 2.061 -.006 .495 -.006 .864 -.006 .864 l -.002 1.66 c 0 0 -.938 -1.813 -1.286 -2.045 -.353 -.237 -.314 -.502 -.314 -.502 0 0 -.037 -1.667 .007 -2.126 .117 -1.239 .63 -2.069 1.633 -2.324 V -8.798 C -3.39 -8.803 -3.396 -8.808 -3.4 -8.812 v -5.364 l 1.674 1.674 v .006 l .015 .015 v 4.288 c .985 .255 1.517 1.085 1.694 2.324 .019 .847 .019 3.013 .019 3.013 l 0 2.856 z"></path></g><g transform="translate(190.205 96.784)"><path style="fill:#fff" d="M 0 0 -1.673 2.812 V -8.269 H 2.56 v 1.378 H 0 Z"></path></g><g transform="translate(203.685 87.945)"><path style="fill:#fff" d="M 0 0 H -.228 V .082 H .327 V 0 H .099 V -.666 H 0 Z"></path></g><g transform="translate(204.724 87.607)"><path style="fill:#fff" d="M 0 0 C -.005 .104 -.012 .231 -.012 .324 H -.014 C -.041 .238 -.071 .143 -.108 .04 L -.241 -.325 H -.313 L -.437 .032 C -.471 .14 -.5 .235 -.522 .324 H -.524 C -.525 .23 -.531 .105 -.538 -.008 l -.02 -.321 H -.65 l .052 .749 h .124 l .127 -.361 c .031 -.093 .055 -.176 .076 -.253 h .002 c .02 .075 .047 .158 .08 .253 L -.056 .42 H .067 L .114 -.329 H .018 Z"></path></g><g transform="translate(197.088 106.754)"><path style="fill:#c7c7c7" d="m 0 0 c 0 0 -.345 -.214 -.472 -.393 -.048 -.23 .257 -.492 .038 -.677 l -2.138 -1.325 -6.145 -.34 c 0 0 -1.5 -.014 -.416 -1.766 l 2.875 -4.639 c 1.086 -1.753 1.765 -.415 1.765 -.415 l 3.038 5.353 1.953 1.21 .188 .116 c .263 .114 .361 -.278 .589 -.337 .215 .034 .562 .25 .562 .25 z"></path></g><g transform="translate(197.088 106.754)"><path style="fill:none;stroke:#000;stroke-width:0.966;stroke-linecap:round;stroke-linejoin:round" d="m 0 0 c 0 0 -.345 -.214 -.472 -.393 -.048 -.23 .257 -.492 .038 -.677 l -2.138 -1.325 -6.145 -.34 c 0 0 -1.5 -.014 -.416 -1.766 l 2.875 -4.639 c 1.086 -1.753 1.765 -.415 1.765 -.415 l 3.038 5.353 1.953 1.21 .188 .116 c .263 .114 .361 -.278 .589 -.337 .215 .034 .562 .25 .562 .25 z"></path></g><g transform="translate(191.395 102.835)"><path style="fill:none;stroke:#000;stroke-width:0.483;stroke-linecap:round;stroke-linejoin:round" d="M 0 0 -.769 1.24"></path></g><g transform="translate(190.195 102.818)"><path style="fill:none;stroke:#000;stroke-width:0.483;stroke-linecap:round;stroke-linejoin:round" d="M 0 0 -.769 1.241"></path></g><g transform="translate(193.799 102.984)"><path style="fill:none;stroke:#000;stroke-width:0.483;stroke-linecap:round;stroke-linejoin:round" d="M 0 0 -.769 1.24"></path></g><g transform="translate(192.598 102.984)"><path style="fill:none;stroke:#000;stroke-width:0.483;stroke-linecap:round;stroke-linejoin:round" d="M 0 0 -.77 1.24"></path></g><g transform="translate(188.993 102.677)"><path style="fill:none;stroke:#000;stroke-width:0.483;stroke-linecap:round;stroke-linejoin:round" d="M 0 0 -.769 1.241"></path></g>
                    </g>
                    <text id="copyright" font-size="5.7" x="323" y="0" text-anchor="middle" font-weight="700" lengthAdjust="spacingAndGlyphs">
                        <tspan textLength="550">© {{ currentYear }} The Topps Company, Inc. Classic BattleTech, BattleTech, 'Mech and BattleMech are trademarks of The Topps Company, Inc. All rights reserved.</tspan>
                        <tspan textLength="520" x="323" dy="7">Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of InMediaRes Production, LLC. Permission to photocopy for personal use.</tspan>
                    </text>
                </g>
                <g id="rs" transform="translate(1 70)"></g>
            </svg>
        </section>
    `,
    styles: [`
        :host {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 1000;
            overflow: auto;
            background: #f4f4f4;
        }

        .svg-frame-demo-page {
            width: 612px;
            height: 792px;
            margin: 24px auto;
        }

        .svg-frame-demo {
            font-family: 'Roboto', sans-serif;
            border: 1px solid silver;
            display: block;
            width: 612px;
            height: 792px;
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SvgFrameDemoPageComponent implements AfterViewInit {
    protected readonly currentYear = new Date().getFullYear();

    @ViewChild('frameCanvas', { static: true })
    private readonly frameCanvas!: ElementRef<SVGSVGElement>;

    public ngAfterViewInit(): void {
        const svg = this.frameCanvas.nativeElement;
        const mechDataFrameWidth = 225;
        const mechDataFrameHeight = 302;
        const warriorDataFrameHeight = 140;
        const warriorDataFrameWidth = 150;
        const criticalTableFrameY = mechDataFrameHeight - 2;
        const criticalTableFrameWidth = mechDataFrameWidth + 7 + warriorDataFrameWidth;
        const criticalTableFrameHeight = 397;
        const heatDataFrameHeight = 200;
        const heatDataFrameY = criticalTableFrameY + (criticalTableFrameHeight - heatDataFrameHeight);
        svg.getElementById('rs')?.replaceChildren(
            this.createFrameGroup('\'MECH DATA', 0, 0, mechDataFrameWidth, 302, {
                id: 'mechDataFrame',
                bottomLeftNotchWidth: 100,
                cornerAngleDegrees: {
                    topRight: 45,
                    bottomLeft: 45
                }
            }),
            this.createFrameGroup('WARRIOR DATA', mechDataFrameWidth + 7, 0, warriorDataFrameWidth, warriorDataFrameHeight, {
                id: 'warriorDataFrame',
                cornerAngleDegrees: {
                    topRight: 0,
                    bottomLeft: 0,
                    bottomRight: 45
                },
            }),
            this.createFrameGroup('HIT LOCATION AND CLUSTER TABLE', mechDataFrameWidth + 7, warriorDataFrameHeight + 7, warriorDataFrameWidth, 155, {
                id: 'hitFrame',
                fullWidthHeader: true,
                // headerFontSize: 8
            }),
            this.createFrameGroup('CRITICAL TABLE', 0, criticalTableFrameY, criticalTableFrameWidth, criticalTableFrameHeight, {
                id: 'critTableFrame',
                cornerAngleDegrees: {
                    topRight: 45,
                    bottomLeft: 45,
                    bottomRight: 45
                }
            }),
            this.createFrameGroup('HEAT DATA', criticalTableFrameWidth + 7, heatDataFrameY, 180, heatDataFrameHeight, {
                id: 'heatDataFrame',
                cornerAngleDegrees: {
                    topRight: 45,
                    bottomLeft: 45,
                    bottomRight: 45
                },
            }),
        );
    }

    private createFrameGroup(
        title: string,
        x: number,
        y: number,
        width: number,
        height: number,
        options: Parameters<typeof SvgFrameUtil.createSVGFrame>[3] = {},
    ): SVGGElement {
        const frame = SvgFrameUtil.createSVGFrame(title, width, height, options);
        frame.setAttribute('transform', `translate(${x} ${y})`);
        return frame;
    }
}