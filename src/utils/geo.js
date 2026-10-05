import geoip from 'geoip-lite';

/**
 * Cleanly extracts client IP address from incoming Express request.
 * Handles reverse proxies, Cloudflare, load balancers, and direct connections.
 */
export function extractClientIp(req) {
  let ip =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
    req.socket?.remoteAddress ||
    req.ip ||
    '127.0.0.1';

  // Normalize IPv6 mapped IPv4 address
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  } else if (ip === '::1') {
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
 * Resolves geolocation for an IP address.
 */
export function resolveLocationFromIp(ip) {
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
    };
  }

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
    };
  }
}
