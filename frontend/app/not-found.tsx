import Link from "next/link";
import EmptyState from "@/components/EmptyState";

// 404 page (QA-EB) — rendered inside the root layout, so nav + tokens are present.
export default function NotFound() {
  return (
    <EmptyState
      emoji="🎬"
      title="Page not found"
      subtitle="That link doesn't lead anywhere. Let's get you back to the movies."
    >
      <Link href="/" className="btn-primary">Back to For You</Link>
      <Link href="/search" className="btn-secondary">Browse movies</Link>
    </EmptyState>
  );
}
