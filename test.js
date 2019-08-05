"use strict";
const curtiz = require('./index');
const test = require('tape');
const {difference, flatten} = require('curtiz-utils');

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
  t.equal(graph.edges.size, 3);
  t.equal(graph.nodes.size, 3);
  t.equal(Array.from(graph.edges.values(), set => set.size).reduce((prev, curr) => prev + curr, 0), 4);
  let nodes = [...graph.nodes.values()];
  t.equal(nodes[0].responses.length, 3);
}
test('multiple responses ok', t => {
  let s = `# @ 私 @ わたし @ わたくし @ あたし`;
  let graph = curtiz.textToGraph(s);
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
- @furigana {千}^{せん}と{千}^{ち}{尋}^{ひろ}の{神}^{かみ}{隠}^{かく}し
- @fill と    @pos particle-case
- @fill の    @pos particle-case
- @ 千 @ せん    @pos noun-proper-name-firstname @omit [千]と @furigana {千}^{せん}
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname @furigana {千}^{ち}{尋}^{ひろ}
- @ 神隠し @ かみがくし    @pos noun-common-general @furigana {神}^{かみ}{隠}^{かく}し
- @translation @en Spirited Away (film)
`;
  const graph = curtiz.textToGraph(s);
  // p(graph);
  t.equal(3 + 2 + 3 * 6, graph.nodes.size); // 3 cards top-level, 1 cloze/fill, and 6/flash (3 card and 3 cloze)

  const nodes = [...graph.nodes.values()];

  const top = nodes.find(q => (q.prompt || '') === '千と千尋の神隠し');
  t.deepEqual(top.responses, ['せんとちひろのかみがくし']);
  t.ok(top.translation && top.translation.en && top.translation.en.startsWith('Spirited'));

  const particles = nodes.filter(q => q.clozes && 'との'.split('').indexOf(q.clozes[0][0]) >= 0);
  t.equal(particles.length, 2);

  let flashes = nodes.filter(q => q.kind === 'card');
  t.equal(flashes.length, 12);
  t.equal(flashes.filter(card => 'translation' in card).length, 3, 'only header has translation');

  const fills = nodes.filter(q => 'clozes' in q);
  t.equal(fills.length, 2 + 3 * 3, '1 fill per particle/conj phrase, 3 per flash');
  const nonparticles = [...difference(new Set(fills), new Set(particles))];
  t.equal(nonparticles.length, 3 * 3, '3 fills per flash');

  t.equal(nonparticles.filter(c => !c.prompts).length, 3, '1/fill without prompts');

  const withprompt = nonparticles.filter(c => 'prompts' in c);
  const firstClozes = new Set(withprompt.map(c => c.clozes[0][0]));
  const prompts = new Set(withprompt.map(c => c.prompts[0]));
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
  const fills = nodes.filter(q => q.kind === 'cloze' && !q.prompts);
  t.equal(fills.length, 2 + 4, '1 clozes/particle + 1 cloze/vocab without prompt');
  const conjfill = fills.filter(q => q.clozes[0].length === 2);
  t.equal(conjfill.length, 1 + 4, 'kanji and kana are both clozes')

  t.end();
});

test('third example', t => {
  const s = `## @ 湯婆婆 @ ゆばーば
- @ 湯婆婆 @ ゆばーば    @pos noun-proper-name-general
`;
  const graph = curtiz.textToGraph(s);
  const nodes = [...graph.nodes.values()];
  t.equal(nodes.length, 3, 'only header (no bullet) nodes, despite repeated flash with POS');
  t.equal(graph.edges.size, 3, 'only intra-header edges');
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
  t.equal(nodes.length, 3 + 1 + 6 * 2 + 3 + 1 + 6 * 2 - 3, '3 fewer nodes than expected since one bullet is shared');

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
});

test('match quiz', t => {
  const s = `## @ 千と千尋の神隠し @ せんとちひろのかみがくし
- @translation @en Spirited Away (film)
- @furigana {千}^{せん}と{千}^{ち}{尋}^{ひろ}の{神}^{かみ}{隠}^{かく}し
- @fill と    @pos particle-case
- @fill の    @pos particle-case
- @ 千 @ せん    @pos noun-proper-name-firstname @omit [千]と @furigana {千}^{せん} @t-en Sen (name)
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname @furigana {千}^{ち}{尋}^{ひろ} @t-en Chihiro (name)
- @ 神隠し @ かみがくし    @pos noun-common-general @furigana {神}^{かみ}{隠}^{かく}し @t-en spirits hiding
## @ 千尋のお父さん @ ちひろのおちちさん @t-en Chihiro's father
- @furigana {千}^{ち}{尋}^{ひろ}のお{父}^{ちち}さん
- @fill の    @pos particle-case
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname @furigana {千}^{ち}{尋}^{ひろ} @t-en Chihiro (name)
- @ 父 @ ちち    @pos noun-common-general @furigana {父}^{ちち} @t-en father
`;

  const graph = curtiz.textToGraph(s);
  const nodes = [...graph.nodes.values()];
  const matches = nodes.filter(n => n.kind === curtiz.QuizKind.Match);
  t.equal(matches.length, 2);

  t.ok(matches[0].uniqueId.includes('spirits hiding'), 'just make sure this is the right match node');
  t.equal(graph.edges.get(matches[0].uniqueId).size, 2 + 4 * (3), 'match has right # of children');

  let parents = Array.from(graph.edges.values()).filter(set => set.has(matches[0].uniqueId));
  t.equal(parents.length, 3 + 3 * 3, 'match has right # of parents');

  t.equal(matches[0].pairs.length, 3);
  t.equal(matches[1].pairs.length, 2);

  t.end();
});