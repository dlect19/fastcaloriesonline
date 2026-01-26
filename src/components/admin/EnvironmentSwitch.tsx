import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { EnvironmentSwitchConfirmation } from './EnvironmentSwitchConfirmation';
import { Shield, AlertTriangle, CheckCircle, History, Loader2 } from 'lucide-react';

interface SwitchLog {
  id: string;
  from_environment: string;
  to_environment: string;
  confirmation_text: string;
  created_at: string;
}

export function EnvironmentSwitch() {
  const { toast } = useToast();
  const [currentEnvironment, setCurrentEnvironment] = useState<'development' | 'production'>('development');
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [switchLogs, setSwitchLogs] = useState<SwitchLog[]>([]);

  useEffect(() => {
    fetchEnvironment();
    checkSuperAdmin();
    fetchSwitchLogs();
  }, []);

  const fetchEnvironment = async () => {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'platform_environment')
        .single();

      if (data) {
        setCurrentEnvironment(data.value as 'development' | 'production');
      }
    } catch (error) {
      console.error('Error fetching environment:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkSuperAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase.rpc('is_super_admin', { _user_id: user.id });
    setIsSuperAdmin(!!data);
  };

  const fetchSwitchLogs = async () => {
    try {
      const { data } = await supabase
        .from('environment_switch_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (data) {
        setSwitchLogs(data);
      }
    } catch (error) {
      console.error('Error fetching switch logs:', error);
    }
  };

  const handleEnvironmentSwitch = async () => {
    const targetEnvironment = currentEnvironment === 'development' ? 'production' : 'development';
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      toast({ title: 'Not authenticated', variant: 'destructive' });
      return;
    }

    try {
      // Update platform environment
      const { error: updateError } = await supabase
        .from('platform_settings')
        .update({ value: targetEnvironment, updated_at: new Date().toISOString() })
        .eq('key', 'platform_environment');

      if (updateError) throw updateError;

      // Log the switch
      const { error: logError } = await supabase
        .from('environment_switch_logs')
        .insert({
          switched_by: user.id,
          from_environment: currentEnvironment,
          to_environment: targetEnvironment,
          confirmation_text: targetEnvironment === 'production' 
            ? 'I confirm this will enable real payments'
            : 'I confirm switching to test mode',
        });

      if (logError) {
        console.error('Error logging environment switch:', logError);
      }

      setCurrentEnvironment(targetEnvironment);
      fetchSwitchLogs();

      toast({
        title: 'Environment Switched',
        description: `Platform is now in ${targetEnvironment === 'production' ? 'PRODUCTION' : 'DEVELOPMENT'} mode.`,
      });
    } catch (error) {
      console.error('Error switching environment:', error);
      toast({
        title: 'Switch Failed',
        description: 'Failed to switch environment. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const targetEnvironment = currentEnvironment === 'development' ? 'production' : 'development';

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Environment Mode
          </CardTitle>
          <CardDescription>
            Control whether the platform uses test or live Paystack keys
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Environment Status */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              {currentEnvironment === 'development' ? (
                <AlertTriangle className="w-8 h-8 text-yellow-500" />
              ) : (
                <CheckCircle className="w-8 h-8 text-green-500" />
              )}
              <div>
                <p className="font-semibold">Current Mode</p>
                <Badge 
                  variant={currentEnvironment === 'development' ? 'secondary' : 'default'}
                  className={currentEnvironment === 'production' ? 'bg-green-600' : 'bg-yellow-500 text-yellow-950'}
                >
                  {currentEnvironment === 'development' ? '🧪 DEVELOPMENT' : '🔴 PRODUCTION'}
                </Badge>
              </div>
            </div>

            {isSuperAdmin ? (
              <Button
                variant={currentEnvironment === 'development' ? 'destructive' : 'outline'}
                onClick={() => setShowConfirmation(true)}
              >
                Switch to {targetEnvironment === 'production' ? 'Production' : 'Development'}
              </Button>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Super Admin Required
              </Badge>
            )}
          </div>

          {/* Environment Details */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`p-4 rounded-lg border ${currentEnvironment === 'development' ? 'border-yellow-500 bg-yellow-500/10' : 'border-muted'}`}>
              <h4 className="font-medium mb-2">🧪 Development Mode</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Paystack TEST keys active</li>
                <li>• Simulated payments only</li>
                <li>• Test vendors visible</li>
                <li>• Payouts blocked</li>
              </ul>
            </div>
            <div className={`p-4 rounded-lg border ${currentEnvironment === 'production' ? 'border-green-500 bg-green-500/10' : 'border-muted'}`}>
              <h4 className="font-medium mb-2">🔴 Production Mode</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Paystack LIVE keys active</li>
                <li>• Real money transactions</li>
                <li>• Approved vendors only</li>
                <li>• Real bank payouts</li>
              </ul>
            </div>
          </div>

          {/* Switch History */}
          {switchLogs.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium flex items-center gap-2 mb-3">
                  <History className="w-4 h-4" />
                  Recent Environment Changes
                </h4>
                <div className="space-y-2">
                  {switchLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between text-sm p-2 bg-secondary rounded">
                      <span>
                        <Badge variant="outline" className="mr-2">{log.from_environment}</Badge>
                        →
                        <Badge variant="outline" className="ml-2">{log.to_environment}</Badge>
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <EnvironmentSwitchConfirmation
        open={showConfirmation}
        onOpenChange={setShowConfirmation}
        targetEnvironment={targetEnvironment}
        onConfirm={handleEnvironmentSwitch}
      />
    </>
  );
}
