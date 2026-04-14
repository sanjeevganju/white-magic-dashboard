export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Trip {
  id: string;
  name: string;
  grade: Grade;
  date: string; // Specific start date from website
  month: string; // Extracted month for filtering
  status: 'open' | 'closed';
  description?: string;
  price?: string;
  duration?: string;
  websiteUrl: string;
  signUps?: string;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export const GRADES: Grade[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
