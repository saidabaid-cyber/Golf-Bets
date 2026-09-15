import { isProfileEmojiAvatar } from "../../lib/profile-avatar";
import { safeProfileAvatarValue } from "../../lib/account-state";

export function ProfileAvatarMedia({ value, fallback, className, alt = "" }: {
  value?: string | null;
  fallback: string;
  className?: string;
  alt?: string;
}) {
  if (isProfileEmojiAvatar(value)) {
    return <span className={className} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>{value}</span>;
  }
  const image = safeProfileAvatarValue(value);
  if (image) return <img className={className} src={image} alt={alt} referrerPolicy="no-referrer" />;
  return <span className={className} aria-hidden="true">{fallback}</span>;
}
