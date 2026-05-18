import express from "express";
// Deployment Trigger: 1.0.5 - Photo Albums & Descriptions Sync
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
import { Trip, Grade } from "./src/types";

// Helper to normalize and resolve URLs accurately
function normalizeUrl(href: string, base: string = "https://whitemagicadventure.com"): string {
  if (!href) return "";
  href = href.trim();
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  
  // Handle protocol-less domains like "indianexpress.com/..."
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
    // Try to extract Album ID from media/set links which often break on mobile apps
    // Example: set=a.385039118217807.92501...
    const albumMatch = url.match(/[?&]set=a\.([0-9]+)/);
    if (albumMatch && albumMatch[1]) {
      return `https://www.facebook.com/${albumMatch[1]}`;
    }
    
    // Try to extract from album_id param
    const idMatch = url.match(/[?&]album_id=([0-9]+)/);
    if (idMatch && idMatch[1]) {
      return `https://www.facebook.com/${idMatch[1]}`;
    }
  } catch (e) {
    // Fallback to original URL if parsing fails
  }
  
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API Route to fetch and merge trip data
  app.get("/api/trips", async (req, res) => {
    try {
      console.log("Fetching live data...");
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };
      
      // 1. Fetch Website Data
      let websiteTrips: any[] = [];
      try {
        const websiteUrl = "https://whitemagicadventure.com/trips";
        const { data: html } = await axios.get(websiteUrl, { headers, timeout: 15000 });
        console.log(`Website HTML fetched, length: ${html.length}`);
        const $ = cheerio.load(html);
        
        const tripPromises: Promise<any>[] = [];
        const MAX_DETAIL_FETCHES = 100; // Increased to cover all trips
        
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
            // Upgraded regex to handle "9th", "1st", etc.
            const dateRegex = /(\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{4})?)/gi;
            const dates = containerText.match(dateRegex);
            
            if (dates && dates.length > 0) {
              const startDateText = dates[0];
              const yearMatch = containerText.match(/\b20\d{2}\b/);
              const year = yearMatch ? yearMatch[0] : "2026";
              
              let displayDate = dates.length > 1 ? `${dates[0]} - ${dates[dates.length-1]}` : dates[0];
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

                          // Extract description if not found via specific classes
                          if (!tripData.description && text.length > 60 && text.length < 500 && !/Album|Blogs|Featured|News/i.test(text)) {
                            // Basic heuristic for a summary
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
                                const $a = $trip(a);
                                let href = $a.attr("href")?.trim();
                                if (href && (href.includes("facebook.com") || href.includes("photos.google.com"))) {
                                  let absoluteHref = normalizeUrl(href);
                                  if (absoluteHref.includes("facebook.com")) {
                                    absoluteHref = cleanFacebookUrl(absoluteHref);
                                  }
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
                          
                          // Check for Featured news articles header
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
                                const isNavText = navWords.some(word => linkText === word || linkText === word + ' trek');

                                if (!isSocial && !isUtility && !isRelated && !isNavUrl && !isNavText) {
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

                          // Check for Blogs header
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
                                
                                const navWords = ['home', 'trips', 'about', 'blog', 'faqs', 'contact'];
                                const isNavText = navWords.some(word => linkText === word);

                                if (!isSocial && !isUtility && !isRelated && !isNavUrl && !isNavText) {
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
                      .catch(err => console.error(`Error fetching trip page ${tripUrl}:`, err.message))
                  );
                }
              }
            }
          }
        });
        
        // Wait for all designated trip pages to be fetched
        await Promise.all(tripPromises);
        
        console.log(`Found ${websiteTrips.length} trips on website`);
      } catch (webError) {
        console.error("Website fetch error:", webError);
      }

      // 2. Fetch Google Sheet Data (Trek Database)
      let databaseTreks: any[] = [];
      try {
        const sheetId = "1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8";
        const databaseGid = "1637681821"; // Sheet13
        const databaseUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${databaseGid}`;
        
        const { data: dbCsvData } = await axios.get(databaseUrl, { headers, timeout: 10000 });
        const dbRecords = parse(dbCsvData, {
          columns: false,
          skip_empty_lines: true,
        });

        // Filter out header row and empty rows
        if (dbRecords.length > 1) {
          databaseTreks = dbRecords.slice(1).map((row: string[]) => {
            // Mapping based on user input:
            // Column B (Index 1): Filter for "FD"
            // Trek Name: Column C (Index 2)
            // Region: Column F (Index 5)
            // Month of Interest: Column AD (Index 29)
            // Duration: Column AE (Index 30)
            // Difficulty Grade: Column AF (Index 31)
            
            const statusType = (row[1] || "").trim().toUpperCase();
            if (statusType !== "FD") return null;

            const trekName = (row[2] || "").trim(); 
            const region = (row[5] || "").trim();
            const monthsStr = row[29] || ""; 
            const duration = row[30] || ""; 
            const gradeRaw = row[31] || "";
            
            // Extract numeric grade (e.g. "04" from "04 - Moderate Trek")
            const gradeMatch = gradeRaw.match(/^(\d+)/);
            const grade = gradeMatch ? parseInt(gradeMatch[1]) : 1;
            
            // Parse months string (e.g. "Mar- Apr-May- Sep-Oct-Nov-Dec-Jan-Feb")
            const months = monthsStr
              .split(/[-,\s&]+/)
              .map(m => m.trim())
              .filter(m => m.length >= 3);
            
            return {
              name: trekName,
              region: region,
              grade: grade,
              months,
              duration,
              source: 'database'
            };
          }).filter((t: any) => t !== null && t.name.length > 3);
        }
        console.log(`Fetched ${databaseTreks.length} treks from Database Sheet (Sheet13)`);
      } catch (dbError) {
        console.error("Database Sheet fetch error:", dbError);
      }

      // 3. Keep old sheet fetch for Live Trip status if needed (optional, keeping it simple for now)
      let liveSheetRecords: any[] = [];
      try {
        const sheetId = "1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8";
        const liveGid = "1778692444"; // Original live status sheet
        const liveUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${liveGid}`;
        const { data: liveCsvData } = await axios.get(liveUrl, { headers, timeout: 10000 });
        liveSheetRecords = parse(liveCsvData, { columns: true, skip_empty_lines: true });
      } catch (e) {}

      // 4. Merge & Enhance
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      
      // First, process website trips (Live)
      const mergedTrips: Trip[] = websiteTrips.map((wTrip, index) => {
        // ... (existing matching logic with liveSheetRecords for status)
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

      // Second, add Database-only options (Discovery)
      databaseTreks.forEach((dbTrek, index) => {
        // Skip if already in merged as a live trip
        if (mergedTrips.find(t => normalize(t.name) === normalize(dbTrek.name))) return;

        const knownWebsiteInfo = websiteTrips.find(wt => normalize(wt.name) === normalize(dbTrek.name));

        // Create entries for EACH suitable month
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

      if (mergedTrips.length === 0) {
        console.log("No trips found in web or db");
        return res.json([]);
      }

      res.json(mergedTrips);
    } catch (error) {
      console.error("Final API error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch trip data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
