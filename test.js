"use strict";
const curtiz = require('./index');
const test = require('tape');
const {difference} = require('curtiz-utils');

const p = x => console.dir(x, {depth: null});

test('no nodes/edges created for non-header blocks', t => {
  let s = `## blabla
- @fill に
`;
  let graph = curtiz.textToGraph(s);
  t.equal(graph.edges.size, 0);
  t.equal(graph.nodes.size, 0);
  t.end();
});

function multipleOk(t, graph) {
  t.equal(graph.edges.size, 0);
  t.equal(graph.nodes.size, 1);
  let nodes = [...graph.nodes.values()];
  t.equal(nodes[0].responses.length, 3);
}
test('multiple responses ok', t => {
  let s = `# @ 私 @ わたし @ わたくし @ あたし`;
  let graph = curtiz.textToGraph(s);
  // p(graph);
  multipleOk(t, graph);
  t.end();
});

function threeTranslations(t, graph) {
  let nodes = [...graph.nodes.values()];
  t.equal(nodes[0].translation.en, 'I');
  t.equal(nodes[0].translation.fr, 'je');
  t.equal(nodes[0].translation.de, 'Ich');
}
test('translation', t => {
  let s = `# @ 私 @ わたし @ わたくし @ あたし
- @translation @en I @fr je @de Ich`;
  let graph = curtiz.textToGraph(s);
  // all same requirements above
  multipleOk(t, graph);
  // plus translations
  threeTranslations(t, graph);
  t.end();
});

test('translation single-line', t => {
  let s = `# @ 私 @ わたし @ わたくし @ あたし @t-en I @t-fr je @t-de Ich`;
  let graph = curtiz.textToGraph(s);
  multipleOk(t, graph);
  threeTranslations(t, graph);
  t.end();
});

test('small example', t => {
  const s = `## @ 千と千尋の神隠し @ せんとちひろのかみがくし
- @fill と
- @fill の
- @ 千 @ せん    @pos noun-proper-name-firstname @omit [千]と
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname
- @ 神隠し @ かみがくし    @pos noun-common-general
- @translation @en Spirited Away (film)
`;
  const graph = curtiz.textToGraph(s);
  p(graph.edges);
  t.equal(12, graph.nodes.size); // one for the top-level, one for each fill, and 3 for each flash

  const nodes = [...graph.nodes.values()];

  const top = nodes.find(q => (q.prompt || '') === '千と千尋の神隠し');
  t.deepEqual(top.responses, ['せんとちひろのかみがくし']);
  t.ok(top.translation && top.translation.en && top.translation.en.startsWith('Spirited'));

  const particles = nodes.filter(q => q.clozes && 'との'.split('').indexOf(q.clozes[0][0]) >= 0);
  t.equal(particles.length, 2);

  let flashes = nodes.filter(q => q.prompt && q.responses);
  flashes.sort((a, b) => a.prompt.length - b.prompt.length);
  t.equal(flashes.length, 4);
  for (const flash of flashes.slice(0, -1)) { t.notOk(flash.translation, 'no translation'); }

  const fills = nodes.filter(q => 'clozes' in q);
  t.equal(fills.length, 8, '1 fill per particle/conj phrase, 2 per flash');
  const nonparticles = [...difference(new Set(fills), new Set(particles))];
  t.equal(nonparticles.length, 6, '2 fills per flash');
  const firstClozes = new Set(nonparticles.map(c => c.clozes[0][0]));
  const prompts = new Set(nonparticles.map(c => c.prompts[0]));
  for (const cloze of firstClozes) { t.ok(prompts.has(cloze), 'first cloze is a prompt'); }
  for (const prompt of prompts) { t.ok(firstClozes.has(prompt), 'prompt is a cloze'); }

  t.end();
});

test('second example', t => {
  const s = `## @ このおはなしに出て来る人びと @ このおはなしにでてくるひとびと
- @fill に
- @fill 出て来る @ でてくる
- @ 話 @ はなし    @pos noun-common-verbal_suru @omit はなし
- @ 出る @ でる    @pos verb-general @omit 出
- @ 来る @ くる    @pos verb-bound
- @ 人々 @ ひとびと    @pos noun-common-general @omit 人びと
`;
  const graph = curtiz.textToGraph(s);
  const nodes = [...graph.nodes.values()];
  const fills = nodes.filter(q => q.clozes && !q.prompts);
  t.equal(fills.length, 2);
  const conjfill = fills.filter(q => q.clozes[0].length === 2);
  t.ok(conjfill, 'kanji and kana are both clozes')

  t.end();
});

test('third example', t => {
  const s = `## @ 湯婆婆 @ ゆばーば
- @ 湯婆婆 @ ゆばーば    @pos noun-proper-name-general
`;
  const graph = curtiz.textToGraph(s);
  const nodes = [...graph.nodes.values()];
  t.equal(nodes.length, 1, '1 node despite repeated flash with POS');
  t.equal(graph.edges.size, 0, 'no edges because only 1 node');
  t.ok(nodes[0].pos && nodes[0].pos.length === 4, 'pos exists');
  t.end();
});

test('two sentences share one flashcard', t => {
  const s = `## @ 千と千尋の神隠し @ せんとちひろのかみがくし
- @fill の
- @ 千 @ せん    @pos noun-proper-name-firstname @omit [千]と
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname
## @ 千尋のお父さん @ ちひろのおちちさん
- @fill の
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname
- @ 父 @ ちち    @pos noun-common-general
`;
  const graph = curtiz.textToGraph(s);
  const nodes = [...graph.nodes.values()];
  t.equal(nodes.length, 15, 'one fewer node than expected since one is shared');

  const chihiroKeys =
      '## @ 千と千尋の神隠し @ せんとちひろのかみがくし\n## @ 千尋のお父さん @ ちひろのおちちさん'.split('\n')
          .map(head => head + '\n- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname')
          .map(raw => graph.raws.get(raw))
          .filter(x => !!x);
  t.equal(chihiroKeys.length, 2, 'found two sets of keys related to each raw');
  const chihiroNodes = chihiroKeys.map(s => [...s.values()].filter(s => s.includes('prompt')))
                           .map(v => v[0])
                           .map(k => graph.nodes.get(k))
                           .filter(x => !!x);
  t.equal(chihiroNodes.length, 2, 'found two chihiro nodes');
  t.ok(chihiroNodes.every(n => n.prompt && n.responses), 'both chihiro nodes are Clozes');
  t.equal(chihiroNodes[0], chihiroNodes[1], 'both are the same object');

  t.end();
})