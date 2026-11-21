import { NextRequest, NextResponse } from 'next/server';
import { getBots } from '@/lib/bot-store';
import { buildExport } from '@/lib/bot-transfer';

export const dynamic = 'force-dynamic';

/**
 * Admin: download bots as JSON.  GET /api/admin/bots/export            -> all bots
 *                                GET /api/admin/bots/export?ids=a,b    -> selected bots
 * API keys are never exported (listed in apiKeysOmitted). Protected by ADMIN_PASSWORD.
 */
export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get('ids')?.split(',').map((s) => s.trim()).filter(Boolean);
  let bots = await getBots();
  if (ids?.length) bots = bots.filter((b) => ids.includes(b.id));
  if (!bots.length) return NextResponse.json({ error: 'No matching bots' }, { status: 404 });

  const name = ids?.length === 1 ? `bot-${ids[0]}` : `bots-${new Date().toISOString().slice(0, 10)}`;
  return new NextResponse(JSON.stringify(buildExport(bots), null, 2) + '\n', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
