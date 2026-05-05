// Sign-out endpoint. Accepts both GET (so a normal <a href="/logout"> works)
// and POST. Clears the Supabase session and redirects to /login.

import { NextResponse, type NextRequest } from 'next/server';
import { signOut } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  await signOut();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
