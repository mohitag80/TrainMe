import Link from 'next/link';
import { Logo } from '@/components/ui';

const MESSAGES: Record<string, string> = {
  login_failed: 'Sign-in did not complete. Please try again.',
  missing_code: 'Sign-in was interrupted. Please try again.',
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;
  const target = `/bff/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  return (
    <main className="landing">
      <div className="landing-card">
        <div>
          <Logo size={44} />
        </div>
        <h1>Welcome back</h1>
        {error && <div className="alert alert-bad">{MESSAGES[error] ?? 'Please sign in again.'}</div>}
        <div className="row gap" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary btn-lg" href={target}>
            Continue to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
