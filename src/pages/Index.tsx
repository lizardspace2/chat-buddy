import { useState, useRef, useEffect } from "react";
import { ArrowUp, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
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

const SYSTEM_PROMPT = {
  role: "system",
  content: "Tu es une secrétaire de cabinet médical. Tes réponses doivent être très courtes, naturelles et professionnelles. Ne fais pas de longues phrases. Pose une seule question à la fois pour aider le patient à prendre rendez-vous (nom, motif, date/heure souhaitée). Ne sois pas trop bavarde, sois concise comme une secrétaire occupée."
};

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const isSendingRef = useRef(false);
  const isListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync scroll on messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });

    // Auto-speak last assistant message
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !isMuted) {
      speak(lastMsg.content);
    }
  }, [messages, isTyping]);

  const speak = (text: string) => {
    // Stop any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Try to find a nice French female voice
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find(v => (v.lang === "fr-FR" || v.lang === "fr_FR") && (v.name.includes("Female") || v.name.includes("Hortense") || v.name.includes("Julie") || v.name.includes("Google")));

    if (frVoice) {
      utterance.voice = frVoice;
    } else {
      utterance.lang = "fr-FR";
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.1; // Slightly higher pitch for a "secretary" feel

    window.speechSynthesis.speak(utterance);
  };

  // Pre-load voices
  useEffect(() => {
    window.speechSynthesis.getVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
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
          messages: [
            SYSTEM_PROMPT,
            ...messages.concat(userMsg).map(m => ({
              role: m.role,
              content: m.content
            }))
          ],
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

  const handleSendRef = useRef(handleSend);
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "fr-FR";

      recognitionRef.current.onresult = (event: any) => {
        let transcript = "";
        let isFinal = false;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            isFinal = true;
          }
        }

        setInput(transcript);

        if (isFinal) {
          handleSendRef.current(transcript);
        }
      };

      recognitionRef.current.onend = () => {
        if (isListeningRef.current) {
          try {
            recognitionRef.current.start();
          } catch (error) {
            console.error("Failed to restart recognition:", error);
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          isListeningRef.current = false;
          setIsListening(false);
          toast.error("Permission micro refusée ou non supportée.");
        }
        // For other errors like 'no-speech', we let onend handle the restart if still active
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      isListeningRef.current = false;
      setIsListening(false);
      recognitionRef.current?.stop();
    } else {
      if (!recognitionRef.current) {
        toast.error("La reconnaissance vocale n'est pas supportée par votre navigateur.");
        return;
      }
      try {
        isListeningRef.current = true;
        setIsListening(true);
        recognitionRef.current.start();
      } catch (error) {
        console.error("Error starting recognition", error);
      }
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen flex flex-col bg-background max-w-3xl mx-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-border flex justify-between items-center">
        <h1 className="font-mono text-meta uppercase tracking-widest text-muted-foreground">
          Assistant LLM
        </h1>
        <button
          onClick={() => {
            setIsMuted(!isMuted);
            if (!isMuted) window.speechSynthesis.cancel();
          }}
          className="text-muted-foreground hover:text-foreground transition-colors p-2"
          title={isMuted ? "Activer le son" : "Couper le son"}
        >
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
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
          <button
            onClick={toggleListening}
            className={`transition-colors p-2 rounded-full ${isListening ? "text-red-500 bg-red-50 animate-pulse" : "text-muted-foreground hover:text-foreground"
              }`}
            title={isListening ? "Arrêter l'écoute" : "Démarrer la dictée vocale"}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={isListening ? "J'écoute..." : "Écrivez un message…"}
            className="flex-1 bg-transparent font-body text-sent text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={() => handleSend()}
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
