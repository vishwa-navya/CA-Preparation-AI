/**
 * SmartNotification — iPhone Dynamic Island–style notification for the
 * Memories module header.
 *
 * States:
 * 1. IDLE: Shows only the other user's DP with a green online dot.
 * 2. EXPANDED: DP slides left, a rounded pill container expands showing
 *    sender DP, message preview (truncated), and unread count badge.
 *
 * The component is fully controlled by the parent via props, so state
 * persists across internal Memories page navigations without resetting.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsMobile } from "../hooks/use-mobile";
import type { UnreadMessageInfo } from "../hooks/useMemoriesNotification";

interface SmartNotificationProps {
  isOtherOnline: boolean;
  unreadCount: number;
  latestUnread: UnreadMessageInfo | null;
  otherUserDp: string;
  otherUserName: string;
  theme?: "light" | "dark";
}

export default function SmartNotification({
  isOtherOnline,
  unreadCount,
  latestUnread,
  otherUserDp,
  otherUserName,
  theme = "light",
}: SmartNotificationProps) {
  const isMobile = useIsMobile();
  const hasUnread = unreadCount > 0 && latestUnread !== null;

  // Determine message preview text
  const previewText = (() => {
    if (!latestUnread) return "";
    if (latestUnread.type === "image") return "📷 Photo";
    if (latestUnread.type === "video") return "🎥 Video";
    if (latestUnread.type === "audio" || latestUnread.mimeType?.startsWith("audio/")) return "🎤 Voice message";
    if (latestUnread.type === "file") return "📎 File";
    return latestUnread.text || "";
  })();

  // Dynamic truncation based on available width
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncatedText, setTruncatedText] = useState(previewText);

  useEffect(() => {
    if (!hasUnread || !previewText) {
      setTruncatedText(previewText);
      return;
    }

    // Calculate max chars based on device and container width
    const calculateTruncation = () => {
      if (!containerRef.current || !textRef.current) {
        // Fallback: mobile ~25 chars, desktop ~40 chars
        setTruncatedText(truncateText(previewText, isMobile ? 25 : 40));
        return;
      }

      const containerWidth = containerRef.current.offsetWidth;
      // Reserve space for DP (28px), badge (~28px), padding/gaps (~24px)
      const reservedWidth = 80;
      const availableWidth = containerWidth - reservedWidth;
      // Approximate: average char width ~7px at 13px font size
      const avgCharWidth = 7;
      const maxChars = Math.max(10, Math.floor(availableWidth / avgCharWidth));
      setTruncatedText(truncateText(previewText, maxChars));
    };

    // Use requestAnimationFrame to avoid layout thrashing
    const raf = requestAnimationFrame(calculateTruncation);
    // Recalculate on resize
    window.addEventListener("resize", calculateTruncation);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", calculateTruncation);
    };
  }, [previewText, hasUnread, isMobile]);

  const isDark = theme === "dark";

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-end"
      style={{ minHeight: 40 }}
    >
      {/* Dynamic Island container */}
      <motion.div
        layout
        className="flex items-center gap-2 rounded-full overflow-hidden"
        style={{
          backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
          border: isDark
            ? "1px solid rgba(255,255,255,0.2)"
            : "1px solid rgba(255,255,255,0.5)",
        }}
        animate={{
          width: hasUnread ? "auto" : 44,
          height: 44,
          borderRadius: 22,
        }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 32,
          mass: 0.8,
        }}
      >
        {/* DP — always visible, slides left when notification expands */}
        <motion.div
          layout
          className="relative flex-shrink-0"
          animate={{ marginLeft: hasUnread ? 4 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        >
          <img
            src={otherUserDp}
            alt={otherUserName}
            className="w-9 h-9 rounded-full object-cover"
            style={{
              border: "2px solid rgba(255,255,255,0.6)",
            }}
          />
          {/* Green online indicator */}
          <AnimatePresence>
            {isOtherOnline && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500"
                style={{
                  border: "2px solid white",
                  boxShadow: "0 0 4px rgba(34,197,94,0.6)",
                }}
              />
            )}
          </AnimatePresence>
        </motion.div>

        {/* Expandable notification content */}
        <AnimatePresence>
          {hasUnread && (
            <motion.div
              key="notification-content"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 32,
                opacity: { duration: 0.2 },
              }}
              className="flex items-center gap-2 overflow-hidden"
              style={{ paddingRight: 6 }}
            >
              {/* Sender mini DP */}
              <img
                src={otherUserDp}
                alt=""
                className="w-6 h-6 rounded-full object-cover flex-shrink-0"
              />

              {/* Message preview — truncated */}
              <span
                ref={textRef}
                className={isDark ? "text-white text-xs font-medium whitespace-nowrap" : "text-gray-800 text-xs font-medium whitespace-nowrap"}
                style={{ maxWidth: isMobile ? 160 : 240 }}
              >
                {truncatedText}
              </span>

              {/* Unread count badge */}
              <div
                className="flex items-center justify-center rounded-full bg-red-500 text-white font-bold flex-shrink-0"
                style={{
                  minWidth: 20,
                  height: 20,
                  padding: "0 6px",
                  fontSize: 11,
                  boxShadow: "0 1px 4px rgba(239,68,68,0.4)",
                }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}
