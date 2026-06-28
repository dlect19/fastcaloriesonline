import { useStaffNames } from '@/hooks/useStaffNames';
import { Badge } from '@/components/ui/badge';
import { UserCircle2 } from 'lucide-react';

interface Props {
  userId?: string | null;
  label?: string;
  className?: string;
}

/**
 * Inline badge that shows "{label}: {Staff Name}".
 * Resolves the name from profiles → admin_staff.invite_email.
 * Renders nothing if userId is null/undefined.
 */
export function StaffNameBadge({ userId, label = 'By', className }: Props) {
  const map = useStaffNames([userId]);
  if (!userId) return null;
  const name = map.get(userId) || '…';
  return (
    <Badge variant="outline" className={`gap-1 font-normal ${className || ''}`} title={`${label}: ${name}`}>
      <UserCircle2 className="w-3 h-3" />
      <span className="text-[10px]">{label}: {name}</span>
    </Badge>
  );
}
