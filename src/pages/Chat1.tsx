import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Send, LogOut, Trash2, ChevronDown, Sparkles } from 'lucide-react';
import RobotCloud from '../components/RobotCloud';
import TypingIndicator from '../components/TypingIndicator';
import { calculateSpacingForAllMessages } from '../lib/messageSpacing';
import formatMarkdown from '../lib/markdown';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

interface Chat1Props {
  nickname: string;
  onLogout: () => void;
}

interface AIMessage {
  id: string;
  text: string;
  by: string; // nickname for user, 'AI' for AI
  type: string;
  ts: any; // Firestore timestamp or Date
  replyTo?: { id: string; text: string; by: string } | null;
}

const SYSTEM_PROMPT = `You are a friendly B.Com and commerce study assistant. Your job is to help college students understand commerce-related academic content clearly and simply.

Target students study: B.Com, B.Com Computer Applications, Commerce, Accounting, Finance, Economics, Business Studies, Corporate Accounting, Cost Accounting, Management Accounting, Taxation, Auditing, Business Law, Statistics, Banking, Marketing, Human Resource Management, Business Economics, Entrepreneurship, and other commerce-related subjects.

Rules:
- Explain difficult paragraphs in easy, simple language that a B.Com student can understand.
- Summarize content without losing important meaning. Remove unnecessary words but keep definitions, facts, concepts, and keywords.
- Extract key points as bullet points when asked.
- Answer commerce questions clearly with definitions, explanations, important points, and examples where useful.
- Solve accounting, finance, taxation, and numerical problems STEP BY STEP: state the formula, identify the values, show each calculation step, explain why each step is done, and give the final answer clearly.
- For economics: explain the concept simply, give practical examples, explain cause and effect, and connect to real-world business situations.
- For theory questions: give a direct definition first, then explain simply, then list important points, and give an example if useful.
- Adjust answer depth to the student's request: 2-mark answers should be short and direct; 5-mark answers should be structured with enough explanation; 10-mark answers should be detailed with introduction, explanation, important points, examples, and conclusion.
- For exam preparation, structure answers with important keywords and points.
- Always prioritize the student's provided content/context when they ask about it. Do not invent information that isn't in their content. If something is missing, say what is missing.
- Be patient, encouraging, and student-friendly. Avoid unnecessary technical jargon unless the student asks for it.
- Never use overly complicated language.
- Format your responses using Markdown: use **bold** for important terms and keywords, use bullet points with - for lists, use numbered lists where appropriate, and use headings with # for sections. This makes answers easier to read and study.`;

// Minimal typing for the Puter.js global
declare global {
  interface Window {
    puter?: {
      ai: {
        chat: (prompt: string | Array<{ role: string; content: string }>, options?: any) => Promise<any>;
      };
      auth: {
        isSignedIn: () => boolean;
        signIn: () => Promise<void>;
        signOut: () => void;
      };
    };
  }
}

const AI_TIMEOUT_MS = 60_000;

