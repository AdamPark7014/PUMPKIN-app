import { redirect } from 'next/navigation';

/** Una sola cartelera: /events → home */
export default function EventsPage() {
  redirect('/');
}
