import { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, Mail, Calendar } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface ProfileHeaderProps {
  user: User;
  profile: Profile | null;
  onSignOut: () => void;
}

export function ProfileHeader({ user, profile, onSignOut }: ProfileHeaderProps) {
  const displayName = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  const joinDate = new Date(user.created_at).toLocaleDateString('en-NG', {
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="bg-card rounded-2xl p-6 border border-border shadow-soft">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="w-20 h-20 border-4 border-primary/20">
            <AvatarImage src={profile?.avatar_url || undefined} alt={displayName} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          
          <div>
            <h2 className="text-xl font-bold text-foreground">{displayName}</h2>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <Mail className="w-3.5 h-3.5" />
              <span>{user.email}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
              <Calendar className="w-3.5 h-3.5" />
              <span>Joined {joinDate}</span>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          className="text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
