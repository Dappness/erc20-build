import { getDb } from '@/lib/db';
import { tokens } from '@erc20-build/db';
import { SetupForm } from '@/components/setup-form';
import { Dashboard } from '@/components/dashboard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let token = null;

  try {
    const db = getDb();
    const [row] = await db.select().from(tokens).limit(1);
    token = row ?? null;
  } catch {
    // DB not available yet — show setup form
  }

  if (!token) {
    return <SetupForm />;
  }

  // Serialize Date fields for the client component
  const serializedToken = {
    ...token,
    deployedAt: token.deployedAt.toISOString(),
    createdAt: token.createdAt.toISOString(),
  };

  return <Dashboard token={serializedToken} />;
}
