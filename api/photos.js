const https = require('https');

// Maps CID → used to resolve Place ID via findplacefromtext
const CID = '17982176298767555017';
const SEARCH_QUERY = 'The TENS Movement Lab Salem Tamil Nadu';

// Node's https.get does NOT follow redirects — gives us the 302 Location header
function getRedirectUrl(url) {
  return new Promise(resolve => {
    const req = https.get(url, res => {
      const loc = res.headers.location;
      res.resume();
      resolve(loc || null);
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

module.exports = async function handler(req, res) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  // 1. Resolve Place ID from business name (CID not directly accepted by Places Details API)
  let placeId;
  try {
    const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${encodeURIComponent(SEARCH_QUERY)}&inputtype=textquery&fields=place_id&key=${key}`;
    const findData = await (await fetch(findUrl)).json();
    placeId = findData.candidates?.[0]?.place_id;
  } catch (e) { /* fall through */ }

  if (!placeId) return res.status(502).json({ error: 'Place not found', query: SEARCH_QUERY });

  // 2. Fetch photo references
  let refs;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${placeId}&fields=photos&key=${key}`;
    const data = await (await fetch(url)).json();
    if (data.status !== 'OK') return res.status(502).json({ error: data.status });
    refs = (data.result.photos || []).slice(0, 10).map(p => p.photo_reference);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }

  // 3. Resolve each photo reference → final lh3.googleusercontent.com URL
  const photos = (
    await Promise.all(
      refs.map(ref =>
        getRedirectUrl(
          `https://maps.googleapis.com/maps/api/place/photo` +
          `?maxwidth=1600&photoreference=${ref}&key=${key}`
        )
      )
    )
  ).filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.status(200).json({ photos });
};
