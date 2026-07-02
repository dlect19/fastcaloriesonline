// Weather provider abstraction — Phase 6.
// Add new providers by implementing the WeatherProvider interface and
// registering them in `getWeatherProvider`.

export type WeatherCondition = 'clear' | 'rain' | 'storm';

export interface WeatherReading {
  condition: WeatherCondition;
  temperature: number | null;
  wind_speed: number | null;
  rain_status: WeatherCondition;
}

export interface WeatherProvider {
  name: string;
  fetch(lat: number, lon: number): Promise<WeatherReading>;
}

// --- Open-Meteo (free, no API key) --------------------------------------
const openMeteo: WeatherProvider = {
  name: 'open-meteo',
  async fetch(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`open-meteo http ${res.status}`);
    const d = await res.json();
    const cw = d?.current_weather;
    const code: number = cw?.weathercode ?? 0;
    let condition: WeatherCondition = 'clear';
    if (code >= 95) condition = 'storm';
    else if (code >= 51) condition = 'rain';
    return {
      condition,
      temperature: cw?.temperature ?? null,
      wind_speed: cw?.windspeed ?? null,
      rain_status: condition,
    };
  },
};

// --- OpenWeather (requires OPENWEATHER_API_KEY) -------------------------
const openWeather: WeatherProvider = {
  name: 'openweather',
  async fetch(lat, lon) {
    const key = Deno.env.get('OPENWEATHER_API_KEY');
    if (!key) throw new Error('OPENWEATHER_API_KEY missing');
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`openweather http ${res.status}`);
    const d = await res.json();
    const main = (d?.weather?.[0]?.main || '').toLowerCase();
    let condition: WeatherCondition = 'clear';
    if (main.includes('thunder') || main.includes('storm')) condition = 'storm';
    else if (main.includes('rain') || main.includes('drizzle')) condition = 'rain';
    return {
      condition,
      temperature: d?.main?.temp ?? null,
      wind_speed: d?.wind?.speed ?? null,
      rain_status: condition,
    };
  },
};

export function getWeatherProvider(name: string | undefined | null): WeatherProvider {
  switch ((name || '').toLowerCase()) {
    case 'openweather': return openWeather;
    case 'open-meteo':
    default: return openMeteo;
  }
}
