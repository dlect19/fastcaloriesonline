import { useState, useRef, useEffect } from 'react';
import { Upload, Loader2, CheckCircle, XCircle, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  vendorId: string;
  userId: string;
}

const DOC_TYPES = [
  { key: 'cac_registration', label: 'CAC Registration', required: true },
  { key: 'utility_bill', label: 'Utility Bill', required: true },
  { key: 'storefront_photo', label: 'Storefront Photo', required: true },
  { key: 'government_id', label: 'Government ID', required: true },
  { key: 'license', label: 'License (Optional)', required: false },
];

interface DocRecord {
  id: string;
  document_type: string;
  file_name: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

export function VendorDocumentUpload({ vendorId, userId }: Props) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchDocs();
  }, [vendorId]);

  const fetchDocs = async () => {
    const { data } = await supabase
      .from('vendor_verification_documents')
      .select('id, document_type, file_name, status, rejection_reason, created_at')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });
    setDocs(data || []);
    setLoading(false);
  };

  const handleUpload = async (docType: string, file: File) => {
    setUploading(docType);
    try {
      const ext = file.name.split('.').pop();
      const path = `${userId}/${vendorId}/${docType}-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('vendor-verification-docs')
        .upload(path, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      await supabase.from('vendor_verification_documents').insert({
        vendor_id: vendorId,
        document_type: docType,
        file_url: path,
        file_name: file.name,
      });

      toast({ title: `${docType.replace(/_/g, ' ')} uploaded` });
      fetchDocs();
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const getDocStatus = (docType: string): DocRecord | null => {
    return docs.find(d => d.document_type === docType) || null;
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-success/10 text-success border-0 gap-1"><CheckCircle className="w-3 h-3" />Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><FileText className="w-3 h-3" />Pending</Badge>;
    }
  };

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Verification Documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground mb-4">
          Upload required documents for store verification. All documents are encrypted and not publicly accessible.
        </p>
        {DOC_TYPES.map(({ key, label, required }) => {
          const existing = getDocStatus(key);
          return (
            <div key={key} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{label}</p>
                  {required && <span className="text-xs text-destructive">*</span>}
                </div>
                {existing && (
                  <div className="flex items-center gap-2 mt-1">
                    {statusBadge(existing.status)}
                    {existing.file_name && (
                      <span className="text-xs text-muted-foreground truncate max-w-[150px]">{existing.file_name}</span>
                    )}
                  </div>
                )}
                {existing?.status === 'rejected' && existing.rejection_reason && (
                  <p className="text-xs text-destructive mt-1">{existing.rejection_reason}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRefs.current[key]?.click()}
                disabled={uploading === key}
                className="gap-1 shrink-0"
              >
                {uploading === key ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {existing ? 'Re-upload' : 'Upload'}
              </Button>
              <input
                ref={(el) => { fileRefs.current[key] = el; }}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(key, file);
                }}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
