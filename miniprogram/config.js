'use strict';

// Use cloudEnv for WeChat Cloud Development, or leave it empty for the local HTTP server.
// assetBase may be a CloudBase file prefix (cloud://...) or a public HTTPS asset host.
module.exports = {
  apiBase: 'http://127.0.0.1:8787',
  cloudEnv: 'cloud1-d4gslaxwg77d12711',
  // CloudBase file-ID prefix for the uploaded assets/ directory.
  assetBase: 'cloud://cloud1-d4gslaxwg77d12711.636c-cloud1-d4gslaxwg77d12711-1517579247',
  // Uploaded cloud character files use .png; .webp is tried as a fallback.
  cloudAssetExtension: '.png',
  development: false,
  // Cloud-mode room refresh interval; the client enforces a 300 ms minimum.
  cloudPollMs: 300,
};
