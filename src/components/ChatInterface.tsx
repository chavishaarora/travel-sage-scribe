import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MapPin, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface ChatInterfaceProps {
  user: User | null;
  onLocationSelect: (location: { lat: number; lng: number; name: string }) => void;
}

const ChatInterface = forwardRef<any, ChatInterfaceProps>(({ user, onLocationSelect }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationCreated, setConversationCreated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      createNewConversation();
    }
  }, [user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const createNewConversation = async () => {
    if (!user || conversationCreated) return;

    try {
      const { data: newConv, error: createError } = await supabase
        .from("conversations")
        .insert({ 
          user_id: user.id,
          status: "active"
        })
        .select()
        .single();

      if (createError) throw createError;
      
      setConversationId(newConv.id);
      setConversationCreated(true);

      const welcomeMsg: Message = {
        id: "welcome",
        role: "assistant",
        content: "Hello! I can help you plan your perfect trip. To start, where are you dreaming of going? You can tell me a city, country, or even a general region! 😊",
        created_at: new Date().toISOString(),
      };
      setMessages([welcomeMsg]);
    } catch (error: any) {
      toast.error("Failed to create new conversation");
      console.error(error);
    }
  };

  // Function to render message content with Google Maps links
  const renderMessageContent = (content: string) => {
    // Split content by Google Maps URLs
    const parts = content.split(/(https:\/\/www\.google\.com\/maps\/search\/[^\s]+)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith("https://www.google.com/maps/search/")) {
        // Decode the URL to get readable text
        const encodedQuery = part.split("/search/")[1];
        const decodedQuery = decodeURIComponent(encodedQuery).replace(/\+/g, " ");
        
        return (
          <div key={index} className="my-2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 text-primary hover:text-primary/80"
            >
              <a href={part} target="_blank" rel="noopener noreferrer">
                <MapPin className="h-4 w-4" />
                <span className="text-xs">{decodedQuery}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        );
      }
      
      // Regular text - preserve line breaks and formatting
      if (part.trim()) {
        return (
          <div key={index} className="whitespace-pre-wrap">
            {part}
          </div>
        );
      }
      return null;
    });
  };

  const sendMessage = async (messageText?: string, location?: { lat: number; lng: number; name: string }) => {
    const userMessage = messageText || input.trim();
    
    if (!userMessage || !conversationId || !user) return;

    setInput("");
    setLoading(true);

    try {
      const tempUserMsg: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: userMessage,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: userMessage,
      });

      const messageContext = messages
        .filter(m => m.id !== "welcome")
        .map(m => ({
          role: m.role,
          content: m.content
        }));
      messageContext.push({ role: "user", content: userMessage });

      const { data, error } = await supabase.functions.invoke("travel-chat", {
        body: {
          messages: messageContext,
          conversationId,
        },
      });

      if (error) throw error;

      const assistantMsg: Message = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: data.response,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: data.response,
      });

      // If location was selected, update it
      if (location) {
        onLocationSelect(location);
      }
    } catch (error: any) {
      toast.error("Failed to send message");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Expose sendLocationMessage for parent component
  useImperativeHandle(ref, () => ({
    sendLocationMessage: (message: string, location: { lat: number; lng: number; name: string }) => {
      sendMessage(message, location);
    },
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b bg-muted/50">
        <h2 className="text-lg font-semibold text-foreground">Chat with AI Travel Agent</h2>
        <p className="text-sm text-muted-foreground">Ask questions or click the map to select destinations</p>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <div className="text-sm">
                  {message.role === "assistant" ? (
                    renderMessageContent(message.content)
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="p-4 border-t bg-background">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message or select a location on the map..."
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={() => sendMessage()} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";

export default ChatInterface;