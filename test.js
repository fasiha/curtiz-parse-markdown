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

test('does actually do something with headers', t => {
  let s = `## @ 千と千尋の神隠し @ せんとちひろのかみがくし
- @fill と
- @fill の
- @ 千 @ せん    @pos noun-proper-name-firstname @omit [千]と
- @ 千尋 @ ちひろ    @pos noun-proper-name-firstname
- @ 神隠し @ かみがくし    @pos noun-common-general
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

  t.equal(cards[1].prompt, 'このおはなしに出て来る人びと');
  t.deepEqual(cards[1].responses, ['このおはなしにでてくるひとびと']);

  t.equal(cards[0].fills.length, 2);
  t.equal(cards[1].fills.length, 2);
  t.equal(cards[0].flashs.length, 3);
  t.equal(cards[1].flashs.length, 4);

  console.log(JSON.stringify(cards, null, 1));

  t.end();
})