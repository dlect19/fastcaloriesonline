import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { CampaignGenerator } from '@/components/admin/campaigns/CampaignGenerator';
import { CampaignGallery } from '@/components/admin/campaigns/CampaignGallery';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, LayoutGrid } from 'lucide-react';

export default function AdminCampaigns() {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/admin/auth'); return; }
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
      if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); }
    };
    checkAuth();
  }, [navigate]);

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Campaign Studio</h1>
        <p className="text-muted-foreground">Generate AI-powered campaign images for marketing</p>
      </div>

      <Tabs defaultValue="generate" className="space-y-6">
        <TabsList>
          <TabsTrigger value="generate" className="gap-2">
            <Sparkles className="w-4 h-4" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="gallery" className="gap-2">
            <LayoutGrid className="w-4 h-4" />
            Gallery
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate">
          <CampaignGenerator />
        </TabsContent>

        <TabsContent value="gallery">
          <CampaignGallery />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
