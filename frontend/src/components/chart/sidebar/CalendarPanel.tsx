// ============================================================================
// CalendarPanel.tsx - Economic events calendar slide-out panel
// Shows upcoming economic events filtered by impact level (high/medium/low),
// grouped by date with sticky headers. Also provides a "Show on Chart" toggle
// that pushes high-impact events to the chart as vertical markers.
// Extracted from ChartLeftSidebar to keep each panel focused.
// ============================================================================

import { Clock, CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getEventImpact } from "@/lib/eventImpact";
import type { EconomicEvent } from "../ChartLeftSidebar";

// Country code to flag emoji mapping for calendar event display
const COUNTRY_TO_FLAG: Record<string, string> = {
  "US": "\u{1F1FA}\u{1F1F8}", "EU": "\u{1F1EA}\u{1F1FA}", "EA": "\u{1F1EA}\u{1F1FA}", "GB": "\u{1F1EC}\u{1F1E7}", "UK": "\u{1F1EC}\u{1F1E7}",
  "JP": "\u{1F1EF}\u{1F1F5}", "CH": "\u{1F1E8}\u{1F1ED}", "AU": "\u{1F1E6}\u{1F1FA}", "CA": "\u{1F1E8}\u{1F1E6}", "NZ": "\u{1F1F3}\u{1F1FF}",
  "CN": "\u{1F1E8}\u{1F1F3}", "DE": "\u{1F1E9}\u{1F1EA}", "FR": "\u{1F1EB}\u{1F1F7}", "Global": "\u{1F30D}",
};

interface CalendarPanelProps {
  calendarEvents: EconomicEvent[];
  calendarLoading: boolean;
  impactFilters: { high: boolean; medium: boolean; low: boolean };
  onImpactFilterChange: (filters: { high: boolean; medium: boolean; low: boolean }) => void;
  showEventsOnChart: boolean;
  onShowEventsOnChartChange?: (show: boolean) => void;
}

// Format event time from UTC to local time for display
function formatEventTime(dateStr: string | null, timeStr: string | null): string {
  if (!timeStr || !dateStr) return "All Day";
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!timeMatch) return timeStr;
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[3]?.toUpperCase();
    if (ampm === 'PM' && hours !== 12) hours += 12;
    else if (ampm === 'AM' && hours === 12) hours = 0;
    const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));
    return utcDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return timeStr;
  }
}

