import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Leaf, Plus, Pencil, Trash2, GripVertical } from 'lucide-react';

const PLATFORMS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'customer', label: 'Customer' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'rider', label: 'Rider' },
  { value: 'delivery_company', label: 'Delivery Company' },
];

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'orders', label: 'Orders' },
  { value: 'payments', label: 'Payments' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'account', label: 'Account' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'promos', label: 'Promos & Rewards' },
];

interface FAQ {
  id: string;
  question: string;
  answer: string;
  platform: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export default function AdminFAQ() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<FAQ | null>(null);
  const [filterPlatform, setFilterPlatform] = useState('all');

  // Form state
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [platform, setPlatform] = useState('all');
  const [category, setCategory] = useState('general');
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/admin/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    fetchFaqs();
  }, []);

  const fetchFaqs = async () => {
    const { data, error } = await supabase
      .from('faqs')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (!error && data) setFaqs(data as FAQ[]);
    setLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setQuestion('');
    setAnswer('');
    setPlatform('all');
    setCategory('general');
    setSortOrder(faqs.length);
    setIsActive(true);
    setShowDialog(true);
  };

  const openEdit = (faq: FAQ) => {
    setEditing(faq);
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setPlatform(faq.platform);
    setCategory(faq.category);
    setSortOrder(faq.sort_order);
    setIsActive(faq.is_active);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!question.trim() || !answer.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from('faqs')
          .update({ question: question.trim(), answer: answer.trim(), platform, category, sort_order: sortOrder, is_active: isActive })
          .eq('id', editing.id);
        if (error) throw error;
        toast({ title: 'FAQ updated' });
      } else {
        const { error } = await supabase
          .from('faqs')
          .insert({ question: question.trim(), answer: answer.trim(), platform, category, sort_order: sortOrder, is_active: isActive, created_by: user?.id });
        if (error) throw error;
        toast({ title: 'FAQ created' });
      }
      setShowDialog(false);
      fetchFaqs();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this FAQ?')) return;
    const { error } = await supabase.from('faqs').delete().eq('id', id);
    if (!error) {
      toast({ title: 'FAQ deleted' });
      fetchFaqs();
    }
  };

  const filtered = faqs.filter(f => filterPlatform === 'all' ? true : f.platform === filterPlatform || f.platform === 'all');

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
          <Leaf className="w-9 h-9 text-primary-foreground" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <AdminLayout>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">FAQ Management</h1>
            <p className="text-muted-foreground">Manage frequently asked questions for all platforms</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Add FAQ
          </Button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <Label>Filter by platform:</Label>
          <Select value={filterPlatform} onValueChange={setFilterPlatform}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary">{filtered.length} FAQs</Badge>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse"><CardContent className="p-4"><div className="h-5 bg-muted rounded w-3/4 mb-2" /><div className="h-4 bg-muted rounded w-1/2" /></CardContent></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No FAQs yet. Click "Add FAQ" to create one.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(faq => (
              <Card key={faq.id} className={!faq.is_active ? 'opacity-50' : ''}>
                <CardContent className="p-4 flex items-start gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{faq.question}</h4>
                      {!faq.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{faq.answer}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">{PLATFORMS.find(p => p.value === faq.platform)?.label}</Badge>
                      <Badge variant="outline" className="text-xs">{CATEGORIES.find(c => c.value === faq.category)?.label}</Badge>
                      <span className="text-xs text-muted-foreground">Order: {faq.sort_order}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(faq)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(faq.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit FAQ' : 'Add FAQ'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Question *</Label>
                <Input value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g. How do I place an order?" />
              </div>
              <div className="space-y-2">
                <Label>Answer *</Label>
                <Textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write the answer..." rows={4} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Sort Order</Label>
                  <Input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <Label>Active</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !question.trim() || !answer.trim()}>
                {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </AdminLayout>
  );
}
