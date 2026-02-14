import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MessageSquare, Plus, Send, ArrowLeft, Clock, CheckCircle2, AlertCircle, XCircle, Star, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSupportChat } from '@/hooks/useSupportChat';
import { FAQSection } from '@/components/support/FAQSection';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

type SupportTicket = Tables<'support_tickets'>;

const CATEGORIES = [
  { value: 'refund', label: '💰 Refund Request', emoji: '💰' },
  { value: 'withdrawal', label: '🏦 Withdrawal Issue', emoji: '🏦' },
  { value: 'order_issue', label: '📦 Order Issue', emoji: '📦' },
  { value: 'account_issue', label: '👤 Account Issue', emoji: '👤' },
  { value: 'payment', label: '💳 Payment Problem', emoji: '💳' },
  { value: 'delivery', label: '🚗 Delivery Issue', emoji: '🚗' },
  { value: 'general', label: '💬 General Inquiry', emoji: '💬' },
] as const;

const STATUS_CONFIG = {
  open: { label: 'Open', icon: AlertCircle, color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20', emoji: '🟡' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20', emoji: '🔵' },
  resolved: { label: 'Resolved', icon: CheckCircle2, color: 'bg-green-500/10 text-green-600 border-green-500/20', emoji: '✅' },
  closed: { label: 'Closed', icon: XCircle, color: 'bg-muted text-muted-foreground border-border', emoji: '⚫' },
};

const RATING_EMOJIS = ['😡', '😕', '😐', '😊', '🤩'];
const RATING_LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Amazing!'];

interface SupportPageProps {
  userId: string;
  userType: 'customer' | 'vendor' | 'rider' | 'logistics';
}

