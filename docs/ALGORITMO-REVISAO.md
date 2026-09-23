# Algoritmo de revisão espaçada — `adaptive-ladder-v1`

Código: `backend/src/modules/scheduler/` (puro e testado em `engine.test.ts`).
Parâmetros: `config.ts` + sobrescritas na tabela `algorithm_configs`.

## Ideia central

Cada **assunto** tem seu próprio histórico de aprendizagem. Cada dia em que você estuda o assunto
é um **contato**. O primeiro contato é o **D0**; os seguintes são revisões. A cada contato o sistema:

1. **mede** como foi (acertos + autoavaliação);
2. **classifica** o resultado numa faixa;
3. **move** o assunto na escada de intervalos (avança, mantém, volta ou reinicia);
4. **ajusta** o intervalo pelo que já sabe desse assunto;
5. **explica** tudo no botão **“Por quê?”**.

Sessões do mesmo dia são somadas num único contato (ex.: teoria de manhã e questões à noite).

## 1. Escada de intervalos-base

| Etapa | Intervalo-base | Fase | Métodos sugeridos | Questões sugeridas* |
|---|---|---|---|---|
| D0 | — | Aprender | Teoria + questões | pequeno 10–15 · médio 15–25 · grande 20–30 |
| D1 | 1 dia | Evitar esquecimento precoce | Flashcards, recall ativo, perguntas rápidas | 5–10 |
| D7 | 7 dias | Consolidar | Questões, flashcards, recall | 10–20 |
| D21 | 21 dias | Recuperação após intervalo maior | Questões | 15–25 |
| D60 | 60 dias | Manutenção | Questões, flashcards | 15–25 |
| D90+ | 90 dias, depois ×1,5 (máx. 180) | Manutenção de longo prazo | Questões, simulados, recall | 20–30 |

\* para assunto médio; pequeno ×0,75 e grande ×1,25. Os D são **intervalos desde o último
contato**, porque as datas reais se deslocam com a adaptação.

## 2. Pontuação do contato (0–100)

```
pontuação = (acertos% × pesoAcertos + autoavaliação × 0,30) ÷ (pesoAcertos + 0,30)
pesoAcertos = 0,70 × min(1, questões ÷ 10)      ← poucas questões pesam menos
```

| Autoavaliação | Pontos |
|---|---|
| 😄 Dominei | 100 |
| 🙂 Fui bem | 85 |
| 😐 Razoável | 70 |
| 😕 Tive dificuldade | 50 |
| 😣 Esqueci praticamente tudo | 20 |

Só questões → pontuação = % de acertos. Só autoavaliação → pontos da autoavaliação.
Nenhum dos dois (ex.: só leitura) → sem medida: a etapa é mantida.

Exemplos da especificação: 90% + Dominei = 93 · 70% + Razoável = 70 · 50% + Tive dificuldade = 50 ·
20% + Esqueci = 20.

## 3. Faixas e regras

| Pontuação | Faixa | Etapa | Intervalo | Facilidade do assunto |
|---|---|---|---|---|
| ≥ 90 | Excelente | avança 1 | base da nova etapa × **1,2** + modificadores | +0,05 |
| 80–89 | Bom | avança 1 | base da nova etapa + modificadores | +0,02 |
| 70–79 | Mediano | mantém | base da mesma etapa × **1,2** + modificadores | −0,05 |
| 50–69 | Fraco | **volta 1** | base da etapa anterior (sem bônus) | −0,15 |
| < 50 | Crítico | **reinicia (D1)** | 1 dia + sugestão de voltar à teoria | −0,20 |

Travas de segurança:
- sem recuperação ativa (só leitura/vídeo/aula/resumo) a faixa máxima é “Bom”;
- com menos de 5 questões e sem autoavaliação, a faixa máxima é “Bom”.

**Primeiro contato (D0):** agenda o D1. Se no D0 você já fez ≥ 5 questões com pontuação ≥ 80,
o D1 é pulado e o D7 é agendado (é o exemplo “16/20 = 80% → D7” da especificação). O limite é
configurável (`firstContact.skipFirstReviewMinScore`) — com 90, por exemplo, 80% no D0 volta a agendar D1.

## 4. Modificadores (só nas faixas de crescimento)

| Modificador | Efeito |
|---|---|
| **Facilidade individual do assunto** (0,6–1,4) | Aprende com o histórico: assuntos em que você erra repetidamente ficam com intervalos menores. |
| **Tendência** (pontuação atual vs. média dos 3 contatos anteriores) | melhora ≥ +10 → ×1,1 · queda ≤ −10 → ×0,85 |
| **Dificuldade percebida** | fácil ×1,1 · média ×1,0 · difícil ×0,85 |
| **Só métodos passivos** | ×0,9 |
| **Crédito pelo intervalo real** | Revisão feita atrasada e bem: o novo intervalo não fica abaixo de dias decorridos × 1,5 (excelente), × 1,2 (bom) ou × 1,0 (mediano). |

