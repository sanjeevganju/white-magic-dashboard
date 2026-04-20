/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Calendar, 
  Mountain, 
  Mail, 
  MessageSquare, 
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Facebook,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MONTHS, GRADES, Trip, Grade } from './types';
import { cn } from './lib/utils';

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<Grade[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTrips = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/trips');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch trips');
      }
      setTrips(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, []);

  const filteredTrips = useMemo(() => {
    return trips.filter(trip => {
      const matchesMonth = selectedMonths.length === 0 || selectedMonths.includes(trip.month);
      const matchesGrade = selectedGrades.length === 0 || selectedGrades.includes(Number(trip.grade) as Grade);
      const matchesSearch = trip.name.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesMonth && matchesGrade && matchesSearch;
    });
  }, [trips, selectedMonths, selectedGrades, searchQuery]);

  const toggleMonth = (month: string) => {
    setSelectedMonths(prev => 
      prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month]
    );
  };

  const toggleGrade = (grade: Grade) => {
    setSelectedGrades(prev => 
      prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]
    );
  };

  const handleWhatsAppShare = (trip: Trip) => {
    let text = `Hi! Check out this Grade ${trip.grade} trip: ${trip.name}. Date: ${trip.date}. Status: ${trip.status.toUpperCase()}. More info: ${trip.websiteUrl}`;
    
    if (trip.fbLinks && trip.fbLinks.length > 0) {
      text += `\n\nPhoto Albums:`;
      trip.fbLinks.forEach((link, i) => {
        text += `\nAlbum ${i + 1}: ${link}`;
      });
    }
    
    if (trip.blogLinks && trip.blogLinks.length > 0) {
      text += `\n\nBlog/Write-ups:`;
      trip.blogLinks.forEach((link, i) => {
        text += `\nBlog ${i + 1}: ${link}`;
      });
    }
    
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const getMailtoUrl = (trip: Trip) => {
    const subject = `Inquiry: ${trip.name} (${trip.date})`;
    const body = `Trip Details:\nName: ${trip.name}\nGrade: ${trip.grade}\nDate: ${trip.date}\nStatus: ${trip.status}\nLink: ${trip.websiteUrl}`;
    return `mailto:info@whitemagicadventure.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="min-h-screen bg-mountain-950 text-mountain-400 selection:bg-mountain-800/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-mountain-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-2.5 bg-gradient-to-br from-mountain-900 to-mountain-800 rounded-2xl border border-mountain-700 shadow-inner">
                <Mountain className="w-7 h-7 text-mountain-500" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight text-mountain-400 leading-none">White Magic Adventure</h1>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-green-500/10 rounded text-[8px] font-bold text-green-600 uppercase tracking-wider border border-green-500/20">
                    <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                    Live
                  </div>
                </div>
                <p className="text-[10px] text-mountain-600 font-bold uppercase tracking-[0.3em] mt-1.5">Sales Dashboard</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-mountain-600 group-focus-within:text-mountain-400 transition-colors" />
                <input 
                  type="text" 
                  placeholder="Search trips..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full md:w-72 bg-mountain-950/50 border border-mountain-800 rounded-2xl py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:border-mountain-700 focus:bg-white transition-all text-mountain-400 placeholder:text-mountain-700"
                />
              </div>
              <button 
                onClick={fetchTrips}
                disabled={loading}
                className="p-2.5 bg-white border border-mountain-800 hover:border-mountain-700 rounded-2xl transition-all disabled:opacity-50 shadow-sm active:scale-95"
              >
                <RefreshCw className={cn("w-5 h-5 text-mountain-600", loading && "animate-spin")} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Filters Section */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-12">
          <div className="lg:col-span-3 space-y-8">
            {/* Month Filter */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-mountain-600" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-mountain-500">Select Months</h2>
                </div>
                {selectedMonths.length > 0 && (
                  <button onClick={() => setSelectedMonths([])} className="text-[10px] uppercase tracking-widest text-mountain-600 hover:underline">Clear</button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {MONTHS.map(month => (
                  <button
                    key={month}
                    onClick={() => toggleMonth(month)}
                    className={cn(
                      "px-5 py-2.5 rounded-2xl text-xs font-bold transition-all border shadow-sm active:scale-95",
                      selectedMonths.includes(month)
                        ? "bg-mountain-400 text-white border-mountain-400 shadow-lg shadow-mountain-400/20" 
                        : "bg-white border-mountain-800 hover:border-mountain-700 text-mountain-500"
                    )}
                  >
                    {month}
                  </button>
                ))}
              </div>
            </section>

            {/* Grade Filter */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-mountain-600" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-mountain-500">Difficulty Grades</h2>
                </div>
                {selectedGrades.length > 0 && (
                  <button onClick={() => setSelectedGrades([])} className="text-[10px] uppercase tracking-widest text-mountain-600 hover:underline">Clear</button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {GRADES.map(grade => (
                  <button
                    key={grade}
                    onClick={() => toggleGrade(grade)}
                    className={cn(
                      "px-5 py-2.5 rounded-2xl text-xs font-bold transition-all border shadow-sm active:scale-95 flex items-center gap-2",
                      selectedGrades.includes(grade)
                        ? "bg-mountain-400 text-white border-mountain-400 shadow-lg shadow-mountain-400/20" 
                        : "bg-white border-mountain-800 hover:border-mountain-700 text-mountain-500"
                    )}
                  >
                    {grade}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Stats/Quick Info */}
          <div className="bg-white border border-mountain-800 rounded-2xl p-8 flex flex-col justify-center shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-mountain-900/50 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110 duration-500" />
            <div className="relative text-center">
              <p className="text-5xl font-black text-mountain-400 mb-2 tracking-tighter">
                {loading ? '...' : filteredTrips.length}
              </p>
              <p className="text-[10px] text-mountain-600 uppercase tracking-[0.2em] font-bold">Total Trips Found</p>
            </div>
            <div className="mt-8 pt-8 border-t border-mountain-900 space-y-5 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-[10px] uppercase tracking-wider font-bold text-mountain-600">Open Status</span>
                </div>
                <span className="text-sm font-black text-green-600">{filteredTrips.filter(t => t.status === 'open').length}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-mountain-400" />
                  <span className="text-[10px] uppercase tracking-wider font-bold text-mountain-600">High Grade (7+)</span>
                </div>
                <span className="text-sm font-black text-mountain-400">{filteredTrips.filter(t => t.grade >= 7).length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trips Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card h-64 animate-pulse bg-mountain-900/20" />
              ))
            ) : (
              filteredTrips.map((trip) => (
                <motion.div
                  key={trip.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white border border-mountain-800 shadow-sm rounded-xl overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="p-4">
                    <div className="mb-3">
                      <h3 className={`text-sm font-bold leading-tight truncate ${trip.status === 'open' ? 'text-green-700' : 'text-mountain-400'}`}>
                        {trip.name} <span className="ml-2 px-2 py-0.5 bg-mountain-900 rounded-full text-[10px] text-mountain-500">Grade {trip.grade}</span>
                      </h3>
                      <div className={`text-xs mt-1.5 font-bold flex items-center gap-2 ${trip.status === 'open' ? 'text-green-600' : 'text-mountain-600'}`}>
                        {trip.date}
                        {trip.signUps && (
                          <span className="px-2 py-0.5 bg-mountain-900 rounded-full text-[10px] text-mountain-500 font-bold">
                            {trip.signUps} Sign-ups
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 pt-3 border-t border-mountain-900/50">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => handleWhatsAppShare(trip)}
                          className="text-green-600 hover:text-green-500 transition-colors flex items-center gap-1.5 text-xs font-bold"
                          title="WhatsApp"
                        >
                          <MessageSquare className="w-4 h-4" />
                          <span>WhatsApp</span>
                        </button>
                        <a 
                          href={getMailtoUrl(trip)}
                          className="text-blue-600 hover:text-blue-500 transition-colors flex items-center gap-1.5 text-xs font-bold"
                          title="Email"
                        >
                          <Mail className="w-4 h-4" />
                          <span>Email</span>
                        </a>
                      </div>

                      <div className="flex items-center gap-2 ml-auto">
                        {trip.fbLinks?.map((link, i) => (
                          <a 
                            key={`fb-${i}`}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-800 hover:text-blue-600 transition-colors p-1 bg-blue-50 rounded border border-blue-100"
                            title={`Photo Album ${i + 1}`}
                          >
                            <Facebook className="w-3.5 h-3.5" />
                          </a>
                        ))}
                        {trip.blogLinks?.map((link, i) => (
                          <a 
                            key={`blog-${i}`}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-800 hover:text-orange-600 transition-colors p-1 bg-orange-50 rounded border border-orange-100"
                            title={`Blog/Write-up ${i + 1}`}
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                          </a>
                        ))}
                        <a 
                          href={trip.websiteUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-mountain-500 hover:text-mountain-700 transition-colors flex items-center gap-1.5 text-xs font-bold ml-2"
                          title="Open in new window"
                        >
                          <ExternalLink className="w-4 h-4" />
                          <span>Link</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {!loading && filteredTrips.length === 0 && (
          <div className="text-center py-20">
            <div className="inline-block p-4 bg-white border border-mountain-800 rounded-full mb-4">
              <Search className="w-8 h-8 text-mountain-700" />
            </div>
            <h3 className="text-xl font-bold text-mountain-400">No trips found</h3>
            <p className="text-sm text-mountain-600">Try adjusting your filters or search query</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-mountain-800 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-3 opacity-50">
              <Mountain className="w-5 h-5 text-mountain-400" />
              <span className="text-sm font-bold tracking-tighter uppercase text-mountain-400">White Magic Adventure</span>
            </div>
            <div className="flex gap-6">
              <a href="#" className="text-xs text-mountain-600 hover:text-mountain-400 transition-colors font-medium uppercase tracking-widest">Privacy Policy</a>
              <a href="#" className="text-xs text-mountain-600 hover:text-mountain-400 transition-colors font-medium uppercase tracking-widest">Terms of Service</a>
              <a href="#" className="text-xs text-mountain-600 hover:text-mountain-400 transition-colors font-medium uppercase tracking-widest">Contact Support</a>
            </div>
          </div>
          <div className="mt-8 text-center text-[10px] text-mountain-600 uppercase tracking-[0.2em] font-medium">
            &copy; 2026 White Magic Adventure. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
