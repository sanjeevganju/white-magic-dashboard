export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Trip {
  id: string;
  name: string;
  grade: Grade;
  date: string; // Specific start date or "Plan for [Month]"
  month: string; // Extracted month for filtering
  region?: string; // e.g. Ladakh, Sikkim, Nepal
  status: 'open' | 'closed';
  description?: string;
  price?: string;
  duration?: string;
  websiteUrl: string;
  signUps?: string;
  fbLinks?: string[];
  blogLinks?: string[];
  isLive: boolean; // True if it's a website departure, false if from database
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export const GRADES: Grade[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
