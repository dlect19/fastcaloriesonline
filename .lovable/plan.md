# Weather provider audit (read-only)

Nothing was edited, deployed, or sent to a weather service.

## Provider
- **Primary (live): Open-Meteo**, `api.open-meteo.com` (`/v1/forecast?...&current_weather=true`). It's free and needs no key. The platform setting `weather_service_provider` = `open-meteo`.
- **Optional alternative: OpenWeather**, `api.openweathermap.org`. It needs `OPENWEATHER_API_KEY`. That secret isn't set and the setting doesn't select it, so it's unused.
- There's no automatic fallback between providers. If a call fails, the app uses the last saved weather reading or treats it as "clear".

## Where weather is fetched
| Path | File | Trigger | Cache |
|---|---|---|---|
| Rider dispatch | `dispatch-order/index.ts` `fetchWeatherCondition` | Each dispatch round (Search Rider) | None: calls Open-Meteo directly every round, bypassing the shared provider and cache |
| Delivery fee | `_shared/delivery-pricing.ts` | Quotes and checkout | Reads saved weather only (`weather_cache`), no outbound call |
| Customer cart | `get-current-weather/index.ts` | When the cart needs weather | 15-minute cache per ~10 km grid; live call on a miss |
| Admin refresh | `refresh-weather/index.ts` | Only the admin "Refresh now" button (`force: true`) | Writes the cache; loops up to 200 vendors, deduplicated by grid |

## Schedule and usage
- No scheduled weather job exists. The 5-minute frequency setting is configured but no job runs it.
- Saved weather: 2 grid rows from Open-Meteo, last updated 2026-09-11. The cart path seems rarely or never called, since the cache would otherwise be newer.
- The usage log has **0 weather rows**. Only the admin refresh records usage. The dispatch and cart paths aren't logged, so call counts can't be measured.

## Google charges
- No weather path calls Google Maps Weather, Gemini, or any other Google API. Weather **can't contribute to the Google Cloud bill**, and Open-Meteo is free.

## Notes
- The dispatch path duplicates the provider code and calls Open-Meteo on every round, with no cache, logging, or timeout. It isn't a retry loop, but it ignores the admin's provider choice and the saved weather.
- The delivery fee uses saved weather, which is about 4 weeks old, while dispatch uses live weather. Surge amounts can differ between the fee shown at checkout and the rider dispatch.
- Possible fix later (needs approval): make dispatch read the same cached weather, and log every weather call.
