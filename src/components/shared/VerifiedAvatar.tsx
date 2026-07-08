import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useIsVerified } from '@/hooks/useIsVerified';

interface VerifiedAvatarProps {
  userId?: string | null;
  /** Force verified state (skip hook lookup). Useful when caller already knows. */
  verified?: boolean;
  src?: string | null;
  alt?: string;
  fallback?: string;
  className?: string;
  /** Badge size in px. Auto-scales roughly with avatar. */
  badgeSize?: number;
  children?: React.ReactNode;
}

/**
 * Renders an avatar (image or provided child) with a blue verified tick overlay
 * in the bottom-right corner when the user is verified.
 * Verified rules live in the DB function public.is_user_verified.
 */
export function VerifiedAvatar({
  userId,
  verified,
  src,
  alt,
  fallback,
  className,
  badgeSize = 16,
  children,
}: VerifiedAvatarProps) {
  const looked = useIsVerified(verified === undefined ? userId : null);
  const isVerified = verified ?? looked;

  return (
    <div className={cn('relative inline-block', className)}>
      {children ?? (
        <Avatar className="w-full h-full">
          {src ? <AvatarImage src={src} alt={alt || 'Avatar'} /> : null}
          <AvatarFallback className="bg-primary text-primary-foreground font-bold">
            {fallback || (alt ? alt.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : '?')}
          </AvatarFallback>
        </Avatar>
      )}
      {isVerified && (
        <span
          aria-label="Verified account"
          title="Verified account"
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-[1px] shadow"
          style={{ width: badgeSize + 2, height: badgeSize + 2 }}
        >
          <svg viewBox="0 0 24 24" width={badgeSize} height={badgeSize} aria-hidden="true">
            <path
              fill="#1D9BF0"
              d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C2.65 9.32 1.75 10.56 1.75 12s.9 2.68 2.2 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.66 1.31 1.9 2.19 3.33 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.66 2.19-1.9 2.19-3.34z"
            />
            <path
              fill="#fff"
              d="M10.62 15.53L7.4 12.31l1.42-1.42 1.8 1.8 4.55-4.55 1.42 1.42-5.97 5.97z"
            />
          </svg>
        </span>
      )}
    </div>
  );
}
