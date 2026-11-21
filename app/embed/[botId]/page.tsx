import { getBotById, toPublicConfig } from '@/lib/bot-store';
import ChatWindow from './ChatWindow';

export const dynamic = 'force-dynamic';

export default async function EmbedPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const bot = await getBotById(botId);

  if (!bot) {
    return (
      <main style={{ height: '100vh', display: 'grid', placeItems: 'center', background: '#fff', padding: 24, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 32 }}>🤖</div>
          <h1 style={{ fontSize: 16, margin: '8px 0 4px' }}>Bot not configured</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            No bot with id <code>{botId}</code> exists on this gateway.
          </p>
        </div>
      </main>
    );
  }

  return <ChatWindow bot={toPublicConfig(bot)} allowedDomains={bot.security.allowedDomains} />;
}
