# Algoritmo de revisão espaçada — `adaptive-ladder-v4`

Código: `backend/src/modules/scheduler/` (puro e testado em `engine.test.ts`).
Parâmetros: `config.ts` + sobrescritas na tabela `algorithm_configs`.

## Ideia central

Cada **assunto** tem seu próprio histórico de aprendizagem. Cada dia em que você estuda o assunto
é um **contato**. O primeiro contato é o **D0**; os seguintes são revisões. A cada contato o sistema:

1. **mede** como foi (acertos + autoavaliação);
2. **classifica** o resultado numa faixa;
3. **move** o assunto na escada (avança, mantém, volta ou reinicia) — a etapa indica a fase;
4. **calcula a data**: com questões, pelo **percentual de acertos** nas tabelas da planilha de
   revisões (seção 3), ajustado pela **quantidade de questões**; sem questões, pelo intervalo-base
   da etapa e pelo que já sabe desse assunto;
5. **explica** tudo no botão **“Por quê?”**.

Sessões do mesmo dia são somadas num único contato (ex.: teoria de manhã e questões à noite).

## 1. Escada (fases)

A etapa diz **o que fazer** na revisão (fase, métodos, quantidade de questões sugerida). Nas
revisões **com questões**, os dias saem das tabelas da seção 3 (no máximo 30 dias entre uma revisão
e outra); o intervalo-base abaixo vale para as revisões **sem questões** (flashcards, recall,
autoavaliação).

| Etapa | Intervalo-base (sem questões) | Fase | Métodos sugeridos | Questões sugeridas* |
|---|---|---|---|---|
| D0 | — | Aprender | Teoria + questões | pequeno e médio 25–30 · grande 30–40 |
| D10 | 10 dias (pode ser mais, conforme o desempenho) | Consolidar | Questões + flashcards | 25–30 |
| D21 | 21–30 dias (pode ser mais, conforme o desempenho) | Recuperação após intervalo maior | Questões | 25–30 |
| D60 | 60 dias | Manutenção | Questões + flashcards | 25–30 |
| D90+ | 90 dias, depois ×1,5 (máx. 180) | Manutenção de longo prazo | Questões / simulados | 30–40 |
| D3 | 3 dias | Reforço — rever os erros (só quando o desempenho fica baixo) | Questões + revisão | 25–30 |

\* para assunto médio; pequeno ×0,75 e grande ×1,25, **nunca abaixo de 25–30** — 25 é a
referência de quantidade (seção 4): quem segue a sugestão nunca tem o intervalo encurtado. Os D são **intervalos
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
D10 ≥ 10 dias, D21 ≥ 21, D60 ≥ 60, D90 ≥ 90. Com 25 questões ou mais ele nunca fica abaixo disso;
com menos de 25, a quantidade de questões (seção 4) o traz um pouco para menos.

Trava de segurança: com menos de 5 questões e sem autoavaliação, a faixa máxima é “Bom”.

**Revisão só de estudo/leitura → revisão D1 no dia seguinte.** Ler de novo não mede quanto você
lembra. Quando o contato do dia é só estudo/leitura (inclusive no D0), a próxima revisão fica para
o **dia seguinte** (rótulo D1). A D1 pode ser feita **como a pessoa preferir**: questões (sugestão
de 1,5× o normal da etapa, ex.: 38–45; depois de um D0 só de leitura, 25–30), flashcards, recall ou
teoria. A etapa e a facilidade do assunto **não mudam** até a D1. **A D1 nunca gera outra D1**:
feita com questões, vale o percentual; feita com flashcards/recall, valem a autoavaliação, o
tempo de estudo e a dificuldade (abaixo); **feita só com teoria** (aula, vídeo, leitura), vale o
mesmo cálculo **× 0,4** e a etapa fica no máximo em D10 — ir bem numa aula não mede o quanto você
lembra como as questões medem. Numa etapa avançada, a revisão só teórica também usa × 0,4 e não
avança a etapa.

**1ª revisão — definida pelo percentual de acertos** (arredondado para inteiro, como na planilha
“Planner de Revisões”). A data da primeira revisão sai do percentual de acertos do primeiro contato
medido (o D0 com questões, ou a revisão D1 feita depois de um D0 só de leitura):

| Acertos | 1ª revisão em | Posição na escada |
|---|---|---|
| abaixo de 60% | 3 dias | D3 (reforço) |
| 60–66% | 10 dias | D10 |
| 67–70% | 13 dias | D10 |
| 71–80% | 20 dias | D21 |
| 81% ou mais | 23 dias | D21 |

