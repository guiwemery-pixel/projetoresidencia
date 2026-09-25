import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './components/layout/AppLayout';
import { StudyDialogProvider } from './components/study/StudyDialog';
import { Loading } from './components/ui';
import { LoginPage, RegisterPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';

// Páginas secundárias carregadas sob demanda (bundle inicial menor)
const ReviewsPage = lazy(() => import('./pages/Reviews'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const MetricsPage = lazy(() => import('./pages/Metrics'));
const StudiesPage = lazy(() => import('./pages/Studies'));
const SubjectsPage = lazy(() => import('./pages/Subjects'));
const SubjectDetailPage = lazy(() => import('./pages/SubjectDetail'));
const GoalsPage = lazy(() => import('./pages/Goals'));
const MockExamsPage = lazy(() => import('./pages/MockExams'));
const ExamsPage = lazy(() => import('./pages/Exams'));
const GroupPage = lazy(() => import('./pages/Group'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const SearchPage = lazy(() => import('./pages/Search'));
const PrintWeekPage = lazy(() => import('./pages/PrintWeek'));
const ImportPage = lazy(() => import('./pages/Import'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/cadastro" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      {/* Folha de impressão: sem menu lateral */}
      <Route
        path="/calendario/imprimir"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <PrintWeekPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <StudyDialogProvider>
              <AppLayout />
            </StudyDialogProvider>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        {[
          ['revisoes', <ReviewsPage />],
          ['calendario', <CalendarPage />],
          ['metricas', <MetricsPage />],
          ['estudos', <StudiesPage />],
          ['importar', <ImportPage />],
          ['assuntos', <SubjectsPage />],
          ['assuntos/:id', <SubjectDetailPage />],
          ['metas', <GoalsPage />],
          ['simulados', <MockExamsPage />],
          ['provas', <ExamsPage />],
          ['grupo', <GroupPage />],
          ['grupo/:id', <GroupPage />],
          ['perfil', <ProfilePage />],
          ['busca', <SearchPage />],
        ].map(([path, el]) => (
          <Route key={path as string} path={path as string} element={<Suspense fallback={<Loading />}>{el}</Suspense>} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-4xl">🧭</p>
      <p className="mt-2 font-medium text-ink">Página não encontrada</p>
    </div>
  );
}
