import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  AreaNode,
  Board,
  CalendarData,
  Dashboard,
  Goal,
  GroupBoard,
  GroupCompare,
  GroupListItem,
  MockExamList,
  Notification,
  Progress,
  Review,
  Study,
  StudyResult,
  Subject,
} from '../api/types';

// Chaves de cache. Mutations invalidam os grupos afetados.
export const keys = {
  dashboard: ['dashboard'] as const,
  areas: ['areas'] as const,
  subjects: (q?: string) => ['subjects', q ?? ''] as const,
  subject: (id: string) => ['subject', id] as const,
  studies: (params?: object) => ['studies', params ?? {}] as const,
  reviews: (params?: object) => ['reviews', params ?? {}] as const,
  agenda: ['reviews', 'agenda'] as const,
  calendar: (month: string) => ['reviews', 'calendar', month] as const,
  metrics: (kind: string, params: object) => ['metrics', kind, params] as const,
  goals: ['goals'] as const,
  mocks: ['mocks'] as const,
  boards: ['boards'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['group', id] as const,
  notifications: ['notifications'] as const,
  progress: ['progress'] as const,
};

/** Invalida tudo que depende de registros de estudo. */
export function useInvalidateStudyData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['dashboard', 'subjects', 'subject', 'studies', 'reviews', 'metrics', 'goals', 'notifications', 'progress', 'group', 'search'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<Dashboard>('/dashboard') });
export const useAreas = () => useQuery({ queryKey: keys.areas, queryFn: () => api.get<AreaNode[]>('/areas'), staleTime: 60_000 });
export const useSubjects = () =>
  useQuery({ queryKey: keys.subjects(), queryFn: () => api.get<Subject[]>('/subjects', { includeArchived: true }), staleTime: 30_000 });
export const useAgenda = (days = 14) =>
  useQuery({ queryKey: [...keys.agenda, days], queryFn: () => api.get<{ today: Review[]; overdue: Review[]; upcoming: Review[] }>('/reviews/agenda', { days }) });
export const useCalendar = (month: string) =>
  useQuery({ queryKey: keys.calendar(month), queryFn: () => api.get<CalendarData>('/reviews/calendar', { month }), placeholderData: (p) => p });
export const useGoals = () => useQuery({ queryKey: keys.goals, queryFn: () => api.get<Goal[]>('/goals') });
export const useMockExams = () => useQuery({ queryKey: keys.mocks, queryFn: () => api.get<MockExamList>('/mock-exams') });
export const useBoards = () => useQuery({ queryKey: keys.boards, queryFn: () => api.get<Board[]>('/exams/boards') });
export const useGroups = () => useQuery({ queryKey: keys.groups, queryFn: () => api.get<GroupListItem[]>('/groups') });
export const useGroup = (id?: string) =>
  useQuery({ queryKey: keys.group(id ?? ''), queryFn: () => api.get<GroupBoard>(`/groups/${id}`), enabled: !!id });
export const useGroupCompare = (id: string | undefined, period: 7 | 30) =>
  useQuery({
    queryKey: [...keys.group(id ?? ''), 'compare', period],
    queryFn: () => api.get<GroupCompare>(`/groups/${id}/compare`, { period }),
    enabled: !!id,
    placeholderData: (prev) => prev,
  });
export const useProgress = () => useQuery({ queryKey: keys.progress, queryFn: () => api.get<Progress>('/me/progress') });
export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications', { limit: 30 }),
    refetchInterval: 5 * 60_000,
  });
export const useStudies = (params: { subjectId?: string; limit?: number; from?: string; to?: string } = {}) =>
  useQuery({ queryKey: keys.studies(params), queryFn: () => api.get<Study[]>('/studies', params) });

/** Fixa/desafixa um grupo na página inicial (preferência pessoal). */
export function useToggleFavoriteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => api.put(`/groups/${id}/favorite`, { favorite }),
    onSuccess: (_data, { id }) =>
      Promise.all([qc.invalidateQueries({ queryKey: keys.groups }), qc.invalidateQueries({ queryKey: keys.group(id) })]),
  });
}

export function useRescheduleReview() {
  const invalidate = useInvalidateStudyData();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => api.patch<Review>(`/reviews/${id}/reschedule`, { date }),
    onSuccess: invalidate,
  });
}

export function useCreateStudy() {
  const invalidate = useInvalidateStudyData();
  return useMutation({
    mutationFn: (body: unknown) => api.post<StudyResult>('/studies', body),
    onSuccess: invalidate,
  });
}
