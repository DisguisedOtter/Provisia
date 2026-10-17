import { permanentRedirect } from 'next/navigation';

/** The storefront is the public landing page; staff reach the admin panel at /admin. */
export default function Home() {
  permanentRedirect('/order');
}
