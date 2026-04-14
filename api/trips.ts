import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from "axios";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Trip {
  id: string;
  name: string;
  grade: Grade;
  date: string;
  month: string;
  status: 'open' | 'closed';
  description?: string;
  price?: string;
  duration?: string;
  websiteUrl: string;
  signUps?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    // 1. Fetch Website Data
    let websiteTrips: any[] = [];
    try {
      const websiteUrl = "https://whitemagicadventure.com/trips";
      const { data: html } = await axios.get(websiteUrl, { headers, timeout: 10000 });
      const $ = cheerio.load(html);
      
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
            
            if (!websiteTrips.find(t => t.name === name && t.date === displayDate)) {
              websiteTrips.push({
                name,
                date: displayDate,
                month: month,
                grade: Math.min(Math.max(grade, 1), 10),
                url: link.startsWith("http") ? link : `https://whitemagicadventure.com${link}`
              });
            }
          }
        }
      });
    } catch (webError) {
      console.error("Website fetch error:", webError);
    }

    // 2. Fetch Google Sheet Data
    let records: any[] = [];
    try {
      const sheetId = "1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8";
      const gid = "1778692444";
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
      
      const { data: csvData } = await axios.get(sheetUrl, { headers, timeout: 10000 });
      records = parse(csvData, {
        columns: true,
        skip_empty_lines: true,
      });
    } catch (sheetError) {
      console.error("Google Sheet fetch error:", sheetError);
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
      const firstPart = dateStr.split("-")[0].trim();
      const parts = firstPart.split(/\s+/);
      
      if (parts.length >= 2) {
        if (/^\d+$/.test(parts[0])) {
          return {
            day: parts[0].trim(),
            month: parts[1].trim().substring(0, 3).toLowerCase()
          };
        } else {
          return {
            day: "1",
            month: parts[0].trim().substring(0, 3).toLowerCase()
          };
        }
      }
      return null;
    };

    const mergedTrips: Trip[] = websiteTrips.map((wTrip, index) => {
      const wDateInfo = parseWebsiteDate(wTrip.date);
      
      const sheetMatch = records.find((r: any) => {
        const tripKey = Object.keys(r).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'trip' || k.toLowerCase().replace(/\s+/g, ' ') === 'trip name');
        const dateKey = Object.keys(r).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'start date');
        
        const nameMatch = tripKey && normalize(r[tripKey] || "") === normalize(wTrip.name);
        const sDateInfo = dateKey ? parseSheetDate(r[dateKey] || "") : null;
        
        let dateMatch = false;
        if (wDateInfo && sDateInfo) {
          dateMatch = parseInt(wDateInfo.day) === parseInt(sDateInfo.day) && wDateInfo.month === sDateInfo.month;
        }
        
        return nameMatch && dateMatch;
      });

      const statusKey = Object.keys(records[0] || {}).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'status');
      const signUpsKey = Object.keys(records[0] || {}).find(k => k.toLowerCase().replace(/\s+/g, ' ') === 'sign ups');
      
      const status = sheetMatch && statusKey && normalize(sheetMatch[statusKey] || "") === "open" ? "open" : "closed";
      const signUps = sheetMatch && signUpsKey ? sheetMatch[signUpsKey] : undefined;

      return {
        id: `trip-${index}`,
        name: wTrip.name,
        grade: (wTrip.grade as Grade) || 1,
        date: wTrip.date,
        month: wTrip.month || "Other",
        status: status as "open" | "closed",
        websiteUrl: wTrip.url,
        description: `Fixed Departure: ${wTrip.date}`,
        signUps: signUps
      };
    });

    res.status(200).json(mergedTrips);
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
