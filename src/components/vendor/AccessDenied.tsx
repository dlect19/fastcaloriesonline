import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface AccessDeniedProps {
  message?: string;
}

export function AccessDenied({ message = "You don't have permission to access this page." }: AccessDeniedProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <ShieldX className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground mb-4">{message}</p>
        <Button variant="outline" onClick={() => navigate('/vendor/dashboard')}>
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
