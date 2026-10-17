"use client";

import { useEffect, useState } from "react";
import { assets } from "../lib/avatar-assets";
import styles from "./profile-avatar.module.css";
import { ImageWithSkeleton } from "./image-with-skeleton";

type HandPose = "curled" | "palm" | "nails";

function HandArtwork({ pose }: { pose: HandPose }) {
  return (
    <svg viewBox="0 0 80 112" fill="none" focusable="false">
      <g
        stroke="#a77850"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {pose === "curled" ? (
          <>
            <path
              fill="#ffe3c3"
              d="M17 103C7 101 4 92 5 80L7 70C8 64 12 62 17 65C15 57 23 54 28 59C28 51 36 50 42 55C45 50 51 50 55 54L65 35C68 30 73 31 72 36L62 59L62 84C61 100 48 105 34 105Z"
            />
            <path d="M17 65C21 69 21 81 20 93M28 59C33 64 32 80 31 93M42 55C47 60 45 79 44 92M55 54C58 62 57 78 56 89M9 80L10 90" />
            <g fill="#ed49ca" stroke="#ac398c" strokeWidth="0.9">
              <path d="M11 81C11 77 16 77 17 81L17 95C17 101 12 101 12 95Z" />
              <path d="M23 77C23 73 29 73 29 78L29 96C28 101 24 100 24 95Z" />
              <path d="M35 74C36 70 41 71 41 75L40 95C39 100 35 98 35 94Z" />
              <path d="M48 72C49 68 54 69 54 73L52 93C51 98 47 96 47 92Z" />
              <path d="M64 35L69 28C71 25 75 25 75 29L72 36C70 39 66 38 64 35Z" />
            </g>
            <path
              stroke="#ffb6ee"
              strokeWidth="1.4"
              d="M13 82L14 94M25 79L26 95M37 77L37 94M50 75L49 91M70 29L68 34"
            />
          </>
        ) : pose === "palm" ? (
          <>
            <path
              fill="#ffe6c9"
              d="M31 105C17 104 13 94 11 80L4 48C3 43 8 41 10 46L20 65L12 32C11 27 16 25 19 30L29 61L24 23C23 18 29 17 31 22L39 59L39 24C39 19 45 18 46 24L48 67L61 57C67 53 72 57 67 61L57 71C51 77 54 91 47 100C43 105 38 107 31 105Z"
            />
            <path d="M20 65L24 72M29 61L33 69M39 59L41 68M25 78C30 75 37 75 42 78M47 77C43 82 43 88 44 92" />
            <g fill="#ed49ca" stroke="#ac398c" strokeWidth="0.9">
              <path d="M4 47L1 39C0 35 3 34 5 38L9 45Z" />
              <path d="M13 31L10 22C10 18 13 17 15 21L18 28Z" />
              <path d="M25 23L24 14C24 10 28 10 29 14L31 22Z" />
              <path d="M40 24L40 15C40 11 44 11 45 15L45 23Z" />
              <path d="M62 57L70 53C75 51 77 54 73 57L67 61Z" />
            </g>
          </>
        ) : (
          <>
            <path
              fill="#ffe3c3"
              d="M30 105C17 104 12 94 10 81L6 67C4 61 0 58 2 55C5 51 11 56 14 58L22 66L20 30C20 24 26 23 27 29L30 58L34 23C35 17 40 18 40 24L40 57L49 25C50 20 56 21 55 27L49 63L63 39C66 33 72 35 69 41L58 76C57 94 50 106 37 106Z"
            />
            <path d="M22 66L24 72M30 58L31 66M40 57L39 65M49 63L46 70" />
            <g fill="#ed49ca" stroke="#ac398c" strokeWidth="0.9">
              <path d="M20 30L20 18C21 11 25 11 26 17L27 29C26 33 22 33 20 30Z" />
              <path d="M34 23L36 10C37 4 41 5 42 10L40 24C38 27 35 26 34 23Z" />
              <path d="M49 25L54 13C56 7 60 9 59 14L55 27C52 30 49 28 49 25Z" />
              <path d="M63 39L70 28C74 23 77 26 75 31L69 41C66 43 64 42 63 39Z" />
              <path d="M2 55L-4 50C-8 46-5 44-1 46L8 52C9 55 5 58 2 55Z" />
            </g>
            <path
              stroke="#ffb6ee"
              strokeWidth="1.4"
              d="M23 18L23 28M39 11L37 22M56 14L52 25M72 29L66 38M-2 48L4 53"
            />
          </>
        )}
      </g>
    </svg>
  );
}

