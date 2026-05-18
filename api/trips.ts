import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from "axios";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";

// Deployment Trigger: 1.0.5 - Sync with server.ts
export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Trip {
  id: string;
  name: string;
  grade: Grade;
  date: string;
  month: string;
  region?: string;
  status: 'open' | 'closed';
  description?: string;
  price?: string;
  duration?: string;
  websiteUrl: string;
  signUps?: string;
  fbLinks?: string[];
  blogLinks?: string[];
  isLive: boolean;
}

// Helper to normalize and resolve URLs accurately
function normalizeUrl(href: string, base: string = "https://whitemagicadventure.com"): string {
  if (!href) return "";
  href = href.trim();
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  
  if (/^([a-z0-9-]+\.)+[a-z]{2,}/i.test(href) && !href.startsWith("/")) {
    return `https://${href}`;
  }
  
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = href.startsWith("/") ? href : `/${href}`;
  return `${cleanBase}${cleanPath}`;
}

// Helper to clean Facebook URLs for better mobile deep-linking
function cleanFacebookUrl(url: string): string {
  if (!url || !url.includes("facebook.com")) return url;
  
  try {
    const albumMatch = url.match(/[?&]set=a\.([0-9]+)/);
    if (albumMatch && albumMatch[1]) {
      return `https://www.facebook.com/${albumMatch[1]}`;
    }
    
    const idMatch = url.match(/[?&]album_id=([0-9]+)/);
    if (idMatch && idMatch[1]) {
      return `https://www.facebook.com/${idMatch[1]}`;
    }
  } catch (e) {}
  
  return url;
}

