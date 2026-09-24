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

Só questões → pontuação = % de acertos. Só autoavaliação (com flashcards/recall) → pontos da
autoavaliação. **Só estudo/leitura** (teoria, aula, vídeo, leitura, resumo — sem questões nem
recuperação ativa) **não pontua**: ver a regra de verificação abaixo.

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

Trava de segurança: com menos de 5 questões e sem autoavaliação, a faixa máxima é “Bom”.

**Revisão só de estudo/leitura → verificação no dia seguinte.** Ler de novo não mede quanto você
lembra. Quando o contato do dia é só estudo/leitura (inclusive no D0), a próxima revisão fica para
o **dia seguinte** (rótulo D1), focada em **questões** e com **mais questões que o normal**
(1,5× a sugestão da etapa, no mínimo a quantidade de um assunto novo). A etapa e a facilidade do
assunto **não mudam**: quem decide o próximo passo é o resultado dessas questões. A
autoavaliação dada à leitura fica registrada, mas não conta como desempenho.

**1ª revisão — definida pelo percentual de acertos.** A data da primeira revisão sai do
percentual de acertos do primeiro contato medido (o D0 com questões, ou a verificação com questões
feita depois de um D0 só de leitura):

| Acertos | 1ª revisão em | Posição na escada |
|---|---|---|
| abaixo de 60% | 3 dias | D1 |
| 60–65% | 10 dias | D7 |
| 66–70% | 13 dias | D7 |
| 71–80% | 20 dias | D21 |
| 81% ou mais | 23 dias | D21 |

São necessárias pelo menos 5 questões; com menos, o sistema pede a verificação com questões no
dia seguinte antes de definir a data. Abaixo de 50% também sugere voltar à teoria. Fazer bem mais
questões que o sugerido para um assunto novo aplica o bônus de volume (×1,1 ou ×1,2). Da 1ª revisão
em diante, valem as faixas acima. A tabela é configurável (`firstReview.tiers`).

## 4. Modificadores (só nas faixas de crescimento)

| Modificador | Efeito |
|---|---|
| **Facilidade individual do assunto** (0,6–1,4) | Aprende com o histórico: assuntos em que você erra repetidamente ficam com intervalos menores. |
| **Tendência** (pontuação atual vs. média dos 3 contatos anteriores) | melhora ≥ +10 → ×1,1 · queda ≤ −10 → ×0,85 |
| **Dificuldade percebida** | fácil ×1,1 · média ×1,0 · difícil ×0,85 |
| **Volume de questões** (vs. a sugestão normal da etapa) | ≥ 1,5× o sugerido → ×1,1 · ≥ 2× → ×1,2 |
| **Crédito pelo intervalo real** | Revisão feita atrasada e bem: o novo intervalo não fica abaixo de dias decorridos × 1,5 (excelente), × 1,2 (bom) ou × 1,0 (mediano). |

O produto dos modificadores é limitado a 0,5–1,6 e o intervalo final a 1–180 dias.

## 5. Simulações (saída real do motor)

**1ª revisão pelo percentual e adaptação depois dela**

| Contato | Resultado | Faixa | Próxima revisão |
|---|---|---|---|
| D0 | 16/20 = 80% | Bom | **1ª revisão em 20 dias** (tabela: 71–80%) |
| 1ª revisão | 18/20 = 90% | Excelente | **D60 em 85 dias** — aumenta bastante |
| 2ª revisão | 10/20 = 50% | Fraco | **D21 em 21 dias** — perda de retenção, volta uma etapa |

**Retenção cai após intervalo maior**

| Contato | Resultado | Faixa | Próxima revisão | Facilidade |
|---|---|---|---|---|
| D0 | 80% | Bom | 1ª revisão em 20 dias | 1,02 |
| 1ª revisão | 90% | Excelente | D60 em 85 dias | 1,07 |
| 2ª revisão | 85% | Bom | D90 em 102 dias | 1,09 |
| 3ª revisão | 60% | Fraco | **D60 em 60 dias** | **0,94** |

O sistema percebe a queda depois do intervalo longo, volta uma etapa e reduz a facilidade do
assunto — as próximas subidas serão mais cautelosas. Também gera a notificação
“Seu desempenho em Coledocolitíase caiu de 85% para 60%”.

**Assunto que começa só com teoria**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | só teoria, 🙂 | amanhã — verificação com 15–25 questões |
| verificação | 14/20 = 70% | **1ª revisão em 13 dias** (tabela: 66–70%) |
| 1ª revisão | 17/20, 🙂 | D21 em 22 dias |
| 2ª revisão | 19/20, 😄 | D60 em 81 dias |

**Revisão feita só com leitura + bônus de volume**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 16/20 = 80% | 1ª revisão em 20 dias |
| 1ª revisão | 18/20 = 90% | D60 em 85 dias |
| 2ª revisão | só leitura, 🙂 | **amanhã** — verificação com 23–38 questões, etapa mantida |
| dia seguinte | 34/40 = 85% (2× o normal) | **D90 em 118 dias** (seriam 98 com 20 questões) |

## 6. Transparência (“Por quê?”)

Cada revisão agendada guarda (comprimido em `reviews.explanation_packed`, ver `reviews/explanation-codec.ts`) as entradas e cada passo do cálculo:
último desempenho, desempenho anterior, tendência, último contato, intervalo anterior, novo
intervalo, faixa, mudança de etapa, modificadores e facilidade. A interface mostra isso ao clicar
em **Por quê?** — no registro do estudo, no cartão da revisão e na página do assunto.

## 7. Como ajustar os parâmetros sem recompilar

Grave apenas o que quer mudar; o restante continua vindo do padrão do código:

```sql
INSERT INTO algorithm_configs (key, version, config, updated_at)
VALUES ('spaced-repetition', 2,
  '{"maxIntervalDays": 240}', now())
ON CONFLICT (key) DO UPDATE SET config = EXCLUDED.config, version = EXCLUDED.version, updated_at = now();
```

A API recarrega a configuração em até 1 minuto. As novas regras valem para os próximos contatos;
o histórico já registrado é preservado (só é recalculado se um estudo daquele assunto for editado
ou excluído). Os parâmetros ativos ficam visíveis em **Perfil → Algoritmo de revisão**. Exemplos:
`{"passiveFollowUp": {"questionsMultiplier": 2}}` (verificação com o dobro de questões) ou
`{"volume": {"tiers": [{"ratio": 2, "factor": 1.3}, {"ratio": 1.5, "factor": 1.15}]}}`.

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
