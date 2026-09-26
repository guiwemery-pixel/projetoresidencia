/*
 * Hierarquia de conteúdo:
 *   Grande área → Subárea → Assunto → Tema específico → Subtema (opcional)
 * Cada card aponta para o nível mais profundo conhecido (card.nodeId); os ids de
 * cada nível (areaId, subareaId, subjectId, topicId, subtopicId) são derivados.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { uid, normalizeText } = FC.util;

  const LEVELS = ['area', 'subarea', 'subject', 'topic', 'subtopic'];
  const LEVEL_LABELS = ['Grande área', 'Subárea', 'Assunto', 'Tema', 'Subtema'];
  const LEVEL_FIELDS = ['areaId', 'subareaId', 'subjectId', 'topicId', 'subtopicId'];

  const store = () => FC.store;

  function get(id) {
    return id ? store().nodes.get(id) || null : null;
  }

  function children(parentId) {
    const list = [];
    for (const n of store().nodes.values()) if ((n.parentId || null) === (parentId || null)) list.push(n);
    return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function roots() {
    return children(null);
  }

  function path(id) {
    const out = [];
    let node = get(id);
    let guard = 0;
    while (node && guard++ < 10) {
      out.unshift(node);
      node = get(node.parentId);
    }
    return out;
  }

  const pathNames = (id) => path(id).map((n) => n.name);

  function descendantIds(id) {
    const out = new Set([id]);
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      for (const n of store().nodes.values()) {
        if (n.parentId && frontier.includes(n.parentId) && !out.has(n.id)) {
          out.add(n.id);
          next.push(n.id);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Nome curto para mostrar um nó: "Tratamento — Acalasia". */
  function title(id) {
    const p = path(id);
    if (!p.length) return 'Sem classificação';
    const node = p[p.length - 1];
    if (p.length >= 3) return node.name + ' — ' + p[p.length - 2].name;
    return node.name;
  }

  function breadcrumb(id, sep = ' › ') {
    return pathNames(id).join(sep) || 'Sem classificação';
  }

  function findChild(parentId, name) {
    const key = normalizeText(name);
    for (const n of store().nodes.values()) {
      if ((n.parentId || null) === (parentId || null) && normalizeText(n.name) === key) return n;
    }
    return null;
  }

  /**
   * Garante que o caminho exista e devolve o id do nó mais profundo.
   * names: ['Cirurgia', 'Cirurgia Digestiva', 'Esôfago', 'Acalasia'] (vazios são ignorados
   * a partir do primeiro vazio). Grava os nós novos no banco.
   */
  async function ensurePath(names, pendingOps) {
    const clean = [];
    for (const n of names || []) {
      const s = String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
      if (!s) break;
      clean.push(s.slice(0, 120));
    }
    let parentId = null;
    const created = [];
    for (let level = 0; level < Math.min(clean.length, LEVELS.length); level++) {
      let node = findChild(parentId, clean[level]);
      if (!node) {
        node = { id: uid('n'), name: clean[level], level, parentId, createdAt: Date.now() };
        store().nodes.set(node.id, node);
        created.push(node);
      }
      parentId = node.id;
    }
    if (created.length) {
      if (pendingOps) for (const n of created) pendingOps.push({ store: 'nodes', put: n });
      else await FC.db.bulkPut('nodes', created);
      store().emit('nodes');
    }
    return parentId;
  }

  /** Campos derivados do card (areaId, subareaId...). */
  function pathFields(nodeId) {
    const p = path(nodeId);
    const out = {};
    LEVEL_FIELDS.forEach((f, i) => (out[f] = p[i] ? p[i].id : null));
    return out;
  }

  async function create(name, parentId) {
    const parent = get(parentId);
    const level = parent ? parent.level + 1 : 0;
    if (level >= LEVELS.length) throw new Error('O último nível é o subtema.');
    const existing = findChild(parentId, name);
    if (existing) return existing;
    const node = { id: uid('n'), name: String(name).trim().slice(0, 120), level, parentId: parentId || null, createdAt: Date.now() };
    store().nodes.set(node.id, node);
    await FC.db.put('nodes', node);
    store().emit('nodes');
    return node;
  }

  async function rename(id, name) {
    const node = get(id);
    const clean = String(name || '').trim();
    if (!node || !clean) return;
    const twin = findChild(node.parentId, clean);
    if (twin && twin.id !== id) return merge(id, twin.id);
    node.name = clean.slice(0, 120);
    await FC.db.put('nodes', node);
    store().emit('nodes');
  }

  /** Move o nó (com tudo o que tem dentro) para outro pai do nível imediatamente acima. */
  async function move(id, newParentId) {
    const node = get(id);
    const parent = get(newParentId);
    if (!node) return;
    const expected = node.level === 0 ? null : node.level - 1;
    if ((parent ? parent.level : null) !== expected) throw new Error('Escolha um destino do nível ' + (LEVEL_LABELS[node.level - 1] || 'raiz') + '.');
    if (parent && descendantIds(id).has(parent.id)) throw new Error('Não é possível mover para dentro de si mesmo.');
    const twin = findChild(newParentId, node.name);
    if (twin && twin.id !== id) return merge(id, twin.id);
    node.parentId = newParentId || null;
    await FC.db.put('nodes', node);
    await refreshCardPaths(descendantIds(id));
    store().emit('nodes');
  }

  /** Junta source em target (mesmo nível): filhos e cards passam para target. */
  async function merge(sourceId, targetId) {
    const source = get(sourceId);
    const target = get(targetId);
    if (!source || !target || source.id === target.id) return;
    const ops = [];
    for (const child of children(sourceId)) {
      const twin = findChild(targetId, child.name);
      if (twin) {
        await merge(child.id, twin.id);
      } else {
        child.parentId = targetId;
        ops.push({ store: 'nodes', put: child });
      }
    }
    for (const card of store().cards.values()) {
      if (card.nodeId === sourceId) {
        card.nodeId = targetId;
        ops.push({ store: 'cards', put: card });
      }
    }
    store().nodes.delete(sourceId);
    ops.push({ store: 'nodes', del: sourceId });
    await FC.db.batch(ops);
    await refreshCardPaths(descendantIds(targetId));
    store().emit('nodes');
    store().emit('cards');
  }

  /**
   * Exclui o nó e seus descendentes. Os cards vão para o nível de cima
   * (mode 'parent') ou são excluídos (mode 'delete').
   */
  async function remove(id, mode = 'parent') {
    const node = get(id);
    if (!node) return;
    const ids = descendantIds(id);
    const affected = [...store().cards.values()].filter((c) => ids.has(c.nodeId));
    if (mode === 'delete') {
      await FC.cards.remove(affected.map((c) => c.id));
    } else {
      const ops = [];
      for (const card of affected) {
        card.nodeId = node.parentId || null;
        Object.assign(card, pathFields(card.nodeId));
        ops.push({ store: 'cards', put: card });
      }
      await FC.db.batch(ops);
    }
    const nodeOps = [...ids].map((nid) => ({ store: 'nodes', del: nid }));
    for (const nid of ids) store().nodes.delete(nid);
    await FC.db.batch(nodeOps);
    store().emit('nodes');
    store().emit('cards');
  }

  async function refreshCardPaths(nodeIds) {
    const ops = [];
    for (const card of store().cards.values()) {
      if (!nodeIds || nodeIds.has(card.nodeId)) {
        const fields = pathFields(card.nodeId);
        let changed = false;
        for (const [k, v] of Object.entries(fields)) {
          if (card[k] !== v) {
            card[k] = v;
            changed = true;
          }
        }
        if (changed) ops.push({ store: 'cards', put: card });
      }
    }
    await FC.db.batch(ops);
    if (ops.length) store().emit('cards');
  }

  /** Cards cujo nó está dentro do nó informado. */
  function cardsIn(id, list) {
    const ids = descendantIds(id);
    return (list || [...store().cards.values()]).filter((c) => ids.has(c.nodeId));
  }

  /** Remove nós sem cards e sem filhos (limpeza após exclusões). */
  async function prune() {
    const used = new Set();
    for (const c of store().cards.values()) for (const n of path(c.nodeId)) used.add(n.id);
    const empty = [...store().nodes.values()].filter((n) => !used.has(n.id));
    if (!empty.length) return 0;
    for (const n of empty) store().nodes.delete(n.id);
    await FC.db.bulkDel('nodes', empty.map((n) => n.id));
    store().emit('nodes');
    return empty.length;
  }

  FC.areas = {
    LEVELS,
    LEVEL_LABELS,
    LEVEL_FIELDS,
    get,
    children,
    roots,
    path,
    pathNames,
    descendantIds,
    title,
    breadcrumb,
    findChild,
    ensurePath,
    pathFields,
    create,
    rename,
    move,
    merge,
    remove,
    refreshCardPaths,
    cardsIn,
    prune,
  };
})(typeof self !== 'undefined' ? self : this);
