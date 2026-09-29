// Motor dos flashcards: JavaScript sem framework em /flashcards (na raiz do
// repositório), testado à parte (npm run test:flashcards). Carregado sob demanda
// só quando a aba abre. A ordem importa: cada arquivo usa os anteriores (window.FC).
import type { FlashcardsEngine } from './types';

import '../../../flashcards/css/style.css';
import '../../../flashcards/css/dashboard.css';
import '../../../flashcards/css/review.css';
import '../../../flashcards/css/responsive.css';
import '../../../flashcards/css/embed.css';

// Núcleo (sem interface)
import '../../../flashcards/js/util.js';
import '../../../flashcards/js/database.js';
import '../../../flashcards/js/store.js';
import '../../../flashcards/js/settings.js';
import '../../../flashcards/js/loader.js';
import '../../../flashcards/js/sanitize.js';
import '../../../flashcards/js/scheduler.js';
import '../../../flashcards/js/areas.js';
import '../../../flashcards/js/decks.js';
import '../../../flashcards/js/cards.js';
import '../../../flashcards/js/trash.js';
import '../../../flashcards/js/difficulty.js';
import '../../../flashcards/js/performance.js';
import '../../../flashcards/js/statistics.js';
import '../../../flashcards/js/review.js';
import '../../../flashcards/js/quickReview.js';
import '../../../flashcards/js/export.js';
import '../../../flashcards/js/anki.js';
import '../../../flashcards/js/importer.js';
import '../../../flashcards/js/backup.js';
import '../../../flashcards/js/sync.js';
import '../../../flashcards/js/platform.js';
import '../../../flashcards/js/legacy.js';
import '../../../flashcards/js/summary.js';
import '../../../flashcards/js/pdf.js';
import '../../../flashcards/js/ai.js';

// Interface
import '../../../flashcards/js/ui/ui.js';
import '../../../flashcards/js/ui/charts.js';
import '../../../flashcards/js/ui/cardEditor.js';
import '../../../flashcards/js/ui/cardDetail.js';
import '../../../flashcards/js/ui/cardList.js';
import '../../../flashcards/js/ui/launch.js';
import '../../../flashcards/js/ui/dashboardView.js';
import '../../../flashcards/js/ui/reviewView.js';
import '../../../flashcards/js/ui/quickView.js';
import '../../../flashcards/js/ui/decksView.js';
import '../../../flashcards/js/ui/platformView.js';
import '../../../flashcards/js/ui/generateView.js';
import '../../../flashcards/js/ui/weakView.js';
import '../../../flashcards/js/ui/statsView.js';
import '../../../flashcards/js/ui/calendarView.js';
import '../../../flashcards/js/ui/searchView.js';
import '../../../flashcards/js/ui/trashView.js';
import '../../../flashcards/js/ui/importView.js';
import '../../../flashcards/js/ui/settingsView.js';
import '../../../flashcards/js/app.js';

export const FC = (globalThis as unknown as { FC: FlashcardsEngine }).FC;
