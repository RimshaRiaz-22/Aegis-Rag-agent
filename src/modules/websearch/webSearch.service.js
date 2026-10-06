/**
 * Web Search Service
 * Provides live web search capability for workspace/admin conversations.
 * Supports:
 *  1. Zero-config built-in DuckDuckGo search (fast, free, no API key required)
 *  2. Optional Tavily Search API if user configures a tavilyApiKey in settings
 */

export const webSearchService = {
  /**
   * Execute live web search
   * @param {string} rawQuery
   * @param {Object} options
   * @returns {Promise<Array<{ title: string, url: string, snippet: string, source: 'web' }>>}
   */
  async search(rawQuery, { maxResults = 5, tavilyApiKey = null } = {}) {
    if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
      return [];
    }

    // Clean up query (remove conversational commands like "search web for", "google", etc.)
    const cleanQuery = rawQuery
      .replace(/^(?:please\s+)?(?:can you\s+)?(?:search(?:\s+the)?\s+web\s+for|search\s+for|google|lookup)\s+/i, '')
      .replace(/[?!.]+$/, '')
      .trim();

    const queryToUse = cleanQuery || rawQuery.trim();

    // 1. If Tavily API Key is configured, use official Tavily Search API
    if (tavilyApiKey) {
      try {
        const tavilyRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: queryToUse,
            max_results: maxResults,
            include_snippets: true,
          }),
        });

        if (tavilyRes.ok) {
          const tavilyData = await tavilyRes.json();
          if (Array.isArray(tavilyData.results) && tavilyData.results.length > 0) {
            return tavilyData.results.slice(0, maxResults).map((r) => ({
              title: r.title || 'Web Result',
              url: r.url || '',
              snippet: r.content || r.snippet || '',
              source: 'web',
            }));
          }
        }
      } catch (tavilyErr) {
        console.warn('[WebSearch] Tavily search fallback to DuckDuckGo:', tavilyErr.message);
      }
    }

    // 2. Default Zero-Config DuckDuckGo Search
    try {
      const res = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: `q=${encodeURIComponent(queryToUse)}`,
      });

      if (!res.ok) {
        console.warn(`[WebSearch] DuckDuckGo HTTP status ${res.status}`);
        return [];
      }

      const html = await res.text();
      const linkRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
      const hrefRegex = /href=['"]([^'"]+)['"]/i;
      const snippetRegex = /<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

      const links = [];
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        const fullTag = m[0];
        const h = fullTag.match(hrefRegex);
        let url = h ? h[1] : '';
        if (url.includes('uddg=')) {
          const uMatch = url.match(/uddg=([^&]+)/);
          if (uMatch) url = decodeURIComponent(uMatch[1]);
        }
        const title = m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        links.push({ url, title });
      }

      const snippets = [];
      while ((m = snippetRegex.exec(html)) !== null) {
        const snippet = m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        snippets.push(snippet);
      }

      const results = [];
      const count = Math.min(links.length, snippets.length, maxResults);
      for (let i = 0; i < count; i++) {
        results.push({
          title: links[i].title,
          url: links[i].url,
          snippet: snippets[i],
          source: 'web',
        });
      }

      return results;
    } catch (err) {
      console.warn('[WebSearch] Error fetching web search results:', err.message);
      return [];
    }
  },
};
