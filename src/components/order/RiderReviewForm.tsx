import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface RiderReviewFormProps {
  orderId: string;
  riderId: string;
  vendorId: string;
  onReviewSubmitted?: () => void;
}

export function RiderReviewForm({ orderId, riderId, vendorId, onReviewSubmitted }: RiderReviewFormProps) {
  const { toast } = useToast();
  const [riderRating, setRiderRating] = useState(0);
  const [vendorRating, setVendorRating] = useState(0);
  const [comment, setComment] = useState('');
  const [hoveredRiderStar, setHoveredRiderStar] = useState(0);
  const [hoveredVendorStar, setHoveredVendorStar] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (riderRating === 0 && vendorRating === 0) {
      toast({
        title: 'Please provide a rating',
        description: 'Rate the rider or vendor to submit your review',
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if review already exists
      const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle();

      if (existingReview) {
        // Update existing review
        await supabase
          .from('reviews')
          .update({
            rider_rating: riderRating || null,
            vendor_rating: vendorRating || null,
            comment: comment || null
          })
          .eq('id', existingReview.id);
      } else {
        // Create new review
        await supabase
          .from('reviews')
          .insert({
            order_id: orderId,
            user_id: user.id,
            vendor_id: vendorId,
            rider_id: riderId || null,
            rider_rating: riderRating || null,
            vendor_rating: vendorRating || null,
            comment: comment || null
          });
      }

      // Update rider's average rating
      if (riderId && riderRating > 0) {
        const { data: allRiderReviews } = await supabase
          .from('reviews')
          .select('rider_rating')
          .eq('rider_id', riderId)
          .not('rider_rating', 'is', null);

        if (allRiderReviews && allRiderReviews.length > 0) {
          const avgRating = allRiderReviews.reduce((sum, r) => sum + (r.rider_rating || 0), 0) / allRiderReviews.length;
          await supabase
            .from('rider_profiles')
            .update({ rating: avgRating })
            .eq('user_id', riderId);
        }
      }

      toast({ title: '⭐ Thank you for your review!' });
      setSubmitted(true);
      onReviewSubmitted?.();
    } catch (error: any) {
      toast({
        title: 'Error submitting review',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (
    rating: number,
    hoveredStar: number,
    setRating: (r: number) => void,
    setHovered: (r: number) => void
  ) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className="focus:outline-none"
          onClick={() => setRating(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
        >
          <Star
            className={cn(
              "w-8 h-8 transition-colors",
              (hoveredStar || rating) >= star
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground"
            )}
          />
        </button>
      ))}
    </div>
  );

  if (submitted) {
    return (
      <Card className="border-calorie-low/30 bg-calorie-low/5">
        <CardContent className="py-6 text-center">
          <Star className="w-10 h-10 fill-yellow-400 text-yellow-400 mx-auto mb-2" />
          <p className="font-medium text-foreground">Thanks for your feedback!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Rate Your Experience</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Rider Rating */}
        {riderId && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">How was your rider?</p>
            {renderStars(riderRating, hoveredRiderStar, setRiderRating, setHoveredRiderStar)}
          </div>
        )}

        {/* Vendor Rating */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">How was the food/service?</p>
          {renderStars(vendorRating, hoveredVendorStar, setVendorRating, setHoveredVendorStar)}
        </div>

        {/* Comment */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Additional comments (optional)</p>
          <Textarea
            placeholder="Tell us about your experience..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit Review'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
