import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, Send, Image as ImageIcon, Mic, MicOff, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { playChatSound } from '@/lib/chatSound';

interface VendorOrderChatProps {
  orderId: string;
  orderNumber: string;
  vendorId: string;
}

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_role: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  created_at: string;
}

export function VendorOrderChat({ orderId, orderNumber, vendorId }: VendorOrderChatProps) {
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

  useEffect(() => {
    if (!orderId) return;

    // Always check unread
    const fetchUnread = async () => {
      const { count } = await supabase
        .from('order_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderId)
        .eq('is_read', false)
        .neq('sender_role', 'vendor');
      setUnreadCount(count || 0);
    };
    fetchUnread();

    const channel = supabase
      .channel(`vendor-chat-${orderId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'order_chat_messages',
        filter: `order_id=eq.${orderId}`,
      }, (payload) => {
        const newMsg = payload.new as ChatMessage;
        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        if (newMsg.sender_role !== 'vendor') {
          playChatSound();
          if (!isOpen) setUnreadCount(prev => prev + 1);
        }
        scrollToBottom();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetchMessages();
    // Mark as read
    supabase
      .from('order_chat_messages')
      .update({ is_read: true })
      .eq('order_id', orderId)
      .neq('sender_role', 'vendor')
      .eq('is_read', false)
      .then(() => setUnreadCount(0));
  }, [isOpen]);

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
      const { data: inserted, error } = await supabase.from('order_chat_messages').insert({
        order_id: orderId,
        sender_id: user.id,
        sender_role: 'vendor',
        message_type: 'text',
        content: newMessage.trim(),
      }).select('*').single();
      if (error) throw error;
      if (inserted) appendMessage(inserted as ChatMessage);
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
      const { data: inserted, error } = await supabase.from('order_chat_messages').insert({
        order_id: orderId,
        sender_id: user.id,
        sender_role: 'vendor',
        message_type: 'image',
        media_url: urlData.publicUrl,
        storage_path: path,
      }).select('*').single();
      if (error) throw error;
      if (inserted) appendMessage(inserted as ChatMessage);
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
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        await uploadVoice(blob);
      };
      mediaRecorder.start();
      setRecording(true);
    } catch { toast({ title: 'Microphone access denied', variant: 'destructive' }); }
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
      const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, blob, { contentType: 'audio/webm' });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);
      const { data: inserted, error } = await supabase.from('order_chat_messages').insert({
        order_id: orderId, sender_id: user.id, sender_role: 'vendor',
        message_type: 'voice', media_url: urlData.publicUrl, storage_path: path,
      }).select('*').single();
      if (error) throw error;
      if (inserted) appendMessage(inserted as ChatMessage);
    } catch (err: any) {
      toast({ title: 'Voice upload failed', description: err.message, variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const getSenderLabel = (msg: ChatMessage) => {
    if (msg.sender_id === user?.id) return 'You';
    return msg.sender_role === 'customer' ? '👤 Customer' : msg.sender_role === 'rider' ? '🏍️ Rider' : msg.sender_role;
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="w-4 h-4 text-primary" />
          Chat with Customer
          {unreadCount > 0 && (
            <span className="bg-destructive text-destructive-foreground text-xs px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </span>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {isOpen && (
        <div className="border-t">
          <div className="max-h-60 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">No messages yet</p>
            ) : messages.map((msg) => {
              const isMe = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
                  <span className="text-[10px] text-muted-foreground mb-0.5">{getSenderLabel(msg)}</span>
                  <div className={cn(
                    'rounded-xl px-3 py-1.5 max-w-[80%] text-sm',
                    isMe ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  )}>
                    {msg.message_type === 'text' && <p>{msg.content}</p>}
                    {msg.message_type === 'image' && msg.media_url && (
                      <img src={msg.media_url} alt="Shared" className="rounded max-w-full max-h-32 object-cover" />
                    )}
                    {msg.message_type === 'voice' && msg.media_url && (
                      <audio controls src={msg.media_url} className="max-w-full h-8" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), 'p')}</span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t p-2 flex items-center gap-1.5">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className={cn('h-7 w-7', recording && 'text-destructive')} onClick={recording ? stopRecording : startRecording} disabled={uploading}>
              {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </Button>
            <Input
              value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message customer..." className="h-7 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && handleSend()} disabled={sending}
            />
            <Button size="icon" className="h-7 w-7" onClick={handleSend} disabled={!newMessage.trim() || sending}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