// Format event date as relative label (Today, Tomorrow) or short date
function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const eventDate = new Date(dateStr + 'T12:00:00');
  if (eventDate.toDateString() === today.toDateString()) return "Today";
  if (eventDate.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return eventDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function CalendarPanel({
  calendarEvents,
  calendarLoading,
  impactFilters,
  onImpactFilterChange,
  showEventsOnChart,
  onShowEventsOnChartChange,
}: CalendarPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="px-3 pt-3 pb-2 space-y-2.5 flex-shrink-0">
        {/* Show on Chart Toggle */}
        <button
          onClick={() => onShowEventsOnChartChange?.(!showEventsOnChart)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-all duration-200 cursor-pointer ${showEventsOnChart
            ? 'bg-foreground/[0.06] border-foreground/20'
            : 'bg-muted/10 border-border/20 hover:bg-muted/20 hover:border-border/40'
            }`}
        >
          <span className={`text-[11px] font-medium transition-colors duration-200 ${showEventsOnChart ? 'text-foreground' : 'text-muted-foreground'}`}>
            Show on Chart
          </span>
          <div className={`w-7 h-4 rounded-full relative transition-all duration-200 flex-shrink-0 ${showEventsOnChart ? 'bg-foreground/80' : 'bg-muted-foreground/20'}`}>
            <div className={`absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-200 ${showEventsOnChart ? 'left-[14px]' : 'left-[2px]'}`} />
          </div>
        </button>
        {/* Impact Filter Pills */}
        <div className="flex items-center gap-1.5">
          {([
            { key: 'high' as const, label: 'High', color: '#ef4444', activeBg: 'rgba(239,68,68,0.12)', activeBorder: 'rgba(239,68,68,0.3)' },
            { key: 'medium' as const, label: 'Medium', color: '#f59e0b', activeBg: 'rgba(245,158,11,0.12)', activeBorder: 'rgba(245,158,11,0.3)' },
            { key: 'low' as const, label: 'Low', color: '#10b981', activeBg: 'rgba(16,185,129,0.10)', activeBorder: 'rgba(16,185,129,0.25)' },
          ]).map(({ key, label, color, activeBg, activeBorder }) => (
            <button
              key={key}
              onClick={() => onImpactFilterChange({ ...impactFilters, [key]: !impactFilters[key] })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-semibold transition-all duration-150 cursor-pointer select-none"
              style={impactFilters[key] ? {
                background: activeBg,
                border: `1px solid ${activeBorder}`,
                color: color,
              } : {
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
                opacity: 0.5,
              }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: impactFilters[key] ? color : 'var(--muted-foreground)', opacity: impactFilters[key] ? 1 : 0.3 }} />
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Events List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 pb-3">
          {calendarLoading ? (
            <div className="space-y-2 px-1 pt-1">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: 'var(--muted)', opacity: 0.15 }}>
                  <Skeleton className="h-3.5 w-4/5 mb-2.5 rounded" />
                  <Skeleton className="h-2.5 w-3/5 mb-1.5 rounded" />
                  <Skeleton className="h-2.5 w-2/5 rounded" />
                </div>
              ))}
            </div>
          ) : calendarEvents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground/40">
              <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-15" />
              <p className="text-xs font-medium">No upcoming events</p>
              <p className="text-[10px] mt-1 text-muted-foreground/25">for this pair</p>
            </div>
          ) : (() => {
            // Filter events by selected impact levels, then group by date
            const filtered = calendarEvents.filter((event) => {
              const imp = getEventImpact({ event: event.event || "", country: event.region_code || "" });
              return impactFilters[imp as keyof typeof impactFilters] ?? false;
            });
            const grouped: Record<string, typeof filtered> = {};
            for (const event of filtered) {
              const dateKey = event.date || 'Unknown';
              if (!grouped[dateKey]) grouped[dateKey] = [];
              grouped[dateKey].push(event);
            }
            const dateKeys = Object.keys(grouped);
            if (dateKeys.length === 0) {
              return (
                <div className="text-center py-12 text-muted-foreground/40">
                  <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-15" />
                  <p className="text-xs font-medium">No events match filters</p>
                  <p className="text-[10px] mt-1 text-muted-foreground/25">Try adjusting impact levels</p>
                </div>
              );
            }
            return (
              <div className="space-y-0.5">
                {dateKeys.map((dateKey) => {
                  const events = grouped[dateKey];
                  const dateLabel = formatEventDate(dateKey);
                  const dayOfWeek = (() => { try { return new Date(dateKey + 'T12:00:00').toLocaleDateString([], { weekday: 'short' }); } catch { return ''; } })();
                  const isPastDate = (() => { const now = new Date(); const d = new Date(dateKey + 'T23:59:59'); return d < now; })();
                  return (
                    <div key={dateKey}>
                      <div className={`sticky top-0 z-10 flex items-center gap-2 px-2 py-1.5 mb-0.5 ${isPastDate ? 'opacity-50' : ''}`} style={{ background: 'var(--card)' }}>
                        <div className="h-px flex-1" style={{ background: 'var(--border)', opacity: 0.4 }} />
                        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 flex-shrink-0">{dayOfWeek} {dateLabel}</span>
                        <div className="h-px flex-1" style={{ background: 'var(--border)', opacity: 0.4 }} />
                      </div>
                      <div className="space-y-1 mb-1">
                        {events.map((event, idx) => {
                          const impact = getEventImpact({ event: event.event || "", country: event.region_code || "" });
                          const flag = COUNTRY_TO_FLAG[(event.region_code || "").toUpperCase()] || '';
                          const isPast = (() => { if (!event.date) return false; const now = new Date(); const eventD = new Date(event.date + 'T' + (event.time || '23:59')); return eventD < now; })();
                          const impactColor = impact === 'high' ? '#ef4444' : impact === 'medium' ? '#f59e0b' : '#10b981';
                          return (
                            <div key={`${dateKey}-${idx}`} className={`group relative rounded-lg transition-all duration-150 ${isPast ? 'opacity-35' : 'hover:bg-muted/[0.06]'}`} style={{ border: '1px solid transparent', borderColor: impact === 'high' && !isPast ? 'rgba(239,68,68,0.08)' : 'transparent' }}>
                              <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ backgroundColor: impactColor, opacity: impact === 'high' ? 0.7 : impact === 'medium' ? 0.5 : 0.3 }} />
                              <div className="pl-3 pr-2.5 py-2">
                                <div className="flex items-start justify-between gap-1.5">
                                  <Link to="/calendar" className="text-[11px] font-medium leading-[1.35] line-clamp-2 text-foreground/90 hover:text-foreground transition-colors flex-1 min-w-0">{event.event}</Link>
                                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                                    <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ backgroundColor: impactColor }} />
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  {flag && <span className="text-[10px] leading-none">{flag}</span>}
                                  <span className="text-[9px] font-mono text-muted-foreground/60 uppercase font-medium">{(event.region_code || "").toUpperCase()}</span>
                                  <span className="text-muted-foreground/20">&middot;</span>
                                  <span className="text-[9px] text-muted-foreground/50 flex items-center gap-0.5">
                                    <Clock className="h-2.5 w-2.5 opacity-60" />
                                    {formatEventTime(event.date, event.time)}
                                  </span>
                                </div>
                                {(event.actual || event.previous) && (
                                  <div className="flex items-center gap-3 mt-2 pt-1.5" style={{ borderTop: '1px solid var(--border)', borderTopColor: 'rgba(128,128,128,0.08)' }}>
                                    {event.actual && (<div className="flex flex-col"><span className="text-[7px] font-semibold uppercase tracking-[0.05em] text-muted-foreground/40 mb-0.5">ACT</span><span className="text-[11px] font-mono font-semibold text-foreground leading-none">{event.actual}</span></div>)}
                                    {event.previous && (<div className="flex flex-col"><span className="text-[7px] font-semibold uppercase tracking-[0.05em] text-muted-foreground/40 mb-0.5">PREV</span><span className="text-[11px] font-mono text-muted-foreground/60 leading-none">{event.previous}</span></div>)}
                                    {event.forecast && (<div className="flex flex-col"><span className="text-[7px] font-semibold uppercase tracking-[0.05em] text-muted-foreground/40 mb-0.5">FCST</span><span className="text-[11px] font-mono text-muted-foreground/50 leading-none">{event.forecast}</span></div>)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </ScrollArea>
    </div>
  );
}
