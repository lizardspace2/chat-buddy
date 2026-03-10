import { Chat } from "@/types/chat";

const now = new Date();
const h = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const m = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

export const mockChats: Chat[] = [
  {
    id: "1",
    name: "Elena",
    lastMessage: "I'll be there in twenty minutes",
    lastTimestamp: m(3),
    unread: true,
    messages: [
      { id: "1a", text: "Are you still coming tonight?", sent: true, timestamp: h(4) },
      { id: "1b", text: "Yes. I've been thinking about what you said last week.", sent: false, timestamp: h(3.5) },
      { id: "1c", text: "Which part?", sent: true, timestamp: h(3.4) },
      { id: "1d", text: "About leaving. About what it would mean to actually go.", sent: false, timestamp: h(2) },
      { id: "1e", text: "I didn't mean it like that", sent: true, timestamp: h(1.5) },
      { id: "1f", text: "I know.", sent: false, timestamp: h(1.4) },
      { id: "1g", text: "I know you didn't.", sent: false, timestamp: h(1.39) },
      { id: "1h", text: "Can we talk about it properly? In person?", sent: true, timestamp: m(45) },
      { id: "1i", text: "I'll be there in twenty minutes", sent: false, timestamp: m(3) },
    ],
  },
  {
    id: "2",
    name: "Marcus",
    lastMessage: "The draft is attached",
    lastTimestamp: h(6),
    unread: false,
    messages: [
      { id: "2a", text: "Did you finish the revisions?", sent: true, timestamp: h(26) },
      { id: "2b", text: "Almost. The third section still needs work.", sent: false, timestamp: h(24) },
      { id: "2c", text: "Take your time with it", sent: true, timestamp: h(23) },
      { id: "2d", text: "The draft is attached", sent: false, timestamp: h(6) },
    ],
  },
  {
    id: "3",
    name: "Suki",
    lastMessage: "That restaurant on 5th closed down",
    lastTimestamp: h(48),
    unread: false,
    messages: [
      { id: "3a", text: "Have you been back to the neighborhood recently?", sent: false, timestamp: h(72) },
      { id: "3b", text: "Not since March", sent: true, timestamp: h(70) },
      { id: "3c", text: "That restaurant on 5th closed down", sent: false, timestamp: h(48) },
    ],
  },
  {
    id: "4",
    name: "David",
    lastMessage: "See you Saturday",
    lastTimestamp: h(120),
    unread: false,
    messages: [
      { id: "4a", text: "Happy birthday", sent: true, timestamp: h(122) },
      { id: "4b", text: "Thank you. It's been a strange year.", sent: false, timestamp: h(121) },
      { id: "4c", text: "We should catch up properly", sent: true, timestamp: h(120.5) },
      { id: "4d", text: "See you Saturday", sent: false, timestamp: h(120) },
    ],
  },
];
