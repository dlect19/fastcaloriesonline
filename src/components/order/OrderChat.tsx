import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, Send, Image as ImageIcon, Mic, MicOff, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface OrderChatProps {
  orderId: string;
  orderStatus: string;
  riderId: string | null;
  vendorId: string;
  senderRole: 'customer' | 'vendor' | 'rider';
}

interface ChatMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  is_read: boolean;
  created_at: string;
}

export function OrderChat({ orderId, orderStatus, riderId, vendorId, senderRole }: OrderChatProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Determine who the chat partner is based on order stage
  const chatPartnerRole = riderId && ['picked_up', 'on_the_way'].includes(orderStatus) ? 'rider' : 'vendor';

  // Chat is enabled from "preparing" onwards until "delivered"
  const isChatEnabled = ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way'].includes(orderStatus);

  useEffect(() => {
    if (!orderId || !isOpen) return;
    fetchMessages();

    const channel = supabase
      .channel(`chat-${orderId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'order_chat_messages',
        filter: `order_id=eq.${orderId}`,
      }, (payload) => {
        const newMsg = payload.new as ChatMessage;
        setMessages(prev => [...prev, newMsg]);
        scrollToBottom();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId, isOpen]);

  // Count unread when closed
  useEffect(() => {
    if (!orderId || isOpen) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from('order_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderId)
        .eq('is_read', false)
        .neq('sender_id', user?.id || '');
      setUnreadCount(count || 0);
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, [orderId, isOpen, user?.id]);

  // Mark messages as read when opened
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    supabase
      .from('order_chat_messages')
      .update({ is_read: true })
      .eq('order_id', orderId)
      .neq('sender_id', user.id)
      .eq('is_read', false)
      .then(() => setUnreadCount(0));
  }, [isOpen, messages.length]);

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('order_chat_messages')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    setMessages((data as ChatMessage[]) || []);
    setTimeout(scrollToBottom, 100);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !user || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.from('order_chat_messages').insert({
        order_id: orderId,
        sender_id: user.id,
        sender_role: senderRole,
        message_type: 'text',
        content: newMessage.trim(),
      });
      if (error) throw error;
      setNewMessage('');
    } catch (err: any) {
      toast({ title: 'Failed to send', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${orderId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);

      const { error } = await supabase.from('order_chat_messages').insert({
        order_id: orderId,
        sender_id: user.id,
        sender_role: senderRole,
        message_type: 'image',
        media_url: urlData.publicUrl,
        storage_path: path,
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        await uploadVoice(blob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      toast({ title: 'Microphone access denied', variant: 'destructive' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const uploadVoice = async (blob: Blob) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/${orderId}/voice_${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(path, blob, { contentType: 'audio/webm' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);

      const { error } = await supabase.from('order_chat_messages').insert({
        order_id: orderId,
        sender_id: user.id,
        sender_role: senderRole,
        message_type: 'voice',
        media_url: urlData.publicUrl,
        storage_path: path,
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ title: 'Voice upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const getSenderLabel = (msg: ChatMessage) => {
    if (msg.sender_id === user?.id) return 'You';
    switch (msg.sender_role) {
      case 'vendor': return '🏪 Vendor';
      case 'rider': return '🏍️ Rider';
      case 'customer': return '👤 Customer';
      default: return msg.sender_role;
    }
  };

  if (!isChatEnabled) return null;

  // Collapsed state - just show a chat bubble
  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 z-30 rounded-full w-14 h-14 shadow-lg"
        size="icon"
      >
        <MessageSquare className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-16 right-2 left-2 sm:left-auto sm:right-4 sm:w-96 z-40 shadow-2xl max-h-[70vh] flex flex-col">
      <CardHeader className="py-3 px-4 flex-row items-center justify-between border-b">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          Chat with {chatPartnerRole === 'rider' ? 'Rider' : 'Vendor'}
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>

      {/* Transition notice */}
      {riderId && chatPartnerRole === 'rider' && (
        <div className="px-3 py-1.5 bg-primary/10 text-xs text-primary text-center">
          🏍️ Rider assigned — chat transferred to your delivery rider
        </div>
      )}

      <CardContent className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px] max-h-[40vh]">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            return (
              <div key={msg.id} className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
                <span className="text-[10px] text-muted-foreground mb-0.5">
                  {getSenderLabel(msg)}
                </span>
                <div className={cn(
                  'rounded-2xl px-3 py-2 max-w-[80%] text-sm',
                  isMe
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm'
                )}>
                  {msg.message_type === 'text' && <p>{msg.content}</p>}
                  {msg.message_type === 'image' && msg.media_url && (
                    <img src={msg.media_url} alt="Shared" className="rounded-lg max-w-full max-h-48 object-cover" />
                  )}
                  {msg.message_type === 'voice' && msg.media_url && (
                    <audio controls src={msg.media_url} className="max-w-full h-8" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {format(new Date(msg.created_at), 'p')}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </CardContent>

      {/* Input area */}
      <div className="border-t p-2 flex items-center gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 shrink-0', recording && 'text-destructive')}
          onClick={recording ? stopRecording : startRecording}
          disabled={uploading}
        >
          {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="h-8 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled={sending}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleSend}
          disabled={!newMessage.trim() || sending}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}
