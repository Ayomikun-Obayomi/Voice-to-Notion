// Copy this file to peter-constants.js and fill it in after deploying the Cloudflare Worker
// (see SETUP.md). peter-constants.js is gitignored so the token stays out of git.
module.exports = {
  WORKER_URL: 'https://peter-api.YOUR-SUBDOMAIN.workers.dev',
  // Must match the PETER_APP_TOKEN secret on the Worker.
  PETER_APP_TOKEN: 'paste-the-same-random-string-here',
};
