'use strict';

function externalWebUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value) || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

module.exports = { externalWebUrl };
