import { favoritesData } from '../../lib/favorites-data.js';

export function GET() {
  return new Response(JSON.stringify(favoritesData('ja')), { headers: { 'Content-Type': 'application/json' } });
}
