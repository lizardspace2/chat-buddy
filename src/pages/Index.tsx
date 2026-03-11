import { useState, useRef, useEffect } from "react";
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, Calendar as CalendarIcon, ClipboardList, MessageSquare, PlusCircle } from "lucide-react";
import TypingIndicator from "@/components/TypingIndicator";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

interface Appointment {
  id: string;
  patientName: string;
  reason: string;
  date: Date;
  status: "confirmed" | "tentative";
}

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const LLM_MODEL = import.meta.env.VITE_GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = {
  role: "system",
  content: "Tu es une secrétaire de cabinet médical. Tes réponses doivent être très courtes, naturelles et professionnelles. Ne fais pas de longues phrases. Pose une seule question à la fois pour aider le patient à prendre rendez-vous (nom, motif, date/heure souhaitée). Ne sois pas trop bavarde, sois concise comme une secrétaire occupée."
};

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string>(() => {
    const saved = localStorage.getItem("chat_session_id");
    if (saved) return saved;
    const newId = crypto.randomUUID();
    localStorage.setItem("chat_session_id", newId);
    return newId;
  });

  // Manual Entry States
  const [isAppDialogOpen, setIsAppDialogOpen] = useState(false);
  const [isSummDialogOpen, setIsSummDialogOpen] = useState(false);
  const [manualApp, setManualApp] = useState({ patientName: "", reason: "", date: "", time: "09:00" });
  const [manualSumm, setManualSumm] = useState("");
  const isSendingRef = useRef(false);
  const isListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial Load from Supabase
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Load messages for current session
        const { data: msgs, error: msgsError } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true });
        if (msgsError) throw msgsError;
        setMessages(msgs.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));

        // Load appointments (we keep appointments global or per session? User said "enregistre l'agenda", usually agenda is global for the doctor, but let's stick to global as requested implicitly by "dashboard clinical")
        const { data: apps, error: appsError } = await supabase
          .from('appointments')
          .select('*');
        if (appsError) throw appsError;
        setAppointments(apps.map(a => ({
          id: a.id,
          patientName: a.patient_name,
          reason: a.reason,
          date: new Date(a.appointment_date),
          status: a.status as any
        })));

        // Load last summary for current session
        const { data: summs, error: summsError } = await supabase
          .from('summaries')
          .select('content')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: false })
          .limit(1);
        if (summsError) throw summsError;
        if (summs && summs.length > 0) setSummary(summs[0].content);

      } catch (err: any) {
        console.error("Supabase load error:", err);
        toast.error("Échec du chargement des données.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

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
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Save User message to Supabase (Background)
    supabase.from('messages').insert([{
      id: userMsg.id,
      role: userMsg.role,
      content: userMsg.content,
      timestamp: userMsg.timestamp.toISOString(),
      session_id: sessionId
    }]).then(({ error }) => {
      if (error) console.error("Supabase message save error:", error);
    });

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
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.choices[0].message.content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Save Assistant message to Supabase (Background)
      supabase.from('messages').insert([{
        id: assistantMsg.id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        timestamp: assistantMsg.timestamp.toISOString(),
        session_id: sessionId
      }]).then(({ error }) => {
        if (error) console.error("Supabase response save error:", error);
      });

      // Auto-analyze for appointment if it sounds like a confirmation
      if (assistantMsg.content.toLowerCase().includes("confirmé") || assistantMsg.content.toLowerCase().includes("noté")) {
        extractAppointment(messages.concat(userMsg, assistantMsg));
      }
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
        // Silently handle 'no-speech' error which is common in continuous mode
        if (event.error === 'no-speech') {
          console.debug("Speech recognition: no speech detected");
          return;
        }

        console.error("Speech recognition error", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          isListeningRef.current = false;
          setIsListening(false);
          toast.error("Permission micro refusée ou non supportée.");
        }
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

  const extractAppointment = async (chatMessages: Message[]) => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: `Tu es un extracteur de données médicales. 
              DATE ACTUELLE : ${currentDate}. 
              Analyse la conversation et extrais les détails du rendez-vous. 
              FORMAT JSON STRICT : { "patientName": string, "reason": string, "date": "YYYY-MM-DD", "time": "HH:mm" }. 
              Si une info est relative (ex: 'demain'), calcule la date exacte basée sur la DATE ACTUELLE. 
              Si absent, mets "inconnu".`
            },
            ...chatMessages.map(m => ({ role: m.role, content: m.content }))
          ],
          response_format: { type: "json_object" }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const details = JSON.parse(data.choices[0].message.content);

        if (details.patientName !== "inconnu" && details.date !== "inconnu") {
          // Normalize date/time
          let appointmentDate: Date;
          try {
            const dateStr = details.date.includes('T') ? details.date : `${details.date} ${details.time !== "inconnu" ? details.time : "09:00"}`;
            appointmentDate = new Date(dateStr);
            if (isNaN(appointmentDate.getTime())) {
              throw new Error("Date invalide");
            }
          } catch (e) {
            console.error("Failed to parse date:", details.date, details.time);
            return;
          }

          const newApp: Appointment = {
            id: crypto.randomUUID(),
            patientName: details.patientName,
            reason: details.reason,
            date: appointmentDate,
            status: "confirmed"
          };
          setAppointments(prev => [...prev, newApp]);
          toast.success(`RDV ajouté : ${details.patientName}`);

          // Save Appointment to Supabase (Background)
          supabase.from('appointments').insert([{
            patient_name: newApp.patientName,
            reason: newApp.reason,
            appointment_date: newApp.date.toISOString(),
            status: newApp.status
          }]).then(({ error }) => {
            if (error) console.error("Supabase appointment save error:", error);
          });
        }
      }
    } catch (err) {
      console.error("Extraction error", err);
    }
  };

  const generateSummary = async () => {
    if (messages.length === 0) return;
    setIsTyping(true);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: "Fais un résumé court (3-4 lignes) et médical de cette discussion pour le médecin traitant. Note les points clés." },
            ...messages.map(m => ({ role: m.role, content: m.content }))
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSummary(data.choices[0].message.content);
        toast.info("Résumé généré pour le médecin");

        // Save Summary to Supabase (Background)
        supabase.from('summaries').insert([{
          content: data.choices[0].message.content,
          session_id: sessionId
        }]).then(({ error }) => {
          if (error) console.error("Supabase summary save error:", error);
        });
      }
    } catch (err) {
      toast.error("Échec du résumé");
    } finally {
      setIsTyping(false);
    }
  };

  const handleManualAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualApp.patientName || !manualApp.date) {
      toast.error("Veuillez remplir au moins le nom et la date.");
      return;
    }

    const appDate = new Date(`${manualApp.date} ${manualApp.time}`);
    const newApp: Appointment = {
      id: crypto.randomUUID(),
      patientName: manualApp.patientName,
      reason: manualApp.reason,
      date: appDate,
      status: "confirmed"
    };

    setAppointments(prev => [...prev, newApp]);
    setIsAppDialogOpen(false);
    setManualApp({ patientName: "", reason: "", date: "", time: "09:00" });
    toast.success("Rendez-vous ajouté manuellement");

    // Save to Supabase
    supabase.from('appointments').insert([{
      patient_name: newApp.patientName,
      reason: newApp.reason,
      appointment_date: newApp.date.toISOString(),
      status: newApp.status
    }]).then(({ error }) => {
      if (error) console.error("Supabase manual appointment save error:", error);
    });
  };

  const handleManualSummary = async () => {
    if (!manualSumm.trim()) return;

    setSummary(manualSumm);
    setIsSummDialogOpen(false);
    setManualSumm("");
    toast.success("Résumé ajouté manuellement");

    // Save to Supabase
    supabase.from('summaries').insert([{
      content: manualSumm,
      session_id: sessionId
    }]).then(({ error }) => {
      if (error) console.error("Supabase manual summary save error:", error);
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  const startNewConversation = async () => {
    if (messages.length > 0) {
      toast.info("Finalisation de la conversation...");
      await generateSummary();
    }

    const newId = crypto.randomUUID();
    setSessionId(newId);
    localStorage.setItem("chat_session_id", newId);
    setMessages([]);
    setSummary("");
    toast.success("Nouvelle conversation démarrée");
  };

  return (
    <div className="h-screen flex flex-col bg-background max-w-5xl mx-auto p-4 relative">
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Synchronisation...</p>
          </div>
        </div>
      )}
      <Tabs defaultValue="chat" className="w-full flex-1 flex flex-col">
        <div className="flex justify-between items-center mb-4 px-2">
          <TabsList className="grid w-[400px] grid-cols-2">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare size={16} /> Chat
            </TabsTrigger>
            <TabsTrigger value="agenda" className="flex items-center gap-2">
              <CalendarIcon size={16} /> Agenda & Résumés
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <button
              onClick={startNewConversation}
              className="flex items-center gap-2 text-xs font-mono uppercase bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 rounded-lg transition-colors"
              title="Démarrer une nouvelle consultation"
            >
              <PlusCircle size={14} /> Nouvelle Consultation
            </button>
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
        </div>

        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col overflow-hidden border-none shadow-none bg-transparent">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
              {messages.length === 0 && (
                <div className="flex-1 flex items-center justify-center h-full text-center py-20">
                  <div className="space-y-4">
                    <p className="font-mono text-meta uppercase text-muted-foreground tracking-widest">
                      Cabinet Médical - Secrétariat
                    </p>
                    <p className="text-xs text-muted-foreground opacity-50 font-mono">
                      Prêt à accueillir un patient
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`max-w-[85%] ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}>
                  {msg.role === "assistant" ? (
                    <div className="bg-received/20 p-4 rounded-2xl rounded-tl-none font-serif text-received text-foreground prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="bg-sent/10 p-4 rounded-2xl rounded-tr-none font-body text-sent text-foreground">
                      {msg.content}
                    </div>
                  )}
                  <span className="font-mono text-[10px] uppercase text-muted-foreground mt-1 px-1 block">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              ))}

              {isTyping && <TypingIndicator />}
            </div>

            <div className="p-4 border-t border-border mt-auto">
              <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-2xl border border-border">
                <button
                  onClick={toggleListening}
                  className={`transition-colors p-3 rounded-full ${isListening ? "text-red-500 bg-red-50 animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  title={isListening ? "Arrêter l'écoute" : "Démarrer la dictée vocale"}
                >
                  {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder={isListening ? "J'écoute..." : "Parlez ou écrivez un message…"}
                  className="flex-1 bg-transparent font-body text-foreground placeholder:text-muted-foreground outline-none px-2"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isTyping}
                  className="bg-primary text-primary-foreground disabled:opacity-30 transition-all hover:scale-105 p-3 rounded-full"
                >
                  <ArrowUp size={20} />
                </button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="agenda" className="flex-1 flex flex-col min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 overflow-hidden">
            <div className="md:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <CalendarIcon size={16} /> Calendrier
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Calendar mode="single" className="rounded-md border shadow-sm" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <ClipboardList size={16} /> Résumé Docteur
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {summary ? (
                    <div className="text-sm font-serif italic text-muted-foreground bg-muted/50 p-4 rounded-lg">
                      {summary}
                    </div>
                  ) : (
                    <p className="text-xs text-center text-muted-foreground py-4">
                      Aucun résumé généré.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Dialog open={isSummDialogOpen} onOpenChange={setIsSummDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-1 gap-2 text-xs">
                          <PlusCircle size={14} /> Saisie
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Saisir un résumé médical</DialogTitle>
                        </DialogHeader>
                        <div className="py-4">
                          <Textarea
                            placeholder="Tapez ici le compte-rendu de la consultation..."
                            className="min-h-[200px]"
                            value={manualSumm}
                            onChange={(e) => setManualSumm(e.target.value)}
                          />
                        </div>
                        <DialogFooter>
                          <Button onClick={handleManualSummary}>Enregistrer</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2 text-xs"
                      onClick={generateSummary}
                      disabled={messages.length === 0 || isTyping}
                    >
                      {isTyping ? "Génération..." : "Générer"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="md:col-span-2 flex flex-col min-h-0">
              <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="border-b border-border bg-muted/20">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground flex items-center justify-between w-full">
                      Prochains Rendez-vous
                      <Dialog open={isAppDialogOpen} onOpenChange={setIsAppDialogOpen}>
                        <DialogTrigger asChild>
                          <PlusCircle
                            size={16}
                            className="cursor-pointer text-primary hover:scale-110 transition-transform"
                            title="Ajouter manuellement"
                          />
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Ajouter un Rendez-vous</DialogTitle>
                          </DialogHeader>
                          <form onSubmit={handleManualAppointment} className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label htmlFor="patient">Nom du Patient</Label>
                              <Input
                                id="patient"
                                required
                                value={manualApp.patientName}
                                onChange={(e) => setManualApp({ ...manualApp, patientName: e.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="reason">Motif</Label>
                              <Input
                                id="reason"
                                value={manualApp.reason}
                                onChange={(e) => setManualApp({ ...manualApp, reason: e.target.value })}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="date">Date</Label>
                                <Input
                                  id="date"
                                  type="date"
                                  required
                                  value={manualApp.date}
                                  onChange={(e) => setManualApp({ ...manualApp, date: e.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="time">Heure</Label>
                                <Input
                                  id="time"
                                  type="time"
                                  value={manualApp.time}
                                  onChange={(e) => setManualApp({ ...manualApp, time: e.target.value })}
                                />
                              </div>
                            </div>
                            <DialogFooter className="pt-4">
                              <Button type="submit">Confirmer le RDV</Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </CardTitle>
                    <span className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full">
                      {appointments.length} RDV
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-6 space-y-4">
                      {appointments.length === 0 ? (
                        <div className="text-center py-20 text-muted-foreground">
                          <p className="text-sm">Aucun rendez-vous enregistré.</p>
                          <p className="text-[10px] uppercase opacity-50 mt-2">Dites à l'IA de confirmer un RDV</p>
                        </div>
                      ) : (
                        appointments.sort((a, b) => a.date.getTime() - b.date.getTime()).map(app => {
                          const isValidDate = !isNaN(app.date.getTime());
                          return (
                            <div key={app.id} className="flex items-center justify-between p-4 border border-border rounded-xl hover:bg-muted/30 transition-colors">
                              <div className="space-y-1">
                                <p className="font-semibold text-foreground">{app.patientName}</p>
                                <p className="text-xs text-muted-foreground">{app.reason}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-mono font-bold text-primary">
                                  {isValidDate ? app.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : "Date à confirmer"}
                                </p>
                                <p className="text-xs font-mono text-muted-foreground">
                                  {isValidDate ? app.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : "--:--"}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;
