import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The page does not exist, or you do not have access to it.</p>
      <Link href="/" className="text-sm text-accent underline underline-offset-2">
        Go to projects
      </Link>
    </div>
  );
}
