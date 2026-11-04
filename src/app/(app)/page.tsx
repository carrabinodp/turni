import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function Home() {
  const { isManager } = await getSession();
  redirect(isManager ? '/timeline' : '/i-miei-turni');
}
