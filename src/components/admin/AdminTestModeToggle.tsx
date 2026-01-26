import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { FlaskConical, Eye, ShieldCheck } from 'lucide-react';

export function AdminTestModeToggle() {
  const { 
    environment, 
    effectiveEnvironment, 
    isAdminTestMode, 
    isAdmin, 
    toggleAdminTestMode,
    loading 
  } = useEnvironmentConfig();

  // Only show this when platform is in production mode
  if (loading || environment !== 'production' || !isAdmin) {
    return null;
  }

  return (
    <Card className="border-purple-200 dark:border-purple-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-purple-600" />
          Admin Test Session
        </CardTitle>
        <CardDescription>
          Test with sandbox without affecting real users
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50">
          <div className="flex items-center gap-3">
            {isAdminTestMode ? (
              <FlaskConical className="w-6 h-6 text-purple-600" />
            ) : (
              <Eye className="w-6 h-6 text-green-600" />
            )}
            <div>
              <p className="font-medium">
                {isAdminTestMode ? 'Test Mode Active' : 'Viewing as Production'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isAdminTestMode 
                  ? 'You see test stores & use test payments' 
                  : 'You see exactly what real users see'}
              </p>
            </div>
          </div>
          <Switch
            checked={isAdminTestMode}
            onCheckedChange={toggleAdminTestMode}
          />
        </div>

        <div className="grid gap-3 text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            <span>Real users always see production</span>
          </div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-purple-600" />
            <span>Your session uses test Paystack keys when enabled</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <span className="text-sm text-muted-foreground">Your current view:</span>
          <Badge variant={effectiveEnvironment === 'production' ? 'default' : 'secondary'}>
            {effectiveEnvironment === 'production' ? '🔴 Production' : '🧪 Test'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
