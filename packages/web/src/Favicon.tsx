import { useState } from "react";

const PALETTE = [
  "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
];

// Same title always gets the same color, so a bookmark's placeholder stays visually stable
// across reloads instead of flickering to a different color each render.
function paletteFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

const SIZES = {
  sm: "w-4 h-4 text-[9px]",
  md: "w-8 h-8 text-sm",
} as const;

interface FaviconProps {
  favicon: string | null;
  title: string;
  size?: keyof typeof SIZES;
}

export function Favicon({ favicon, title, size = "sm" }: FaviconProps) {
  const [failed, setFailed] = useState(false);
  const sizeClasses = SIZES[size];

  if (!favicon || failed) {
    const initial = (title.trim()[0] ?? "?").toUpperCase();
    return (
      <span
        className={`${sizeClasses} rounded-full flex items-center justify-center shrink-0 font-semibold leading-none ${paletteFor(title)}`}
      >
        {initial}
      </span>
    );
  }

  return <img src={favicon} alt="" className={`${sizeClasses} rounded shrink-0`} onError={() => setFailed(true)} />;
}
