/**
 * Extracts browser name, operating system, device type, and bot classification from User-Agent string.
 */
export function parseUserAgent(uaString = '') {
  const ua = String(uaString).toLowerCase();

  // 1. Bot & Web Crawler Detection
  const botPatterns = /bot|spider|crawl|slurp|googlebot|bingbot|yandex|baidu|duckduck|lighthouse|headlesschrome|curl|wget|python|postman|insomnia|semrush|ahrefs|facebookexternalhit|whatsapp|telegrambot|twitterbot|discordbot/i;
  const isBot = botPatterns.test(ua);

  // 2. Device Type Classification
  let deviceType = 'desktop';
  if (isBot) {
    deviceType = 'bot';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua)) {
    deviceType = 'mobile';
  } else if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) {
    deviceType = 'tablet';
  }

  // 3. Operating System
  let os = 'Unknown OS';
  if (/windows nt 10\.0/i.test(ua)) os = 'Windows 10/11';
  else if (/windows nt 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/windows nt 6\.1/i.test(ua)) os = 'Windows 7';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) {
    if (/ipad/i.test(ua) || (navigator?.maxTouchPoints && navigator.maxTouchPoints > 2)) {
      os = 'iPadOS';
    } else {
      os = 'macOS';
    }
  } else if (/iphone|ipod/i.test(ua)) os = 'iOS (iPhone)';
  else if (/ipad/i.test(ua)) os = 'iOS (iPad)';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'Chrome OS';

  // 4. Browser Classification
  let browser = 'Unknown Browser';
  if (isBot) {
    browser = 'Web Crawler / Bot';
  } else if (/edg\//i.test(ua)) {
    browser = 'Edge';
  } else if (/opr\/|opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/brave/i.test(ua)) {
    browser = 'Brave';
  } else if (/vivaldi/i.test(ua)) {
    browser = 'Vivaldi';
  } else if (/samsungbrowser/i.test(ua)) {
    browser = 'Samsung Internet';
  } else if (/chrome|crios/i.test(ua)) {
    browser = 'Chrome';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Firefox';
  } else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) {
    browser = 'Safari';
  } else if (/msie|trident/i.test(ua)) {
    browser = 'Internet Explorer';
  }

  return { browser, os, deviceType, isBot };
}
