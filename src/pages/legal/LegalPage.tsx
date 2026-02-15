import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, FileText, Shield, Scale, Bike, Truck, RotateCcw, ChevronRight, Calendar, Hash } from 'lucide-react';
import fastCaloriesFullLogo from '@/assets/fast-calories-full-logo.png';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

const DOC_META: Record<string, { icon: any; label: string; description: string }> = {
  terms: { icon: FileText, label: 'Terms & Conditions', description: 'Rules and guidelines for using our platform' },
  privacy: { icon: Shield, label: 'Privacy Policy', description: 'How we collect, use, and protect your data' },
  vendor_agreement: { icon: Scale, label: 'Vendor Agreement', description: 'Terms for restaurant and food vendor partners' },
  rider_agreement: { icon: Bike, label: 'Rider Agreement', description: 'Terms for delivery riders on the platform' },
  logistics_agreement: { icon: Truck, label: 'Logistics Partner Agreement', description: 'Terms for logistics and delivery companies' },
  refund_policy: { icon: RotateCcw, label: 'Refund & Cancellation Policy', description: 'Our refund, return, and cancellation procedures' },
};

export default function LegalPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  // Index page — list all legal documents
  if (!docType) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-secondary via-background to-background">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="container flex items-center gap-4 py-4 max-w-4xl">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <img src={fastCaloriesLogo} alt="FastCalories" className="w-8 h-8" />
              <h1 className="text-lg font-bold text-foreground">Legal</h1>
            </div>
          </div>
        </header>

        <main className="container py-10 max-w-4xl px-4">
          {/* Hero section */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mb-5">
              <img src={fastCaloriesFullLogo} alt="FastCalories" className="w-14 h-14 object-contain" />
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-foreground mb-3">Legal Documents</h2>
            <p className="text-muted-foreground text-base md:text-lg max-w-md mx-auto">
              Transparency matters. Review our policies and agreements below.
            </p>
          </div>

          {/* Document cards */}
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(DOC_META).map(([key, meta]) => {
              const slug = key.replace(/_/g, '-');
              const Icon = meta.icon;
              return (
                <Link key={key} to={`/legal/${slug}`} className="group">
                  <Card className="h-full border border-border hover:border-primary/40 hover:shadow-lg transition-all duration-200 cursor-pointer bg-card group-hover:bg-secondary/40">
                    <CardContent className="p-5 flex items-start gap-4">
                      <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground text-sm mb-1">{meta.label}</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 mt-1 shrink-0 group-hover:text-primary transition-colors" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-16 text-center">
            <img src={fastCaloriesFullLogo} alt="FastCalories" className="w-24 mx-auto mb-3 opacity-40" />
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} FastCalories. All rights reserved.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Single document view
  const meta = DOC_META[docType];
  const Icon = meta?.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary via-background to-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container flex items-center gap-4 py-4 max-w-4xl">
          <Button variant="ghost" size="icon" onClick={() => navigate('/legal')} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <img src={fastCaloriesLogo} alt="FastCalories" className="w-7 h-7 shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{meta?.label || 'Legal Document'}</span>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-4xl px-4">
        {loading ? (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <Skeleton className="h-16 w-16 rounded-2xl mx-auto" />
              <Skeleton className="h-8 w-64 mx-auto" />
              <Skeleton className="h-4 w-48 mx-auto" />
            </div>
            <Skeleton className="h-[500px] rounded-2xl" />
          </div>
        ) : document ? (
          <>
            {/* Document hero */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4">
                {Icon && <Icon className="w-8 h-8" />}
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground mb-3">{document.title}</h1>
              <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary border border-border">
                  <Hash className="w-3 h-3" />
                  Version {document.version}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary border border-border">
                  <Calendar className="w-3 h-3" />
                  Updated {new Date(document.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            </div>

            {/* Document content */}
            <Card className="border border-border shadow-sm overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/70 to-primary/40" />
              <CardContent className="p-6 md:p-10">
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-primary prose-strong:text-foreground prose-li:text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: document.content }}
                />
              </CardContent>
            </Card>

            {/* Back link */}
            <div className="mt-8 text-center">
              <Link to="/legal" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                <ArrowLeft className="w-3.5 h-3.5" />
                View all legal documents
              </Link>
            </div>
          </>
        ) : (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Document Not Found</h2>
            <p className="text-sm text-muted-foreground mb-6">This legal document hasn't been published yet.</p>
            <Button variant="outline" onClick={() => navigate('/legal')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Legal
            </Button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-16 text-center pb-4">
          <img src={fastCaloriesFullLogo} alt="FastCalories" className="w-24 mx-auto mb-3 opacity-40" />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} FastCalories. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}
