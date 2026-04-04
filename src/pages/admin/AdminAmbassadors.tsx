import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AmbassadorList } from '@/components/admin/ambassadors/AmbassadorList';
import { AmbassadorLeaderboard } from '@/components/admin/ambassadors/AmbassadorLeaderboard';
import { AmbassadorTiers } from '@/components/admin/ambassadors/AmbassadorTiers';
import { AmbassadorCampaigns } from '@/components/admin/ambassadors/AmbassadorCampaigns';
import { Users } from 'lucide-react';

export default function AdminAmbassadors() {
  const [activeTab, setActiveTab] = useState('ambassadors');

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Brand Ambassadors</h1>
            <p className="text-sm text-muted-foreground">Manage influencer & affiliate performance</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="ambassadors">Ambassadors</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="tiers">Tiers & Rewards</TabsTrigger>
          </TabsList>

          <TabsContent value="ambassadors"><AmbassadorList /></TabsContent>
          <TabsContent value="leaderboard"><AmbassadorLeaderboard /></TabsContent>
          <TabsContent value="campaigns"><AmbassadorCampaigns /></TabsContent>
          <TabsContent value="tiers"><AmbassadorTiers /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
