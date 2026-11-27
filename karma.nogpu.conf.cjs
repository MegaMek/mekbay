module.exports = (config) => {
    config.set({
        frameworks: ['jasmine'],
        browserNoActivityTimeout: 120000,
        reporters: ['dots'],
        customLaunchers: {
            EdgeHeadlessNoGpu: {
                base: 'ChromeHeadless',
                flags: [
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-gpu-compositing',
                    '--disable-gpu-sandbox',
                    '--disable-features=Vulkan',
                    '--use-angle=swiftshader',
                    '--enable-unsafe-swiftshader',
                ],
            },
        },
    });
};
