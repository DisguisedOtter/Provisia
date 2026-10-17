import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'pv_session';

/**
 * Redirects anonymous visitors of /admin and /portal to /login. Only cookie presence is checked here;
 * the API validates the session on every request and the layouts fall back to /login on 401.
 */
export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
};
