import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/ui';
import { getSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Public landing page; signed-in users go straight to their dashboard. */
export default async function Landing() {
  if (await getSession()) redirect('/dashboard');
  return (
    <main className="landing">
      <div className="landing-card">
        <div>
          <Logo size={48} />
        </div>
        <h1>
          Every ball. Every set. <em>Every gain.</em>
        </h1>
        <p>
          Pick a profile like Fast Bowler or Push Day, record sessions live, and watch daily, weekly and monthly
          progress.
        </p>
        <div className="row gap" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary btn-lg" href="/bff/auth/login">
            Sign in
          </Link>
          <Link className="btn btn-lg" href="/bff/auth/login?register=1">
            Create account
          </Link>
        </div>
        <p className="small">Test environment · dummy users like asha@trainme.test / Passw0rd!</p>
      </div>
    </main>
  );
}
