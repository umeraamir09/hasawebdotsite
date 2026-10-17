import { ProfileAvatar } from "./profile-avatar";
import styles from "./profile-avatar-slot.module.css";

/** Reserves the complete source decoration without a source-site profile row. */
export function ProfileAvatarSlot({
  decoration,
}: {
  decoration?: "cat" | "hands";
}) {
  return (
    <div className={styles.envelope}>
      <div className={styles.slot}>
        <ProfileAvatar {...(decoration ? { decoration } : {})} />
      </div>
    </div>
  );
}
