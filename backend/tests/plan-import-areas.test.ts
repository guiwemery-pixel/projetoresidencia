import { beforeEach, describe, expect, it } from 'vitest';
import { firstArea, resetDb, signup } from './helpers.js';
import { addDays, startOfWeek, todayIn } from '../src/lib/dates.js';

// Importar cronograma escolhendo a área (ou subárea) de cada assunto — inclusive áreas criadas pela pessoa

beforeEach(async () => {
  await resetDb();
});

const today = todayIn('America/Sao_Paulo');
const week = startOfWeek(addDays(today, 7));

describe('importar cronograma: área de cada assunto', () => {
  it('assuntos vão para a área criada pela pessoa e para a subárea escolhida, sem cair em Clínica Médica', async () => {
    const { agent } = await signup('Oftalmo');
    const oftalmo = (await agent.post('/api/areas').send({ name: 'Oftalmologia' })).body;
    expect(oftalmo.id).toBeTruthy();
    const retina = (await agent.post('/api/areas').send({ name: 'Retina', parentId: oftalmo.id })).body;
    const cm = await firstArea(agent, 'Clínica Médica');
    // Já existe em Oftalmologia (geral): é aproveitado mesmo escolhendo a subárea
    await agent.post('/api/subjects').send({ areaId: oftalmo.id, name: 'Glaucoma' });

    const items = [
      { subject: 'Catarata', areaId: oftalmo.id, weekStart: week, label: 'Semana 01' },
      { subject: 'Retinopatia diabética', areaId: retina.id, weekStart: week, label: 'Semana 01' },
      { subject: 'glaucoma', areaId: retina.id, weekStart: week, label: 'Semana 01' },
      { subject: 'Hipertensão', area: 'Clínica Médica', weekStart: week, label: 'Semana 01' },
    ];
    const preview = await agent.post('/api/plans/preview').send({ name: 'Oftalmo', items });
    expect(preview.body).toMatchObject({ items: 4, newSubjects: 3, existingSubjects: 1, newAreas: [] });
    const created = await agent.post('/api/plans').send({ name: 'Oftalmo', items });
    expect(created.status).toBe(201);

    const subjects = (await agent.get('/api/subjects')).body as { name: string; areaId: string }[];
    const where = Object.fromEntries(subjects.map((s) => [s.name, s.areaId]));
    expect(where['Catarata']).toBe(oftalmo.id);
    expect(where['Retinopatia diabética']).toBe(retina.id);
    expect(where['Glaucoma']).toBe(oftalmo.id);
    expect(subjects.filter((s) => s.name.toLowerCase() === 'glaucoma')).toHaveLength(1);
    expect(subjects.filter((s) => s.areaId === cm.id || cm.children.some((c) => c.id === s.areaId)).map((s) => s.name)).toEqual(['Hipertensão']);

    // Área de outra pessoa não vale
    const other = await signup('Outro');
    const bad = await other.agent.post('/api/plans').send({ name: 'X', items: [{ subject: 'Catarata', areaId: oftalmo.id, weekStart: week }] });
    expect(bad.status).toBe(400);
  });
});