**Sem 5 questões ou mais** (ex.: D1 com flashcards, recall ou teoria), a data sai da
**autoavaliação** na mesma tabela — 😄 Dominei e 🙂 Fui bem → 23 dias · 😐 Razoável → 13 ·
😕 Tive dificuldade e 😣 Esqueci → 3 —, ajustada pelo **tempo de estudo** (30 min = ×1; ex.: 20 min
→ ×0,93, 60 min → ×1,1) e pela **dificuldade** marcada (fácil ×1,1 · difícil ×0,85). Sem
autoavaliação, considera desempenho médio (70 → 13 dias); com 1 a 4 questões e sem autoavaliação, a
pontuação vai no máximo até 80. Abaixo de 60 são sempre 3 dias. Abaixo de 50% também sugere voltar à
teoria. A
**quantidade de questões** ajusta essa data (seção 4): com 25 questões vale a tabela exata; 86% em
7 questões → 16 dias em vez de 23; 85% em 20 questões → 21 dias; 84% em 45 questões → 28 dias. Abaixo de 60% são sempre 3 dias.
A tabela é configurável (`firstReview.tiers`).

**Revisões seguintes com questões — tabela da planilha.** Da 2ª revisão em diante, feita com 5
questões ou mais, os dias contam a partir da revisão feita e saem do percentual de acertos
(arredondado):

| Acertos | Próxima revisão em |
|---|---|
| abaixo de 60% | 7 dias |
| 60–66% | 13 dias |
| 67–70% | 18 dias |
| 71–80% | 25 dias |
| 81% ou mais | 30 dias |

A quantidade de questões ajusta esses dias (exceto abaixo de 60%). A faixa (acertos +
autoavaliação) continua movendo a etapa — avança, mantém, volta ou reinicia no reforço D3 — e
sugerindo voltar à teoria abaixo de 50%, mas não muda os dias. A tabela é configurável
(`nextReview.tiers`). Quando a versão do algoritmo muda, o histórico de cada assunto é recalculado
aos poucos (ao abrir o app e no job diário), para as revisões pendentes seguirem a regra nova.

## 4. Modificadores (revisões sem questões, nas faixas de crescimento)

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

**25 questões é a referência** (×1) — 20 ainda é pouco para medir o assunto. Com menos, o
resultado é menos seguro e a próxima revisão fica um pouco mais próxima; com mais, um pouco mais
longe. É gradual — cada questão conta; entre os pontos da tabela o fator é proporcional:

| Questões | 5 | 7 | 10 | 15 | 20 | **25** | 30 | 35 | 45 ou mais |
|---|---|---|---|---|---|---|---|---|---|
| Fator | ×0,68 | ×0,71 | ×0,75 | ×0,82 | ×0,90 | **×1** | ×1,05 | ×1,10 | ×1,20 |

(1 a 4 questões: ×0,62 a ×0,66.) Vale nas revisões com questões a partir de 60% de acertos (na 1ª
e nas seguintes). Abaixo de 60% não há ajuste — o intervalo já é o curto. Sem questões (só
flashcards/recall) também não; aí vale o tempo de estudo. Exemplo numa revisão seguinte com 80% de
acertos (tabela: 25 dias):

| Questões | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 45 |
|---|---|---|---|---|---|---|---|---|
| Próxima revisão | 17 dias | 19 | 21 | 23 | **25** | 26 | 28 | 30 |

## 5. Simulações (saída real do motor)

**1ª revisão e revisões seguintes pelas tabelas**

| Contato | Resultado | Faixa | Próxima revisão |
|---|---|---|---|
| D0 | 20/25 = 80% | Bom | **1ª revisão em 20 dias** (tabela: 71–80%) — fase D21 |
| 1ª revisão | 23/25 = 92% | Excelente | **30 dias** (tabela: ≥ 81%) — fase D60 |
| 2ª revisão | 13/25 = 52% | Fraco | **7 dias** (tabela: < 60%) — perda de retenção, volta uma fase |

**Retenção cai depois de várias revisões boas**

| Contato | Resultado | Faixa | Próxima revisão |
|---|---|---|---|
| D0 | 80% | Bom | 1ª revisão em 20 dias |
| 1ª revisão | 92% | Excelente | 30 dias (D60) |
| 2ª revisão | 84% | Bom | 30 dias (D90) |
| 3ª revisão | 60% | Fraco | **13 dias** (volta para a fase D60) |

(25 questões em cada contato.) Também gera a notificação “Seu desempenho em Coledocolitíase caiu
de 84% para 60%”.

