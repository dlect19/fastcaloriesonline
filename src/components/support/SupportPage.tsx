import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MessageSquare, Plus, Send, ArrowLeft, Clock, CheckCircle2, AlertCircle, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSupportChat } from '@/hooks/useSupportChat';
import type { Tables } from '@/integrations/supabase/types';
import { format } from 'date-fns';

type SupportTicket = Tables<'support_tickets'>;

const CATEGORIES = [
  { value: 'refund', label: 'Refund Request' },
  { value: 'withdrawal', label: 'Withdrawal Issue' },
  { value: 'order_issue', label: 'Order Issue' },
  { value: 'account_issue', label: 'Account Issue' },
  { value: 'payment', label: 'Payment Problem' },
  { value: 'delivery', label: 'Delivery Issue' },
  { value: 'general', label: 'General Inquiry' },
] as const;

const STATUS_CONFIG = {
  open: { label: 'Open', icon: AlertCircle, color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  resolved: { label: 'Resolved', icon: CheckCircle2, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  closed: { label: 'Closed', icon: XCircle, color: 'bg-muted text-muted-foreground border-border' },
};

interface SupportPageProps {
  userId: string;
  userType: 'customer' | 'vendor' | 'rider' | 'logistics';
}

export function SupportPage({ userId, userType }: SupportPageProps) {
  const {
    tickets, activeTicket, setActiveTicket, messages,
    loading, sendingMessage, createTicket, sendMessage,
  } = useSupportChat(userId, userType);

  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [creating, setCreating] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateTicket = async () => {
    if (!newCategory || !newSubject.trim() || !newMessage.trim()) return;
    setCreating(true);
    const ticket = await createTicket(
      newCategory as any,
      newSubject.trim(),
      newMessage.trim()
    );
    if (ticket) {
      setShowNewTicket(false);
      setNewCategory('');
      setNewSubject('');
      setNewMessage('');
    }
    setCreating(false);
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim()) return;
    const msg = messageInput;
    setMessageInput('');
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Chat view
  if (activeTicket) {
    const statusConfig = STATUS_CONFIG[activeTicket.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.open;
    const StatusIcon = statusConfig.icon;

    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Chat Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border bg-card rounded-t-xl">
          <Button variant="ghost" size="icon" onClick={() => setActiveTicket(null)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">{activeTicket.subject}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className={cn('text-xs', statusConfig.color)}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {statusConfig.label}
              </Badge>
              <span className="text-xs text-muted-foreground capitalize">
                {CATEGORIES.find(c => c.value === activeTicket.category)?.label}
              </span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3">
            {messages.map((msg) => {
              const isUser = msg.sender_type === 'user';
              return (
                <div key={msg.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-2.5',
                    isUser
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted rounded-bl-md'
                  )}>
                    {!isUser && (
                      <p className="text-xs font-medium text-primary mb-1">Support Agent</p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                    <p className={cn(
                      'text-[10px] mt-1',
                      isUser ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}>
                      {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Message Input */}
        {activeTicket.status !== 'closed' && activeTicket.status !== 'resolved' && (
          <div className="p-4 border-t border-border bg-card rounded-b-xl">
            <div className="flex gap-2">
              <Input
                placeholder="Type your message..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sendingMessage}
                className="flex-1"
                maxLength={2000}
              />
              <Button
                size="icon"
                onClick={handleSendMessage}
                disabled={sendingMessage || !messageInput.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {(activeTicket.status === 'closed' || activeTicket.status === 'resolved') && (
          <div className="p-4 border-t border-border bg-muted/50 rounded-b-xl text-center">
            <p className="text-sm text-muted-foreground">This ticket has been {activeTicket.status}.</p>
          </div>
        )}
      </div>
    );
  }

  // Ticket List View
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Support</h2>
          <p className="text-sm text-muted-foreground">Get help with your issues</p>
        </div>
        <Button onClick={() => setShowNewTicket(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Ticket
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-0 shadow-soft animate-pulse">
              <CardContent className="p-4">
                <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <Card className="border-0 shadow-soft">
          <CardContent className="p-8 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No support tickets</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Need help? Create a new support ticket and we'll get back to you.
            </p>
            <Button onClick={() => setShowNewTicket(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Create Ticket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const statusConfig = STATUS_CONFIG[ticket.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.open;
            const StatusIcon = statusConfig.icon;

            return (
              <Card
                key={ticket.id}
                className="border-0 shadow-soft cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setActiveTicket(ticket)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{ticket.subject}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground capitalize">
                          {CATEGORIES.find(c => c.value === ticket.category)?.label}
                        </span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(ticket.created_at), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('text-xs shrink-0', statusConfig.color)}>
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {statusConfig.label}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Ticket Dialog */}
      <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Support Ticket</DialogTitle>
            <DialogDescription>Select a category and describe your issue.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                placeholder="Brief description of your issue"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label>Message *</Label>
              <Textarea
                placeholder="Describe your issue in detail..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={4}
                maxLength={2000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTicket(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateTicket}
              disabled={creating || !newCategory || !newSubject.trim() || !newMessage.trim()}
            >
              {creating ? 'Creating...' : 'Submit Ticket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