function DecorationHand({ side }: { side: "left" | "right" }) {
  return (
    <span className={`${styles.hand} ${styles[side]}`}>
      <span className={styles.gesture}>
        {(["curled", "palm", "nails"] as const).map((pose) => (
          <span className={`${styles.pose} ${styles[pose]}`} key={pose}>
            <HandArtwork pose={pose} />
          </span>
        ))}
      </span>
    </span>
  );
}

export function ProfileAvatar({
  decoration = "cat",
}: {
  decoration?: "cat" | "hands";
}) {
  const [showPhoto, setShowPhoto] = useState(false);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (!erasing) return;
    // Release the toggle if reduced motion cancels an erase already in progress.
    const timeout = window.setTimeout(() => setErasing(false), 660);
    return () => window.clearTimeout(timeout);
  }, [erasing]);

  return (
    <div className={styles.frame} data-decoration={decoration}>
      <button
        type="button"
        className={styles.portraitButton}
        data-photo={showPhoto}
        data-erasing={erasing}
        aria-label="Show photo of Umer Aamir"
        aria-pressed={showPhoto}
        aria-disabled={erasing}
        title={showPhoto ? "Show illustration" : "Show photo"}
        onClick={() => {
          if (erasing) return;
          setShowPhoto((current) => !current);
          setErasing(
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          );
        }}
        onAnimationEnd={() => setErasing(false)}
      >
        <ImageWithSkeleton
          overlay
          className={`${styles.portrait} ${styles.illustration}`}
          src={assets.avatar}
          alt="Illustrated portrait of Umer Aamir"
          aria-hidden={showPhoto}
          width="124"
          height="124"
          draggable={false}
        />
        <ImageWithSkeleton
          overlay
          className={`${styles.portrait} ${styles.photo}`}
          src={assets.avatarPhoto}
          alt="Photo of Umer Aamir"
          aria-hidden={!showPhoto}
          width="124"
          height="124"
          draggable={false}
        />
      </button>
      <picture className={styles.catDecoration} hidden={decoration !== "cat"}>
        <source
          media="(prefers-reduced-motion: reduce)"
          srcSet="/assets/avatar-ginger-cat-clean-still.webp"
        />
        <img
          src="/assets/avatar-ginger-cat-clean-loop.webp"
          alt=""
          width="212"
          height="220"
          decoding="async"
        />
      </picture>
      <div
        className={styles.decoration}
        aria-hidden="true"
        hidden={decoration !== "hands"}
      >
        <DecorationHand side="left" />
        <DecorationHand side="right" />
        <span className={`${styles.heart} ${styles.heartLeft}`}>
          <svg viewBox="0 0 20 20" fill="none" focusable="false">
            <path
              d="M10 17S2 12 2 7.5C2 3 7.5 2 10 6C12.5 2 18 3 18 7.5C18 12 10 17 10 17Z"
              fill="#f487be"
              stroke="#ffb3d8"
              strokeWidth="1.3"
            />
          </svg>
        </span>
        <span className={`${styles.heart} ${styles.heartRight}`}>
          <svg viewBox="0 0 20 20" fill="none" focusable="false">
            <path
              d="M10 17S2 12 2 7.5C2 3 7.5 2 10 6C12.5 2 18 3 18 7.5C18 12 10 17 10 17Z"
              fill="#f487be"
              stroke="#ffb3d8"
              strokeWidth="1.3"
            />
          </svg>
        </span>
        {(["sparkleLeft", "sparkleTop", "sparkleRight"] as const).map(
          (position) => (
            <span
              className={`${styles.sparkle} ${styles[position]}`}
              key={position}
            >
              <svg viewBox="0 0 20 20" fill="none" focusable="false">
                <path
                  d="M10 1L12 8L19 10L12 12L10 19L8 12L1 10L8 8Z"
                  fill="#fff5a5"
                />
              </svg>
            </span>
          ),
        )}
      </div>
    </div>
  );
}
