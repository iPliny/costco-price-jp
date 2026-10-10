import { favoritesData } from '../../../lib/favorites-data.js';

export function GET() {
  return new Response(JSON.stringify(favoritesData('zh')), { headers: { 'Content-Type': 'application/json' } });
}
