# Algoritmo de revisão espaçada — `adaptive-ladder-v2`

Código: `backend/src/modules/scheduler/` (puro e testado em `engine.test.ts`).
Parâmetros: `config.ts` + sobrescritas na tabela `algorithm_configs`.

## Ideia central

Cada **assunto** tem seu próprio histórico de aprendizagem. Cada dia em que você estuda o assunto
é um **contato**. O primeiro contato é o **D0**; os seguintes são revisões. A cada contato o sistema:

1. **mede** como foi (acertos + autoavaliação);
2. **classifica** o resultado numa faixa;
3. **move** o assunto na escada de intervalos (avança, mantém, volta ou reinicia);
4. **ajusta** o intervalo pelo que já sabe desse assunto e pela **quantidade de questões** feitas;
5. **explica** tudo no botão **“Por quê?”**.

Sessões do mesmo dia são somadas num único contato (ex.: teoria de manhã e questões à noite).

## 1. Escada de intervalos-base

| Etapa | Intervalo-base | Fase | Métodos sugeridos | Questões sugeridas* |
|---|---|---|---|---|
| D0 | — | Aprender | Teoria + questões | pequeno 20–25 · médio 20–30 · grande 25–35 |
| D10 | 10 dias (pode ser mais, conforme o desempenho) | Consolidar | Questões + flashcards | 20–30 |
| D21 | 21–30 dias (pode ser mais, conforme o desempenho) | Recuperação após intervalo maior | Questões | 20–30 |
| D60 | 60 dias | Manutenção | Questões + flashcards | 20–30 |
| D90+ | 90 dias, depois ×1,5 (máx. 180) | Manutenção de longo prazo | Questões / simulados | 25–40 |
| D3 | 3 dias | Reforço — rever os erros (só quando o desempenho fica baixo) | Questões + revisão | 20–25 |

\* para assunto médio; pequeno ×0,75 e grande ×1,25, **nunca abaixo de 20** — a referência de
quantidade (seção 4): quem segue a sugestão nunca tem o intervalo encurtado. Os D são **intervalos
desde o último contato**, porque as datas reais se deslocam com a adaptação.

Não há mais D1 nem D7 na escada. O **D3** não é uma etapa do caminho normal: é o reforço de quem
fica abaixo de 60% na 1ª revisão, vai mal (“fraco”) no D10 ou tem resultado crítico (< 50%) em
qualquer revisão. O rótulo **D1** só aparece na revisão do dia seguinte a um estudo só de
leitura (regra abaixo).

## 2. Pontuação do contato (0–100)

```
pontuação = (acertos% × pesoAcertos + autoavaliação × 0,30) ÷ (pesoAcertos + 0,30)
pesoAcertos = 0,70 × min(1, questões ÷ 10)      ← poucas questões pesam menos
```

Com menos de 10 questões, a autoavaliação pode puxar a pontuação **para baixo, nunca para cima**:
vale a menor entre essa conta e a conta com o peso normal (0,70). Ex.: 7/7 + Razoável = 88,6;
4/5 + Dominei = 86 (o mesmo que 16/20 + Dominei), e não 89.

| Autoavaliação | Pontos |
|---|---|
| 😄 Dominei | 100 |
| 🙂 Fui bem | 85 |
| 😐 Razoável | 70 |
| 😕 Tive dificuldade | 50 |
| 😣 Esqueci praticamente tudo | 20 |

Só questões → pontuação = % de acertos. Só autoavaliação (com flashcards/recall) → pontos da
autoavaliação. **Só estudo teórico** (teoria, aula, vídeo, leitura, resumo — sem questões registradas
nem flashcards/recall) **não pontua**, exceto quando é a própria revisão D1: ver a regra abaixo.
“Questões” marcado **sem a quantidade**, junto com aula/teoria, conta como estudo teórico.

Exemplos da especificação: 90% + Dominei = 93 · 70% + Razoável = 70 · 50% + Tive dificuldade = 50 ·
20% + Esqueci = 20.

## 3. Faixas e regras

| Pontuação | Faixa | Etapa | Intervalo | Facilidade do assunto |
|---|---|---|---|---|
| ≥ 90 | Excelente | avança 1 | base da nova etapa × **1,2** + modificadores | +0,05 |
| 80–89 | Bom | avança 1 | base da nova etapa + modificadores | +0,02 |
| 70–79 | Mediano | mantém | base da mesma etapa × **1,2** + modificadores | −0,05 |
| 50–69 | Fraco | **volta 1** | base da etapa anterior (sem bônus); do D10 volta ao reforço D3 | −0,15 |
| < 50 | Crítico | **reinicia (D3)** | 3 dias + sugestão de voltar à teoria | −0,20 |