O produto dos modificadores é limitado a 0,5–1,6 e o intervalo final a 1–180 dias.

## 5. Simulações (saída real do motor)

**Especificação, seção 7**

| Contato | Resultado | Faixa | Próxima revisão |
|---|---|---|---|
| D0 | 16/20 = 80% | Bom | **D7 em 7 dias** |
| D7 | 18/20 = 90% | Excelente | **D21 em 30 dias** (“D21 ou D30”) |
| D30 | 10/20 = 50% | Fraco | **D7 em 7 dias** (“D7 ou D10”) — perda de retenção |

**Especificação, seção 30 — retenção cai após intervalo maior**

| Contato | Resultado | Faixa | Próxima revisão | Facilidade |
|---|---|---|---|---|
| D0 | 80% | Bom | D7 em 7 dias | 1,02 |
| D7 | 90% | Excelente | D21 em 30 dias | 1,07 |
| D21 | 85% | Bom | D60 em 65 dias | 1,09 |
| D60 | 60% | Fraco | **D21 em 21 dias** | **0,94** |

O sistema percebe a queda depois do intervalo longo, volta uma etapa e reduz a facilidade do
assunto — as próximas subidas serão mais cautelosas. Também gera a notificação
“Seu desempenho em Coledocolitíase caiu de 85% para 60%”.

**Assunto que começa só com teoria**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | só teoria, 🙂 | D1 em 1 dia |
| D1 | 8/10, 🙂 | D7 em 7 dias |
| D7 | 17/20, 🙂 | D21 em 22 dias |
| D21 | 19/20, 😄 | D60 em 88 dias |
| D60 | 18/20, 😄 | D90 em 132 dias |

## 6. Transparência (“Por quê?”)

Cada revisão agendada guarda, em `reviews.explanation`, as entradas e cada passo do cálculo:
último desempenho, desempenho anterior, tendência, último contato, intervalo anterior, novo
intervalo, faixa, mudança de etapa, modificadores e facilidade. A interface mostra isso ao clicar
em **Por quê?** — no registro do estudo, no cartão da revisão e na página do assunto.

## 7. Como ajustar os parâmetros sem recompilar

Grave apenas o que quer mudar; o restante continua vindo do padrão do código:

```sql
INSERT INTO algorithm_configs (key, version, config, updated_at)
VALUES ('spaced-repetition', 2,
  '{"firstContact": {"skipFirstReviewMinScore": 90}, "maxIntervalDays": 240}', now())
ON CONFLICT (key) DO UPDATE SET config = EXCLUDED.config, version = EXCLUDED.version, updated_at = now();
```

A API recarrega a configuração em até 1 minuto. As novas regras valem para os próximos contatos;
o histórico já registrado é preservado (só é recalculado se um estudo daquele assunto for editado
ou excluído). Os parâmetros ativos ficam visíveis em **Perfil → Algoritmo de revisão**.

## 8. Fundamentação e limites

Os princípios gerais usados — espaçar as revisões, aumentar os intervalos com o domínio e
priorizar a recuperação ativa (questões, flashcards, recall) em vez da releitura — têm apoio na
literatura de psicologia cognitiva, por exemplo:

- Cepeda NJ, Pashler H, Vul E, Wixted JT, Rohrer D. Distributed practice in verbal recall tasks:
  a review and quantitative synthesis. *Psychol Bull.* 2006;132(3):354–380.
- Roediger HL 3rd, Karpicke JD. Test-enhanced learning: taking memory tests improves long-term
  retention. *Psychol Sci.* 2006;17(3):249–255.
- Dunlosky J, Rawson KA, Marsh EJ, Nathan MJ, Willingham DT. Improving students' learning with
  effective learning techniques: promising directions from cognitive and educational psychology.
  *Psychol Sci Public Interest.* 2013;14(1):4–58.

Os **números específicos** (D1/D7/D21/D60/D90, faixas de 90/80/70/50%, pesos e fatores) **não
vêm desses estudos**: são a heurística definida na especificação do projeto, pensada como ponto
de partida. O motor é isolado e parametrizado justamente para que esses valores possam ser
calibrados com os dados reais do grupo (ex.: comparar a retenção prevista com o desempenho
observado nas revisões) ou substituídos por um modelo como o FSRS.
