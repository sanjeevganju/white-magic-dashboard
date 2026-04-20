import express from "express";
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
        const { data: html } = await axios.get(websiteUrl, { headers, timeout: 10000 });
        console.log(`Website HTML fetched, length: ${html.length}`);
        const $ = cheerio.load(html);
        
        // The user mentioned "date in front of them". 
        // Let's look for elements that might contain dates and trip names.
        // We'll look for any element that contains a month name and a year.
        const monthRegex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i;
        const dayMonthRegex = /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

        // Find all trip containers
        const tripPromises: Promise<any>[] = [];
        
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
            const dateRegex = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{4})?)/gi;
            const dates = containerText.match(dateRegex);
            
            if (dates && dates.length > 0) {
              const startDateText = dates[0];
              const yearMatch = containerText.match(/\b20\d{2}\b/);
              const year = yearMatch ? yearMatch[0] : "2026";
              
              let displayDate = dates.length > 1 ? `${dates[0]} - ${dates[dates.length-1]}` : dates[0];
              if (!displayDate.includes(year)) displayDate += ` ${year}`;
              
              // Extract Grade
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

              // Standardize Month
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
                  grade: Math.min(Math.max(grade, 1), 10),
                  url: tripUrl,
                  fbLinks: [] as string[],
                  blogLinks: [] as string[]
                };
                websiteTrips.push(tripData);
                
                // Fetch individual trip page for FB and Blog links
                tripPromises.push(
                  axios.get(tripUrl, { headers, timeout: 5000 })
                    .then(({ data: tripHtml }) => {
                      const $trip = cheerio.load(tripHtml);
                      
                      // Find Photo Albums and Blogs strictly from the text section
                      $trip("p, strong, b, span, h3").each((_, el) => {
                        const $el = $trip(el);
                        // Prevent searching if this element contains too much markup (it's likely a container)
                        if ($el.children('div, section, article, nav').length > 0) return;

                        const text = $el.text().trim();
                        if (!text) return;
                        
                        // Check for Photo/Facebook Albums header
                        if (/Photo\s+Albums\s*-/i.test(text) && tripData.fbLinks.length === 0) {
                          let $next = $el.closest('div, p, h3');
                          let foundCount = 0;
                          
                          for (let j = 0; j < 5; j++) {
                            if (!$next.length) break;
                            if (j > 0 && /(Blogs|Featured\s+news\s+articles)\s*-/i.test($next.text())) break;
                            
                            $next.find("a").each((_, a) => {
                              const $a = $trip(a);
                              let href = $a.attr("href")?.trim();
                              if (href && href.includes("facebook.com")) {
                                let absoluteHref = normalizeUrl(href);
                                absoluteHref = cleanFacebookUrl(absoluteHref);
                                if (!tripData.fbLinks.includes(absoluteHref) && foundCount < 2) {
                                  tripData.fbLinks.push(absoluteHref);
                                  foundCount++;
                                }
                              }
                            });
                            if (foundCount >= 2) break;
                            $next = $next.next();
                          }
                        }
                        
                        // Check for Featured news articles header
                        if (/Featured\s+news\s+articles\s*-/i.test(text)) {
                          let $container = $el.closest('div, p, h3');
                          let foundCount = 0;
                          
                          let $current = $container;
                          for (let j = 0; j < 5; j++) {
                            if (!$current || !$current.length) break;
                            if (j > 0 && /(Blogs|Photo\s+Albums|Video|Itinerary|Cost\s+Details|What\s+to\s+expect|Photo\s+gallery)\s*-/i.test($current.text())) break;

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
                        if (/^Blogs\s*-/i.test(text)) {
                          let $container = $el.closest('div, p, h3');
                          let foundCount = 0;
                          
                          let $current = $container;
                          for (let j = 0; j < 5; j++) {
                            if (!$current || !$current.length) break;
                            if (j > 0 && /(Featured\s+news\s+articles|Photo\s+Albums|Video|Itinerary|Cost\s+Details|What\s+to\s+expect|Photo\s+gallery)\s*-/i.test($current.text())) break;

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
        });
        
        // Wait for all trip pages to be fetched (with a timeout or limit if needed)
        // For now, let's just wait for all of them but limit to first 20 to avoid timeout
        await Promise.all(tripPromises.slice(0, 20));
        
        console.log(`Found ${websiteTrips.length} trips on website`);
      } catch (webError) {
        console.error("Website fetch error:", webError);
      }

      // 2. Fetch Google Sheet Data
      let records: any[] = [];
      try {
        // Alternative export URL that is sometimes more reliable
        const sheetId = "1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8";
        const gid = "1778692444";
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
        
        const { data: csvData } = await axios.get(sheetUrl, { headers, timeout: 10000 });
        records = parse(csvData, {
          columns: true,
          skip_empty_lines: true,
        });
        console.log(`Fetched ${records.length} records from Google Sheet`);
      } catch (sheetError) {
        console.error("Google Sheet fetch error:", sheetError);
        // Try the original URL as fallback
        try {
          const fallbackUrl = "https://docs.google.com/spreadsheets/d/1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WKFZnv51aVwWK8/export?format=csv&gid=1778692444";
          const { data: csvData } = await axios.get(fallbackUrl, { headers, timeout: 10000 });
          records = parse(csvData, { columns: true, skip_empty_lines: true });
        } catch (e) {
          console.error("Fallback sheet fetch also failed");
        }
      }

      // 3. Merge Data
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      
      const parseSheetDate = (dateStr: string) => {
        // Expected format: 12-Jun-2026
        const parts = dateStr.split("-");
        if (parts.length >= 2) {
          return {
            day: parts[0].trim(),
            month: parts[1].trim().substring(0, 3).toLowerCase()
          };
        }
        return null;
      };

      const parseWebsiteDate = (dateStr: string) => {
        // Expected format: 12 Jun - 29 Jun 2026 or Jun 2026
        const firstPart = dateStr.split("-")[0].trim(); // "12 Jun" or "Jun 2026"
        const parts = firstPart.split(/\s+/);
        
        if (parts.length >= 2) {
          // Check if the first part is a number (day)
          if (/^\d+$/.test(parts[0])) {
            return {
              day: parts[0].trim(),
              month: parts[1].trim().substring(0, 3).toLowerCase()
            };
          } else {
            // Format might be "Jun 2026"
            return {
              day: "1", // Default to 1 if no day found
              month: parts[0].trim().substring(0, 3).toLowerCase()
            };
          }
        }
        return null;
      };

      const mergedTrips: Trip[] = websiteTrips.map((wTrip, index) => {
        const wDateInfo = parseWebsiteDate(wTrip.date);
        
        const sheetMatch = records.find((r: any) => {
          // Find the right keys (case-insensitive, handles multiple spaces)
          const tripKey = Object.keys(r).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'trip' || k.toLowerCase().replace(/\s+/g, ' ') === 'trip name');
          const dateKey = Object.keys(r).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'start date');
          
          const nameMatch = tripKey && normalize(r[tripKey] || "") === normalize(wTrip.name);
          const sDateInfo = dateKey ? parseSheetDate(r[dateKey] || "") : null;
          
          let dateMatch = false;
          if (wDateInfo && sDateInfo) {
            // Compare day and month
            dateMatch = parseInt(wDateInfo.day) === parseInt(sDateInfo.day) && wDateInfo.month === sDateInfo.month;
          }
          
          return nameMatch && dateMatch;
        });

        const statusKey = Object.keys(records[0] || {}).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'status');
        const signUpsKey = Object.keys(records[0] || {}).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'sign ups');
        
        // Look for FB and Blog links in the sheet
        const fb1Key = Object.keys(records[0] || {}).find(k => k.toLowerCase().includes('fb1') || k.toLowerCase().includes('facebook 1'));
        const fb2Key = Object.keys(records[0] || {}).find(k => k.toLowerCase().includes('fb2') || k.toLowerCase().includes('facebook 2'));
        const blog1Key = Object.keys(records[0] || {}).find(k => k.toLowerCase().includes('blog 1') || k.toLowerCase().includes('write up 1'));
        const blog2Key = Object.keys(records[0] || {}).find(k => k.toLowerCase().includes('blog 2') || k.toLowerCase().includes('write up 2'));

        const status = sheetMatch && statusKey && normalize(sheetMatch[statusKey] || "") === "open" ? "open" : "closed";
        const signUps = sheetMatch && signUpsKey ? sheetMatch[signUpsKey] : undefined;

        const fbLinks = [...(wTrip.fbLinks || [])];
        if (sheetMatch) {
          if (fb1Key && sheetMatch[fb1Key]) {
            const cleaned = cleanFacebookUrl(normalizeUrl(sheetMatch[fb1Key]));
            if (!fbLinks.includes(cleaned)) fbLinks.push(cleaned);
          }
          if (fb2Key && sheetMatch[fb2Key]) {
            const cleaned = cleanFacebookUrl(normalizeUrl(sheetMatch[fb2Key]));
            if (!fbLinks.includes(cleaned)) fbLinks.push(cleaned);
          }
        }

        const blogLinks = [...(wTrip.blogLinks || [])];
        if (sheetMatch) {
          if (blog1Key && sheetMatch[blog1Key] && !blogLinks.includes(sheetMatch[blog1Key])) blogLinks.push(sheetMatch[blog1Key]);
          if (blog2Key && sheetMatch[blog2Key] && !blogLinks.includes(sheetMatch[blog2Key])) blogLinks.push(sheetMatch[blog2Key]);
        }

        return {
          id: `trip-${index}`,
          name: wTrip.name,
          grade: (wTrip.grade as Grade) || 1,
          date: wTrip.date,
          month: wTrip.month || "Other",
          status: status as "open" | "closed",
          websiteUrl: wTrip.url,
          description: `Fixed Departure: ${wTrip.date}`,
          signUps: signUps,
          fbLinks: fbLinks.length > 0 ? fbLinks.slice(0, 2) : undefined,
          blogLinks: blogLinks.length > 0 ? blogLinks.slice(0, 5) : undefined
        };
      });

      if (mergedTrips.length === 0 && websiteTrips.length === 0) {
        console.log("No trips found on website");
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
