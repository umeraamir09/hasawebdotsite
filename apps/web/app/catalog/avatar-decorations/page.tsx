import { ProfileAvatarSlot } from "../../../components/profile-avatar-slot";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatar decoration review | hasaweb.site",
  robots: { index: false, follow: false },
};

export default function AvatarDecorationReview() {
  return (
    <main className={styles.review}>
      <p className="caption">Appearance catalog / imported decorations</p>
      <h1>Ginger cat and hands</h1>
      <p className={styles.intro}>
        Both original decorations, with their portrait toggle and animations.
        Click a portrait, or focus it and press Enter or Space. These are Umer's
        example images for reviewing the import.
      </p>
      <div className={styles.gallery}>
        <section className={styles.card} data-review-variant="cat" id="cat">
          <h2>Ginger cat</h2>
          <ProfileAvatarSlot />
          <p>
            The default variant. The cleaned cat animation loops continuously.
          </p>
        </section>
        <section className={styles.card} data-review-variant="hands" id="hands">
          <h2>Hands</h2>
          <ProfileAvatarSlot decoration="hands" />
          <p>All three hand poses, with the original hearts and sparkles.</p>
        </section>
      </div>
      <p className={styles.note}>
        With reduced motion enabled, the cat uses its still image, the hands
        stay still, and the portrait changes without a wipe. No owner draft or
        published portfolio is changed by this review.
      </p>
    </main>
  );
}
