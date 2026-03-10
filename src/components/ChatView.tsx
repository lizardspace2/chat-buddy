import { useRef, useEffect, useState } from "react";
import { Chat } from "@/types/chat";
import { formatTimestamp, formatDateSeparator, getTimeGap, shouldShowDateSeparator } from "@/lib/chatUtils";
import { ArrowLeft, ArrowUp } from "lucide-react";
import TypingIndicator from "./TypingIndicator";

interface ChatViewProps {
  chat: Chat;
  onBack: () => void;
  onSendMessage: (chatId: string, text: string) => void;
}

const ChatView = ({ chat, onBack, onSendMessage }: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [showTyping, setShowTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages]);

  // Simulate typing indicator periodically
  useEffect(() => {
    const timer = setTimeout(() => setShowTyping(true), 4000);
    const off = setTimeout(() => setShowTyping(false), 8000);
    return () => { clearTimeout(timer); clearTimeout(off); };
  }, [chat.id]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSendMessage(chat.id, text);
    setInput("");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-8 py-5 border-b border-border">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-body text-sent font-medium text-foreground">{chat.name}</h2>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6">
        {chat.messages.map((msg, i) => {
          const prev = i > 0 ? chat.messages[i - 1] : null;
          const showDate = shouldShowDateSeparator(prev, msg);
          const gap = prev && !showDate ? getTimeGap(prev, msg) : 0;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className={`${i > 0 ? "pt-20" : "pt-4"} pb-8 flex justify-center`}>
                  <span className="font-mono text-meta uppercase text-muted-foreground tracking-widest">
                    {formatDateSeparator(msg.timestamp)}
                  </span>
                </div>
              )}
              <div
                style={{ marginTop: !showDate && gap > 0 ? `${gap}px` : undefined }}
                className={`max-w-[60%] ${msg.sent ? "ml-[40%]" : "mr-auto"}`}
              >
                <p className={msg.sent
                  ? "font-body text-sent text-sent"
                  : "font-serif text-received text-received"
                }>
                  {msg.text}
                </p>
                <span className="font-mono text-meta uppercase text-muted-foreground mt-1 block">
                  {formatTimestamp(msg.timestamp)}
                  {msg.sent && (
                    <span className="text-accent ml-2">✓✓</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}

        {showTyping && <TypingIndicator />}
      </div>

      {/* Composer */}
      <div className="px-8 py-5 border-t border-border">
        <div className="flex items-center gap-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder=""
            className="flex-1 bg-transparent font-body text-sent text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="text-accent disabled:opacity-30 transition-opacity hover:opacity-80"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatView;
