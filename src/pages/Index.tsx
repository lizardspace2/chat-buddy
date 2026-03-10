import { useState, useRef, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import TypingIndicator from "@/components/TypingIndicator";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const LLM_MODEL = import.meta.env.VITE_GROQ_MODEL || "llama-3.3-70b-versatile";

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const isSendingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping || isSendingRef.current) return;

    isSendingRef.current = true;
    setIsTyping(true);

    if (!GROQ_API_KEY || GROQ_API_KEY === "your_api_key_here") {
      toast.error("Veuillez configurer votre clé API Groq dans le fichier .env");
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: messages.concat(userMsg).map(m => ({
            role: m.role,
            content: m.content
          })),
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Limite de requêtes atteinte sur Groq (Free Tier). Attendez une minute.");
        }
        const errorText = await response.text();
        let errorMessage = "Erreur lors de l'appel à l'API Groq";
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.choices[0].message.content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error: any) {
      console.error("LLM Error:", error);
      toast.error(error.message || "Une erreur est survenue");
    } finally {
      setIsTyping(false);
      isSendingRef.current = false;
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen flex flex-col bg-background max-w-3xl mx-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-border">
        <h1 className="font-mono text-meta uppercase tracking-widest text-muted-foreground">
          Assistant LLM
        </h1>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center h-full text-center">
            <div className="space-y-4">
              <p className="font-mono text-meta uppercase text-muted-foreground tracking-widest">
                Prêt à discuter
              </p>
              <p className="text-xs text-muted-foreground opacity-50 font-mono">
                Modèle: {LLM_MODEL}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`max-w-[80%] ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}>
            {msg.role === "assistant" ? (
              <div className="font-serif text-received text-foreground prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="font-body text-sent text-sent">{msg.content}</p>
            )}
            <span className="font-mono text-meta uppercase text-muted-foreground mt-1 block">
              {formatTime(msg.timestamp)}
            </span>
          </div>
        ))}

        {isTyping && <TypingIndicator />}
      </div>

      {/* Composer */}
      <div className="px-8 py-5 border-t border-border">
        <div className="flex items-center gap-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Écrivez un message…"
            className="flex-1 bg-transparent font-body text-sent text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="text-accent disabled:opacity-30 transition-opacity hover:opacity-80 p-2"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Index;
