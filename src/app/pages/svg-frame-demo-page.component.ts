import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';
import { SvgFrameUtil } from '../utils/svg-frame.util';

@Component({
    selector: 'svg-frame-demo-page',
    template: `
        <section class="svg-frame-demo-page">
            <svg #frameCanvas class="svg-frame-demo" width="612" height="792" viewBox="0 0 612 792" role="img" aria-label="SVG frame demo">
                <rect width="612" height="792" fill="#fff"></rect>
                <g id="btLogoColor" transform="scale(.791)"><path d="M32.125 9.167c20.5 0 18.5 25.75 7.375 25.75c10 0 19.125 27.5-9.125 27.5H0V9.167H32.125z M16.25 22.542v6h12 c4.75 0 4.375-6 0-6H16.25z M16.25 42.507v6H29c5.046 0 4.648-6 0-6H16.25z"></path><polygon fill="#e0ad2a" points="78.208,0 52.958,44.75 69.542,44.75 78.208,29.917 86.875,44.75 103.458,44.75 "></polygon><polygon fill="#e0ad2a" points="94.708,48.833 61.708,48.833 53.875,62.417 102.542,62.417 "></polygon><polygon points="141.636,9.167 97.136,9.167 97.136,23.75 111.031,23.75 111.031,62.417 127.74,62.417 127.739,23.75 141.636,23.75   "></polygon><polygon points="188.959,9.167 144.459,9.167 144.459,23.75 158.354,23.75 158.354,62.417 175.063,62.417 175.063,23.75   188.959,23.75 "></polygon><polygon points="209.313,48.25 209.313,9.167 192.604,9.167 192.604,62.417 229.042,62.417 229.042,48.25 "></polygon><polygon points="363.75,23.292 363.75,9.167 323.5,9.167 323.5,62.417 363.75,62.417 363.75,48.292 339.5,48.292 339.5,42.667   362.875,42.667 362.875,28.542 339.5,28.542 339.5,23.292 "></polygon><polygon points="320.209,9.167 233.375,9.167 233.375,62.417 273.625,62.417 273.625,48.292 249.375,48.292 249.375,42.667   272.75,42.667 272.75,28.542 249.375,28.542 249.375,23.75 289.604,23.75 289.604,62.417 306.313,62.417 306.313,23.75   320.209,23.75 "></polygon><path d="M405.214 41.084c-1.789 4.745-6.023 8.082-10.964 8.082c-6.558 0-11.875-5.876-11.875-13.125 c0-7.249 5.317-13.125 11.875-13.125c4.748 0 8.833 3.087 10.733 7.539l14.02-6.592c-4.572-9.151-14.132-15.45-25.19-15.45 c-15.5 0-28.063 12.371-28.063 27.629s12.563 27.629 28.063 27.629c11.305 0 21.041-6.584 25.486-16.066L405.214 41.084z"></path><polygon points="456.5,9.167 456.5,28 438.541,28 438.541,9.167 421.708,9.167 421.833,62.417 438.542,62.417 438.541,42.583   456.5,42.583 456.499,62.417 473.208,62.417 473.333,9.167 "></polygon><path d="M476.664 13.623v-3.67h-1.396V9.206h3.74v.747h-1.394v3.67H476.664z"></path><path d="M479.608 13.623V9.206h1.422l.854 3.013l.845-3.013h1.426v4.417h-.883v-3.477l-.935 3.477h-.915l-.931-3.477v3.477 H479.608z"></path></g>
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
    @ViewChild('frameCanvas', { static: true })
    private readonly frameCanvas!: ElementRef<SVGSVGElement>;

    public ngAfterViewInit(): void {
        const svg = this.frameCanvas.nativeElement;
        svg.getElementById('rs')?.replaceChildren(
            this.createFrameGroup('\'MECH DATA', 0, 0, 225, 300, {
                bottomLeftNotchWidth: 100,
                cornerAngleDegrees: {
                    topRight: 45,
                    bottomLeft: 45
                }
            }),
            this.createFrameGroup('WARRIOR DATA', 230, 0, 150, 150, {
                cornerAngleDegrees: {
                    topRight: 0,
                    bottomLeft: 0,
                    bottomRight: 45
                },
            }),
            this.createFrameGroup('HIT LOCATION AND CLUSTER TABLE', 230, 155, 150, 145, {
                fullWidthHeader: true,
                headerFontSize: 6.76
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