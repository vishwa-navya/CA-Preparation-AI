import React, { useState, useEffect, useMemo, useRef, Component, ReactNode } from 'react';
import { X, ChevronLeft, MessageCircle, Heart, AlertCircle } from 'lucide-react';
import { collection, query, where, orderBy, getDocs, Timestamp, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import SmartNotification from '../SmartNotification';
import RobotCloudChat3 from '../RobotCloudChat3';
import VoiceMessageInline from '../VoiceMessageInline';
import type { MemoriesNotificationState } from '../../hooks/useMemoriesNotification';

class MessageErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <div className="text-center py-4 text-red-400 text-sm">Failed to render message</div>;
    }
    return this.props.children;
  }
}

interface ChatHistoryPageProps {
  nickname: 'Vishwa' | 'Ammu';
  memoriesNotif: MemoriesNotificationState;
  onExit: () => void;
}

type ViewLevel = 'months' | 'dates' | 'messages';

interface MessageData {
  id: string;
  by: string;
  text: string;
  type: string;
  ts: any;
  imageUrl?: string;
  videoUrl?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  replyTo?: { id: string; text: string; by: string } | null;
  seenBy?: string[];
}

// ── Chat history range ───────────────────────────────────────────────────────
// History starts in July 2025 and always runs up to YESTERDAY. Nothing needs to
// be edited as time passes: months and days appear by themselves, and a day is
// added to the history as soon as it is over (right after midnight).
const HISTORY_START = { year: 2025, month: 7 }; // July 2025 (month is 1-12)
// Set to true if you also want today's messages inside Chat History.
const INCLUDE_TODAY = false;

