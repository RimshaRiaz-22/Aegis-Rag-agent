import dns from 'node:dns/promises';
import { knowledgeService } from './knowledge.service.js';

/**
 * Enterprise SSRF Protection
 * Checks whether an IP address belongs to private, loopback, or reserved ranges.
 */
function isPrivateIp(ip) {
  if (!ip) return true;

  // IPv4 checks
  if (ip.includes('.')) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b] = parts;

    // 0.0.0.0/8 - Current network
    if (a === 0) return true;
    // 10.0.0.0/8 - Private network
    if (a === 10) return true;
    // 127.0.0.0/8 - Loopback
    if (a === 127) return true;
    // 100.64.0.0/10 - Shared address / Carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 169.254.0.0/16 - Link-local (Cloud metadata e.g. 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 - Private network
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 - IETF Protocol Assignments
    if (a === 192 && b === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 - Documentation (TEST-NET-1)
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    // 192.168.0.0/16 - Private network
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 - Benchmark tests
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 - Documentation (TEST-NET-2)
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 - Documentation (TEST-NET-3)
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 - Multicast
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 - Reserved
    if (a >= 240) return true;

    return false;
  }

  // IPv6 checks
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  // Unique local address fc00::/7
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // Link-local unicast fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  // Multicast ff00::/8
  if (normalized.startsWith('ff')) return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1
  if (normalized.includes('::ffff:')) {
    const v4 = normalized.split('::ffff:')[1];
    return isPrivateIp(v4);
  }

  return false;
}

/**
 * Validate URL and perform DNS resolution against SSRF attacks
 */
async function validateUrlForScraping(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    const err = new Error('Invalid URL format. Please provide a valid HTTP or HTTPS address.');
    err.statusCode = 400;
    throw err;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    const err = new Error('Only HTTP and HTTPS URLs are supported.');
    err.statusCode = 400;
    throw err;
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Block localhost aliases
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    const err = new Error('Access to localhost and internal domain names is blocked for security.');
    err.statusCode = 400;
    throw err;
  }

  // Resolve DNS to check IP addresses
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      const err = new Error(`Could not resolve hostname "${hostname}".`);
      err.statusCode = 400;
      throw err;
    }

    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        const err = new Error(`Target IP address (${addr.address}) belongs to a private or restricted network.`);
        err.statusCode = 400;
        throw err;
      }
    }
  } catch (dnsErr) {
    if (dnsErr.message.includes('belongs to a private')) {
      dnsErr.statusCode = 400;
      throw dnsErr;
    }
    const err = new Error(`DNS resolution failed for "${hostname}": ${dnsErr.message}`);
    err.statusCode = 400;
    throw err;
  }

  return parsedUrl;
}

/**
 * Decode common HTML entities without external dependencies
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
}

/**
 * High-performance HTML cleaner & article text extractor
 */
function extractCleanContentFromHtml(html) {
  if (!html || typeof html !== 'string') return { title: '', description: '', text: '' };

  // 1. Extract title
  let title = '';
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = decodeHtmlEntities(titleMatch[1].trim().replace(/\s+/g, ' '));
  }

  // 2. Extract meta description
  let description = '';
  const descMatch =
    html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  if (descMatch && descMatch[1]) {
    description = decodeHtmlEntities(descMatch[1].trim());
  }

  // 3. Remove non-content tags and comments
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');

  // 4. Convert semantic blocks to markdown-like headings and linebreaks
  cleaned = cleaned
    .replace(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/gi, '\n\n## $1\n\n')
    .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n\n### $1\n\n')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n• $1')
    .replace(/<(p|div|section|article|blockquote|tr)\b[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n');

  // 5. Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // 6. Decode entities
  cleaned = decodeHtmlEntities(cleaned);

  // 7. Clean excessive blank lines and whitespace
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => {
      // Don't keep consecutive empty lines
      if (!line && idx > 0 && !arr[idx - 1]) return false;
      return true;
    });

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { title, description, text };
}

export const urlScraperService = {
  /**
   * Scrapes a webpage safely, cleans boilerplate, and indexes it into the user's RAG knowledge base
   */
  async scrapeAndIngest({
    url,
    userId,
    namespace,
    customTitle = null,
    overrideSettings = {},
    metadata = {},
  }) {
    if (!url || typeof url !== 'string') {
      throw new Error('A valid webpage URL is required.');
    }

    const validatedUrl = await validateUrlForScraping(url.trim());
    const targetUrl = validatedUrl.href;

    console.log(`[URL Scraper] Fetching: ${targetUrl} for user: ${userId}`);

    // Fetch webpage with timeout and payload size limit (max 6MB)
    const MAX_BYTES = 6 * 1024 * 1024;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let html = '';
    let responseStatus = 200;

    try {
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AegisBot/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      responseStatus = response.status;
      if (!response.ok) {
        throw new Error(`Webpage returned HTTP error ${response.status} (${response.statusText})`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
        throw new Error(`Unsupported content type "${contentType}". Only HTML and text webpages can be scraped.`);
      }

      // Stream read with byte guard
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.length;
        if (totalBytes > MAX_BYTES) {
          throw new Error(`Webpage exceeded maximum size limit of 6 MB.`);
        }

        html += decoder.decode(value, { stream: true });
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Extract clean content
    const { title: extractedTitle, description, text } = extractCleanContentFromHtml(html);

    if (!text || text.length < 50) {
      throw new Error(
        'Could not extract sufficient text content from this webpage. It may rely entirely on client-side JavaScript rendering or be protected behind a login.'
      );
    }

    const finalTitle = customTitle || extractedTitle || validatedUrl.hostname;
    const docId = `url_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const filename = `[Web] ${finalTitle.slice(0, 80)}`;

    const structuredContent = `# ${finalTitle}\n**Source URL**: ${targetUrl}\n${description ? `**Description**: ${description}\n\n` : '\n'}${text}`;

    // Ingest into knowledgeService with vector embeddings
    const ingestResult = await knowledgeService.ingestDocument({
      userId,
      docId,
      filename,
      fileType: 'webpage',
      fileSize: structuredContent.length,
      content: structuredContent,
      namespace,
      metadata: {
        ...metadata,
        source: 'url_scrape',
        url: targetUrl,
        title: finalTitle,
        description,
        scrapedAt: new Date().toISOString(),
        httpStatus: responseStatus,
      },
      overrideSettings,
    });

    return {
      docId,
      filename,
      url: targetUrl,
      title: finalTitle,
      description,
      contentLength: structuredContent.length,
      chunksCount: ingestResult.chunks ? ingestResult.chunks.length : ingestResult.chunkCount || 0,
      namespace: ingestResult.namespace,
      document: ingestResult,
    };
  },
};
