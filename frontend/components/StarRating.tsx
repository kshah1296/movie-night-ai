"use client";

import { useState } from "react";

interface StarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string; // accessible group label, e.g. "Rate Inception"
}

const sizes = { sm: "text-lg", md: "text-2xl", lg: "text-3xl" };

export default function StarRating({
  value,
  onChange,
  readonly = false,
  size = "md",
  label = "Rate this movie",
}: StarRatingProps) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <div
      className="flex gap-0.5"
      role={readonly ? "img" : "radiogroup"}
      aria-label={readonly ? `Rated ${value} out of 5 stars` : `${label} — currently ${value || "no"} of 5 stars`}
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          role={readonly ? undefined : "radio"}
          aria-checked={readonly ? undefined : star === value}
          // Click the currently-selected star to clear (works on mouse + touch).
          onClick={() => onChange?.(star === value ? 0 : star)}
          onMouseEnter={() => !readonly && setHovered(star)}
          className={`star-btn ${sizes[size]} leading-none ${readonly ? "cursor-default" : "cursor-pointer"}`}
          style={{ padding: "0.25rem", background: "none", border: "none" }}
          aria-label={
            star === value && !readonly
              ? `Clear rating (currently ${star} of 5)`
              : `Rate ${star} of 5 stars`
          }
        >
          <span aria-hidden="true" className={star <= display ? "text-yellow-400" : "text-zinc-600"}>
            {star <= display && !readonly ? (
              <span key={value} className="star-filled">★</span>
            ) : (
              "★"
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