// Helper to detect Region from text or URL
function detectRegion(text: string, url: string = ""): string {
  const combined = `${text} ${url}`.toUpperCase();
  
  // Specific mappings for Google Sheet (Column F or names)
  if (combined.includes("HIMACHAL_PRADESH") || combined.includes("HIMACHAL")) return "Himachal";
  if (combined.includes("UTTARAKHAND") || combined.includes("UTTARAK")) return "Uttarakhand";
  if (combined.includes("LADAKH")) return "Ladakh";
  if (combined.includes("J&K") || combined.includes("KASHMIR")) return "Kashmir";
  if (combined.includes("SIKKIM_DARJEELING") || combined.includes("SIKKIM")) return "Sikkim";
  if (combined.includes("BHUTAN")) return "Bhutan";
  if (combined.includes("NEPAL")) return "Nepal";

  const lowerCombined = combined.toLowerCase();
  const regions = [
    "Ladakh", "Zanskar", "Sikkim", "Nepal", "Garhwal", "Kumaon", 
    "Himachal", "Spiti", "Bhutan", "Africa", "Tanzania", "Kilimanjaro",
    "Patagonia", "Europe", "Georgia", "Turkey", "Kashmir"
  ];
  
  for (const region of regions) {
    if (lowerCombined.includes(region.toLowerCase())) return region;
  }
  
  return "Himalayas"; // Default
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    // 1. Fetch high-level data sources in parallel to save time
    const websiteUrl = "https://whitemagicadventure.com/trips";
    const sheetId = "1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8";
    const databaseGid = "1637681821"; 
    const liveGid = "1778692444"; 
    
    const databaseUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${databaseGid}`;
    const liveUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${liveGid}`;

    console.log("Starting parallel fetch for Vercel...");
    const [webRes, dbRes, liveRes] = await Promise.allSettled([
      axios.get(websiteUrl, { headers, timeout: 9000 }), // Increased to 9s
      axios.get(databaseUrl, { headers, timeout: 8000 }),
      axios.get(liveUrl, { headers, timeout: 8000 })
    ]);

    // 2. Process Website Data
    let websiteTrips: any[] = [];
    if (webRes.status === "fulfilled") {
      const html = webRes.value.data;
      const $ = cheerio.load(html);
      const tripPromises: Promise<any>[] = [];
      const MAX_DETAIL_FETCHES = 100;

      $(".views-row, .trip-box, .trip-container").each((i, el) => {
        const container = $(el);
        let linkEl = container.find("h2 a, h3 a, .heading a, .trip-name a").first();
        if (linkEl.length === 0) {
          linkEl = container.find("a[href*='/trek'], a[href*='/climb'], a[href*='/discover']").first();
        }

        const name = linkEl.text().trim();
        const link = linkEl.attr("href");

        if (name && name.length > 3 && link && !link.includes('#')) {
          const containerText = container.text().replace(/\s+/g, ' ').trim();
          const dateRegex = /(\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{4})?)/gi;
          const dates = containerText.match(dateRegex);

          if (dates && dates.length > 0) {
            const startDateText = dates[0];
            const yearMatch = containerText.match(/\b20\d{2}\b/);
            const year = yearMatch ? yearMatch[0] : "2026";

            let displayDate = dates.length > 1 ? `${dates[0]} - ${dates[dates.length - 1]}` : dates[0];
            if (!displayDate.includes(year)) displayDate += ` ${year}`;

            let grade = 1;
            const difficultyKeywords = "Moderate|Challenging|Beginner|Intermediate|Advanced|Technical|Introductory|Trek|Climb|Peak|Expedition|Course|Difficulty|Level|Grade";
            const numbers = containerText.match(/\b([1-9])\b/g);
            if (numbers) {
              const nonDateNumbers = numbers.filter(n => !displayDate.includes(n));
              const gradeRegex = new RegExp(`(\\d)\\s+(?:[A-Za-z]+\\s+)*(?:${difficultyKeywords})`, "i");
              const gradeMatch = containerText.match(gradeRegex);
              if (gradeMatch) {
                grade = parseInt(gradeMatch[1]);
              } else if (nonDateNumbers.length > 0) {
                grade = parseInt(nonDateNumbers[0]);
              }
            }

            const monthMap: { [key: string]: string } = {
              'Jan': 'January', 'Feb': 'February', 'Mar': 'March', 'Apr': 'April',
              'May': 'May', 'Jun': 'June', 'Jul': 'July', 'Aug': 'August',
              'Sep': 'September', 'Oct': 'October', 'Nov': 'November', 'Dec': 'December'
            };
            const monthMatch = startDateText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
            let month = "Other";
            if (monthMatch) {
              const found = monthMatch[0].substring(0, 3);
              const capitalized = found.charAt(0).toUpperCase() + found.slice(1).toLowerCase();
              month = monthMap[capitalized] || capitalized;
            }

            const tripUrl = link.startsWith("http") ? link : `https://whitemagicadventure.com${link}`;

            if (!websiteTrips.find(t => t.name === name && t.date === displayDate)) {
              const tripData = {
                name,
                date: displayDate,
                month: month,
                region: detectRegion(containerText, link),
                grade: Math.min(Math.max(grade, 1), 10),
                url: tripUrl,
                fbLinks: [] as string[],
                blogLinks: [] as string[],
                description: ""
              };
              websiteTrips.push(tripData);

              if (tripPromises.length < MAX_DETAIL_FETCHES) {
                tripPromises.push(
                  axios.get(tripUrl, { headers, timeout: 8000 })
                    .then(({ data: tripHtml }) => {
                      const $trip = cheerio.load(tripHtml);

                      // Try to find a summary paragraph
                      $trip(".field-name-body p, .trip-description p, #block-system-main p").each((_, p) => {
                        const pText = $trip(p).text().trim();
                        if (pText.length > 50 && pText.length < 600 && !tripData.description) {
                          if (!/Album|Blogs|Featured|Itinerary|Cost|Highlights/i.test(pText)) {
                            tripData.description = pText;
                          }
                        }
                      });

                      $trip("p, strong, b, span, h3").each((_, el) => {
                        const $el = $trip(el);
                        if ($el.children('div, section, article, nav').length > 0) return;
                        const text = $el.text().trim();
                        if (!text) return;

                        if (!tripData.description && text.length > 60 && text.length < 500 && !/Album|Blogs|Featured|News/i.test(text)) {
                          if (text.split('.').length > 1) {
                            tripData.description = text;
                          }
                        }

                        if (/Photo\s+Album/i.test(text) && tripData.fbLinks.length === 0) {
                          let $next = $el.closest('div, p, h3');
                          let foundCount = 0;
                          for (let j = 0; j < 5; j++) {
                            if (!$next.length) break;
                            if (j > 0 && /(Blogs|Featured\s+news\s+articles)/i.test($next.text())) break;
                            $next.find("a").each((_, a) => {
                              let href = $trip(a).attr("href")?.trim();
                              if (href && (href.includes("facebook.com") || href.includes("photos.google.com"))) {
                                let absoluteHref = normalizeUrl(href);
                                if (absoluteHref.includes("facebook.com")) absoluteHref = cleanFacebookUrl(absoluteHref);
                                if (!tripData.fbLinks.includes(absoluteHref) && foundCount < 3) {
                                  tripData.fbLinks.push(absoluteHref);
                                  foundCount++;
                                }
                              }
                            });
                            if (foundCount >= 3) break;
                            $next = $next.next();
                          }
                        }

                        if (/Featured\s+news\s+articles/i.test(text)) {
                          let $container = $el.closest('div, p, h3');
                          let foundCount = 0;
                          let $current = $container;
                          for (let j = 0; j < 5; j++) {
                            if (!$current || !$current.length) break;
                            if (j > 0 && /(Blogs|Photo\s+Album|Video|Itinerary|Cost\s+Details|What\s+to\s+expect|Photo\s+gallery)/i.test($current.text())) break;
                            $current.find("a").each((_, a) => {
                              const $a = $trip(a);
                              let href = $a.attr("href")?.trim();
                              const linkText = $a.text().trim().toLowerCase();
                              if (!href || foundCount >= 2) return;
                              const isSocial = /twitter\.com|instagram\.com|linkedin\.com/i.test(href);
                              const isUtility = /^(tel:|mailto:|javascript:|#)/i.test(href);
                              const isRelated = $a.closest('.related-blogs, .field-name-field-related-blogs, #related-blogs').length > 0;
                              const absoluteHref = normalizeUrl(href);
                              const navPaths = ['/', '/trips', '/trek', '/climb', '/discover', '/trek-walking-holidays', '/climb-mountaineering-expeditions', '/climb-trekking-peaks', '/faqs', '/about', '/contact', '/blog', '/news', '/home'];
                              const isNavUrl = navPaths.some(path => {
                                const fullPath = `https://whitemagicadventure.com${path}`;
                                return absoluteHref === fullPath || absoluteHref === fullPath + '/';
                              }) || absoluteHref === 'https://whitemagicadventure.com';
                              const navWords = ['home', 'trips', 'listing', 'about', 'blog', 'ght', 'wm', 'faqs', 'contact', 'search', 'view all trips', 'view more'];
                              if (!isSocial && !isUtility && !isRelated && !isNavUrl && !navWords.some(word => linkText === word || linkText === word + ' trek')) {
                                if (!tripData.blogLinks.includes(absoluteHref)) {
                                  tripData.blogLinks.push(absoluteHref);
                                  foundCount++;
                                }
                              }
                            });
                            if (foundCount >= 2) break;
                            $current = $current.next();
                          }
                        }
                        if (/Blogs\s*-/i.test(text)) {
                          let $container = $el.closest('div, p, h3');
                          let foundCount = 0;
                          let $current = $container;
                          for (let j = 0; j < 5; j++) {
                            if (!$current || !$current.length) break;
                            if (j > 0 && /(Featured\s+news\s+articles|Photo\s+Album|Video|Itinerary|Cost\s+Details|What\s+to\s+expect|Photo\s+gallery)/i.test($current.text())) break;
                            $current.find("a").each((_, a) => {
                              const $a = $trip(a);
                              let href = $a.attr("href")?.trim();
                              const linkText = $a.text().trim().toLowerCase();
                              if (!href || foundCount >= 1) return;
                              const isSocial = /twitter\.com|instagram\.com|linkedin\.com/i.test(href);
                              const isUtility = /^(tel:|mailto:|javascript:|#)/i.test(href);
                              const isRelated = $a.closest('.related-blogs, .field-name-field-related-blogs, #related-blogs').length > 0;
                              const absoluteHref = normalizeUrl(href);
                              const navPaths = ['/', '/trips', '/trek', '/climb', '/discover', '/trek-walking-holidays', '/climb-mountaineering-expeditions', '/climb-trekking-peaks', '/faqs', '/about', '/contact', '/blog', '/news', '/home'];
                              const isNavUrl = navPaths.some(path => {
                                const fullPath = `https://whitemagicadventure.com${path}`;
                                return absoluteHref === fullPath || absoluteHref === fullPath + '/';
                              }) || absoluteHref === 'https://whitemagicadventure.com';
                              if (!isSocial && !isUtility && !isRelated && !isNavUrl && !['home', 'trips', 'about', 'blog', 'faqs', 'contact'].some(word => linkText === word)) {
                                if (!tripData.blogLinks.includes(absoluteHref)) {
                                  tripData.blogLinks.push(absoluteHref);
                                  foundCount++;
                                }
                              }
                            });
                            if (foundCount >= 1) break;
                            $current = $current.next();
                          }
                        }
                      });
                    })
                    .catch(() => { })
                );
              }
            }
          }
        }
      });
      await Promise.allSettled(tripPromises);
    }

    // 3. Process Database Sheet Data
    let databaseTreks: any[] = [];
    if (dbRes.status === "fulfilled") {
      const dbCsvData = dbRes.value.data;
      const dbRecords = parse(dbCsvData, { columns: false, skip_empty_lines: true });
      if (dbRecords.length > 1) {
        databaseTreks = dbRecords.slice(1).map((row: string[]) => {
          const statusType = (row[1] || "").trim().toUpperCase();
          if (statusType !== "FD") return null;
          const trekName = (row[2] || "").trim(); 
          const region = (row[5] || "").trim();
          const monthsStr = row[29] || ""; 
          const duration = row[30] || ""; 
          const gradeRaw = row[31] || "";
          const gradeMatch = gradeRaw.match(/^(\d+)/);
          const grade = gradeMatch ? parseInt(gradeMatch[1]) : 1;
          const months = monthsStr.split(/[-,\s&]+/).map(m => m.trim()).filter(m => m.length >= 3);
          return { name: trekName, region, grade, months, duration, source: 'database' };
        }).filter((t: any) => t !== null && t.name.length > 3);
      }
    }

    // 4. Process Live Status Sheet Records
    let liveSheetRecords: any[] = [];
    if (liveRes.status === "fulfilled") {
      const liveCsvData = liveRes.value.data;
      liveSheetRecords = parse(liveCsvData, { columns: true, skip_empty_lines: true });
    }

    // 4. Merge
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const mergedTrips: Trip[] = websiteTrips.map((wTrip, index) => {
      const liveMatch = liveSheetRecords.find((r: any) => {
        const tripKey = Object.keys(r).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'trip' || k.toLowerCase().replace(/\s+/g, ' ') === 'trip name');
        return tripKey && normalize(r[tripKey] || "") === normalize(wTrip.name);
      });
      const dbMatch = databaseTreks.find((dt: any) => normalize(dt.name) === normalize(wTrip.name));
      const statusKey = Object.keys(liveSheetRecords[0] || {}).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'status');
      const signUpsKey = Object.keys(liveSheetRecords[0] || {}).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'sign ups');
      const status = liveMatch && statusKey && normalize(liveMatch[statusKey] || "") === "open" ? "open" : "closed";
      const signUps = liveMatch && signUpsKey ? liveMatch[signUpsKey] : undefined;
      return {
        id: `live-${index}`,
        name: wTrip.name,
        grade: (wTrip.grade as Grade) || 1,
        date: wTrip.date,
        month: wTrip.month || "Other",
        region: wTrip.region,
        status: status as "open" | "closed",
        websiteUrl: wTrip.url,
        description: wTrip.description || `Fixed Departure`,
        duration: dbMatch?.duration || undefined,
        signUps: signUps,
        fbLinks: wTrip.fbLinks?.length > 0 ? wTrip.fbLinks.slice(0, 2) : undefined,
        blogLinks: wTrip.blogLinks?.length > 0 ? wTrip.blogLinks.slice(0, 5) : undefined,
        isLive: true
      };
    });

    databaseTreks.forEach((dbTrek, index) => {
      if (mergedTrips.find(t => normalize(t.name) === normalize(dbTrek.name))) return;
      const knownWebsiteInfo = websiteTrips.find(wt => normalize(wt.name) === normalize(dbTrek.name));
      dbTrek.months.forEach((m: string, mIndex: number) => {
        const monthMap: { [key: string]: string } = {
          'jan': 'January', 'feb': 'February', 'mar': 'March', 'apr': 'April',
          'may': 'May', 'jun': 'June', 'jul': 'July', 'aug': 'August',
          'sep': 'September', 'oct': 'October', 'nov': 'November', 'dec': 'December'
        };
        const stdMonth = monthMap[m.toLowerCase().substring(0, 3)] || m;
        mergedTrips.push({
          id: `db-${index}-${mIndex}`,
          name: dbTrek.name,
          grade: (dbTrek.grade as Grade) || (knownWebsiteInfo?.grade as Grade) || 1, 
          date: `On Request (${stdMonth})`,
          month: stdMonth,
          region: detectRegion(dbTrek.region || "", "") || knownWebsiteInfo?.region || detectRegion(dbTrek.name),
          status: "open",
          websiteUrl: knownWebsiteInfo?.url || `https://whitemagicadventure.com/search?keyword=${encodeURIComponent(dbTrek.name)}`,
          description: `Trek Database Option - ${dbTrek.duration || 'Flexible duration'}`,
          duration: dbTrek.duration,
          isLive: false,
          fbLinks: knownWebsiteInfo?.fbLinks || [],
          blogLinks: knownWebsiteInfo?.blogLinks || []
        });
      });
    });

    res.status(200).json(mergedTrips);
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
}
