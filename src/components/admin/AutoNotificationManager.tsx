import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Clock, Zap, MessageSquare, Loader2, Calendar, Pencil, History, CheckCircle2, XCircle, AlertCircle, Users } from 'lucide-react';
import { EmojiPicker } from '@/components/admin/EmojiPicker';
import { format } from 'date-fns';
import { watLocalToISO, utcToWATLocal } from '@/lib/wat-timezone';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Template {
  id: string;
  category: string;
  target_audience: string;
  title: string;
  body: string;
  url: string;
  is_active: boolean;
  created_at: string;
}

interface NotificationLog {
  id: string;
  schedule_name: string | null;
  template_title: string | null;
  target_audience: string;
  status: string;
  sent_count: number;
  failed_count: number;
  targeted_count: number;
  error_message: string | null;
  created_at: string;
}

interface Schedule {
  id: string;
  name: string;
  target_audience: string;
  category: string | null;
  interval_minutes: number;
  active_hours_start: number;
  active_hours_end: number;
  active_days: number[];
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  last_sent_at: string | null;
  total_sent: number;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All Users' },
  { value: 'customers', label: 'Customers' },
  { value: 'riders', label: 'Riders' },
  { value: 'vendors', label: 'Vendors' },
];

export function AutoNotificationManager() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New/edit template form
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState('engagement');
  const [newTarget, setNewTarget] = useState('all');
  const [newUrl, setNewUrl] = useState('/');

  // New/edit schedule form
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [schedName, setSchedName] = useState('');
  const [schedTarget, setSchedTarget] = useState('all');
  const [schedCategory, setSchedCategory] = useState('');
  const [schedInterval, setSchedInterval] = useState(120);
  const [schedStartHour, setSchedStartHour] = useState(8);
  const [schedEndHour, setSchedEndHour] = useState(21);
  const [schedDays, setSchedDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [schedStartDate, setSchedStartDate] = useState('');
  const [schedEndDate, setSchedEndDate] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const [tRes, sRes] = await Promise.all([
      supabase.from('auto_notification_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('auto_notification_schedules').select('*').order('created_at', { ascending: false }),
    ]);
    setTemplates((tRes.data as Template[]) || []);
    setSchedules((sRes.data as Schedule[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const categories = [...new Set(templates.map(t => t.category))];

  const startEditTemplate = (t: Template) => {
    setEditingTemplate(t);
    setNewTitle(t.title);
    setNewBody(t.body);
    setNewCategory(t.category);
    setNewTarget(t.target_audience);
    setNewUrl(t.url || '/');
  };

  const cancelEdit = () => {
    setEditingTemplate(null);
    setNewTitle(''); setNewBody(''); setNewCategory('engagement'); setNewTarget('all'); setNewUrl('/');
  };

  const saveTemplate = async () => {
    if (!newTitle.trim() || !newBody.trim()) {
      toast({ title: 'Fill in title and message', variant: 'destructive' });
      return;
    }
    setSaving(true);
    if (editingTemplate) {
      const { error } = await supabase.from('auto_notification_templates').update({
        title: newTitle.trim(),
        body: newBody.trim(),
        category: newCategory.trim() || 'general',
        target_audience: newTarget,
        url: newUrl.trim() || '/',
      }).eq('id', editingTemplate.id);
      if (error) {
        toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Template updated!' });
        cancelEdit();
        fetchData();
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('auto_notification_templates').insert({
        title: newTitle.trim(),
        body: newBody.trim(),
        category: newCategory.trim() || 'general',
        target_audience: newTarget,
        url: newUrl.trim() || '/',
        created_by: user!.id,
      });
      if (error) {
        toast({ title: 'Failed to add', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Template added!' });
        setNewTitle(''); setNewBody(''); setNewUrl('/');
        fetchData();
      }
    }
    setSaving(false);
  };

  const toggleTemplate = async (id: string, active: boolean) => {
    await supabase.from('auto_notification_templates').update({ is_active: active }).eq('id', id);
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, is_active: active } : t));
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from('auto_notification_templates').delete().eq('id', id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    toast({ title: 'Template deleted' });
  };

  const startEditSchedule = (s: Schedule) => {
    setEditingSchedule(s);
    setSchedName(s.name);
    setSchedTarget(s.target_audience);
    setSchedCategory(s.category || '');
    setSchedInterval(s.interval_minutes);
    setSchedStartHour(s.active_hours_start);
    setSchedEndHour(s.active_hours_end);
    setSchedDays(s.active_days || [0, 1, 2, 3, 4, 5, 6]);
    setSchedStartDate(utcToWATLocal(s.starts_at));
    setSchedEndDate(s.ends_at ? utcToWATLocal(s.ends_at) : '');
  };

  const cancelEditSchedule = () => {
    setEditingSchedule(null);
    setSchedName(''); setSchedTarget('all'); setSchedCategory('');
    setSchedInterval(120); setSchedStartHour(8); setSchedEndHour(21);
    setSchedDays([0, 1, 2, 3, 4, 5, 6]); setSchedStartDate(''); setSchedEndDate('');
  };

  const saveSchedule = async () => {
    if (!schedName.trim()) {
      toast({ title: 'Enter a schedule name', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const startsAtIso = schedStartDate ? watLocalToISO(schedStartDate) : new Date().toISOString();
    const endsAtIso = schedEndDate ? watLocalToISO(schedEndDate) : null;

    const payload = {
      name: schedName.trim(),
      target_audience: schedTarget,
      category: schedCategory || null,
      interval_minutes: schedInterval,
      active_hours_start: schedStartHour,
      active_hours_end: schedEndHour,
      active_days: schedDays,
      starts_at: startsAtIso,
      ends_at: endsAtIso,
    };

    if (editingSchedule) {
      const { error } = await supabase
        .from('auto_notification_schedules')
        .update({
          ...payload,
          last_sent_at: null,
        })
        .eq('id', editingSchedule.id);
      if (error) {
        toast({ title: 'Failed to update schedule', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Schedule updated! Timer reset.' });
        cancelEditSchedule();
        fetchData();
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('auto_notification_schedules').insert({
        ...payload,
        created_by: user!.id,
      });
      if (error) {
        toast({ title: 'Failed to add schedule', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Schedule created!' });
        cancelEditSchedule();
        fetchData();
      }
    }
    setSaving(false);
  };

  const toggleSchedule = async (id: string, active: boolean) => {
    await supabase.from('auto_notification_schedules').update({ is_active: active }).eq('id', id);
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, is_active: active } : s));
  };

  const deleteSchedule = async (id: string) => {
    await supabase.from('auto_notification_schedules').delete().eq('id', id);
    setSchedules(prev => prev.filter(s => s.id !== id));
    toast({ title: 'Schedule deleted' });
  };

  const toggleDay = (day: number) => {
    setSchedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Add Template */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="w-5 h-5 text-primary" />
            Preset Notification Messages
          </CardTitle>
          <CardDescription>Create message templates that will be randomly picked and sent automatically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input placeholder="e.g. engagement, promo, tips" value={newCategory} onChange={e => setNewCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Target Audience</Label>
              <Select value={newTarget} onValueChange={setNewTarget}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIENCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <div className="flex gap-2">
              <Input placeholder="e.g. 🍔 Hungry? We've got you!" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="flex-1" />
              <EmojiPicker onSelect={emoji => setNewTitle(p => p + emoji)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <div className="flex gap-2 items-start">
              <Textarea placeholder="e.g. Check out today's top-rated meals near you!" value={newBody} onChange={e => setNewBody(e.target.value)} rows={2} className="flex-1" />
              <EmojiPicker onSelect={emoji => setNewBody(p => p + emoji)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Link (optional)</Label>
            <Input placeholder="e.g. /explore" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveTemplate} disabled={saving || !newTitle.trim() || !newBody.trim()}>
              <Plus className="w-4 h-4 mr-1" /> {editingTemplate ? 'Update Template' : 'Add Template'}
            </Button>
            {editingTemplate && (
              <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
            )}
          </div>

          {/* Templates list */}
          {templates.length > 0 && (
            <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
              {templates.map(t => (
                <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                  <Switch checked={t.is_active} onCheckedChange={v => toggleTemplate(t.id, v)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.body}</p>
                    <div className="flex gap-1.5 mt-1">
                      <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                      <Badge variant="outline" className="text-[10px]">{t.target_audience}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="text-primary h-7 w-7" onClick={() => startEditTemplate(t)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => deleteTemplate(t.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="w-5 h-5 text-primary" />
            Auto-Send Schedules
          </CardTitle>
          <CardDescription>Configure when and how often to auto-send random notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Schedule Name</Label>
              <Input placeholder="e.g. Customer Engagement" value={schedName} onChange={e => setSchedName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Target Audience</Label>
              <Select value={schedTarget} onValueChange={setSchedTarget}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIENCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category Filter (optional)</Label>
              <Select value={schedCategory || '__all__'} onValueChange={v => setSchedCategory(v === '__all__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Send Every (minutes)</Label>
              <Select value={String(schedInterval)} onValueChange={v => setSchedInterval(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
                  <SelectItem value="180">3 hours</SelectItem>
                  <SelectItem value="360">6 hours</SelectItem>
                  <SelectItem value="720">12 hours</SelectItem>
                  <SelectItem value="1440">24 hours</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Auto-send checks every 5 minutes; interval is counted from the last successful delivery.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Active Hours (WAT)</Label>
              <div className="flex items-center gap-2">
                <Select value={String(schedStartHour)} onValueChange={v => setSchedStartHour(Number(v))}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">to</span>
                <Select value={String(schedEndHour)} onValueChange={v => setSchedEndHour(Number(v))}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Active Days</Label>
            <div className="flex gap-1.5 flex-wrap">
              {DAY_NAMES.map((name, i) => (
                <Button
                  key={i}
                  variant={schedDays.includes(i) ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 w-12 text-xs"
                  onClick={() => toggleDay(i)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="datetime-local" value={schedStartDate} onChange={e => setSchedStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date (optional)</Label>
              <Input type="datetime-local" value={schedEndDate} onChange={e => setSchedEndDate(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={saveSchedule} disabled={saving || !schedName.trim()}>
              <Zap className="w-4 h-4 mr-1" /> {editingSchedule ? 'Update Schedule' : 'Create Schedule'}
            </Button>
            {editingSchedule && (
              <Button variant="outline" onClick={cancelEditSchedule}>Cancel</Button>
            )}
          </div>

          {/* Schedules list */}
          {schedules.length > 0 && (
            <div className="mt-4 space-y-2">
              {schedules.map(s => (
                <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                  <Switch checked={s.is_active} onCheckedChange={v => toggleSchedule(s.id, v)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Every {s.interval_minutes >= 60 ? `${s.interval_minutes / 60}h` : `${s.interval_minutes}min`}
                      {' • '}{s.active_hours_start}:00–{s.active_hours_end}:00 WAT
                      {' • '}{s.target_audience}
                      {s.category && ` • ${s.category}`}
                    </p>
                    <div className="flex gap-1.5 mt-1 flex-wrap items-center">
                      <Badge variant="outline" className="text-[10px]">
                        <Calendar className="w-3 h-3 mr-0.5" />
                        {(s.active_days || []).map(d => DAY_NAMES[d]).join(', ')}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {s.total_sent || 0} sent
                      </Badge>
                      {s.last_sent_at && (
                        <span className="text-[10px] text-muted-foreground">
                          Last: {format(new Date(s.last_sent_at), 'MMM d, HH:mm')}
                        </span>
                      )}
                      {s.ends_at && (
                        <span className="text-[10px] text-muted-foreground">
                          Ends: {format(new Date(s.ends_at), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="text-primary h-7 w-7" onClick={() => startEditSchedule(s)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => deleteSchedule(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
