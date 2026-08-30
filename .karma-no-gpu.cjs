module.exports = function configureNoGpuChrome(config) {
    config.set({
        frameworks: ['jasmine'],
        reporters: ['dots'],
        colors: false,
        browserConsoleLogOptions: {
            terminal: false,
        },
        customLaunchers: {
            ChromeHeadlessNoGpu: {
                base: 'ChromeHeadless',
                flags: [
                    '--disable-gpu',
                    '--disable-gpu-compositing',
                    '--disable-software-rasterizer',
                    '--no-sandbox',
                ],
            },
        },
    });
};