**Abaixo de 60%: reforço em 3 dias**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 13/25 = 52% | **3 dias** (D3) — reforço: questões + revisão dos erros (25–30 questões) |
| reforço | 20/25 = 80% | **25 dias** (D10) |
| D10 | 21/25 = 84% | **30 dias** (D21) |
| D21 | 23/25 = 92% | **30 dias** (D60) |

**Poucas questões**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | 17/25 = 68% | 1ª revisão em 13 dias (D10) |
| D10 | 7/7 = 100% + 😐 Razoável | **21 dias** — a tabela dá 30, × 0,71 por serem só 7 questões |
| D10 (outro caso) | 20/20 = 100% | **27 dias** — × 0,90: 20 questões ainda encurtam um pouco |

**Assunto que começa só com teoria**

| Contato | Resultado | Próxima revisão |
|---|---|---|
| D0 | só teoria, 🙂 | amanhã — revisão D1 (25–30 questões, flashcards, recall ou teoria) |
| D1 | 17/25 = 68% | **13 dias** (1ª revisão; tabela: 67–70%) |
| 1ª revisão | 21/25, 🙂 | 30 dias (D21) |
| 2ª revisão | 24/25, 😄 | 30 dias (D60) |

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
| D0 | 20/25 = 80% | 1ª revisão em 20 dias |
| 1ª revisão | 23/25 = 92% | 30 dias (D60) |
| 2ª revisão | só leitura, 🙂 | **amanhã** — revisão D1 (38–45 questões sugeridas), fase mantida |
| dia seguinte | 38/45 = 84% | **36 dias** (D90) — 30 × 1,2 pelas 45 questões |

## 5a. Um estudo com vários assuntos

Em *Registrar estudo → + Outro assunto*, um mesmo estudo pode englobar vários assuntos (ex.: 30
questões de pancreatite aguda, crônica e neoplasias de pâncreas). As questões, os acertos e o tempo
são divididos igualmente — ou informados por assunto — e **cada assunto vira um estudo próprio**,
com a sua parte: a revisão de cada um é concluída e reagendada pelo desempenho dele, exatamente como
se tivesse sido registrado separadamente (`POST /api/studies/batch`, numa transação). Como cada
assunto conta só com a sua parte das questões, com menos de 25 num assunto a próxima revisão dele
fica um pouco mais próxima. O item do cronograma de onde veio o registro vale para o primeiro
assunto; os outros concluem o item pendente deles, se houver.

## 5b. Limite de revisões por dia e revisões muito atrasadas

**No máximo 5 revisões (assuntos) por dia** por padrão — cada pessoa escolhe o seu limite em
*Revisões* ou *Calendário* (“Até 5 revisões por dia · Alterar”: 3, 5, 7, 10, outro número de 1 a 50
ou sem limite) ou em *Perfil → Revisões por dia*. Quando um dia passa do limite, as revisões que chegaram por último vão para o dia vizinho
com vaga, **alternando**: uma para o dia anterior, a seguinte para o dia seguinte (o intervalo
médio não muda). Sem vaga, dois dias antes/depois… até uma semana; depois, o primeiro dia livre.
Ex.: 7 revisões calculadas para 18/10 → 5 ficam no dia 18, uma vai para 17/10 e outra para 19/10.

- Hoje nunca recebe revisão de outro dia, e uma revisão nunca vai para antes do dia seguinte ao
  estudo que a gerou (a D1 de amanhã só pode ir para depois).
- Revisões de reforço curtas (≤ 2 dias) são as últimas a mudar de dia.
- **Remarcadas à mão ficam onde estão**, mesmo num dia cheio (a escolha é da pessoa).
- A data calculada fica guardada (`reviews.shifted_from`): **quando abre vaga nela, a revisão
  volta**. A tela mostra “↔ era 18/10 · limite de revisões por dia”, e o registro do estudo avisa.
- Roda depois de cada estudo registrado, editado ou excluído, da importação de planilha, da troca
  de versão do algoritmo, de mudar o limite e todo dia (`reviews/balance.service.ts`).

**Revisão atrasada há 20 dias ou mais volta para o cronograma** (*Perfil*, 0 = nunca): o assunto
precisa ser estudado de novo. Ele entra no cronograma automático **“Assuntos para repetir”**, na
semana atual (“Revisão atrasada desde 03/09”) — hoje, se for dia de estudo, ou no próximo dia de
estudo da semana —, com uma notificação. Estudar o assunto conclui o item
do cronograma e a revisão, e o algoritmo agenda a próxima pelo desempenho. Uma vez por atraso: se o
item for pulado, não volta de novo até outra revisão atrasar (`plans/requeue.service.ts`; roda ao
abrir o Início, as Revisões e o Cronograma, uma vez por dia, e no job diário).

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
