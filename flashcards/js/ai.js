/*
 * Camada de IA — separada de todo o resto (scheduler e estatísticas não usam IA).
 *
 * Tarefas: gerar cards de um texto/PDF, refazer, simplificar, detalhar, criar card
 * complementar, sugerir temas para um ponto fraco e gerar cards direcionados.
 *
 * Provedores (Configurações → IA):
 *  - manual:    nada é enviado; o app monta o pedido para você colar no Claude (claude.ai)
 *               e colar a resposta de volta.
 *  - anthropic: chamada direta à API do Claude a partir deste navegador, com a SUA chave
 *               (guardada só neste navegador, fora do backup). SDK oficial @anthropic-ai/sdk.
 *  - backend:   POST para um servidor seu, que guarda a chave e chama a API
 *               (contrato em docs/FLASHCARDS.md). Caminho recomendado para produção.
 *
 * Estatísticas e agendamento nunca vêm da IA: ela só produz conteúdo (cards e sugestões).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { stripHtml, truncate } = FC.util;

  const MODELS = [
    { id: 'claude-opus-5', label: 'Claude Opus 5 (padrão)' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ];

  const ANSWER_SIZES = [
    { key: 'palavra', label: 'Uma palavra', rule: 'uma palavra ou termo técnico (sem frase)' },
    { key: 'muito-curta', label: 'Muito curta', rule: 'no máximo uma linha curta (até ~10 palavras)' },
    { key: 'curta', label: 'Curta', rule: '1 a 3 tópicos curtos' },
    { key: 'media', label: 'Média', rule: '3 a 5 tópicos' },
    { key: 'longa', label: 'Longa', rule: '5 a 8 tópicos' },
    { key: 'muito-detalhada', label: 'Muito detalhada', rule: 'até 12 tópicos, com valores, critérios e exceções relevantes' },
  ];

  const CARD_TYPES = [
    { key: 'auto', label: 'Automático', rule: 'escolha, para cada informação, o tipo de card mais adequado' },
    { key: 'conceito', label: 'Conceito → definição', rule: 'frente com o conceito, verso com a definição' },
    { key: 'pergunta', label: 'Pergunta → resposta', rule: 'pergunta direta e resposta objetiva' },
    { key: 'causa', label: 'Causa → consequência', rule: 'frente com a causa/mecanismo, verso com a consequência' },
    { key: 'diagnostico', label: 'Diagnóstico → características', rule: 'frente com o diagnóstico, verso com as características que o identificam' },
    { key: 'doenca-diagnostico', label: 'Doença → diagnóstico', rule: 'frente com a doença, verso com como se faz o diagnóstico (exames, critérios)' },
    { key: 'doenca-tratamento', label: 'Doença → tratamento', rule: 'frente com a doença/situação, verso com o tratamento' },
    { key: 'comparacao', label: 'Comparação', rule: 'frente pedindo a diferença entre dois itens (A × B), verso com as diferenças lado a lado' },
    { key: 'classificacao', label: 'Classificação', rule: 'frente com o nome da classificação, verso com as categorias' },
    { key: 'conduta', label: 'Conduta', rule: 'frente com um cenário clínico curto, verso com a conduta em sequência' },
    { key: 'livre', label: 'Livre', rule: 'formato livre, mantendo uma unidade de conhecimento por card' },
  ];
  const CARD_TYPE_KEYS = CARD_TYPES.map((t) => t.key).filter((k) => k !== 'auto');

  const DIFFICULTIES = [
    { key: 'auto', label: 'Automática' },
    { key: 'facil', label: 'Fácil' },
    { key: 'media', label: 'Média' },
    { key: 'dificil', label: 'Difícil' },
  ];

  // ── Esquemas de saída (structured outputs) ─────────────────────────────────
  const CARD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['front', 'back', 'area', 'subarea', 'subject', 'topic', 'subtopic', 'tags', 'difficulty', 'cardType', 'page', 'reference'],
    properties: {
      front: { type: 'string', description: 'Pergunta (frente do card). HTML simples permitido: <b>, <i>, <sub>, <sup>.' },
      back: { type: 'string', description: 'Resposta (verso). Tópicos começando com "- " separados por <br>.' },
      area: { type: 'string', description: 'Grande área' },
      subarea: { type: 'string', description: 'Subárea / especialidade' },
      subject: { type: 'string', description: 'Assunto (doença ou tema principal)' },
      topic: { type: 'string', description: 'Tema específico (ex.: Fisiopatologia, Diagnóstico, Tratamento)' },
      subtopic: { type: 'string', description: 'Subtema opcional; vazio se não houver' },
      tags: { type: 'array', items: { type: 'string' } },
      difficulty: { type: 'string', enum: ['facil', 'media', 'dificil'] },
      cardType: { type: 'string', enum: CARD_TYPE_KEYS },
      page: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Página do texto de onde veio a informação' },
      reference: { type: 'string', description: 'Diretriz/estudo citado no texto (ou vazio)' },
    },
  };
  const CARDS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['cards'],
    properties: { cards: { type: 'array', items: CARD_SCHEMA } },
  };
  const SUGGEST_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'why'],
          properties: { title: { type: 'string' }, why: { type: 'string' } },
        },
      },
    },
  };

  // ── Prompts ────────────────────────────────────────────────────────────────
  const STYLE_RULES = `Formato dos cards (padrão do usuário, para importar no Anki):
- Frente: pergunta direta e curta, terminando em "?". Exemplos do estilo: "Classificação de Borrmann?", "T1a × T1b?", "Lauren — tipo DIFUSO?", "Quando indicar radioterapia?", "Critérios de irressecabilidade (NCCN)?". Quando uma palavra decide a resposta, escreva-a em MAIÚSCULAS ("paciente ESTÁVEL", "SEM tamponamento").
- Verso: tópicos começando com "- " separados por <br> (ex.: "- 1: polipoide<br>- 2: ulcerado de bordas nítidas"). Use <b> para o essencial. Mantenha números, doses, pontos de corte, nomes de estudos e de diretrizes que estiverem no texto. Use "→" para sequências e "×" para comparações. Resposta de um item só pode vir sem tópico.
- NÃO escreva "Pergunta:" nem "Resposta:" nem o nome do assunto no card: o app acrescenta isso na exportação.`;

  const QUALITY_RULES = `Regras de qualidade:
- Transforme o conteúdo em perguntas de recordação ativa (active recall). Não resuma o texto e não copie parágrafos.
- Uma unidade de conhecimento por card. Nada de "Explique a fisiopatologia, clínica e tratamento de X": divida em cards específicos.
- Priorize o que cai em prova de residência: conceitos, definições, critérios diagnósticos, classificações, mecanismos fisiopatológicos, diagnóstico, tratamento, indicações, contraindicações, valores importantes, diferenças entre doenças e entre tratamentos, sequências de conduta, complicações, fatores de risco, exames e achados clínicos.
- Evite informação trivial, perguntas redundantes entre si, cards amplos demais e perguntas cuja resposta seja o próprio título.`;

  const HIERARCHY_RULES = `Classificação de cada card (usada nas estatísticas, então seja consistente entre os cards):
- area (Grande área): Clínica Médica, Cirurgia, Pediatria, Ginecologia e Obstetrícia ou Medicina Preventiva (ou outra grande área se o conteúdo não for dessas).
- subarea: a especialidade (ex.: Infectologia, Cardiologia, Cirurgia Digestiva, Neonatologia).
- subject (Assunto): a doença ou tema principal (ex.: Tuberculose, Acalasia, Câncer gástrico).
- topic (Tema específico): o aspecto — use preferencialmente: Epidemiologia, Fatores de risco, Fisiopatologia, Patologia, Quadro clínico, Diagnóstico, Classificação, Estadiamento, Tratamento, Complicações, Prognóstico, Prevenção.
- subtopic: um recorte mais fino quando útil (ex.: "Brasil (INCA)", "Critérios de Amsel"); senão, string vazia.
- tags: 1 a 3 tags curtas sem espaços (ex.: "acalasia", "esofago").
Reutilize exatamente os nomes que já existem na coleção quando o conteúdo for o mesmo.`;

  const SOURCE_RULES_TEXT = `Fonte: use APENAS o texto fornecido. Não invente dados, números, estudos, diretrizes ou referências que não estejam no texto. Se o texto não traz a informação, não crie o card. Em "page", informe a página indicada pelas marcas [[Página N]] de onde veio a informação. Em "reference", cite só diretriz/estudo/fonte que o próprio texto mencione para aquela informação; senão, deixe vazio.`;

  const SOURCE_RULES_KNOWLEDGE = `Fonte: baseie-se em conhecimento médico consolidado (diretrizes do Ministério da Saúde e das sociedades brasileiras, CDC/FDA, revisões recentes no NEJM, Lancet, JAMA, BMJ). Em "reference", cite apenas uma diretriz ou revisão que você tem certeza de que existe (nome da instituição/sociedade/periódico e ano); se não tiver certeza, deixe vazio. Nunca invente DOI, autores ou títulos. Em "page", use null.`;

  function sizeRule(key) {
    return (ANSWER_SIZES.find((s) => s.key === key) || ANSWER_SIZES[2]).rule;
  }
  function typeRule(key) {
    return (CARD_TYPES.find((t) => t.key === key) || CARD_TYPES[0]).rule;
  }
  function difficultyRule(key) {
    if (!key || key === 'auto') return 'Estime a dificuldade de cada card (facil, media ou dificil) para um estudante de medicina se preparando para a residência.';
    const label = { facil: 'fácil', media: 'média', dificil: 'difícil' }[key];
    return 'Escreva cards de dificuldade ' + label + ' e marque "difficulty" como "' + key + '".';
  }

  function existingHierarchy(limit = 60) {
    const paths = new Set();
    for (const n of FC.store.nodes.values()) {
      if (n.level >= 2) paths.add(FC.areas.pathNames(n.id).slice(0, 4).join(' › '));
      if (paths.size >= limit) break;
    }
    return [...paths].sort();
  }

  function forcedRule(forced) {
    if (!forced) return '';
    const parts = [];
    if (forced.area) parts.push('area = "' + forced.area + '"');
    if (forced.subarea) parts.push('subarea = "' + forced.subarea + '"');
    if (forced.subject) parts.push('subject = "' + forced.subject + '"');
    if (forced.topic) parts.push('topic = "' + forced.topic + '"');
    return parts.length ? '\nUse obrigatoriamente: ' + parts.join(', ') + '.' : '';
  }

  function systemPrompt(extra) {
    const style = FC.settings.get('genStyle') === 'livre' ? 'Formato livre: frente com uma pergunta clara; verso objetivo, com tópicos quando houver mais de um item.' : STYLE_RULES;
    return ['Você cria flashcards de medicina, em português do Brasil, para estudantes que se preparam para provas de residência médica (ENARE, ENAMED e similares).', QUALITY_RULES, style, HIERARCHY_RULES, extra || ''].filter(Boolean).join('\n\n');
  }

  /** Pedido para gerar cards a partir de um bloco de texto. */
  function buildGenerate(input) {
    const hierarchy = existingHierarchy();
    const user = [
      'Gere exatamente ' + input.count + ' flashcards a partir do texto abaixo' + (input.fileName ? ' (arquivo "' + input.fileName + '", páginas ' + input.fromPage + '–' + input.toPage + ')' : '') + '.',
      'Tamanho da resposta: ' + sizeRule(input.answerSize) + '.',
      'Tipo de card: ' + typeRule(input.cardType) + '.',
      difficultyRule(input.difficulty),
      input.focus ? 'Foco pedido pelo usuário: ' + input.focus : '',
      forcedRule(input.forced),
      hierarchy.length ? 'Classificações já existentes na coleção:\n' + hierarchy.map((p) => '- ' + p).join('\n') : '',
      '<texto>\n' + input.text + '\n</texto>',
    ]
      .filter(Boolean)
      .join('\n\n');
    return { task: 'generate', system: systemPrompt(SOURCE_RULES_TEXT), user, schema: CARDS_SCHEMA, maxTokens: 64000 };
  }

  function cardBlock(card) {
    const path = card.path || (card.nodeId ? FC.areas.pathNames(card.nodeId) : []);
    return (
      '<card>\nFrente: ' +
      card.front +
      '\nVerso: ' +
      card.back +
      '\nClassificação: ' +
      (path.join(' › ') || '—') +
      (card.source && card.source.page ? '\nPágina de origem: ' + card.source.page : '') +
      '\n</card>'
    );
  }

  const CARD_TASKS = {
    regenerate: 'Reescreva este card do zero, testando a MESMA informação de um jeito melhor (pergunta mais precisa, resposta mais clara). Devolva 1 card.',
    simplify: 'Simplifique este card: pergunta mais direta e resposta mais curta, só com o essencial para a prova. Devolva 1 card.',
    detail: 'Detalhe este card: mantenha a pergunta (ajuste se preciso) e enriqueça a resposta com os valores, critérios e exceções relevantes do texto. Devolva 1 card.',
    complement: 'Crie 2 cards complementares a este: perguntas sobre informações relacionadas que ajudam a fixar o mesmo assunto (sem repetir a pergunta original).',
  };

  /** Pedido para uma ação sobre um card (refazer, simplificar, detalhar, complementar). */
  function buildCardAction(action, card, contextText) {
    const hasText = !!(contextText && contextText.trim());
    const user = [
      CARD_TASKS[action],
      forcedRule({ area: (card.path || [])[0], subarea: (card.path || [])[1], subject: (card.path || [])[2] }),
      cardBlock(card),
      hasText ? '<texto>\n' + contextText + '\n</texto>' : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return { task: action, system: systemPrompt(hasText ? SOURCE_RULES_TEXT : SOURCE_RULES_KNOWLEDGE), user, schema: CARDS_SCHEMA, maxTokens: 16000 };
  }

  /** Sugestões de temas para um ponto fraco (a partir dos cards e erros reais). */
  function buildSuggest(input) {
    const lines = input.cards.slice(0, 60).map((c) => '- ' + truncate(stripHtml(c.front), 160) + (c.errors ? ' (errado ' + c.errors + 'x)' : ''));
    const user = [
      'O estudante tem dificuldade em: ' + input.pathText + '.',
      'Dados do sistema (reais): ' + input.statsText,
      'Cards que ele já tem sobre isso (com quantas vezes errou):\n' + lines.join('\n'),
      input.contextText ? '<texto>\n' + input.contextText + '\n</texto>' : '',
      'Sugira de 4 a 8 temas específicos para novos cards que cubram lacunas e reforcem o que ele mais erra (ex.: "Indicações de POEM", "Comparação entre POEM e Heller"). Em "why", diga em uma frase por que o tema ajuda. Não repita perguntas que ele já tem.',
    ]
      .filter(Boolean)
      .join('\n\n');
    return { task: 'suggest', system: systemPrompt(input.contextText ? SOURCE_RULES_TEXT : SOURCE_RULES_KNOWLEDGE), user, schema: SUGGEST_SCHEMA, maxTokens: 8000 };
  }

  /** Cards direcionados a um ponto fraco. */
  function buildTargeted(input) {
    const existing = input.cards.slice(0, 60).map((c) => '- ' + truncate(stripHtml(c.front), 160));
    const user = [
      'Gere ' + input.count + ' flashcards para reforçar o ponto fraco: ' + input.pathText + '.',
      input.topics && input.topics.length ? 'Cubra estes temas:\n' + input.topics.map((t) => '- ' + t).join('\n') : '',
      'Tamanho da resposta: ' + sizeRule(input.answerSize) + '.',
      difficultyRule(input.difficulty),
      forcedRule(input.forced),
      'Perguntas que ele já tem (não repita):\n' + existing.join('\n'),
      input.contextText ? '<texto>\n' + input.contextText + '\n</texto>' : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return { task: 'targeted', system: systemPrompt(input.contextText ? SOURCE_RULES_TEXT : SOURCE_RULES_KNOWLEDGE), user, schema: CARDS_SCHEMA, maxTokens: 32000 };
  }

  // ── Execução ───────────────────────────────────────────────────────────────
  function provider() {
    return FC.settings.get('aiProvider') || 'manual';
  }

  /** Descrição do que sai do navegador (mostrada antes de enviar). */
  function privacyNotice() {
    const p = provider();
    if (p === 'anthropic') return 'O texto selecionado será enviado deste navegador diretamente para a API da Anthropic (Claude), usando a sua chave. Seus outros cards e estatísticas não são enviados.';
    if (p === 'backend') return 'O texto selecionado será enviado para o servidor configurado (' + (FC.settings.get('aiEndpoint') || 'sem endereço') + '), que chama a IA. Seus outros cards e estatísticas não são enviados.';
    return 'Nada é enviado automaticamente: o app monta o pedido para você copiar e colar no Claude, e depois colar a resposta aqui.';
  }

  /** Texto único para o modo manual (colar no claude.ai). */
  function manualPrompt(req) {
    return (
      req.system +
      '\n\n---\n\n' +
      req.user +
      '\n\n---\n\nResponda SOMENTE com um JSON válido neste formato (sem texto antes ou depois):\n' +
      JSON.stringify(exampleFor(req.schema), null, 1)
    );
  }

  function exampleFor(schema) {
    if (schema === SUGGEST_SCHEMA) return { suggestions: [{ title: 'Tema', why: 'Motivo' }] };
    return {
      cards: [
        { front: 'Pergunta?', back: '- tópico 1<br>- tópico 2', area: 'Cirurgia', subarea: 'Cirurgia Digestiva', subject: 'Acalasia', topic: 'Tratamento', subtopic: '', tags: ['acalasia'], difficulty: 'media', cardType: 'conduta', page: 12, reference: '' },
      ],
    };
  }

  /** Extrai o JSON de uma resposta colada (aceita ```json ...``` e texto em volta). */
  function parseResponse(text) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const first = s.search(/[[{]/);
    const lastObj = s.lastIndexOf('}');
    const lastArr = s.lastIndexOf(']');
    const last = Math.max(lastObj, lastArr);
    if (first < 0 || last < first) throw new Error('Não encontrei um JSON na resposta.');
    let data;
    try {
      data = JSON.parse(s.slice(first, last + 1));
    } catch (e) {
      throw new Error('O JSON da resposta está incompleto ou inválido (' + e.message + ').');
    }
    if (Array.isArray(data)) data = { cards: data };
    return data;
  }

  async function sdk() {
    await FC.loader.script('assets/vendor/anthropic-sdk.min.js');
    const mod = root.AnthropicSDK;
    const Anthropic = mod && (mod.default || mod.Anthropic || mod);
    if (!Anthropic) throw new Error('SDK da Anthropic indisponível.');
    return Anthropic;
  }

  function friendlyError(err, Anthropic) {
    if (Anthropic) {
      if (err instanceof Anthropic.AuthenticationError) return new Error('Chave de API inválida. Confira em Configurações → IA.');
      if (err instanceof Anthropic.PermissionDeniedError) return new Error('A chave não tem permissão para este modelo.');
      if (err instanceof Anthropic.RateLimitError) return new Error('Limite de uso da API atingido. Tente de novo em alguns minutos.');
      if (err instanceof Anthropic.BadRequestError) return new Error('Pedido recusado pela API: ' + (err.message || '').slice(0, 300));
      if (err instanceof Anthropic.APIConnectionError) return new Error('Sem conexão com a API da Anthropic (verifique a internet).');
      if (err instanceof Anthropic.APIError) return new Error('Erro da API (' + (err.status || '?') + '): ' + (err.message || '').slice(0, 300));
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async function callAnthropic(req, onProgress) {
    const key = FC.settings.getApiKey();
    if (!key) throw new Error('Informe sua chave de API em Configurações → IA (ou use o modo manual).');
    const Anthropic = await sdk();
    const model = FC.settings.get('aiModel') || 'claude-opus-5';
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const params = {
      model,
      max_tokens: req.maxTokens || 32000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { format: { type: 'json_schema', schema: req.schema } },
    };
    if (model !== 'claude-haiku-4-5') params.output_config.effort = FC.settings.get('aiEffort') || 'high';
    let received = 0;
    try {
      // Opus 5: se o modelo recusar, a própria API repete o pedido num modelo substituto
      const stream =
        model === 'claude-opus-5'
          ? client.beta.messages.stream(Object.assign({}, params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }))
          : client.messages.stream(params);
      stream.on('text', (delta) => {
        received += delta.length;
        if (onProgress) onProgress({ received });
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new Error('O modelo recusou este pedido. Tente outro trecho do texto.');
      if (msg.stop_reason === 'max_tokens') throw new Error('A resposta ficou grande demais e foi cortada. Peça menos cards por vez ou selecione menos páginas.');
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return parseResponse(text);
    } catch (err) {
      throw friendlyError(err, Anthropic);
    }
  }

  async function callBackend(req, onProgress) {
    const endpoint = FC.settings.get('aiEndpoint');
    if (!endpoint) throw new Error('Informe o endereço do servidor em Configurações → IA.');
    if (onProgress) onProgress({ received: 0 });
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: req.task, model: FC.settings.get('aiModel'), system: req.system, prompt: req.user, schema: req.schema, maxTokens: req.maxTokens }),
      });
    } catch (e) {
      throw new Error('Não foi possível falar com o servidor de IA (' + e.message + ').');
    }
    if (!res.ok) throw new Error('O servidor de IA respondeu ' + res.status + '.');
    const data = await res.json();
    if (data.output && typeof data.output === 'object') return data.output;
    if (typeof data.text === 'string') return parseResponse(data.text);
    throw new Error('Resposta do servidor sem "output" nem "text".');
  }

  /**
   * Executa um pedido. No modo manual devolve { manual: true, prompt } para a tela
   * mostrar o texto a copiar; nos outros, o JSON já validado.
   */
  async function run(req, onProgress) {
    const p = provider();
    if (p === 'anthropic') return callAnthropic(req, onProgress);
    if (p === 'backend') return callBackend(req, onProgress);
    return { manual: true, prompt: manualPrompt(req) };
  }

  // ── Normalização das respostas ─────────────────────────────────────────────
  const clean = (s) => String(s == null ? '' : s).trim();

  function normalizeCards(data, defaults) {
    const list = data && Array.isArray(data.cards) ? data.cards : [];
    const d = defaults || {};
    return list
      .filter((c) => c && clean(c.front) && clean(c.back))
      .map((c) => {
        const forced = d.forced || {};
        const path = [forced.area || clean(c.area), forced.subarea || clean(c.subarea), forced.subject || clean(c.subject), forced.topic || clean(c.topic), clean(c.subtopic)];
        const page = Number.isInteger(c.page) ? c.page : parseInt(c.page, 10) || null;
        return {
          front: clean(c.front).replace(/^\s*(<b>)?\s*Pergunta\s*:\s*(<\/b>)?\s*/i, ''),
          back: clean(c.back).replace(/^\s*(<b>)?\s*Resposta\s*:\s*(<\/b>)?\s*(<br\s*\/?>)?\s*/i, ''),
          path,
          tags: Array.isArray(c.tags) ? c.tags.map(clean).filter(Boolean) : [],
          difficulty: ['facil', 'media', 'dificil'].includes(c.difficulty) ? c.difficulty : d.difficulty && d.difficulty !== 'auto' ? d.difficulty : 'media',
          cardType: clean(c.cardType),
          reference: clean(c.reference),
          source: d.fileName ? { fileName: d.fileName, page, sourceId: d.sourceId || null } : null,
        };
      });
  }

  function normalizeSuggestions(data) {
    const list = data && Array.isArray(data.suggestions) ? data.suggestions : [];
    return list.filter((s) => s && clean(s.title)).map((s) => ({ title: clean(s.title), why: clean(s.why) }));
  }

  FC.ai = {
    MODELS,
    ANSWER_SIZES,
    CARD_TYPES,
    DIFFICULTIES,
    CARDS_SCHEMA,
    SUGGEST_SCHEMA,
    provider,
    privacyNotice,
    buildGenerate,
    buildCardAction,
    buildSuggest,
    buildTargeted,
    manualPrompt,
    parseResponse,
    run,
    normalizeCards,
    normalizeSuggestions,
  };
})(typeof self !== 'undefined' ? self : this);
