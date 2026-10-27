const fs = require('node:fs');
const path = require('node:path');

exports.default = async (context) => {
  const resources = path.join(context.appOutDir, 'resources');
  const required = [
    'api/app.js',
    'api/server.js',
    'api/node_modules/express/package.json',
    'api/node_modules/axios/package.json',
    'app.asar'
  ];

  for (const relative of required) {
    if (!fs.existsSync(path.join(resources, relative))) {
      throw new Error(`[package] missing ${relative}; the app would start without a working API sidecar`);
    }
  }
};
