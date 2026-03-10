import { useState } from "react";
import { mockChats } from "@/data/mockChats";
import { Chat } from "@/types/chat";
import ChatList from "@/components/ChatList";
import ChatView from "@/components/ChatView";

const Index = () => {
  const [chats, setChats] = useState<Chat[]>(mockChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  const handleSendMessage = (chatId: string, text: string) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [
                ...chat.messages,
                {
                  id: `${chatId}-${Date.now()}`,
                  text,
                  sent: true,
                  timestamp: new Date(),
                },
              ],
              lastMessage: text,
              lastTimestamp: new Date(),
            }
          : chat
      )
    );
  };

  return (
    <div className="h-screen flex bg-background">
      {/* Chat list - hidden on mobile when chat is open */}
      <div className={`w-full md:w-80 lg:w-96 shrink-0 ${activeChatId ? "hidden md:block" : ""}`}>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={(id) => setActiveChatId(id)}
        />
      </div>

      {/* Chat view */}
      <div className={`flex-1 ${!activeChatId ? "hidden md:flex" : "flex"}`}>
        {activeChat ? (
          <div className="flex-1">
            <ChatView
              chat={activeChat}
              onBack={() => setActiveChatId(null)}
              onSendMessage={handleSendMessage}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mono text-meta uppercase text-muted-foreground tracking-widest">
              Select a conversation
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