Nas faixas de crescimento (≥ 70%) o intervalo **parte de no mínimo o intervalo-base da etapa**:
D10 ≥ 10 dias, D21 ≥ 21, D60 ≥ 60, D90 ≥ 90. Com 20 questões ou mais ele nunca fica abaixo disso;
com menos de 20, a quantidade de questões (seção 4) o traz um pouco para menos.

Trava de segurança: com menos de 5 questões e sem autoavaliação, a faixa máxima é “Bom”.

**Revisão só de estudo/leitura → revisão D1 no dia seguinte.** Ler de novo não mede quanto você
lembra. Quando o contato do dia é só estudo/leitura (inclusive no D0), a próxima revisão fica para
o **dia seguinte** (rótulo D1). A D1 pode ser feita **como a pessoa preferir**: questões (sugestão
de 1,5× o normal da etapa, ex.: 30–45; depois de um D0 só de leitura, 20–30), flashcards, recall ou
teoria. A etapa e a facilidade do assunto **não mudam** até a D1. **A D1 nunca gera outra D1**:
feita com questões, vale o percentual; feita com flashcards/recall, valem a autoavaliação, o
tempo de estudo e a dificuldade (abaixo); **feita só com teoria** (aula, vídeo, leitura), vale o
mesmo cálculo **× 0,4** e a etapa fica no máximo em D10 — ir bem numa aula não mede o quanto você
lembra como as questões medem. Numa etapa avançada, a revisão só teórica também usa × 0,4 e não
avança a etapa.

**1ª revisão — definida pelo percentual de acertos.** A data da primeira revisão sai do
percentual de acertos do primeiro contato medido (o D0 com questões, ou a revisão D1 feita depois
de um D0 só de leitura):

| Acertos | 1ª revisão em | Posição na escada |
|---|---|---|
| abaixo de 60% | 3 dias | D3 (reforço) |
| 60–65% | 10 dias | D10 |
| 66–70% | 13 dias | D10 |
| 71–80% | 20 dias | D21 |
| 81% ou mais | 23 dias | D21 |

**Sem 5 questões ou mais** (ex.: D1 com flashcards, recall ou teoria), a data sai da
**autoavaliação** na mesma tabela — 😄 Dominei e 🙂 Fui bem → 23 dias · 😐 Razoável → 13 ·
😕 Tive dificuldade e 😣 Esqueci → 3 —, ajustada pelo **tempo de estudo** (30 min = ×1; ex.: 20 min
→ ×0,93, 60 min → ×1,1) e pela **dificuldade** marcada (fácil ×1,1 · difícil ×0,85). Sem
autoavaliação, considera desempenho médio (70 → 13 dias); com 1 a 4 questões e sem autoavaliação, a
pontuação vai no máximo até 80. Abaixo de 60 são sempre 3 dias. Abaixo de 50% também sugere voltar à
teoria. A
**quantidade de questões** ajusta essa data (seção 4): com 20 questões vale a tabela exata; 85% em
7 questões → 17 dias em vez de 23; 85% em 40 questões → 28 dias. Abaixo de 60% são sempre 3 dias.
Da 1ª revisão em diante, valem as faixas acima. A tabela é configurável (`firstReview.tiers`).

## 4. Modificadores (só nas faixas de crescimento)

| Modificador | Efeito |
|---|---|
| **Facilidade individual do assunto** (0,6–1,4) | Aprende com o histórico: assuntos em que você erra repetidamente ficam com intervalos menores. |
| **Tendência** (pontuação atual vs. média dos 3 contatos anteriores) | melhora ≥ +10 → ×1,1 · queda ≤ −10 → ×0,85 |
| **Dificuldade percebida** | fácil ×1,1 · média ×1,0 · difícil ×0,85 |
| **Crédito pelo intervalo real** | Revisão feita atrasada e bem: o novo intervalo não fica abaixo de dias decorridos × 1,5 (excelente), × 1,2 (bom) ou × 1,0 (mediano). |
| **Mínimo da etapa** | O resultado não fica abaixo do intervalo-base da etapa (ex.: facilidade baixa reduz o bônus, mas o D21 continua com pelo menos 21 dias). |
| **Quantidade de questões** | Aplicada por último, sobre o resultado acima (tabela abaixo). |
| **Revisão só teórica** (D1 ou revisão feita só com aula/vídeo/teoria/leitura) | × 0,4, a etapa não avança (1ª revisão: no máximo D10). |
| **Tempo de estudo** (só quando não há questões) | 30 min = ×1 · 5 min ×0,80 · 15 min ×0,90 · 60 min ×1,10 · 90 min ou mais ×1,15 — gradual, também aplicado por último. |

O produto dos modificadores (sem a quantidade) é limitado a 0,5–1,6 e o intervalo final a 1–180 dias.

