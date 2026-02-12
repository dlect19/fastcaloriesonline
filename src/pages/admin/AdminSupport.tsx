import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MessageSquare, Send, ArrowLeft, Clock, CheckCircle2, AlertCircle, XCircle,
  User, Store, Bike, Truck, Inbox, Star,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type SupportTicket = Tables<'support_tickets'>;
type SupportMessage = Tables<'support_messages'>;

const CATEGORIES = [
  { value: 'refund', label: 'Refund' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'order_issue', label: 'Order Issue' },
  { value: 'account_issue', label: 'Account' },
  { value: 'payment', label: 'Payment' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'general', label: 'General' },
];

const STATUS_CONFIG = {
  open: { label: 'Open', icon: AlertCircle, color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  resolved: { label: 'Resolved', icon: CheckCircle2, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  closed: { label: 'Closed', icon: XCircle, color: 'bg-muted text-muted-foreground border-border' },
};

const USER_TYPE_ICONS = {
  customer: User,
  vendor: Store,
  rider: Bike,
  logistics: Truck,
};

const RATING_EMOJIS = ['', '😡', '😕', '😐', '😊', '🤩'];
const RATING_LABELS = ['', 'Terrible', 'Poor', 'Okay', 'Good', 'Amazing'];

export default function AdminSupport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [userTypeFilter, setUserTypeFilter] = useState<string>('all');
  const [userProfiles, setUserProfiles] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/admin/auth');
        return;
      }

      // Verify admin role
      const { data: adminStaff } = await supabase
        .from('admin_staff')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!adminStaff) {
        navigate('/admin/auth');
        return;
      }

      setAdminUserId(user.id);
      setLoading(false);
    };
    init();
  }, [navigate]);

  const fetchTickets = useCallback(async () => {
    let query = supabase
      .from('support_tickets')
      .select('*')
      .order('updated_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter as any);
    }
    if (userTypeFilter !== 'all') {
      query = query.eq('user_type', userTypeFilter as any);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching tickets:', error);
      return;
    }
    setTickets(data || []);

    // Fetch user profiles for ticket owners
    const userIds = [...new Set((data || []).map(t => t.user_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      if (profiles) {
        const map: Record<string, string> = {};
        profiles.forEach(p => {
          map[p.user_id] = p.full_name || 'Unknown User';
        });
        setUserProfiles(map);
      }
    }
  }, [statusFilter, userTypeFilter]);

  useEffect(() => {
    if (adminUserId) fetchTickets();
  }, [adminUserId, fetchTickets]);

  // Realtime ticket updates
  useEffect(() => {
    if (!adminUserId) return;

    const channel = supabase
      .channel('admin-support-tickets')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets' },
        () => fetchTickets()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [adminUserId, fetchTickets]);

  // Fetch messages for active ticket
  const fetchMessages = useCallback(async () => {
    if (!activeTicket) return;
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', activeTicket.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }
    setMessages(data || []);

    // Mark user messages as read
    const unreadIds = (data || [])
      .filter(m => !m.is_read && m.sender_type === 'user')
      .map(m => m.id);

    if (unreadIds.length > 0) {
      await supabase
        .from('support_messages')
        .update({ is_read: true })
        .in('id', unreadIds);
    }
  }, [activeTicket]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Realtime messages
  useEffect(() => {
    if (!activeTicket) return;

    const channel = supabase
      .channel(`admin-messages-${activeTicket.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${activeTicket.id}`,
        },
        (payload) => {
          const newMsg = payload.new as SupportMessage;
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeTicket]);

  const handleSendMessage = async () => {
    if (!activeTicket || !adminUserId || !messageInput.trim()) return;

    setSendingMessage(true);
    try {
      const { error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicket.id,
          sender_id: adminUserId,
          sender_type: 'admin',
          message: messageInput.trim(),
        });

      if (error) throw error;
      setMessageInput('');

      // Update ticket status to in_progress if open
      if (activeTicket.status === 'open') {
        await supabase
          .from('support_tickets')
          .update({ status: 'in_progress', assigned_admin_id: adminUserId })
          .eq('id', activeTicket.id);

        setActiveTicket(prev => prev ? { ...prev, status: 'in_progress' as any } : null);
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSendingMessage(false);
    }
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    try {
      await supabase
        .from('support_tickets')
        .update({ status: newStatus as any })
        .eq('id', ticketId);

      if (activeTicket?.id === ticketId) {
        setActiveTicket(prev => prev ? { ...prev, status: newStatus as any } : null);
      }
      fetchTickets();
      toast({ title: `Ticket ${newStatus}` });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />

      <main className="flex-1 ml-0 lg:ml-64">
        {activeTicket ? (
          // Chat View
          <div className="flex flex-col h-screen">
            <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
              <Button variant="ghost" size="icon" onClick={() => setActiveTicket(null)}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{activeTicket.subject}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {userProfiles[activeTicket.user_id] || 'Unknown'}
                  </span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground capitalize">{activeTicket.user_type}</span>
                  <span className="text-xs text-muted-foreground">•</span>
                   <span className="text-xs text-muted-foreground capitalize">
                    {CATEGORIES.find(c => c.value === activeTicket.category)?.label}
                  </span>
                  {activeTicket.rating && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs flex items-center gap-1">
                            <span className="text-muted-foreground">•</span>
                            <span>{RATING_EMOJIS[activeTicket.rating]}</span>
                            <span className="text-muted-foreground">{RATING_LABELS[activeTicket.rating]}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">Customer Review: {activeTicket.rating}/5</p>
                          {activeTicket.rating_comment && (
                            <p className="text-xs mt-1 max-w-[200px]">"{activeTicket.rating_comment}"</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
              <Select
                value={activeTicket.status as string}
                onValueChange={(v) => handleStatusChange(activeTicket.id, v)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3 max-w-3xl mx-auto">
                {messages.map((msg) => {
                  const isAdmin = msg.sender_type === 'admin';
                  return (
                    <div key={msg.id} className={cn('flex', isAdmin ? 'justify-end' : 'justify-start')}>
                      <div className={cn(
                        'max-w-[80%] rounded-2xl px-4 py-2.5',
                        isAdmin
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-muted rounded-bl-md'
                      )}>
                        {!isAdmin && (
                          <p className="text-xs font-medium text-primary mb-1">
                            {userProfiles[msg.sender_id] || 'User'}
                          </p>
                        )}
                        {isAdmin && (
                          <p className="text-xs font-medium text-primary-foreground/80 mb-1">You (Admin)</p>
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                        <p className={cn(
                          'text-[10px] mt-1',
                          isAdmin ? 'text-primary-foreground/70' : 'text-muted-foreground'
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

            <div className="p-4 border-t border-border bg-card">
              <div className="flex gap-2 max-w-3xl mx-auto">
                <Input
                  placeholder="Type your reply..."
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
          </div>
        ) : (
          // Ticket List View
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold">Support Tickets</h1>
                <p className="text-muted-foreground">Manage customer support requests</p>
              </div>
            </div>

            <div className="flex gap-3 mb-6 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={userTypeFilter} onValueChange={setUserTypeFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="User Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="rider">Rider</SelectItem>
                  <SelectItem value="logistics">Logistics</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {tickets.length === 0 ? (
              <Card className="border-0 shadow-soft">
                <CardContent className="p-8 text-center">
                  <Inbox className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-semibold mb-1">No tickets found</h3>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter !== 'all' || userTypeFilter !== 'all'
                      ? 'Try adjusting your filters'
                      : 'No support tickets have been created yet'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {tickets.map((ticket) => {
                  const statusConfig = STATUS_CONFIG[ticket.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.open;
                  const StatusIcon = statusConfig.icon;
                  const UserTypeIcon = USER_TYPE_ICONS[ticket.user_type as keyof typeof USER_TYPE_ICONS] || User;

                  return (
                    <Card
                      key={ticket.id}
                      className="border-0 shadow-soft cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setActiveTicket(ticket)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                              <UserTypeIcon className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium truncate">{ticket.subject}</h4>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-xs text-muted-foreground">
                                  {userProfiles[ticket.user_id] || 'Unknown'}
                                </span>
                                <span className="text-xs text-muted-foreground">•</span>
                                <span className="text-xs text-muted-foreground capitalize">{ticket.user_type}</span>
                                <span className="text-xs text-muted-foreground">•</span>
                                <span className="text-xs text-muted-foreground">
                                  {CATEGORIES.find(c => c.value === ticket.category)?.label}
                                </span>
                                <span className="text-xs text-muted-foreground">•</span>
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(ticket.created_at), 'MMM d, yyyy')}
                                </span>
                                {ticket.rating && (
                                  <>
                                    <span className="text-xs text-muted-foreground">•</span>
                                    <span className="text-xs">{RATING_EMOJIS[ticket.rating]} {RATING_LABELS[ticket.rating]}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <Badge variant="outline" className={cn('text-xs', statusConfig.color)}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusConfig.label}
                            </Badge>
                            {ticket.rating_comment && (
                              <span className="text-[10px] text-muted-foreground max-w-[150px] truncate italic">
                                "{ticket.rating_comment}"
                              </span>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
