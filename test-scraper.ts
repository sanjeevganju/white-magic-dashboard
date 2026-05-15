import axios from 'axios';
import * as cheerio from 'cheerio';

function normalizeUrl(href: string, base: string = "https://whitemagicadventure.com"): string {
  if (!href) return "";
  href = href.trim();
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (/^([a-z0-9]+\.)+[a-z]{2,}/i.test(href) && !href.startsWith("/")) {
    return `https://${href}`;
  }
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = href.startsWith("/") ? href : `/${href}`;
  return `${cleanBase}${cleanPath}`;
}

async function testUrl(url: string, label: string) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };
    console.log(`\n=== RESULTS FOR ${label} ===`);
    const { data: html } = await axios.get(url, { headers });
    const $ = cheerio.load(html);

    $('p, strong, b, span, h3').each((_, el) => {
      const $el = $(el);
      if ($el.children('div, section, article, nav').length > 0) return;
      const text = $el.text().trim();
      
      if (/Featured\s+news\s+articles\s*-/i.test(text)) {
        console.log(`\nHeader: "${text}"`);
        let $container = $el.closest('div, p, h3');
        let $current = $container;
        let foundCount = 0;
        for (let j = 0; j < 5; j++) {
            if (!$current.length) break;
            if (j > 0 && /(Blogs|Photo\s+Albums|Video|Itinerary|Cost\s+Details|What\s+to\s+expect|Photo\s+gallery)\s*-/i.test($current.text())) break;
            
            $current.find("a").each((_, a) => {
                const $a = $(a);
                const href = $a.attr("href");
                const lText = $a.text().trim();
                const absolute = normalizeUrl(href || '');
                if (href && !absolute.includes('tel:') && !absolute.includes('mailto:')) {
                    const navWords = ['home', 'trips', 'listing', 'about', 'blog', 'ght', 'wm', 'faqs', 'contact', 'search'];
                    const isNavText = navWords.some(word => lText.toLowerCase() === word || lText.toLowerCase() === word + ' trek');
                    if (!isNavText && foundCount < 2) {
                        console.log(`  - [NEWS] ${lText} -> ${absolute}`);
                        foundCount++;
                    }
                }
            });
            if (foundCount >= 2) break;
            $current = $current.next();
        }
      }

      if (/^Blogs\s*-/i.test(text)) {
        console.log(`\nHeader: "${text}"`);
        let $container = $el.closest('div, p, h3');
        let $current = $container;
        let foundCount = 0;
        for (let j = 0; j < 5; j++) {
            if (!$current.length) break;
            if (j > 0 && /(Featured\s+news\s+articles|Photo\s+Albums|Video|Itinerary|Cost\s+Details|What\s+to\s+expect|Photo\s+gallery)\s*-/i.test($current.text())) break;
            
            $current.find("a").each((_, a) => {
                const $a = $(a);
                const href = $a.attr("href");
                const lText = $a.text().trim();
                const absolute = normalizeUrl(href || '');
                if (href && !absolute.includes('tel:') && !absolute.includes('mailto:')) {
                    const navWords = ['home', 'trips', 'about', 'blog', 'faqs', 'contact'];
                    const isNavText = navWords.some(word => lText.toLowerCase() === word);
                    if (!isNavText && foundCount < 1) {
                         console.log(`  - [BLOG] ${lText} -> ${absolute}`);
                         foundCount++;
                    }
                }
            });
            if (foundCount >= 1) break;
            $current = $current.next();
        }
      }
    });
  } catch (e) {
    console.error(`Error for ${label}:`, e.message);
  }
}

async function run() {
  await testUrl('https://whitemagicadventure.com/trek-walking-holidays/panwali-kantha-trek', 'PANWALI KANTHA');
  await testUrl('https://whitemagicadventure.com/trek-trekking-expeditions/panpatia-col', 'PANPATIA COL');
}

run();
