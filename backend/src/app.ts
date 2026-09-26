import express, { Router, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env, isProduction } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { originCheck } from './middleware/origin-check.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { groupsRouter } from './modules/groups/groups.routes.js';
import { areasRouter, subjectsRouter } from './modules/taxonomy/taxonomy.routes.js';
import { studiesRouter } from './modules/studies/studies.routes.js';
import { importRouter } from './modules/import/import.routes.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { metricsRouter } from './modules/metrics/metrics.routes.js';
import { goalsRouter } from './modules/goals/goals.routes.js';
import { mockExamsRouter } from './modules/mock-exams/mock-exams.routes.js';
import { examsRouter } from './modules/exams/exams.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { invalidateProgressCache } from './modules/progress/public-summary.js';
import { runNotificationJob } from './modules/notifications/notifications.service.js';
import { runMaintenance } from './modules/maintenance/maintenance.service.js';

export function createApp() {
  const app = express();
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  const secureCookies = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          // api.anthropic.com: o app de flashcards pode chamar o Claude com a chave do próprio usuário
          connectSrc: ["'self'", 'https://api.anthropic.com'],
          // Só força HTTPS quando o deploy usa HTTPS (cookie seguro)
          upgradeInsecureRequests: secureCookies ? [] : null,
        },
      },
    }),
  );
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  // Importação de planilha: lotes maiores (os estudos já chegam convertidos, sem arquivo)
  app.use('/api/import', express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '300kb' }));
  app.use(cookieParser());
  app.use('/api', originCheck(allowedOrigins));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Job de notificações + faxina do banco disparados por agendador externo (ex.: Vercel Cron).
  // Em servidor tradicional o job roda por setInterval (ver index.ts).
  app.get('/api/cron/notifications', async (req, res) => {
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 16 || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Não autorizado' });
      return;
    }
    await runNotificationJob();
    await runMaintenance().catch((err) => console.error('Faxina do banco falhou', err));
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);

  // Tudo abaixo exige usuário autenticado; cada serviço filtra por userId.
  const api = Router();
  api.use(requireAuth);
  // Qualquer alteração invalida o cache do indicador exibido ao grupo
  api.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (res.statusCode < 400 && req.user) invalidateProgressCache(req.user.id);
      });
    }
    next();
  });
  api.use('/me', usersRouter);
  api.use('/groups', groupsRouter);
  api.use('/areas', areasRouter);
  api.use('/subjects', subjectsRouter);
  api.use('/studies', studiesRouter);
  api.use('/import', importRouter);
  api.use('/reviews', reviewsRouter);
  api.use('/metrics', metricsRouter);
  api.use('/goals', goalsRouter);
  api.use('/mock-exams', mockExamsRouter);
  api.use('/exams', examsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/search', searchRouter);
  api.use('/dashboard', dashboardRouter);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // Em produção o backend também serve o frontend compilado (deploy único)
  const dist = env.FRONTEND_DIST ?? path.resolve(process.cwd(), '../frontend/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
