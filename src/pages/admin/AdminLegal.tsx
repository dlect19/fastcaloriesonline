import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Shield, Scale, Bike, Truck, RotateCcw, Save, Loader2, Eye, History, Users, Plus, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

const DOC_TYPES = [
  { type: 'terms', label: 'Terms & Conditions', icon: FileText },
  { type: 'privacy', label: 'Privacy Policy', icon: Shield },
  { type: 'vendor_agreement', label: 'Vendor Agreement', icon: Scale },
  { type: 'rider_agreement', label: 'Rider Agreement', icon: Bike },
  { type: 'logistics_agreement', label: 'Logistics Agreement', icon: Truck },
  { type: 'refund_policy', label: 'Refund & Cancellation', icon: RotateCcw },
];

export default function AdminLegal() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role, loading: authLoading } = useAdminPermissions();
  const isAdmin = !!role;
  const [documents, setDocuments] = useState<any[]>([]);
  const [acceptances, setAcceptances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [forceReaccept, setForceReaccept] = useState(false);
  const [activeTab, setActiveTab] = useState('documents');

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/admin/auth');
      return;
    }
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin, authLoading]);

  const fetchData = async () => {
    setLoading(true);
    const [docsRes, accRes] = await Promise.all([
      supabase.from('legal_documents').select('*').order('document_type').order('version', { ascending: false }),
      supabase.from('legal_acceptances').select('*').order('accepted_at', { ascending: false }).limit(100),
    ]);

    setDocuments(docsRes.data || []);
    setAcceptances(accRes.data || []);
    setLoading(false);
  };

  const handleEdit = (doc: any) => {
    setSelectedDoc(doc);
    setEditTitle(doc.title);
    setEditContent(doc.content);
    setForceReaccept(false);
    setEditOpen(true);
  };

  const handlePublishNewVersion = async () => {
    if (!selectedDoc) return;
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const newVersion = selectedDoc.version + 1;

      const { error } = await supabase.from('legal_documents').insert({
        document_type: selectedDoc.document_type,
        title: editTitle,
        content: editContent,
        version: newVersion,
        is_current: true,
        force_reaccept: forceReaccept,
        published_by: user?.id,
      });

      if (error) throw error;

      toast({ title: 'New version published', description: `Version ${newVersion} is now live` });
      setEditOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInPlace = async () => {
    if (!selectedDoc) return;
    setSaving(true);

    try {
      const { error } = await supabase.from('legal_documents')
        .update({ title: editTitle, content: editContent, updated_at: new Date().toISOString() })
        .eq('id', selectedDoc.id);

      if (error) throw error;
      toast({ title: 'Document updated' });
      setEditOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Group documents by type, show only current
  const currentDocs = documents.filter(d => d.is_current);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AdminLayout>
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Scale className="w-7 h-7" />
            Legal Documents
          </h1>
          <p className="text-muted-foreground">Manage platform legal documents and track acceptances</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="w-4 h-4" /> Documents
            </TabsTrigger>
            <TabsTrigger value="acceptances" className="gap-2">
              <Users className="w-4 h-4" /> Acceptance Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {DOC_TYPES.map(({ type, label, icon: Icon }) => {
                const doc = currentDocs.find(d => d.document_type === type);
                return (
                  <Card key={type} className="border shadow-soft">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Icon className="w-5 h-5 text-primary" />
                        {label}
                      </CardTitle>
                      {doc && (
                        <CardDescription className="flex items-center gap-2">
                          <Badge variant="outline">v{doc.version}</Badge>
                          <span className="text-xs">Updated {format(new Date(doc.updated_at), 'PP')}</span>
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="pt-0">
                      {doc ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleEdit(doc)} className="gap-1">
                            <Save className="w-3 h-3" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => window.open(`/legal/${type.replace(/_/g, '-')}`, '_blank')} className="gap-1">
                            <Eye className="w-3 h-3" /> Preview
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No document created yet</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Version History */}
            <Card className="mt-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5" />
                  Version History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium">Document</th>
                        <th className="text-left py-2 px-3 font-medium">Version</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium">Force Reaccept</th>
                        <th className="text-left py-2 px-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.slice(0, 20).map(doc => (
                        <tr key={doc.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3">{DOC_TYPES.find(d => d.type === doc.document_type)?.label || doc.document_type}</td>
                          <td className="py-2 px-3">v{doc.version}</td>
                          <td className="py-2 px-3">
                            <Badge variant={doc.is_current ? 'default' : 'secondary'}>
                              {doc.is_current ? 'Current' : 'Archived'}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">{doc.force_reaccept ? '✅' : '—'}</td>
                          <td className="py-2 px-3 text-muted-foreground">{format(new Date(doc.created_at), 'PP')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="acceptances">
            <Card>
              <CardHeader>
                <CardTitle>Acceptance Log</CardTitle>
                <CardDescription>Track who accepted which documents</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium">User ID</th>
                        <th className="text-left py-2 px-3 font-medium">Document</th>
                        <th className="text-left py-2 px-3 font-medium">Version</th>
                        <th className="text-left py-2 px-3 font-medium">Role</th>
                        <th className="text-left py-2 px-3 font-medium">Accepted At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acceptances.map(acc => (
                        <tr key={acc.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3 font-mono text-xs">{acc.user_id?.slice(0, 8)}...</td>
                          <td className="py-2 px-3">{DOC_TYPES.find(d => d.type === acc.document_type)?.label || acc.document_type}</td>
                          <td className="py-2 px-3">v{acc.document_version}</td>
                          <td className="py-2 px-3"><Badge variant="outline">{acc.role}</Badge></td>
                          <td className="py-2 px-3 text-muted-foreground">{format(new Date(acc.accepted_at), 'PPp')}</td>
                        </tr>
                      ))}
                      {acceptances.length === 0 && (
                        <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No acceptances yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Edit: {selectedDoc?.title}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Content (HTML)</Label>
                <Textarea 
                  value={editContent} 
                  onChange={(e) => setEditContent(e.target.value)} 
                  rows={15}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-3 p-3 bg-warning/10 border border-warning/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Force Re-acceptance</p>
                  <p className="text-xs text-muted-foreground">Users must re-accept this document after publishing</p>
                </div>
                <Switch checked={forceReaccept} onCheckedChange={setForceReaccept} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleSaveInPlace} disabled={saving}>
                Save Draft (Same Version)
              </Button>
              <Button onClick={handlePublishNewVersion} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Publish as v{(selectedDoc?.version || 0) + 1}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
