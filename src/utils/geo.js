import geoip from 'geoip-lite';

/**
 * Cleanly extracts client IP address from incoming Express request.
 * Handles reverse proxies, Cloudflare, Fastly, Akamai, load balancers, and direct connections.
 */
export function extractClientIp(req) {
  if (!req) return '127.0.0.1';

  let ip =
    req.headers['cf-connecting-ip'] ||
    req.headers['true-client-ip'] ||
    req.headers['fastly-client-ip'] ||
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
    req.socket?.remoteAddress ||
    req.ip ||
    '127.0.0.1';

  // Normalize IPv6-mapped IPv4 address (e.g., ::ffff:192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  } else if (ip === '::1' || ip === 'fe80::1') {
    ip = '127.0.0.1';
  }

  return ip;
}

/**
 * Checks if an IP is a private or loopback address.
 */
export function isPrivateIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === 'localhost') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    // 10.0.0.0 - 10.255.255.255
    if (parts[0] === 10) return true;
    // 172.16.0.0 - 172.31.255.255
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0 - 192.168.255.255
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  return false;
}

/**
 * High-accuracy Geolocation Resolver.
 * Priority 1: Cloudflare & CDN Edge Geolocation Headers (Real-time edge precision ~99.8%)
 * Priority 2: Local geoip-lite MaxMind Database
 * Priority 3: Fallback for private / localhost development IPs
 */
export function resolveLocationFromIp(ip, req = null) {
  // 1. Check CDN Edge Geolocation Headers (Cloudflare, AWS CloudFront, etc.)
  if (req && req.headers) {
    const cfCountry = req.headers['cf-ipcountry'];
    const cfCity = req.headers['cf-ipcity'];
    const cfRegion = req.headers['cf-region'] || req.headers['cf-region-code'];
    const cfLat = req.headers['cf-iplatitude'] ? parseFloat(req.headers['cf-iplatitude']) : null;
    const cfLon = req.headers['cf-iplongitude'] ? parseFloat(req.headers['cf-iplongitude']) : null;
    const cfTimezone = req.headers['cf-timezone'];

    if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') {
      return {
        ip: ip || '127.0.0.1',
        country: cfCountry,
        countryCode: cfCountry,
        city: cfCity || 'Unknown City',
        region: cfRegion || 'Unknown Region',
        latitude: cfLat,
        longitude: cfLon,
        timezone: cfTimezone || 'UTC',
        source: 'edge_cdn',
      };
    }

    // AWS CloudFront Edge Geolocation headers
    const cfViewerCountry = req.headers['cloudfront-viewer-country-name'] || req.headers['cloudfront-viewer-country'];
    const cfViewerCity = req.headers['cloudfront-viewer-city'];
    if (cfViewerCountry) {
      return {
        ip: ip || '127.0.0.1',
        country: cfViewerCountry,
        countryCode: req.headers['cloudfront-viewer-country'] || 'XX',
        city: cfViewerCity || 'Unknown City',
        region: req.headers['cloudfront-viewer-country-region-name'] || 'Unknown Region',
        latitude: req.headers['cloudfront-viewer-latitude'] ? parseFloat(req.headers['cloudfront-viewer-latitude']) : null,
        longitude: req.headers['cloudfront-viewer-longitude'] ? parseFloat(req.headers['cloudfront-viewer-longitude']) : null,
        timezone: req.headers['cloudfront-viewer-time-zone'] || 'UTC',
        source: 'aws_cloudfront',
      };
    }
  }

  // 2. Local network / Development check
  if (!ip || isPrivateIp(ip)) {
    return {
      ip: ip || '127.0.0.1',
      country: 'Local Network',
      countryCode: 'DEV',
      city: 'Development / Localhost',
      region: 'Localhost',
      latitude: null,
      longitude: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      source: 'localhost',
    };
  }

  // 3. Fallback to offline MaxMind geoip-lite lookup
  try {
    const geo = geoip.lookup(ip);
    if (!geo) {
      return {
        ip,
        country: 'Unknown',
        countryCode: 'XX',
        city: 'Unknown City',
        region: 'Unknown Region',
        latitude: null,
        longitude: null,
        timezone: 'UTC',
        source: 'geoip_none',
      };
    }

    return {
      ip,
      country: geo.country || 'Unknown',
      countryCode: geo.country || 'XX',
      city: geo.city || 'Unknown City',
      region: geo.region || 'Unknown Region',
      latitude: geo.ll ? geo.ll[0] : null,
      longitude: geo.ll ? geo.ll[1] : null,
      timezone: geo.timezone || 'UTC',
      source: 'geoip_lite',
    };
  } catch (err) {
    console.warn(`[GeoIP] Resolution error for IP ${ip}:`, err.message);
    return {
      ip,
      country: 'Unknown',
      countryCode: 'XX',
      city: 'Unknown',
      region: 'Unknown',
      latitude: null,
      longitude: null,
      timezone: 'UTC',
      source: 'error',
    };
  }
}
