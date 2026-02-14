import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, FileText, Shield, Scale, Bike, Truck, RotateCcw } from 'lucide-react';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

const DOC_META: Record<string, { icon: any; label: string }> = {
  terms: { icon: FileText, label: 'Terms & Conditions' },
  privacy: { icon: Shield, label: 'Privacy Policy' },
  vendor_agreement: { icon: Scale, label: 'Vendor Agreement' },
  rider_agreement: { icon: Bike, label: 'Rider Agreement' },
  logistics_agreement: { icon: Truck, label: 'Logistics Partner Agreement' },
  refund_policy: { icon: RotateCcw, label: 'Refund & Cancellation Policy' },
};

export default function LegalPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Map URL slug to document_type
  const typeMap: Record<string, string> = {
    terms: 'terms',
    privacy: 'privacy',
    'vendor-agreement': 'vendor_agreement',
    'rider-agreement': 'rider_agreement',
    'logistics-agreement': 'logistics_agreement',
    'refund-policy': 'refund_policy',
  };

  const docType = typeMap[type || ''];

  useEffect(() => {
    if (docType) {
      fetchDocument();
    }
  }, [docType]);

  const fetchDocument = async () => {
    const { data } = await supabase
      .from('legal_documents')
      .select('*')
      .eq('document_type', docType)
      .eq('is_current', true)
      .maybeSingle();

    setDocument(data);
    setLoading(false);
  };

  if (!docType) {
    // Show index of all legal documents
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
          <div className="container flex items-center gap-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Legal</h1>
          </div>
        </header>
        <main className="container py-8 max-w-2xl space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <img src={fastCaloriesLogo} alt="FastCalories" className="w-10 h-10" />
            <h2 className="text-2xl font-bold">Legal Documents</h2>
          </div>
          {Object.entries(DOC_META).map(([key, meta]) => {
            const slug = key.replace(/_/g, '-');
            const Icon = meta.icon;
            return (
              <Link key={key} to={`/legal/${slug}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer mb-3">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Icon className="w-5 h-5 text-primary" />
                    <span className="font-medium">{meta.label}</span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </main>
      </div>
    );
  }

  const meta = DOC_META[docType];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container flex items-center gap-4 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/legal')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">{meta?.label || 'Legal Document'}</h1>
        </div>
      </header>

      <main className="container py-8 max-w-3xl">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-96" />
          </div>
        ) : document ? (
          <Card>
            <CardContent className="p-6 md:p-8">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                <span>Version {document.version}</span>
                <span>•</span>
                <span>Last updated: {new Date(document.updated_at).toLocaleDateString()}</span>
              </div>
              <div 
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: document.content }}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Document not found</p>
          </div>
        )}
      </main>
    </div>
  );
}
