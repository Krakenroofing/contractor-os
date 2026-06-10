// Field weather lookup — backs the "use my location" button on the daily
// report editor. Takes GPS lat/lng, asks Open-Meteo for current conditions
// (free, no API key, REST), and maps the WMO weather code to one of the
// dropdown's condition strings.

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// WMO weather interpretation codes → our daily-report condition options.
// https://open-meteo.com/en/docs (Weather variable documentation).
function conditionForCode(code: number): string {
  if (code === 0) return 'Sunny';
  if (code === 1 || code === 2) return 'Partly cloudy';
  if (code === 3 || code === 45 || code === 48) return 'Cloudy';
  if (code === 95 || code === 96 || code === 99) return 'Storm';
  if (code === 65 || code === 67 || code === 82) return 'Heavy rain';
  // Drizzle, rain, showers, and (rare here) snow all map to Rain — closest
  // option in the field dropdown.
  if (code >= 51) return 'Rain';
  return '';
}

function numParam(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const lat = numParam(req.nextUrl.searchParams.get('lat'));
  const lng = numParam(req.nextUrl.searchParams.get('lng'));
  if (
    lat === null ||
    lng === null ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return Response.json({ error: 'Invalid coordinates.' }, { status: 400 });
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;

  try {
    const res = await fetch(url, {
      // Weather changes slowly; a short cache spares Open-Meteo on repeat taps.
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return Response.json(
        { error: 'Weather service unavailable.' },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    return Response.json({
      condition: typeof code === 'number' ? conditionForCode(code) : '',
      temperatureF: typeof temp === 'number' ? Math.round(temp) : null,
    });
  } catch {
    return Response.json(
      { error: 'Could not reach the weather service.' },
      { status: 502 },
    );
  }
}
