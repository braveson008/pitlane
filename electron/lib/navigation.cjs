// The window only ever shows the app's own page; anything else (a clicked link, a dropped file) would get the preload's API.
function isAppUrl(url, appUrl) {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    return target.protocol === app.protocol && target.host === app.host && target.pathname === app.pathname;
  } catch {
    return false;
  }
}

function externalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function quotePath(file) {
  return `'${String(file).replace(/'/g, "'\\''")}'`;
}

module.exports = { isAppUrl, externalUrl, quotePath };
