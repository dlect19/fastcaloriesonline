import { useState } from 'react';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Send, Loader2, Bell, Megaphone, Download, Users } from 'lucide-react';
import { EmojiPicker } from '@/components/admin/EmojiPicker';
import { ApkUploadCard } from '@/components/admin/ApkUploadCard';

export default function AdminNotifications() {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const [apkAppType, setApkAppType] = useState<'customer' | 'rider'>('customer');
  const [apkVersion, setApkVersion] = useState('');
  const [apkChangelog, setApkChangelog] = useState('');
  const [sendingApk, setSendingApk] = useState(false);

  const handleSendNotification = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: 'Please fill in title and message', variant: 'destructive' });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const { data: subs, error: subError } = await supabase
        .from('push_subscriptions')
        .select('user_id');

      if (subError) throw subError;

      const uniqueUserIds = [...new Set((subs || []).map(s => s.user_id).filter(Boolean))];

      if (uniqueUserIds.length === 0) {
        toast({ title: 'No subscribers found', description: 'No users have enabled push notifications yet.', variant: 'destructive' });
        setSending(false);
        return;
      }

      let totalSent = 0;
      let totalFailed = 0;
      const batchSize = 50;

      for (let i = 0; i < uniqueUserIds.length; i += batchSize) {
        const batch = uniqueUserIds.slice(i, i + batchSize);
        const { data, error } = await supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: batch,
            title: title.trim(),
            body: body.trim(),
            url: url.trim() || '/',
          },
        });

        if (error) {
          totalFailed += batch.length;
        } else {
          totalSent += data?.sent || 0;
          totalFailed += data?.failed || 0;
        }
      }

      setResult({ sent: totalSent, failed: totalFailed });
      toast({ title: `Notification sent to ${totalSent} users` });
      setTitle('');
      setBody('');
      setUrl('/');
    } catch (error: any) {
      toast({ title: 'Failed to send', description: error.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleSendApkUpdate = async () => {
    if (!apkVersion.trim()) {
      toast({ title: 'Please enter a version number', variant: 'destructive' });
      return;
    }

    setSendingApk(true);
    try {
      const { data, error } = await supabase.functions.invoke('notify-apk-update', {
        body: {
          app_type: apkAppType,
          version: apkVersion.trim(),
          changelog: apkChangelog.trim() || 'Bug fixes and improvements',
        },
      });

      if (error) throw error;

      toast({
        title: `APK update notification sent!`,
        description: `Notified ${data?.notified || 0} of ${data?.total_subscribers || 0} subscribers`,
      });
      setApkVersion('');
      setApkChangelog('');
    } catch (error: any) {
      toast({ title: 'Failed to send APK update', description: error.message, variant: 'destructive' });
    } finally {
      setSendingApk(false);
    }
  };

  const insertEmoji = (emoji: string, setter: React.Dispatch<React.SetStateAction<string>>) => {
    setter(prev => prev + emoji);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <Megaphone className="w-8 h-8 text-primary" />
              Push Notifications
            </h1>
            <p className="text-muted-foreground mt-1">Send push notifications to all app users</p>
          </div>

          {/* Broadcast Notification */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                Broadcast Message
              </CardTitle>
              <CardDescription>Send a custom push notification to all users with notifications enabled</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Notification Title</Label>
                <div className="flex gap-2">
                  <Input
                    id="title"
                    placeholder="e.g. 🎉 Weekend Special!"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="flex-1"
                  />
                  <EmojiPicker onSelect={(emoji) => insertEmoji(emoji, setTitle)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Message</Label>
                <div className="flex gap-2 items-start">
                  <Textarea
                    id="body"
                    placeholder="e.g. Get 20% off all orders this weekend. Order now!"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={3}
                    className="flex-1"
                  />
                  <EmojiPicker onSelect={(emoji) => insertEmoji(emoji, setBody)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">Link (optional)</Label>
                <Input
                  id="url"
                  placeholder="e.g. /explore or /rewards"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Page to open when the user taps the notification</p>
              </div>

              <Button
                onClick={handleSendNotification}
                disabled={sending || !title.trim() || !body.trim()}
                className="w-full"
              >
                {sending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Send to All Users</>
                )}
              </Button>

              {result && (
                <div className="p-3 rounded-lg bg-secondary text-sm">
                  <p className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <span><strong>{result.sent}</strong> delivered, <strong>{result.failed}</strong> failed</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* APK Upload */}
          <ApkUploadCard />

          {/* APK Update Notification */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="w-5 h-5 text-primary" />
                APK Update Notification
              </CardTitle>
              <CardDescription>Notify users about a new APK version and update the version tracker</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>App Type</Label>
                <Select value={apkAppType} onValueChange={(v) => setApkAppType(v as 'customer' | 'rider')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer App</SelectItem>
                    <SelectItem value="rider">Rider App</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="apk-version">Version Number</Label>
                <Input
                  id="apk-version"
                  placeholder="e.g. 1.2.0"
                  value={apkVersion}
                  onChange={(e) => setApkVersion(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apk-changelog">What's New</Label>
                <Textarea
                  id="apk-changelog"
                  placeholder="e.g. Faster checkout, improved notifications, bug fixes"
                  value={apkChangelog}
                  onChange={(e) => setApkChangelog(e.target.value)}
                  rows={2}
                />
              </div>
              <Button
                onClick={handleSendApkUpdate}
                disabled={sendingApk || !apkVersion.trim()}
                variant="outline"
                className="w-full"
              >
                {sendingApk ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Publish Update & Notify</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
