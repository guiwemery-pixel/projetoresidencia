import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { runNotificationJob } from './modules/notifications/notifications.service.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`API ouvindo em http://localhost:${env.PORT}`);
});

// Job periódico de notificações (revisões do dia, atrasadas, sequência…).
// Para múltiplas instâncias, mover para um worker/fila dedicado.
let timer: NodeJS.Timeout | undefined;
if (env.NOTIFICATIONS_JOB_MINUTES > 0) {
  const run = () => runNotificationJob().catch((err) => console.error('Job de notificações falhou', err));
  setTimeout(run, 10_000);
  timer = setInterval(run, env.NOTIFICATIONS_JOB_MINUTES * 60_000);
}

async function shutdown() {
  if (timer) clearInterval(timer);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
