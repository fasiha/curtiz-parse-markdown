"use strict";
const curtiz = require('./index');
const test = require('tape');
test('does not do anything for non-headers', t => {
  let s = `## blabla
- @fill に
`;
  t.notOk(curtiz.blockToCard(s.split('\n')));
  t.end();
});

test('multiple responses ok', t => {
  let s = `# @ 私 @ わたし @ わたくし @ あたし`;
  const card = curtiz.blockToCard([s]);
  t.ok(card);
  // console.log(JSON.stringify(card, null, 1));
  t.equal(card.flashs.length, 0);
  t.equal(card.fills.length, 0);
  t.equal(card.responses.length, 3);
  t.end();
});

test('translation', t => {
  let s = `# @ 私 @ わたし @ わたくし @ あたし
- @translation @en I @fr je @de Ich`;
  let cards = curtiz.textToCards(s);
  t.ok(cards);
  t.equal(cards.length, 1);
  t.ok(cards[0].translation);
  t.equal([...Object.keys(cards[0].translation)].length, 3);
  t.equal(cards[0].translation.en, 'I');
  t.equal(cards[0].translation.fr, 'je');
  t.equal(cards[0].translation.de, 'Ich');
  t.end();
});

test('does actually do something with headers', t => {
  let s = `## @ 千と千尋の神隠し @ せんとちひろのかみがくし
- @fill と
- @fill の
- @ 千 @ せん    @pos noun-proper-name-firstname @omit [千]と
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname
- @ 神隠し @ かみがくし    @pos noun-common-general
- @translation @en Spirited Away (film)
## @ このおはなしに出て来る人びと @ このおはなしにでてくるひとびと
- @fill に
- @fill 出て来る @ でてくる
- @ 話 @ はなし    @pos noun-common-verbal_suru @omit はなし
- @ 出る @ でる    @pos verb-general @omit 出
- @ 来る @ くる    @pos verb-bound
- @ 人々 @ ひとびと    @pos noun-common-general @omit 人びと
## @ 湯婆婆 @ ゆばーば
- @ 湯婆婆 @ ゆばーば    @pos noun-proper-name-general
`;
  let cards = curtiz.textToCards(s);
  t.equal(cards.length, 3);

  t.equal(cards[0].prompt, '千と千尋の神隠し');
  t.deepEqual(cards[0].responses, ['せんとちひろのかみがくし']);
  t.ok(cards[0].translation && cards[0].translation.en);

  t.equal(cards[1].prompt, 'このおはなしに出て来る人びと');
  t.deepEqual(cards[1].responses, ['このおはなしにでてくるひとびと']);

  t.equal(cards[0].fills.length, 2);
  t.equal(cards[1].fills.length, 2);
  t.equal(cards[0].flashs.length, 3);
  t.equal(cards[1].flashs.length, 4);

  t.ok(cards[0].fills[0].translation.en);
  t.notOk(cards[0].flashs[0].translation);

  t.ok(cards[2].fills ? cards[2].fills.length === 0 : !cards[2].fills);
  t.ok(cards[2].flashs ? cards[2].flashs.length === 0 : !cards[2].flashs);
  t.ok(cards[2].pos);

  t.ok(cards.every(card => card.flashs.every(flash => flash.fills && flash.fills.length > 0)));

  // console.log(JSON.stringify(cards, null, 1));

  t.end();
})