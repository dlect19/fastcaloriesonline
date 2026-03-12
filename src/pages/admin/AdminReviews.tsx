import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, MessageSquare, Store, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/integrations/supabase/client';

interface ReviewWithDetails {
  id: string;
  vendor_rating: number | null;
  rider_rating: number | null;
  comment: string | null;
  created_at: string;
  user_id: string;
  vendor_id: string;
  order_id: string;
  vendor_name?: string;
  customer_name?: string;
  order_number?: string;
}

export default function AdminReviews() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewWithDetails[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    checkAuthAndFetch();
  }, []);

  const checkAuthAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); return; }

    await fetchData();
  };

  const fetchData = async () => {
    try {
      // Fetch all reviews
      const { data: reviewsData } = await supabase
        .from('reviews')
        .select('*')
        .order('created_at', { ascending: false });

      if (!reviewsData || reviewsData.length === 0) {
        setReviews([]);
        setLoading(false);
        return;
      }

      // Fetch vendor names
      const vendorIds = [...new Set(reviewsData.map(r => r.vendor_id))];
      const { data: vendorsData } = await supabase
        .from('vendors')
        .select('id, name')
        .in('id', vendorIds);

      setVendors(vendorsData || []);
      const vendorMap = new Map((vendorsData || []).map(v => [v.id, v.name]));

      // Fetch customer names
      const userIds = [...new Set(reviewsData.map(r => r.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.full_name]));

      // Fetch order numbers
      const orderIds = [...new Set(reviewsData.map(r => r.order_id))];
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number')
        .in('id', orderIds);
      const orderMap = new Map((orders || []).map(o => [o.id, o.order_number]));

      setReviews(
        reviewsData.map(r => ({
          ...r,
          vendor_name: vendorMap.get(r.vendor_id) || 'Unknown',
          customer_name: profileMap.get(r.user_id) || 'Customer',
          order_number: orderMap.get(r.order_id) || r.order_id.slice(0, 8),
        }))
      );
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredReviews = reviews.filter(r => {
    const matchesVendor = selectedVendor === 'all' || r.vendor_id === selectedVendor;
    const matchesSearch = searchQuery === '' ||
      r.vendor_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.comment?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.order_number?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesVendor && matchesSearch;
  });

  const avgVendorRating = filteredReviews.filter(r => r.vendor_rating).length > 0
    ? filteredReviews.filter(r => r.vendor_rating).reduce((sum, r) => sum + (r.vendor_rating || 0), 0) /
      filteredReviews.filter(r => r.vendor_rating).length
    : 0;

  if (loading) {
    return (
      <div className="flex min-h-screen">
        <AdminSidebar />
        <main className="flex-1 p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendor Reviews</h1>
          <p className="text-muted-foreground">{reviews.length} total reviews</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-soft">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">Total Reviews</p>
              <p className="text-3xl font-bold text-foreground">{filteredReviews.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-soft">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">Avg Vendor Rating</p>
              <div className="flex items-center justify-center gap-2">
                <p className="text-3xl font-bold text-foreground">{avgVendorRating.toFixed(1)}</p>
                <Star className="w-6 h-6 fill-warning text-warning" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-soft">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">Vendors Reviewed</p>
              <p className="text-3xl font-bold text-foreground">{vendors.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search reviews..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedVendor} onValueChange={setSelectedVendor}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filter by vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {vendors.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Reviews List */}
        <Card className="border-0 shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg">All Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredReviews.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No reviews found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredReviews.map((review) => (
                  <div key={review.id} className="p-4 rounded-xl bg-muted/50">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Store className="w-4 h-4 text-primary" />
                          <span className="font-medium text-foreground text-sm">
                            {review.vendor_name}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            #{review.order_number}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          by {review.customer_name}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.created_at).toLocaleDateString('en-NG', {
                          dateStyle: 'medium',
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 mb-2">
                      {review.vendor_rating && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Food:</span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-3.5 h-3.5 ${
                                  star <= review.vendor_rating!
                                    ? 'fill-warning text-warning'
                                    : 'text-muted-foreground/30'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {review.rider_rating && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Rider:</span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-3.5 h-3.5 ${
                                  star <= review.rider_rating!
                                    ? 'fill-warning text-warning'
                                    : 'text-muted-foreground/30'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {review.comment ? (
                      <p className="text-sm text-foreground">{review.comment}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No comment</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
