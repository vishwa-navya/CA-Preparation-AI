// src/App.tsx
import React, { useState, useEffect, Component, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import Chat1 from './pages/Chat1';
import Chat2 from './pages/Chat2';
import Chat3 from './pages/Chat3';
import MemoryPage from './components/MemoryPage';
import { requestFCMToken, onForegroundMessage } from './firebase';
import { useSafetyToggle } from './hooks/useSafetyToggle';
import { resetCameraState } from './hooks/useCameraState';

// Server URLs
const SIGNALING_SERVER = 'https://camera-sharing-server.onrender.com';

type Page = 'login' | 'chat1' | 'chat2' | 'chat3' | 'memory';
type Nickname = 'Vishwa' | 'Ammu' | string;

/**
 * Wake up the signaling server (important for Render cold start)
 * Called immediately when app loads
 */
async function wakeUpServer() {
  try {
    console.log('🌅 Warming up signaling server...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${SIGNALING_SERVER}/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wake: true, ts: Date.now() }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log('✅ Signaling server is awake');
    }
  } catch (err: any) {
    // Server might be waking up, that's okay
    console.log('⚠️ Wake-up request sent (server may be starting)');
  }
}

// Global error boundary to prevent white screen crashes
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  state = { hasError: false, error: undefined };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-900 to-red-700 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-4 text-sm">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 text-white rounded-full font-medium hover:bg-red-600 transition"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Safe FCM initializer — defensive so it won't crash at runtime
 */
async function initializeFCM() {
  try {
    console.log('🔔 Initializing Firebase Cloud Messaging...');
    if (typeof requestFCMToken === 'function') {
      await requestFCMToken();
    } else {
      console.warn('requestFCMToken is not available/exported from ./firebase');
    }

    if (typeof onForegroundMessage === 'function') {
      try {
        onForegroundMessage(() => {
          console.log('📨 Foreground message received');
        });
      } catch (err) {
        console.warn('onForegroundMessage threw:', err);
      }
    } else {
      console.warn('onForegroundMessage is not available/exported from ./firebase');
    }

    console.log('✅ FCM initialization attempt finished');
  } catch (error) {
    console.error('❌ FCM initialization failed:', error);
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [nickname, setNickname] = useState<Nickname>('');
  const [inputNickname, setInputNickname] = useState('');
  const { isSafe, toggleSafety, loading: safetyLoading } = useSafetyToggle();

  // 🔔 Setup Notifications (safe)
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        await initializeFCM();
      } catch (err) {
        console.error('Notification setup failed (caught):', err);
      }
    };
    setupNotifications();
  }, []);

  // 🌅 WAKE UP SERVER on app load (critical for Render cold start)
  useEffect(() => {
    wakeUpServer();
    // Also wake up periodically to prevent cold start during use
    const wakeInterval = setInterval(wakeUpServer, 10 * 60 * 1000); // Every 10 minutes
    return () => clearInterval(wakeInterval);
  }, []);

  // 📨 Handle Notification Click (returns to login)
  useEffect(() => {
    const handleNotificationClick = () => {
      setCurrentPage('login');
      setNickname('');
      setInputNickname('');
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', handleNotificationClick);
      return () => {
        if (navigator.serviceWorker.removeEventListener) {
          navigator.serviceWorker.removeEventListener('message', handleNotificationClick);
        }
      };
    }
    // fallback: no service worker available — nothing to do
  }, []);

  // 🔐 Handle Login — manual name entry ALWAYS goes to Chat1.
  // The only way to reach Chat2 is by clicking a smiley emoji.
  // On manual login, auto-switch to pin (locked) so the smileys
  // are blocked until the user manually toggles back to pencil.
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNickname = inputNickname.trim().toLowerCase();

    // Auto-switch stethoscope → injection if currently safe (ON)
    if (isSafe && !safetyLoading) {
      toggleSafety();
    }

    // ALL manual name entries go to Chat1, including "Vishwa" / "Ammu"
    if (trimmedNickname === 'vishwa') {
      setNickname('Vishwa');
    } else if (trimmedNickname === 'ammu') {
      setNickname('Ammu');
    } else {
      setNickname(inputNickname.trim());
    }
    setCurrentPage('chat1');
  };

  // Quick login buttons (smileys) — auto-switch pencil → pin
  // immediately after clicking a smiley, for extra safety. This blocks
  // the other smiley until someone manually toggles back to pencil.
  const loginAsVishwa = () => {
    if (!isSafe) return; // blocked
    setNickname('Vishwa');
    setCurrentPage('chat2');
    if (!safetyLoading) toggleSafety();
  };

  const loginAsAmmu = () => {
    if (!isSafe) return; // blocked
    setNickname('Ammu');
    setCurrentPage('chat2');
    if (!safetyLoading) toggleSafety();
  };

  const handleLogout = () => {
    if (nickname) {
      try {
        resetCameraState(nickname);
      } catch (err) {
        console.warn('resetCameraState failed:', err);
      }
    }
    setCurrentPage('login');
    setNickname('');
    setInputNickname('');
  };

  const handleSwitchToAIChat = () => setCurrentPage('chat1');
  const handleSwitchToChat2 = () => setCurrentPage('chat2');
  const handleSwitchToChat3 = () => setCurrentPage('chat3');
  const handleOpenMemory = () => setCurrentPage('memory');

  // 🧭 LOGIN PAGE — CA study desk composition
  if (currentPage === 'login') {
    return (
      <div
        className="relative min-h-full w-full overflow-hidden bg-[#dff2ff] text-[#173e70]"
        style={{ height: 'calc(var(--vh, 1vh) * 100)' }}
      >
        {/* Soft daylight and hand-drawn wall details */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-24 h-80 w-[42rem] rotate-[24deg] bg-white/45 blur-3xl" />
          <div className="absolute right-[-8rem] top-[-5rem] h-72 w-72 rounded-full bg-[#b8def5]/60 blur-2xl" />
          <div className="absolute left-4 top-8 -rotate-6 font-serif text-lg leading-6 text-[#3e6592]/80 sm:left-10 sm:top-12">
            Big dreams,
            <br />
            need smart
            <br />
            plans ♡
          </div>
          <div className="absolute right-5 top-8 rotate-6 font-serif text-lg text-[#3e6592]/80 sm:right-12 sm:top-14">
            Future ♡
            <br />
            CA
          </div>
          <div className="absolute right-3 top-28 hidden w-24 rotate-3 rounded-sm border border-[#aacde7] bg-white/65 p-3 text-center font-serif text-xs leading-4 text-[#426486] shadow-sm sm:block">
            Discipline
            <br />
            today
            <br />
            Freedom tomorrow ♡
          </div>
          <div className="absolute left-[-1.5rem] top-[38%] text-6xl opacity-35 sm:left-3 sm:text-7xl">🌿</div>
          <div className="absolute right-[-1.5rem] top-[18%] text-7xl opacity-40 sm:right-3">🌿</div>
        </div>

        {/* Small stationery cup on the left, matching the reference balance */}
        <div className="absolute bottom-[18%] left-1 z-10 flex flex-col items-center sm:bottom-[17%] sm:left-7">
          <div className="mb-[-0.45rem] flex items-end gap-0.5 text-xl sm:text-2xl">
            <span className="rotate-[-18deg]">🖊️</span>
            <span className="rotate-[12deg]">✏️</span>
            <span className="rotate-[-8deg]">🖍️</span>
          </div>
          <div className="relative flex h-16 w-20 items-center justify-center rounded-b-2xl rounded-t-md border-2 border-[#aec9dd] bg-[#f7fbff] shadow-md sm:h-20 sm:w-24">
            <div className="absolute inset-x-2 top-3 h-1 rounded-full bg-[#b7d8ef]" />
            <div className="flex items-center gap-1.5 pt-2">
              <button
                type="button"
                onClick={loginAsAmmu}
                disabled={!isSafe}
                aria-label="Open first study space"
                title={isSafe ? 'Open study space' : 'Locked — toggle the pin to unlock'}
                className={`text-2xl leading-none transition-all sm:text-3xl ${
                  isSafe ? 'hover:scale-110 active:scale-95' : 'grayscale opacity-40'
                }`}
              >
                {'😊'}
              </button>
              <button
                type="button"
                onClick={loginAsVishwa}
                disabled={!isSafe}
                aria-label="Open second study space"
                title={isSafe ? 'Open study space' : 'Locked — toggle the pin to unlock'}
                className={`text-2xl leading-none transition-all sm:text-3xl ${
                  isSafe ? 'hover:scale-110 active:scale-95' : 'grayscale opacity-40'
                }`}
              >
                {'😊'}
              </button>
            </div>
            <div className="absolute -right-3 top-5 h-8 w-5 rounded-r-full border-2 border-l-0 border-[#aec9dd]" />
          </div>
        </div>

        {/* Small blue book stack on the left */}
        <div className="pointer-events-none absolute bottom-[8%] left-[-0.5rem] z-0 hidden w-44 rotate-[-3deg] space-y-1 sm:block">
          {['Accounting', 'Law', 'Taxation', 'Audit'].map((label, index) => (
            <div
              key={label}
              className={`h-8 rounded-r-md border border-white/40 px-3 py-1 font-serif text-sm italic text-white shadow-sm ${
                index % 2 === 0 ? 'bg-[#3978b7]' : 'bg-[#5b91c1]'
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Pin/Pencil control remains in its existing position and behavior */}
        <button
          onClick={toggleSafety}
          disabled={safetyLoading}
          className="fixed bottom-6 left-5 z-50 rounded-full p-2 text-2xl transition-transform duration-150 hover:scale-110 active:scale-95 sm:bottom-8 sm:left-10"
          title={isSafe ? 'Pencil — unlocked' : 'Pin — locked'}
        >
          {isSafe ? '📝' : '📌'}
        </button>

        {/* Centered reference-style login content */}
        <main className="relative z-20 mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-5 pb-[18%] pt-10 text-center sm:pb-[13%]">
          <div className="mb-3 text-7xl leading-none drop-shadow-sm sm:text-8xl">CA</div>
          <h1 className="font-serif text-5xl font-semibold italic tracking-tight text-[#174c87] sm:text-7xl">
            CA Prep Hub
          </h1>
          <div className="mt-4 flex items-center gap-3 text-sm tracking-[0.22em] text-[#38638d] sm:text-base">
            <span>Learn</span>
            <span>•</span>
            <span>Practice</span>
            <span>•</span>
            <span>Prepare</span>
            <span>•</span>
            <span>Achieve</span>
          </div>
          <div className="my-4 flex w-56 items-center gap-3 text-[#2865a0]">
            <span className="h-px flex-1 bg-[#6d9ec6]/60" />
            <span className="text-lg">♥</span>
            <span className="h-px flex-1 bg-[#6d9ec6]/60" />
          </div>
          <p className="font-serif text-base italic text-[#527399] sm:text-lg">Your CA journey starts here ♡</p>

          <form onSubmit={handleLogin} className="mt-8 flex w-full max-w-sm flex-col items-center gap-5 sm:mt-10">
            <label className="sr-only" htmlFor="login-name">Enter your name</label>
            <input
              id="login-name"
              type="text"
              value={inputNickname}
              onChange={(e) => setInputNickname(e.target.value)}
              onFocus={() => {
                if (isSafe && !safetyLoading) toggleSafety();
              }}
              className="h-14 w-full rounded-full border border-[#7da9cb] bg-white/75 px-6 text-base text-[#244f78] shadow-[0_5px_14px_rgba(62,112,157,0.13)] outline-none placeholder:text-[#8ca3b9] focus:border-[#397ec0] focus:ring-4 focus:ring-[#8fc1e8]/40"
              placeholder="Enter your name..."
              required
            />
            <button
              type="submit"
              className="flex h-14 w-44 items-center justify-center gap-3 rounded-full bg-[#3d83c7] text-lg font-semibold text-white shadow-[0_7px_14px_rgba(41,103,164,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#2f73b5] hover:shadow-lg active:translate-y-0"
            >
              Enter <span aria-hidden="true" className="text-2xl leading-none">→</span>
            </button>
          </form>
        </main>

        {/* Desk edge and notebook details */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[17%] border-t border-[#e8ddc8] bg-[#f5efe5]/90 sm:h-[15%]" />
        <div className="pointer-events-none absolute bottom-[3%] right-[9%] hidden rotate-[-7deg] font-serif text-sm italic text-[#56799b] sm:block">
          To do: ♡
          <br />
          □ study&nbsp;&nbsp; □ practice
        </div>
        <div className="pointer-events-none absolute bottom-[5%] right-[18%] hidden h-2 w-32 rotate-[-18deg] rounded-full bg-[#2d6fae] shadow-sm sm:block" />
      </div>
    );
  }

  // 🧩 Chat Pages
  if (currentPage === 'chat1') {
    return <Chat1 nickname={nickname} onLogout={handleLogout} />;
  }

  if (currentPage === 'chat2') {
    return (
      <Chat2
        nickname={nickname as 'Vishwa' | 'Ammu'}
        onLogout={handleLogout}
        onSwitchToAIChat={handleSwitchToAIChat}
        onSwitchToChat3={handleSwitchToChat3}
      />
    );
  }

  if (currentPage === 'chat3') {
    return (
      <Chat3
        nickname={nickname as 'Vishwa' | 'Ammu'}
        onLogout={handleLogout}
        onSwitchToAIChat={handleSwitchToAIChat}
        onSwitchToChat2={handleSwitchToChat2}
        onOpenMemory={handleOpenMemory}
      />
    );
  }

  if (currentPage === 'memory') {
    return (
      <MemoryPage
        nickname={nickname as 'Vishwa' | 'Ammu'}
        onClose={handleLogout}
        onNavigateToChat1={() => setCurrentPage('chat1')}
        onNavigateToChat2={() => setCurrentPage('chat2')}
        onNavigateToChat3={() => setCurrentPage('chat3')}
      />
    );
  }

  return null;
}

// Wrap the entire app in an error boundary to prevent white screen crashes
function AppWithErrorBoundary() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

export default AppWithErrorBoundary;
