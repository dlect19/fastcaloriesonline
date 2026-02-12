import { useState, useEffect } from 'react';
import { Star, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

interface VendorReviewsSectionProps {
  vendorId: string;
  limit?: number;
}

interface Review {
  id: string;
  vendor_rating: number | null;
  comment: string | null;
  created_at: string;
  user_id: string;
  profile_name?: string;
}

export function VendorReviewsSection({ vendorId, limit = 5 }: VendorReviewsSectionProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews();
  }, [vendorId]);

  const fetchReviews = async () => {
    try {
      const { data } = await supabase
        .from('reviews')
        .select('id, vendor_rating, comment, created_at, user_id')
        .eq('vendor_id', vendorId)
        .not('vendor_rating', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (data && data.length > 0) {
        // Fetch profile names for reviewers
        const userIds = [...new Set(data.map(r => r.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', userIds);

        const profileMap = new Map(
          (profiles || []).map(p => [p.user_id, p.full_name])
        );

        setReviews(
          data.map(r => ({
            ...r,
            profile_name: profileMap.get(r.user_id) || 'Customer',
          }))
        );
      } else {
        setReviews([]);
      }
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return null;
  if (reviews.length === 0) return null;

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          Customer Reviews
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[320px]">
          <div className="space-y-3 pr-3">
            {reviews.map((review) => (
              <div key={review.id} className="p-3 rounded-xl bg-muted/50">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-3.5 h-3.5 ${
                            star <= (review.vendor_rating || 0)
                              ? 'fill-warning text-warning'
                              : 'text-muted-foreground/30'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-medium text-foreground">
                      {review.profile_name}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(review.created_at).toLocaleDateString('en-NG', {
                      dateStyle: 'medium',
                    })}
                  </span>
                </div>
                {review.comment && (
                  <p className="text-sm text-muted-foreground">{review.comment}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