function Chat1({ nickname, onLogout }: Chat1Props) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAwaitingAIRef = useRef(false);
  const messagesRef = useRef<AIMessage[]>([]);

  // Keep messagesRef in sync so callPuterAI can read the latest history
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Each user gets their own collection so conversations persist across logins
  const collectionName = `aiChat_${nickname}`;

  // Subscribe to Firebase for this user's AI chat history
  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, collectionName),
      orderBy('ts', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const loaded = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as AIMessage[];
        setMessages(loaded);
        setLoading(false);
      },
      (err) => {
        console.error('Firebase AI chat listener error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionName]);

  const spacingMap = useCallback(() => {
    return calculateSpacingForAllMessages(messages as any);
  }, [messages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isAtBottom && messages.length > 0);
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages.length]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timeout);
  }, [messages, isTyping]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollButton(false);
  };

  const formatMessageTime = (timestamp: any): string => {
    try {
      if (!timestamp) return '';
      let date: Date;
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else {
        date = new Date(timestamp);
      }
      if (isNaN(date.getTime())) return '';
      const TZ = 'Asia/Kolkata';
      const dayFmt = new Intl.DateTimeFormat('en-IN', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      });
      const isToday = dayFmt.format(date) === dayFmt.format(new Date());
      if (isToday) {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
        }).format(date);
      }
      return new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(date);
    } catch {
      return '';
    }
  };

  const waitForPuter = async (timeoutMs = 15_000): Promise<void> => {
    if (window.puter?.ai?.chat) return;
    const start = Date.now();
    while (!window.puter?.ai?.chat) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('AI is still loading. Please refresh the page and try again.');
      }
      await new Promise(r => setTimeout(r, 200));
    }
  };

  const ensurePuterAuth = async (): Promise<void> => {
    const puter = window.puter;
    if (!puter) return;
    if (!puter.auth?.isSignedIn) return;
    if (puter.auth.isSignedIn()) return;
    if (puter.auth.signIn) {
      await puter.auth.signIn();
    }
  };

  const extractAIResponse = (response: any): string => {
    if (typeof response === 'string') return response;
    if (response?.message?.content) {
      return typeof response.message.content === 'string'
        ? response.message.content
        : Array.isArray(response.message.content)
          ? response.message.content.map((c: any) => c.text || '').join('')
          : String(response.message.content);
    }
    if (response?.content) return String(response.content);
    if (response?.text) return String(response.text);
    return String(response || '');
  };

  const callPuterAIOnce = async (conversation: Array<{ role: string; content: string }>): Promise<string> => {
    const puter = window.puter;
    if (!puter?.ai?.chat) {
      throw new Error('AI is not available right now. Please refresh the page and try again.');
    }

    const response = await Promise.race([
      puter.ai.chat(conversation as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('The AI is taking too long to respond. Please try again.')), AI_TIMEOUT_MS)
      ),
    ]);

    return extractAIResponse(response);
  };

  const callPuterAI = async (userMessage: string): Promise<string> => {
    await waitForPuter();

    // Build conversation history from Firebase-persisted messages (last 10)
    const history = messagesRef.current.slice(-10).map(m => ({
      role: m.by === 'AI' ? 'assistant' : 'user',
      content: m.text,
    }));

    const conversation = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage },
    ];

    await ensurePuterAuth();

    try {
      return await callPuterAIOnce(conversation);
    } catch (firstErr: any) {
      console.warn('Puter AI first attempt failed, retrying...', firstErr);
      await new Promise(r => setTimeout(r, 1500));
      return await callPuterAIOnce(conversation);
    }
  };

  const saveMessageToFirebase = async (msg: Omit<AIMessage, 'id'>): Promise<string> => {
    const docRef = await addDoc(collection(db, collectionName), {
      ...msg,
      ts: serverTimestamp(),
    });
    return docRef.id;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const userMessage = message.trim();
    if (!userMessage || isAwaitingAIRef.current) return;

    setError(null);
    isAwaitingAIRef.current = true;

    setMessage('');

    // Save user message to Firebase immediately (Firestore listener will add it to UI)
    const userMsgData = {
      text: userMessage,
      by: nickname,
      type: 'text',
      replyTo: null,
    };
    const userId = await saveMessageToFirebase(userMsgData);

    // Show typing indicator
    setIsTyping(true);

    try {
      const aiText = await callPuterAI(userMessage);

      // Save AI response to Firebase
      await saveMessageToFirebase({
        text: aiText,
        by: 'AI',
        type: 'text',
        replyTo: { id: userId, text: userMessage, by: nickname },
      });
    } catch (err: any) {
      console.error('Puter AI error:', err);
      const errMsg = err?.message || 'Something went wrong. Please try again.';
      setError(errMsg);
      // Save error as AI message so it persists
      await saveMessageToFirebase({
        text: `Sorry, I couldn't respond right now. ${errMsg}`,
        by: 'AI',
        type: 'text',
        replyTo: { id: userId, text: userMessage, by: nickname },
      });
    } finally {
      setIsTyping(false);
      isAwaitingAIRef.current = false;
      textareaRef.current?.focus();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await deleteDoc(doc(db, collectionName, messageId));
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  };

  const handleClearChat = async () => {
    if (messages.length === 0) return;
    if (!window.confirm('Clear all messages in this conversation?')) return;

    // Delete each message from Firebase
    for (const msg of messages) {
      try {
        await deleteDoc(doc(db, collectionName, msg.id));
      } catch (err) {
        console.error('Failed to delete message:', err);
      }
    }
    setError(null);
  };

  const spMap = spacingMap();

  return (
    <div className="h-full w-full bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
      {/* ── HEADER — matching Chat2 style ── */}
      <div className="fixed top-0 left-0 right-0 bg-gradient-to-r from-green-50/95 via-blue-50/95 to-purple-50/95 backdrop-blur-md px-4 py-4 z-50 shadow-lg border-b border-white/30">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
                <BookOpen className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent truncate">
                  B.Com Study Assistant
                </h1>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-green-500" />
                  AI-powered for commerce students
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-2 flex-shrink-0">
              <button
                onClick={handleClearChat}
                disabled={messages.length === 0}
                className="px-3 py-2 rounded-full text-sm sm:text-xs font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Clear conversation"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Exit</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Book Background Watermark */}
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0">
        <div className="text-9xl opacity-10 text-gray-500">📚</div>
      </div>

      {/* MESSAGES LIST */}
      <div
        ref={messagesContainerRef}
        className="max-w-4xl mx-auto p-4 relative z-10 h-screen overflow-y-auto"
        style={{ paddingTop: '90px', paddingBottom: '120px' }}
      >
        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">📚</div>
            <p className="text-gray-500">Loading your conversation...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 sm:py-20">
            <div className="text-6xl mb-4">📚💡</div>
            <h2 className="text-xl font-bold text-gray-700 mb-2">Welcome to your B.Com Study Assistant!</h2>
            <p className="text-gray-500 max-w-md mx-auto">
              Ask me anything about accounting, finance, economics, business law, taxation, statistics, and more.
              Paste a paragraph to summarize or explain, or ask for exam-oriented answers.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
              {['Explain inflation simply', 'Summarize this paragraph', 'Give me a 5 mark answer on GST', 'Solve this accounting problem'].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setMessage(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/80 text-green-700 border border-green-200 hover:bg-green-50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => {
              const isAIMessage = msg.by === 'AI';
              const hasSpacing = spMap[msg.id] || false;

              return (
                <RobotCloud
                  key={msg.id}
                  messageId={msg.id}
                  text={msg.text}
                  renderedText={isAIMessage ? formatMarkdown(msg.text) : undefined}
                  isOwn={!isAIMessage}
                  isUser={!isAIMessage}
                  isAI={isAIMessage}
                  type={msg.type}
                  currentUserNickname={nickname}
                  timestamp={formatMessageTime(msg.ts)}
                  replyTo={msg.replyTo}
                  hasSpacing={hasSpacing}
                  onDelete={handleDeleteMessage}
                />
              );
            })}
            {isTyping && <TypingIndicator nickname="AI" />}
            {error && (
              <div className="flex justify-center my-4">
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 max-w-md text-center">
                  {error}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
            <div className="h-24"></div>
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-32 right-6 bg-green-500 text-white p-3 rounded-full shadow-lg hover:bg-green-600 transition-all z-40"
          title="Scroll to latest message"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}

      {/* Message Input — matching Chat2 style */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-green-200 p-4 z-50 shadow-lg">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <div className="relative">
                <textarea
                  value={message}
                  onChange={handleInputChange}
                  placeholder="Ask me about accounting, economics, taxation, or paste a paragraph to summarize..."
                  className="w-full px-4 py-3 rounded-2xl border border-green-200 focus:border-green-400 focus:ring-2 focus:ring-green-100 outline-none resize-none transition-all bg-white shadow-sm overflow-y-auto"
                  rows={1}
                  style={{
                    minHeight: '48px',
                    maxHeight: '120px',
                    height: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain',
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  ref={(el) => {
                    textareaRef.current = el;
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (message.trim() && !isAwaitingAIRef.current) {
                        handleSendMessage(e);
                      }
                    }
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!message.trim() || isTyping}
              className="bg-gradient-to-r from-green-500 to-emerald-500 text-white p-3 rounded-full hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl z-10"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>

      {/* Floating Study Icons */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-5 text-green-200 text-2xl animate-bounce">📚</div>
        <div className="absolute top-40 right-8 text-emerald-200 text-xl animate-pulse">✏️</div>
        <div className="absolute bottom-32 left-12 text-teal-300 text-3xl animate-bounce">📖</div>
        <div className="absolute top-60 right-20 text-green-300 text-2xl animate-pulse">💡</div>
        <div className="absolute bottom-60 left-20 text-emerald-300 text-xl animate-bounce">📝</div>
        <div className="absolute top-80 left-40 text-blue-300 text-2xl animate-pulse">🎓</div>
      </div>
    </div>
  );
}

export default Chat1;
