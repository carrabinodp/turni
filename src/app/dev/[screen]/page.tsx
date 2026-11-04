import { notFound } from 'next/navigation';
import DevPreview from '../DevPreview';

// Anteprima con dati finti, solo in sviluppo (npm run dev): /dev/timeline, /dev/import, /dev/week
export default function DevPage({ params }: { params: { screen: string } }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevPreview screen={params.screen} />;
}