export function SupportPage({ userId, userType }: SupportPageProps) {
  const {
    tickets, activeTicket, setActiveTicket, messages,
    loading, sendingMessage, createTicket, sendMessage, fetchTickets,
  } = useSupportChat(userId, userType);

  const { toast } = useToast();
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [creating, setCreating] = useState(false);

  // Review state
  const [hoverRating, setHoverRating] = useState(0);
  const [selectedRating, setSelectedRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reset review state when ticket changes
  useEffect(() => {
    if (activeTicket) {
      setSelectedRating((activeTicket as any).rating || 0);
      setRatingComment((activeTicket as any).rating_comment || '');
    }
  }, [activeTicket]);

  const handleCreateTicket = async () => {
    if (!newCategory || !newSubject.trim() || !newMessage.trim()) return;
    setCreating(true);
    const ticket = await createTicket(newCategory as any, newSubject.trim(), newMessage.trim());
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

  const handleSubmitReview = async () => {
    if (!activeTicket || selectedRating === 0) return;
    setSubmittingReview(true);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({
          rating: selectedRating,
          rating_comment: ratingComment.trim() || null,
          rated_at: new Date().toISOString(),
        } as any)
        .eq('id', activeTicket.id);

      if (error) throw error;

      toast({
        title: '🎉 Thanks for your feedback!',
        description: 'Your review helps us improve our support.',
      });
      fetchTickets();
    } catch (error) {
      console.error('Error submitting review:', error);
      toast({ title: 'Error', description: 'Could not submit review', variant: 'destructive' });
    } finally {
      setSubmittingReview(false);
    }
  };

  const ticketIsCompleted = activeTicket && (activeTicket.status === 'closed' || activeTicket.status === 'resolved');
  const alreadyRated = !!(activeTicket as any)?.rated_at;

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
              <span className="text-xs text-muted-foreground">
                {CATEGORIES.find(c => c.value === activeTicket.category)?.emoji}{' '}
                {CATEGORIES.find(c => c.value === activeTicket.category)?.label?.replace(/^[^\s]+\s/, '')}
              </span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3">
            {/* Greeting bubble */}
            {messages.length > 0 && (
              <div className="flex justify-center mb-4">
                <div className="bg-muted/60 rounded-full px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  Conversation started {format(new Date(activeTicket.created_at), 'MMM d, yyyy')}
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.sender_type === 'user';
              return (
                <div key={msg.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-2 shrink-0 self-end">
                      <span className="text-sm">🎧</span>
                    </div>
                  )}
                  <div className={cn(
                    'max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm',
                    isUser
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted rounded-bl-md'
                  )}>
                    {!isUser && (
                      <p className="text-xs font-medium text-primary mb-1">🛡️ Support Agent</p>
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

        {/* Message Input or Review Section */}
        {!ticketIsCompleted && (
          <div className="p-4 border-t border-border bg-card rounded-b-xl">
            <div className="flex gap-2">
              <Input
                placeholder="Type your message... ✍️"
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

        {ticketIsCompleted && (
          <div className="p-4 border-t border-border bg-card rounded-b-xl">
            {alreadyRated ? (
              <div className="text-center py-3 space-y-2">
                <p className="text-sm text-muted-foreground">
                  ✅ This ticket has been {activeTicket.status}
                </p>
                <div className="flex items-center justify-center gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span key={star} className="text-xl">
                      {star <= (selectedRating || 0) ? RATING_EMOJIS[selectedRating - 1] || '⭐' : '☆'}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  You rated this {RATING_LABELS[(selectedRating || 1) - 1]}
                  {ratingComment && ` — "${ratingComment}"`}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-center">
                  <p className="text-sm font-medium flex items-center justify-center gap-1.5">
                    <Star className="w-4 h-4 text-yellow-500" />
                    How was your support experience?
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your feedback helps us serve you better 💛
                  </p>
                </div>

                {/* Emoji Rating */}
                <div className="flex items-center justify-center gap-3">
                  {RATING_EMOJIS.map((emoji, idx) => {
                    const rating = idx + 1;
                    const isActive = rating === (hoverRating || selectedRating);
                    return (
                      <button
                        key={rating}
                        type="button"
                        className={cn(
                          'text-3xl transition-all duration-200 hover:scale-125',
                          isActive ? 'scale-125 drop-shadow-lg' : 'opacity-50 hover:opacity-100 grayscale hover:grayscale-0'
                        )}
                        onMouseEnter={() => setHoverRating(rating)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => setSelectedRating(rating)}
                        title={RATING_LABELS[idx]}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>

                {selectedRating > 0 && (
                  <p className="text-center text-sm font-medium text-primary animate-in fade-in">
                    {RATING_LABELS[selectedRating - 1]}
                  </p>
                )}

                {selectedRating > 0 && (
                  <div className="space-y-2 animate-in slide-in-from-bottom-2">
                    <Textarea
                      placeholder="Any comments? (optional) 💭"
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      rows={2}
                      maxLength={500}
                      className="text-sm"
                    />
                    <Button
                      onClick={handleSubmitReview}
                      disabled={submittingReview}
                      className="w-full gap-2"
                    >
                      {submittingReview ? 'Submitting...' : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Submit Review
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
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
          <h2 className="text-xl font-bold flex items-center gap-2">
            💬 Support
          </h2>
          <p className="text-sm text-muted-foreground">We're here to help! ✨</p>
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
            <div className="text-5xl mb-3">🤝</div>
            <h3 className="font-semibold mb-1">No support tickets yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Need help? Create a new ticket and our team will assist you 🚀
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
            const catEmoji = CATEGORIES.find(c => c.value === ticket.category)?.emoji || '💬';

            return (
              <Card
                key={ticket.id}
                className="border-0 shadow-soft cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setActiveTicket(ticket)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span className="text-xl mt-0.5">{catEmoji}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{ticket.subject}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(ticket.created_at), 'MMM d, yyyy')}
                          </span>
                          {(ticket as any).rating && (
                            <>
                              <span className="text-xs text-muted-foreground">•</span>
                              <span className="text-xs">
                                {RATING_EMOJIS[((ticket as any).rating || 1) - 1]} Rated
                              </span>
                            </>
                          )}
                        </div>
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

      {/* FAQ Section */}
      <FAQSection userType={userType} />

      {/* New Ticket Dialog */}
      <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              🎫 New Support Ticket
            </DialogTitle>
            <DialogDescription>Tell us what's going on and we'll sort it out! 💪</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="What's this about?" />
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
                placeholder="Describe your issue in detail... 📝"
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
              className="gap-2"
            >
              {creating ? 'Creating...' : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
