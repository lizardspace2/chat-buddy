import { useState, useRef, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import TypingIndicator from "@/components/TypingIndicator";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const SIMULATED_RESPONSES = [
  "C'est une question intéressante. Laisse-moi y réfléchir un instant.\n\nJe pense que la meilleure approche serait de commencer par les fondamentaux, puis d'itérer progressivement.",
  "Bien sûr ! Voici ce que je te propose :\n\n1. **Première étape** — Définir clairement l'objectif\n2. **Deuxième étape** — Identifier les contraintes\n3. **Troisième étape** — Prototyper rapidement",
  "Je comprends tout à fait. N'hésite pas à me donner plus de détails si tu veux que j'approfondisse un point en particulier.",
  "Excellente idée. Si tu veux, je peux t'aider à structurer ça de manière plus détaillée.",
  "Voilà une piste de réflexion. Le plus important est de rester pragmatique et d'avancer pas à pas.",
];

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Simulate AI response
    const delay = 1200 + Math.random() * 2000;
    setTimeout(() => {
      const response = SIMULATED_RESPONSES[Math.floor(Math.random() * SIMULATED_RESPONSES.length)];
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, delay);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen flex flex-col bg-background max-w-3xl mx-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-border">
        <h1 className="font-mono text-meta uppercase tracking-widest text-muted-foreground">
          Assistant
        </h1>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center h-full">
            <p className="font-mono text-meta uppercase text-muted-foreground tracking-widest">
              Commencez une conversation
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`max-w-[80%] ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}>
            {msg.role === "assistant" ? (
              <div className="font-serif text-received text-foreground prose prose-sm max-w-none">
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
            className="text-accent disabled:opacity-30 transition-opacity hover:opacity-80"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Index;
