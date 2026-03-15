const path = require('node:path');
const fs = require('node:fs');

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      { 'middleware:darkClient': ['factory', function () {
        const html = fs.readFileSync(path.join(__dirname, 'karma', 'client.html'), 'utf-8');
        return function (req, res, next) {
          if (req.url === '/' || req.url === '/client.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
            res.end(html);
          } else {
            next();
          }
        };
      }] },
    ],
    beforeMiddleware: ['darkClient'],
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    restartOnFileChange: true,
    client: {
      clearContext: false,
    },
    jasmineHtmlReporter: {
      suppressAll: true,
    },
    coverageReporter: {
      dir: path.join(__dirname, 'coverage', 'mekbay'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    customContextFile: path.join(__dirname, 'karma', 'context.html'),
    customDebugFile: path.join(__dirname, 'karma', 'debug.html'),
  });
};