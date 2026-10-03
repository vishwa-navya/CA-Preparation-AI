// src/App.tsx
import React, { useState, useEffect, Component, ReactNode } from 'react';
import { AlertCircle, UserRound } from 'lucide-react';
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

  // 🧭 LOGIN PAGE — reference-matched CA study desk
  if (currentPage === 'login') {
    return (
      <div
        className="relative min-h-full w-full overflow-hidden bg-[#dff2ff] text-[#173e70]"
        style={{ height: 'calc(var(--vh, 1vh) * 100)' }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-24 h-80 w-[42rem] rotate-[24deg] bg-white/50 blur-3xl" />
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

          <div className="absolute left-[-1rem] top-[35%] h-28 w-24 opacity-60 sm:left-2 sm:h-36 sm:w-28">
            <span className="absolute bottom-0 left-1/2 h-24 w-1 -rotate-[18deg] rounded-full bg-[#80a978]" />
            <span className="absolute left-2 top-9 h-9 w-4 -rotate-[42deg] rounded-full bg-[#9bcf88]" />
            <span className="absolute left-7 top-1 h-11 w-5 -rotate-[20deg] rounded-full bg-[#aedb98]" />
            <span className="absolute left-12 top-12 h-10 w-5 rotate-[35deg] rounded-full bg-[#8fc17f]" />
            <span className="absolute left-16 top-2 h-9 w-4 rotate-[26deg] rounded-full bg-[#b7df9e]" />
          </div>
          <div className="absolute right-[-0.5rem] top-0 h-44 w-28 opacity-65 sm:right-5 sm:h-52">
            <span className="absolute right-12 top-0 h-48 w-1 rotate-[16deg] rounded-full bg-[#6c9e70]" />
            <span className="absolute right-5 top-3 h-10 w-5 rotate-[35deg] rounded-full bg-[#86b77a]" />
            <span className="absolute right-16 top-12 h-11 w-5 -rotate-[35deg] rounded-full bg-[#a4d391]" />
            <span className="absolute right-1 top-20 h-12 w-6 rotate-[32deg] rounded-full bg-[#78aa70]" />
            <span className="absolute right-12 top-28 h-10 w-5 -rotate-[30deg] rounded-full bg-[#9ac986]" />
          </div>
          <div className="absolute bottom-[-1rem] left-[-1rem] h-20 w-32 opacity-60">
            <span className="absolute bottom-0 left-14 h-20 w-1 rotate-[28deg] rounded-full bg-[#78a675]" />
            <span className="absolute bottom-8 left-2 h-9 w-5 -rotate-[34deg] rounded-full bg-[#a4d28e]" />
            <span className="absolute bottom-1 left-24 h-10 w-5 rotate-[38deg] rounded-full bg-[#8fbe7d]" />
          </div>
        </div>

        {/* Small blue book stack, fully visible and naturally grounded */}
        <div className="pointer-events-none absolute bottom-[9%] left-0 z-10 w-36 rotate-[-3deg] space-y-1 sm:left-2 sm:w-44">
          {['Accounting', 'Law', 'Taxation', 'Costing', 'Audit'].map((label, index) => (
            <div
              key={label}
              className={`h-7 rounded-r-md border border-white/40 px-2 py-1 font-serif text-[11px] italic text-white shadow-sm sm:h-8 sm:px-3 sm:text-sm ${
                index % 2 === 0 ? 'bg-[#3978b7]' : 'bg-[#5b91c1]'
              }`}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-[24%] left-8 z-20 text-xl sm:left-16 sm:text-2xl">
          <span className="mr-1 inline-block rotate-[-18deg]">🖊️</span>
          <span className="inline-block rotate-[12deg]">✏️</span>
        </div>
        <div className="pointer-events-none absolute bottom-[17%] left-12 z-20 hidden -rotate-6 font-serif text-xs italic text-[#51779c] sm:block">
          Keep
          <br />
          going ♡
        </div>

        {/* Illustrated CA logo: cap, curved C, arrow-chart A */}
        <div className="relative z-20 mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-5 pb-[18%] pt-10 text-center sm:pb-[13%]">
          <img src="/image.png" className="mb-1 h-28 w-36 object-contain drop-shadow-sm sm:h-36 sm:w-48" alt="Chartered Accountant logo" />
          <h1 className="font-serif text-5xl font-semibold italic tracking-tight text-[#174c87] sm:text-7xl">CA Prep Hub</h1>
          <div className="mt-4 flex items-center gap-3 text-sm tracking-[0.22em] text-[#38638d] sm:text-base">
            <span>Learn</span><span>•</span><span>Practice</span><span>•</span><span>Prepare</span><span>•</span><span>Achieve</span>
          </div>
          <div className="my-4 flex w-56 items-center gap-3 text-[#2865a0]">
            <span className="h-px flex-1 bg-[#6d9ec6]/60" /><span className="text-lg">♥</span><span className="h-px flex-1 bg-[#6d9ec6]/60" />
          </div>
          <p className="font-serif text-base italic text-[#527399] sm:text-lg">Your CA journey starts here ♡</p>

          <form onSubmit={handleLogin} className="mt-8 flex w-full max-w-sm flex-col items-center gap-5 sm:mt-10">
            <label className="sr-only" htmlFor="login-name">Enter your name CA Student </label>
            <div className="flex h-14 w-full items-center rounded-full border border-[#7da9cb] bg-white/75 px-5 shadow-[0_5px_14px_rgba(62,112,157,0.13)] focus-within:border-[#397ec0] focus-within:ring-4 focus-within:ring-[#8fc1e8]/40">
              <UserRound className="mr-3 h-6 w-6 shrink-0 text-[#5c8db7]" strokeWidth={1.7} />
              <input
                id="login-name"
                type="text"
                value={inputNickname}
                onChange={(e) => setInputNickname(e.target.value)}
                onFocus={() => {
                  if (isSafe && !safetyLoading) toggleSafety();
                }}
                className="h-full min-w-0 flex-1 bg-transparent text-base text-[#244f78] outline-none placeholder:text-[#8ca3b9]"
                placeholder="Enter your name..."
                required
              />
            </div>
            <button type="submit" className="flex h-14 w-44 items-center justify-center gap-3 rounded-full bg-[#3d83c7] text-lg font-semibold text-white shadow-[0_7px_14px_rgba(41,103,164,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#2f73b5] hover:shadow-lg active:translate-y-0">
              Enter <span aria-hidden="true" className="text-2xl leading-none">→</span>
            </button>
          </form>
        </div>

        {/* Blue-toned desk continuation with notebook, pen, laptop, and a small clickable cup */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[23%] bg-[#cfe9f8]/45 sm:h-[20%]" />
        <div className="pointer-events-none absolute bottom-[6%] right-[10%] z-10 hidden h-20 w-36 -skew-x-12 rounded-md border border-[#a8c9df] bg-[#d8edf9] shadow-lg sm:block">
          <div className="absolute -right-6 -top-7 h-28 w-4 rounded-full bg-[#b5d2e5]" />
          <div className="absolute inset-x-4 top-3 h-1 bg-[#b0cfe1]" />
        </div>
        <div className="pointer-events-none absolute bottom-[4%] right-[29%] z-20 hidden h-2 w-32 rotate-[-18deg] rounded-full bg-[#2d6fae] shadow-sm sm:block" />
        <div className="pointer-events-none absolute bottom-[3%] right-[9%] z-20 hidden rotate-[-7deg] font-serif text-sm italic text-[#56799b] sm:block">
          To do: ♡
          <br />
          □ study&nbsp;&nbsp; □ practice
          <br />
          □ revise
        </div>
        <div className="absolute bottom-[11%] right-4 z-30 flex scale-75 flex-col items-center sm:bottom-[13%] sm:right-[7%] sm:scale-100">
          <div className="relative h-16 w-14 rounded-b-[1.15rem] rounded-t-[0.6rem] border-2 border-[#9cb8cb] bg-[#f7fbff] shadow-[0_8px_12px_rgba(52,95,126,0.18)]">
            <div className="absolute -top-1 left-1/2 h-3 w-11 -translate-x-1/2 rounded-[50%] border-2 border-[#9cb8cb] bg-[#c9dce8]" />
            <div className="relative z-10 flex h-full items-center justify-center gap-0.5 pt-2">
              <button type="button" onClick={loginAsAmmu} disabled={!isSafe} aria-label="Open first study space" title={isSafe ? 'Open study space' : 'Locked — toggle the pin to unlock'} className={`text-[10px] leading-none transition-all ${isSafe ? 'hover:scale-110 active:scale-95' : 'grayscale opacity-40'}`}>: )</button>
              <button type="button" onClick={loginAsVishwa} disabled={!isSafe} aria-label="Open second study space" title={isSafe ? 'Open study space' : 'Locked — toggle the pin to unlock'} className={`text-[10px] leading-none transition-all ${isSafe ? 'hover:scale-110 active:scale-95' : 'grayscale opacity-40'}`}>: )</button>
            </div>
            <div className="absolute -right-4 top-4 h-7 w-5 rounded-r-full border-2 border-l-0 border-[#9cb8cb]" />
          </div>
        </div>

        <button onClick={toggleSafety} disabled={safetyLoading} className="fixed bottom-6 left-5 z-50 rounded-full p-2 text-2xl transition-transform duration-150 hover:scale-110 active:scale-95 sm:bottom-8 sm:left-10" title={isSafe ? 'Pencil — unlocked' : 'Pin — locked'}>
          {isSafe ? '📝' : '📌'}
        </button>
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