### Quantidade de questões

**20 questões é a referência** (×1). Com menos, o resultado é menos seguro e a próxima revisão fica
um pouco mais próxima; com mais, um pouco mais longe. É gradual — cada questão conta; entre os
pontos da tabela o fator é proporcional:

| Questões | 5 | 7 | 10 | 15 | **20** | 25 | 30 | 35 | 40 ou mais |
|---|---|---|---|---|---|---|---|---|---|
| Fator | ×0,70 | ×0,74 | ×0,80 | ×0,90 | **×1** | ×1,05 | ×1,10 | ×1,15 | ×1,20 |

(1 a 4 questões: ×0,62 a ×0,68.) Vale com desempenho ≥ 70% e na 1ª revisão (exceto abaixo de 60%).
Com desempenho baixo não há ajuste — o intervalo já é o curto. Sem questões (só flashcards/recall)
também não. Exemplo no D21 com 80% de acertos, subindo para o D60:

| Questões | 5 | 10 | 15 | 20 | 25 | 30 | 40 |
|---|---|---|---|---|---|---|---|
| Próxima revisão | 43 dias | 49 | 55 | **61** | 64 | 67 | 73 |

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

**Abaixo de 60%: reforço em 3 dias**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 11/20 = 55% | **D3 em 3 dias** — reforço: questões + revisão dos erros (20–25 questões) |
| reforço | 16/20 = 80% | **D10 em 10 dias** |
| D10 | 17/20 = 85% | **D21 em 21 dias** |
| D21 | 18/20 = 90% | **D60 em 74 dias** |

**Mínimo da etapa**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 13/20 = 65% | 1ª revisão em 10 dias (D10) |
| D10 | 17/20 = 85% | **D21 em 21 dias** — o cálculo daria 20 (facilidade reduzida pelo início fraco), mas o D21 não fica abaixo de 21 |

**Poucas questões**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 14/20 = 70% | 1ª revisão em 13 dias (D10) |
| D10 | 7/7 = 100% + 😐 Razoável → pontuação 88,6 (Bom) | **D21 em 16 dias** — o cálculo dá 22, × 0,74 por serem só 7 questões |

**Assunto que começa só com teoria**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | só teoria, 🙂 | amanhã — revisão D1 (20–30 questões, flashcards, recall ou teoria) |
| D1 | 14/20 = 70% | **D10 em 13 dias** (tabela: 66–70%) |
| 1ª revisão | 17/20, 🙂 | D21 em 22 dias |
| 2ª revisão | 19/20, 😄 | D60 em 81 dias |

**D1 feita sem questões**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | só leitura | amanhã — revisão D1 |
| D1 | flashcards, 😐 Razoável, 20 min | **D10 em 12 dias** (Razoável → 13 dias × 0,93 pelo tempo) |
| D1 (outro caso) | flashcards, 🙂 Fui bem, 45 min, difícil | **D21 em 21 dias** (23 × 0,85 ≈ 20 → × 1,05) |
| D1 (outro caso) | só teoria/vídeo, 🙂 Fui bem, 30 min | **D10 em 9 dias** — 23 × 0,4 (revisão só teórica) |

**Revisão feita só com leitura + mais questões na D1**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 16/20 = 80% | 1ª revisão em 20 dias |
| 1ª revisão | 18/20 = 90% | D60 em 85 dias |
| 2ª revisão | só leitura, 🙂 | **amanhã** — revisão D1 (30–45 questões sugeridas), etapa mantida |
| dia seguinte | 34/40 = 85% | **D90 em 118 dias** (98 × 1,2 pelas 40 questões; seriam 98 com 20) |

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
`{"passiveFollowUp": {"questionsMultiplier": 2}}` (D1 com o dobro de questões sugeridas),
`{"studyTime": {"reference": 45}}` (45 min passam a valer ×1 — ajuste os `points` junto) ou
`{"questionCount": {"points": [{"questions": 0, "factor": 0.7}, {"questions": 10, "factor": 0.85}, {"questions": 20, "factor": 1}, {"questions": 40, "factor": 1.25}]}}`
(ajuste mais suave para menos e mais forte para mais; a lista substitui a padrão inteira e
`reference` deve ser a quantidade com fator 1).

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

Os **números específicos** (D3/D10/D21/D60/D90, faixas de 90/80/70/50%, pesos e fatores) **não
vêm desses estudos**: são a heurística definida na especificação do projeto, pensada como ponto
de partida. O motor é isolado e parametrizado justamente para que esses valores possam ser
calibrados com os dados reais do grupo (ex.: comparar a retenção prevista com o desempenho
observado nas revisões) ou substituídos por um modelo como o FSRS.
