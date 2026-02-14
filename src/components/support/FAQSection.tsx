import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { HelpCircle } from 'lucide-react';

interface FAQSectionProps {
  userType: 'customer' | 'vendor' | 'rider' | 'logistics';
}

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
}

const PLATFORM_MAP: Record<string, string> = {
  customer: 'customer',
  vendor: 'vendor',
  rider: 'rider',
  logistics: 'delivery_company',
};

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  orders: 'Orders',
  payments: 'Payments',
  delivery: 'Delivery',
  account: 'Account',
  wallet: 'Wallet',
  promos: 'Promos & Rewards',
};

export function FAQSection({ userType }: FAQSectionProps) {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFAQs = async () => {
      const platform = PLATFORM_MAP[userType] || 'customer';
      const { data } = await supabase
        .from('faqs')
        .select('id, question, answer, category')
        .or(`platform.eq.all,platform.eq.${platform}`)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (data) setFaqs(data);
      setLoading(false);
    };
    fetchFAQs();
  }, [userType]);

  if (loading) return null;
  if (faqs.length === 0) return null;

  // Group by category
  const grouped = faqs.reduce<Record<string, FAQ[]>>((acc, faq) => {
    const cat = faq.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(faq);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Frequently Asked Questions</h3>
      </div>

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <Badge variant="secondary" className="mb-2 text-xs">
            {CATEGORY_LABELS[cat] || cat}
          </Badge>
          <Accordion type="single" collapsible className="w-full">
            {items.map(faq => (
              <AccordionItem key={faq.id} value={faq.id}>
                <AccordionTrigger className="text-left text-sm">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ))}
    </div>
  );
}
