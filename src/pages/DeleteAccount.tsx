import { Leaf, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function DeleteAccount() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container flex items-center gap-4 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">Delete Account</h1>
        </div>
      </header>

      <main className="container py-10 max-w-xl mx-auto space-y-8">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <Leaf className="w-9 h-9 text-destructive" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-foreground">Delete Your FastCalories Account</h2>
          <p className="text-muted-foreground">
            To delete your account and all associated data:
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-foreground">Option 1: In-App</h3>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open the FastCalories app</li>
            <li>Go to <span className="font-medium text-foreground">Profile → Settings</span></li>
            <li>Tap <span className="font-medium text-destructive">"Delete Account"</span></li>
          </ol>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-foreground">Option 2: Via Email</h3>
          <p className="text-muted-foreground">
            Send an email to:{' '}
            <a
              href="mailto:care@fastcalories.online?subject=Delete%20My%20Account"
              className="font-medium text-primary underline"
            >
              care@fastcalories.online
            </a>
          </p>
          <p className="text-muted-foreground">
            Subject: <span className="font-medium text-foreground">Delete My Account</span>
          </p>
        </div>

        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 text-center">
          <p className="text-sm text-destructive font-medium">
            Your account and all data will be permanently deleted within 48 hours.
          </p>
        </div>
      </main>
    </div>
  );
}
