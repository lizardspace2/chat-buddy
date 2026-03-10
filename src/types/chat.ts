export interface Message {
  id: string;
  text: string;
  sent: boolean;
  timestamp: Date;
}

export interface Chat {
  id: string;
  name: string;
  lastMessage: string;
  lastTimestamp: Date;
  unread: boolean;
  messages: Message[];
}
