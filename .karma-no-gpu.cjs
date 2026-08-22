module.exports = function configureNoGpuChrome(config) {
    config.set({
        frameworks: ['jasmine'],
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
