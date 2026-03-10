import { Chat } from "@/types/chat";
import { formatChatListTime } from "@/lib/chatUtils";

interface ChatListProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
}

const ChatList = ({ chats, activeChatId, onSelectChat }: ChatListProps) => {
  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-8 pt-10 pb-6">
        <h1 className="font-mono text-meta uppercase tracking-widest text-muted-foreground">
          Messages
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => onSelectChat(chat.id)}
            className={`w-full text-left px-8 py-5 transition-colors border-b border-border
              ${activeChatId === chat.id ? "bg-muted" : "hover:bg-muted/50"}`}
          >
            <div className="flex justify-between items-baseline">
              <span className={`font-body text-sent leading-none ${chat.unread ? "font-bold text-foreground" : ""}`}>
                {chat.name}
              </span>
              <span className="font-mono text-meta uppercase text-muted-foreground ml-4 shrink-0">
                {formatChatListTime(chat.lastTimestamp)}
              </span>
            </div>
            <p className="mt-2 font-serif text-sm text-muted-foreground truncate leading-snug">
              {chat.lastMessage}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ChatList;