interface MonthOption {
  label: string;
  value: string; // 'YYYY-MM'
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

// The most recent day that is allowed to appear in the history.
function getLastVisibleDay(now: Date): Date {
  const today = startOfDay(now);
  if (INCLUDE_TODAY) return today;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
}

// Every month from HISTORY_START up to the month of the last visible day.
function buildMonths(lastDay: Date): MonthOption[] {
  const months: MonthOption[] = [];
  let year = HISTORY_START.year;
  let month = HISTORY_START.month;
  const lastYear = lastDay.getFullYear();
  const lastMonth = lastDay.getMonth() + 1;
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push({
      label: new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      value: `${year}-${String(month).padStart(2, '0')}`,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Returns a value that changes when the calendar day changes, so the history
// refreshes by itself — at midnight, or when the app is reopened the next day.
function useDayKey(): string {
  const [dayKey, setDayKey] = useState(() => getDayKey(new Date()));

  useEffect(() => {
    let timer: number | undefined;

    const refresh = () => {
      const next = getDayKey(new Date());
      setDayKey((prev) => (prev === next ? prev : next));
    };

    const scheduleMidnightRefresh = () => {
      const now = new Date();
      // 5 seconds after midnight, to be safely on the new day
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0);
      timer = window.setTimeout(() => {
        refresh();
        scheduleMidnightRefresh();
      }, nextMidnight.getTime() - now.getTime());
    };

    // Phones pause timers while the app is in the background, so also re-check
    // whenever the app comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    scheduleMidnightRefresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return dayKey;
}

function getDaysInMonth(monthValue: string): number {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function tsToDate(ts: any): Date | null {
  if (!ts) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts);
  } catch {
    // ignore
  }
  return null;
}

function ChatHistoryPage({ nickname, memoriesNotif, onExit }: ChatHistoryPageProps) {
  const [currentView, setCurrentView] = useState<ViewLevel>('months');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [datesLoading, setDatesLoading] = useState(false);
  const [monthsWithMessages, setMonthsWithMessages] = useState<Set<string>>(new Set());
  const [datesWithMessages, setDatesWithMessages] = useState<Set<number>>(new Set());
  const [initLoading, setInitLoading] = useState(true);
  const hasLoadedMonthsRef = useRef(false);

  // Changes at midnight, which re-runs the month/day checks below automatically.
  const dayKey = useDayKey();
  const lastDay = useMemo(() => getLastVisibleDay(new Date()), [dayKey]);
  const lastDayEnd = useMemo(() => endOfDay(lastDay), [lastDay]);
  const months = useMemo(() => buildMonths(lastDay), [lastDay]);

  // Read-only presence for the other user — no writing, no heartbeat, no conflict with Chat2



  // Ensure skip-logout flag is set on mount (the onClick already sets it,
  // but this is a belt-and-suspenders backup for the flag)
  useEffect(() => {
    (window as any).__AMMU_SKIP_LOGOUT__?.start();
    // Do NOT call stop() on cleanup — the parent onExit callback handles that
    // so the flag stays active until the user explicitly closes Chat History.
  }, []);

  // Detect months that have at least one message — all queries fire in parallel.
  // Only finished days count: the last month is cut off at yesterday.
  useEffect(() => {
    const checkMonths = async () => {
      // Show the spinner only the first time; later refreshes (new day) are silent
      if (!hasLoadedMonthsRef.current) setInitLoading(true);
      try {
        const results = await Promise.all(
          months.map(async (month) => {
            const [year, mon] = month.value.split('-').map(Number);
            const start = new Date(year, mon - 1, 1, 0, 0, 0, 0);
            const monthEnd = new Date(year, mon, 0, 23, 59, 59, 999);
            const end = monthEnd.getTime() > lastDayEnd.getTime() ? lastDayEnd : monthEnd;
            const q = query(
              collection(db, 'privateMessages'),
              where('ts', '>=', Timestamp.fromDate(start)),
              where('ts', '<=', Timestamp.fromDate(end)),
              orderBy('ts', 'asc'),
              limit(1)
            );
            try {
              const snap = await getDocs(q);
              return snap.empty ? null : month.value;
            } catch {
              return null;
            }
          })
        );
        setMonthsWithMessages(new Set(results.filter(Boolean) as string[]));
        hasLoadedMonthsRef.current = true;
      } catch (err) {
        console.error('ChatHistory: months check error:', err);
      } finally {
        setInitLoading(false);
      }
    };
    checkMonths();
  }, [months, lastDayEnd]);

  // Detect which dates in the selected month have messages.
  // Uses parallel per-day limit(1) queries — same pattern as month detection.
  // Avoids fetching all month messages (which caused the ~1 min loading time).
  useEffect(() => {
    if (!selectedMonth) return;
    setDatesWithMessages(new Set());
    const checkDates = async () => {
      setDatesLoading(true);
      try {
        const [year, mon] = selectedMonth.split('-').map(Number);
        const daysInMonth = new Date(year, mon, 0).getDate();
        // Never look past the last visible day (yesterday): saves reads and keeps today out
        const lastDayInMonth =
          year === lastDay.getFullYear() && mon - 1 === lastDay.getMonth()
            ? lastDay.getDate()
            : daysInMonth;
        const daysToCheck = Math.min(daysInMonth, lastDayInMonth);
        const results = await Promise.all(
          Array.from({ length: daysToCheck }, (_, i) => i + 1).map(async (day) => {
            const start = new Date(year, mon - 1, day, 0, 0, 0, 0);
            const end   = new Date(year, mon - 1, day, 23, 59, 59, 999);
            const q = query(
              collection(db, 'privateMessages'),
              where('ts', '>=', Timestamp.fromDate(start)),
              where('ts', '<=', Timestamp.fromDate(end)),
              orderBy('ts', 'asc'),
              limit(1)
            );
            try {
              const snap = await getDocs(q);
              return snap.empty ? null : day;
            } catch {
              return null;
            }
          })
        );
        setDatesWithMessages(new Set(results.filter(Boolean) as number[]));
      } catch (err) {
        console.error('ChatHistory: dates check error:', err);
      } finally {
        setDatesLoading(false);
      }
    };
    checkDates();
  }, [selectedMonth, lastDay]);

  // Fetch ALL messages for a specific date
  // NOTE: No deletedFor filter here — Chat History shows the full historical record
  // regardless of whether the user "cleared" the chat via the dustbin button.
  useEffect(() => {
    if (!selectedMonth || selectedDate === null) return;
    const fetchMessages = async () => {
      setLoading(true);
      try {
        const [year, mon] = selectedMonth.split('-').map(Number);
        const start = new Date(year, mon - 1, selectedDate, 0, 0, 0, 0);
        const end = new Date(year, mon - 1, selectedDate, 23, 59, 59, 999);
        const q = query(
          collection(db, 'privateMessages'),
          where('ts', '>=', Timestamp.fromDate(start)),
          where('ts', '<=', Timestamp.fromDate(end)),
          orderBy('ts', 'asc')
        );
        const snap = await getDocs(q);
        const msgs: MessageData[] = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as MessageData))
          .filter(msg => !!msg.by && msg.type !== 'system');
        setMessages(msgs);
      } catch (err) {
        console.error('ChatHistory: fetch messages error:', err);
        setMessages([]);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, [selectedMonth, selectedDate]);

  const handleMonthClick = (monthValue: string) => {
    setSelectedMonth(monthValue);
    setCurrentView('dates');
  };

  const handleDateClick = (date: number) => {
    setSelectedDate(date);
    setCurrentView('messages');
  };

  const handleBack = () => {
    if (currentView === 'messages') {
      setSelectedDate(null);
      setCurrentView('dates');
    } else if (currentView === 'dates') {
      setSelectedMonth(null);
      setCurrentView('months');
    }
  };

  const formatTime = (ts: any) => {
    const date = tsToDate(ts);
    if (!date) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const ordinal = (n: number) =>
    n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

  const selectedMonthLabel = months.find(m => m.value === selectedMonth)?.label ?? '';

  const getHeaderTitle = () => {
    if (currentView === 'months') return 'Chat History';
    if (currentView === 'dates') return selectedMonthLabel;
    return `${ordinal(selectedDate!)} ${selectedMonthLabel}`;
  };

  // ── Month grid ──────────────────────────────────────────────────────────────
  const renderMonthsView = () => (
    <div className="flex-1 overflow-y-auto p-5">
      {initLoading ? (
        <div className="text-center py-16 flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
          <p className="text-white/80 text-sm">Loading chat history...</p>
        </div>
      ) : (
        <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
          {months.map((month) => {
            const has = monthsWithMessages.has(month.value);
            return (
              <button
                key={month.value}
                onClick={() => has && handleMonthClick(month.value)}
                disabled={!has}
                className={`p-4 rounded-2xl shadow transition-all ${
                  has
                    ? 'bg-white/90 text-gray-800 hover:bg-white hover:scale-[1.03] active:scale-95'
                    : 'bg-white/15 text-white/40 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <MessageCircle className={`w-4 h-4 flex-shrink-0 ${has ? 'text-teal-500' : 'text-white/30'}`} />
                  <span className="font-semibold text-sm">{month.label}</span>
                </div>
                {!has && <div className="text-[11px] mt-1 opacity-60">No chats</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Calendar ────────────────────────────────────────────────────────────────
  const renderDatesView = () => {
    if (!selectedMonth) return null;
    const daysInMonth = getDaysInMonth(selectedMonth);
    const [year, mon] = selectedMonth.split('-').map(Number);
    const firstDayOfWeek = new Date(year, mon - 1, 1).getDay();
    const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-sm mx-auto">
          <div className="text-center text-white font-bold text-lg mb-5">{selectedMonthLabel}</div>

          {datesLoading ? (
            <div className="text-center py-14 flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
              <p className="text-white/80 text-sm">Finding your chats...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {weekdays.map(d => (
                  <div key={d} className="text-center text-white/60 text-xs font-medium py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <div key={`e-${i}`} className="aspect-square" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const date = i + 1;
                  const has = datesWithMessages.has(date);
                  const today = new Date();
                  const isToday = today.getFullYear() === year && today.getMonth() === mon - 1 && today.getDate() === date;
                  return (
                    <button
                      key={date}
                      onClick={() => has && handleDateClick(date)}
                      disabled={!has}
                      className={`aspect-square rounded-xl flex items-center justify-center text-sm font-semibold transition-all ${
                        has
                          ? 'bg-white text-gray-800 hover:bg-teal-100 hover:scale-105 active:scale-95 shadow'
                          : 'bg-white/15 text-white/35 cursor-not-allowed'
                      } ${isToday ? 'ring-2 ring-yellow-400' : ''}`}
                    >
                      {date}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ── Message list ────────────────────────────────────────────────────────────
  const renderMessagesView = () => (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center text-white/70 text-xs font-medium mb-4 uppercase tracking-wide">
          {ordinal(selectedDate!)} {selectedMonthLabel}
        </div>

        {loading ? (
          <div className="text-center py-12 flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
            <p className="text-white/80 text-sm">Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-white/70 italic">No messages found</p>
          </div>
        ) : (
          <div className="space-y-1 pb-8">
            {messages.map((msg) => {
              const isOwn = msg.by === nickname;
              const isAudio =
                (msg.mimeType?.startsWith('audio/')) ||
                /\.(webm|mp3|m4a|ogg|wav)$/i.test(msg.fileUrl ?? '') ||
                /\.(webm|mp3|m4a|ogg|wav)$/i.test(msg.fileName ?? '') ||
                msg.type === 'audio';

              if (isAudio && msg.fileUrl) {
                const profileSrc = !isOwn
                  ? (nickname === 'Vishwa'
                    ? 'https://i.postimg.cc/SRGbptyj/Whats-App-Image-2025-08-15-at-22-32-21-9e7fdfe7.jpg'
                    : 'https://i.postimg.cc/wTrF15j3/Whats-App-Image-2025-08-14-at-22-29-55-ed72594e.jpg')
                  : null;
                return (
                  <MessageErrorBoundary key={msg.id}>
                    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
                      <div className="flex items-end gap-2 max-w-[80vw] sm:max-w-[300px]">
                        {profileSrc && (
                          <img src={profileSrc} alt="" className="w-8 h-8 rounded-full object-cover mb-1 flex-shrink-0" />
                        )}
                        <div className={`px-3 py-2 rounded-2xl shadow-md ${isOwn ? 'bg-[#2F4F6F]' : 'bg-[#FFD87A]'}`}>
                          <VoiceMessageInline src={msg.fileUrl} accent="chat3" />
                          <div className={`text-[10px] mt-1 text-right ${isOwn ? 'text-gray-300' : 'text-gray-600'}`}>
                            {formatTime(msg.ts)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </MessageErrorBoundary>
                );
              }

              return (
                <MessageErrorBoundary key={msg.id}>
                  <RobotCloudChat3
                    messageId={msg.id}
                    text={msg.text || ''}
                    imageUrl={msg.imageUrl}
                    videoUrl={msg.videoUrl}
                    fileUrl={msg.fileUrl}
                    fileName={msg.fileName}
                    mimeType={msg.mimeType}
                    isOwn={isOwn}
                    isUser={isOwn}
                    isAI={false}
                    type={msg.type || 'text'}
                    currentUserNickname={nickname}
                    timestamp={formatTime(msg.ts)}
                    useBlackText={false}
                    replyTo={msg.replyTo}
                    msg={msg}
                  />
                </MessageErrorBoundary>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364]">
      {/* Subtle overlay pattern */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, #ffffff22 0%, transparent 60%), radial-gradient(circle at 80% 20%, #ffffff11 0%, transparent 50%)',
        }}
      />

      {/* Header */}
      <div className="relative z-10 bg-white/10 backdrop-blur-md px-4 py-4 border-b border-white/20 shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-shrink-0">
            {currentView !== 'months' ? (
              <button
                onClick={handleBack}
                className="p-2 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <Heart className="w-5 h-5 text-rose-400 fill-rose-400" />
            )}
            <h1 className="text-base font-bold text-white leading-tight">{getHeaderTitle()}</h1>
          </div>

          {/* Smart Notification — replaces "last seen" text */}
          <div className="flex-1 flex justify-end">
            <SmartNotification
              isOtherOnline={memoriesNotif.isOtherOnline}
              unreadCount={memoriesNotif.unreadCount}
              latestUnread={memoriesNotif.latestUnread}
              otherUserDp={memoriesNotif.otherUserDp}
              otherUserName={memoriesNotif.otherUserName}
              theme="dark"
            />
          </div>

          <button
            onClick={onExit}
            className="p-2 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-hidden flex flex-col">
        {currentView === 'months' && renderMonthsView()}
        {currentView === 'dates' && renderDatesView()}
        {currentView === 'messages' && renderMessagesView()}
      </div>
    </div>
  );
}

export default ChatHistoryPage;
