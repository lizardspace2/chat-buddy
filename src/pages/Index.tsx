import { useState, useRef, useEffect } from "react";
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, Calendar as CalendarIcon, ClipboardList, MessageSquare, PlusCircle, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Settings, Clock, Trash2, Pencil, Eye } from "lucide-react";
import TypingIndicator from "@/components/TypingIndicator";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  const [allSummaries, setAllSummaries] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "week" | "month">("all");
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => {
    const saved = localStorage.getItem("chat_session_id");
    if (saved) return saved;
    const newId = crypto.randomUUID();
    localStorage.setItem("chat_session_id", newId);
    return newId;
  });
  const [availabilityRanges, setAvailabilityRanges] = useState<any[]>([]);
  const [slotDuration, setSlotDuration] = useState(30); // minutes
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);

  // Manual Entry States
  const [isAppDialogOpen, setIsAppDialogOpen] = useState(false);
  const [isSummDialogOpen, setIsSummDialogOpen] = useState(false);
  const [manualApp, setManualApp] = useState({ patientName: "", reason: "", date: "", time: "09:00" });
  const [manualSumm, setManualSumm] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);
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

        // Load all summaries
        const { data: summs, error: summsError } = await supabase
          .from('summaries')
          .select('*')
          .order('timestamp', { ascending: false });
        if (summsError) throw summsError;

        if (summs && summs.length > 0) {
          // Fetch messages for these summaries manually since there's no explicit FK in the schema
          const sessionIds = summs.map(s => s.session_id).filter(Boolean);
          const { data: allSessionMsgs, error: msgsFetchError } = await supabase
            .from('messages')
            .select('*')
            .in('session_id', sessionIds);

          if (msgsFetchError) console.error("Error fetching history messages:", msgsFetchError);

          // Group messages by session_id
          const msgsBySession = (allSessionMsgs || []).reduce((acc: any, msg: any) => {
            if (!acc[msg.session_id]) acc[msg.session_id] = [];
            acc[msg.session_id].push(msg);
            return acc;
          }, {});

          // Attach sorted messages to summaries
          const summsWithMsgs = summs.map(s => ({
            ...s,
            messages: (msgsBySession[s.session_id] || []).sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          }));

          setAllSummaries(summsWithMsgs);

          // Set current session's summary if it exists
          const currentSumm = summsWithMsgs.find(s => s.session_id === sessionId);
          if (currentSumm) setSummary(currentSumm.content);
        }

        // Load availability ranges
        const { data: avail, error: availError } = await supabase
          .from('availability_ranges')
          .select('*')
          .order('day_of_week', { ascending: true })
          .order('start_time', { ascending: true });
        if (availError) throw availError;
        setAvailabilityRanges(avail || []);

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
        const newDbSumm = { content: data.choices[0].message.content, session_id: sessionId, timestamp: new Date().toISOString() };
        supabase.from('summaries').insert([newDbSumm]).then(({ error }) => {
          if (error) console.error("Supabase summary save error:", error);
          else {
            setAllSummaries(prev => [newDbSumm, ...prev].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
          }
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

    if (editingSummaryId) {
      try {
        const { error } = await supabase
          .from('summaries')
          .update({ content: manualSumm })
          .eq('id', editingSummaryId);

        if (error) throw error;

        setAllSummaries(prev => prev.map(s => s.id === editingSummaryId ? { ...s, content: manualSumm } : s));
        const editedSumm = allSummaries.find(s => s.id === editingSummaryId);
        if (editedSumm && editedSumm.session_id === sessionId) {
          setSummary(manualSumm);
        }

        toast.success("Résumé mis à jour");
        setEditingSummaryId(null);
        setManualSumm("");
        setIsSummDialogOpen(false);
      } catch (err) {
        console.error("Update summary error:", err);
        toast.error("Échec de la mise à jour");
      }
      return;
    }

    setSummary(manualSumm);
    setIsSummDialogOpen(false);

    const summToSave = manualSumm;
    const transcriptToSave = manualTranscript;

    setManualSumm("");
    setManualTranscript("");
    toast.success("Résumé ajouté manuellement");

    // Save to Supabase
    const newDbSumm = { content: summToSave, session_id: sessionId, timestamp: new Date().toISOString() };
    const { data: insertedData, error: insertError } = await supabase
      .from('summaries')
      .insert([newDbSumm])
      .select();

    if (insertError) {
      console.error("Supabase manual summary save error:", insertError);
    } else {
      let fakeMessages: any[] = [];
      if (transcriptToSave.trim()) {
        const lines = transcriptToSave.split('\n').filter(l => l.trim() !== '');
        fakeMessages = lines.map((line, idx) => ({
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: idx % 2 === 0 ? 'user' : 'assistant',
          content: line.trim(),
          timestamp: new Date(Date.now() + idx * 1000).toISOString()
        }));

        const { error: msgError } = await supabase.from('messages').insert(fakeMessages);
        if (msgError) console.error("Failed to save manual transcript:", msgError);
      }

      // Update local history
      const savedSumm = insertedData ? { ...insertedData[0], messages: fakeMessages } : { ...newDbSumm, messages: fakeMessages };
      setAllSummaries(prev => [savedSumm, ...prev].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    }
  };

  const handleDeleteSummary = async (id: string) => {
    try {
      const { error } = await supabase.from('summaries').delete().eq('id', id);
      if (error) throw error;

      const deletedSumm = allSummaries.find(s => s.id === id);
      setAllSummaries(prev => prev.filter(s => s.id !== id));

      if (deletedSumm && deletedSumm.session_id === sessionId) {
        setSummary("");
      }

      toast.success("Résumé supprimé");
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Erreur lors de la suppression");
    }
  };

  const startEditingSummary = (s: any) => {
    setEditingSummaryId(s.id);
    setManualSumm(s.content);
    setManualTranscript(""); // Editing transcript not supported currently to keep it simple
    setIsSummDialogOpen(true);
  };

  const getMonthDays = (date: Date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const days = [];

    // Start from Monday of the first week
    const startPadding = (start.getDay() === 0 ? 6 : start.getDay() - 1);
    const firstDay = new Date(start);
    firstDay.setDate(start.getDate() - startPadding);

    // We want a consistent 6 weeks (42 days) grid
    for (let i = 0; i < 42; i++) {
      const d = new Date(firstDay);
      d.setDate(firstDay.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear();
  };

  const getAvailableSlots = (date: Date) => {
    const dayOfWeek = date.getDay();
    const ranges = availabilityRanges.filter(r => r.day_of_week === dayOfWeek);
    if (ranges.length === 0) return [];

    const slots: Date[] = [];
    ranges.forEach(range => {
      const [startH, startM] = range.start_time.split(':').map(Number);
      const [endH, endM] = range.end_time.split(':').map(Number);

      let current = new Date(date);
      current.setHours(startH, startM, 0, 0);

      const endTime = new Date(date);
      endTime.setHours(endH, endM, 0, 0);

      while (current < endTime) {
        // Check if this slot is already booked
        const isBooked = appointments.some(app =>
          isSameDay(app.date, current) &&
          app.date.getHours() === current.getHours() &&
          app.date.getMinutes() === current.getMinutes()
        );

        if (!isBooked) {
          slots.push(new Date(current));
        }
        current = new Date(current.getTime() + slotDuration * 60000);
      }
    });
    return slots;
  };

  const navigatePrevious = () => {
    if (!selectedDate) return;
    const newDate = new Date(selectedDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() - 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setSelectedDate(newDate);
  };

  const navigateNext = () => {
    if (!selectedDate) return;
    const newDate = new Date(selectedDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setSelectedDate(newDate);
  };

  const navigateToday = () => {
    setSelectedDate(new Date());
  };

  const getWeekDays = (date: Date) => {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay() + (start.getDay() === 0 ? -6 : 1)); // start on Monday
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  };

  // Helper to get a stable color hash from a string (for patient names)
  // Doctolib uses specific saturated pastels
  const DOCTOLIB_COLORS = [
    { bg: '#dcfce7', border: '#22c55e', text: '#166534' }, // Green
    { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' }, // Blue
    { bg: '#f3e8ff', border: '#a855f7', text: '#581c87' }, // Purple
    { bg: '#fce7f3', border: '#ec4899', text: '#831843' }, // Pink
    { bg: '#fef3c7', border: '#f59e0b', text: '#b45309' }, // Yellow/Orange
    { bg: '#e0f2fe', border: '#0ea5e9', text: '#0c4a6e' }, // Light Blue
    { bg: '#ffedd5', border: '#f97316', text: '#9a3412' }, // Orange
    { bg: '#f1f5f9', border: '#64748b', text: '#334155' }, // Slate
  ];

  const getColorPalette = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % DOCTOLIB_COLORS.length;
    return DOCTOLIB_COLORS[index];
  };

  const getStringColor = (str: string) => getColorPalette(str).border;
  const getLightColor = (str: string) => getColorPalette(str).bg;
  const getTextColor = (str: string) => getColorPalette(str).text;

  const handleSaveAvailability = async (newRanges: any[]) => {
    try {
      // Simple strategy: clear and re-insert for recurring slots
      const { error: deleteError } = await supabase.from('availability_ranges').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteError) throw deleteError;

      if (newRanges.length > 0) {
        const { error: insertError } = await supabase.from('availability_ranges').insert(newRanges.map(r => ({
          day_of_week: r.day_of_week,
          start_time: r.start_time,
          end_time: r.end_time
        })));
        if (insertError) throw insertError;
      }

      setAvailabilityRanges(newRanges);
      toast.success("Horaires enregistrés");
      setIsConfigDialogOpen(false);
    } catch (err) {
      console.error("Save availability error:", err);
      toast.error("Échec de l'enregistrement");
    }
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
    <div className="h-screen flex bg-[#f8fafc] w-full overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-[#0066cc] border-t-transparent rounded-full animate-spin"></div>
            <p className="font-mono text-xs uppercase tracking-widest text-slate-500">Synchronisation...</p>
          </div>
        </div>
      )}

      {/* Left Sidebar (Doctolib Style) */}
      <Tabs defaultValue="chat" className="flex-1 flex w-full" orientation="vertical">
        <div className="w-[80px] bg-[#002b5e] flex flex-col items-center py-4 text-white z-30 shadow-xl shrink-0">
          <div className="mb-8 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center font-bold font-serif text-xl border border-white/20">
            D
          </div>

          <TabsList className="flex flex-col gap-6 bg-transparent w-full h-auto p-0">
            <TabsTrigger
              value="chat"
              className="flex flex-col items-center gap-1.5 w-full bg-transparent hover:bg-white/10 data-[state=active]:bg-white/20 py-3 rounded-none transition-colors border-l-4 border-transparent data-[state=active]:border-white"
            >
              <MessageSquare size={20} className="opacity-90" />
              <span className="text-[9px] uppercase tracking-wider font-medium opacity-80">Chat</span>
            </TabsTrigger>

            <TabsTrigger
              value="agenda"
              className="flex flex-col items-center gap-1.5 w-full bg-transparent hover:bg-white/10 data-[state=active]:bg-white/20 py-3 rounded-none transition-colors border-l-4 border-transparent data-[state=active]:border-white"
            >
              <CalendarIcon size={20} className="opacity-90" />
              <span className="text-[9px] uppercase tracking-wider font-medium opacity-80">Agenda</span>
            </TabsTrigger>

            <TabsTrigger
              value="resume"
              className="flex flex-col items-center gap-1.5 w-full bg-transparent hover:bg-white/10 data-[state=active]:bg-white/20 py-3 rounded-none transition-colors border-l-4 border-transparent data-[state=active]:border-white"
            >
              <ClipboardList size={20} className="opacity-90" />
              <span className="text-[9px] uppercase tracking-wider font-medium opacity-80">Résumé</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-auto flex flex-col items-center gap-4 w-full">
            <button
              onClick={startNewConversation}
              className="flex flex-col items-center gap-1.5 w-full hover:bg-white/10 py-3 transition-colors text-[#66b3ff]"
              title="Nouvelle Consultation"
            >
              <PlusCircle size={20} />
              <span className="text-[9px] uppercase tracking-wider font-medium opacity-80">Nouveau</span>
            </button>
            <button
              onClick={() => {
                setIsMuted(!isMuted);
                if (!isMuted) window.speechSynthesis.cancel();
              }}
              className="hover:bg-white/10 py-3 w-full transition-colors flex justify-center opacity-70 hover:opacity-100"
              title={isMuted ? "Activer le son" : "Couper le son"}
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <TabsContent value="chat" className="h-full flex-1 flex-col data-[state=active]:flex min-h-0 m-0 p-0 border-none outline-none">
            <div className="h-full flex flex-col max-w-4xl mx-auto w-full p-4">
              <Card className="flex-1 flex flex-col overflow-hidden border border-border shadow-sm bg-white rounded-2xl">
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
            </div>
          </TabsContent>

          <TabsContent value="resume" className="h-full flex-1 flex-col data-[state=active]:flex min-h-0 m-0 p-0 border-none outline-none">
            <div className="h-full w-full p-8 overflow-y-auto bg-[#f8fafc] flex justify-center">
              <div className="max-w-3xl w-full">
                <div className="flex items-center gap-3 mb-6">
                  <ClipboardList size={24} className="text-[#002b5e]" />
                  <h2 className="text-xl font-bold text-slate-800">Résumés de consultation</h2>
                </div>
                <Card className="p-6 border-slate-200 shadow-sm border">
                  <div className="space-y-6">
                    {summary ? (
                      <div className="text-sm font-serif italic text-slate-700 whitespace-pre-wrap">
                        {summary}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-slate-400">
                        <ClipboardList size={48} className="mx-auto mb-4 opacity-20" />
                        <p>Aucun résumé généré pour la session courante.</p>
                        <p className="text-xs mt-2">Générez un résumé depuis le chat ou saisissez-le manuellement.</p>
                      </div>
                    )}
                    <div className="flex gap-4 pt-4 border-t border-slate-100 flex-col sm:flex-row">
                      <Dialog open={isSummDialogOpen} onOpenChange={(open) => {
                        setIsSummDialogOpen(open);
                        if (!open) {
                          setEditingSummaryId(null);
                          setManualSumm("");
                          setManualTranscript("");
                        }
                      }}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="flex-1 gap-2 border-slate-200 text-slate-700 hover:bg-slate-50">
                            <PlusCircle size={16} /> Saisie Manuelle
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>{editingSummaryId ? "Modifier le résumé médical" : "Saisir un résumé médical"}</DialogTitle>
                          </DialogHeader>
                          <div className="py-4 space-y-4">
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Note Médicale</Label>
                              <Textarea
                                placeholder="Tapez ici le compte-rendu de la consultation..."
                                className="min-h-[150px]"
                                value={manualSumm}
                                onChange={(e) => setManualSumm(e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transcription Complète (Optionnel)</Label>
                              <Textarea
                                placeholder="Collez ici la discussion complète. Chaque ligne sera considérée comme un message alterné (Patient / Secrétariat)."
                                className="min-h-[150px] font-mono text-sm bg-slate-50"
                                value={manualTranscript}
                                onChange={(e) => setManualTranscript(e.target.value)}
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button onClick={handleManualSummary} className="bg-[#002b5e] hover:bg-[#002b5e]/90 text-white">Enregistrer</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      <Button
                        className="flex-1 gap-2 bg-[#002b5e] hover:bg-[#002b5e]/90 text-white"
                        onClick={generateSummary}
                        disabled={messages.length === 0 || isTyping}
                      >
                        {isTyping ? "Génération en cours..." : "Générer depuis le Chat"}
                      </Button>
                    </div>
                  </div>
                </Card>

                {/* History Section */}
                {(allSummaries.length > 0 || historyFilter !== "all") && (
                  <div className="mt-8 space-y-4 pb-12">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                        <ClipboardList size={16} className="text-[#002b5e]" /> Historique des résumés
                      </h3>
                      <div className="flex bg-slate-100/50 rounded-full p-0.5 items-center gap-0 border border-slate-200">
                        <Button
                          variant={historyFilter === "all" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setHistoryFilter("all")}
                          className={`h-7 px-3 text-xs rounded-full transition-all ${historyFilter === "all" ? "bg-[#002b5e] text-white shadow-sm" : "hover:bg-slate-200/50 text-slate-600"}`}
                        >
                          Tout
                        </Button>
                        <Button
                          variant={historyFilter === "month" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setHistoryFilter("month")}
                          className={`h-7 px-3 text-xs rounded-full transition-all ${historyFilter === "month" ? "bg-[#002b5e] text-white shadow-sm" : "hover:bg-slate-200/50 text-slate-600"}`}
                        >
                          Ce mois
                        </Button>
                        <Button
                          variant={historyFilter === "week" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setHistoryFilter("week")}
                          className={`h-7 px-3 text-xs rounded-full transition-all ${historyFilter === "week" ? "bg-[#002b5e] text-white shadow-sm" : "hover:bg-slate-200/50 text-slate-600"}`}
                        >
                          7 derniers jours
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {(() => {
                        const now = new Date();
                        const filtered = allSummaries.filter(s => {
                          if (!s.timestamp) return true;
                          const d = new Date(s.timestamp);
                          if (historyFilter === "month") {
                            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                          }
                          if (historyFilter === "week") {
                            const diff = now.getTime() - d.getTime();
                            return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
                          }
                          return true;
                        });

                        if (filtered.length === 0) {
                          return <p className="text-center text-slate-400 text-sm py-8 bg-white rounded-xl border border-slate-200 border-dashed">Aucun résumé sur cette période.</p>;
                        }

                        const grouped = filtered.reduce((acc, curr) => {
                          const dateKey = curr.timestamp
                            ? new Date(curr.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                            : "Date inconnue";
                          if (!acc[dateKey]) acc[dateKey] = [];
                          acc[dateKey].push(curr);
                          return acc;
                        }, {} as Record<string, any[]>);

                        return Object.entries(grouped).map(([dateKey, groupSumms]) => (
                          <div key={dateKey} className="space-y-3">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase px-3 py-1.5 bg-slate-200/50 rounded-lg inline-block border border-slate-200">
                              {dateKey}
                            </h4>
                            <div className="space-y-3 ml-4 border-l-2 border-slate-200 pl-4">
                              {(groupSumms as any[]).map((s, idx) => (
                                <Card key={idx} className="p-4 border-slate-200 shadow-sm border bg-white relative hover:shadow-md transition-shadow">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-semibold text-slate-500 uppercase">
                                      {s.timestamp ? new Date(s.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : "--:--"}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      {s.session_id === sessionId && (
                                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                                          Active
                                        </span>
                                      )}
                                      <div className="flex items-center gap-1 ml-2">
                                        <button
                                          onClick={() => setExpandedSummaryId(expandedSummaryId === s.id ? null : s.id)}
                                          className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-[#002b5e] transition-colors"
                                          title="Visualiser la transcription"
                                        >
                                          <Eye size={14} />
                                        </button>
                                        <button
                                          onClick={() => startEditingSummary(s)}
                                          className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-amber-600 transition-colors"
                                          title="Modifier"
                                        >
                                          <Pencil size={14} />
                                        </button>
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <button
                                              className="p-1.5 hover:bg-red-50 rounded-md text-slate-400 hover:text-red-600 transition-colors"
                                              title="Supprimer"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>Supprimer le résumé ?</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                Êtes-vous sûr de vouloir supprimer ce résumé ? Cela supprimera également la transcription associée de façon permanente.
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Annuler</AlertDialogCancel>
                                              <AlertDialogAction
                                                onClick={() => handleDeleteSummary(s.id)}
                                                className="bg-red-600 hover:bg-red-700 text-white"
                                              >
                                                Supprimer
                                              </AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="space-y-4">
                                    {/* Summary Block */}
                                    <div className="text-sm font-serif text-slate-700 whitespace-pre-wrap">
                                      {s.content}
                                    </div>

                                    {/* Conversation Block */}
                                    {s.messages && s.messages.length > 0 && (
                                      <div className="pt-2 border-t border-slate-100">
                                        <button
                                          onClick={() => setExpandedSummaryId(expandedSummaryId === s.id ? null : s.id)}
                                          className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-400 hover:text-[#002b5e] transition-colors tracking-wider"
                                        >
                                          {expandedSummaryId === s.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                          Transcription Sécrétariat
                                        </button>

                                        {expandedSummaryId === s.id && (
                                          <div className="mt-2 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-100 max-h-48 overflow-y-auto hidden-scrollbar animate-in fade-in slide-in-from-top-1 duration-200">
                                            {s.messages.map((msg: any) => (
                                              <div key={msg.id} className={`text-[11px] flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] px-2.5 py-1.5 rounded-lg ${msg.role === 'user' ? 'bg-[#002b5e]/10 text-[#002b5e] rounded-tr-none' : 'bg-white border border-slate-200 text-slate-600 rounded-tl-none'}`}>
                                                  <span className="font-bold opacity-50 mr-1">{msg.role === 'user' ? 'Patient:' : 'Secr:'}</span>
                                                  {msg.content}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </Card>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="agenda" className="h-full flex-1 flex-col data-[state=active]:flex min-h-0 m-0 p-0 border-none outline-none">
            <div className="h-full flex flex-col md:flex-row w-full bg-[#f3f4f6] min-h-0">
              {/* Left Panel: Calendars and Summary */}
              <div className="w-[320px] bg-white border-r border-slate-200 shrink-0 flex flex-col shadow-[2px_0_8px_-4px_rgba(0,0,0,0.1)] z-10 overflow-y-auto">
                <div className="p-4 space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest px-2">Mini Calendrier</h3>
                    <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setSelectedDate}
                        className="rounded-xl border-none shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <Dialog open={isConfigDialogOpen} onOpenChange={setIsConfigDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="w-full gap-2 border-slate-200 text-[#002b5e] hover:bg-slate-50 font-semibold shadow-sm">
                          <Settings size={16} /> CONFIGURER AGENDA
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-xl">
                        <DialogHeader>
                          <DialogTitle>Configuration de l'Agenda</DialogTitle>
                        </DialogHeader>
                        <div className="py-4 space-y-6">
                          <div className="space-y-3">
                            <Label className="text-sm font-bold text-slate-700">Durée des créneaux</Label>
                            <div className="flex gap-2">
                              {[15, 20, 30, 45, 60].map(dur => (
                                <Button
                                  key={dur}
                                  variant={slotDuration === dur ? "default" : "outline"}
                                  onClick={() => setSlotDuration(dur)}
                                  className={`flex-1 h-9 ${slotDuration === dur ? "bg-[#002b5e] hover:bg-[#002b5e]/90" : "border-slate-200 text-slate-600"}`}
                                >
                                  {dur} min
                                </Button>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <Label className="text-sm font-bold text-slate-700">Horaires d'ouverture par jour</Label>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[10px] gap-1"
                                onClick={() => {
                                  setAvailabilityRanges([...availabilityRanges, { day_of_week: 1, start_time: "09:00", end_time: "12:00" }]);
                                }}
                              >
                                <PlusCircle size={12} /> AJOUTER UNE PLAGE
                              </Button>
                            </div>

                            <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                              {availabilityRanges.map((range, idx) => (
                                <div key={idx} className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100 group">
                                  <select
                                    className="bg-white border border-slate-200 rounded px-2 py-1 text-sm outline-none focus:border-[#002b5e]"
                                    value={range.day_of_week}
                                    onChange={(e) => {
                                      const next = [...availabilityRanges];
                                      next[idx].day_of_week = parseInt(e.target.value);
                                      setAvailabilityRanges(next);
                                    }}
                                  >
                                    {['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].map((day, dIdx) => (
                                      <option key={dIdx} value={dIdx}>{day}</option>
                                    ))}
                                  </select>
                                  <div className="flex items-center gap-2 flex-1">
                                    <input
                                      type="time"
                                      className="bg-white border border-slate-200 rounded px-2 py-1 text-sm w-full outline-none focus:border-[#002b5e]"
                                      value={range.start_time.substring(0, 5)}
                                      onChange={(e) => {
                                        const next = [...availabilityRanges];
                                        next[idx].start_time = e.target.value;
                                        setAvailabilityRanges(next);
                                      }}
                                    />
                                    <span className="text-slate-400">à</span>
                                    <input
                                      type="time"
                                      className="bg-white border border-slate-200 rounded px-2 py-1 text-sm w-full outline-none focus:border-[#002b5e]"
                                      value={range.end_time.substring(0, 5)}
                                      onChange={(e) => {
                                        const next = [...availabilityRanges];
                                        next[idx].end_time = e.target.value;
                                        setAvailabilityRanges(next);
                                      }}
                                    />
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                    onClick={() => {
                                      setAvailabilityRanges(availabilityRanges.filter((_, i) => i !== idx));
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                </div>
                              ))}
                              {availabilityRanges.length === 0 && (
                                <p className="text-center text-xs text-slate-400 py-4 italic">Aucun horaire défini.</p>
                              )}
                            </div>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            className="bg-[#002b5e] hover:bg-[#002b5e]/90 text-white w-full shadow-md"
                            onClick={() => handleSaveAvailability(availabilityRanges)}
                          >
                            Enregistrer les paramètres
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                </div>
              </div>

              {/* Right Panel: Main Agenda Grid */}
              <div className="flex-1 flex flex-col min-w-0 bg-white">
                <Card className="flex-1 flex flex-col overflow-hidden border-none shadow-none rounded-none bg-white">
                  <CardHeader className="bg-white border-b border-border/50 pb-2 pt-2 px-4 sticky top-0 z-20">
                    <div className="flex justify-between items-center w-full">
                      {/* Left: Navigation */}
                      <div className="flex items-center gap-4">
                        {selectedDate && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={navigateToday}
                              className="h-8 px-4 text-xs font-semibold rounded-full border-slate-300 text-slate-700 hover:bg-slate-50"
                            >
                              Aujourd'hui
                            </Button>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 rounded-full" onClick={navigatePrevious}>
                                <ChevronLeft size={16} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 rounded-full" onClick={navigateNext}>
                                <ChevronRight size={16} />
                              </Button>
                            </div>
                            <div className="text-sm font-semibold text-slate-800 ml-2 capitalize">
                              {viewMode === "day"
                                ? selectedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                                : viewMode === "week"
                                  ? `${getWeekDays(selectedDate)[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}. - ${getWeekDays(selectedDate)[4].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}.`
                                  : selectedDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
                              }
                            </div>
                          </>
                        )}
                      </div>

                      {/* Center: View Toggle */}
                      {selectedDate && (
                        <div className="flex bg-slate-100/50 rounded-full p-0.5 items-center gap-0 border border-slate-200">
                          <Button
                            variant={viewMode === "day" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("day")}
                            className={`h-7 px-4 text-xs rounded-full transition-all ${viewMode === "day" ? "bg-[#002b5e] hover:bg-[#002b5e]/90 text-white font-medium shadow-sm" : "hover:bg-slate-200/50 text-slate-600 font-medium bg-transparent"}`}
                          >
                            Journée
                          </Button>
                          <Button
                            variant={viewMode === "week" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("week")}
                            className={`h-7 px-4 text-xs rounded-full transition-all ${viewMode === "week" ? "bg-[#002b5e] hover:bg-[#002b5e]/90 text-white font-medium shadow-sm" : "hover:bg-slate-200/50 text-slate-600 font-medium bg-transparent"}`}
                          >
                            Semaine
                          </Button>
                          <Button
                            variant={viewMode === "month" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("month")}
                            className={`h-7 px-4 text-xs rounded-full transition-all ${viewMode === "month" ? "bg-[#002b5e] hover:bg-[#002b5e]/90 text-white font-medium shadow-sm" : "hover:bg-slate-200/50 text-slate-600 font-medium bg-transparent"}`}
                          >
                            Mois
                          </Button>
                        </div>
                      )}

                      {/* Right: Actions */}
                      <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedDate(undefined)} className="h-8 px-3 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full">
                          Fermer
                        </Button>
                        <Dialog open={isAppDialogOpen} onOpenChange={setIsAppDialogOpen}>
                          <DialogTrigger asChild>
                            <Button size="sm" className="h-8 bg-[#0066cc] hover:bg-[#0052a3] text-white rounded-md gap-2 font-semibold shadow-none">
                              <PlusCircle size={14} /> TROUVER UN CRÉNEAU
                            </Button>
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
                                <Button type="submit" className="bg-violet-600 hover:bg-violet-700 text-white">Confirmer le RDV</Button>
                              </DialogFooter>
                            </form>
                          </DialogContent>
                        </Dialog>
                        <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-md border border-slate-200">
                          {selectedDate
                            ? (viewMode === "day"
                              ? appointments.filter(a => !isNaN(a.date.getTime()) && isSameDay(a.date, selectedDate)).length
                              : appointments.filter(a => {
                                if (isNaN(a.date.getTime())) return false;
                                const weekDays = getWeekDays(selectedDate);
                                return a.date >= weekDays[0] && a.date <= new Date(weekDays[6].setHours(23, 59, 59, 999));
                              }).length)
                            : appointments.length} RDV
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 flex-1 flex flex-col min-h-0 bg-muted/5 relative">
                    <div className="flex-1 overflow-y-auto overflow-x-hidden">
                      {selectedDate ? (
                        viewMode === "day" ? (
                          <div className="flex flex-col min-h-max">
                            {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                              const hourApps = appointments
                                .filter(app => !isNaN(app.date.getTime()) && isSameDay(app.date, selectedDate) && app.date.getHours() === hour)
                                .sort((a, b) => a.date.getTime() - b.date.getTime());

                              const isWorkingHour = availabilityRanges.some(r =>
                                r.day_of_week === selectedDate.getDay() &&
                                parseInt(r.start_time.split(':')[0]) <= hour &&
                                parseInt(r.end_time.split(':')[0]) > hour
                              );

                              return (
                                <div key={hour} className={`flex border-b border-slate-150 min-h-[80px] group ${isWorkingHour ? 'bg-white' : 'bg-slate-50/70'}`}>
                                  <div className="w-16 border-r border-slate-150 p-2 text-right shrink-0 bg-slate-50/30 relative">
                                    <span className="absolute -top-[9px] right-2 text-xs font-mono text-slate-500 bg-slate-50/50 px-1 tracking-tighter">
                                      {hour.toString().padStart(2, '0')}:00
                                    </span>
                                  </div>
                                  <div className="flex-1 p-2 flex flex-col gap-1.5 relative">
                                    {hourApps.map(app => (
                                      <div
                                        key={app.id}
                                        className="rounded-sm border-l-[4px] p-2 hover:brightness-95 transition-all relative overflow-hidden group/app cursor-pointer"
                                        style={{
                                          backgroundColor: getLightColor(app.patientName),
                                          borderLeftColor: getStringColor(app.patientName)
                                        }}
                                      >
                                        <div className="flex justify-between items-start gap-2 mb-0.5">
                                          <p className="font-bold text-[13px] truncate" style={{ color: getTextColor(app.patientName) }}>{app.patientName}</p>
                                          <span className="text-[11px] font-medium opacity-80" style={{ color: getTextColor(app.patientName) }}>
                                            {app.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        </div>
                                        <p className="text-[11px] font-medium truncate opacity-90" style={{ color: getTextColor(app.patientName) }}>
                                          {app.reason}
                                        </p>
                                      </div>
                                    ))}

                                    {/* Available Slots */}
                                    <div className="flex flex-wrap gap-1.5">
                                      {getAvailableSlots(selectedDate)
                                        .filter(s => s.getHours() === hour)
                                        .map((slot, sIdx) => (
                                          <div
                                            key={sIdx}
                                            onClick={() => {
                                              const dateStr = slot.toISOString().split('T')[0];
                                              const timeStr = slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace('h', ':');
                                              setManualApp({ ...manualApp, date: dateStr, time: timeStr });
                                              setIsAppDialogOpen(true);
                                            }}
                                            className="px-2 py-1 rounded bg-green-50 border border-green-100 text-[#002b5e] text-[10px] font-bold cursor-pointer hover:bg-green-100 transition-colors flex items-center gap-1.5"
                                          >
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                            {slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} • Disponible
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : viewMode === "week" ? (
                          <div className="flex h-full min-h-max bg-white relative">
                            {/* Time Column */}
                            <div className="w-[50px] border-r border-slate-200 shrink-0 bg-white sticky left-0 z-10 flex flex-col">
                              <div className="h-10 border-b border-slate-200 bg-white sticky top-0 z-20"></div> {/* Spacer for header */}
                              {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                                <div key={hour} className="h-20 border-b border-slate-200 px-1 relative">
                                  <span className="absolute -top-2.5 right-1.5 text-[11px] font-medium tracking-tight text-slate-500 bg-white px-0.5">{hour.toString().padStart(2, '0')}:00</span>
                                </div>
                              ))}
                            </div>
                            {/* Days Columns */}
                            <div className="flex-1 flex overflow-x-auto">
                              {getWeekDays(selectedDate).filter((_, i) => i < 5).map((day) => ( // Show Mon-Fri
                                <div key={day.toISOString()} className="flex-1 min-w-[140px] border-r border-slate-200 flex flex-col relative bg-slate-50/20">
                                  <div className="h-10 border-b border-slate-300 flex items-center justify-between px-3 bg-slate-100/80 sticky top-0 z-10 backdrop-blur-sm">
                                    <span className="text-[13px] font-semibold text-slate-700">{day.toLocaleDateString('fr-FR', { weekday: 'short' })}. {day.getDate()}</span>
                                    <span className="text-[10px] text-slate-500 font-medium">10 / 25</span> {/* Example generic capacity */}
                                  </div>
                                  <div className="relative flex-1">
                                    {/* Hourly background lines */}
                                    {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                                      const isWorkingHour = availabilityRanges.some(r =>
                                        r.day_of_week === day.getDay() &&
                                        parseInt(r.start_time.split(':')[0]) <= hour &&
                                        parseInt(r.end_time.split(':')[0]) > hour
                                      );
                                      return (
                                        <div key={`bg-${hour}`} className={`h-20 border-b border-slate-200 w-full ${isWorkingHour ? 'bg-white/80' : 'bg-slate-200/20'}`} />
                                      );
                                    })}
                                    {/* Appointments overlay */}
                                    <div className="absolute inset-0 top-0 left-0 right-0 pointer-events-none">
                                      {/* Confirmed Appointments */}
                                      {appointments
                                        .filter(app => !isNaN(app.date.getTime()) && isSameDay(app.date, day))
                                        .map(app => {
                                          const hour = app.date.getHours();
                                          const minutes = app.date.getMinutes();

                                          // Calculate top offset: hour * 80px (height of slot) + (minutes / 60) * 80px
                                          const topPosition = hour * 80 + (minutes / 60) * 80;
                                          return (
                                            <div
                                              key={app.id}
                                              className="absolute left-[2px] flex flex-col right-[2px] rounded-[3px] text-[11px] p-1.5 overflow-hidden pointer-events-auto cursor-pointer hover:brightness-95 transition-all z-20 group border-l-[4px]"
                                              style={{
                                                top: `${topPosition + 1}px`,
                                                minHeight: '25px', // slightly smaller for tight slots
                                                backgroundColor: getLightColor(app.patientName),
                                                borderLeftColor: getStringColor(app.patientName)
                                              }}
                                              title={`${app.patientName} - ${app.reason}`}
                                            >
                                              <div className="flex gap-1 font-bold truncate leading-tight" style={{ color: getTextColor(app.patientName) }}>
                                                <span className="font-normal opacity-80 whitespace-nowrap">{app.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                                <span className="truncate">{app.patientName}</span>
                                              </div>
                                              <div className="text-[10px] font-medium truncate opacity-90 mt-0.5" style={{ color: getTextColor(app.patientName) }}>{app.reason}</div>
                                            </div>
                                          );
                                        })}

                                      {/* Available Slots Placeholders */}
                                      {getAvailableSlots(day).map((slot, sIdx) => {
                                        const hour = slot.getHours();
                                        const minutes = slot.getMinutes();
                                        const topPosition = hour * 80 + (minutes / 60) * 80;
                                        return (
                                          <div
                                            key={`slot-${sIdx}`}
                                            onClick={() => {
                                              const dateStr = slot.toISOString().split('T')[0];
                                              const timeStr = slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace('h', ':');
                                              setManualApp({ ...manualApp, date: dateStr, time: timeStr });
                                              setIsAppDialogOpen(true);
                                            }}
                                            className="absolute left-[4px] right-[4px] rounded border border-dashed border-green-200 bg-green-50/30 text-[9px] p-1 flex items-center justify-center text-green-600 font-bold pointer-events-auto hover:bg-green-50 hover:border-green-400 transition-all cursor-pointer z-10"
                                            style={{
                                              top: `${topPosition + 2}px`,
                                              height: `${(slotDuration / 60) * 80 - 4}px`,
                                            }}
                                          >
                                            {slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} LIBRE
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col bg-white">
                            {/* Month Header (Day Names) */}
                            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
                                <div key={day} className="py-2 text-center text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                                  {day}
                                </div>
                              ))}
                            </div>
                            {/* Month Grid */}
                            <div className="flex-1 grid grid-cols-7 grid-rows-6">
                              {getMonthDays(selectedDate).map((day, idx) => {
                                const dayApps = appointments.filter(a => !isNaN(a.date.getTime()) && isSameDay(a.date, day));
                                const isCurrentMonth = day.getMonth() === selectedDate.getMonth();
                                const isToday = isSameDay(day, new Date());
                                const hasAvailability = availabilityRanges.some(r => r.day_of_week === day.getDay());

                                return (
                                  <div
                                    key={idx}
                                    onClick={() => { setSelectedDate(day); setViewMode('day'); }}
                                    className={`border-r border-b border-slate-100 p-1.5 min-h-0 flex flex-col gap-1 cursor-pointer hover:bg-slate-50 transition-colors ${!isCurrentMonth ? 'bg-slate-50/50 opacity-40' : hasAvailability ? 'bg-green-50/10' : 'bg-white'}`}
                                  >
                                    <div className="flex justify-between items-center px-1">
                                      <span className={`text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-[#002b5e] text-white shadow-sm' : 'text-slate-500'}`}>
                                        {day.getDate()}
                                      </span>
                                      {dayApps.length > 0 && (
                                        <span className="text-[9px] font-bold text-[#002b5e] bg-blue-50 px-1 rounded">
                                          {dayApps.length}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex-1 overflow-hidden space-y-0.5">
                                      {getAvailableSlots(day).length > 0 && (
                                        <div className="text-[8px] px-1 py-0.5 rounded-sm bg-green-500/10 text-green-700 font-bold border border-green-200/50 mb-1 flex items-center gap-1">
                                          <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                                          DISPONIBILITÉS
                                        </div>
                                      )}
                                      {dayApps.slice(0, 3).map(app => (
                                        <div
                                          key={app.id}
                                          className="text-[9px] px-1 py-0.5 rounded-sm border-l-2 truncate"
                                          style={{
                                            backgroundColor: getLightColor(app.patientName),
                                            borderLeftColor: getStringColor(app.patientName),
                                            color: getTextColor(app.patientName)
                                          }}
                                        >
                                          {app.patientName}
                                        </div>
                                      ))}
                                      {dayApps.length > 3 && (
                                        <div className="text-[9px] text-slate-400 pl-1 font-medium">
                                          + {dayApps.length - 3} de plus
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="p-6 space-y-4">
                          {appointments.length === 0 ? (
                            <div className="text-center py-20 text-muted-foreground bg-background rounded-xl border border-dashed border-border mx-4 mt-4">
                              <p className="text-sm">Aucun rendez-vous enregistré.</p>
                              <p className="text-[10px] uppercase opacity-50 mt-2">Dites à l'IA de confirmer un RDV</p>
                            </div>
                          ) : (
                            appointments.sort((a, b) => a.date.getTime() - b.date.getTime()).map(app => {
                              const isValidDate = !isNaN(app.date.getTime());
                              return (
                                <div key={app.id} className="flex items-center justify-between p-4 bg-background border border-border rounded-xl hover:border-primary/50 hover:shadow-sm transition-all group">
                                  <div className="space-y-1">
                                    <p className="font-semibold text-foreground group-hover:text-primary transition-colors">{app.patientName}</p>
                                    <p className="text-xs text-muted-foreground">{app.reason}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-mono font-bold text-primary">
                                      {isValidDate ? app.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : "Date à confirmer"}
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
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default Index;
