import type { Template } from './index.js';

// Estrutura inicial para residência médica. O usuário pode renomear, excluir e
// criar áreas/subáreas/assuntos livremente — isto é só um ponto de partida.
// Cores: paleta categórica validada para daltonismo (ver frontend/src/lib/palette.ts).
export const medicina: Template = {
  key: 'medicina',
  label: 'Medicina (residência / ENAMED)',
  areas: [
    {
      name: 'Clínica Médica',
      color: '#2a78d6',
      children: [
        'Cardiologia',
        'Pneumologia',
        'Gastroenterologia',
        'Hepatologia',
        'Nefrologia',
        'Endocrinologia',
        'Reumatologia',
        'Hematologia',
        'Infectologia',
        'Neurologia',
        'Psiquiatria',
        'Medicina de Emergência',
      ],
    },
    {
      name: 'Cirurgia',
      color: '#eb6834',
      children: [
        'Cirurgia do Aparelho Digestivo',
        'Vias Biliares',
        'Trauma',
        'Cirurgia Vascular',
        'Urologia',
        'Ortopedia',
        'Cirurgia Pediátrica',
        'Proctologia',
      ],
    },
    {
      name: 'Pediatria',
      color: '#1baf7a',
      children: ['Neonatologia', 'Puericultura', 'Infectologia Pediátrica', 'Emergências Pediátricas'],
    },
    {
      name: 'Ginecologia e Obstetrícia',
      color: '#eda100',
      children: ['Obstetrícia', 'Ginecologia', 'Mastologia'],
    },
    {
      name: 'Medicina Preventiva',
      color: '#e87ba4',
      children: ['Epidemiologia', 'Bioestatística', 'SUS e Políticas de Saúde', 'Medicina de Família', 'Ética Médica'],
    },
  ],
  boards: ['ENAMED', 'ENARE', 'FGV', 'FCC', 'Cebraspe', 'Vunesp', 'SUS-SP', 'USP', 'UNIFESP'],
};
