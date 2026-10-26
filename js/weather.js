// Weather + place search, straight from the browser to Open-Meteo (free, no key, CORS-enabled).
// Only the chosen place name + coordinates are stored (in your browser).
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

export const WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
export const icon = c => c <= 1 ? '☀️' : c <= 2 ? '⛅' : c <= 3 ? '☁️' : c <= 48 ? '🌁' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌦️' : c <= 86 ? '🌨️' : '⛈️';

export async function forecast(lat, lon) {
  const q = new URLSearchParams({
    latitude: (+lat).toFixed(3), longitude: (+lon).toFixed(3), timezone: 'auto', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  const r = await fetch(`${FORECAST}?${q}`);
  if (!r.ok) throw new Error('weather ' + r.status);
  return r.json();
}

export async function searchPlace(name) {
  const r = await fetch(`${GEO}?${new URLSearchParams({ name, count: '6', language: 'en', format: 'json' })}`);
  if (!r.ok) throw new Error('geocoding ' + r.status);
  const j = await r.json();
  return (j.results || []).map(p => ({
    name: [p.name, p.admin1, p.country_code].filter(Boolean).join(', '),
    lat: +p.latitude.toFixed(3), lon: +p.longitude.toFixed(3),
  }));
}

export function myLocation() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Geolocation not available'));
    // the browser's own timeout only starts after permission is granted; an ignored prompt would hang forever
    const t = setTimeout(() => rej(new Error('no answer from location prompt; try the city search')), 20000);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(t); res({ name: 'My location', lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }); },
      e => { clearTimeout(t); rej(new Error(e.message || 'Location denied')); }, { timeout: 10000, maximumAge: 3600e3 });
  });
}

export function kit(t, rain, wind) {
  const k = t < 5 ? 'tights, long sleeve, gloves' : t < 10 ? 'long sleeve + shorts or tights' : t < 16 ? 't-shirt + shorts' : 'vest, cap, extra water';
  return k + (rain >= 60 ? '; light rain jacket' : '') + (wind > 30 ? '; run the windy leg out, tailwind home' : '');
}
